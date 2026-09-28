// produccion.js — Prueba de producción, lotes y resultados.
//
// Un solo endpoint ata todo: SKU → job aprobado → unidades EN EL ORDEN del job
// → barrido → veredicto → registro y lote.
//
// Las unidades NO las elige el operador: el orden es parte del job, y
// equivocarlo daría fallos falsos en todos los canales a la vez. Se reabren en
// cada prueba porque el DHCP mueve las IPs y una unidad pudo reiniciarse.

import path from "node:path";
import fs from "node:fs";
import {
  abrirUnidades, barrer, construirNets, huella, chName, totalCanales,
  ledsDeFallos, clasificarAislado, validarModulos,
} from "../measure.js";
import { cargarFixture, nombreFisico, describirLinea } from "../fixture.js";
import { DATA_DIR, audit, db, now, todayYMD, nextLoteId, getSetting, setSetting } from "../db.js";
import { etiquetasDeLote, historialEtiquetas, etiquetarPacksCompletos } from "../labels/lote.js";
import { onda, acoplamiento } from "../avanzado.js";

const GOLD_DIR = path.join(DATA_DIR, "goldens");

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

/** Agrupa los cortos por nodo. Un puente físico crea CUATRO parejas nuevas;
 *  sin agrupar el operador ve cuatro fallos por un solo defecto. */
function agruparCortos(extra) {
  const p = new Map();
  const find = (x) => {
    if (!p.has(x)) p.set(x, x);
    while (p.get(x) !== x) { p.set(x, p.get(p.get(x))); x = p.get(x); }
    return x;
  };
  for (const [a, b] of extra) { const ra = find(a), rb = find(b); if (ra !== rb) p.set(rb, ra); }
  const grupos = new Map();
  for (const [a, b] of extra) {
    const r = find(a);
    if (!grupos.has(r)) grupos.set(r, new Set());
    grupos.get(r).add(a); grupos.get(r).add(b);
  }
  return [...grupos.values()].map((s) => [...s].sort((x, y) => x - y));
}

// `discovery` llega de fuera: el sondeo del boton necesita la IP de AHORA
// —el DHCP las mueve— y no la que se guardo cuando se registro la unidad.
export function registerProduccionRoutes(app, io, { discovery } = {}) {
  const emit = (ev, d) => io.emit(ev, d);
  // ── Cerrojo POR UNIDAD, no global ──────────────────────────
  //
  // Dos barridos sobre LA MISMA placa se pisan el estado de los expansores y
  // dan basura. Sobre placas DISTINTAS no se estorban en nada: son equipos
  // separados con su propio bus. Un cerrojo global serializaba toda la planta
  // por un problema que solo existe dentro de cada tester.
  //
  // Se reservan los hosts del job entero: el arnes grande usa tres unidades y
  // las tres tienen que estar libres antes de empezar.
  const ocupadas = new Set();

  const tomar = (hosts) => {
    if (hosts.some((h) => ocupadas.has(h))) return false;
    for (const h of hosts) ocupadas.add(h);
    return true;
  };
  const soltar = (hosts) => { for (const h of hosts) ocupadas.delete(h); };
  const hostsDelJob = (job) => { try { return JSON.parse(job.hosts || "[]"); } catch { return []; } };

  /**
   * La prueba de produccion, una sola vez y en un solo sitio.
   *
   * La llaman DOS cosas: el boton de la pantalla y el switch fisico del equipo.
   * Estaba metida dentro del handler HTTP; se saco aqui para que el disparador
   * no tenga que reimplementarla — dos copias de esto acabarian divergiendo, y
   * la que diverge siempre es la que nadie mira.
   *
   * `origen` viaja hasta el evento y hasta la auditoria: saber si una pieza la
   * lanzo el operador desde la pantalla o desde el boton importa cuando alguien
   * revisa el historial meses despues.
   */
  async function ejecutarPrueba({ sku, operador, lote_id = null, origen = "app",
                                 tester_mac = null, parcial = false }) {
    const fallar = (codigo, mensaje) => {
      const e = new Error(mensaje); e.status = codigo; throw e;
    };
    if (!sku || !operador) fallar(400, "faltan sku y operador");

    const job = db.prepare(
      "SELECT * FROM jobs WHERE sku = ? AND status = 'approved' ORDER BY approved_at DESC LIMIT 1"
    ).get(sku);
    if (!job) fallar(404, `${sku} no tiene ningún golden aprobado`);

    const hosts = JSON.parse(job.hosts || "[]");
    if (!hosts.length) fallar(422, "el job no guardó las unidades; recaptura el golden");

    const t0 = Date.now();
    const inicio = now();
    let resultado = "ERROR";
    let fallos = [];
    let huellaMedida = null;
    let error = null;

    try {
      const units = await abrirUnidades(hosts);
      const n = totalCanales(units);
      if (n !== job.channels) {
        throw new Error(`el golden es de ${job.channels} canales y el montaje tiene ${n}`);
      }

      const gp = path.join(GOLD_DIR, `${job.golden}.json`);
      if (!fs.existsSync(gp)) throw new Error(`falta el fichero de golden "${job.golden}"`);
      const g = JSON.parse(fs.readFileSync(gp, "utf8"));
      const fixture = g.fixture ? cargarFixture(g.fixture) : null;

      const conn = await barrer(units, (hecho, total) =>
        emit("medida:progreso", { fase: "prueba", hecho, total }));
      const { nets, aislados } = construirNets(conn, n);
      huellaMedida = huella(nets, aislados, units);

      const idx = new Map();
      for (let i = 0; i < n; i++) idx.set(chName(i, units), i);
      const esp  = pares(g.nets.map((net) => net.map((c) => idx.get(c) ?? -1)));
      const real = pares(nets);

      for (const k of [...esp].filter((x) => !real.has(x)).sort()) {
        const [a, b] = k.split("-").map(Number);
        fallos.push({
          tipo: "ABIERTO",
          texto: describirLinea(a, b, units, fixture).texto,
          canales: [chName(a, units), chName(b, units)],
        });
      }

      const extra = [...real].filter((x) => !esp.has(x)).map((k) => k.split("-").map(Number));
      for (const cs of agruparCortos(extra)) {
        fallos.push({
          tipo: "CORTO",
          texto: "unidos y NO deberían: " +
                 cs.map((c) => nombreFisico(c, units, fixture).texto).join("  "),
          canales: cs.map((c) => chName(c, units)),
        });
      }

      resultado = fallos.length ? "FAIL" : "PASS";

      // LEDs: los cinco verdes si pasa; si no, se pone en ROJO la zona que
      // contiene cada canal en fallo y el resto queda verde. El operador ve de
      // lejos por donde buscar sin acercarse a la pantalla.
      const malos = fallos.flatMap((f) => f.canales)
                          .map((nm) => idx.get(nm))
                          .filter((g) => g !== undefined);
      for (const u of units) await u.leds(ledsDeFallos(u, malos));
    } catch (e) {
      error = String(e?.message ?? e);
      resultado = "ERROR";
    }

    // Se registra SIEMPRE, incluso el ERROR. Una prueba que no se pudo hacer
    // también es trazabilidad: si solo se guardaran PASS y FAIL, un tester que
    // falla a ratos sería invisible en el historial.
    const dur = Date.now() - t0;
    // tester_mac = el equipo que encabeza el job. Sirve para responder "que se
    // corrio por ultima vez EN ESTE equipo", que es como el boton fisico decide
    // que SKU lanzar cuando una misma unidad tiene varios aprobados.
    const macCabecera = tester_mac ?? (() => {
      const h = hosts[0];
      return db.prepare("SELECT mac FROM tester_units WHERE ip = ?").get(h)?.mac ?? null;
    })();

    const info = db.prepare(`
      INSERT INTO tests(sku, job_id, job_crc, operator, tester_mac, started_at, ended_at,
                        duration_ms, result, faults, lote_id, notes, parcial)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(sku, job.id, job.crc ?? 0, operador, macCabecera, inicio, now(), dur,
           resultado, JSON.stringify(fallos), lote_id ?? null, error, parcial ? 1 : 0);

    let pack = null;
    if (lote_id) {
      db.prepare(`
        UPDATE lotes SET cantidad = cantidad + 1,
                         buenos   = buenos + ?,
                         malos    = malos + ?
        WHERE id = ?
      `).run(resultado === "PASS" ? 1 : 0, resultado === "PASS" ? 0 : 1, lote_id);

      // Al completar una bolsa, la etiqueta sale sola.
      //
      // Cuenta BUENAS, no probadas: con pack de 10, probar 12 con 2 malas
      // etiqueta al llegar a 10. El material lo separa el operador; la app solo
      // necesita saber cuantas buenas lleva.
      //
      // Es lo que cierra el ciclo del boton fisico: sin esto, el operador
      // tendria que volver a la pantalla a pedir la etiqueta, que es justo lo
      // que el boton viene a evitar.
      if (resultado === "PASS" && getSetting("etiqueta_automatica", "1") === "1") {
        try {
          pack = await etiquetarPacksCompletos(lote_id, { actor: operador });
          if (pack) emit("lote:pack", { ...pack, origen });
        } catch (e) {
          // Que falle la etiqueta no puede tumbar la prueba: la pieza ya se
          // midio y ya esta registrada. Se avisa y se puede reimprimir.
          emit("lote:pack_error", { lote: lote_id, error: String(e?.message ?? e) });
        }
      }
    }

    audit("prueba", resultado, sku, String(info.lastInsertRowid),
          `${fallos.length} fallo(s) en ${dur} ms · ${origen}`);

    const salida = {
      id: Number(info.lastInsertRowid),
      resultado, fallos, error, origen, parcial: !!parcial,
      duracion_ms: dur, pack,
      huella: huellaMedida, golden: job.huella,
      job: { id: job.id, nombre: job.nombre, nets: job.nets_count, unidades: hosts.length },
    };
    // El evento lleva el resultado ENTERO, no solo el veredicto: una prueba
    // lanzada desde el boton no tiene ninguna respuesta HTTP que mostrar, asi
    // que la pantalla solo puede enterarse por aqui.
    emit("prueba:resultado", { sku, operador, ...salida });
    return salida;
  }

  app.post("/api/prueba", async (req, res) => {
    const { sku, operador, lote_id } = req.body ?? {};
    const job = db.prepare(
      "SELECT * FROM jobs WHERE sku = ? AND status = 'approved' ORDER BY approved_at DESC LIMIT 1"
    ).get(sku ?? "");
    const hosts = job ? hostsDelJob(job) : [];
    if (hosts.length && !tomar(hosts)) {
      return res.status(409).json({ error: "ese equipo está ocupado con otra prueba" });
    }
    try {
      res.json(await ejecutarPrueba({ sku, operador, lote_id, origen: "app" }));
    } catch (e) {
      res.status(e.status || 500).json({ error: String(e?.message ?? e) });
    } finally {
      soltar(hosts);
    }
  });

  // ── Lotes ──────────────────────────────────────────────────
  //
  // El número de lote es una SECUENCIA en la base. En la app vieja vivía en el
  // estado de React y se reiniciaba a 0001 al recargar la página, generando
  // lotes duplicados.
  app.post("/api/lotes", (req, res) => {
    const { sku, operador } = req.body ?? {};
    if (!sku || !operador) return res.status(400).json({ error: "faltan sku y operador" });
    const id = nextLoteId();
    db.prepare("INSERT INTO lotes(id, sku, fecha, operador, created_at) VALUES(?,?,?,?,?)")
      .run(id, sku, todayYMD(), operador, now());
    audit("lote", "abierto", sku, id, operador);
    res.json({ lote: db.prepare("SELECT * FROM lotes WHERE id = ?").get(id) });
  });

  app.get("/api/lotes", (req, res) => {
    const { sku } = req.query;
    const abiertos = sku
      ? db.prepare("SELECT * FROM lotes WHERE sku = ? ORDER BY created_at DESC LIMIT 50").all(sku)
      : db.prepare("SELECT * FROM lotes ORDER BY created_at DESC LIMIT 50").all();
    res.json({ lotes: abiertos });
  });

  // Cerrar un lote GENERA sus etiquetas. El PDF se guarda siempre, se imprima
  // o no: una impresora apagada no puede dejar un lote producido sin etiqueta.
  app.post("/api/lotes/:id/cerrar", async (req, res) => {
    const { actor = "sistema" } = req.body ?? {};
    db.prepare("UPDATE lotes SET closed_at = ? WHERE id = ?").run(now(), req.params.id);
    audit("lote", "cerrado", "lotes", req.params.id, actor);
    const lote = db.prepare("SELECT * FROM lotes WHERE id = ?").get(req.params.id);

    let etiquetas = null, error = null;
    try {
      etiquetas = await etiquetasDeLote(req.params.id, { actor });
    } catch (e) {
      // El lote queda cerrado igual. Fallar aqui no debe impedir cerrar, y las
      // etiquetas se pueden generar despues desde el historial.
      error = String(e?.message ?? e);
    }
    res.json({ lote, etiquetas, error });
  });

  // Reimprimir: mismo contenido, PDF nuevo. Para cuando la impresora estaba
  // apagada, se atasco el papel, o hace falta otra copia.
  app.post("/api/lotes/:id/etiquetas", async (req, res) => {
    const { actor = "sistema", soloBuenos = true } = req.body ?? {};
    try {
      res.json({ etiquetas: await etiquetasDeLote(req.params.id,
                   { actor, soloBuenos, reimprimir: true }) });
    } catch (e) {
      res.status(422).json({ error: String(e?.message ?? e) });
    }
  });

  app.get("/api/lotes/:id/etiquetas", (req, res) => {
    res.json({ etiquetas: historialEtiquetas(req.params.id) });
  });

  app.get("/api/etiquetas", (_req, res) => {
    res.json({ etiquetas: historialEtiquetas(null) });
  });

  // Servir el PDF guardado. Se sirve por nombre de fichero y no por ruta para
  // que la UI no pueda pedir cualquier cosa del disco.
  app.get("/api/labels/file/:nombre", (req, res) => {
    const seguro = path.basename(req.params.nombre);
    const f = path.join(DATA_DIR, "labels", seguro);
    if (!fs.existsSync(f)) return res.status(404).json({ error: "no existe" });
    res.type("application/pdf").sendFile(f);
  });

  // ── Resultados ─────────────────────────────────────────────
  app.get("/api/pruebas", (req, res) => {
    const { sku, operador, desde, hasta, resultado, limit } = req.query;
    const cond = [], args = [];
    if (sku)       { cond.push("t.sku = ?");         args.push(sku); }
    if (operador)  { cond.push("t.operator = ?");    args.push(operador); }
    if (resultado) { cond.push("t.result = ?");      args.push(resultado); }
    if (desde)     { cond.push("t.started_at >= ?"); args.push(desde); }
    if (hasta)     { cond.push("t.started_at <= ?"); args.push(`${hasta}T23:59:59Z`); }
    const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
    const n = Math.min(Number(limit) || 200, 1000);

    const pruebas = db.prepare(`
      SELECT t.id, t.sku, t.operator, t.started_at, t.duration_ms, t.result,
             t.faults, t.lote_id, t.notes, t.job_id,
             j.nombre AS job_nombre, j.huella AS job_huella
      FROM tests t LEFT JOIN jobs j ON j.id = t.job_id
      ${where} ORDER BY t.started_at DESC LIMIT ?
    `).all(...args, n);

    const resumen = db.prepare(`
      SELECT t.sku,
             COUNT(*) AS total,
             SUM(CASE WHEN t.result = 'PASS'  THEN 1 ELSE 0 END) AS buenos,
             SUM(CASE WHEN t.result = 'FAIL'  THEN 1 ELSE 0 END) AS malos,
             SUM(CASE WHEN t.result = 'ERROR' THEN 1 ELSE 0 END) AS errores
      FROM tests t ${where} GROUP BY t.sku ORDER BY total DESC
    `).all(...args);

    res.json({ pruebas, resumen });
  });

  // ── Diagnóstico ────────────────────────────────────────────
  //
  // El veredicto dice QUE falló; esto dice POR QUE y DONDE duele mas.

  // Abierto o pegado a masa: el mapa NO los distingue.
  //
  // Un canal pegado a GND nunca sigue al driver, asi que sale "aislado"
  // exactamente igual que un cable roto. Para quien repara la diferencia lo es
  // todo: un abierto es un crimp mal hecho, un corto a masa es un pin corrido o
  // una rebaba, y se arreglan distinto.
  //
  // Se excita un extremo dejando el otro en alta impedancia y se mira la
  // tension: si el excitado BAJA, hay una R a masa; si el otro se queda a cero
  // pero el excitado se mantiene, esta abierto.
  //
  // Reserva las mismas unidades que la prueba de produccion: son las mismas
  // placas, y dos cosas moviendo los expansores a la vez dan basura sin error.
  app.post("/api/diagnostico/clasificar", async (req, res) => {
    let reservados = [];
    try {
      const testId = Number(req.body?.test_id);
      const prueba = db.prepare("SELECT * FROM tests WHERE id = ?").get(testId);
      if (!prueba) return res.status(404).json({ error: "esa prueba no existe" });

      const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(prueba.job_id);
      if (!job) return res.status(404).json({ error: "la prueba no tiene job" });
      const hosts = JSON.parse(job.hosts || "[]");
      if (!hosts.length) return res.status(422).json({ error: "el job no guardó las unidades" });
      if (!tomar(hosts)) return res.status(409).json({ error: "ese equipo está ocupado" });
      reservados = hosts;

      // Solo tiene sentido sobre ABIERTO: un CORTO ya esta clasificado.
      const fallos = JSON.parse(prueba.faults || "[]");
      const nombres = [...new Set(fallos.filter((f) => f.tipo === "ABIERTO")
                                        .flatMap((f) => f.canales ?? []))];
      if (!nombres.length) return res.json({ ok: true, resultados: [], sin_abiertos: true });

      const units = await abrirUnidades(hosts);
      const n = totalCanales(units);
      if (n !== job.channels) {
        throw new Error(`el job es de ${job.channels} canales y el montaje tiene ${n}. ` +
                        "Clasificar con otro montaje diría cualquier cosa.");
      }
      const idx = new Map();
      for (let i = 0; i < n; i++) idx.set(chName(i, units), i);

      const g = (() => {
        const gp = path.join(GOLD_DIR, `${job.golden}.json`);
        return fs.existsSync(gp) ? JSON.parse(fs.readFileSync(gp, "utf8")) : null;
      })();
      const fixture = g?.fixture ? cargarFixture(g.fixture) : null;

      const resultados = [];
      for (const nombre of nombres) {
        const gch = idx.get(nombre);
        if (gch === undefined) continue;
        const r = await clasificarAislado(units, gch);
        resultados.push({
          ...r,
          fisico: nombreFisico(gch, units, fixture).texto,
          consejo: r.tipo === "gnd"
            ? "Pegado a masa: pin corrido, rebaba o hilo pinzado. No es un crimp."
            : r.tipo === "abierto"
              ? "Abierto: crimp mal hecho, hilo cortado o contacto fuera del alojamiento."
              : "No se pudo medir este canal.",
        });
      }

      audit("diagnostico", "clasificar", "test", String(testId),
            resultados.map((r) => `${r.canal}:${r.tipo}`).join(" "));
      res.json({ ok: true, resultados });
    } catch (e) {
      res.status(500).json({ error: String(e?.message ?? e) });
    } finally {
      soltar(reservados);
    }
  });

  // ── El botón físico ────────────────────────────────────────
  //
  // El equipo NO corre la prueba: solo cuenta la pulsación (`trigger.presses`
  // en /api/status, firmware 1.7.0+). Quien mide es la PC, porque es donde vive
  // el golden — y porque así funciona igual con una unidad que con tres.
  //
  // Esto sondea a los equipos que tengan disparador puesto y, cuando el
  // contador sube, lanza la MISMA prueba que el botón de la pantalla.
  //
  // Por qué un contador y no un "pulsado sí/no": una pulsación dura ~100 ms y
  // el sondeo va cada 400. Con un booleano se perderían pulsaciones y, peor,
  // una pulsación larga se leería como varias. El contador no se pierde ni se
  // duplica: basta comparar con el anterior.
  /**
   * Qué corre el botón de ESTE equipo.
   *
   * El SKU sale del EQUIPO que se pulsó, no de lo que haya en pantalla. Pulsar
   * el botón de la 2898 corría el job de la 8744 porque se usaba el SKU activo
   * a secas: el operador pulsaba en un puesto y se medía otro.
   *
   * Un mismo equipo puede tener varios SKU aprobados, así que hay orden de
   * preferencia — y si no se puede decidir, NO se inventa: se avisa. Arrancar
   * el producto equivocado da un RECHAZADO que parece un defecto de la pieza.
   */
  function resolverBoton(mac, host) {
    const candidatos = db.prepare(
      "SELECT * FROM jobs WHERE status = 'approved' ORDER BY approved_at DESC"
    ).all().filter((j) => hostsDelJob(j).includes(host));

    if (!candidatos.length) {
      return {
        job: null, falta: "job",
        motivo: "no pertenece a ningún job aprobado",
        mensaje: "Este equipo no pertenece a ningún golden aprobado. Captura uno con él.",
      };
    }

    // Contexto de ESTA estacion.
    //
    // Si el equipo esta dado de alta como estacion, manda SOLO lo suyo. Heredar
    // el operador de la pantalla seria atribuir la pieza a quien no la probo —
    // justo la trazabilidad que miente que esto viene a evitar. Un puesto sin
    // operador produce registro PARCIAL, que es honesto.
    //
    // Los ajustes globales son el respaldo para la instalacion de un solo
    // puesto, que nunca configura estaciones.
    const est = db.prepare("SELECT * FROM estaciones WHERE mac = ?").get(mac) ?? {};

    // Cuantos puestos con boton hay DE VERDAD. Es lo que decide si heredar el
    // contexto de la pantalla es legitimo: con un solo puesto, la pantalla ES
    // ese puesto. Con dos, heredar atribuye la pieza a quien no la probo.
    //
    // Se mira la realidad y no si existe fila de estacion: guardar una estacion
    // en blanco no puede cambiar como se comporta un boton que ya funcionaba.
    const puestos = [...vigilancia.values()].filter((v) => v.presses != null).length;
    const unicoPuesto = puestos <= 1;

    // El SKU si puede heredarse siempre: ya esta filtrado por "tiene que ser un
    // job de ESTE equipo", asi que el producto de otro puesto no cuela.
    const activo = est.sku || getSetting("sku_activo") || "";
    const ultimaAqui = db.prepare(
      "SELECT sku FROM tests WHERE tester_mac = ? ORDER BY id DESC LIMIT 1"
    ).get(mac)?.sku;

    const job =
      candidatos.find((j) => j.sku === activo) ??       // 1. el de ESTA estacion
      candidatos.find((j) => j.sku === ultimaAqui) ??   // 2. el último corrido AQUÍ
      (candidatos.length === 1 ? candidatos[0] : null); // 3. si solo hay uno, ese

    const skus = [...new Set(candidatos.map((j) => j.sku))];
    if (!job) {
      return {
        job: null, falta: "sku",
        motivo: `varios SKU posibles (${skus.join(", ")})`,
        mensaje: `Este equipo tiene varios productos aprobados (${skus.join(", ")}). ` +
                 "Asígnale uno en Configuración → Estaciones.",
        candidatos: skus,
      };
    }

    // SIN OPERADOR NO SE RECHAZA: se registra parcial.
    //
    // Cambiado a proposito. Antes se negaba a correr, y eso hace que la pieza
    // no exista en el historial: ni se sabe que se probo, ni que fallo. Un
    // registro incompleto se puede completar despues; una pieza que no aparece
    // esta perdida. Queda marcada como parcial para que no se confunda con
    // trazabilidad buena.
    // Heredar el operador de la pantalla vale en dos casos, y solo en dos:
    //   - hay un unico puesto: la pantalla ES ese puesto;
    //   - la pantalla esta trabajando en ESTE producto: quien lo tiene
    //     seleccionado es quien esta probando.
    // Para un puesto que corre otro producto, heredar seria firmar la pieza
    // con el nombre de otra persona.
    const enPantalla = (getSetting("sku_activo") || "") === job.sku;
    const operador = est.operador ||
      ((unicoPuesto || enPantalla) ? getSetting("operador_activo") || "" : "");
    return {
      job,
      operador: operador || "(sin operador)",
      parcial: !operador,
      lote_id: est.lote_id ?? null,
      candidatos: skus,
      estacion: est.mac ? (est.nombre || null) : null,
    };
  }

  const vigilancia = new Map();   // mac -> { presses, host, proximo }
  let sondeando = false;

  // Un equipo SIN disparador, o apagado, no merece que se le pregunte tres
  // veces por segundo: se le espacia a 10 s. Sin esto, cuatro unidades de las
  // cuales tres estan apagadas convierten cada vuelta en 7 s de timeouts y el
  // boton de la que si esta responde tarde.
  const ESPERA_SIN_BOTON = 10_000;

  async function sondearBotones() {
    if (sondeando) return;
    sondeando = true;
    try {
      const unidades = db.prepare("SELECT mac, unit, ip FROM tester_units").all();
      const ahora = Date.now();
      for (const u of unidades) {
        const prev = vigilancia.get(u.mac);
        if (prev?.proximo && ahora < prev.proximo) continue;

        const visto = discovery?.list().find((d) => d.unit === u.unit);
        const host = visto?.ip || u.ip;
        if (!host) continue;

        let st;
        try {
          const r = await fetch(`http://${host}/api/status`, { signal: AbortSignal.timeout(2000) });
          if (!r.ok) throw new Error("HTTP " + r.status);
          st = await r.json();
        } catch {
          // Apagado o fuera de la red: se reintenta, pero sin prisa.
          vigilancia.set(u.mac, { ...(prev ?? {}), proximo: ahora + ESPERA_SIN_BOTON });
          continue;
        }

        const t = st.trigger;
        if (!t || t.pin < 0 || t.presses == null) {
          // Sin boton (o con firmware anterior a 1.7.0, que no cuenta pulsaciones).
          vigilancia.set(u.mac, { proximo: ahora + ESPERA_SIN_BOTON });
          continue;
        }

        vigilancia.set(u.mac, { presses: t.presses, host, proximo: 0 });

        // La primera vuelta solo toma nota. Sin esto, arrancar el bridge con un
        // contador ya alto dispararía una prueba que nadie pidió.
        if (prev?.presses == null || t.presses === prev.presses) continue;

        const decision = resolverBoton(u.mac, host);
        if (!decision.job) {
          console.log(`[boton] ${st.unit}: ${decision.motivo}`);
          emit("boton:sin_contexto", { unidad: st.unit, falta: decision.falta, mensaje: decision.mensaje });
          continue;
        }

        const sku = decision.job.sku;
        const operador = decision.operador;
        const hostsJob = hostsDelJob(decision.job);

        // Tambien a consola: "pulse el boton y no paso nada" hay que poder
        // diagnosticarlo sin un navegador abierto mirando eventos.
        console.log(`[boton] ${st.unit} pulsado (${t.presses}) -> ${sku} / ${operador}`);
        emit("boton:pulsado", { unidad: st.unit, sku, operador });

        // Reserva SOLO las unidades de este job: otro puesto puede estar
        // probando lo suyo a la vez sin que se estorben.
        if (!tomar(hostsJob)) {
          console.log(`[boton] ${st.unit} ocupado con otra prueba, se ignora`);
          continue;
        }
        try {
          // El lote de la estacion manda; si no tiene, el que este abierto
          // para ese SKU. Un puesto secundario suele no llevar lote y no pasa
          // nada: la pieza queda registrada igual, marcada como parcial.
          const lote = decision.lote_id
            ? { id: decision.lote_id }
            : db.prepare(
                "SELECT id FROM lotes WHERE sku = ? AND closed_at IS NULL ORDER BY created_at DESC LIMIT 1"
              ).get(sku);
          const r = await ejecutarPrueba({
            sku, operador, lote_id: lote?.id ?? null,
            origen: `boton:${st.unit}`, tester_mac: u.mac,
            parcial: decision.parcial,
          });
          console.log(`[boton] ${st.unit} -> ${r.resultado} (${r.duracion_ms} ms)`);
        } catch (e) {
          console.log(`[boton] ${st.unit} ERROR: ${e?.message ?? e}`);
          emit("boton:error", { unidad: st.unit, error: String(e?.message ?? e) });
        } finally {
          soltar(hostsJob);
        }
      }
    } finally {
      sondeando = false;
    }
  }

  // CT32_SIN_BOTON=1 apaga el sondeo. Hace falta para levantar una segunda
  // instancia —probar un cambio, o una copia de los datos— sin que DOS bridges
  // vigilen los mismos equipos y una sola pulsacion dispare dos pruebas.
  if (process.env.CT32_SIN_BOTON) {
    console.log("[boton] sondeo desactivado (CT32_SIN_BOTON)");
  } else {
    setInterval(sondearBotones, 400);
  }

  // ── Estaciones ─────────────────────────────────────────────
  //
  // Un puesto de trabajo = un equipo con boton. El de la pantalla lleva datos
  // completos; los demas, lo que tengan. Lo que NO se hace es perder la pieza.
  app.get("/api/estaciones", (_req, res) => {
    const filas = db.prepare(`
      SELECT u.mac, u.unit, u.ip, u.notes,
             e.nombre, e.sku, e.operador, e.lote_id, e.updated_at
      FROM tester_units u LEFT JOIN estaciones e ON e.mac = u.mac
      ORDER BY u.unit
    `).all();

    res.json({
      ok: true,
      estaciones: filas.map((f) => {
        const v = vigilancia.get(f.mac) ?? {};
        const host = v.host || f.ip;
        const d = host ? resolverBoton(f.mac, host) : null;
        const ult = db.prepare(
          "SELECT id, sku, result, started_at, parcial FROM tests WHERE tester_mac = ? ORDER BY id DESC LIMIT 1"
        ).get(f.mac);
        return {
          ...f,
          con_boton: v.presses != null,
          pulsaciones: v.presses ?? null,
          correria: d?.job ? d.job.sku : null,
          parcial: d?.job ? !!d.parcial : null,
          motivo: d?.job ? null : d?.motivo ?? "sin IP conocida",
          candidatos: d?.candidatos ?? [],
          ultima: ult ?? null,
        };
      }),
    });
  });

  app.put("/api/estaciones/:mac", (req, res) => {
    const { nombre = null, sku = null, operador = null, lote_id = null, actor = "sistema" } = req.body ?? {};
    const u = db.prepare("SELECT mac FROM tester_units WHERE mac = ?").get(req.params.mac);
    if (!u) return res.status(404).json({ error: "esa unidad no está registrada" });

    db.prepare(`
      INSERT INTO estaciones(mac, nombre, sku, operador, lote_id, updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(mac) DO UPDATE SET
        nombre = excluded.nombre, sku = excluded.sku,
        operador = excluded.operador, lote_id = excluded.lote_id,
        updated_at = excluded.updated_at
    `).run(req.params.mac, nombre, sku, operador, lote_id, now());

    audit(actor, "estacion.config", "tester", req.params.mac,
          `sku=${sku ?? "-"} operador=${operador ?? "-"} lote=${lote_id ?? "-"}`);
    res.json({ ok: true });
  });

  // Que haria cada boton si se pulsara AHORA. Se puede comprobar sin pulsar.
  app.get("/api/boton/estado", (_req, res) => {
    res.json({
      ok: true,
      sku_activo: getSetting("sku_activo") || null,
      operador_activo: getSetting("operador_activo") || null,
      ocupadas: [...ocupadas],
      // TODAS las unidades registradas, no solo las ya sondeadas: la pregunta
      // "¿que corre el boton de este equipo?" tiene respuesta antes de la
      // primera vuelta del sondeo, y es la que hay que poder contestar.
      vigilando: db.prepare("SELECT mac, unit, ip FROM tester_units ORDER BY unit").all().map((u) => {
        const v = vigilancia.get(u.mac) ?? {};
        const host = v.host || u.ip;
        const d = host ? resolverBoton(u.mac, host) : null;
        return {
          mac: u.mac, unidad: u.unit, host,
          presses: v.presses ?? null,
          correria: d?.job ? d.job.sku : null,
          motivo: d?.job ? null : d?.motivo ?? "sin IP conocida",
          candidatos: d?.candidatos ?? [],
        };
      }),
    });
  });

  // ── Avanzado: osciloscopio lento ───────────────────────────
  //
  // Reserva las unidades del job igual que la prueba: son las mismas placas.
  //
  // Recibe el SKU y saca de SU job las unidades y el orden. Medir con otro
  // montaje daria numeros que parecen validos y no lo son.
  /**
   * Abre unidades para medir: por SKU, o por una lista de equipos a mano.
   *
   * POR QUE LAS DOS PUERTAS
   *
   * Exigir SKU dejaba sin herramientas justo cuando mas falta hacen: al montar
   * los modulos y comprobar que salieron bien, al cablear un socket nuevo, o
   * con un equipo sospechoso. En esos momentos NO HAY golden todavia — el
   * golden es el final del camino, no el principio.
   *
   * Con `hosts` se mide lo que haya conectado: 16 canales, 32+32, 32+32+32.
   * Sin golden no hay veredicto, y no hace falta: lo que se quiere es VER.
   *
   * El ORDEN de los hosts sigue importando, tambien aqui: define los nombres
   * de canal (M, L1, L2). Se respeta el que llegue.
   */
  const conUnidades = async ({ sku, hosts: hostsPedidos }, fn, res) => {
    let units = null;
    let reservados = [];
    try {
      let hosts = Array.isArray(hostsPedidos) ? hostsPedidos.filter(Boolean) : [];
      let job = null, g = null, fixture = null;

      if (!hosts.length) {
        if (!sku) return res.status(400).json({ error: "hacen falta un SKU o una lista de equipos" });
        job = db.prepare(
          "SELECT * FROM jobs WHERE sku = ? AND status = 'approved' ORDER BY approved_at DESC LIMIT 1"
        ).get(sku);
        if (!job) return res.status(404).json({ error: `${sku} no tiene ningún golden aprobado` });
        hosts = JSON.parse(job.hosts || "[]");
        if (!hosts.length) return res.status(422).json({ error: "el job no guardó las unidades" });
      }

      if (!tomar(hosts)) return res.status(409).json({ error: "ese equipo está ocupado" });
      reservados = hosts;

      units = await abrirUnidades(hosts);
      const n = totalCanales(units);

      if (job) {
        if (n !== job.channels) {
          throw new Error(`el job es de ${job.channels} canales y el montaje tiene ${n}`);
        }
        const gp = path.join(GOLD_DIR, `${job.golden}.json`);
        g = fs.existsSync(gp) ? JSON.parse(fs.readFileSync(gp, "utf8")) : null;
        fixture = g?.fixture ? cargarFixture(g.fixture) : null;
      }

      await fn({ units, n, job, golden: g, fixture, res });
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ error: String(e?.message ?? e) });
    } finally {
      if (units) for (const u of units) await u.release().catch(() => {});
      soltar(reservados);
    }
  };
  const conUnidadesDelSku = (sku, fn, res) => conUnidades({ sku }, fn, res);

  // Una linea: onda cuadrada y voltios reales.
  app.post("/api/avanzado/onda", (req, res) => {
    const { sku, hosts, a, b, ciclos } = req.body ?? {};
    conUnidades({ sku, hosts }, async ({ units, res: r }) => {
      const idx = new Map();
      for (let i = 0; i < totalCanales(units); i++) idx.set(chName(i, units), i);
      const ga = typeof a === "number" ? a : idx.get(a);
      const gb = typeof b === "number" ? b : idx.get(b);
      if (ga == null || gb == null) return r.status(400).json({ error: "canales no válidos" });
      r.json({ ok: true, ...(await onda(units, ga, gb, { ciclos: Number(ciclos) || 2 })) });
    }, res);
  });

  // Todas las lineas del golden, una tras otra.
  app.post("/api/avanzado/lineas", (req, res) => {
    const { sku, hosts } = req.body ?? {};
    conUnidades({ sku, hosts }, async ({ units, golden, res: r }) => {
      const n = totalCanales(units);
      const idx = new Map();
      for (let i = 0; i < n; i++) idx.set(chName(i, units), i);

      // Con golden se miden SUS lineas. Sin golden se barre y se miden las que
      // haya: es el caso de un arnes recien cableado, donde todavia no existe
      // referencia contra la que comparar y lo que se quiere es ver que hay.
      let pares;
      if (golden) {
        pares = golden.nets.filter((net) => net.length >= 2).map((net) => [net[0], net[1]]);
      } else {
        const conn = await barrer(units, (hecho, total) =>
          emit("medida:progreso", { fase: "avanzado", hecho, total }));
        const { nets } = construirNets(conn, n);
        pares = nets.filter((net) => net.length >= 2)
                    .map((net) => [chName(net[0], units), chName(net[1], units)]);
      }

      const lineas = [];
      for (const [na, nb] of pares) {
        const ga = idx.get(na), gb = idx.get(nb);
        if (ga == null || gb == null) continue;
        const o = await onda(units, ga, gb, { ciclos: 2, porNivel: 8 });
        lineas.push({
          a: o.a, b: o.b, ga, gb,
          alto: o.alto, bajo: o.bajo, tipo: o.tipo, explicacion: o.explicacion,
          traza: o.muestras.map((m) => ({ t: m.t, mv: m.mv, nivel: m.nivel })),
        });
        emit("medida:progreso", { fase: "avanzado", hecho: lineas.length, total: pares.length });
      }
      audit("avanzado", "lineas", sku ?? "(equipos sueltos)", null, `${lineas.length} línea(s)`);
      r.json({ ok: true, sku: sku ?? null, con_golden: !!golden, ms_por_muestra: 3.09, lineas });
    }, res);
  });

  /**
   * Barrido libre: que hay conectado AHORA, sin golden y sin veredicto.
   *
   * Es la vista previa antes de existir el producto: modulos recien montados,
   * un socket recien cableado, un arnes a medio rutear. No dice "bien" ni
   * "mal" —no hay contra que compararlo— dice QUE VE.
   *
   * Sirve tambien para el caso feo: con una placa con canales pegados a masa,
   * aqui se ven como aislados y se sabe antes de perder tiempo cableando.
   */
  app.post("/api/avanzado/barrido", (req, res) => {
    const { sku, hosts } = req.body ?? {};
    conUnidades({ sku, hosts }, async ({ units, res: r }) => {
      const n = totalCanales(units);
      const conn = await barrer(units, (hecho, total) =>
        emit("medida:progreso", { fase: "avanzado", hecho, total }));
      const { nets, aislados } = construirNets(conn, n);

      const porUnidad = units.map((u) => ({
        host: u.host, canales: u.n, base: u.base,
        etiqueta: u.index === 0 ? "M" : `L${u.index}`,
      }));

      audit("avanzado", "barrido", sku ?? "(equipos sueltos)", null,
            `${nets.length} conexiones, ${aislados.length} aislados en ${n} canales`);

      r.json({
        ok: true, canales: n, unidades: porUnidad,
        huella: huella(nets, aislados, units),
        conexiones: nets.map((net) => net.map((c) => chName(c, units))),
        aislados: aislados.map((c) => chName(c, units)),
      });
    }, res);
  });

  /**
   * Salud de los modulos, SIN arnes conectado.
   *
   * Un canal pegado a masa y un cable roto se ven IGUAL en el mapa: los dos
   * salen como aislado. Por eso esto se mide con el arnes FUERA — asi lo que
   * salga mal es de la placa, sin ambiguedad.
   */
  app.post("/api/avanzado/modulos", (req, res) => {
    const { sku, hosts } = req.body ?? {};
    conUnidades({ sku, hosts }, async ({ units, res: r }) => {
      const { malos, total } = await validarModulos(units, (hecho, t) =>
        emit("medida:progreso", { fase: "avanzado", hecho, total: t }));
      audit("avanzado", "modulos", sku ?? "(equipos sueltos)", null, `${malos.length}/${total} malos`);
      r.json({ ok: malos.length === 0, total, malos });
    }, res);
  });

  // Acoplamiento: lo que aparece en los canales al aire.
  app.post("/api/avanzado/acoplamiento", (req, res) => {
    const { sku, hosts, canal } = req.body ?? {};
    conUnidades({ sku, hosts }, async ({ units, res: r }) => {
      const idx = new Map();
      for (let i = 0; i < totalCanales(units); i++) idx.set(chName(i, units), i);
      const ga = typeof canal === "number" ? canal : idx.get(canal);
      if (ga == null) return r.status(400).json({ error: "canal no válido" });
      r.json({ ok: true, ...(await acoplamiento(units, ga)) });
    }, res);
  });

  // Donde duele: que lineas fallan mas, no cuantas piezas fallaron.
  //
  // Veinte fallos repartidos son ruido; veinte fallos en la MISMA linea son un
  // utillaje que hay que arreglar hoy. Por eso se agrupa por linea y no por
  // pieza.
  app.get("/api/diagnostico/patrones", (req, res) => {
    const { sku, desde, hasta } = req.query;
    const cond = ["t.result = 'FAIL'"], args = [];
    if (sku)   { cond.push("t.sku = ?");         args.push(sku); }
    if (desde) { cond.push("t.started_at >= ?"); args.push(desde); }
    if (hasta) { cond.push("t.started_at <= ?"); args.push(`${hasta}T23:59:59Z`); }

    const filas = db.prepare(
      `SELECT t.id, t.sku, t.started_at, t.faults FROM tests t WHERE ${cond.join(" AND ")}`
    ).all(...args);

    const porLinea = new Map();
    for (const f of filas) {
      let fallos = [];
      try { fallos = JSON.parse(f.faults || "[]"); } catch { continue; }
      for (const fa of fallos) {
        const clave = `${f.sku}|${fa.tipo}|${(fa.canales ?? []).join(",")}`;
        const prev = porLinea.get(clave) ?? {
          sku: f.sku, tipo: fa.tipo, texto: fa.texto,
          canales: fa.canales ?? [], veces: 0, ultima: null,
        };
        prev.veces += 1;
        if (!prev.ultima || f.started_at > prev.ultima) prev.ultima = f.started_at;
        porLinea.set(clave, prev);
      }
    }

    const total = db.prepare(
      `SELECT COUNT(*) c FROM tests t WHERE ${cond.join(" AND ").replace("t.result = 'FAIL'", "1=1")}`
    ).get(...args).c;

    res.json({
      patrones: [...porLinea.values()].sort((a, b) => b.veces - a.veces),
      piezas_fallidas: filas.length,
      piezas_total: total,
    });
  });

  app.get("/api/operadores", (_req, res) => {
    res.json({
      operadores: db.prepare(
        "SELECT DISTINCT operator FROM tests ORDER BY operator"
      ).all().map((r) => r.operator),
    });
  });
}
