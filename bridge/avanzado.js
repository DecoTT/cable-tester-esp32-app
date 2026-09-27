// avanzado.js — Osciloscopio lento y perfil de líneas.
//
// QUÉ ES Y QUÉ NO ES
//
// No es un osciloscopio de integridad de señal. **No hay diagrama de ojo**, ni
// tiempo de subida, ni jitter: eso necesita muestrear a GHz y aquí el techo son
// ~324 muestras por segundo.
//
// MEDIDO, no estimado: una petición con 44 `adc_rd` tarda 176 ms sobre 41 ms de
// red → 3,09 ms por muestra, y conmutar de MUX no cuesta nada extra. El límite
// es la media de 64 lecturas que hace el firmware por cada `adc_rd`. El RC de
// un arnés con 680 Ω son decenas de nanosegundos: a 3 ms de resolución el
// flanco ya ocurrió antes de la primera muestra, siempre.
//
// LO QUE SÍ MIDE, Y POR QUÉ VALE
//
// El discriminador no es el flanco: es el NIVEL y su ESTABILIDAD. Medido sobre
// el arnés rojo de la 8744:
//
//     J00 -> J16   3300 mV, desviación 0,0 mV   unida
//     J02 -> J18   1698 mV, desviación 304 mV   ABIERTA - flota y vaga
//
// Un pin conectado sigue al excitador y no se mueve. Uno al aire se mueve por
// acoplamiento — el mismo fenómeno que obligó a la doble muestra (§5 de
// CARACTERIZACION). Así que la desviación típica es el dato: distingue
// "conectado" de "al aire" mejor que el valor medio.
//
// Y sirve para algo que el veredicto PASS/FAIL no ve: un contacto INTERMITENTE.
// Sacudiendo el arnés mientras se muestrea, un crimp flojo salta a la vista en
// la traza aunque en una prueba suelta dé bien.
//
// LÍMITE DURO: 48 ops por petición (RAW_MAX_OPS). Pasarse no da error — el
// firmware TRUNCA en silencio y faltan muestras. Aquí se calcula para no
// llegar nunca.

import { locate, chName } from "./measure.js";

export const MAX_OPS = 48;
export const MS_POR_MUESTRA = 3.09;   // medido, ver cabecera

/** Media y desviación típica de una serie, en mV. */
function stats(xs) {
  if (!xs.length) return { media: null, sd: null, min: null, max: null };
  const media = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - media) ** 2, 0) / xs.length);
  return { media, sd, min: Math.min(...xs), max: Math.max(...xs) };
}

/**
 * Onda cuadrada: A excita, B escucha en alta impedancia.
 *
 * Si A y B están en la MISMA unidad, todo cabe en una petición y las muestras
 * salen pegadas. Si están en unidades distintas hay que partirlo —el excitador
 * mantiene el nivel entre peticiones, que es justo para lo que se diseñó
 * driveHold— y entonces cada semiciclo cuesta un viaje de red extra.
 */
export async function onda(units, ga, gb, { ciclos = 2, porNivel = 10 } = {}) {
  const A = locate(units, ga);
  const B = locate(units, gb);
  const mismaUnidad = A.u === B.u;

  const ladoA = A.local < 16 ? 0 : 1;
  const bitA  = A.local % 16;
  const ladoB = B.local < 16 ? 0 : 1;
  const chB   = B.local % 16;

  const muestras = [];
  let t = 0;

  const empujar = (vals, nivel) => {
    for (const mv of vals) {
      muestras.push({ t: Number(t.toFixed(2)), mv, nivel });
      t += MS_POR_MUESTRA;
    }
  };

  if (mismaUnidad) {
    // 2 de preparación + ciclos × 2 × (1 io_wr + porNivel adc_rd)
    const cabenPorNivel = Math.floor((MAX_OPS - 2 - ciclos * 2) / (ciclos * 2));
    const n = Math.min(porNivel, cabenPorNivel);

    const ops = [`io_dir ${ladoA} 0x0000`, `io_dir ${1 - ladoA} 0xFFFF`];
    const marcas = [];
    for (let c = 0; c < ciclos; c++) {
      for (const nivel of [1, 0]) {
        ops.push(`io_wr ${ladoA} ${nivel ? (1 << bitA) >>> 0 : 0}`);
        for (let k = 0; k < n; k++) { marcas.push({ i: ops.length, nivel }); ops.push(`adc_rd ${ladoB} ${chB}`); }
      }
    }
    const r = await A.u.raw(ops);
    for (const { i, nivel } of marcas) {
      muestras.push({ t: Number(t.toFixed(2)), mv: r[i], nivel });
      t += MS_POR_MUESTRA;
    }
  } else {
    // Entre unidades: excitar en una, muestrear en la otra.
    const n = Math.min(porNivel, MAX_OPS - 2);
    for (let c = 0; c < ciclos; c++) {
      for (const nivel of [1, 0]) {
        await A.u.driveHold(A.local, nivel === 1);
        const r = await B.u.raw([`io_dir 0 0xFFFF`, `io_dir 1 0xFFFF`,
                                 ...Array(n).fill(`adc_rd ${ladoB} ${chB}`)]);
        empujar(r.slice(2), nivel);
      }
    }
  }

  const altos = muestras.filter((m) => m.nivel === 1 && m.mv != null).map((m) => m.mv);
  const bajos = muestras.filter((m) => m.nivel === 0 && m.mv != null).map((m) => m.mv);
  const sa = stats(altos), sb = stats(bajos);

  // Veredicto por NIVEL y ESTABILIDAD, no por el flanco (ver cabecera).
  let tipo = "indefinido", explicacion = "";
  if (sa.media == null) {
    tipo = "error"; explicacion = "No se pudo leer el canal.";
  } else if (sa.media > 2500 && sb.media < 400 && sa.sd < 50) {
    tipo = "unida";
    explicacion = "El extremo lejano sigue al excitador y no se mueve: contacto firme.";
  } else if (sa.sd > 100) {
    tipo = "al_aire";
    explicacion = `Vaga ${sa.sd.toFixed(0)} mV entre muestras. Un pin conectado no se mueve; ` +
                  "esto es acoplamiento, o sea que el hilo NO llega.";
  } else if (sa.media < 500) {
    tipo = "abierta";
    explicacion = "El extremo lejano se queda a cero: el hilo no llega, o está pegado a masa.";
  } else {
    tipo = "resistiva";
    explicacion = `Nivel intermedio estable (${sa.media.toFixed(0)} mV): hay camino, pero con ` +
                  "resistencia — crimp flojo o contacto sucio.";
  }

  return {
    a: chName(ga, units), b: chName(gb, units),
    misma_unidad: mismaUnidad,
    ms_por_muestra: MS_POR_MUESTRA,
    muestras,
    alto: sa, bajo: sb,
    tipo, explicacion,
  };
}

/**
 * Acoplamiento: excita UN canal y mira lo que aparece en los demás, al aire.
 *
 * Es la medida del fantasma de §5 puesta a la vista: los canales al aire se
 * mueven por acoplamiento capacitivo con el excitado. No es un fallo — es la
 * razón de que haga falta la doble muestra.
 */
export async function acoplamiento(units, ga) {
  const A = locate(units, ga);
  const ladoA = A.local < 16 ? 0 : 1;
  const bitA  = A.local % 16;

  // Excitar A y dejar TODO lo demás como entrada (alta impedancia).
  await A.u.raw([
    `io_dir ${ladoA} ${(0xffff & ~(1 << bitA)) >>> 0}`,
    `io_dir ${1 - ladoA} 0xFFFF`,
    `io_wr  ${ladoA} ${(1 << bitA) >>> 0}`,
    "delay_us 2000",
  ]);

  const filas = [];
  for (const u of units) {
    // 16 lecturas por petición y lado: lejos del techo de 48 ops.
    for (const lado of [0, 1]) {
      const r = await u.raw(Array.from({ length: 16 }, (_, i) => `adc_rd ${lado} ${i}`));
      r.forEach((mv, i) => {
        const g = u.base + lado * 16 + i;
        if (g === ga) return;
        filas.push({ canal: chName(g, units), g, mv });
      });
    }
  }
  for (const u of units) await u.release();

  return {
    excitado: chName(ga, units),
    lineas: filas.sort((x, y) => (y.mv ?? 0) - (x.mv ?? 0)),
  };
}
