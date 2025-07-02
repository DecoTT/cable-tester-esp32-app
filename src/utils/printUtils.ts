
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

export const printLabels = (labels: Array<{sku: string, date: string, qty: string, lote: string}>) => {
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
        ${labels.map(label => generateLabelHTML(label.sku, label.date, label.qty, label.lote)).join('')}
      </div>
    </body>
    </html>
  `;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.print();
      printWindow.close();
    };
  }
};

export const incrementLote = (currentLote: string): string => {
  const loteNumber = parseInt(currentLote);
  return (loteNumber + 1).toString().padStart(4, '0');
};
