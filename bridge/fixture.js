// fixture.js — Traduccion de canal interno a posicion FISICA, y el
//               aprendizaje de socket que la construye.
//
// EL PROBLEMA QUE RESUELVE
//
// El motor de medida habla en coordenadas internas del tester: "M.J11",
// "L1.J14". Eso no le dice nada a nadie. Un operador —ni un ingeniero— no sabe
// a que conector ir, a que pin, ni si falta un cable o esta mal crimpeado.
//
// El arnes no se conecta a CN1/CN2 del tester: se conecta a los JST del modulo
// de cable (CN11, CN12, CN13, CN15, CN18...). Entre medias hay un ruteo que
// nadie recuerda y que cambia por fixture.
//
// COMO SE APRENDE
//
// En vez de deducirlo del esquematico —que se equivoca y envejece— se MIDE: el
// operador mete 3.3 V con una punta en cada pin del JST, el tester detecta que
// canal se puso alto, pita, y se anota la pareja. Recorrido el socket entero,
// la tabla esta completa y es la del fixture REAL, no la del dibujo.
//
// De paso valida el socket: si en un conector de 10 posiciones solo pitan 9,
// hay un contacto muerto y se sabe antes de montar ningun arnes.
//
// El tester solo ESCUCHA, no excita: la tension la pone el operador. Por eso no
// hace falta firmware nuevo — la primitiva 'sample' precarga todo en bajo y lee,
// asi que el pin con tension salta y los demas se quedan.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db.js";
import { chName, totalCanales, locate } from "./measure.js";

const FIX_DIR = path.join(DATA_DIR, "fixtures");

function asegurarDir() {
  if (!fs.existsSync(FIX_DIR)) fs.mkdirSync(FIX_DIR, { recursive: true });
}

export function listarFixtures() {
  asegurarDir();
  return fs.readdirSync(FIX_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(FIX_DIR, f), "utf8"));
        return {
          id: f.replace(/\.json$/, ""),
          nombre: d.nombre ?? f,
          creado: d.creado ?? null,
          pines: Object.keys(d.mapa ?? {}).length,
          conectores: [...new Set(Object.values(d.mapa ?? {}).map((v) => v.conector))],
        };
      } catch { return null; }
    })
    .filter(Boolean);
}

export function cargarFixture(id) {
  asegurarDir();
  const p = path.join(FIX_DIR, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function guardarFixture(id, datos) {
  asegurarDir();
  fs.writeFileSync(path.join(FIX_DIR, `${id}.json`),
                   JSON.stringify(datos, null, 2), "utf8");
  return datos;
}

/**
 * Nombre FISICO de un canal. Si no hay fixture, devuelve el interno.
 *
 * Se deja ver el interno entre parentesis a proposito: al depurar hace falta
 * poder cruzarlo con el esquematico del tester.
 */
export function nombreFisico(g, units, fixture) {
  const interno = chName(g, units);
  const e = fixture?.mapa?.[interno];
  if (!e) return { texto: interno, interno, fisico: null };
  const fisico = `${e.conector}.${e.pin}`;
  return {
    texto: e.etiqueta ? `${fisico} (${e.etiqueta})` : fisico,
    interno, fisico, conector: e.conector, pin: e.pin, etiqueta: e.etiqueta ?? null,
  };
}

/** "CN15.3 <-> CN12.7" en vez de "M.J11 <-> L1.J14". */
export function describirLinea(ga, gb, units, fixture) {
  const A = nombreFisico(ga, units, fixture);
  const B = nombreFisico(gb, units, fixture);
  return {
    texto: `${A.texto} <-> ${B.texto}`,
    a: A, b: B,
    completo: !!(A.fisico && B.fisico),
  };
}

// ── Sesion de aprendizaje / validacion de socket ─────────────
//
// Mantiene el estado de un recorrido: que conector se esta haciendo, cuantos
// pines lleva, y que canales se han visto. Emite un evento por cada deteccion
// NUEVA para que la UI pite.
export class SesionSocket {
  /**
   * @param {Unit[]} units
   * @param {(ev:object)=>void} emit  callback de eventos para la UI
   */
  constructor(units, emit) {
    this.units = units;
    this.emit = emit;
    this.mapa = {};            // canal interno -> {conector, pin, etiqueta}
    this.conector = null;      // conector en curso
    this.esperados = 0;        // cuantos pines deberia tener
    this.detectados = [];      // [{pin, canal}] del conector en curso
    this.vistos = new Set();   // canales ya asignados, para no repetir
    this.corriendo = false;
    this._t = null;
  }

  empezarConector(nombre, esperados) {
    this.conector = nombre;
    this.esperados = Number(esperados) || 0;
    this.detectados = [];
    this.emit({ tipo: "conector", conector: nombre, esperados: this.esperados });
  }

  /**
   * Cierra el conector en curso y dice si el socket esta bien.
   *
   * Aqui esta el valor de validacion: si un CN de 10 posiciones solo dio 9
   * detecciones, hay un contacto muerto — y se sabe ANTES de montar un arnes y
   * de pelearse con un fallo intermitente.
   */
  cerrarConector() {
    const n = this.detectados.length;
    const ok = this.esperados === 0 || n === this.esperados;
    const res = {
      tipo: "conector_fin",
      conector: this.conector,
      detectados: n,
      esperados: this.esperados,
      ok,
      faltan: this.esperados ? Math.max(0, this.esperados - n) : 0,
      pines: this.detectados,
    };
    this.emit(res);
    this.conector = null;
    return res;
  }

  async _tick() {
    if (!this.corriendo) return;
    try {
      for (const u of this.units) {
        const m = await u.escuchar();
        if (m === null) continue;
        for (let b = 0; b < u.n; b++) {
          if (!((m >>> b) & 1)) continue;
          const g = u.base + b;
          const interno = chName(g, this.units);
          if (this.vistos.has(interno)) continue;   // ya anotado

          this.vistos.add(interno);
          const pin = this.detectados.length + 1;
          this.detectados.push({ pin, canal: interno, g });
          if (this.conector) {
            this.mapa[interno] = { conector: this.conector, pin };
          }
          // La UI pita con esto. El operador confirma de oido que ese pin ya
          // quedo, sin apartar la vista del conector.
          this.emit({
            tipo: "detectado",
            conector: this.conector, pin, canal: interno, g,
            llevan: this.detectados.length, esperados: this.esperados,
          });
        }
      }
    } catch (e) {
      this.emit({ tipo: "error", mensaje: String(e.message ?? e) });
    }
    if (this.corriendo) this._t = setTimeout(() => this._tick(), 120);
  }

  arrancar() {
    if (this.corriendo) return;
    this.corriendo = true;
    this.emit({ tipo: "arrancado" });
    this._tick();
  }

  parar() {
    this.corriendo = false;
    if (this._t) clearTimeout(this._t);
    this._t = null;
    for (const u of this.units) u.release().catch(() => {});
    this.emit({ tipo: "parado" });
  }

  /** Olvida el ultimo pin detectado — para cuando la punta resbala. */
  deshacer() {
    const ult = this.detectados.pop();
    if (!ult) return null;
    this.vistos.delete(ult.canal);
    delete this.mapa[ult.canal];
    this.emit({ tipo: "deshecho", ...ult, llevan: this.detectados.length });
    return ult;
  }

  aFixture(nombre) {
    return {
      nombre,
      creado: new Date().toISOString(),
      unidades: this.units.map((u) => ({ host: u.host, canales: u.n })),
      mapa: this.mapa,
    };
  }
}
