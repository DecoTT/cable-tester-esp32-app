// routes/skus.js — SKUs, fixtures y jobs (goldens).

import { db, now, audit } from "../db.js";
import { DEFAULT_TEMPLATES } from "../labels/render.js";

export function registerSkuRoutes(app) {

  // ── SKUs ────────────────────────────────────────────────────
  app.get("/api/skus", (_req, res) => {
    const rows = db.prepare("SELECT * FROM skus ORDER BY codigo").all();
    res.json(rows.map(r => ({ ...r, label_template: r.label_template ? JSON.parse(r.label_template) : null })));
  });

  app.post("/api/skus", (req, res) => {
    const { codigo, descripcion = "", standard_pack = 10, labels_per_pack = 2,
            label_type = "large", label_template = null, actor = "sistema" } = req.body || {};
    if (!codigo) return res.json({ ok: false, error: "codigo requerido" });
    const tpl = label_template || DEFAULT_TEMPLATES[label_type] || DEFAULT_TEMPLATES.large;
    const t = now();
    db.prepare(`INSERT INTO skus(codigo, descripcion, standard_pack, labels_per_pack, label_type, label_template, active, created_at, updated_at)
                VALUES(?,?,?,?,?,?,1,?,?)
                ON CONFLICT(codigo) DO UPDATE SET descripcion=excluded.descripcion, standard_pack=excluded.standard_pack,
                  labels_per_pack=excluded.labels_per_pack, label_type=excluded.label_type,
                  label_template=excluded.label_template, updated_at=excluded.updated_at`)
      .run(String(codigo).toUpperCase(), descripcion, Number(standard_pack), Number(labels_per_pack),
           label_type, JSON.stringify(tpl), t, t);
    audit(actor, "sku.upsert", "sku", codigo, { descripcion, standard_pack, labels_per_pack, label_type });
    res.json({ ok: true });
  });

  app.delete("/api/skus/:codigo", (req, res) => {
    const { actor = "sistema" } = req.body || {};
    db.prepare("UPDATE skus SET active = 0, updated_at = ? WHERE codigo = ?").run(now(), req.params.codigo);
    audit(actor, "sku.deactivate", "sku", req.params.codigo);
    res.json({ ok: true });
  });

  // ── Fixtures ────────────────────────────────────────────────
  app.get("/api/skus/:codigo/fixtures", (req, res) => {
    const rows = db.prepare("SELECT * FROM fixtures WHERE sku = ? ORDER BY id").all(req.params.codigo);
    res.json(rows.map(r => ({ ...r, labels: JSON.parse(r.labels || "{}") })));
  });

  app.post("/api/skus/:codigo/fixtures", (req, res) => {
    const { id, nombre, labels = {}, actor = "sistema" } = req.body || {};
    if (!nombre) return res.json({ ok: false, error: "nombre requerido" });
    if (id) {
      db.prepare("UPDATE fixtures SET nombre = ?, labels = ? WHERE id = ? AND sku = ?")
        .run(nombre, JSON.stringify(labels), id, req.params.codigo);
      audit(actor, "fixture.update", "fixture", id, { nombre });
      return res.json({ ok: true, id });
    }
    const r = db.prepare("INSERT INTO fixtures(sku, nombre, labels, created_at) VALUES(?,?,?,?)")
      .run(req.params.codigo, nombre, JSON.stringify(labels), now());
    audit(actor, "fixture.create", "fixture", r.lastInsertRowid, { sku: req.params.codigo, nombre });
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  });

  // ── Jobs (goldens) ──────────────────────────────────────────
  app.get("/api/skus/:codigo/jobs", (req, res) => {
    const rows = db.prepare("SELECT * FROM jobs WHERE sku = ? ORDER BY id DESC").all(req.params.codigo);
    res.json(rows.map(r => ({
      ...r,
      nets: Array.from(r.nets),
      tester_macs: JSON.parse(r.tester_macs || "[]"),
      label_template: r.label_template ? JSON.parse(r.label_template) : null,
    })));
  });

  // Crear borrador desde un mapa capturado (nets = array de net_id por canal)
  app.post("/api/skus/:codigo/jobs", (req, res) => {
    const { nombre, fixture_id = null, nets, crc, tester_macs = [], notes = "", actor = "sistema" } = req.body || {};
    if (!Array.isArray(nets) || !nets.length) return res.json({ ok: false, error: "nets requerido" });
    const netsCount = Math.max(0, ...nets);
    const r = db.prepare(`INSERT INTO jobs(sku, fixture_id, nombre, channels, nets, nets_count, crc, tester_macs, status, captured_by, captured_at, notes)
                          VALUES(?,?,?,?,?,?,?,?,'draft',?,?,?)`)
      .run(req.params.codigo, fixture_id, nombre || `golden-${Date.now()}`, nets.length,
           Buffer.from(Uint8Array.from(nets)), netsCount, Number(crc || 0), JSON.stringify(tester_macs),
           actor, now(), notes);
    audit(actor, "job.capture", "job", r.lastInsertRowid, { sku: req.params.codigo, channels: nets.length, nets_count: netsCount, crc });
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  });

  // Aprobar: congela la plantilla de etiqueta del SKU en el job
  app.post("/api/jobs/:id/approve", (req, res) => {
    const { actor = "sistema" } = req.body || {};
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(req.params.id);
    if (!job) return res.json({ ok: false, error: "job no existe" });
    const sku = db.prepare("SELECT label_template FROM skus WHERE codigo = ?").get(job.sku);
    db.prepare("UPDATE jobs SET status = 'approved', approved_by = ?, approved_at = ?, label_template = ? WHERE id = ?")
      .run(actor, now(), sku?.label_template || null, job.id);
    audit(actor, "job.approve", "job", job.id, { sku: job.sku, crc: job.crc });
    res.json({ ok: true });
  });

  // ── Cierre del asistente ────────────────────────────────────
  //
  // Guarda TODO de una vez y de forma atómica: SKU, fixture, job aprobado y
  // vínculo con el tester. Así no puede quedar un SKU a medias — con job pero
  // sin tester asignado, o al revés — que en producción daría un rechazo
  // incomprensible para el operador.
  app.post("/api/wizard/commit", (req, res) => {
    const {
      sku, descripcion = "", standard_pack = 10, labels_per_pack = 2,
      label_type = "large", label_template = null,
      fixture_nombre = null, fixture_labels = null,
      job_nombre, nets, crc = 0, channels,
      tester_mac, tester_macs = [], notes = "", actor = "sistema",
    } = req.body || {};

    if (!sku)                      return res.json({ ok: false, error: "sku requerido" });
    if (!Array.isArray(nets) || !nets.length)
                                   return res.json({ ok: false, error: "nets requerido" });
    if (channels && channels !== nets.length)
      return res.json({ ok: false, error: `channels=${channels} no cuadra con ${nets.length} nets` });

    const t = now();
    const code = String(sku).toUpperCase();

    try {
      db.exec("BEGIN");

      const tpl = label_template || DEFAULT_TEMPLATES[label_type] || DEFAULT_TEMPLATES.large;
      db.prepare(`INSERT INTO skus(codigo, descripcion, standard_pack, labels_per_pack, label_type, label_template, active, created_at, updated_at)
                  VALUES(?,?,?,?,?,?,1,?,?)
                  ON CONFLICT(codigo) DO UPDATE SET descripcion=excluded.descripcion,
                    standard_pack=excluded.standard_pack, labels_per_pack=excluded.labels_per_pack,
                    label_type=excluded.label_type, label_template=excluded.label_template,
                    updated_at=excluded.updated_at`)
        .run(code, descripcion, Number(standard_pack), Number(labels_per_pack),
             label_type, JSON.stringify(tpl), t, t);

      let fixtureId = null;
      if (fixture_nombre) {
        const f = db.prepare("INSERT INTO fixtures(sku, nombre, labels, created_at) VALUES(?,?,?,?)")
          .run(code, fixture_nombre, JSON.stringify(fixture_labels || {}), t);
        fixtureId = Number(f.lastInsertRowid);
      }

      // Retirar goldens anteriores: un SKU tiene UN job vigente.
      db.prepare("UPDATE jobs SET status='retired' WHERE sku=? AND status='approved'").run(code);

      const netsCount = Math.max(0, ...nets);
      const j = db.prepare(`INSERT INTO jobs(sku, fixture_id, nombre, channels, nets, nets_count, crc,
                              tester_macs, label_template, status, captured_by, captured_at,
                              approved_by, approved_at, notes)
                            VALUES(?,?,?,?,?,?,?,?,?,'approved',?,?,?,?,?)`)
        .run(code, fixtureId, job_nombre || `golden-${Date.now()}`, nets.length,
             Buffer.from(Uint8Array.from(nets)), netsCount, Number(crc),
             JSON.stringify(tester_macs), JSON.stringify(tpl),
             actor, t, actor, t, notes);
      const jobId = Number(j.lastInsertRowid);

      if (tester_mac) {
        db.prepare("UPDATE tester_units SET sku_bound = ? WHERE mac = ?").run(code, tester_mac);
      }

      db.exec("COMMIT");
      audit(actor, "wizard.commit", "sku", code,
            { job_id: jobId, channels: nets.length, nets: netsCount, crc, tester_mac, tester_macs });
      res.json({ ok: true, sku: code, job_id: jobId, fixture_id: fixtureId });
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch {}
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/jobs/:id/retire", (req, res) => {
    const { actor = "sistema" } = req.body || {};
    db.prepare("UPDATE jobs SET status = 'retired' WHERE id = ?").run(req.params.id);
    audit(actor, "job.retire", "job", req.params.id);
    res.json({ ok: true });
  });
}
