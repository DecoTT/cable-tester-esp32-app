// measure.js — Motor de medida, orquestado desde la PC.
//
// La PC habla con CADA unidad por HTTP. No hay master ni hijos, ni ESP-NOW de
// por medio: no hay canales que sincronizar ni emparejamiento. Cuando algo
// falla, dice QUE unidad y QUE error.
//
// Portado de tools/sweep.py y tools/analog.py del proyecto CableTester32, que
// se validaron contra hardware real. Los comentarios marcados MEDIDO recogen
// medidas concretas: no son suposiciones y no conviene "simplificarlos".

import crypto from "node:crypto";

export const CH_PER_UNIT = 32;

// Umbrales, heredados de config.h del firmware para que PC y ESP32 digan lo mismo.
export const R_SERIES = 680.0;
export const VREF = 3.3;
export const RC_OK = 5.0;      // conexion sana
export const RC_WARN = 50.0;   // sospechosa: crimp flojo o soldadura fria
export const LEAK_OK_V = 3.0;  // por encima, sin fuga

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Una unidad ───────────────────────────────────────────────
export class Unit {
  constructor(host, index, base = 0, channels = CH_PER_UNIT) {
    this.host = host;
    this.index = index;
    this.base = base;          // primer canal global de esta unidad
    this.n = channels;         // canales POBLADOS (16 o 32)
  }

  static async open(host, index, base) {
    let n = CH_PER_UNIT;
    try {
      const r = await fetch(`http://${host}/api/status`, {
        signal: AbortSignal.timeout(6000),
      });
      n = (await r.json()).channels ?? CH_PER_UNIT;
    } catch { /* si no contesta, se asume 32 y ya fallara al medir */ }
    return new Unit(host, index, base, n);
  }

  /**
   * Ejecuta ops (una por linea) y devuelve los resultados.
   *
   * Van en UNA peticion a proposito: una secuencia dir -> wr -> rd partida a
   * la mitad no mide nada, asi que el firmware las ejecuta sin ceder el control.
   *
   * Con reintentos: una peticion perdida no puede tirar un barrido de 30 s. Es
   * seguro repetirlas porque son idempotentes — fijan estado y leen, no
   * acumulan. El nivel de excitacion lo sostiene la unidad dueña entre
   * peticiones.
   */
  async raw(ops, timeoutMs = 10000) {
    const body = ops.join("\n");
    let ultimo;
    for (let intento = 0; intento < 3; intento++) {
      try {
        const r = await fetch(`http://${this.host}/api/raw`, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (d.error) throw new Error(`U${this.index} (${this.host}): ${d.error}`);
        return d.results;
      } catch (e) {
        ultimo = e;
        await sleep(200 * (intento + 1));
      }
    }
    throw new Error(`U${this.index} (${this.host}) no responde tras 3 intentos: ${ultimo?.message ?? ultimo}`);
  }

  /**
   * Dos muestras de la misma fase, en UNA peticion.
   *
   * MEDIDO: con todo desconectado aparecia un net fantasma en ~2 de cada 8
   * barridos, siempre en canales al aire. Un pin conectado SIGUE al driver
   * siempre; uno al aire se mueve por acoplamiento y NO repite. Exigiendo que
   * las dos lecturas coincidan: 10 de 10 barridos identicos.
   *
   * Las dos van juntas para no pagar el viaje de red dos veces.
   *
   * OJO: el firmware devuelve la mascara como entero CON signo, asi que una
   * mascara con el bit 31 puesto (canal J_SP excitado) llega negativa. Se
   * normaliza aqui; null significa error de verdad, un negativo no.
   */
  async sample2(driveCh, level) {
    const op = `sample ${driveCh + 1} ${level ? 1 : 0}`;
    const r = await this.raw([op, op]);
    if (r[0] === null || r[1] === null) return null;
    const a = r[0] >>> 0, b = r[1] >>> 0;
    // Para "alto" se exige alto en las dos (AND); para "bajo", bajo en las dos
    // (OR, que deja 0 solo si ambas lo son).
    return level ? (a & b) >>> 0 : (a | b) >>> 0;
  }

  /** Lee una sola vez, sin excitar. Para el aprendizaje de socket. */
  async escuchar() {
    const r = await this.raw(["sample 0 1"]);
    return r[0] === null ? null : r[0] >>> 0;
  }

  /** Excita un canal y lo MANTIENE mientras las demas muestrean. */
  async driveHold(ch, level) {
    const u = ch < 16 ? 0 : 1;
    const bit = ch < 16 ? ch : ch - 16;
    await this.raw([
      `io_dir ${u} ${(0xffff & ~(1 << bit)) >>> 0}`,
      `io_dir ${1 - u} 0xFFFF`,
      `io_wr  ${u} ${level ? (1 << bit) >>> 0 : 0}`,
      "delay_us 1000",
    ]);
  }

  async setLine(ch, mode) {
    const u = ch < 16 ? 0 : 1;
    const bit = ch < 16 ? ch : ch - 16;
    if (mode === "z") {
      await this.raw(["io_dir 0 0xFFFF", "io_dir 1 0xFFFF"]);
      return;
    }
    await this.raw([
      `io_dir ${u} ${(0xffff & ~(1 << bit)) >>> 0}`,
      `io_dir ${1 - u} 0xFFFF`,
      `io_wr  ${u} ${mode === "hi" ? (1 << bit) >>> 0 : 0}`,
      "delay_us 2000",
    ]);
  }

  /** ADC del canal local, en voltios. Crudo, sin corregir ganancia. */
  async volts(ch) {
    const side = ch < 16 ? 0 : 1;
    const r = await this.raw([`adc_rd ${side} ${ch % 16}`]);
    return r[0] === null ? null : r[0] / 1000.0;
  }

  /**
   * Enciende los LEDs de esta unidad. mascara de 10 bits.
   *
   * OJO con el orden: van INTERCALADOS verde/rojo por canal, no "5 rojos y
   * luego 5 verdes". El mapa estaba mal en el firmware hasta la v1.4.0 y pedir
   * "todos rojos" encendia una mezcla. Ver config.h.
   *
   *   bit 2r   = verde del rango r      bit 2r+1 = rojo del rango r
   */
  leds(mascara) {
    return this.raw([`leds ${mascara >>> 0}`]).catch(() => {});
  }

  /**
   * Apaga el LED RGB del modulo.
   *
   * Cuelga de IO8, que es TAMBIEN el reloj del I2C: cada transaccion del bus le
   * mete pulsos que el LED interpreta como color. Por eso se enciende "al azar"
   * — no es azar, es el trafico. Solo se puede apagar con el bus en reposo, asi
   * que se llama al terminar una medida, nunca a mitad.
   *
   * En el uso normal NO hace falta llamarla: release() ya apaga el RGB. Esta
   * queda para los casos sueltos — al abrir la unidad, o desde diagnostico.
   */
  rgbOff() {
    return this.raw(["rgb_off"]).catch(() => {});
  }

  /**
   * Deja la unidad en reposo: expansores sin excitar y RGB apagado.
   *
   * El rgb_off va DENTRO de esta secuencia, y de ultimo, a proposito:
   *
   *  - Reposo incluye el RGB. El LED cuelga de IO8, que es el reloj del I2C,
   *    asi que al terminar una medida se queda encendido con la basura del
   *    bus. Si apagarlo fuera un paso aparte habria que acordarse en cada
   *    camino nuevo, y ya paso: de los cinco sitios que sueltan el bus
   *    (barrido, resistencias, modulos, clasificar aislado, socket) solo el
   *    barrido lo apagaba.
   *  - De ultimo porque rgb_off hace Wire.end() y Wire.begin(): pulsar IO8 a
   *    mitad de una secuencia corromperia la transaccion en curso.
   *  - En la MISMA peticion que el release, no en otra: no cuesta ni un
   *    viaje de red extra.
   */
  release() {
    return this.raw(["io_dir 0 0x0000", "io_wr 0 0x0000", "io_dir 1 0xFFFF",
                     "rgb_off"])
      .catch(() => {});
  }
}

export async function abrirUnidades(hosts) {
  const units = [];
  let base = 0;
  for (let i = 0; i < hosts.length; i++) {
    const u = await Unit.open(hosts[i], i, base);
    base += u.n;
    units.push(u);
  }
  // Estado conocido al tomar el control: la unidad puede venir con el RGB
  // encendido del arranque del firmware o de una sesion anterior que murio
  // sin soltar el bus. Aqui no hay medida en curso, asi que es seguro.
  for (const u of units) await u.rgbOff();
  return units;
}

export function totalCanales(units) {
  return units.reduce((a, u) => a + u.n, 0);
}

export function locate(units, g) {
  for (const u of units) {
    if (g >= u.base && g < u.base + u.n) return { u, local: g - u.base };
  }
  throw new Error(`canal ${g} fuera de rango`);
}

/** Nombre interno del canal: M.J00, L1.J_SP... Ver fixture.js para el fisico. */
export const LED_RANGOS = 5;

/** Limites del rango r sobre los 32 canales de una unidad: 7,7,6,6,6. */
export function limitesRango(r) {
  const inicio = [0, 7, 14, 20, 26, 32];
  return r >= LED_RANGOS ? [0, 0] : [inicio[r], inicio[r + 1] - 1];
}

export const LED_VERDE = (r) => 1 << (2 * r);
export const LED_ROJO  = (r) => 1 << (2 * r + 1);

/**
 * Mascara de LEDs de una unidad a partir de los canales en fallo.
 *
 * Los 32 canales se reparten en 5 zonas (7,7,6,6,6). La zona que contiene algun
 * canal en fallo se pone ROJA; el resto, VERDE. Si no hay ningun fallo quedan
 * los cinco verdes, que es la señal que el operador ve de lejos.
 */
export function ledsDeFallos(unit, canalesMalos) {
  const locales = new Set(
    canalesMalos.filter((g) => g >= unit.base && g < unit.base + unit.n)
                .map((g) => g - unit.base));
  let m = 0;
  for (let r = 0; r < LED_RANGOS; r++) {
    const [lo, hi] = limitesRango(r);
    let falla = false;
    for (let c = lo; c <= hi && !falla; c++) if (locales.has(c)) falla = true;
    m |= falla ? LED_ROJO(r) : LED_VERDE(r);
  }
  return m;
}

export function chName(g, units) {
  for (const u of units) {
    if (g >= u.base && g < u.base + u.n) {
      const local = g - u.base;
      const pin = local === 31 ? "J_SP" : `J${String(local).padStart(2, "0")}`;
      return `${u.index === 0 ? "M" : `L${u.index}`}.${pin}`;
    }
  }
  return `?${g}`;
}

// ── Barrido ──────────────────────────────────────────────────
/**
 * Excita UN canal y escucha en TODOS los demas, en todas las unidades,
 * incluida la suya. La unica exclusion es el canal excitado.
 *
 * Por eso detecta sin distincion: CN1<->CN2 en la misma placa, CN1<->CN1 en la
 * misma placa, entre unidades, un canal unido a 3 o mas, y arneses sin parejas.
 * No se asume ninguna topologia.
 */
export async function barrer(units, onProgress) {
  const n = totalCanales(units);
  const conn = Array.from({ length: n }, () => new Set());

  for (let src = 0; src < n; src++) {
    const { u: owner, local } = locate(units, src);
    const masks = new Map();

    for (const level of [true, false]) {
      // El dueño excita y SOSTIENE: las demas leen mientras tanto, y el desfase
      // entre ellas da igual porque el nivel se mantiene.
      await owner.driveHold(local, level);
      for (const u of units) {
        const m = await u.sample2(u === owner ? local : -1, level);
        if (!masks.has(u.index)) masks.set(u.index, {});
        masks.get(u.index)[level ? "hi" : "lo"] = m;
      }
    }

    // Conectado si SIGUIO las dos transiciones. Un pin flotante retiene la
    // precarga y por eso falla una de las dos.
    for (const [ui, ph] of masks) {
      if (ph.hi === null || ph.lo === null) {
        throw new Error(`I2C caido en U${ui} con ${chName(src, units)}`);
      }
      const unit = units[ui];
      for (let b = 0; b < unit.n; b++) {
        const g = unit.base + b;
        if (g === src) continue;
        if (((ph.hi >>> b) & 1) && !((ph.lo >>> b) & 1)) {
          conn[src].add(g);
          conn[g].add(src);
        }
      }
    }

    // Animacion de avance en los LEDs rojos/verdes.
    //
    // Se usan estos y NO el RGB del modulo: el RGB comparte pin con el reloj
    // del I2C, y animarlo durante la medida corromperia lecturas sin dar
    // ningun error — el peor tipo de fallo.
    //
    // La zona encendida sigue el avance del barrido, asi que el operador ve
    // por donde va sin mirar la pantalla.
    if (src % 8 === 7) {
      if (onProgress) onProgress(src + 1, n);
      const zona = Math.min(LED_RANGOS - 1, Math.floor((src / n) * LED_RANGOS));
      const patron = LED_VERDE(zona);
      for (const u of units) await u.leds(patron);
    }
  }

  for (const u of units) await u.release();   // release ya apaga el RGB
  return conn;
}

/** Union-find: agrupa canales en nets. */
export function construirNets(conn, n) {
  const padre = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    while (padre[x] !== x) { padre[x] = padre[padre[x]]; x = padre[x]; }
    return x;
  };
  for (let i = 0; i < n; i++) {
    for (const j of conn[i]) {
      const a = find(i), b = find(j);
      if (a !== b) padre[b] = a;
    }
  }
  const grupos = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!grupos.has(r)) grupos.set(r, []);
    grupos.get(r).push(i);
  }
  const nets = [...grupos.values()].filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0]);
  const aislados = [...grupos.values()].filter((g) => g.length === 1)
    .map((g) => g[0]).sort((a, b) => a - b);
  return { nets, aislados };
}

/**
 * Huella del resultado COMPLETO: nets Y aislados.
 *
 * Los aislados TIENEN que entrar. Si la huella solo cubre los nets, un barrido
 * con 0 nets produce la huella de la cadena vacia, y comparar repeticiones deja
 * de comparar nada: sale "identicas" aunque los aislados cambien. Paso justo eso.
 */
export function huella(nets, aislados, units) {
  const cuerpo =
    nets.map((net) => net.map((c) => chName(c, units)).join(" ")).join("\n") +
    "\nAISLADOS: " + aislados.map((c) => chName(c, units)).join(" ");
  return crypto.createHash("md5").update(cuerpo).digest("hex").slice(0, 8);
}

// ── Medida analogica ─────────────────────────────────────────
function rDeDelta(va, vb) {
  const d = va - vb;
  if (d >= VREF) return Infinity;
  return (1360.0 * d) / (VREF - d);   // puede salir negativo: hace falta al promediar
}

export function rFuga(v) {
  if (v >= VREF - 0.01) return Infinity;
  if (v <= 0.001) return 0.0;
  return (R_SERIES * v) / (VREF - v);
}

/**
 * Resistencia midiendo en LOS DOS SENTIDOS y promediando.
 *
 * MEDIDO: en un sentido salian 21.8 ohm en las 32 lineas de un arnes bueno; en
 * el otro, 0.0. El desajuste era constante (~11 ohm) y NO era resistencia: era
 * la diferencia de ganancia entre los ADC de las dos placas.
 *
 * El metodo es diferencial para que el error del ADC se cancele, pero eso solo
 * vale si es el MISMO ADC. Entre unidades hay dos chips distintos y el sesgo se
 * cuela como resistencia falsa. Con el umbral en 5 ohm, el tester marcaba el
 * 100% de las lineas SANAS.
 *
 * Verificado en dos montajes: sesgo 0 ohm dentro de una placa, ~22 entre placas.
 */
export async function rBidir(ua, la, ub, lb) {
  await ua.setLine(la, "hi"); await ub.setLine(lb, "lo");
  const rIda = rDeDelta(await ua.volts(la), await ub.volts(lb));
  await ub.setLine(lb, "hi"); await ua.setLine(la, "lo");
  const rVta = rDeDelta(await ub.volts(lb), await ua.volts(la));
  return { r: Math.max(0, (rIda + rVta) / 2), sesgo: (rIda - rVta) / 2 };
}

/**
 * Resistencia de cada pareja limpia.
 *
 * MEDIDO en un arnes golden real: una linea a 116 ohm frente a 1.0 de sus
 * vecinas, y ademas intermitente. Digitalmente decia "conectada" — con 680 ohm
 * en serie, 116 de mas dejan pasar el nivel logico igual. Un tester de sola
 * continuidad la habria aprobado, y en planta habria fallado a ratos.
 */
export async function medirResistencias(nets, units) {
  const out = [];
  for (const net of nets) {
    if (net.length !== 2) continue;
    const [ga, gb] = net;
    const A = locate(units, ga), B = locate(units, gb);
    const { r, sesgo } = await rBidir(A.u, A.local, B.u, B.local);
    out.push({
      linea: `${chName(ga, units)}<->${chName(gb, units)}`,
      a: ga, b: gb, r, sesgo,
      estado: r > RC_WARN ? "alta" : r > RC_OK ? "sospechosa" : "ok",
    });
  }
  for (const u of units) await u.release();
  return out;
}

/**
 * Salud de los modulos, SIN arnes.
 *
 * Es el primer paso de cualquier puesta en marcha y es BLOQUEANTE: sin esto no
 * hay forma de saber si un canal aislado es culpa del arnes o de la placa,
 * porque los dos se ven IGUAL en el mapa. Y si se captura un golden con una
 * placa defectuosa, el defecto queda congelado dentro del patron de referencia
 * y el tester deja de vigilar esas lineas PARA SIEMPRE.
 */
export async function validarModulos(units, onProgress) {
  const malos = [];
  const total = totalCanales(units);
  for (let g = 0; g < total; g++) {
    const { u, local } = locate(units, g);
    for (const o of units) if (o !== u) await o.setLine(0, "z");
    await u.setLine(local, "hi");
    const v = await u.volts(local);
    if (v === null || v < LEAK_OK_V) {
      malos.push({ canal: chName(g, units), g, v, r: v === null ? -1 : rFuga(v) });
    }
    if (onProgress && (g % 8 === 7)) onProgress(g + 1, total);
  }
  for (const u of units) await u.release();
  return { malos, total };
}

/**
 * Clasifica un canal aislado: abierto o pegado a masa.
 *
 * El mapa NO los distingue — los dos salen como "aislado". Para el operador la
 * diferencia lo es todo: un abierto es un crimp mal hecho, un corto a GND es un
 * pin corrido o una rebaba, y se arreglan distinto.
 */
export async function clasificarAislado(units, g) {
  const { u, local } = locate(units, g);
  for (const o of units) if (o !== u) await o.setLine(0, "z");
  await u.setLine(local, "hi");
  const v = await u.volts(local);
  await u.release();
  if (v === null) return { canal: chName(g, units), tipo: "error" };
  return {
    canal: chName(g, units), g, v,
    tipo: v < LEAK_OK_V ? "gnd" : "abierto",
    r: rFuga(v),
  };
}
