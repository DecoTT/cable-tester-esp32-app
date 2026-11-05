// datos.js — Exportar e importar la estación entera en un fichero.
//
// POR QUE EXISTE
//
// El código se distribuye por git, pero los datos NO: SKUs de cliente, goldens,
// mapas de socket, historial de producción y nombres de operadores no tienen
// por qué acabar en un repositorio. Y aun así la estación de planta necesita
// todo eso para funcionar el primer día.
//
// Asi que van por separado: se clona el repo, se ejecuta setup.bat, y se
// importa UN fichero .ct32.json con lo que aqui se exporta.
//
// QUE LLEVA Y QUE NO
//
// Lleva lo que cuesta reconstruir: skus, jobs (con su golden), dispositivos,
// operadores, fixtures de socket, ajustes, y opcionalmente el historial de
// producción (lotes, pruebas, etiquetas, auditoría).
//
// NO lleva:
//  - Los PDFs de etiquetas ya generados. Se regeneran solos y pesan.
//  - printer_name ni bridge_port. Son de LA MAQUINA, no del producto: importar
//    el nombre de una impresora que no existe en la otra PC deja la estación
//    imprimiendo al vacío sin decir nada.
//
// LOS GOLDEN VAN DENTRO DEL FICHERO, no por referencia. Un job sin su golden no
// puede juzgar ninguna pieza, y son ficheros sueltos en disco: si se exportara
// solo el nombre, la importación dejaría jobs que fallan al primer uso.

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { db, DATA_DIR, audit, now } from "../db.js";

const GOLD_DIR = path.join(DATA_DIR, "goldens");
const FIX_DIR  = path.join(DATA_DIR, "fixtures");

// Ajustes que describen la MAQUINA, no el producto. Ver cabecera.
// print_enabled es de una version anterior (ya no existe el interruptor); se
// ignora para que un valor viejo no viaje a la estacion nueva.
const AJUSTES_LOCALES = new Set(["printer_name", "bridge_port", "print_enabled"]);

const FORMATO = "cabletester32/export";
const VERSION = 1;

/** Tablas del "catálogo": lo que define qué se produce y con qué. */
const TABLAS_CATALOGO = ["skus", "jobs", "tester_units", "operators", "fixtures"];
/** Tablas de historial: lo que ya se produjo. Va aparte porque es opcional. */
const TABLAS_HISTORIAL = ["lotes", "tests", "labels", "audit"];

// ── Binarios ───────────────────────────────────────────────────────────────
//
// jobs.nets es un BLOB: 32 bytes, un byte por canal. JSON.stringify convierte
// un Uint8Array en {"0":1,"1":0,...}, que al volver ya NO se puede escribir en
// la base — y el fallo aparece al importar, lejos de donde se causo.
//
// MEDIDO: la primera version de esta exportacion generaba un fichero de aspecto
// perfecto que al importarse moria con "cannot be bound to SQLite parameter 6".
// Por eso los binarios van marcados y en base64, no a merced del JSON.
const MARCA_BLOB = "__blob_b64";

function aJson(v) {
  return v instanceof Uint8Array
    ? { [MARCA_BLOB]: Buffer.from(v).toString("base64") }
    : v;
}

function deJson(v) {
  return v && typeof v === "object" && typeof v[MARCA_BLOB] === "string"
    ? new Uint8Array(Buffer.from(v[MARCA_BLOB], "base64"))
    : v;
}

function leerJsonDir(dir) {
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try { out[f.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); }
    catch { /* un fichero corrupto no puede tumbar la exportación entera */ }
  }
  return out;
}

function escribirJsonDir(dir, mapa) {
  if (!mapa) return 0;
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const [id, datos] of Object.entries(mapa)) {
    // El id viene de un fichero externo: sin esto, un nombre como
    // "../../bridge/index" escribiria fuera de data/.
    const limpio = path.basename(String(id)).replace(/[^\w.-]/g, "_");
    if (!limpio || limpio === "." || limpio === "..") continue;
    fs.writeFileSync(path.join(dir, `${limpio}.json`), JSON.stringify(datos, null, 2), "utf8");
    n++;
  }
  return n;
}

/**
 * Armar la exportacion. Todo por defecto; con `skus` solo esos productos.
 *
 * Exportar por partes hace falta porque ya se trabaja en varias PC y muchas
 * veces solo hay que pasar UN job —el de un subensamble nuevo— sin arrastrar
 * el catalogo entero ni la produccion de la otra estacion.
 *
 * Los equipos (tester_units) van SIEMPRE, aunque se filtre: sin ellos la
 * estacion de destino no puede resolver por MAC las unidades del job, que es
 * justo lo que hace que el job funcione en otra red.
 */
export function construirExport({ historial = true, skus = null } = {}) {
  const filtro = Array.isArray(skus) && skus.length ? new Set(skus) : null;

  // Jobs de esos SKUs -> sus goldens -> los fixtures de esos goldens. Se sigue
  // la cadena en vez de adivinar por el nombre: un golden puede apuntar a un
  // fixture que no se llame como el SKU.
  const golds = leerJsonDir(GOLD_DIR);
  const fixs  = leerJsonDir(FIX_DIR);
  let goldensSel = golds, fixturesSel = fixs;

  if (filtro) {
    const nombres = new Set(
      db.prepare("SELECT DISTINCT golden FROM jobs WHERE golden IS NOT NULL").all()
        .map((r) => r.golden)
        .filter((g) => db.prepare(
          "SELECT 1 FROM jobs WHERE golden = ? AND sku IN (" +
          [...filtro].map(() => "?").join(",") + ") LIMIT 1").get(g, ...filtro)));
    goldensSel = Object.fromEntries(Object.entries(golds).filter(([k]) => nombres.has(k)));
    const usados = new Set(Object.values(goldensSel).map((g) => g?.fixture).filter(Boolean));
    fixturesSel  = Object.fromEntries(Object.entries(fixs).filter(([k]) => usados.has(k)));
  }

  // Que columna de cada tabla dice a que SKU pertenece la fila. `labels` no
  // tiene ninguna: cuelga del lote, asi que se filtra por los lotes elegidos.
  const COL_SKU = { skus: "codigo", jobs: "sku", fixtures: "sku", lotes: "sku", tests: "sku" };

  const tablas = {};
  for (const t of [...TABLAS_CATALOGO, ...(historial ? TABLAS_HISTORIAL : [])]) {
    let filas = db.prepare(`SELECT * FROM ${t}`).all();
    if (filtro) {
      const col = COL_SKU[t];
      if (col) filas = filas.filter((f) => filtro.has(f[col]));
      else if (t === "labels") {
        const lotes = new Set((tablas.lotes ?? []).map((l) => l.id));
        filas = filas.filter((f) => lotes.has(f.lote_id));
      } else if (t === "audit") {
        // La auditoria es de la estacion, no del producto: con filtro no viaja.
        filas = [];
      }
      // tester_units y operators van enteros a proposito.
    }
    tablas[t] = filas.map((fila) => Object.fromEntries(
      Object.entries(fila).map(([k, v]) => [k, aJson(v)])));
  }

  const ajustes = {};
  for (const r of db.prepare("SELECT key, value FROM settings").all()) {
    if (!AJUSTES_LOCALES.has(r.key)) ajustes[r.key] = r.value;
  }

  return {
    formato: FORMATO,
    version: VERSION,
    creado: now(),
    origen: process.env.COMPUTERNAME || process.env.HOSTNAME || "desconocido",
    incluye_historial: historial,
    solo_skus: filtro ? [...filtro] : null,
    ajustes,
    tablas,
    goldens:  goldensSel,
    fixtures: fixturesSel,
  };
}

export function registrarDatosRoutes(app) {
  // ── Qué hay ahora mismo, para enseñarlo antes de exportar ──
  app.get("/api/datos/resumen", (_req, res) => {
    const cuenta = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    res.json({
      ok: true,
      catalogo:  Object.fromEntries(TABLAS_CATALOGO.map((t) => [t, cuenta(t)])),
      historial: Object.fromEntries(TABLAS_HISTORIAL.map((t) => [t, cuenta(t)])),
      goldens:  Object.keys(leerJsonDir(GOLD_DIR)).length,
      fixtures: Object.keys(leerJsonDir(FIX_DIR)).length,
    });
  });

  // ── Exportar: un fichero, descarga directa ──
  app.get("/api/datos/exportar", (req, res) => {
    try {
      const historial = req.query.historial !== "0";
      const skus = String(req.query.skus || "").split(",").map((x) => x.trim()).filter(Boolean);
      const bundle = construirExport({ historial, skus });
      const fecha = new Date().toISOString().slice(0, 10);
      audit("datos", "exportar", "datos", null,
            { historial, skus: bundle.tablas.skus.length, jobs: bundle.tablas.jobs.length });
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition",
                    `attachment; filename="cabletester32-${fecha}.ct32.json"`);
      res.send(JSON.stringify(bundle, null, 2));
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Importar ──
  //
  // Antes de tocar nada se copia la base. Importar es destructivo por diseño
  // —reemplaza filas por clave primaria— y sin copia previa un fichero
  // equivocado se lleva por delante la producción de la estación.
  // Parser propio: el global se queda en 2 MB y un fichero con historial pasa
  // de eso de largo. El bridge solo escucha en 127.0.0.1, asi que el limite
  // amplio no abre nada al exterior.
  app.post("/api/datos/importar", express.json({ limit: "256mb" }), (req, res) => {
    const bundle = req.body;
    if (!bundle || bundle.formato !== FORMATO) {
      return res.status(400).json({
        ok: false,
        error: "Esto no es un fichero de exportación del Cable Tester 32.",
      });
    }
    if (Number(bundle.version) > VERSION) {
      return res.status(400).json({
        ok: false,
        error: `El fichero es de una versión más nueva (v${bundle.version}) que esta app (v${VERSION}). Actualiza la app antes de importar.`,
      });
    }

    let respaldo = null;
    try {
      const dir = path.join(DATA_DIR, "backups");
      fs.mkdirSync(dir, { recursive: true });
      respaldo = path.join(dir, `antes-de-importar-${Date.now()}.db`);
      db.exec(`VACUUM INTO '${respaldo.replace(/'/g, "''")}'`);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: `No se pudo respaldar la base antes de importar: ${e.message}. No se ha tocado nada.`,
      });
    }

    const resumen = {};
    try {
      // Todo o nada: si una tabla falla a mitad, lo ya escrito se deshace. Una
      // importación a medias es peor que ninguna, porque parece que funcionó.
      db.exec("BEGIN");
      // INSERT OR REPLACE borra la fila y la vuelve a insertar. Con claves
      // ajenas activas (lo estan) reemplazar un SKU que ya tiene jobs falla en
      // el borrado, aunque acto seguido se reinserte identico. Diferir la
      // comprobacion al COMMIT deja que el estado intermedio exista: al final
      // de la transaccion todo vuelve a cuadrar, y si no cuadra, no hay COMMIT.
      db.exec("PRAGMA defer_foreign_keys = ON");

      // Los JOBS no se pueden importar por id.
      //
      // La clave de jobs es un id autoincremental, o sea un numero de fila, no
      // el contenido. Con dos PCs trabajando a la vez eso rompe de dos formas:
      // el job 6 de una pisa el job 6 de la otra aunque sean de SKUs distintos,
      // y el mismo producto con id diferente en cada maquina entra DOS VECES y
      // deja dos jobs aprobados para un solo SKU.
      //
      // Lo que identifica de verdad a un job es su SKU y su huella: misma
      // receta sobre el mismo cableado. Si ya esta, se actualiza en su sitio;
      // si no, entra con id nuevo. Y despues se garantiza uno aprobado por SKU.
      const jobsDelFichero = Array.isArray(bundle.tablas?.jobs) ? bundle.tablas.jobs : [];
      const colsJob = db.prepare("PRAGMA table_info(jobs)").all().map((c) => c.name);
      let jobsNuevos = 0, jobsActualizados = 0;
      for (const j of jobsDelFichero) {
        const ya = db.prepare("SELECT id FROM jobs WHERE sku = ? AND huella IS ? AND golden IS ?")
                     .get(j.sku, j.huella ?? null, j.golden ?? null);
        const usadas = colsJob.filter((c) => c in j && c !== "id");
        if (ya) {
          db.prepare(`UPDATE jobs SET ${usadas.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
            .run(...usadas.map((c) => deJson(j[c]) ?? null), ya.id);
          jobsActualizados++;
        } else {
          db.prepare(`INSERT INTO jobs(${usadas.join(",")}) VALUES(${usadas.map(() => "?").join(",")})`)
            .run(...usadas.map((c) => deJson(j[c]) ?? null));
          jobsNuevos++;
        }
      }
      // Un SKU no puede tener dos jobs aprobados: no se sabria contra cual se
      // valido una pieza. Se deja el mas reciente y los demas se RETIRAN, no se
      // borran — la trazabilidad de lo ya producido tiene que seguir en pie.
      const retirados = db.prepare(`
        UPDATE jobs SET status = 'retired'
        WHERE status = 'approved' AND id NOT IN (
          SELECT id FROM jobs j2 WHERE j2.status = 'approved' AND j2.sku = jobs.sku
          ORDER BY j2.approved_at DESC, j2.id DESC LIMIT 1)
      `).run().changes;
      resumen.jobs = { nuevos: jobsNuevos, actualizados: jobsActualizados, retirados };

      for (const t of [...TABLAS_CATALOGO, ...TABLAS_HISTORIAL]) {
        if (t === "jobs") continue;              // ya tratados arriba, por SKU+huella
        const filas = bundle.tablas?.[t];
        if (!Array.isArray(filas) || !filas.length) continue;
        const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
        const usadas = cols.filter((c) => c in filas[0]);
        if (!usadas.length) continue;
        const sql = `INSERT OR REPLACE INTO ${t}(${usadas.join(",")}) ` +
                    `VALUES(${usadas.map(() => "?").join(",")})`;
        const ins = db.prepare(sql);
        for (const f of filas) ins.run(...usadas.map((c) => deJson(f[c]) ?? null));
        resumen[t] = filas.length;
      }

      for (const [k, v] of Object.entries(bundle.ajustes || {})) {
        if (AJUSTES_LOCALES.has(k)) continue;   // los de la maquina no se pisan
        db.prepare("INSERT INTO settings(key,value) VALUES(?,?) " +
                   "ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v));
      }

      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* ya deshecho */ }
      return res.status(500).json({
        ok: false,
        error: `Importación cancelada: ${e.message}. La base quedó como estaba; copia en ${path.basename(respaldo)}.`,
      });
    }

    // Los ficheros van fuera de la transaccion: SQLite no los cubre.
    resumen.goldens  = escribirJsonDir(GOLD_DIR, bundle.goldens);
    resumen.fixtures = escribirJsonDir(FIX_DIR,  bundle.fixtures);

    audit("datos", "importar", "datos", null,
          { origen: bundle.origen, creado: bundle.creado, ...resumen });

    res.json({
      ok: true,
      respaldo: path.basename(respaldo),
      origen: bundle.origen ?? null,
      creado: bundle.creado ?? null,
      resumen,
    });
  });
}
