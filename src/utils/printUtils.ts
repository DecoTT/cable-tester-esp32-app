
const SERVER_URL = 'http://localhost:3001';

export const generateLabelHTML = (sku: string, date: string, qty: string, lote: string) => {
  const qrData = `${sku}+${date}+${qty}+${lote}`;
  
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
      <div style="
        border: 1px solid #666;
        width: 40px;
        height: 40px;
        margin: 0 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 6px;
        background: #f0f0f0;
      ">QR</div>
      <div style="font-size: 6px; margin-top: 1px; word-break: break-all;">
        ${qrData}
      </div>
    </div>
  `;
};

export const printLabels = async (labels: Array<{sku: string, date: string, qty: string, lote: string}>) => {
  try {
    const response = await fetch(`${SERVER_URL}/api/print-labels`, {
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
    
    return result;
  } catch (error) {
    console.error('Error imprimiendo etiquetas:', error);
    throw error;
  }
};

export const getAvailablePrinters = async () => {
  try {
    const response = await fetch(`${SERVER_URL}/api/printers`);
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.message);
    }
    
    return result;
  } catch (error) {
    console.error('Error obteniendo impresoras:', error);
    throw error;
  }
};

export const setDefaultPrinter = async (printerName: string) => {
  try {
    const response = await fetch(`${SERVER_URL}/api/set-default-printer`, {
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
    console.error('Error estableciendo impresora predeterminada:', error);
    throw error;
  }
};

export const generateQRCode = async (data: string) => {
  try {
    const response = await fetch(`${SERVER_URL}/api/generate-qr`, {
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
    console.error('Error generando QR:', error);
    throw error;
  }
};

export const incrementLote = (currentLote: string): string => {
  const loteNumber = parseInt(currentLote);
  return (loteNumber + 1).toString().padStart(4, '0');
};
