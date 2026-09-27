// lote.js — Etiquetas de un lote.
//
// REGLA: el PDF se guarda SIEMPRE, se imprima o no.
//
// Una impresora sin papel, apagada o con un driver caído no puede hacer que se
// pierda la trazabilidad de un lote ya producido. Guardando el PDF primero, el
// fallo de impresión pasa de ser un problema a ser una molestia: se reimprime
// cuando la impresora vuelva, con exactamente el mismo contenido.
//
// Por eso el orden es: generar → guardar → registrar en DB → intentar imprimir.
// Si se invirtiera y la impresión fallara a mitad, quedaría un lote cerrado sin
// etiqueta y sin forma de saber qué decía.

import path from "node:path";
import fs from "node:fs";
import { renderLabelsPdf, DEFAULT_TEMPLATES } from "./render.js";
import { printPdf } from "./printer.js";
import { db, now, todayYMD, audit, getSetting, DATA_DIR } from "../db.js";

const LBL_DIR = path.join(DATA_DIR, "labels");

/**
 * Contenido del QR de trazabilidad.
 *
 * Lleva SKU, fecha, lote y cantidad porque una etiqueta suelta tiene que poder
 * identificarse sin acceso a la base: en planta las bolsas se separan.
 */
export function qrDeLote(sku, fecha, lote, qty) {
  return `${sku}|${fecha}|L${lote}|Q${qty}`;
}

/**
 * Cuántas etiquetas y de qué cantidad, a partir del standard pack.
 *
 * El último paquete casi nunca queda completo. Se etiqueta con su cantidad REAL,
 * no con la del pack: una bolsa que dice 10 y trae 7 es un problema en recepción
 * del cliente.
 */
export function repartirEnPaquetes(cantidad, standardPack) {
  const p = Math.max(1, Number(standardPack) || 1);
  const out = [];
  let quedan = Math.max(0, Number(cantidad) || 0);
  while (quedan > 0) {
    const q = Math.min(p, quedan);
    out.push({ qty: q, parcial: q < p });
    quedan -= q;
  }
  return out;
}

/**
 * Genera (y opcionalmente imprime) las etiquetas de un lote.
 * @param {string} loteId
 * @param {{actor?:string, soloBuenos?:boolean, reimprimir?:boolean}} opts
 */
export async function etiquetasDeLote(loteId, opts = {}) {
  const { actor = "sistema", soloBuenos = true, reimprimir = false } = opts;

  const lote = db.prepare("SELECT * FROM lotes WHERE id = ?").get(loteId);
  if (!lote) throw new Error(`lote ${loteId} no existe`);

  const sku = db.prepare("SELECT * FROM skus WHERE codigo = ?").get(lote.sku);
  if (!sku) throw new Error(`SKU ${lote.sku} no existe`);

  // Se etiquetan las piezas BUENAS, no el total: las rechazadas no salen de
  // planta. Se deja configurable por si algún cliente pide otra cosa.
  const cantidad = soloBuenos ? lote.buenos : lote.cantidad;
  if (cantidad <= 0) throw new Error(`el lote ${loteId} no tiene piezas buenas que etiquetar`);

  let paquetes = repartirEnPaquetes(cantidad, sku.standard_pack);

  // Las bolsas que YA salieron solas al completarse no se vuelven a etiquetar.
  //
  // Con la etiqueta automatica activada, cerrar un lote de 20 con pack de 10
  // regeneraria las dos bolsas completas: cuatro etiquetas para dos bolsas, y
  // en recepcion eso son piezas contadas dos veces. Al cerrar solo queda
  // pendiente lo que falte — normalmente la bolsa incompleta.
  //
  // Una reimpresion SI rehace todo: para eso se pide.
  if (!reimprimir) {
    const pack = Math.max(1, Number(sku.standard_pack) || 1);
    let yaHechas = db.prepare(
      "SELECT COUNT(*) c FROM labels WHERE lote_id = ? AND qty = ?"
    ).get(lote.id, pack).c;
    paquetes = paquetes.filter((p) => {
      if (p.qty === pack && yaHechas > 0) { yaHechas--; return false; }
      return true;
    });
    if (!paquetes.length) {
      audit(actor, "etiqueta.nada", lote.sku, lote.id,
            `${cantidad} buenas, todas las bolsas ya estaban etiquetadas`);
      return {
        lote: lote.id, sku: lote.sku, cantidad, paquetes: 0, etiquetas: 0,
        parciales: 0, pdf: null, pdf_url: null, impreso: false,
        impresora: null, error_impresion: null,
        nota: "todas las bolsas ya tenían etiqueta",
      };
    }
  }

  const porPaquete = Math.max(1, Number(sku.labels_per_pack) || 1);

  // La plantilla se congela con la etiqueta: si mañana se cambia el diseño, una
  // reimpresión tiene que salir IGUAL que el original.
  const plantilla = sku.label_template
    ? JSON.parse(sku.label_template)
    : DEFAULT_TEMPLATES[sku.label_type] ?? DEFAULT_TEMPLATES.large;

  const etiquetas = [];
  for (const p of paquetes) {
    const qr = qrDeLote(lote.sku, lote.fecha, lote.id, p.qty);
    for (let i = 0; i < porPaquete; i++) {
      etiquetas.push({
        sku: lote.sku, date: lote.fecha, lote: lote.id,
        qty: String(p.qty), qr,
        operador: lote.operador,
        parcial: p.parcial ? "PARCIAL" : "",
      });
    }
  }

  if (!fs.existsSync(LBL_DIR)) fs.mkdirSync(LBL_DIR, { recursive: true });
  const sello = reimprimir ? `_re${Date.now()}` : "";
  const pdf = path.join(LBL_DIR, `lote_${lote.id}_${lote.sku}${sello}.pdf`);

  // 1. Generar y guardar. Esto va PRIMERO, pase lo que pase con la impresora.
  await renderLabelsPdf(plantilla, etiquetas, pdf);

  // 2. Registrar. Una fila por paquete, con su QR: así se puede reimprimir una
  //    bolsa concreta sin rehacer el lote entero.
  const ins = db.prepare(`
    INSERT INTO labels(lote_id, sku, qty, qr_data, pdf_path, printer, printed, created_at)
    VALUES(?,?,?,?,?,?,?,?)
  `);
  const ts = now();
  const impresora = getSetting("printer_name") || null;
  for (const p of paquetes) {
    ins.run(lote.id, lote.sku, p.qty, qrDeLote(lote.sku, lote.fecha, lote.id, p.qty),
            pdf, impresora, 0, ts);
  }

  // 3. Intentar imprimir. Si falla, el PDF ya está a salvo.
  //    Sin impresora elegida no se imprime: la eleccion ES el interruptor.
  let impreso = false, errorImpresion = null;
  if (impresora) {
    try {
      await printPdf(pdf, impresora);
      impreso = true;
      db.prepare("UPDATE labels SET printed = 1 WHERE lote_id = ? AND pdf_path = ?")
        .run(lote.id, pdf);
    } catch (e) {
      errorImpresion = String(e?.message ?? e);
    }
  }

  audit("etiqueta", reimprimir ? "reimpresa" : "generada", lote.sku, lote.id,
        `${etiquetas.length} etiqueta(s), ${paquetes.length} paquete(s)` +
        (impreso ? ` · impresas en ${impresora}` : ` · SIN imprimir`) +
        (errorImpresion ? ` (${errorImpresion})` : ""));

  return {
    lote: lote.id, sku: lote.sku,
    cantidad, paquetes: paquetes.length, etiquetas: etiquetas.length,
    parciales: paquetes.filter((p) => p.parcial).length,
    pdf, pdf_url: `/api/labels/file/${path.basename(pdf)}`,
    impreso, impresora,
    error_impresion: errorImpresion,
  };
}

/**
 * Etiqueta los packs COMPLETOS que aun no tienen etiqueta.
 *
 * COMO FUNCIONA EL PROCESO EN PLANTA
 *
 * El operador separa el material bueno del malo; la app no necesita saber que
 * pieza es cual. Lo unico que cuenta es cuantas BUENAS lleva el lote: si el
 * standard pack es 10 y se probaron 12 con 2 malas, al llegar a 10 buenas sale
 * la etiqueta de esa bolsa.
 *
 * Por eso se cuentan packs completos y se compara con los ya etiquetados: sin
 * eso, llamar a esto dos veces generaria la etiqueta de la primera bolsa otra
 * vez, y una bolsa con dos etiquetas identicas es una bolsa contada dos veces
 * en recepcion.
 *
 * La bolsa INCOMPLETA no se etiqueta aqui: espera al cierre del lote, que es
 * cuando se sabe que ya no van a entrar mas piezas.
 */
export async function etiquetarPacksCompletos(loteId, { actor = "sistema" } = {}) {
  const lote = db.prepare("SELECT * FROM lotes WHERE id = ?").get(loteId);
  if (!lote) return null;
  const sku = db.prepare("SELECT * FROM skus WHERE codigo = ?").get(lote.sku);
  if (!sku) return null;

  const pack = Math.max(1, Number(sku.standard_pack) || 1);
  const debidos = Math.floor((Number(lote.buenos) || 0) / pack);
  const hechos  = db.prepare(
    "SELECT COUNT(*) c FROM labels WHERE lote_id = ? AND qty = ?"
  ).get(lote.id, pack).c;

  const faltan = debidos - hechos;
  if (faltan <= 0) return null;

  const porPaquete = Math.max(1, Number(sku.labels_per_pack) || 1);
  const plantilla = sku.label_template
    ? JSON.parse(sku.label_template)
    : DEFAULT_TEMPLATES[sku.label_type] ?? DEFAULT_TEMPLATES.large;

  const qr = qrDeLote(lote.sku, lote.fecha, lote.id, pack);
  const etiquetas = [];
  for (let k = 0; k < faltan; k++) {
    for (let i = 0; i < porPaquete; i++) {
      etiquetas.push({
        sku: lote.sku, date: lote.fecha, lote: lote.id,
        qty: String(pack), qr, operador: lote.operador, parcial: "",
      });
    }
  }

  if (!fs.existsSync(LBL_DIR)) fs.mkdirSync(LBL_DIR, { recursive: true });
  const pdf = path.join(LBL_DIR, `lote_${lote.id}_${lote.sku}_pack${hechos + faltan}.pdf`);

  // Igual que al cerrar: generar y guardar PRIMERO, imprimir despues.
  await renderLabelsPdf(plantilla, etiquetas, pdf);

  const ins = db.prepare(`
    INSERT INTO labels(lote_id, sku, qty, qr_data, pdf_path, printer, printed, created_at)
    VALUES(?,?,?,?,?,?,?,?)
  `);
  const ts = now();
  const impresora = getSetting("printer_name") || null;
  for (let k = 0; k < faltan; k++) ins.run(lote.id, lote.sku, pack, qr, pdf, impresora, 0, ts);

  let impreso = false, errorImpresion = null;
  if (impresora) {
    try {
      await printPdf(pdf, impresora);
      impreso = true;
      db.prepare("UPDATE labels SET printed = 1 WHERE lote_id = ? AND pdf_path = ?").run(lote.id, pdf);
    } catch (e) { errorImpresion = String(e?.message ?? e); }
  }

  audit(actor, "etiqueta.pack", lote.sku, lote.id,
        `${faltan} bolsa(s) de ${pack} · ${lote.buenos} buenas` +
        (impreso ? ` · impresas en ${impresora}` : " · SIN imprimir"));

  return {
    lote: lote.id, sku: lote.sku, packs: faltan, piezas_por_pack: pack,
    buenos: lote.buenos, etiquetas: etiquetas.length,
    pdf, pdf_url: `/api/labels/file/${path.basename(pdf)}`,
    impreso, impresora, error_impresion: errorImpresion,
  };
}

export function historialEtiquetas(loteId) {
  return loteId
    ? db.prepare("SELECT * FROM labels WHERE lote_id = ? ORDER BY id DESC").all(loteId)
    : db.prepare("SELECT * FROM labels ORDER BY id DESC LIMIT 200").all();
}
