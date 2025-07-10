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
  const targetDate = date || getCurrentDateString();
  const year = targetDate.substring(0, 4);
  const month = targetDate.substring(4, 6);
  const logDir = path.join(LOGS_DIR, year, month);
  
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  return logDir;
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

// Function to connect to Arduino
const connectToArduino = async (serialPortPath) => {
  return new Promise((resolve, reject) => {
    if (port && port.isOpen) {
      resolve({ success: false, message: 'Ya hay un puerto serie abierto. Desconéctalo primero.' });
      return;
    }

    port = new SerialPort({
      path: serialPortPath,
      baudRate: 115200,
    });

    serialParser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    port.on('open', () => {
      console.log(`Conectado a Arduino en ${serialPortPath}`);
      writeSystemLog('ARDUINO_CONNECT', 'Arduino connected successfully', { port: serialPortPath });
      resolve({ success: true, message: `Conectado a Arduino en ${serialPortPath}` });
    });

    port.on('error', (err) => {
      console.error('Error en el puerto serie:', err);
      writeSystemLog('ARDUINO_ERROR', 'Arduino connection error', { error: err.message, port: serialPortPath });
      reject({ success: false, message: `Error conectando a Arduino: ${err.message}` });
    });

    serialParser.on('data', (data) => {
      console.log('Data from Arduino:', data);
      io.emit('arduinoData', data);

      // Detect specific messages and emit them as events
      if (data.startsWith('INFO:')) {
        io.emit('arduinoInfo', { type: 'INFO', content: data.substring(5).trim() });
      } else if (data.startsWith('STATUS:')) {
        try {
          const status = JSON.parse(data.substring(7).trim());
          io.emit('arduinoStatus', status);
        } catch (e) {
          console.error('Error parsing status:', e);
        }
      } else if (data.startsWith('TEST_RESULT:')) {
        try {
          const testResult = JSON.parse(data.substring(12).trim());
          
          // Write automatic test log
          writeTestLog(testResult);
          
          io.emit('arduinoTestResult', testResult);
        } catch (e) {
          console.error('Error parsing test result:', e);
        }
      } else if (data.startsWith('MESSAGE:')) {
        io.emit('arduinoMessage', { type: 'MESSAGE', content: data.substring(8).trim() });
      } else if (data.startsWith('SKU:')) {
        io.emit('arduinoMessage', { type: 'SKU', content: data.substring(4).trim() });
      } else if (data.startsWith('OPERATOR:')) {
        io.emit('arduinoMessage', { type: 'OPERATOR', content: data.substring(9).trim() });
      }
    });

    port.on('close', () => {
      console.log('Se ha cerrado la conexión con Arduino');
      writeSystemLog('ARDUINO_DISCONNECT', 'Arduino connection closed');
      io.emit('arduinoDisconnected', { error: 'Conexión cerrada por Arduino' });
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
          console.log('Datos enviados a Arduino:', data);
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
  const { portPath } = req.body;
  try {
    const result = await connectToArduino(portPath);
    io.emit('arduinoConnected', { connected: true, port: portPath });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

// API endpoint to start a test
app.post('/api/start-test', (req, res) => {
  const { sku, operator } = req.body;
  if (!sku || !operator) {
    return res.status(400).json({ success: false, message: 'SKU and operator are required' });
  }

  const testId = Date.now();
  activeTests.set(testId, { sku, operator });

  // Construct the command string
  const command = `START_TEST:${sku}:${operator}:${testId}`;

  writeSystemLog('TEST_START', 'Test started', { sku, operator, testId });

  sendDataToArduino(command)
    .then(result => {
      res.json({ success: true, message: 'Test started', testId: testId });
    })
    .catch(error => {
      res.status(500).json({ success: false, message: error.message });
    });
});

// API endpoint to stop a test
app.post('/api/stop-test', (req, res) => {
  const { testId } = req.body;
  if (!testId) {
    return res.status(400).json({ success: false, message: 'Test ID is required' });
  }

  if (!activeTests.has(testId)) {
    return res.status(404).json({ success: false, message: 'Test ID not found' });
  }

  sendDataToArduino('STOP_TEST')
    .then(result => {
      activeTests.delete(testId);
      writeSystemLog('TEST_STOP', 'Test stopped', { testId });
      res.json({ success: true, message: 'Test stopped' });
    })
    .catch(error => {
      res.status(500).json({ success: false, message: error.message });
    });
});

// Improved temporary file cleanup with retry logic
const cleanupTempFile = (filePath, maxRetries = 3, delay = 2000) => {
  const cleanup = (attempt = 1) => {
    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️  Archivo temporal eliminado: ${path.basename(filePath)}`);
        }
      } catch (error) {
        if (attempt < maxRetries && error.code === 'EBUSY') {
          console.log(`⏳ Archivo ocupado, reintentando limpieza (${attempt}/${maxRetries})...`);
          cleanup(attempt + 1);
        } else {
          console.error('❌ Error eliminando archivo temporal:', error.message);
        }
      }
    }, delay * attempt);
  };
  
  cleanup();
};

// Enhanced label printing with better file handling and automatic logging
app.post('/api/print-labels', async (req, res) => {
  try {
    const { labels } = req.body;
    
    if (!labels || !Array.isArray(labels) || labels.length === 0) {
      return res.json({ success: false, message: 'No se proporcionaron etiquetas para imprimir' });
    }

    console.log(`🖨️  Generando PDF para ${labels.length} etiqueta(s)...`);

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

    // Generate PDF with improved layout
    const doc = new PDFDocument({ 
      size: [93.6, 72], // 1.3" x 1" in points
      margin: 8
    });
    
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      
      if (i > 0) {
        doc.addPage();
      }

      // Generate QR code with dot separators
      const qrData = `${label.sku}.${label.date}.${label.qty}.${label.lote}`;
      const qrCodeDataURL = await QRCode.toDataURL(qrData, {
        width: 24,
        margin: 0,
        color: { dark: '#000000', light: '#FFFFFF' }
      });
      
      // Convert data URL to buffer
      const qrBuffer = Buffer.from(qrCodeDataURL.split(',')[1], 'base64');

      // Add content to PDF with improved positioning
      // SKU - Larger and at top
      doc.fontSize(12).font('Helvetica-Bold').text(label.sku, 8, 6, { align: 'center', width: 77.6 });
      
      // Information section with better spacing
      doc.fontSize(8).font('Helvetica').text(`Fecha: ${label.date}`, 8, 18, { align: 'center', width: 77.6 });
      doc.text(`Lote: ${label.lote}`, 8, 26, { align: 'center', width: 77.6 });
      doc.text(`QTY: ${label.qty}`, 8, 34, { align: 'center', width: 77.6 });
      
      // Add QR code - smaller and better positioned
      doc.image(qrBuffer, 34.8, 42, { width: 24, height: 24 });
      
      // QR data text at bottom with dots
      doc.fontSize(6).text(qrData, 8, 68, { align: 'center', width: 77.6 });
    }

    doc.end();

    // Wait for PDF generation to complete
    await new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    console.log(`📄 PDF generado: ${filename}`);
    writeSystemLog('LABEL_GENERATE', 'PDF labels generated', { filename, count: labels.length });

    if (defaultPrinter) {
      // Send to printer
      const printCommand = process.platform === 'win32' 
        ? `print /D:"${defaultPrinter}" "${filepath}"`
        : `lp -d "${defaultPrinter}" "${filepath}"`;

      exec(printCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('❌ Error enviando a impresora:', error);
          writeSystemLog('LABEL_PRINT_ERROR', 'Error printing labels', { error: error.message, filename });
        } else {
          console.log('✅ Archivo enviado a impresora');
          writeSystemLog('LABEL_PRINT_SUCCESS', 'Labels sent to printer successfully', { filename, printer: defaultPrinter });
        }
        
        // Schedule cleanup with improved retry logic
        cleanupTempFile(filepath, 5, 10000);
      });
    } else {
      console.log('⚠️  No hay impresora configurada, PDF guardado solamente');
      cleanupTempFile(filepath, 3, 10000);
    }

    res.json({ 
      success: true, 
      message: labels.length === 1 
        ? 'Etiqueta enviada a impresión' 
        : `${labels.length} etiquetas enviadas a impresión`,
      filename: filename 
    });

  } catch (error) {
    console.error('❌ Error generando etiquetas:', error);
    writeSystemLog('LABEL_ERROR', 'Error generating labels', { error: error.message });
    res.json({ success: false, message: 'Error generando etiquetas: ' + error.message });
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

app.get('/api/printers', (req, res) => {
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

      res.json({
        success: true,
        printers: printers,
        defaultPrinter: defaultPrinterName
      });
    });
  });
});

app.post('/api/set-default-printer', (req, res) => {
  const { printerName } = req.body;

  if (!printerName) {
    return res.status(400).json({ success: false, message: 'Printer name is required' });
  }

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

io.on('connection', (socket) => {
  connectedClients++;
  console.log('Cliente conectado:', socket.id, `(${connectedClients} clientes conectados)`);
  writeSystemLog('CLIENT_CONNECT', 'Client connected', { socketId: socket.id, totalClients: connectedClients });
  io.emit('clientConnected', { connected: true, clients: connectedClients });

  socket.on('disconnect', () => {
    connectedClients--;
    console.log('Cliente desconectado:', socket.id, `(${connectedClients} clientes conectados)`);
    writeSystemLog('CLIENT_DISCONNECT', 'Client disconnected', { socketId: socket.id, totalClients: connectedClients });
    io.emit('clientDisconnected', { connected: false, clients: connectedClients });
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Servidor Arduino Bridge corriendo en el puerto ${PORT}`);
  writeSystemLog('SERVER_START', 'Arduino Bridge server started', { port: PORT });
});
