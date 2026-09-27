// medida.js — Rutas del motor de medida y del validador de socket.
//
// El navegador NUNCA habla con el ESP32: solo con estas rutas. Toda la medida
// ocurre aqui, en el bridge.

import path from "node:path";
import fs from "node:fs";
import {
  abrirUnidades, barrer, construirNets, huella, chName, totalCanales,
  medirResistencias, validarModulos, clasificarAislado,
  RC_OK, RC_WARN,
} from "../measure.js";
import {
  SesionSocket, listarFixtures, cargarFixture, guardarFixture,
  nombreFisico, describirLinea,
} from "../fixture.js";
import { DATA_DIR, audit, db, now } from "../db.js";

const GOLD_DIR = path.join(DATA_DIR, "goldens");

// Estado vivo: las unidades abiertas y la sesion de socket en curso.
const vivo = { units: [], hosts: [], sesion: null, ocupado: false };

function pares(nets) {
  const s = new Set();
  for (const net of nets) {
    for (let i = 0; i < net.length; i++) {
      for (let j = i + 1; j < net.length; j++) {
        s.add([net[i], net[j]].sort((a, b) => a - b).join("-"));
      }
    }
  }
  return s;
}

export function registerMedidaRoutes(app, io) {
  const emit = (ev, d) => io.emit(ev, d);

  // Una sola operacion de medida a la vez: dos barridos simultaneos se pisan
  // el estado de los expansores y dan basura.
  const exclusivo = (fn) => async (req, res) => {
    if (vivo.ocupado) return res.status(409).json({ error: "hay una medida en curso" });
    vivo.ocupado = true;
    try { await fn(req, res); }
    catch (e) { if (!res.headersSent) res.status(500).json({ error: String(e.message ?? e) }); }
    finally { vivo.ocupado = false; }
  };

  const exigirUnidades = (res) => {
    if (!vivo.units.length) {
      res.status(400).json({ error: "no hay unidades. POST /api/medida/unidades primero" });
      return false;
    }
    return true;
  };

  // ── Unidades ───────────────────────────────────────────────
  // El ORDEN importa: define los nombres de canal (M, L1, L2...). Un golden
  // capturado con un orden NO vale con otro.
  app.post("/api/medida/unidades", exclusivo(async (req, res) => {
    const hosts = req.body?.hosts ?? [];
    if (!Array.isArray(hosts) || !hosts.length) {
      return res.status(400).json({ error: "faltan hosts" });
    }
    vivo.units = await abrirUnidades(hosts);
    vivo.hosts = hosts;
    const info = vivo.units.map((u) => ({ index: u.index, host: u.host, canales: u.n, base: u.base }));
    audit("medida", "unidades", hosts.join(","));
    emit("medida:unidades", info);
    res.json({ unidades: info, total: totalCanales(vivo.units) });
  }));

  app.get("/api/medida/unidades", (_req, res) => {
    res.json({
      unidades: vivo.units.map((u) => ({ index: u.index, host: u.host, canales: u.n, base: u.base })),
      total: totalCanales(vivo.units),
    });
  });

  // ── Validacion de modulos (SIN arnes) ──────────────────────
  app.post("/api/medida/modulos", exclusivo(async (_req, res) => {
    if (!exigirUnidades(res)) return;
    const { malos, total } = await validarModulos(vivo.units, (hecho, t) =>
      emit("medida:progreso", { fase: "modulos", hecho, total: t }));
    audit("medida", "modulos", `${malos.length}/${total} malos`);
    res.json({ ok: malos.length === 0, malos, total });
  }));

  // ── Barrido ────────────────────────────────────────────────
  app.post("/api/medida/barrido", exclusivo(async (req, res) => {
    if (!exigirUnidades(res)) return;
    const fixture = req.body?.fixture ? cargarFixture(req.body.fixture) : null;
    const conn = await barrer(vivo.units, (hecho, total) =>
      emit("medida:progreso", { fase: "barrido", hecho, total }));
    const n = totalCanales(vivo.units);
    const { nets, aislados } = construirNets(conn, n);
    res.json({
      canales: n,
      nets: nets.map((net) => ({
        canales: net.map((c) => chName(c, vivo.units)),
        fisico: net.length === 2
          ? describirLinea(net[0], net[1], vivo.units, fixture).texto
          : net.map((c) => nombreFisico(c, vivo.units, fixture).texto).join(" "),
      })),
      aislados: aislados.map((c) => ({
        canal: chName(c, vivo.units), g: c,
        fisico: nombreFisico(c, vivo.units, fixture).texto,
      })),
      huella: huella(nets, aislados, vivo.units),
    });
  }));

  // Clasifica un aislado: abierto o pegado a masa. El mapa no los distingue.
  app.post("/api/medida/clasificar", exclusivo(async (req, res) => {
    if (!exigirUnidades(res)) return;
    const gs = req.body?.canales ?? [];
    const out = [];
    for (const g of gs) out.push(await clasificarAislado(vivo.units, g));
    res.json({ resultados: out });
  }));

  // ── Resistencias ───────────────────────────────────────────
  app.post("/api/medida/resistencias", exclusivo(async (_req, res) => {
    if (!exigirUnidades(res)) return;
    const conn = await barrer(vivo.units, (h, t) => emit("medida:progreso", { fase: "barrido", hecho: h, total: t }));
    const { nets } = construirNets(conn, totalCanales(vivo.units));
    const med = await medirResistencias(nets, vivo.units);
    res.json({ lineas: med, umbrales: { ok: RC_OK, aviso: RC_WARN } });
  }));

  // ── Golden ─────────────────────────────────────────────────
  //
  // Tres barreras, y cada una ve lo que las otras no:
  //   modulos     -> canales a masa en las placas
  //   resistencia -> contactos flojos que el mapa da por buenos
  //   esperadas   -> hilos que FALTAN (una linea ausente no tiene R que medir)
  app.post("/api/medida/golden", exclusivo(async (req, res) => {
    if (!exigirUnidades(res)) return;
    const { nombre, esperadas, fixture: fixId } = req.body ?? {};
    if (!nombre) return res.status(400).json({ error: "falta nombre" });
    const fixture = fixId ? cargarFixture(fixId) : null;

    const conn = await barrer(vivo.units, (h, t) => emit("medida:progreso", { fase: "barrido", hecho: h, total: t }));
    const n = totalCanales(vivo.units);
    const { nets, aislados } = construirNets(conn, n);

    if (esperadas != null && nets.length !== Number(esperadas)) {
      return res.status(422).json({
        error: "conexiones_inesperadas",
        encontradas: nets.length, esperadas: Number(esperadas),
        mensaje: `${nets.length} conexiones, ingenieria espera ${esperadas}. Falta o sobra cableado.`,
      });
    }

    const med = await medirResistencias(nets, vivo.units);
    const altas = med.filter((m) => m.estado === "alta");
    if (altas.length) {
      return res.status(422).json({
        error: "resistencia_alta", lineas: altas,
        mensaje: "Hay contactos flojos. Congelarlos haria que el tester los acepte siempre.",
      });
    }

    if (!fs.existsSync(GOLD_DIR)) fs.mkdirSync(GOLD_DIR, { recursive: true });
    const datos = {
      version: 1,
      nombre,
      creado: new Date().toISOString(),
      fixture: fixId ?? null,
      unidades: vivo.units.map((u) => ({ host: u.host, canales: u.n })),
      total_canales: n,
      esperadas: esperadas != null ? Number(esperadas) : null,
      huella: huella(nets, aislados, vivo.units),
      nets: nets.map((net) => net.map((c) => chName(c, vivo.units))),
      aislados: aislados.map((c) => chName(c, vivo.units)),
      resistencias: med.map((m) => ({ linea: m.linea, r: Number(m.r.toFixed(2)) })),
    };
    fs.writeFileSync(path.join(GOLD_DIR, `${nombre}.json`), JSON.stringify(datos, null, 2), "utf8");
    audit("golden", "guardado", `${nombre} h=${datos.huella}`);
    res.json({ ok: true, golden: datos, sin_esperadas: esperadas == null });
  }));

  app.get("/api/medida/goldens", (_req, res) => {
    if (!fs.existsSync(GOLD_DIR)) return res.json({ goldens: [] });
    res.json({
      goldens: fs.readdirSync(GOLD_DIR).filter((f) => f.endsWith(".json")).map((f) => {
        const d = JSON.parse(fs.readFileSync(path.join(GOLD_DIR, f), "utf8"));
        return { nombre: d.nombre, creado: d.creado, nets: d.nets.length, huella: d.huella };
      }),
    });
  });

  // ── Comprobar contra un golden ─────────────────────────────
  //
  // Se comparan CONEXIONES, no nets: comparando nets, un solo corto renumera
  // todos los siguientes y salen decenas de fallos por un unico defecto.
  app.post("/api/medida/check", exclusivo(async (req, res) => {
    if (!exigirUnidades(res)) return;
    const { golden: gname } = req.body ?? {};
    const gp = path.join(GOLD_DIR, `${gname}.json`);
    if (!fs.existsSync(gp)) return res.status(404).json({ error: "golden no encontrado" });
    const g = JSON.parse(fs.readFileSync(gp, "utf8"));
    const fixture = g.fixture ? cargarFixture(g.fixture) : null;

    const n = totalCanales(vivo.units);
    if (g.total_canales !== n) {
      return res.status(422).json({
        error: "config", mensaje: `el golden es de ${g.total_canales} canales y este montaje tiene ${n}`,
      });
    }

    const conn = await barrer(vivo.units, (h, t) => emit("medida:progreso", { fase: "barrido", hecho: h, total: t }));
    const { nets, aislados } = construirNets(conn, n);

    const nombre = new Map();
    for (let i = 0; i < n; i++) nombre.set(chName(i, vivo.units), i);
    const esp = pares(g.nets.map((net) => net.map((c) => nombre.get(c) ?? -1)));
    const real = pares(nets);

    const fallos = [];
    for (const k of [...esp].filter((x) => !real.has(x)).sort()) {
      const [a, b] = k.split("-").map(Number);
      fallos.push({
        tipo: "ABIERTO",
        texto: describirLinea(a, b, vivo.units, fixture).texto,
        canales: [chName(a, vivo.units), chName(b, vivo.units)],
      });
    }

    // Los cortos se agrupan por nodo: un puente fisico une dos parejas y crea
    // CUATRO parejas nuevas. Sin agrupar, el operador ve cuatro fallos y tiene
    // que deducir que son uno.
    const extra = [...real].filter((x) => !esp.has(x)).map((k) => k.split("-").map(Number));
    if (extra.length) {
      const p = new Map();
      const find = (x) => { if (!p.has(x)) p.set(x, x); while (p.get(x) !== x) { p.set(x, p.get(p.get(x))); x = p.get(x); } return x; };
      for (const [a, b] of extra) { const ra = find(a), rb = find(b); if (ra !== rb) p.set(rb, ra); }
      const grupos = new Map();
      for (const [a, b] of extra) {
        const r = find(a);
        if (!grupos.has(r)) grupos.set(r, new Set());
        grupos.get(r).add(a); grupos.get(r).add(b);
      }
      for (const set of grupos.values()) {
        const cs = [...set].sort((x, y) => x - y);
        fallos.push({
          tipo: "CORTO",
          texto: "unidos y NO deberian: " + cs.map((c) => nombreFisico(c, vivo.units, fixture).texto).join("  "),
          canales: cs.map((c) => chName(c, vivo.units)),
        });
      }
    }

    const ok = fallos.length === 0;
    audit("prueba", ok ? "OK" : "RECHAZO", `${gname} ${fallos.length} fallo(s)`);
    res.json({ ok, fallos, huella: huella(nets, aislados, vivo.units), golden: g.huella });
  }));

  // ── Validacion de socket ───────────────────────────────────
  app.post("/api/socket/arrancar", (req, res) => {
    if (!exigirUnidades(res)) return;
    if (vivo.sesion?.corriendo) return res.status(409).json({ error: "ya hay una sesion" });
    vivo.sesion = new SesionSocket(vivo.units, (ev) => emit("socket:evento", ev));
    vivo.sesion.arrancar();
    res.json({ ok: true });
  });

  app.post("/api/socket/conector", (req, res) => {
    if (!vivo.sesion) return res.status(400).json({ error: "no hay sesion" });
    const { nombre, esperados } = req.body ?? {};
    if (!nombre) return res.status(400).json({ error: "falta nombre del conector" });
    vivo.sesion.empezarConector(nombre, esperados);
    res.json({ ok: true });
  });

  app.post("/api/socket/cerrar", (req, res) => {
    if (!vivo.sesion) return res.status(400).json({ error: "no hay sesion" });
    res.json(vivo.sesion.cerrarConector());
  });

  app.post("/api/socket/deshacer", (req, res) => {
    if (!vivo.sesion) return res.status(400).json({ error: "no hay sesion" });
    res.json({ deshecho: vivo.sesion.deshacer() });
  });

  app.post("/api/socket/parar", (req, res) => {
    if (!vivo.sesion) return res.status(400).json({ error: "no hay sesion" });
    vivo.sesion.parar();
    res.json({ ok: true });
  });

  app.post("/api/socket/guardar", (req, res) => {
    if (!vivo.sesion) return res.status(400).json({ error: "no hay sesion" });
    const { id, nombre } = req.body ?? {};
    if (!id) return res.status(400).json({ error: "falta id" });
    const d = guardarFixture(id, vivo.sesion.aFixture(nombre ?? id));
    audit("fixture", "guardado", `${id} ${Object.keys(d.mapa).length} pines`);
    res.json({ ok: true, fixture: d });
  });

  // ── Atar un golden a un SKU (job) ──────────────────────────
  //
  // El job es lo que se corre en produccion: SKU + golden + orden de unidades.
  // El orden va DENTRO porque define los nombres de canal; el mismo golden con
  // las unidades al reves no significa lo mismo.
  app.post("/api/medida/job", (req, res) => {
    const { sku, golden: gname, nombre, aprobado_por } = req.body ?? {};
    if (!sku || !gname) return res.status(400).json({ error: "faltan sku y golden" });

    const gp = path.join(GOLD_DIR, `${gname}.json`);
    if (!fs.existsSync(gp)) return res.status(404).json({ error: "golden no encontrado" });
    const g = JSON.parse(fs.readFileSync(gp, "utf8"));

    if (!db.prepare("SELECT codigo FROM skus WHERE codigo = ?").get(sku)) {
      return res.status(404).json({ error: `SKU ${sku} no existe` });
    }

    // nets como un byte por canal (net_id, 0 = aislado): mismo formato que el
    // firmware, para que un job se pueda empujar a un ESP32 si algun dia hace
    // falta correr sin PC.
    const idx = new Map();
    g.nets.forEach((net, i) => net.forEach((c) => idx.set(c, i + 1)));
    const bytes = Buffer.alloc(g.total_canales, 0);
    // Se reconstruye el nombre igual que lo genera chName(): unidad 0 = "M",
    // el resto "L1", "L2"... y el canal 31 es "J_SP", no "J31".
    let pos = 0;
    g.unidades.forEach((u, ui) => {
      const pref = ui === 0 ? "M" : `L${ui}`;
      for (let b = 0; b < u.canales; b++) {
        const pin = b === 31 ? "J_SP" : `J${String(b).padStart(2, "0")}`;
        bytes[pos++] = idx.get(`${pref}.${pin}`) ?? 0;
      }
    });

    // Un SKU solo puede tener UN job vigente: si no, no se sabe contra cual se
    // valido una pieza. Los anteriores se retiran, no se borran — la
    // trazabilidad de lo ya producido tiene que seguir en pie.
    db.prepare("UPDATE jobs SET status = 'retired' WHERE sku = ? AND status = 'approved'").run(sku);

    const info = db.prepare(`
      INSERT INTO jobs(sku, nombre, channels, nets, nets_count, crc, tester_macs,
                       status, captured_at, approved_by, approved_at,
                       hosts, esperadas, huella, golden)
      VALUES(?,?,?,?,?,?,?,'approved',?,?,?,?,?,?,?)
    `).run(sku, nombre ?? gname, g.total_canales, bytes, g.nets.length, 0, "[]",
           g.creado, aprobado_por ?? null, now(),
           JSON.stringify(g.unidades.map((u) => u.host)),
           g.esperadas ?? null, g.huella, gname);

    audit("job", "aprobado", sku, String(info.lastInsertRowid), `golden=${gname} h=${g.huella}`);
    res.json({ ok: true, job_id: Number(info.lastInsertRowid), nets: g.nets.length, huella: g.huella });
  });

  app.get("/api/medida/jobs", (_req, res) => {
    res.json({
      jobs: db.prepare(`
        SELECT j.id, j.sku, j.nombre, j.channels, j.nets_count, j.esperadas,
               j.huella, j.golden, j.hosts, j.status, j.approved_at,
               s.descripcion, s.standard_pack
        FROM jobs j JOIN skus s ON s.codigo = j.sku
        WHERE j.status = 'approved' ORDER BY j.approved_at DESC
      `).all(),
    });
  });

  app.get("/api/fixtures", (_req, res) => res.json({ fixtures: listarFixtures() }));
  app.get("/api/fixtures/:id", (req, res) => {
    const f = cargarFixture(req.params.id);
    if (!f) return res.status(404).json({ error: "no existe" });
    res.json(f);
  });
}
