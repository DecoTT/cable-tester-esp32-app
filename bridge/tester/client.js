// client.js — Un tester, dos transportes, una interfaz.
//
// El resto del bridge llama status() / getGolden() / setGolden() / runTest()
// sin saber si el tester esta en la LAN o colgado por USB. Ambos transportes
// hablan el MISMO contrato JSON del firmware (docs/API.md, "api": 1).
//
// Regla: NUNCA se parsea el texto de /cmd. Solo /api/* (HTTP) y api_* (serial).

import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

export const API_VERSION_SUPPORTED = 1;

// ── Transporte HTTP (LAN) ────────────────────────────────────
class HttpTransport {
  constructor(host, port = 80) {
    this.base = `http://${host}:${port}`;
    this.kind = "http";
    this.label = `${host}:${port}`;
  }

  async get(path) {
    const r = await fetch(`${this.base}${path}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${path}`);
    return r.json();
  }

  async post(path, body, contentType = "text/plain") {
    const r = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${path}`);
    return r.json();
  }

  /**
   * Manda una linea de consola y DESCARTA la respuesta.
   *
   * La regla de la cabecera sigue en pie: el texto de /cmd no se parsea, ni
   * aqui ni en quien llame. Se usa solo como canal de ESCRITURA para lo que
   * todavia no tiene endpoint JSON, y el resultado se confirma releyendo
   * /api/status — que si es contrato versionado.
   */
  async cmd(line) {
    await fetch(`${this.base}/cmd`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: line,
      signal: AbortSignal.timeout(8000),
    });
  }

  status()          { return this.get("/api/status"); }
  getGolden()       { return this.get("/api/golden"); }
  setGolden(body)   { return this.post("/api/golden", body); }
  runTest()         { return this.post("/api/test", ""); }
  lastTest()        { return this.get("/api/test/last"); }
  selfCheck()       { return this.get("/api/selfcheck"); }
  captureMap()      { return this.get("/api/map"); }
  close()           {}
}

// ── Transporte serial (USB) ──────────────────────────────────
// El firmware contesta a api_status / api_golden / api_golden_set con el
// mismo JSON que HTTP, en una sola linea que empieza por '{'.
class SerialTransport {
  constructor(path, baud = 115200) {
    this.path = path;
    this.baud = baud;
    this.kind = "serial";
    this.label = path;
    this.port = null;
    this.parser = null;
    this.queue = Promise.resolve();   // un comando a la vez
  }

  async open() {
    if (this.port?.isOpen) return;
    this.port = new SerialPort({
      path: this.path, baudRate: this.baud, autoOpen: false,
      // El ESP32-C3 usa USB nativo: activar DTR/RTS deja IO9 bajo y lo
      // manda al bootloader. Se abren en falso.
      rtscts: false,
    });
    await new Promise((res, rej) => this.port.open(e => (e ? rej(e) : res())));
    await new Promise((res) => this.port.set({ dtr: false, rts: false }, () => res()));
    this.parser = this.port.pipe(new ReadlineParser({ delimiter: "\n" }));
    await new Promise(r => setTimeout(r, 400));   // el CDC tarda en quedar listo
  }

  // Manda una linea y devuelve la primera linea de respuesta que sea JSON.
  _cmd(line, timeoutMs = 8000) {
    const run = () => new Promise(async (resolve, reject) => {
      try { await this.open(); } catch (e) { return reject(e); }
      const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout esperando JSON a '${line}'`)); }, timeoutMs);
      const onData = (l) => {
        const t = String(l).trim();
        if (!t.startsWith("{")) return;          // eco, banner, texto humano: ignorar
        try { const j = JSON.parse(t); cleanup(); resolve(j); } catch { /* linea parcial */ }
      };
      const cleanup = () => { clearTimeout(timer); this.parser.off("data", onData); };
      this.parser.on("data", onData);
      this.port.write(line + "\n");
    });
    // serializar: el firmware procesa un comando por vuelta de loop()
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  status()        { return this._cmd("api_status"); }
  getGolden()     { return this._cmd("api_golden"); }
  setGolden(body) { return this._cmd("api_golden_set " + body.replace(/\n/g, ";"), 15000); }
  // Estas tres barren hasta 96 canales: hasta ~5 s en 3 unidades.
  runTest()       { return this._cmd("api_test",      30000); }
  lastTest()      { return this._cmd("api_last"); }
  selfCheck()     { return this._cmd("api_selfcheck", 30000); }
  captureMap()    { return this._cmd("api_map",       30000); }
  close()         { try { this.port?.close(); } catch {} this.port = null; }
}

// ── Cliente publico ──────────────────────────────────────────
export class TesterClient {
  /** @param {{host?:string, port?:number, serialPath?:string}} opts */
  constructor(opts) {
    if (opts.serialPath) this.t = new SerialTransport(opts.serialPath);
    else if (opts.host)  this.t = new HttpTransport(opts.host, opts.port ?? 80);
    else throw new Error("TesterClient: falta host o serialPath");
    this.kind  = this.t.kind;
    this.label = this.t.label;
  }

  /** Estado completo + verificacion de version de API. */
  async status() {
    const s = await this.t.status();
    if (s.api !== API_VERSION_SUPPORTED) {
      throw new Error(`Tester ${this.label}: API ${s.api}, el bridge soporta ${API_VERSION_SUPPORTED}. Actualiza firmware o bridge.`);
    }
    return s;
  }

  getGolden() { return this.t.getGolden(); }

  /**
   * Empuja un job. nets = Uint8Array/Buffer/array de net_id por canal.
   * Devuelve la respuesta del firmware, con el CRC de lo que quedo grabado.
   */
  async setGolden({ sku, job, meta, nets }) {
    const body = [
      `sku=${sku ?? ""}`,
      `job=${job ?? ""}`,
      `meta=${meta ?? ""}`,
      `nets=${Array.from(nets).join(",")}`,
    ].join("\n");
    const r = await this.t.setGolden(body);
    if (!r.ok) throw new Error(`El tester rechazo el golden: ${r.error || "sin detalle"}`);
    return r;
  }

  /**
   * Configura el disparador fisico (switch que ejecuta la prueba).
   *
   * pin = null lo desactiva. El firmware lo guarda en NVS, asi que sobrevive a
   * reinicios y a un OTA.
   *
   * POR QUE ESTO NO ES UN POST A /api/... : el firmware todavia no expone
   * endpoint JSON para escribirlo, solo el comando de consola. Se manda por
   * /cmd sin mirar su respuesta y se VERIFICA releyendo /api/status: si el
   * firmware lo rechazo —pin ocupado por el I2C o por los 595— el estado no
   * cambia y esto falla con un mensaje claro, en vez de dar por buena una
   * escritura que no ocurrio.
   */
  async setTrigger(pin, activeLow = true, mode = "avisar") {
    if (typeof this.t.cmd !== "function") {
      throw new Error("Este transporte no admite configurar el disparador");
    }
    await this.t.cmd(pin == null
      ? "trigger off"
      : `trigger ${pin} ${activeLow ? "low" : "high"} ${mode === "local" ? "local" : "avisar"}`);

    const s = await this.status();
    const real = s.trigger ?? { pin: -1, active_low: true };
    const esperado = pin == null ? -1 : Number(pin);
    if (real.pin !== esperado) {
      throw new Error(
        `El tester no aceptó el pin ${esperado}: sigue en ${real.pin < 0 ? "desactivado" : "IO" + real.pin}. ` +
        "Los pines 0,1,2 (595), 3 (ADC), 8,9 (I²C) y 18,19 (USB) están ocupados."
      );
    }
    return real;
  }

  runTest()    { return this.t.runTest(); }
  lastTest()   { return this.t.lastTest(); }
  /** Valida los modulos con el arnes DESCONECTADO: detecta pines pegados. */
  selfCheck()  { return this.t.selfCheck(); }
  /** Captura el mapa sin comparar ni guardar — para que ingenieria lo revise. */
  captureMap() { return this.t.captureMap(); }
  close()      { this.t.close(); }
}

/** Puertos serie que parecen un ESP32 (USB nativo Espressif o puentes usuales). */
export async function listTesterSerialPorts() {
  const ports = await SerialPort.list();
  return ports
    .filter(p => {
      const vid = (p.vendorId || "").toLowerCase();
      const m = `${p.manufacturer || ""} ${p.pnpId || ""}`.toLowerCase();
      return vid === "303a" || vid === "10c4" || vid === "1a86" ||
             m.includes("espressif") || m.includes("cp210") || m.includes("ch340");
    })
    .map(p => ({ path: p.path, manufacturer: p.manufacturer || "", vendorId: p.vendorId || "" }));
}
