const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { jsPDF } = require('jspdf');
const portfinder = require('portfinder');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
let io = null;

app.use(cors());
app.use(express.json());

// Variables globales
let serialPort = null;
let parser = null;
let isConnected = false;
let connectedClients = 0;
let arduinoMessages = []; // Almacenar todos los mensajes
let currentArduinoState = {
  sku: '',
  operator: '',
  status: 'idle'
};
let serverPort = 3001;

// Configuración del puerto serial
const BAUD_RATE = 9600;

// Función para crear timestamp
function getTimestamp() {
  return new Date().toISOString();
}

// Función para parsear mensajes del Arduino
function parseArduinoMessage(rawMessage) {
  const timestamp = getTimestamp();
  const message = rawMessage.trim();
  
  let type = 'UNKNOWN';
  let content = message;
  
  if (message.startsWith('RESULT:')) {
    type = 'RESULT';
    content = message.substring(7).trim();
  } else if (message.startsWith('SKU:')) {
    type = 'SKU';
    content = message.substring(4).trim();
    currentArduinoState.sku = content;
  } else if (message.startsWith('OPERATOR:')) {
    type = 'OPERATOR';
    content = message.substring(9).trim();
    currentArduinoState.operator = content;
  } else if (message.startsWith('INFO:')) {
    type = 'INFO';
    content = message.substring(5).trim();
  } else if (message.startsWith('STATUS:')) {
    type = 'STATUS';
    content = message.substring(7).trim();
    currentArduinoState.status = content;
  }
  
  const parsedMessage = {
    type,
    content,
    timestamp,
    raw: message
  };
  
  // Guardar mensaje en array
  arduinoMessages.push(parsedMessage);
  
  // Mantener solo los últimos 1000 mensajes
  if (arduinoMessages.length > 1000) {
    arduinoMessages = arduinoMessages.slice(-1000);
  }
  
  // Guardar en archivo de log
  saveToLogFile(parsedMessage);
  
  return parsedMessage;
}

// Función para guardar en archivo de log
function saveToLogFile(message) {
  try {
    const logDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir);
    }
    
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(logDir, `arduino-log-${today}.json`);
    
    const logEntry = JSON.stringify(message) + '\n';
    fs.appendFileSync(logFile, logEntry);
  } catch (error) {
    console.error('Error guardando log:', error);
  }
}

// Función para generar QR code como base64
async function generateQRCode(data) {
  try {
    const qrCodeDataUrl = await QRCode.toDataURL(data, {
      width: 160,
      height: 160,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    return qrCodeDataUrl;
  } catch (error) {
    console.error('Error generando QR:', error);
    return null;
  }
}

// Función para crear PDF de etiquetas usando jsPDF
async function createLabelsPDF(labels) {
  try {
    const doc = new jsPDF({
      unit: 'in',
      format: [8.5, 11], // Carta
      orientation: 'portrait'
    });

    const labelWidth = 1.3;
    const labelHeight = 1.0;
    const margin = 0.2;
    const labelsPerRow = Math.floor((8.5 - 2 * margin) / labelWidth);
    
    let currentX = margin;
    let currentY = margin;
    let labelCount = 0;

    for (const label of labels) {
      // Si necesitamos nueva fila
      if (labelCount > 0 && labelCount % labelsPerRow === 0) {
        currentX = margin;
        currentY += labelHeight + 0.1;
        
        // Si necesitamos nueva página
        if (currentY + labelHeight > 10.5) {
          doc.addPage();
          currentY = margin;
        }
      }

      // Dibujar borde de etiqueta
      doc.rect(currentX, currentY, labelWidth, labelHeight);

      // SKU (más grande)
      doc.setFontSize(10);
      doc.setFont(undefined, 'bold');
      doc.text(label.sku, currentX + labelWidth/2, currentY + 0.15, { align: 'center' });

      // Información de la etiqueta
      doc.setFontSize(8);
      doc.setFont(undefined, 'normal');
      doc.text(`Fecha: ${label.date}`, currentX + 0.05, currentY + 0.3);
      doc.text(`Lote: ${label.lote}`, currentX + 0.05, currentY + 0.4);
      doc.text(`QTY: ${label.qty}`, currentX + 0.05, currentY + 0.5);

      // Generar y agregar QR code
      const qrData = `${label.sku}+${label.date}+${label.qty}+${label.lote}`;
      const qrCodeImage = await generateQRCode(qrData);
      
      if (qrCodeImage) {
        const qrSize = 0.4;
        const qrX = currentX + labelWidth - qrSize - 0.05;
        const qrY = currentY + 0.25;
        doc.addImage(qrCodeImage, 'PNG', qrX, qrY, qrSize, qrSize);
      }

      // Datos del QR en texto pequeño
      doc.setFontSize(6);
      const qrText = qrData;
      const textWidth = doc.getTextWidth(qrText);
      if (textWidth > labelWidth - 0.1) {
        // Dividir texto si es muy largo
        const midPoint = Math.floor(qrText.length / 2);
        const part1 = qrText.substring(0, midPoint);
        const part2 = qrText.substring(midPoint);
        doc.text(part1, currentX + labelWidth/2, currentY + 0.85, { align: 'center' });
        doc.text(part2, currentX + labelWidth/2, currentY + 0.92, { align: 'center' });
      } else {
        doc.text(qrText, currentX + labelWidth/2, currentY + 0.85, { align: 'center' });
      }

      currentX += labelWidth + 0.1;
      labelCount++;
    }

    return doc.output('arraybuffer');
  } catch (error) {
    console.error('Error creando PDF:', error);
    throw error;
  }
}

// Función para imprimir usando comando del sistema
function printPDFFile(filePath) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    
    let command;
    
    if (isWindows) {
      // En Windows, usar el comando print
      command = `powershell -Command "Start-Process '${filePath}' -Verb Print"`;
    } else if (isMac) {
      // En Mac, usar lpr
      command = `lpr "${filePath}"`;
    } else {
      // En Linux, usar lpr también
      command = `lpr "${filePath}"`;
    }

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('Error imprimiendo:', error);
        reject(error);
        return;
      }
      
      console.log('Archivo enviado a impresora');
      resolve({ success: true });
    });
  });
}

// Función principal de impresión
async function printLabelsToSystem(labels) {
  try {
    console.log(`Generando PDF para ${labels.length} etiquetas...`);
    
    // Crear PDF
    const pdfBuffer = await createLabelsPDF(labels);
    
    // Guardar archivo temporal
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    
    const tempFile = path.join(tempDir, `labels_${Date.now()}.pdf`);
    fs.writeFileSync(tempFile, Buffer.from(pdfBuffer));
    
    console.log(`PDF guardado en: ${tempFile}`);
    
    // Enviar a impresora
    await printPDFFile(tempFile);
    
    // Limpiar archivo temporal después de un tiempo
    setTimeout(() => {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
          console.log('Archivo temporal eliminado');
        }
      } catch (e) {
        console.error('Error eliminando archivo temporal:', e);
      }
    }, 10000);
    
    return { 
      success: true, 
      message: `${labels.length} etiqueta(s) enviada(s) a impresora del sistema`,
      pdfPath: tempFile
    };
    
  } catch (error) {
    console.error('Error imprimiendo etiquetas:', error);
    return { 
      success: false, 
      message: 'Error imprimiendo etiquetas: ' + error.message 
    };
  }
}

// Función para encontrar puerto Arduino automáticamente
async function findArduinoPort() {
  const { SerialPort } = require('serialport');
  const ports = await SerialPort.list();
  
  // Buscar puertos que parezcan ser Arduino
  const arduinoPorts = ports.filter(port => 
    port.manufacturer && (
      port.manufacturer.includes('Arduino') ||
      port.manufacturer.includes('USB') ||
      port.productId === '0043' // Arduino Uno
    )
  );
  
  if (arduinoPorts.length > 0) {
    return arduinoPorts[0].path;
  }
  
  // Fallback a puertos comunes
  const commonPorts = ['/dev/ttyACM0', '/dev/ttyUSB0', 'COM3', 'COM4', 'COM5'];
  for (const port of commonPorts) {
    try {
      const testPort = new SerialPort({ path: port, baudRate: BAUD_RATE, autoOpen: false });
      await new Promise((resolve, reject) => {
        testPort.open((err) => {
          if (err) reject(err);
          else {
            testPort.close();
            resolve();
          }
        });
      });
      return port;
    } catch (e) {
      continue;
    }
  }
  
  throw new Error('No se encontró puerto Arduino');
}

// Conectar a Arduino
async function connectToArduino() {
  try {
    if (isConnected) {
      return { success: true, message: 'Ya conectado' };
    }

    const portPath = await findArduinoPort();
    console.log(`Intentando conectar a Arduino en puerto: ${portPath}`);

    serialPort = new SerialPort({
      path: portPath,
      baudRate: BAUD_RATE,
      dtr: false,
      rts: false
    });

    parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

    return new Promise((resolve, reject) => {
      serialPort.on('open', () => {
        console.log('Puerto serial abierto sin resetear Arduino');
        isConnected = true;
        
        parser.on('data', (data) => {
          const rawMessage = data.toString().trim();
          console.log('Datos del Arduino:', rawMessage);
          
          const parsedMessage = parseArduinoMessage(rawMessage);
          
          if (io) {
            io.emit('arduino_message', parsedMessage);
            
            if (parsedMessage.type === 'RESULT') {
              const testResult = {
                result: parsedMessage.content,
                timestamp: parsedMessage.timestamp,
                duration: 0
              };
              io.emit('test_result', testResult);
            }
            
            if (['INFO', 'STATUS'].includes(parsedMessage.type)) {
              io.emit('arduino_info', parsedMessage);
            }
          }
        });

        serialPort.on('error', (err) => {
          console.error('Error del puerto serial:', err);
          isConnected = false;
          if (io) {
            io.emit('connection_lost', { error: err.message });
          }
        });

        resolve({ 
          success: true, 
          message: 'Conectado a Arduino',
          port: portPath 
        });
      });

      serialPort.on('error', (err) => {
        console.error('Error conectando a Arduino:', err);
        isConnected = false;
        reject({ 
          success: false, 
          message: 'Error conectando a Arduino: ' + err.message 
        });
      });
    });

  } catch (error) {
    console.error('Error:', error);
    return { 
      success: false, 
      message: 'Error: ' + error.message 
    };
  }
}

// Desconectar Arduino
function disconnectArduino() {
  if (serialPort && isConnected) {
    serialPort.close();
    isConnected = false;
    console.log('Arduino desconectado');
    return { success: true, message: 'Desconectado' };
  }
  return { success: false, message: 'No estaba conectado' };
}

// Enviar comando al Arduino
function sendCommandToArduino(command) {
  if (!serialPort || !isConnected) {
    return { success: false, message: 'Arduino no conectado' };
  }

  try {
    serialPort.write(command + '\n', (err) => {
      if (err) {
        console.error('Error enviando comando:', err);
        return { success: false, message: 'Error enviando comando' };
      }
      console.log('Comando enviado:', command);
    });
    return { success: true, message: 'Comando enviado' };
  } catch (error) {
    return { success: false, message: 'Error: ' + error.message };
  }
}

// Rutas REST
app.get('/api/status', (req, res) => {
  res.json({
    connected: isConnected,
    clients: connectedClients,
    timestamp: getTimestamp(),
    arduinoState: currentArduinoState,
    serverPort: serverPort
  });
});

app.post('/api/connect', async (req, res) => {
  const result = await connectToArduino();
  res.json(result);
});

app.post('/api/disconnect', (req, res) => {
  const result = disconnectArduino();
  res.json(result);
});

app.post('/api/start-test', (req, res) => {
  const { sku, operator } = req.body;
  
  if (!sku || !operator) {
    return res.status(400).json({
      success: false,
      message: 'SKU y operador son requeridos'
    });
  }

  const command = `START_TEST:${sku}:${operator}`;
  const result = sendCommandToArduino(command);
  res.json(result);
});

app.post('/api/send-command', (req, res) => {
  const { command } = req.body;
  
  if (!command) {
    return res.status(400).json({
      success: false,
      message: 'Comando es requerido'
    });
  }

  const result = sendCommandToArduino(command);
  res.json(result);
});

app.get('/api/arduino-logs', (req, res) => {
  const { limit = 100, type } = req.query;
  
  let filteredMessages = arduinoMessages;
  
  if (type && type !== 'ALL') {
    filteredMessages = arduinoMessages.filter(msg => msg.type === type);
  }
  
  const limitedMessages = filteredMessages.slice(-parseInt(limit));
  
  res.json(limitedMessages);
});

// Rutas de impresión actualizadas
app.post('/api/print-labels', async (req, res) => {
  try {
    const { labels } = req.body;
    
    if (!labels || !Array.isArray(labels) || labels.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere un array de etiquetas'
      });
    }
    
    // Validar formato de etiquetas
    for (const label of labels) {
      if (!label.sku || !label.date || !label.qty || !label.lote) {
        return res.status(400).json({
          success: false,
          message: 'Cada etiqueta debe tener sku, date, qty y lote'
        });
      }
    }
    
    const result = await printLabelsToSystem(labels);
    res.json(result);
    
  } catch (error) {
    console.error('Error en endpoint de impresión:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor: ' + error.message
    });
  }
});

app.get('/api/printers', (req, res) => {
  try {
    res.json({
      success: true,
      printers: [
        {
          name: 'Sistema',
          displayName: 'Impresora del Sistema',
          isDefault: true,
          status: 'ready'
        }
      ],
      defaultPrinter: 'Sistema'
    });
  } catch (error) {
    console.error('Error obteniendo impresoras:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo impresoras: ' + error.message
    });
  }
});

app.post('/api/set-default-printer', (req, res) => {
  try {
    const { printerName } = req.body;
    
    res.json({
      success: true,
      message: `Impresora del sistema establecida: ${printerName || 'Sistema'}`
    });
    
  } catch (error) {
    console.error('Error estableciendo impresora predeterminada:', error);
    res.status(500).json({
      success: false,
      message: 'Error estableciendo impresora: ' + error.message
    });
  }
});

app.post('/api/generate-qr', async (req, res) => {
  try {
    const { data } = req.body;
    
    if (!data) {
      return res.status(400).json({
        success: false,
        message: 'Datos requeridos para generar QR'
      });
    }
    
    const qrCodeImage = await generateQRCode(data);
    
    if (!qrCodeImage) {
      return res.status(500).json({
        success: false,
        message: 'Error generando código QR'
      });
    }
    
    res.json({
      success: true,
      qrCode: qrCodeImage
    });
    
  } catch (error) {
    console.error('Error generando QR:', error);
    res.status(500).json({
      success: false,
      message: 'Error generando QR: ' + error.message
    });
  }
});

// Función para inicializar el servidor con puerto automático
async function startServer() {
  try {
    // Buscar puerto disponible empezando desde 3001
    portfinder.basePort = 3001;
    const availablePort = await portfinder.getPortPromise();
    serverPort = availablePort;
    
    // Inicializar Socket.IO con el puerto encontrado
    io = new Server(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // WebSocket para comunicación en tiempo real
    io.on('connection', (socket) => {
      connectedClients++;
      console.log(`Cliente conectado. Total: ${connectedClients}`);
      
      // Enviar estado actual y puerto del servidor
      socket.emit('status', {
        connected: isConnected,
        timestamp: new Date().toISOString(),
        serverPort: serverPort
      });

      socket.on('disconnect', () => {
        connectedClients--;
        console.log(`Cliente desconectado. Total: ${connectedClients}`);
      });

      // Manejar comandos desde el cliente
      socket.on('start_test', (data) => {
        const { sku, operator } = data;
        const command = `START_TEST:${sku}:${operator}`;
        sendCommandToArduino(command);
      });
    });

    // Iniciar servidor
    server.listen(serverPort, () => {
      console.log(`✅ Servidor Arduino Bridge ejecutándose en puerto ${serverPort}`);
      console.log('📡 Endpoints disponibles:');
      console.log(`   GET  http://localhost:${serverPort}/api/status`);
      console.log(`   POST http://localhost:${serverPort}/api/connect`);
      console.log(`   POST http://localhost:${serverPort}/api/disconnect`);
      console.log(`   POST http://localhost:${serverPort}/api/start-test`);
      console.log(`   POST http://localhost:${serverPort}/api/send-command`);
      console.log(`   GET  http://localhost:${serverPort}/api/arduino-logs`);
      console.log(`   POST http://localhost:${serverPort}/api/print-labels`);
      console.log(`   GET  http://localhost:${serverPort}/api/printers`);
      console.log(`   POST http://localhost:${serverPort}/api/set-default-printer`);
      console.log(`   POST http://localhost:${serverPort}/api/generate-qr`);
      console.log(`🔌 WebSocket: ws://localhost:${serverPort}`);
      console.log('');
      console.log('🖨️  Sistema de impresión: PDF + Sistema operativo');
      console.log('🔧 Dependencias actualizadas y seguras');
    });

  } catch (error) {
    console.error('❌ Error iniciando servidor:', error);
    process.exit(1);
  }
}

// Manejo de cierre graceful
process.on('SIGINT', () => {
  console.log('\n🔄 Cerrando servidor...');
  
  // Cerrar conexión Arduino
  if (isConnected) {
    console.log('📡 Desconectando Arduino...');
    disconnectArduino();
  }
  
  // Limpiar archivos temporales
  const tempDir = path.join(__dirname, 'temp');
  if (fs.existsSync(tempDir)) {
    try {
      const files = fs.readdirSync(tempDir);
      files.forEach(file => {
        const filePath = path.join(tempDir, file);
        fs.unlinkSync(filePath);
      });
      console.log('🗑️  Archivos temporales limpiados');
    } catch (e) {
      console.error('Error limpiando archivos temporales:', e);
    }
  }
  
  console.log('✅ Servidor cerrado correctamente');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM recibido, cerrando servidor...');
  if (isConnected) {
    disconnectArduino();
  }
  process.exit(0);
});

// Iniciar el servidor
startServer();
