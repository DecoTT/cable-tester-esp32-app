
// Detectar puerto dinámico del servidor
let SERVER_URL = 'http://localhost:3001';

// Función para detectar el puerto correcto del servidor
const detectServerPort = async () => {
  const possiblePorts = [3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010];
  
  for (const port of possiblePorts) {
    try {
      const testUrl = `http://localhost:${port}/api/status`;
      const response = await fetch(testUrl, { 
        method: 'GET',
        signal: AbortSignal.timeout(1000) // Timeout de 1 segundo
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.serverPort) {
          SERVER_URL = `http://localhost:${port}`;
          console.log(`🔍 Servidor Arduino Bridge detectado en puerto ${port}`);
          return SERVER_URL;
        }
      }
    } catch (error) {
      // Continuar con el siguiente puerto
      continue;
    }
  }
  
  console.warn('⚠️  No se pudo detectar el servidor Arduino Bridge, usando puerto por defecto 3001');
  return SERVER_URL;
};

// Función helper para hacer requests con detección automática de puerto
const makeRequest = async (endpoint: string, options: RequestInit = {}) => {
  try {
    const response = await fetch(`${SERVER_URL}${endpoint}`, options);
    
    // Si falla, intentar detectar el puerto correcto
    if (!response.ok && response.status === 0) {
      console.log('🔄 Redetectando puerto del servidor...');
      await detectServerPort();
      return fetch(`${SERVER_URL}${endpoint}`, options);
    }
    
    return response;
  } catch (error) {
    // Si hay error de conexión, intentar detectar puerto
    console.log('🔄 Error de conexión, redetectando puerto...');
    await detectServerPort();
    return fetch(`${SERVER_URL}${endpoint}`, options);
  }
};

export const generateLabelHTML = (sku: string, date: string, qty: string, lote: string) => {
  const qrData = `${sku}.${date}.${qty}.${lote}`;
  
  return `
    <div style="
      width: 1.3in; 
      height: 1in; 
      border: 1px solid #000;
      display: inline-block;
      margin: 2px;
      padding: 8px;
      font-family: Arial, sans-serif;
      font-size: 8px;
      text-align: center;
      page-break-inside: avoid;
      vertical-align: top;
    ">
      <div style="font-weight: bold; font-size: 12px; margin-bottom: 4px;">${sku}</div>
      <div style="margin-bottom: 2px;">Fecha: ${date}</div>
      <div style="margin-bottom: 2px;">Lote: ${lote}</div>
      <div style="margin-bottom: 4px;">QTY: ${qty}</div>
      <div style="
        border: 1px solid #666;
        width: 24px;
        height: 24px;
        margin: 0 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 6px;
        background: #f0f0f0;
      ">QR</div>
      <div style="font-size: 6px; margin-top: 2px; word-break: break-all;">
        ${qrData}
      </div>
    </div>
  `;
};

export const printLabels = async (labels: Array<{sku: string, date: string, qty: string, lote: string}>) => {
  try {
    console.log(`🖨️  Enviando ${labels.length} etiqueta(s) a impresión...`);
    
    const response = await makeRequest('/api/print-labels', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ labels }),
    });

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.message);
    }
    
    console.log('✅ Etiquetas enviadas correctamente:', result.message);
    return result;
  } catch (error) {
    console.error('❌ Error imprimiendo etiquetas:', error);
    throw error;
  }
};

export const getAvailablePrinters = async () => {
  try {
    const response = await makeRequest('/api/printers');
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.message);
    }
    
    return result;
  } catch (error) {
    console.error('❌ Error obteniendo impresoras:', error);
    throw error;
  }
};

export const setDefaultPrinter = async (printerName: string) => {
  try {
    const response = await makeRequest('/api/set-default-printer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ printerName }),
    });

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.message);
    }
    
    return result;
  } catch (error) {
    console.error('❌ Error estableciendo impresora predeterminada:', error);
    throw error;
  }
};

export const generateQRCode = async (data: string) => {
  try {
    const response = await makeRequest('/api/generate-qr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data }),
    });

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.message);
    }
    
    return result.qrCode;
  } catch (error) {
    console.error('❌ Error generando QR:', error);
    throw error;
  }
};

export const incrementLote = (currentLote: string): string => {
  const loteNumber = parseInt(currentLote);
  return (loteNumber + 1).toString().padStart(4, '0');
};

// Inicializar detección de puerto al cargar el módulo
detectServerPort().catch(console.error);
