// routes/testers.js — Descubrir, conectar y operar testers.
//
// Un bridge gestiona VARIOS testers (uno por SKU). Cada uno se identifica
// por MAC; la conexion viva esta en state.clients, lo persistente en
// tester_units.

import { db, now, audit } from "../db.js";

/**
 * CRC-16/CCITT-FALSE sobre los net_of del golden. Misma cuenta que el firmware
 * (`_crc16` en mapping.cpp: init 0xFFFF, polinomio 0x1021, sin reflejar).
 *
 * Se calcula AQUI en vez de fiarse del que devuelve el equipo. Comparar su
 * respuesta consigo misma no comprueba nada: si grabara mal la mitad de los
 * bytes, devolveria el CRC de lo que grabo y todo pareceria correcto. Con el
 * calculo propio, un golden que llegue mutilado SE VE.
 */
function crc16(bytes) {
  let crc = 0xFFFF;
  for (const b of bytes) {
    crc ^= (b & 0xFF) << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc;
}

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

// Los dos pulsadores que trae el modulo ESP32-C3 (SW1 y SW2 del esquematico)
// NO sirven como disparador, y conviene que quede escrito: son los unicos
// botones que hay en una placa sin cablear, asi que la idea de usarlos vuelve
// cada vez que alguien mira la placa.
const BOTONES_DEL_MODULO = [
  { sw: "SW1", senal: "IO9",
    motivo: "IO9 es SDA del I²C. Pulsarlo pone a masa la linea de datos de los " +
            "TCA9535: corrompe la medida en curso y puede colgar el bus hasta el reset." },
  { sw: "SW2", senal: "EN",
    motivo: "Es el reset por hardware. No es una entrada: reinicia el modulo." },
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

  /**
   * ¿Cuál de las cajas es esta? Parpadea sus LEDs.
   *
   * Las unidades se llaman 2898, 700C, 424C — los ultimos bytes de su MAC — y
   * sobre la mesa no hay forma de saber cual es cual hasta que alguien pega una
   * etiqueta. Elegir el ORDEN de montaje (M, L1, L2) a ciegas es como se acaba
   * capturando un golden con las unidades cambiadas, que no da ningun error y
   * hace que los informes apunten al conector equivocado.
   *
   * Se parpadea por POSICION: la primera unidad da un destello, la segunda dos,
   * la tercera tres. Asi se identifican las tres de una pasada y se confirma el
   * orden que se acaba de elegir, no solo quien es quien.
   *
   * Responde al momento y parpadea en segundo plano: son 12 segundos mirando
   * las cajas, no una peticion que se queda colgada.
   */
  app.post("/api/testers/identificar", (req, res) => {
    const { hosts = [], segundos = 12 } = req.body ?? {};
    if (!Array.isArray(hosts) || !hosts.length) {
      return res.status(400).json({ error: "faltan los equipos" });
    }

    const enviar = async (host, ops) => {
      try {
        await fetch(`http://${host}/api/raw`, {
          method: "POST", headers: { "Content-Type": "text/plain" },
          body: ops.join("\n"), signal: AbortSignal.timeout(4000),
        });
      } catch { /* una caja que no responde no puede tumbar a las demas */ }
    };

    hosts.forEach(async (host, i) => {
      const destellos = i + 1;
      const hasta = Date.now() + Math.min(60, Number(segundos) || 12) * 1000;
      while (Date.now() < hasta) {
        for (let k = 0; k < destellos; k++) {
          await enviar(host, ["leds 1023"]);
          await new Promise((r) => setTimeout(r, 180));
          await enviar(host, ["leds 0"]);
          await new Promise((r) => setTimeout(r, 180));
        }
        await new Promise((r) => setTimeout(r, 1400));
      }
      await enviar(host, ["leds 0"]);
    });

    res.json({
      ok: true, segundos,
      patron: hosts.map((h, i) => ({ host: h, destellos: i + 1 })),
    });
  });

  /**
   * Nombre fisico de una caja: "la del USB", "la segunda de la fila".
   *
   * Las unidades se llaman por los ultimos bytes de su MAC — 2898, 424C — y eso
   * no se puede mirar en una mesa con tres cajas iguales. Aqui se guarda como
   * se la llama en planta, que es lo unico que alguien va a reconocer.
   */
  app.patch("/api/testers/:mac/notes", (req, res) => {
    const notes = String(req.body?.notes ?? "").slice(0, 200);
    const r = db.prepare("UPDATE tester_units SET notes = ? WHERE mac = ?")
                .run(notes, req.params.mac);
    if (!r.changes) return res.status(404).json({ ok: false, error: "esa unidad no esta registrada" });
    audit(req.body?.actor || "sistema", "tester.notes", "tester", req.params.mac, notes);
    res.json({ ok: true, notes });
  });

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
        pines: PINES_DISPARADOR, prohibidos: PINES_PROHIBIDOS, botones_modulo: BOTONES_DEL_MODULO,
      });
    } catch (e) {
      res.json({ ok: false, error: String(e.message ?? e), pines: PINES_DISPARADOR, prohibidos: PINES_PROHIBIDOS, botones_modulo: BOTONES_DEL_MODULO });
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
  // Qué job lleva el equipo en su NVS.
  //
  // No exige "conectar" primero: se resuelve la IP por mDNS igual que el
  // disparador. Obligar a conectar para LEER algo era una ceremonia que no
  // protegía de nada.
  app.get("/api/testers/:mac/golden", async (req, res) => {
    let cli = null;
    try {
      cli = clienteDe(req.params.mac);
      res.json({ ok: true, golden: await cli.c.getGolden() });
    } catch (e) {
      res.json({ ok: false, error: String(e.message ?? e) });
    } finally { if (cli?.efimero) cli.c.close(); }
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
  /**
   * Monta un job EN el equipo: el golden se graba en su NVS.
   *
   * Es lo que hace posible el modo autónomo. Con el golden dentro, el equipo
   * puede juzgar una pieza sin PC — enciende, lee su golden y al pulsar el
   * botón mide y canta el veredicto en los LEDs.
   *
   * `autonomo: true` además deja el disparador en modo local, que es el que
   * hace que el botón pruebe por su cuenta en vez de avisar a la PC. Los dos
   * pasos van juntos porque por separado se olvida el segundo, y entonces el
   * equipo tiene golden pero el botón no hace nada sin PC.
   *
   * SE VERIFICA EL CRC: el firmware devuelve el de lo que quedó grabado y se
   * compara con el de la base. Si no cuadra, lo que hay en el equipo NO es el
   * golden que se creía haber mandado, y juzgar piezas con eso es peor que no
   * tener nada.
   */
  app.post("/api/testers/:mac/push-job", async (req, res) => {
    const { job_id, actor = "sistema", autonomo = false } = req.body || {};
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(job_id);
    if (!job) return res.json({ ok: false, error: "ese job no existe" });
    if (job.status !== "approved") {
      return res.json({ ok: false, error: `el job está en estado '${job.status}', debe estar aprobado` });
    }
    // Solo se cuenta CUANTAS unidades usa el job, no a donde conectarse, asi
    // que aqui la IP guardada sirve igual.
    const hosts = JSON.parse(job.hosts || "[]");
    if (hosts.length > 1) {
      return res.json({
        ok: false,
        error: `${job.sku} usa ${hosts.length} equipos y el modo autónomo mide con uno solo. ` +
               "Para ese arnés hace falta la PC.",
      });
    }

    let cli = null;
    try {
      cli = clienteDe(req.params.mac);
      const r = await cli.c.setGolden({
        sku: job.sku, job: job.nombre,
        meta: `job:${job.id};aprobado:${job.approved_by};${job.approved_at}`,
        nets: Array.from(job.nets),
      });
      // El CRC de referencia se calcula sobre lo que SE MANDO, no se lee de la
      // base: jobs.crc lo dejaba en 0 la ruta de la PC, que nunca necesito el
      // CRC del firmware. Comparar contra 0 fallaba siempre.
      const esperado = crc16(Array.from(job.nets));
      const crcOk = Number(r.crc) === esperado;

      // Se guarda para poder comparar sin recalcular, y para que se vea en la
      // base que este job ya se monto en un equipo.
      if (crcOk && Number(job.crc) !== esperado) {
        db.prepare("UPDATE jobs SET crc = ? WHERE id = ?").run(esperado, job.id);
      }

      let disparador = null;
      if (autonomo && crcOk) {
        const st = await cli.c.status();
        const pin = st.trigger?.pin ?? -1;
        if (pin < 0) {
          return res.json({
            ok: false, crc_match: crcOk,
            error: "el golden se grabó, pero este equipo no tiene botón configurado. " +
                   "Ponle uno antes de dejarlo autónomo.",
          });
        }
        disparador = await cli.c.setTrigger(pin, st.trigger.active_low, "local");
      }

      audit(actor, autonomo ? "tester.autonomo" : "tester.push_job", "tester", req.params.mac,
            `${job.sku} job:${job.id} crc ${crcOk ? "OK " + esperado : `NO CUADRA (equipo ${r.crc}, esperado ${esperado})`}` +
            (disparador ? ` · disparador IO${disparador.pin} local` : ""));

      res.json({
        ok: crcOk, result: r, crc_match: crcOk, disparador,
        crc_equipo: Number(r.crc), crc_esperado: esperado,
        error: crcOk ? null
          : `el golden llegó mutilado: el equipo tiene el CRC ${r.crc} y debería ser ${esperado}. Vuelve a mandarlo.`,
      });
    } catch (e) {
      res.json({ ok: false, error: String(e.message ?? e) });
    } finally { if (cli?.efimero) cli.c.close(); }
  });

  // Volver a modo normal: el equipo avisa y mide la PC.
  app.post("/api/testers/:mac/asistido", async (req, res) => {
    const { actor = "sistema" } = req.body || {};
    let cli = null;
    try {
      cli = clienteDe(req.params.mac);
      const st = await cli.c.status();
      const pin = st.trigger?.pin ?? -1;
      if (pin < 0) return res.json({ ok: false, error: "este equipo no tiene botón configurado" });
      const t = await cli.c.setTrigger(pin, st.trigger.active_low, "avisar");
      audit(actor, "tester.asistido", "tester", req.params.mac, `disparador IO${t.pin} avisar`);
      res.json({ ok: true, disparador: t });
    } catch (e) {
      res.json({ ok: false, error: String(e.message ?? e) });
    } finally { if (cli?.efimero) cli.c.close(); }
  });
}
