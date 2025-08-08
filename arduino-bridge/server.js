const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { exec } = require('child_process');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

let port = null;
let serialParser = null;
let connectedClients = 0;
let activeTests = new Map();
let defaultPrinter = null;
let arduinoLogs = [];
let currentArduinoState = {
  sku: '',
  operator: '',
  status: 'Disconnected',
  cableCount: 0,
  channelResults: []
};

// Database and logging directories
const DATABASE_DIR = path.join(__dirname, 'database');
const LOGS_DIR = path.join(__dirname, 'logs');
const TEMP_DIR = path.join(__dirname, 'temp');

// Ensure directories exist
[DATABASE_DIR, LOGS_DIR, TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Nueva función para crear tests automáticamente cuando Arduino presiona botón
const createAutomaticTest = (sku = 'UNKNOWN', operator = 'Arduino') => {
  const testId = `test_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const testData = {
    sku,
    operator,
    startTime: Date.now(),
    testId
  };
  
  activeTests.set(testId, testData);
  
  console.log(`📊 Test iniciado - ID: ${testId}, SKU: ${sku}, Operador: ${operator}`);
  writeSystemLog('TEST_START', 'Automatic test started', { sku, operator, testId });
  
  // Update Arduino state
  currentArduinoState.sku = sku;
  currentArduinoState.operator = operator;
  currentArduinoState.channelResults = [];
  
  // Emit test started event
  io.emit('test_started', {
    testId,
    cableCount: 0,
    timestamp: new Date().toISOString()
  });
  
  return testId;
};

// Database file management
const loadDatabase = (filename) => {
  const filepath = path.join(DATABASE_DIR, filename);
  if (fs.existsSync(filepath)) {
    try {
      return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    } catch (error) {
      console.error(`Error loading database ${filename}:`, error);
      return [];
    }
  }
  return [];
};

const saveDatabase = (filename, data) => {
  const filepath = path.join(DATABASE_DIR, filename);
  try {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error saving database ${filename}:`, error);
    return false;
  }
};

// Load databases on startup
let serverSkuDatabase = loadDatabase('skus.json');
let serverCodigosDatabase = loadDatabase('codigos.json');
let serverLotesDatabase = loadDatabase('lotes.json');

// Logging functions
const getCurrentDateString = () => {
  const now = new Date();
  return now.getFullYear().toString() + 
         (now.getMonth() + 1).toString().padStart(2, '0') + 
         now.getDate().toString().padStart(2, '0');
};

const getCurrentTimeString = () => {
  const now = new Date();
  return now.getHours().toString().padStart(2, '0') + ':' + 
         now.getMinutes().toString().padStart(2, '0') + ':' + 
         now.getSeconds().toString().padStart(2, '0');
};

const getLogDirectory = (date = null) => {
  // Los archivos ya tienen fecha codificada, no necesitamos subcarpetas
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  
  return LOGS_DIR;
};

const writeSystemLog = (type, message, data = null) => {
  const timestamp = new Date().toISOString();
  const dateString = getCurrentDateString();
  const logDir = getLogDirectory();
  const logFile = path.join(logDir, `${dateString}_system.json`);
  
  const logEntry = {
    timestamp,
    type,
    message,
    data
  };
  
  try {
    let logs = [];
    if (fs.existsSync(logFile)) {
      logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    }
    logs.push(logEntry);
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
    console.log(`📝 System log: ${type} - ${message}`);
  } catch (error) {
    console.error('Error writing system log:', error);
  }
};

const writeTestLog = (testResult) => {
  const dateString = getCurrentDateString();
  const logDir = getLogDirectory();
  const logFile = path.join(logDir, `${dateString}_tests.csv`);
  
  const csvHeader = 'Timestamp,SKU,Result,Duration,Operator,TestId\n';
  const csvLine = `${new Date().toISOString()},${testResult.sku},${testResult.result},${testResult.duration},${testResult.operator},${testResult.testId}\n`;
  
  try {
    if (!fs.existsSync(logFile)) {
      fs.writeFileSync(logFile, csvHeader);
    }
    fs.appendFileSync(logFile, csvLine);
    console.log(`📊 Test log written: ${testResult.sku} - ${testResult.result}`);
  } catch (error) {
    console.error('Error writing test log:', error);
  }
};

const writeLabelLog = (labelData, count = 1) => {
  const dateString = getCurrentDateString();
  const logDir = getLogDirectory();
  const logFile = path.join(logDir, `${dateString}_labels.txt`);
  
  const timestamp = new Date().toISOString();
  const logLine = `${timestamp} - SKU: ${labelData.sku}, Lote: ${labelData.lote}, QTY: ${labelData.qty}, Count: ${count}\n`;
  
  try {
    fs.appendFileSync(logFile, logLine);
    console.log(`🏷️  Label log written: ${labelData.sku} - ${labelData.lote} (${count} labels)`);
  } catch (error) {
    console.error('Error writing label log:', error);
  }
};

// Function to add Arduino log with timestamp
const addArduinoLog = (type, content, raw = null) => {
  const logEntry = {
    type,
    content,
    timestamp: new Date().toISOString(),
    raw: raw || content
  };
  
  arduinoLogs.push(logEntry);
  
  // Keep only last 1000 logs to prevent memory issues
  if (arduinoLogs.length > 1000) {
    arduinoLogs = arduinoLogs.slice(-1000);
  }
  
  // Emit log to connected clients
  io.emit('arduino_message', logEntry);
  
  return logEntry;
};

// Enhanced Arduino message parser
const parseArduinoMessage = (data) => {
  const message = data.toString().trim();
  const timestamp = new Date().toISOString();
  console.log(`📨 [${timestamp}] Arduino RAW: "${message}"`);
  
  // Add detailed logging for debugging parsing issues
  console.log(`📨 [${timestamp}] Message length: ${message.length}, First 50 chars: "${message.substring(0, 50)}"`);
  
  // Log hex representation for debugging invisible characters
  const hexBytes = Buffer.from(message, 'utf8').toString('hex').match(/.{2}/g)?.join(' ') || '';
  console.log(`📨 [${timestamp}] Hex: ${hexBytes}`);
  
  // Parse different message types
  if (message.startsWith('INFO:')) {
    const content = message.substring(5).trim();
    addArduinoLog('INFO', content, message);
    
    // ✅ AGREGAR: Auto-crear test cuando Arduino inicia prueba (botón físico)
    const cableCountMatch = content.match(/Iniciando prueba de (\d+) cables/);
    if (cableCountMatch) {
      currentArduinoState.cableCount = parseInt(cableCountMatch[1]);
      // Crear test automático si no existe ninguno
      if (activeTests.size === 0) {
        createAutomaticTest(currentArduinoState.sku || 'UNKNOWN', currentArduinoState.operator || 'Arduino');
      }
    }
    
    io.emit('arduino_info', { type: 'INFO', content, timestamp: new Date().toISOString() });
    
  } else if (message.startsWith('STATUS:')) {
    const content = message.substring(7).trim();
    currentArduinoState.status = content;
    addArduinoLog('STATUS', content, message);
    
    // ✅ AGREGAR: Limpiar resultados de canales al iniciar nueva prueba
    if (content === 'Ejecutando prueba individual') {
      currentArduinoState.channelResults = [];
    }
    
    io.emit('arduino_status', currentArduinoState);
    
  } else if (message.startsWith('SKU:')) {
    const content = message.substring(4).trim();
    currentArduinoState.sku = content;
    addArduinoLog('SKU', content, message);
    io.emit('arduino_message', { type: 'SKU', content, timestamp: new Date().toISOString(), raw: message });
    
  } else if (message.startsWith('OPERATOR:')) {
    const content = message.substring(9).trim();
    currentArduinoState.operator = content;
    addArduinoLog('OPERATOR', content, message);
    io.emit('arduino_message', { type: 'OPERATOR', content, timestamp: new Date().toISOString(), raw: message });
    
  } else if (message.startsWith('CHANNEL:')) {
    const content = message.substring(8).trim();
    const parts = content.split(':');
    if (parts.length >= 2) {
      const channel = parseInt(parts[0]);
      const result = parts[1];
      
      // Update channel results
      while (currentArduinoState.channelResults.length <= channel) {
        currentArduinoState.channelResults.push('PENDING');
      }
      currentArduinoState.channelResults[channel] = result;
      
      addArduinoLog('CHANNEL_RESULT', content, message);
      io.emit('channel_result', { 
        channel, 
        result, 
        timestamp: new Date().toISOString() 
      });
      io.emit('arduino_message', { 
        type: 'CHANNEL_RESULT', 
        content, 
        timestamp: new Date().toISOString(), 
        raw: message,
        channelData: { channel, result }
      });
    }
    
  } else if (message.startsWith('RESULT:')) {
    const content = message.substring(7).trim();
    addArduinoLog('RESULT', content, message);
    
    // ✅ ARREGLAR: Usar método FIFO como en v4
    let testCompleted = false;
    
    if (activeTests.size > 0) {
      // Obtener el test más antiguo (FIFO)
      const oldestTestEntry = Array.from(activeTests.entries())
        .sort(([,a], [,b]) => a.startTime - b.startTime)[0];
      
      if (oldestTestEntry) {
        const [testId, testData] = oldestTestEntry;
        const duration = (Date.now() - testData.startTime) / 1000;
        
        const testResult = {
          result: content,
          timestamp: new Date().toISOString(),
          duration: parseFloat(duration.toFixed(2)),
          sku: testData.sku,
          operator: testData.operator,
          testId: testId,
          cableCount: currentArduinoState.channelResults.length,
          channelResults: [...currentArduinoState.channelResults]
        };
        
        console.log(`✅ Test completado - ID: ${testId}, Duración: ${duration.toFixed(3)}s, Resultado: ${content}`);
        console.log('📊 Enviando resultado de prueba completo:', testResult);
        
        // Write test log
        writeTestLog(testResult);
        
        // Emit test result
        io.emit('test_result', testResult);
        io.emit('arduinoTestResult', testResult);
        
        // Clean up
        activeTests.delete(testId);
        testCompleted = true;
      }
    }
    
    // Si no hay test activo, crear resultado básico
    if (!testCompleted) {
      const testResult = {
        result: content,
        timestamp: new Date().toISOString(),
        duration: 0.64, // Duración por defecto
        sku: currentArduinoState.sku || 'UNKNOWN',
        operator: currentArduinoState.operator || 'Arduino',
        testId: `test_${Date.now()}_orphan`,
        cableCount: currentArduinoState.channelResults.length,
        channelResults: [...currentArduinoState.channelResults]
      };
      
      console.log('⚠️  Resultado sin test activo, creando resultado básico:', testResult);
      writeTestLog(testResult);
      io.emit('test_result', testResult);
      io.emit('arduinoTestResult', testResult);
    }
    
    io.emit('arduino_message', { type: 'RESULT', content, timestamp: new Date().toISOString(), raw: message });
    
  } else {
    // Generic message
    addArduinoLog('UNKNOWN', message, message);
    io.emit('arduino_message', { type: 'UNKNOWN', content: message, timestamp: new Date().toISOString(), raw: message });
  }
};

// Function to detect Arduino ports automatically
const detectArduinoPorts = async () => {
  try {
    const ports = await SerialPort.list();
    console.log('🔍 Detected serial ports:', ports.map(p => `${p.path} (${p.manufacturer || 'Unknown'})`));
    
    // Filter for likely Arduino ports
    const arduinoPorts = ports.filter(port => {
      const manufacturer = (port.manufacturer || '').toLowerCase();
      const path = (port.path || '').toLowerCase();
      const pnpId = (port.pnpId || '').toLowerCase();
      
      return manufacturer.includes('arduino') || 
             manufacturer.includes('ftdi') ||
             manufacturer.includes('ch340') ||
             manufacturer.includes('cp210') ||
             path.includes('arduino') ||
             pnpId.includes('arduino') ||
             pnpId.includes('ch340') ||
             pnpId.includes('cp210');
    });

    console.log('🎯 Potential Arduino ports:', arduinoPorts.map(p => `${p.path} (${p.manufacturer || 'Unknown'})`));
    return arduinoPorts;
  } catch (error) {
    console.error('Error detecting Arduino ports:', error);
    return [];
  }
};

// Function to list available serial ports
const listSerialPorts = async () => {
  try {
    const ports = await SerialPort.list();
    return ports.map(port => ({
      path: port.path,
      manufacturer: port.manufacturer || 'N/A',
      serialNumber: port.serialNumber || 'N/A',
      pnpId: port.pnpId || 'N/A',
      vendorId: port.vendorId || 'N/A',
      productId: port.productId || 'N/A',
    }));
  } catch (error) {
    console.error('Error listing serial ports:', error);
    return [];
  }
};

// Enhanced printing functions
const printPDFFile = (filepath, printerName) => {
  return new Promise((resolve, reject) => {
    // Verificar que el archivo existe
    if (!fs.existsSync(filepath)) {
      return reject(new Error(`Archivo no encontrado: ${filepath}`));
    }

    // Verificar que el archivo no está vacío
    const stats = fs.statSync(filepath);
    if (stats.size === 0) {
      return reject(new Error(`Archivo vacío: ${filepath}`));
    }

    const escapedPath = `"${filepath}"`;
    let printCommand;

    if (process.platform === 'win32') {
      // Comando mejorado para Windows usando PowerShell
      printCommand = `powershell -Command "Start-Process -FilePath ${escapedPath} -Verb Print -Wait"`;
    } else {
      // Linux/Mac
      printCommand = `lp -d "${printerName}" "${filepath}"`;
    }

    // Ejecutar con timeout de 30 segundos
    const child = exec(printCommand, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed) {
          reject(new Error('Timeout: El comando de impresión tardó demasiado'));
        } else {
          reject(new Error(`Error de impresión: ${error.message}`));
        }
      } else {
        resolve({
          success: true,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          fileSize: stats.size,
          printer: printerName
        });
      }
    });
  });
};

const verifyPrinterAvailable = (printerName) => {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      // Verificar impresora en Windows
      const command = `wmic printer where "name='${printerName}'" get name,workoffline /format:csv`;
      exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Error verificando impresora: ${error.message}`));
        } else {
          const lines = stdout.split('\n').filter(line => line.trim() && !line.startsWith('Node'));
          if (lines.length > 0) {
            resolve(true);
          } else {
            reject(new Error('Impresora no encontrada'));
          }
        }
      });
    } else {
      // Linux/Mac
      exec(`lpstat -d | grep ${printerName}`, { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Error verificando impresora: ${error.message}`));
        } else {
          resolve(true);
        }
      });
    }
  });
};

// Function to connect to Arduino
const connectToArduino = async (serialPortPath = null) => {
  return new Promise(async (resolve, reject) => {
    if (port && port.isOpen) {
      resolve({ success: false, message: 'Ya hay un puerto serie abierto. Desconéctalo primero.' });
      return;
    }

    let targetPort = serialPortPath;
    
    // Auto-detect Arduino port if none specified
    if (!targetPort) {
      console.log('🔍 No port specified, attempting auto-detection...');
      writeSystemLog('ARDUINO_AUTO_DETECT', 'Attempting automatic Arduino port detection');
      
      const arduinoPorts = await detectArduinoPorts();
      
      if (arduinoPorts.length === 0) {
        const allPorts = await listSerialPorts();
        if (allPorts.length > 0) {
          console.log('⚠️ No obvious Arduino ports found, trying first available port...');
          targetPort = allPorts[0].path;
        } else {
          const errorMsg = 'No hay puertos serie disponibles. Verifica que el Arduino esté conectado.';
          console.error('❌', errorMsg);
          writeSystemLog('ARDUINO_AUTO_DETECT_FAIL', 'No serial ports available');
          reject({ success: false, message: errorMsg });
          return;
        }
      } else {
        targetPort = arduinoPorts[0].path;
        console.log(`🎯 Selected Arduino port: ${targetPort} (${arduinoPorts[0].manufacturer || 'Unknown'})`);
      }
    }

    console.log(`🔌 Attempting to connect to: ${targetPort}`);
    writeSystemLog('ARDUINO_CONNECT_ATTEMPT', 'Attempting Arduino connection', { port: targetPort, autoDetected: !serialPortPath });

    port = new SerialPort({
      path: targetPort,
      baudRate: 9600,  // ✅ CORRECTO
    });

    serialParser = port.pipe(new ReadlineParser({ delimiter: '\n' })); // ✅ CORRECTO

    port.on('open', () => {
      console.log(`✅ Conectado a Arduino en ${targetPort}`);
      writeSystemLog('ARDUINO_CONNECT', 'Arduino connected successfully', { port: targetPort, autoDetected: !serialPortPath });
      
      // Reset Arduino state
      currentArduinoState = {
        sku: '',
        operator: '',
        status: 'Connected',
        cableCount: 0,
        channelResults: []
      };
      
      io.emit('arduinoConnected', { connected: true, port: targetPort });
      resolve({ success: true, message: `Conectado a Arduino en ${targetPort}`, port: targetPort });
    });

    port.on('error', (err) => {
      console.error(`❌ Error en el puerto serie ${targetPort}:`, err.message);
      writeSystemLog('ARDUINO_ERROR', 'Arduino connection error', { error: err.message, port: targetPort });
      reject({ success: false, message: `Error conectando a Arduino en ${targetPort}: ${err.message}` });
    });

    serialParser.on('data', parseArduinoMessage);

    port.on('close', () => {
      console.log('Se ha cerrado la conexión con Arduino');
      writeSystemLog('ARDUINO_DISCONNECT', 'Arduino connection closed');
      
      // Clean up active tests
      if (activeTests.size > 0) {
        console.log(`🧹 Limpiando ${activeTests.size} tests activos`);
        activeTests.clear();
      }
      
      currentArduinoState.status = 'Disconnected';
      io.emit('arduinoDisconnected', { connected: false, error: 'Conexión cerrada por Arduino' });
      port = null;
      serialParser = null;
    });
  });
};

// Function to disconnect from Arduino
const disconnectArduino = () => {
  return new Promise((resolve, reject) => {
    if (port && port.isOpen) {
      port.close((err) => {
        if (err) {
          console.error('Error cerrando el puerto:', err);
          writeSystemLog('ARDUINO_DISCONNECT_ERROR', 'Error disconnecting Arduino', { error: err.message });
          reject({ success: false, message: `Error desconectando Arduino: ${err.message}` });
        } else {
          console.log('Arduino desconectado');
          writeSystemLog('ARDUINO_DISCONNECT', 'Arduino disconnected successfully');
          port = null;
          serialParser = null;
          resolve({ success: true, message: 'Arduino desconectado correctamente' });
        }
      });
    } else {
      resolve({ success: false, message: 'No hay ninguna conexión activa para desconectar' });
    }
  });
};

// Function to send data to Arduino
const sendDataToArduino = (data) => {
  return new Promise((resolve, reject) => {
    if (port && port.isOpen) {
      port.write(data + '\n', (err) => {
        if (err) {
          console.error('Error enviando datos a Arduino:', err);
          writeSystemLog('ARDUINO_SEND_ERROR', 'Error sending data to Arduino', { data, error: err.message });
          reject({ success: false, message: `Error enviando datos a Arduino: ${err.message}` });
        } else {
          console.log('📤 Datos enviados a Arduino:', data);
          writeSystemLog('ARDUINO_SEND', 'Data sent to Arduino', { data });
          resolve({ success: true, message: 'Datos enviados a Arduino correctamente' });
        }
      });
    } else {
      reject({ success: false, message: 'No hay conexión activa con Arduino' });
    }
  });
};

// API endpoint to get the server status
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    message: 'Servidor Arduino Bridge en línea',
    serverPort: server.address().port
  });
});

// API endpoint to list serial ports
app.get('/api/serial-ports', async (req, res) => {
  try {
    const ports = await listSerialPorts();
    res.json({ success: true, ports });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API endpoint to connect to Arduino
app.post('/api/connect', async (req, res) => {
  const { portPath } = req.body || {};
  
  try {
    console.log(`🚀 Connect request received${portPath ? ` for port: ${portPath}` : ' (auto-detect mode)'}`);
    const result = await connectToArduino(portPath);
    io.emit('arduinoConnected', { connected: true, port: result.port || portPath });
    res.json(result);
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    res.status(500).json({ success: false, message: error.message || 'Error connecting to Arduino' });
  }
});

// API endpoint to disconnect from Arduino
app.post('/api/disconnect', async (req, res) => {
  try {
    const result = await disconnectArduino();
    io.emit('arduinoDisconnected', { connected: false });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API endpoint to send data to Arduino
app.post('/api/send-data', async (req, res) => {
  const { data } = req.body;
  if (!data) {
    return res.status(400).json({ success: false, message: 'No data provided' });
  }
  try {
    const result = await sendDataToArduino(data);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API endpoint to send command to Arduino
app.post('/api/send-command', async (req, res) => {
  const { command } = req.body;
  if (!command) {
    return res.status(400).json({ success: false, message: 'No command provided' });
  }
  try {
    const result = await sendDataToArduino(command);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API endpoint to get Arduino logs
app.get('/api/arduino-logs', (req, res) => {
  res.json({ success: true, logs: arduinoLogs });
});

// API endpoint to get Arduino state
app.get('/api/arduino-state', (req, res) => {
  res.json({ success: true, state: currentArduinoState });
});

// API endpoint to start a test
app.post('/api/start-test', (req, res) => {
  const { sku, operator } = req.body;
  if (!sku || !operator) {
    return res.status(400).json({ success: false, message: 'SKU and operator are required' });
  }

  const testId = `test_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const testData = {
    sku,
    operator,
    startTime: Date.now(),
    testId
  };
  
  activeTests.set(testId, testData);

  // Reset channel results for new test
  currentArduinoState.channelResults = [];
  currentArduinoState.sku = sku;
  currentArduinoState.operator = operator;

  // Construct the command string compatible with Arduino v4 format
  // Arduino v4 expects: START_TEST:SKU,OPERATOR
  const command = `START_TEST:${sku},${operator}`;
  
  console.log(`🔧 Comando compatible con Arduino v4: ${command}`);

      console.log(`🚀 Comando START_TEST enviado - SKU: ${sku}, Operador: ${operator}`);
  console.log(`📊 Test iniciado - ID: ${testId}, SKU: ${sku}, Operador: ${operator}`);
  console.log(`📤 Comando enviado: "${command}"`);
  writeSystemLog('TEST_START', 'Test started', { sku, operator, testId, command });

  sendDataToArduino(command)
    .then(result => {
      // Emit test started event
      io.emit('test_started', {
        testId,
        cableCount: 0, // Will be updated as channels are tested
        timestamp: new Date().toISOString()
      });
      
      res.json({ success: true, message: 'Test started', testId: testId });
    })
    .catch(error => {
      activeTests.delete(testId);
      res.status(500).json({ success: false, message: error.message });
    });
});

// API endpoint to stop a test
app.post('/api/stop-test', (req, res) => {
  const { testId } = req.body;
  
  if (testId && activeTests.has(testId)) {
    activeTests.delete(testId);
  } else {
    // Stop any active test
    activeTests.clear();
  }

  sendDataToArduino('STOP_TEST')
    .then(result => {
      writeSystemLog('TEST_STOP', 'Test stopped', { testId });
      res.json({ success: true, message: 'Test stopped' });
    })
    .catch(error => {
      res.status(500).json({ success: false, message: error.message });
    });
});

// ✅ FASE 2: Sistema de archivos temporales que NO elimina inmediatamente
let tempFilesToCleanup = new Set();

const scheduleFileForCleanup = (filePath) => {
  tempFilesToCleanup.add(filePath);
  console.log(`📁 Archivo programado para limpieza al cerrar: ${path.basename(filePath)}`);
};

const cleanupAllTempFiles = () => {
  console.log(`🧹 Limpiando ${tempFilesToCleanup.size} archivos temporales...`);
  for (const filePath of tempFilesToCleanup) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🗑️  Archivo limpiado: ${path.basename(filePath)}`);
      }
    } catch (error) {
      console.error(`❌ Error limpiando ${path.basename(filePath)}:`, error.message);
    }
  }
  tempFilesToCleanup.clear();
};

// Enhanced label printing with improved printer handling
app.post('/api/print-labels', async (req, res) => {
  try {
    const { labels, labelType = 'standard' } = req.body;
    
    if (!labels || !Array.isArray(labels) || labels.length === 0) {
      return res.json({ success: false, message: 'No se proporcionaron etiquetas para imprimir' });
    }

    console.log(`🖨️  Generando PDF para ${labels.length} etiqueta(s)...`);

    // Verificar impresora disponible antes de generar PDF
    if (defaultPrinter) {
      try {
        await verifyPrinterAvailable(defaultPrinter);
        console.log(`✅ Impresora verificada: ${defaultPrinter}`);
      } catch (error) {
        console.warn(`⚠️  Advertencia: ${error.message}. Continuando con generación...`);
      }
    }

    // Log each label individually
    labels.forEach(label => {
      writeLabelLog(label, 1);
    });

    // Create unique filename with high precision timestamp
    const timestamp = Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const tempDir = path.join(__dirname, 'temp');
    const filename = `labels_${timestamp}.pdf`;
    const filepath = path.join(tempDir, filename);

    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Configuración dinámica según tipo de etiqueta
    let labelsPerRow, labelWidth, labelHeight, pageWidth, pageHeight, qrSize, fontSize, titleSize;
    
    if (labelType === 'large') {
      // 7.5cm x 5cm = 212.6 x 141.7 points exactos (1 por página, orientación horizontal)
      labelsPerRow = 1;
      labelWidth = 212.6;   // 7.5cm exacto
      labelHeight = 141.7;  // 5cm exacto
      pageWidth = 212.6;    // Página = tamaño de etiqueta exacto
      pageHeight = 141.7;   // Sin márgenes adicionales
      qrSize = 80;
      fontSize = 7;
      titleSize = 18;
    } else {
      // Standard 1.3" x 1" = 93.6 x 72 points (2 por línea)
      labelsPerRow = 2;
      labelWidth = 93.6;
      labelHeight = 72;
      pageWidth = (labelWidth * labelsPerRow) + 16;
      pageHeight = Math.ceil(labels.length / labelsPerRow) * labelHeight + 16;
      qrSize = 40;
      fontSize = 7;
      titleSize = 12;
    }

    const doc = new PDFDocument({ 
      size: [pageWidth, pageHeight],
      margin: 0
    });

    // AGREGAR logging de debug
    console.log(`📐 PDF Config - Tipo: ${labelType}, Tamaño: ${pageWidth}x${pageHeight} points (${(pageWidth * 0.352778).toFixed(1)}x${(pageHeight * 0.352778).toFixed(1)} mm)`);
    
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    // Verificar si existe logo
    const logoPath = path.join(__dirname, 'logo.png');
    let logoBuffer = null;

    if (fs.existsSync(logoPath)) {
      logoBuffer = fs.readFileSync(logoPath);
      console.log('✅ Logo cargado correctamente');
    } else {
      console.log('ℹ️ No se encontró logo.png, continuando sin logo');
    }

    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      
      let xPos, yPos;
      
      if (labelType === 'large') {
        // Para etiquetas large: una por página, tamaño exacto
        if (i > 0) {
          doc.addPage();
        }
        xPos = 0;
        yPos = 0;
      } else {
        // Para etiquetas standard: grid layout
        const row = Math.floor(i / labelsPerRow);
        const col = i % labelsPerRow;
        xPos = 2 + (col * labelWidth);
        yPos = 2 + (row * labelHeight);
      }

      // Generate QR code with dot separators
      const qrData = `${label.sku}.${label.date}.${label.qty}.${label.lote}`;
      const qrCodeDataURL = await QRCode.toDataURL(qrData, {
        width: qrSize,
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' }
      });
      
      // Convert data URL to buffer
      const qrBuffer = Buffer.from(qrCodeDataURL.split(',')[1], 'base64');

      // Insertar logo si existe
      if (logoBuffer) {
        doc.image(logoBuffer, xPos + 2, yPos);
      }

      if (labelType === 'large') {
        // Layout para etiqueta grande (7.5cm x 5cm) - layout compacto
        const titleYPos = logoBuffer ? yPos + 5 : yPos + 2;
        doc.fontSize(titleSize).font('Helvetica-Bold')
           .text(label.sku, xPos + 4, titleYPos, { align: 'center', width: labelWidth - 8 });
        
         const textYOffset = logoBuffer ? 8 : 0;
         doc.fontSize(fontSize).font('Helvetica')
            .text(`Fecha: ${label.date}`, xPos + 4, yPos + 11 + textYOffset, { align: 'center', width: labelWidth - 8 })
            .text(`Lote: ${label.lote}`, xPos + 4, yPos + 19 + textYOffset, { align: 'center', width: labelWidth - 8 })
            .text(`Cantidad: ${label.qty}`, xPos + 4, yPos + 27 + textYOffset, { align: 'center', width: labelWidth - 8 });
         
         const qrX = xPos + (labelWidth / 2) - (qrSize / 2);
         doc.image(qrBuffer, qrX, yPos + 42 + textYOffset, { width: qrSize, height: qrSize });
         
         doc.fontSize(8).text(qrData, xPos + 4, yPos + 120 + textYOffset, { align: 'center', width: labelWidth - 8 });
      } else {
        // Layout para etiqueta standard (1.3" x 1") - ajustar posición del título
        const titleYPos = logoBuffer ? yPos + 12 : yPos + 2;
        doc.fontSize(titleSize).font('Helvetica-Bold')
           .text(label.sku, xPos + 4, titleYPos, { align: 'center', width: labelWidth - 8 });
        
        const textYOffset = logoBuffer ? 10 : 0;
        doc.fontSize(fontSize).font('Helvetica')
           .text(`${label.date} | L:${label.lote}`, xPos + 4, yPos + 14 + textYOffset, { align: 'center', width: labelWidth - 8 })
           .text(`QTY: ${label.qty}`, xPos + 4, yPos + 22 + textYOffset, { align: 'center', width: labelWidth - 8 });
        
        const qrX = xPos + (labelWidth / 2) - (qrSize / 2);
        doc.image(qrBuffer, qrX, yPos + 30 + textYOffset, { width: qrSize, height: qrSize });
        
        doc.fontSize(5).text(qrData, xPos + 4, yPos + 62 + textYOffset, { align: 'center', width: labelWidth - 8 });
      }
    }

    doc.end();

    // ✅ MEJORA CRÍTICA: Esperar sincronización completa del archivo
    await new Promise((resolve, reject) => {
      stream.on('finish', () => {
        // Esperar un poco más para asegurar que el archivo esté completamente escrito
        setTimeout(resolve, 500);
      });
      stream.on('error', reject);
    });

    console.log(`📄 PDF generado: ${filename}`);
    
    // Verificar que el archivo está completo
    const fileStats = fs.statSync(filepath);
    console.log(`📊 Tamaño del archivo: ${fileStats.size} bytes`);
    
    writeSystemLog('LABEL_GENERATE', 'PDF labels generated', { 
      filename, 
      count: labels.length, 
      fileSize: fileStats.size 
    });

    let printResult = null;
    
    if (defaultPrinter) {
      try {
        console.log(`🖨️  Enviando a impresora: ${defaultPrinter}...`);
        printResult = await printPDFFile(filepath, defaultPrinter);
        
        console.log('✅ Archivo enviado a impresora exitosamente');
        writeSystemLog('LABEL_PRINT_SUCCESS', 'Labels sent to printer successfully', {
          filename,
          printer: defaultPrinter,
          fileSize: printResult.fileSize
        });
        
      } catch (error) {
        console.error('❌ Error enviando a impresora:', error.message);
        writeSystemLog('LABEL_PRINT_ERROR', 'Error printing labels', { 
          error: error.message, 
          filename,
          printer: defaultPrinter
        });
        printResult = { error: error.message };
      }
    } else {
      console.log('⚠️  No hay impresora configurada, PDF guardado solamente');
    }

    scheduleFileForCleanup(filepath);

    res.json({ 
      success: true, 
      message: labels.length === 1 
        ? 'Etiqueta generada y enviada a impresión' 
        : `${labels.length} etiquetas generadas y enviadas a impresión`,
      filename: filename,
      printer: defaultPrinter,
      fileSize: fileStats.size,
      printStatus: printResult ? (printResult.error ? 'error' : 'success') : 'no_printer'
    });

  } catch (error) {
    console.error('❌ Error generando etiquetas:', error);
    writeSystemLog('LABEL_ERROR', 'Error generating labels', { error: error.message });
    res.json({ success: false, message: 'Error generando etiquetas: ' + error.message });
  }
});

// Test printer endpoint
app.post('/api/test-printer', async (req, res) => {
  try {
    const { printerName } = req.body;
    const testPrinter = printerName || defaultPrinter;
    
    if (!testPrinter) {
      return res.json({ success: false, message: 'No se especificó impresora para prueba' });
    }

    console.log(`🧪 Probando impresora: ${testPrinter}`);

    // Verificar disponibilidad
    try {
      await verifyPrinterAvailable(testPrinter);
    } catch (error) {
      return res.json({ 
        success: false, 
        message: `Impresora no disponible: ${error.message}` 
      });
    }

    // Crear documento de prueba simple
    const timestamp = Date.now();
    const tempDir = path.join(__dirname, 'temp');
    const filename = `test_${timestamp}.pdf`;
    const filepath = path.join(tempDir, filename);

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    doc.fontSize(16).font('Helvetica-Bold')
       .text('PRUEBA DE IMPRESIÓN', { align: 'center' })
       .moveDown()
       .fontSize(12).font('Helvetica')
       .text(`Impresora: ${testPrinter}`)
       .text(`Fecha: ${new Date().toLocaleString()}`)
       .text(`Archivo: ${filename}`)
       .moveDown()
       .text('Si puede leer esto, la impresión funciona correctamente.');

    doc.end();

    await new Promise((resolve, reject) => {
      stream.on('finish', () => setTimeout(resolve, 500));
      stream.on('error', reject);
    });

    // Intentar imprimir
    try {
      const printResult = await printPDFFile(filepath, testPrinter);
      scheduleFileForCleanup(filepath);
      
      writeSystemLog('PRINTER_TEST_SUCCESS', 'Printer test successful', {
        printer: testPrinter,
        filename,
        fileSize: printResult.fileSize
      });

      res.json({
        success: true,
        message: `Prueba de impresión enviada exitosamente a ${testPrinter}`,
        printer: testPrinter,
        filename,
        fileSize: printResult.fileSize
      });

    } catch (error) {
      scheduleFileForCleanup(filepath);
      writeSystemLog('PRINTER_TEST_ERROR', 'Printer test failed', {
        printer: testPrinter,
        error: error.message
      });

      res.json({
        success: false,
        message: `Error en prueba de impresión: ${error.message}`,
        printer: testPrinter
      });
    }

  } catch (error) {
    console.error('❌ Error en prueba de impresora:', error);
    res.json({ success: false, message: 'Error interno: ' + error.message });
  }
});

// Database synchronization endpoints
app.get('/api/database/skus', (req, res) => {
  res.json({ success: true, data: serverSkuDatabase });
});

app.post('/api/database/skus', (req, res) => {
  const { skus } = req.body;
  if (Array.isArray(skus)) {
    serverSkuDatabase = skus;
    const saved = saveDatabase('skus.json', serverSkuDatabase);
    if (saved) {
      writeSystemLog('DATABASE_SYNC', 'SKU database synchronized', { count: skus.length });
      res.json({ success: true, message: 'SKU database synchronized' });
    } else {
      res.status(500).json({ success: false, message: 'Error saving SKU database' });
    }
  } else {
    res.status(400).json({ success: false, message: 'Invalid SKU data format' });
  }
});

app.get('/api/database/codigos', (req, res) => {
  res.json({ success: true, data: serverCodigosDatabase });
});

app.post('/api/database/codigos', (req, res) => {
  const { codigos } = req.body;
  if (Array.isArray(codigos)) {
    serverCodigosDatabase = codigos;
    const saved = saveDatabase('codigos.json', serverCodigosDatabase);
    if (saved) {
      writeSystemLog('DATABASE_SYNC', 'Codigos database synchronized', { count: codigos.length });
      res.json({ success: true, message: 'Codigos database synchronized' });
    } else {
      res.status(500).json({ success: false, message: 'Error saving Codigos database' });
    }
  } else {
    res.status(400).json({ success: false, message: 'Invalid Codigos data format' });
  }
});

app.get('/api/database/lotes', (req, res) => {
  res.json({ success: true, data: serverLotesDatabase });
});

app.post('/api/database/lotes', (req, res) => {
  const { lotes } = req.body;
  if (Array.isArray(lotes)) {
    serverLotesDatabase = lotes;
    const saved = saveDatabase('lotes.json', serverLotesDatabase);
    if (saved) {
      writeSystemLog('DATABASE_SYNC', 'Lotes database synchronized', { count: lotes.length });
      res.json({ success: true, message: 'Lotes database synchronized' });
    } else {
      res.status(500).json({ success: false, message: 'Error saving Lotes database' });
    }
  } else {
    res.status(400).json({ success: false, message: 'Invalid Lotes data format' });
  }
});

// Log management endpoints
app.get('/api/logs/list', (req, res) => {
  try {
    const dates = [];
    const years = fs.readdirSync(LOGS_DIR).filter(item => 
      fs.statSync(path.join(LOGS_DIR, item)).isDirectory() && /^\d{4}$/.test(item)
    );
    
    years.forEach(year => {
      const yearPath = path.join(LOGS_DIR, year);
      const months = fs.readdirSync(yearPath).filter(item => 
        fs.statSync(path.join(yearPath, item)).isDirectory() && /^\d{2}$/.test(item)
      );
      
      months.forEach(month => {
        const monthPath = path.join(yearPath, month);
        const files = fs.readdirSync(monthPath);
        const logDates = [...new Set(files.map(file => file.substring(0, 8)).filter(date => /^\d{8}$/.test(date)))];
        dates.push(...logDates);
      });
    });
    
    res.json({ success: true, dates: dates.sort().reverse() });
  } catch (error) {
    console.error('Error listing log dates:', error);
    res.status(500).json({ success: false, message: 'Error listing log dates' });
  }
});

app.get('/api/logs/:date', (req, res) => {
  const { date } = req.params;
  const { type } = req.query;
  
  if (!/^\d{8}$/.test(date)) {
    return res.status(400).json({ success: false, message: 'Invalid date format' });
  }
  
  try {
    const logDir = getLogDirectory(date);
    const files = {};
    
    if (!type || type === 'system') {
      const systemFile = path.join(logDir, `${date}_system.json`);
      if (fs.existsSync(systemFile)) {
        files.system = JSON.parse(fs.readFileSync(systemFile, 'utf8'));
      }
    }
    
    if (!type || type === 'tests') {
      const testsFile = path.join(logDir, `${date}_tests.csv`);
      if (fs.existsSync(testsFile)) {
        files.tests = fs.readFileSync(testsFile, 'utf8');
      }
    }
    
    if (!type || type === 'labels') {
      const labelsFile = path.join(logDir, `${date}_labels.txt`);
      if (fs.existsSync(labelsFile)) {
        files.labels = fs.readFileSync(labelsFile, 'utf8');
      }
    }
    
    res.json({ success: true, date, files });
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ success: false, message: 'Error reading logs' });
  }
});

app.post('/api/logs/export', (req, res) => {
  const { startDate, endDate, types } = req.body;
  
  try {
    const exportData = {};
    const dates = [];
    
    // Generate date range
    const start = new Date(
      parseInt(startDate.substring(0, 4)),
      parseInt(startDate.substring(4, 6)) - 1,
      parseInt(startDate.substring(6, 8))
    );
    const end = new Date(
      parseInt(endDate.substring(0, 4)),
      parseInt(endDate.substring(4, 6)) - 1,
      parseInt(endDate.substring(6, 8))
    );
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.getFullYear().toString() + 
                     (d.getMonth() + 1).toString().padStart(2, '0') + 
                     d.getDate().toString().padStart(2, '0');
      dates.push(dateStr);
    }
    
    // Collect data for each date
    dates.forEach(date => {
      const logDir = getLogDirectory(date);
      exportData[date] = {};
      
      types.forEach(type => {
        const filename = `${date}_${type}.${type === 'tests' ? 'csv' : type === 'system' ? 'json' : 'txt'}`;
        const filepath = path.join(logDir, filename);
        
        if (fs.existsSync(filepath)) {
          if (type === 'system') {
            exportData[date][type] = JSON.parse(fs.readFileSync(filepath, 'utf8'));
          } else {
            exportData[date][type] = fs.readFileSync(filepath, 'utf8');
          }
        }
      });
    });
    
    res.json({ success: true, data: exportData, dateRange: { startDate, endDate } });
  } catch (error) {
    console.error('Error exporting logs:', error);
    res.status(500).json({ success: false, message: 'Error exporting logs' });
  }
});

// ✅ FASE 1: Detección de impresoras compatible con Windows
app.get('/api/printers', (req, res) => {
  if (process.platform === 'win32') {
    // Windows: Usar WMIC para obtener impresoras
    exec('wmic printer list brief /format:csv', (error, stdout, stderr) => {
      if (error) {
        console.error(`Error listing printers: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Error obteniendo la lista de impresoras' });
      }

      const lines = stdout.split('\n').filter(line => line.trim() && !line.startsWith('Node'));
      const printers = lines.map(line => {
        const parts = line.split(',');
        if (parts.length >= 3) {
          return {
            name: parts[2].trim(),
            displayName: parts[2].trim(),
            isDefault: parts[1] && parts[1].trim().toLowerCase() === 'true'
          };
        }
      }).filter(printer => printer && printer.name);

      // Obtener impresora predeterminada
      exec('wmic printer where "default=true" get name /format:csv', (error, stdout, stderr) => {
        let defaultPrinterName = null;
        if (!error && stdout) {
          const lines = stdout.split('\n').filter(line => line.trim() && !line.startsWith('Node'));
          if (lines.length > 0) {
            const parts = lines[0].split(',');
            if (parts.length >= 2) {
              defaultPrinterName = parts[1].trim();
            }
          }
        }

        // ✅ FASE 3: Auto-configurar primera impresora si no hay predeterminada
        if (!defaultPrinterName && printers.length > 0) {
          defaultPrinterName = printers[0].name;
          defaultPrinter = defaultPrinterName;
          console.log(`🖨️  Auto-configurada impresora predeterminada: ${defaultPrinterName}`);
        } else if (defaultPrinterName) {
          defaultPrinter = defaultPrinterName;
        }

        res.json({
          success: true,
          printers: printers,
          defaultPrinter: defaultPrinterName
        });
      });
    });
  } else {
    // Linux/Unix: Usar lpstat
    exec('lpstat -p', (error, stdout, stderr) => {
      if (error) {
        console.error(`Error listing printers: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Error obteniendo la lista de impresoras' });
      }

      const printers = stdout.split('\n')
                             .filter(line => line.startsWith('printer'))
                             .map(line => {
                               const parts = line.split(' ');
                               return {
                                 name: parts[1],
                                 displayName: parts[1],
                                 isDefault: line.includes('enabled') && line.includes('accepted')
                               };
                             });

      exec('lpstat -d', (error, stdout, stderr) => {
        let defaultPrinterName = null;
        if (!error && stdout) {
          const defaultPrinterLine = stdout.split('\n').find(line => line.startsWith('system default destination'));
          if (defaultPrinterLine) {
            defaultPrinterName = defaultPrinterLine.split(' ')[4].trim();
          }
        }

        if (!defaultPrinterName && printers.length > 0) {
          defaultPrinterName = printers[0].name;
          defaultPrinter = defaultPrinterName;
        } else if (defaultPrinterName) {
          defaultPrinter = defaultPrinterName;
        }

        res.json({
          success: true,
          printers: printers,
          defaultPrinter: defaultPrinterName
        });
      });
    });
  }
});

// ✅ FASE 3: Configurar impresora predeterminada compatible con Windows
app.post('/api/set-default-printer', (req, res) => {
  const { printerName } = req.body;

  if (!printerName) {
    return res.status(400).json({ success: false, message: 'Printer name is required' });
  }

  if (process.platform === 'win32') {
    // Windows: Usar wmic o PowerShell para establecer impresora predeterminada
    const command = `powershell -Command "(Get-WmiObject -Class Win32_Printer -Filter \\\"Name='${printerName}'\\\").SetDefaultPrinter()"`;
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error setting default printer: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Error estableciendo la impresora predeterminada' });
      }

      defaultPrinter = printerName;
      console.log(`🖨️  Impresora predeterminada establecida: ${printerName}`);
      writeSystemLog('PRINTER_SET', 'Default printer set', { printer: printerName });
      res.json({ success: true, message: `Impresora predeterminada establecida a ${printerName}` });
    });
  } else {
    // Linux/Unix: Usar lpadmin
    const command = `lpadmin -d "${printerName}"`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error setting default printer: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Error estableciendo la impresora predeterminada' });
      }

      defaultPrinter = printerName;
      console.log(`Default printer set to: ${printerName}`);
      writeSystemLog('PRINTER_SET', 'Default printer set', { printer: printerName });
      res.json({ success: true, message: `Impresora predeterminada establecida a ${printerName}` });
    });
  }
});

app.post('/api/generate-qr', async (req, res) => {
  const { data } = req.body;

  if (!data) {
    return res.status(400).json({ success: false, message: 'Data is required to generate QR code' });
  }

  try {
    const qrCodeDataURL = await QRCode.toDataURL(data, {
      width: 256,
      margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' }
    });

    res.json({ success: true, qrCode: qrCodeDataURL });
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({ success: false, message: 'Error generating QR code: ' + error.message });
  }
});

// Display server info on startup
const displayServerInfo = () => {
  console.log('✅ Servidor Arduino Bridge ejecutándose en puerto 3001');
  console.log('📡 Endpoints disponibles:');
  console.log('   GET  http://localhost:3001/api/status');
  console.log('   POST http://localhost:3001/api/connect');
  console.log('   POST http://localhost:3001/api/disconnect');
  console.log('   POST http://localhost:3001/api/start-test');
  console.log('   POST http://localhost:3001/api/send-command');
  console.log('   GET  http://localhost:3001/api/arduino-logs');
  console.log('   GET  http://localhost:3001/api/arduino-state');
  console.log('   POST http://localhost:3001/api/print-labels');
  console.log('   POST http://localhost:3001/api/test-printer');
  console.log('   GET  http://localhost:3001/api/printers');
  console.log('   POST http://localhost:3001/api/set-default-printer');
  console.log('   POST http://localhost:3001/api/generate-qr');
  console.log('🔌 WebSocket: ws://localhost:3001');
  console.log('');
  console.log('🖨️  Sistema de impresión: PDF + Sistema operativo');
  console.log('🔧 Dependencias actualizadas y seguras');
  console.log('⏱️  Sistema de medición de duración mejorado');
};

io.on('connection', (socket) => {
  connectedClients++;
  console.log(`Cliente conectado. Total: ${connectedClients}`);
  writeSystemLog('CLIENT_CONNECT', 'Client connected', { socketId: socket.id, totalClients: connectedClients });
  io.emit('clientConnected', { connected: true, clients: connectedClients });

  socket.on('disconnect', () => {
    connectedClients--;
    console.log(`Cliente desconectado. Total: ${connectedClients}`);
    writeSystemLog('CLIENT_DISCONNECT', 'Client disconnected', { socketId: socket.id, totalClients: connectedClients });
    io.emit('clientDisconnected', { connected: false, clients: connectedClients });
  });
});

// ✅ FASE 2: Configurar limpieza de archivos temporales al cerrar el bridge
process.on('SIGINT', () => {
  console.log('\n🛑 Cerrando servidor Arduino Bridge...');
  cleanupAllTempFiles();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Cerrando servidor Arduino Bridge...');
  cleanupAllTempFiles();
  process.exit(0);
});

const PORT = 3001;
server.listen(PORT, () => {
  displayServerInfo();
  writeSystemLog('SERVER_START', 'Arduino Bridge server started', { port: PORT });
});
