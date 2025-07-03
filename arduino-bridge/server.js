const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const printer = require('node-printer');
const htmlPdf = require('html-pdf-node');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

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

// Configuración del puerto serial
const BAUD_RATE = 9600;

// Configuración de impresión
let defaultPrinter = null;

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
      width: 80,
      height: 80,
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

// Función para generar HTML de etiqueta con QR real
async function generateLabelHTML(sku, date, qty, lote) {
  const qrData = `${sku}+${date}+${qty}+${lote}`;
  const qrCodeImage = await generateQRCode(qrData);
  
  return `
    <div style="
      width: 1.3in; 
      height: 1in; 
      border: 1px solid #000;
      display: inline-block;
      margin: 2px;
      padding: 4px;
      font-family: Arial, sans-serif;
      font-size: 8px;
      text-align: center;
      page-break-inside: avoid;
      vertical-align: top;
    ">
      <div style="font-weight: bold; font-size: 10px; margin-bottom: 2px;">${sku}</div>
      <div style="margin-bottom: 1px;">Fecha: ${date}</div>
      <div style="margin-bottom: 1px;">Lote: ${lote}</div>
      <div style="margin-bottom: 2px;">QTY: ${qty}</div>
      <div style="margin: 0 auto 2px auto; width: 40px; height: 40px;">
        ${qrCodeImage ? `<img src="${qrCodeImage}" style="width: 40px; height: 40px;" />` : 
          `<div style="border: 1px solid #666; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; font-size: 6px; background: #f0f0f0;">QR</div>`}
      </div>
      <div style="font-size: 6px; margin-top: 1px; word-break: break-all;">
        ${qrData}
      </div>
    </div>
  `;
}

// Función para imprimir etiquetas usando el sistema
async function printLabelsToSystem(labels) {
  try {
    // Generar HTML de las etiquetas
    const labelPromises = labels.map(label => 
      generateLabelHTML(label.sku, label.date, label.qty, label.lote)
    );
    const labelHTMLs = await Promise.all(labelPromises);
    
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Etiquetas</title>
        <style>
          @media print {
            @page {
              size: auto;
              margin: 0.2in;
            }
            body {
              margin: 0;
              padding: 0;
            }
          }
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 10px;
          }
          .label-row {
            display: block;
            margin-bottom: 5px;
            page-break-inside: avoid;
          }
        </style>
      </head>
      <body>
        <div class="label-row">
          ${labelHTMLs.join('')}
        </div>
      </body>
      </html>
    `;

    // Obtener impresoras disponibles
    const printers = printer.getPrinters();
    const targetPrinter = defaultPrinter || (printers.length > 0 ? printers[0].name : null);
    
    if (!targetPrinter) {
      throw new Error('No hay impresoras disponibles');
    }

    // Crear PDF temporal
    const options = { 
      format: 'A4',
      margin: { top: '0.2in', right: '0.2in', bottom: '0.2in', left: '0.2in' }
    };
    
    const file = { content: printContent };
    const pdfBuffer = await htmlPdf.generatePdf(file, options);
    
    // Guardar PDF temporal
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    
    const tempFile = path.join(tempDir, `labels_${Date.now()}.pdf`);
    fs.writeFileSync(tempFile, pdfBuffer);
    
    // Enviar a impresora
    printer.printFile({
      filename: tempFile,
      printer: targetPrinter,
      success: function(jobID) {
        console.log(`Trabajo de impresión enviado: ${jobID}`);
        // Limpiar archivo temporal después de un tiempo
        setTimeout(() => {
          try {
            fs.unlinkSync(tempFile);
          } catch (e) {
            console.error('Error eliminando archivo temporal:', e);
          }
        }, 5000);
      },
      error: function(err) {
        console.error('Error de impresión:', err);
        // Limpiar archivo temporal
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {
          console.error('Error eliminando archivo temporal:', e);
        }
      }
    });
    
    return { success: true, message: `Etiquetas enviadas a impresora: ${targetPrinter}` };
    
  } catch (error) {
    console.error('Error imprimiendo etiquetas:', error);
    return { success: false, message: 'Error imprimiendo etiquetas: ' + error.message };
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
      dtr: false,  // Deshabilitar DTR para evitar reset del Arduino
      rts: false   // Deshabilitar RTS para evitar reset del Arduino
    });

    parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

    return new Promise((resolve, reject) => {
      serialPort.on('open', () => {
        console.log('Puerto serial abierto sin resetear Arduino');
        isConnected = true;
        
        // Configurar listeners
        parser.on('data', (data) => {
          const rawMessage = data.toString().trim();
          console.log('Datos del Arduino:', rawMessage);
          
          // Parsear mensaje del Arduino
          const parsedMessage = parseArduinoMessage(rawMessage);
          
          // Enviar todos los mensajes a los clientes
          io.emit('arduino_message', parsedMessage);
          
          // Si es un resultado, también enviarlo como test_result
          if (parsedMessage.type === 'RESULT') {
            const testResult = {
              result: parsedMessage.content,
              timestamp: parsedMessage.timestamp,
              duration: 0
            };
            io.emit('test_result', testResult);
          }
          
          // Si es info, enviarlo como arduino_info
          if (['INFO', 'STATUS'].includes(parsedMessage.type)) {
            io.emit('arduino_info', parsedMessage);
          }
        });

        serialPort.on('error', (err) => {
          console.error('Error del puerto serial:', err);
          isConnected = false;
          io.emit('connection_lost', { error: err.message });
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
    arduinoState: currentArduinoState
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

// NUEVAS RUTAS PARA IMPRESIÓN
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
    const printers = printer.getPrinters();
    res.json({
      success: true,
      printers: printers.map(p => ({
        name: p.name,
        displayName: p.displayName || p.name,
        isDefault: p.isDefault || false,
        status: p.status || 'unknown'
      })),
      defaultPrinter
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
    
    if (!printerName) {
      return res.status(400).json({
        success: false,
        message: 'Nombre de impresora requerido'
      });
    }
    
    const printers = printer.getPrinters();
    const printerExists = printers.some(p => p.name === printerName);
    
    if (!printerExists) {
      return res.status(404).json({
        success: false,
        message: 'Impresora no encontrada'
      });
    }
    
    defaultPrinter = printerName;
    
    res.json({
      success: true,
      message: `Impresora predeterminada establecida: ${printerName}`
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

// WebSocket para comunicación en tiempo real
io.on('connection', (socket) => {
  connectedClients++;
  console.log(`Cliente conectado. Total: ${connectedClients}`);
  
  // Enviar estado actual
  socket.emit('status', {
    connected: isConnected,
    timestamp: new Date().toISOString()
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

// Inicializar servidor
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor Arduino Bridge ejecutándose en puerto ${PORT}`);
  console.log('Endpoints disponibles:');
  console.log('  GET  /api/status');
  console.log('  POST /api/connect');
  console.log('  POST /api/disconnect');
  console.log('  POST /api/start-test');
  console.log('  POST /api/send-command');
  console.log('  GET  /api/arduino-logs');
  console.log('  POST /api/print-labels');
  console.log('  GET  /api/printers');
  console.log('  POST /api/set-default-printer');
  console.log('  POST /api/generate-qr');
  console.log('WebSocket: ws://localhost:' + PORT);
});

// Manejo de cierre graceful
process.on('SIGINT', () => {
  console.log('Cerrando servidor...');
  if (isConnected) {
    disconnectArduino();
  }
  process.exit(0);
});
