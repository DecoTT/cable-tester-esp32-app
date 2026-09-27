// printer.js — Impresoras del SO. Portado del bridge viejo (probado con Zebra).
//
// Sin settings.printer_name nunca se llama a print(): el PDF se
// genera igual y la UI muestra la vista previa. Es el modo de desarrollo
// sin impresora, y tambien sirve para revisar antes de imprimir en planta.

import { exec } from "node:child_process";
import fs from "node:fs";

const isWin = process.platform === "win32";

function sh(cmd, timeout = 15000) {
  return new Promise((res, rej) =>
    exec(cmd, { timeout, windowsHide: true }, (e, out, err) => (e ? rej(new Error(err || e.message)) : res(out)))
  );
}

export async function listPrinters() {
  if (isWin) {
    // PowerShell en vez de wmic: wmic esta retirado en Windows 11 recientes.
    const out = await sh(`powershell -NoProfile -Command "Get-Printer | Select-Object Name,Default | ConvertTo-Json -Compress"`);
    let arr = [];
    try { const j = JSON.parse(out); arr = Array.isArray(j) ? j : [j]; } catch { arr = []; }
    return arr.map(p => ({ name: p.Name, isDefault: !!p.Default }));
  }
  const out = await sh("lpstat -p -d");
  const printers = out.split("\n").filter(l => l.startsWith("printer")).map(l => ({ name: l.split(" ")[1], isDefault: false }));
  const def = out.split("\n").find(l => l.startsWith("system default destination"))?.split(":")[1]?.trim();
  return printers.map(p => ({ ...p, isDefault: p.name === def }));
}

export async function printPdf(filePath, printerName) {
  if (!fs.existsSync(filePath)) throw new Error(`No existe ${filePath}`);
  if (!printerName) throw new Error("Sin impresora configurada");
  const escaped = filePath.replace(/'/g, "''");
  const pn = printerName.replace(/'/g, "''");
  if (isWin) {
    if (/pdf/i.test(printerName)) {
      await sh(`powershell -NoProfile -Command "Start-Process -FilePath '${escaped}' -Verb Print -Wait"`, 30000);
    } else {
      // Envio en crudo, como hacia el bridge viejo con Zebra
      await sh(`powershell -NoProfile -Command "Get-Content -LiteralPath '${escaped}' -Raw -Encoding Byte | Out-Printer -Name '${pn}'"`, 30000);
    }
  } else {
    await sh(`lp -d "${printerName}" "${filePath}"`, 30000);
  }
  return true;
}
