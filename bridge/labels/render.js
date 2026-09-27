// render.js — Etiquetas desde plantilla JSON (PLAN.md §11).
//
// Portado del bridge viejo (pdfkit + qrcode), pero ya no hay dos layouts
// fijos en codigo: cada SKU lleva su plantilla editable. Las dos de siempre
// (large y standard) son las plantillas por defecto, para que el arranque
// sea identico a lo que la gente conoce.
//
// Unidades en puntos (1/72"), como pdfkit. Origen arriba-izquierda.

import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "logo.png");

export const LABEL_SIZES = {
  large:    { w: 212.6, h: 141.7, name: "7.5 × 5 cm" },
  standard: { w: 93.6,  h: 72.0,  name: '1.3" × 1"' },
};

// ── Plantillas por defecto: reproducen exactamente las del bridge viejo ──
export const DEFAULT_TEMPLATES = {
  // 212,6 x 141,7 pt. El titulo iba a 18 pt en y=5, asi que terminaba en y=23 y
  // pisaba la linea de fecha (y=22). Ahora cada fila tiene su banda y el logo
  // tiene columna propia: el titulo ya no puede crecer por encima de el.
  large: {
    size: "large",
    vars: {},
    elements: [
      { type: "logo", x: 4,   y: 4,   w: 34 },
      { type: "text", x: 42,  y: 6,   w: 166, value: "{sku}",   size: 16, bold: true, align: "right" },
      { type: "text", x: 42,  y: 24,  w: 166, value: "{desc}",  size: 7,  align: "right" },
      { type: "line", x: 4,   y: 34,  w: 204.6, h: 0 },
      { type: "text", x: 6,   y: 38,  w: 100, value: "Fecha: {date}",   size: 7 },
      { type: "text", x: 6,   y: 47,  w: 100, value: "Lote: {lote}",    size: 7 },
      { type: "text", x: 6,   y: 56,  w: 100, value: "Cantidad: {qty}", size: 7 },
      { type: "text", x: 6,   y: 65,  w: 100, value: "Equipo: {unidad}", size: 7 },
      { type: "qr",   x: 130, y: 38,  w: 62,  value: "{qr}" },
      { type: "text", x: 6,   y: 122, w: 200.6, value: "{qr}", size: 7, align: "center" },
    ],
  },

  // Etiqueta del EQUIPO, no de la pieza: se pega en el modulo 32PO para que en
  // planta se sepa cual es sin abrir la app ni mirar la pantalla. El QR lleva
  // la unidad para poder leerla con el telefono.
  device: {
    size: "large",
    vars: {},
    // Sin esto hereda el formato de la etiqueta de pieza ({sku}.{date}.{qty}.
    // {lote}) y un dispositivo no tiene ni sku ni lote: las variables sin
    // resolver se imprimen tal cual, dentro del QR incluido.
    qr_format: "CT32.{unidad}.{mac}",
    elements: [
      { type: "logo", x: 4,   y: 4,   w: 34 },
      { type: "text", x: 42,  y: 6,   w: 166, value: "{modelo}",  size: 13, bold: true, align: "right" },
      { type: "text", x: 42,  y: 22,  w: 166, value: "Unidad {unidad}", size: 11, bold: true, align: "right" },
      { type: "line", x: 4,   y: 38,  w: 204.6, h: 0 },
      { type: "text", x: 6,   y: 42,  w: 120, value: "MAC: {mac}",       size: 7 },
      { type: "text", x: 6,   y: 51,  w: 120, value: "IP: {ip}",         size: 7 },
      { type: "text", x: 6,   y: 60,  w: 120, value: "Firmware: {fw}",   size: 7 },
      { type: "text", x: 6,   y: 69,  w: 120, value: "Canales: {canales}", size: 7 },
      { type: "text", x: 6,   y: 78,  w: 120, value: "Alta: {date}",     size: 7 },
      { type: "qr",   x: 130, y: 42,  w: 62,  value: "{qr}" },
      { type: "text", x: 6,   y: 122, w: 200.6, value: "{qr}", size: 7, align: "center" },
    ],
  },
  // 93,6 x 72 pt. Rediseñada: la anterior ponia el QR de 40 pt en y=40 (acaba
  // en 80) y una linea de texto en y=72, las dos fuera de una etiqueta de 72 pt.
  // Resultado: QR cortado por abajo y una pagina en blanco por etiqueta.
  standard: {
    size: "standard",
    vars: {},
    elements: [
      { type: "logo", x: 3,  y: 2,  w: 24 },
      { type: "text", x: 30, y: 3,  w: 60, value: "{sku}",             size: 10, bold: true, align: "right" },
      { type: "text", x: 3,  y: 20, w: 50, value: "{date}",            size: 6 },
      { type: "text", x: 3,  y: 28, w: 50, value: "Lote: {lote}",      size: 6 },
      { type: "text", x: 3,  y: 36, w: 50, value: "QTY: {qty}",        size: 7, bold: true },
      { type: "qr",   x: 57, y: 18, w: 33, value: "{qr}" },
      { type: "text", x: 3,  y: 52, w: 50, value: "{parcial}",         size: 6, bold: true },
      { type: "text", x: 3,  y: 63, w: 87.6, value: "{qr}",            size: 4.5, align: "center" },
    ],
  },
};

/** Sustituye {var} con los datos de la corrida + las vars de la plantilla. */
function fill(str, data) {
  return String(str ?? "").replace(/\{(\w+)\}/g, (_, k) => (data[k] ?? `{${k}}`));
}

/**
 * Escribe un texto que NO se sale de su caja.
 *
 * pdfkit con lineBreak:false no avisa de nada: el texto que no cabe se sale por
 * el borde y el PDF sale igual de "bien". Sobre etiqueta de 7,5 cm eso es un
 * SKU pisando el logo o un QR en texto cortado a media cadena, y en planta se
 * descubre cuando ya hay 200 impresas.
 *
 * MEDIDO con la plantilla anterior: "TODO-ARNES-GRANDE" a 18 pt ocupa 204,3 pt
 * de los 204,6 disponibles —a un caracter de romperse— y la linea del QR con un
 * lote con fecha se iba a 209,5 pt.
 *
 * Aqui se baja el cuerpo hasta que entre, y si ni en el minimo cabe se recorta
 * con puntos suspensivos. Recortado se VE; desbordado no.
 */
function textoQueCabe(doc, el, texto) {
  const ancho  = el.w;
  const fuente = el.bold ? "Helvetica-Bold" : "Helvetica";
  const base   = el.size || 8;
  // Suelo: por debajo de esto no es legible en etiqueta, mejor recortar.
  const min    = el.min_size ?? Math.max(5, base * 0.6);

  let pt = base;
  doc.font(fuente).fontSize(pt);
  while (doc.widthOfString(texto) > ancho && pt > min) {
    pt = Math.max(min, pt - 0.25);
    doc.fontSize(pt);
  }

  let final = texto;
  if (doc.widthOfString(final) > ancho) {
    while (final.length > 1 && doc.widthOfString(final + "…") > ancho) {
      final = final.slice(0, -1);
    }
    final += "…";
  }
  return final;
}

/**
 * El QR que REALMENTE lleva una etiqueta con esta plantilla.
 *
 * Existe para que quien registra la etiqueta en la base no vuelva a componer
 * la cadena por su cuenta: si la plantilla trae su propio qr_format —la de
 * equipo lo hace— recomponerlo a mano guarda un QR que no es el impreso, y
 * nadie lo nota hasta que alguien escanea una etiqueta y no cuadra con nada.
 */
export function qrDeEtiqueta(template, label) {
  const tpl = template || DEFAULT_TEMPLATES.large;
  const data = { ...(tpl.vars || {}), ...label };
  return fill(tpl.qr_format || "{sku}.{date}.{qty}.{lote}", data);
}

/**
 * Renderiza una o varias etiquetas a un PDF.
 * @param {object} template  plantilla JSON (o null → por defecto segun labelType)
 * @param {Array<{sku,date,qty,lote,[extra]}>} labels
 * @param {string} outPath  ruta del PDF a escribir
 */
export async function renderLabelsPdf(template, labels, outPath) {
  const tpl  = template || DEFAULT_TEMPLATES.large;
  const size = LABEL_SIZES[tpl.size] || LABEL_SIZES.large;
  const logo = fs.existsSync(LOGO_PATH) ? fs.readFileSync(LOGO_PATH) : null;

  const doc = new PDFDocument({ size: [size.w, size.h], margin: 0, autoFirstPage: false });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  for (const label of labels) {
    doc.addPage({ size: [size.w, size.h], margin: 0 });

    // Datos disponibles para {var}: los de la corrida, las vars del SKU, y {qr}
    const data = { ...(tpl.vars || {}), ...label };
    data.qr = qrDeEtiqueta(tpl, label);

    for (let el of tpl.elements || []) {
      // NADA se dibuja fuera de la pagina.
      //
      // pdfkit AÑADE UNA PAGINA cuando algo cae por debajo del borde inferior.
      // En pantalla eso es una hoja en blanco; en una impresora de rollo es una
      // ETIQUETA EN BLANCO por cada etiqueta buena — media bobina tirada y un
      // adhesivo vacio que el operador tiene que descartar a mano.
      //
      // MEDIDO: la plantilla standard por defecto tenia el QR en y=40 con 40 pt
      // de alto (acaba en 80) y una linea de texto en y=72, sobre una etiqueta
      // de 72 pt. Cada etiqueta salia en dos paginas, y el QR cortado por abajo.
      //
      // Se ajusta en vez de omitir: una etiqueta a la que le falta el QR se ve;
      // una pagina en blanco de mas pasa desapercibida hasta que se acaba el
      // rollo. El aviso queda en el log para poder arreglar la plantilla.
      // Las imagenes no paginan solas; se ajustan igual para que no salgan
      // cortadas por el borde.
      if (el.type === "qr" || el.type === "logo" || el.type === "line") {
        const alto = el.type === "line" ? (el.h ?? 0) : (el.w ?? 0);
        if (el.y + alto > size.h) {
          const y = Math.max(0, size.h - alto);
          console.warn(`[etiqueta] "${el.type}" en y=${el.y} se sale de ${size.h} pt; ` +
                       `se baja a y=${y.toFixed(1)}. Corrige la plantilla.`);
          el = { ...el, y };
        }
      }

      switch (el.type) {
        case "text": {
          const caja = { ...el, w: el.w ?? size.w - el.x };
          // textoQueCabe deja la fuente y el cuerpo ya ajustados en el doc.
          const txt = textoQueCabe(doc, caja, fill(el.value, data));

          // El texto se mide por ALTURA DE LINEA, no por cuerpo de fuente: la
          // linea ocupa mas que los puntos de la fuente. pdfkit inserta una
          // pagina en cuanto y + altura_de_linea pasa del borde, y en rollo eso
          // es una etiqueta en blanco. Se pregunta al propio pdfkit en vez de
          // estimar: una estimacion corta vuelve a paginar.
          const lh = doc.currentLineHeight(true);
          let y = el.y;
          if (y + lh > size.h) {
            y = Math.max(0, size.h - lh);
            console.warn(`[etiqueta] texto en y=${el.y} no cabe en ${size.h} pt; ` +
                         `se sube a y=${y.toFixed(1)}. Corrige la plantilla.`);
          }
          doc.text(txt, el.x, y, {
            width: caja.w, align: el.align || "left", lineBreak: false,
          });
          break;
        }
        case "qr": {
          const png = await QRCode.toBuffer(fill(el.value || "{qr}", data), {
            width: Math.round(el.w * 4), margin: 1, type: "png",
          });
          doc.image(png, el.x, el.y, { width: el.w, height: el.w });
          break;
        }
        case "logo": {
          if (logo) doc.image(logo, el.x, el.y, { width: el.w });
          break;
        }
        case "line": {
          doc.moveTo(el.x, el.y).lineTo(el.x + (el.w || 0), el.y + (el.h || 0)).stroke();
          break;
        }
      }
    }
  }

  doc.end();
  await new Promise((res, rej) => { stream.on("finish", res); stream.on("error", rej); });
  return outPath;
}

/** PNG de vista previa de UNA etiqueta (para el editor). Reusa el PDF y lo devuelve como base64. */
export async function previewLabelPdf(template, label, outPath) {
  await renderLabelsPdf(template, [label], outPath);
  return fs.readFileSync(outPath).toString("base64");
}
