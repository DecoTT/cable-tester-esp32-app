const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

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
