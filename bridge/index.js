// index.js — Bridge: UN proceso, UN puerto.
//
//   http://localhost:3001/          → la UI compilada (dist/)
//   http://localhost:3001/api/...   → API del bridge para la UI
//   ws  (socket.io)                 → eventos en vivo (testers, pruebas)
//
// El navegador NUNCA habla con el ESP32. Solo este proceso, y solo por el
// contrato JSON /api/* del firmware (docs/API.md del proyecto CableTester32).

import express from "express";
import http from "node:http";
import { Server as SocketIO } from "socket.io";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { db, getSetting, setSetting, audit, now, DATA_DIR } from "./db.js";
import { TesterClient, listTesterSerialPorts } from "./tester/client.js";
import { TesterDiscovery } from "./tester/discovery.js";
import { renderLabelsPdf, qrDeEtiqueta, DEFAULT_TEMPLATES, LABEL_SIZES } from "./labels/render.js";
import { listPrinters, printPdf } from "./labels/printer.js";
import { registerSkuRoutes }    from "./routes/skus.js";
import { registerTesterRoutes } from "./routes/testers.js";
import { registerMedidaRoutes } from "./routes/medida.js";
import { registerProduccionRoutes } from "./routes/produccion.js";
import { registrarDatosRoutes } from "./routes/datos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "..", "dist");
const PORT = Number(process.env.PORT || getSetting("bridge_port", "3001"));

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, { cors: { origin: "*" } });

app.use(cors());
// 2 MB sobra para todo... menos para importar una estacion entera: ese fichero
// lleva goldens e historial y se va a decenas de MB. Se excluye de este parser
// y la ruta de importacion pone el suyo, mas amplio.
app.use((req, res, next) =>
  req.path === "/api/datos/importar" ? next() : express.json({ limit: "2mb" })(req, res, next));

// ── Estado en memoria del bridge ─────────────────────────────
// Testers conocidos: clientes abiertos por MAC. La verdad persistente esta
// en la tabla tester_units; esto es solo la conexion viva.
const state = {
  clients: new Map(),   // mac → TesterClient
  discovered: [],       // ultima lista mDNS
};

const discovery = new TesterDiscovery((list) => {
  state.discovered = list;
  io.emit("testers:discovered", list);
});
discovery.start();

// ── Rutas ────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true, version: "0.1.0", api: 1,
    time: now(),
    print_enabled: !!getSetting("printer_name"),   // hay impresora elegida
    printer: getSetting("printer_name") || null,
    testers_connected: state.clients.size,
    testers_discovered: state.discovered.length,
  });
});

// Configuracion
app.get("/api/settings", (_req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});
app.put("/api/settings", (req, res) => {
  const { actor = "sistema", ...kv } = req.body || {};
  for (const [k, v] of Object.entries(kv)) setSetting(k, v);
  audit(actor, "settings.update", "settings", null, kv);
  res.json({ ok: true });
});

// Impresoras
app.get("/api/printers", async (_req, res) => {
  try { res.json({ ok: true, printers: await listPrinters() }); }
  catch (e) { res.json({ ok: false, error: e.message, printers: [] }); }
});

// Etiquetas: plantillas por defecto y vista previa
app.get("/api/labels/defaults", (_req, res) => res.json({ templates: DEFAULT_TEMPLATES, sizes: LABEL_SIZES }));
app.post("/api/labels/preview", async (req, res) => {
  try {
    const { template, label } = req.body || {};
    const out = path.join(DATA_DIR, "labels", `preview_${Date.now()}.pdf`);
    await renderLabelsPdf(template || null, [label || { sku: "SKU-DEMO", date: "20260921", qty: "10", lote: "0001" }], out);
    const b64 = fs.readFileSync(out).toString("base64");
    fs.unlink(out, () => {});
    res.json({ ok: true, pdf_base64: b64 });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Etiquetas: generar (y opcionalmente imprimir)
app.post("/api/labels/print", async (req, res) => {
  try {
    const { template, labels, actor = "sistema", lote_id = null } = req.body || {};
    if (!Array.isArray(labels) || !labels.length) return res.json({ ok: false, error: "sin etiquetas" });
    const file = `labels_${Date.now()}.pdf`;
    const out = path.join(DATA_DIR, "labels", file);
    await renderLabelsPdf(template || null, labels, out);

    // Si hay impresora elegida, se imprime. Si no, queda el PDF y ya.
    const printer = getSetting("printer_name") || null;
    let printed = false, printError = null;
    if (printer) {
      try { await printPdf(out, printer); printed = true; }
      catch (e) { printError = e.message; }
    }

    const ins = db.prepare("INSERT INTO labels(lote_id, sku, qty, qr_data, pdf_path, printer, printed, created_at) VALUES(?,?,?,?,?,?,?,?)");
    for (const l of labels) {
      // Una etiqueta de EQUIPO no tiene sku ni cantidad: identifica una unidad.
      // Sin esto, generarla reventaba al registrarla ("cannot be bound to
      // SQLite parameter 2"), con el PDF ya escrito en disco.
      const etiquetado = l.sku ?? (l.unidad ? `EQUIPO-${l.unidad}` : "SIN-SKU");
      const cantidad   = Number.isFinite(Number(l.qty)) ? Number(l.qty) : 0;
      ins.run(lote_id, etiquetado, cantidad, qrDeEtiqueta(template || null, l),
              out, printed ? printer : null, printed ? 1 : 0, now());
    }
    audit(actor, "labels.generate", "labels", file, { count: labels.length, printed, printer, printError });
    res.json({ ok: true, file, pdf_url: `/data/labels/${file}`, printed, printer, printError });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Auditoria
//
// Filtrable por fecha, actor y accion: "las ultimas 200 lineas" no sirve para
// responder a la pregunta que de verdad se hace, que es "quien aprobo ESE
// golden" o "quien cambio la configuracion el martes".
//
// Devuelve tambien la lista de actores y acciones presentes, para que la UI
// ofrezca solo lo que existe en vez de un catalogo inventado.
app.get("/api/audit", (req, res) => {
  const { desde, hasta, actor, accion, buscar } = req.query;
  const cond = [], args = [];
  if (desde)  { cond.push("ts >= ?");    args.push(desde); }
  if (hasta)  { cond.push("ts <= ?");    args.push(`${hasta}T23:59:59Z`); }
  if (actor)  { cond.push("actor = ?");  args.push(actor); }
  if (accion) { cond.push("action = ?"); args.push(accion); }
  if (buscar) {
    cond.push("(entity LIKE ? OR entity_id LIKE ? OR details LIKE ?)");
    const t = `%${buscar}%`;
    args.push(t, t, t);
  }
  const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
  const limit = Math.min(Number(req.query.limit || 200), 2000);

  res.json({
    registros: db.prepare(`SELECT * FROM audit ${where} ORDER BY id DESC LIMIT ?`).all(...args, limit),
    actores:  db.prepare("SELECT DISTINCT actor  FROM audit ORDER BY actor").all().map((r) => r.actor),
    acciones: db.prepare("SELECT DISTINCT action FROM audit ORDER BY action").all().map((r) => r.action),
    total:    db.prepare(`SELECT COUNT(*) c FROM audit ${where}`).get(...args).c,
  });
});

registerSkuRoutes(app);
registerTesterRoutes(app, { state, discovery, io, TesterClient, listTesterSerialPorts });
registerMedidaRoutes(app, io);
registerProduccionRoutes(app, io, { discovery });
registrarDatosRoutes(app);

// PDFs generados, servidos para vista previa
app.use("/data/labels", express.static(path.join(DATA_DIR, "labels")));

// ── UI compilada ─────────────────────────────────────────────
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get("*", (_req, res) => res.sendFile(path.join(DIST, "index.html")));
} else {
  app.get("/", (_req, res) => res.type("text").send(
    "UI no compilada. Ejecuta `npm run build` para produccion, o `npm run dev` para desarrollo (UI en :8080).\n"));
}

// ── WebSocket ────────────────────────────────────────────────
io.on("connection", (sock) => {
  sock.emit("testers:discovered", state.discovered);
  sock.emit("testers:connected", Array.from(state.clients.keys()));
});

// ── Arranque / cierre ────────────────────────────────────────
server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Cable Tester 32CH — bridge`);
  console.log(`  UI/API : http://localhost:${PORT}/`);
  console.log(`  UI     : ${fs.existsSync(DIST) ? "compilada (dist/)" : "SIN compilar — usa npm run dev"}`);
  console.log(`  Print  : ${getSetting("printer_name") || "sin impresora (solo PDF)"}
`);
  audit("sistema", "bridge.start", "bridge", null, { port: PORT });
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    discovery.stop();
    for (const c of state.clients.values()) c.close();
    audit("sistema", "bridge.stop", "bridge");
    process.exit(0);
  });
}
