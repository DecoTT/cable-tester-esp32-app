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
      resolve({ success: true, message: `Conectado a Arduino en ${serialPortPath}` });
    });

    port.on('error', (err) => {
      console.error('Error en el puerto serie:', err);
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
          reject({ success: false, message: `Error desconectando Arduino: ${err.message}` });
        } else {
          console.log('Arduino desconectado');
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
          reject({ success: false, message: `Error enviando datos a Arduino: ${err.message}` });
        } else {
          console.log('Datos enviados a Arduino:', data);
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
    }, delay * attempt); // Increase delay with each retry
  };
  
  cleanup();
};

// Enhanced label printing with better file handling
app.post('/api/print-labels', async (req, res) => {
  try {
    const { labels } = req.body;
    
    if (!labels || !Array.isArray(labels) || labels.length === 0) {
      return res.json({ success: false, message: 'No se proporcionaron etiquetas para imprimir' });
    }

    console.log(`🖨️  Generando PDF para ${labels.length} etiqueta(s)...`);

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
      margin: 8 // Increased margin from 4 to 8
    });
    
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      
      if (i > 0) {
        doc.addPage();
      }

      // Generate QR code with dot separators instead of plus
      const qrData = `${label.sku}.${label.date}.${label.qty}.${label.lote}`;
      const qrCodeDataURL = await QRCode.toDataURL(qrData, {
        width: 24, // Reduced from 40 to 24
        margin: 0,
        color: { dark: '#000000', light: '#FFFFFF' }
      });
      
      // Convert data URL to buffer
      const qrBuffer = Buffer.from(qrCodeDataURL.split(',')[1], 'base64');

      // Add content to PDF with improved positioning
      // SKU - Larger and at top
      doc.fontSize(12).font('Helvetica-Bold').text(label.sku, 8, 6, { align: 'center', width: 77.6 });
      
      // Information section with better spacing
      doc.fontSize(8).font('Helvetica').text(`Fecha: ${label.date}`, 8, 20, { align: 'center', width: 77.6 });
      doc.text(`Lote: ${label.lote}`, 8, 28, { align: 'center', width: 77.6 });
      doc.text(`QTY: ${label.qty}`, 8, 36, { align: 'center', width: 77.6 });
      
      // Add QR code - smaller and better positioned
      doc.image(qrBuffer, 34.8, 44, { width: 24, height: 24 });
      
      // QR data text at bottom with dots
      doc.fontSize(6).text(qrData, 8, 70, { align: 'center', width: 77.6 });
    }

    doc.end();

    // Wait for PDF generation to complete
    await new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    console.log(`📄 PDF generado: ${filename}`);

    if (defaultPrinter) {
      // Send to printer
      const printCommand = process.platform === 'win32' 
        ? `print /D:"${defaultPrinter}" "${filepath}"`
        : `lp -d "${defaultPrinter}" "${filepath}"`;

      exec(printCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('❌ Error enviando a impresora:', error);
        } else {
          console.log('✅ Archivo enviado a impresora');
        }
        
        // Schedule cleanup with improved retry logic - increased delay for Windows
        cleanupTempFile(filepath, 5, 8000); // 5 retries, starting with 8 second delay
      });
    } else {
      console.log('⚠️  No hay impresora configurada, PDF guardado solamente');
      cleanupTempFile(filepath, 3, 8000); // Cleanup even without printing
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
    res.json({ success: false, message: 'Error generando etiquetas: ' + error.message });
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
                               displayName: parts[1], // You might want to improve this
                               isDefault: line.includes('enabled') && line.includes('accepted')
                             };
                           });

    // Check for default printer
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

  // Construct the command to set the default printer
  const command = `lpadmin -d "${printerName}"`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error setting default printer: ${error.message}`);
      return res.status(500).json({ success: false, message: 'Error estableciendo la impresora predeterminada' });
    }

    defaultPrinter = printerName;
    console.log(`Default printer set to: ${printerName}`);
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
  io.emit('clientConnected', { connected: true, clients: connectedClients });

  socket.on('disconnect', () => {
    connectedClients--;
    console.log('Cliente desconectado:', socket.id, `(${connectedClients} clientes conectados)`);
    io.emit('clientDisconnected', { connected: false, clients: connectedClients });
  });
});

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)){
    fs.mkdirSync(tempDir, { recursive: true });
}

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Servidor Arduino Bridge corriendo en el puerto ${PORT}`);
});
