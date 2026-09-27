// routes/testers.js — Descubrir, conectar y operar testers.
//
// Un bridge gestiona VARIOS testers (uno por SKU). Cada uno se identifica
// por MAC; la conexion viva esta en state.clients, lo persistente en
// tester_units.

import { db, now, audit } from "../db.js";

// Pines del modulo ESP32 para el switch fisico (disparador).
//
// La lista sale del firmware (config.h + la validacion del comando `trigger`),
// no de la memoria de nadie: si manana cambia el reparto, cambia ahi y aqui.
//
// Ojo con IO4 e IO5: la serigrafia dice LINK_TX/LINK_RX, pero ese UART entre
// modulos esta RESERVADO Y SIN IMPLEMENTAR —no hay una sola linea de codigo que
// los use—, asi que en la practica estan libres.
const PINES_DISPARADOR = [
  { pin: 4,  estado: "libre",       nota: "Serigrafía LINK_RX. Reservado y sin implementar: libre." },
  { pin: 5,  estado: "libre",       nota: "Serigrafía LINK_TX. Reservado y sin implementar: libre." },
  { pin: 6,  estado: "recomendado", nota: "Libre en el header, sin doble uso." },
  { pin: 7,  estado: "recomendado", nota: "Libre en el header, sin doble uso." },
  { pin: 10, estado: "ocupado_util", nota: "Ya lleva el botón BTN_START de la placa. Usarlo aquí le quita el parpadeo de IP." },
];

const PINES_PROHIBIDOS = [
  { pin: "0, 1, 2", motivo: "Registro de desplazamiento 74HC595 (LEDs y MUX)" },
  { pin: "3",       motivo: "ADC del osciloscopio — mide resistencia y fuga" },
  { pin: "8, 9",    motivo: "Reloj y datos del I²C — los expansores TCA9535" },
  { pin: "18, 19",  motivo: "USB nativo del ESP32-C3" },
];

export function registerTesterRoutes(app, { state, discovery, io, TesterClient, listTesterSerialPorts }) {

  /**
   * Cliente para una unidad, este "conectada" o no.
   *
   * Las rutas de abajo exigen conexion viva porque abren una sesion. Para leer
   * o tocar el disparador no hace falta: se resuelve la IP por mDNS —que es la
   * de AHORA, no la que se guardo— y si no aparece se cae a la registrada.
   */
  const clienteDe = (mac) => {
    const vivo = state.clients.get(mac);
    if (vivo) return { c: vivo, efimero: false };

    const fila = db.prepare("SELECT * FROM tester_units WHERE mac = ?").get(mac);
    if (!fila) throw new Error("esa unidad no está registrada");

    const visto = discovery.list().find((d) => d.unit === fila.unit);
    const host = visto?.ip || fila.ip;
    if (!host) throw new Error(`${fila.unit} no está en la red y no tiene IP registrada`);
    return { c: new TesterClient({ host }), efimero: true, fila };
  };

  // ── Disparador fisico ──────────────────────────────────────
  app.get("/api/testers/:mac/trigger", async (req, res) => {
    let cli = null;
    try {
      cli = clienteDe(req.params.mac);
      const s = await cli.c.status();
      res.json({
        ok: true,
        trigger: s.trigger ?? { pin: -1, active_low: true },
        fw: s.fw, unidad: s.unit, uptime_s: s.uptime_s,
        reset_reason: s.reset_reason, heap_free: s.heap_free,
        led_auto: s.led_auto, canales: s.channels,
        pines: PINES_DISPARADOR, prohibidos: PINES_PROHIBIDOS,
      });
    } catch (e) {
      res.json({ ok: false, error: String(e.message ?? e), pines: PINES_DISPARADOR, prohibidos: PINES_PROHIBIDOS });
    } finally {
      if (cli?.efimero) cli.c.close();
    }
  });

  app.post("/api/testers/:mac/trigger", async (req, res) => {
    const { pin = null, active_low = true, actor = "sistema", mode = "avisar" } = req.body || {};
    let cli = null;
    try {
      cli = clienteDe(req.params.mac);
      const real = await cli.c.setTrigger(pin == null ? null : Number(pin), !!active_low, mode);
      audit(actor, "tester.trigger", "tester", req.params.mac,
            real.pin < 0 ? "desactivado"
                         : `IO${real.pin} ${real.active_low ? "NO" : "NC"} modo ${real.mode ?? "?"}`);
      res.json({ ok: true, trigger: real });
    } catch (e) {
      res.json({ ok: false, error: String(e.message ?? e) });
    } finally {
      if (cli?.efimero) cli.c.close();
    }
  });


  // Lo que se ve en la LAN ahora mismo (mDNS)
  app.get("/api/testers/discovered", (_req, res) => res.json(discovery.list()));

  // Puertos USB que parecen un ESP32
  app.get("/api/testers/serial-ports", async (_req, res) => {
    try { res.json(await listTesterSerialPorts()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Testers registrados (persistente) + si estan conectados ahora
  app.get("/api/testers", (_req, res) => {
    const rows = db.prepare("SELECT * FROM tester_units ORDER BY unit").all();
    res.json(rows.map(r => ({ ...r, connected: state.clients.has(r.mac) })));
  });

  // Conectar por IP o por puerto USB. Lee /api/status, registra y deja el cliente abierto.
  app.post("/api/testers/connect", async (req, res) => {
    const { host, port, serialPath, actor = "sistema" } = req.body || {};
    let client;
    try {
      client = new TesterClient({ host, port, serialPath });
      const s = await client.status();

      // Ya habia un cliente para esta MAC: se reemplaza
      state.clients.get(s.mac)?.close();
      state.clients.set(s.mac, client);

      db.prepare(`INSERT INTO tester_units(mac, unit, role, sku_bound, ip, serial_port, fw, api, last_seen)
                  VALUES(?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(mac) DO UPDATE SET unit=excluded.unit, role=excluded.role, sku_bound=excluded.sku_bound,
                    ip=excluded.ip, serial_port=excluded.serial_port, fw=excluded.fw, api=excluded.api, last_seen=excluded.last_seen`)
        .run(s.mac, s.unit, s.role, s.sku || null, host || null, serialPath || null, s.fw, s.api, now());

      audit(actor, "tester.connect", "tester", s.mac, { via: client.kind, label: client.label, unit: s.unit });
      io.emit("testers:connected", Array.from(state.clients.keys()));
      res.json({ ok: true, status: s, via: client.kind });
    } catch (e) {
      client?.close();
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/testers/:mac/disconnect", (req, res) => {
    const c = state.clients.get(req.params.mac);
    if (c) { c.close(); state.clients.delete(req.params.mac); }
    io.emit("testers:connected", Array.from(state.clients.keys()));
    res.json({ ok: true });
  });

  // Estado en vivo de un tester conectado
  app.get("/api/testers/:mac/status", async (req, res) => {
    const c = state.clients.get(req.params.mac);
    if (!c) return res.json({ ok: false, error: "no conectado" });
    try {
      const s = await c.status();
      db.prepare("UPDATE tester_units SET last_seen = ?, sku_bound = ? WHERE mac = ?").run(now(), s.sku || null, s.mac);
      res.json({ ok: true, status: s });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // Golden cargado en el tester
  app.get("/api/testers/:mac/golden", async (req, res) => {
    const c = state.clients.get(req.params.mac);
    if (!c) return res.json({ ok: false, error: "no conectado" });
    try { res.json({ ok: true, golden: await c.getGolden() }); }
    catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // ── Pasos del asistente de alta de SKU ──────────────────────

  // 1. Validar los modulos con el arnes DESCONECTADO.
  //    Esto va ANTES de capturar nada: si un pin esta pegado a GND, el golden
  //    congelaria el defecto y despues todos los arneses buenos serian
  //    rechazados. Paso obligatorio, no cosmetico.
  app.post("/api/testers/:mac/selfcheck", async (req, res) => {
    const { actor = "sistema" } = req.body || {};
    const c = state.clients.get(req.params.mac);
    if (!c) return res.json({ ok: false, error: "no conectado" });
    try {
      const r = await c.selfCheck();
      audit(actor, "tester.selfcheck", "tester", req.params.mac,
            { result: r.result, bad: r.bad, channels: r.channels });
      res.json({ ok: true, ...r });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // 2. Capturar el mapa del arnés golden, SIN guardarlo todavía.
  //    Ingeniería lo revisa antes de aprobar.
  app.post("/api/testers/:mac/capture", async (req, res) => {
    const { actor = "sistema" } = req.body || {};
    const c = state.clients.get(req.params.mac);
    if (!c) return res.json({ ok: false, error: "no conectado" });
    try {
      const r = await c.captureMap();
      if (!r.ok) return res.json({ ok: false, error: r.error || "fallo el mapeo" });
      audit(actor, "tester.capture", "tester", req.params.mac,
            { channels: r.channels, nets: r.nets_count });
      res.json({ ok: true, ...r });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // 3. Ejecutar una prueba contra el golden cargado.
  app.post("/api/testers/:mac/run-test", async (req, res) => {
    const c = state.clients.get(req.params.mac);
    if (!c) return res.json({ ok: false, error: "no conectado" });
    try { res.json({ ok: true, ...(await c.runTest()) }); }
    catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // Última prueba — incluye las lanzadas por el switch físico, que no pasan
  // por la app. Así el switch no abre un agujero en la trazabilidad.
  app.get("/api/testers/:mac/last-test", async (req, res) => {
    const c = state.clients.get(req.params.mac);
    if (!c) return res.json({ ok: false, error: "no conectado" });
    try { res.json({ ok: true, ...(await c.lastTest()) }); }
    catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // Empujar un job aprobado al tester
  app.post("/api/testers/:mac/push-job", async (req, res) => {
    const { job_id, actor = "sistema" } = req.body || {};
    const c = state.clients.get(req.params.mac);
    if (!c) return res.json({ ok: false, error: "no conectado" });
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(job_id);
    if (!job) return res.json({ ok: false, error: "job no existe" });
    if (job.status !== "approved") return res.json({ ok: false, error: `job en estado '${job.status}', debe estar aprobado` });
    try {
      const r = await c.setGolden({
        sku: job.sku, job: job.nombre,
        meta: `job:${job.id};aprobado:${job.approved_by};${job.approved_at}`,
        nets: Array.from(job.nets),
      });
      audit(actor, "tester.push_job", "tester", req.params.mac, { job_id: job.id, sku: job.sku, crc_tester: r.crc, crc_db: job.crc });
      res.json({ ok: true, result: r, crc_match: Number(r.crc) === Number(job.crc) });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });
}
