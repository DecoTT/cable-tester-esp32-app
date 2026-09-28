// api.ts — Cliente del bridge. La UI SOLO habla con el bridge, nunca con el ESP32.
//
// Rutas relativas: en desarrollo las proxea Vite a :3001, en produccion el
// bridge sirve la UI y las rutas son del mismo origen.

import { io, Socket } from "socket.io-client";

async function j<T = any>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!r.ok) {
    // El cuerpo trae el motivo (p. ej. 422 con las lineas de resistencia alta).
    // Perderlo obliga al operador a adivinar por que se rechazo.
    let detalle: any = null;
    try { detalle = await r.json(); } catch { /* sin cuerpo */ }
    const e: any = new Error(detalle?.mensaje || detalle?.error ||
                             `${init?.method || "GET"} ${url} → HTTP ${r.status}`);
    e.status = r.status;
    e.detalle = detalle;
    throw e;
  }
  return r.json();
}

// ── Tipos del contrato del firmware (docs/API.md, api=1) ──────
export interface TesterPeer { mac: string; unit: string; online: boolean; rssi: number }
export interface TesterStatus {
  api: number; fw: string; unit: string; mac: string; role: string;
  channels_local: number; peers: TesterPeer[]; peer_count: number; channels_total: number;
  sku: string; meta: string;
  golden: { loaded: boolean; name: string; nets: number; crc: number };
  expanders: { u1: boolean; u2: boolean };
  wifi: { connected: boolean; ssid: string; ip: string; rssi: number };
  uptime_s: number; reset_reason: string; heap_free: number;
}

export interface DiscoveredTester {
  unit: string; role: string; sku: string | null; fw: string; api: number;
  host: string | null; ip: string | null; port: number; seen: string;
}

/** Sobre qué se mide: un producto con golden, o equipos sueltos en orden. */
export type Destino = { sku: string; hosts?: never } | { hosts: string[]; sku?: never };

export interface Muestra { t: number; mv: number | null; nivel: number }
export interface EstadoNivel { media: number | null; sd: number | null; min: number | null; max: number | null }
export interface LineaOnda {
  a: string; b: string; ga?: number; gb?: number;
  alto: EstadoNivel; bajo: EstadoNivel;
  tipo: "unida" | "al_aire" | "abierta" | "resistiva" | "error" | "indefinido";
  explicacion: string;
  traza?: Muestra[];
}

export interface RegistroAudit {
  id: number; ts: string; actor: string; action: string;
  entity: string | null; entity_id: string | null; details: string | null;
}

export interface PatronFallo {
  sku: string; tipo: string; texto: string; canales: string[];
  veces: number; ultima: string | null;
}

export interface Clasificacion2 {
  canal: string; g?: number; v?: number;
  tipo: "gnd" | "abierto" | "error";
  fisico?: string; consejo?: string;
}

export interface TesterUnit {
  mac: string; unit: string; role: string | null; sku_bound: string | null;
  ip: string | null; serial_port: string | null; fw: string | null; api: number | null;
  last_seen: string | null; connected: boolean; notes: string | null;
}

export interface Sku {
  codigo: string; descripcion: string; standard_pack: number; labels_per_pack: number;
  label_type: "large" | "standard"; label_template: LabelTemplate | null; active: number;
  created_at: string; updated_at: string;
}

export interface LabelElement {
  type: "text" | "qr" | "logo" | "line";
  x: number; y: number; w?: number; h?: number;
  value?: string; size?: number; bold?: boolean; align?: "left" | "center" | "right";
}
export interface LabelTemplate {
  size: "large" | "standard";
  vars: Record<string, string>;
  qr_format?: string;
  elements: LabelElement[];
}

export interface Job {
  id: number; sku: string; fixture_id: number | null; nombre: string; channels: number;
  nets: number[]; nets_count: number; crc: number; tester_macs: string[];
  label_template: LabelTemplate | null; status: "draft" | "approved" | "retired";
  captured_by: string | null; captured_at: string | null;
  approved_by: string | null; approved_at: string | null; notes: string | null;
}

// ── API ──────────────────────────────────────────────────────

// ── Tipos del motor de medida ──
export interface UnidadInfo { index: number; host: string; canales: number; base: number }
export interface CanalMalo { canal: string; g: number; v: number; r: number }
export interface NetInfo { canales: string[]; fisico: string }
export interface AisladoInfo { canal: string; g: number; fisico: string }
export interface ResultadoBarrido {
  canales: number; nets: NetInfo[]; aislados: AisladoInfo[]; huella: string;
}
export interface Clasificacion { canal: string; g: number; v: number; tipo: "gnd" | "abierto" | "error"; r: number }
export interface LineaR { linea: string; a: number; b: number; r: number; sesgo: number; estado: "ok" | "sospechosa" | "alta" }
export interface GoldenInfo { nombre: string; creado: string; nets: number; huella: string }
export interface Fallo { tipo: "ABIERTO" | "CORTO"; texto: string; canales: string[] }
export interface FixtureInfo { id: string; nombre: string; creado: string | null; pines: number; conectores: string[] }
export interface ConectorFin {
  tipo: string; conector: string; detectados: number; esperados: number;
  ok: boolean; faltan: number; pines: { pin: number; canal: string; g: number }[];
}

// Eventos de la sesion de socket, por socket.io
export type EventoSocket =
  | { tipo: "arrancado" } | { tipo: "parado" }
  | { tipo: "conector"; conector: string; esperados: number }
  | { tipo: "detectado"; conector: string | null; pin: number; canal: string; g: number; llevan: number; esperados: number }
  | { tipo: "deshecho"; pin: number; canal: string; llevan: number }
  | { tipo: "conector_fin"; conector: string; detectados: number; esperados: number; ok: boolean; faltan: number }
  // Un canal se puso alto pero a media tension: es acoplamiento del vecino, no
  // la punta. Se avisa para que no parezca que la app no ve nada.
  | { tipo: "descartado"; canal: string; mv: number; mensaje: string }
  | { tipo: "error"; mensaje: string };

export const api = {
  health:    () => j("/api/health"),
  settings:  () => j<Record<string, string>>("/api/settings"),
  saveSettings: (kv: Record<string, string | number | boolean>, actor?: string) =>
    j("/api/settings", { method: "PUT", body: JSON.stringify({ ...kv, actor }) }),
  printers:  () => j<{ ok: boolean; printers: { name: string; isDefault: boolean }[]; error?: string }>("/api/printers"),
  audit: (f: { desde?: string; hasta?: string; actor?: string; accion?: string; buscar?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v));
    return j<{
      registros: RegistroAudit[]; actores: string[]; acciones: string[]; total: number;
    }>(`/api/audit?${p}`);
  },

  testers: {
    discovered:  () => j<DiscoveredTester[]>("/api/testers/discovered"),
    serialPorts: () => j<{ path: string; manufacturer: string; vendorId: string }[]>("/api/testers/serial-ports"),
    list:        () => j<TesterUnit[]>("/api/testers"),
    // Switch fisico que dispara la prueba. Vive en la NVS del ESP32, no aqui:
    // sobrevive a reinicios y a un OTA, y por eso se lee del propio equipo.
    trigger:     (mac: string) => j<{
      ok: boolean; error?: string;
      trigger?: { pin: number; active_low: boolean; mode?: string; presses?: number };
      fw?: string; unidad?: string; uptime_s?: number; reset_reason?: string;
      heap_free?: number; led_auto?: boolean; canales?: number;
      pines: { pin: number; estado: string; nota: string }[];
      prohibidos: { pin: string; motivo: string }[];
    }>(`/api/testers/${mac}/trigger`),
    setTrigger:  (mac: string, pin: number | null, active_low: boolean, actor?: string,
                  mode: "avisar" | "local" = "avisar") =>
      j<{ ok: boolean; trigger?: { pin: number; active_low: boolean; mode?: string }; error?: string }>(
        `/api/testers/${mac}/trigger`,
        { method: "POST", body: JSON.stringify({ pin, active_low, actor, mode }) }),
    // Job grabado EN el equipo (su NVS). Es lo que le permite juzgar una pieza
    // sin PC.
    goldenDe:    (mac: string) => j<{
      ok: boolean; error?: string;
      golden?: { loaded?: boolean; sku?: string; job?: string; nets?: number; crc?: number; meta?: string };
    }>(`/api/testers/${mac}/golden`),
    cargarJob:   (mac: string, job_id: number, autonomo: boolean, actor?: string) =>
      j<{ ok: boolean; error?: string; crc_match?: boolean;
          disparador?: { pin: number; active_low: boolean; mode?: string } }>(
        `/api/testers/${mac}/push-job`,
        { method: "POST", body: JSON.stringify({ job_id, autonomo, actor }) }),
    modoAsistido: (mac: string, actor?: string) =>
      j<{ ok: boolean; error?: string }>(`/api/testers/${mac}/asistido`,
        { method: "POST", body: JSON.stringify({ actor }) }),
    connect:     (opts: { host?: string; port?: number; serialPath?: string }, actor?: string) =>
      j<{ ok: boolean; status?: TesterStatus; via?: string; error?: string }>("/api/testers/connect",
        { method: "POST", body: JSON.stringify({ ...opts, actor }) }),
    disconnect:  (mac: string) => j(`/api/testers/${mac}/disconnect`, { method: "POST" }),
    status:      (mac: string) => j<{ ok: boolean; status?: TesterStatus; error?: string }>(`/api/testers/${mac}/status`),
    golden:      (mac: string) => j<{ ok: boolean; golden?: any; error?: string }>(`/api/testers/${mac}/golden`),
    // Pasos del asistente
    selfCheck:   (mac: string, actor?: string) =>
      j<{ ok: boolean; channels?: number; units?: number; bad?: number; result?: string;
          faults?: { ch: string; type: string }[]; error?: string }>(
        `/api/testers/${mac}/selfcheck`, { method: "POST", body: JSON.stringify({ actor }) }),
    capture:     (mac: string, actor?: string) =>
      j<{ ok: boolean; channels?: number; units?: number; nets_count?: number;
          nets_raw?: number[]; nets?: string[][]; error?: string }>(
        `/api/testers/${mac}/capture`, { method: "POST", body: JSON.stringify({ actor }) }),
    runTest:     (mac: string) =>
      j<any>(`/api/testers/${mac}/run-test`, { method: "POST" }),
    lastTest:    (mac: string) => j<any>(`/api/testers/${mac}/last-test`),
    pushJob:     (mac: string, job_id: number, actor?: string) =>
      j<{ ok: boolean; result?: any; crc_match?: boolean; error?: string }>(`/api/testers/${mac}/push-job`,
        { method: "POST", body: JSON.stringify({ job_id, actor }) }),
  },

  skus: {
    list:   () => j<Sku[]>("/api/skus"),
    upsert: (s: Partial<Sku> & { codigo: string }, actor?: string) =>
      j("/api/skus", { method: "POST", body: JSON.stringify({ ...s, actor }) }),
    jobs:   (codigo: string) => j<Job[]>(`/api/skus/${codigo}/jobs`),
    fixtures: (codigo: string) => j<any[]>(`/api/skus/${codigo}/fixtures`),
  },

  wizard: {
    // Guarda SKU + fixture + job aprobado + vinculo con el tester, atomico.
    commit: (body: Record<string, unknown>) =>
      j<{ ok: boolean; sku?: string; job_id?: number; fixture_id?: number | null; error?: string }>(
        "/api/wizard/commit", { method: "POST", body: JSON.stringify(body) }),
  },

  jobs: {
    approve: (id: number, actor?: string) => j(`/api/jobs/${id}/approve`, { method: "POST", body: JSON.stringify({ actor }) }),
    retire:  (id: number, actor?: string) => j(`/api/jobs/${id}/retire`,  { method: "POST", body: JSON.stringify({ actor }) }),
  },

  labels: {
    defaults: () => j<{ templates: Record<string, LabelTemplate>; sizes: Record<string, { w: number; h: number; name: string }> }>("/api/labels/defaults"),
    preview:  (template: LabelTemplate | null, label: Record<string, string>) =>
      j<{ ok: boolean; pdf_base64?: string; error?: string }>("/api/labels/preview",
        { method: "POST", body: JSON.stringify({ template, label }) }),
    print:    (template: LabelTemplate | null, labels: Record<string, string>[], actor?: string, lote_id?: string) =>
      j<{ ok: boolean; file?: string; pdf_url?: string; printed?: boolean; print_enabled?: boolean; printer?: string; printError?: string; error?: string }>(
        "/api/labels/print", { method: "POST", body: JSON.stringify({ template, labels, actor, lote_id }) }),
  },

  // ── Motor de medida (la PC orquesta; el navegador nunca toca el ESP32) ──
  medida: {
    unidades:    () => j<{ unidades: UnidadInfo[]; total: number }>("/api/medida/unidades"),
    setUnidades: (hosts: string[]) =>
      j<{ unidades: UnidadInfo[]; total: number }>("/api/medida/unidades",
        { method: "POST", body: JSON.stringify({ hosts }) }),
    modulos:     () => j<{ ok: boolean; malos: CanalMalo[]; total: number }>(
      "/api/medida/modulos", { method: "POST", body: "{}" }),
    barrido:     (fixture?: string) => j<ResultadoBarrido>("/api/medida/barrido",
      { method: "POST", body: JSON.stringify({ fixture }) }),
    clasificar:  (canales: number[]) => j<{ resultados: Clasificacion[] }>(
      "/api/medida/clasificar", { method: "POST", body: JSON.stringify({ canales }) }),
    resistencias: () => j<{ lineas: LineaR[]; umbrales: { ok: number; aviso: number } }>(
      "/api/medida/resistencias", { method: "POST", body: "{}" }),
    goldens:     () => j<{ goldens: GoldenInfo[] }>("/api/medida/goldens"),
    guardarGolden: (nombre: string, esperadas?: number, fixture?: string) =>
      j<{ ok: boolean; golden: any; sin_esperadas: boolean }>("/api/medida/golden",
        { method: "POST", body: JSON.stringify({ nombre, esperadas, fixture }) }),
    check:       (golden: string) => j<{ ok: boolean; fallos: Fallo[]; huella: string }>(
      "/api/medida/check", { method: "POST", body: JSON.stringify({ golden }) }),
    job:         (sku: string, golden: string, nombre?: string, aprobado_por?: string) =>
      j<{ ok: boolean; job_id: number; nets: number; huella: string }>("/api/medida/job",
        { method: "POST", body: JSON.stringify({ sku, golden, nombre, aprobado_por }) }),
    jobs:        () => j<{ jobs: any[] }>("/api/medida/jobs"),
  },

  // ── Validacion de socket ──
  socket: {
    arrancar: () => j("/api/socket/arrancar", { method: "POST", body: "{}" }),
    conector: (nombre: string, esperados: number) =>
      j("/api/socket/conector", { method: "POST", body: JSON.stringify({ nombre, esperados }) }),
    cerrar:   () => j<ConectorFin>("/api/socket/cerrar", { method: "POST", body: "{}" }),
    deshacer: () => j("/api/socket/deshacer", { method: "POST", body: "{}" }),
    parar:    () => j("/api/socket/parar", { method: "POST", body: "{}" }),
    guardar:  (id: string, nombre: string) =>
      j("/api/socket/guardar", { method: "POST", body: JSON.stringify({ id, nombre }) }),
  },

  // ── Produccion ──
  prueba: (sku: string, operador: string, lote_id?: string) =>
    j<any>("/api/prueba", { method: "POST", body: JSON.stringify({ sku, operador, lote_id }) }),

  lotes: {
    abrir:  (sku: string, operador: string) =>
      j<{ lote: any }>("/api/lotes", { method: "POST", body: JSON.stringify({ sku, operador }) }),
    list:   (sku?: string) => j<{ lotes: any[] }>(`/api/lotes${sku ? `?sku=${encodeURIComponent(sku)}` : ""}`),
    cerrar: (id: string) => j<{ lote: any }>(`/api/lotes/${id}/cerrar`, { method: "POST", body: "{}" }),
  },

  pruebas: (f: { sku?: string; operador?: string; resultado?: string; desde?: string; hasta?: string }) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    return j<{ pruebas: any[]; resumen: any[] }>(`/api/pruebas?${p}`);
  },

  operadores: () => j<{ operadores: string[] }>("/api/operadores"),

  etiquetas: () => j<{ etiquetas: any[] }>("/api/etiquetas"),

  // ── Estaciones ──
  // Un puesto = un equipo con boton, con SU producto y SU operador.
  estaciones: {
    list: () => j<{
      ok: boolean;
      estaciones: {
        mac: string; unit: string; ip: string | null; notes: string | null;
        nombre: string | null; sku: string | null; operador: string | null;
        lote_id: string | null; updated_at: string | null;
        con_boton: boolean; pulsaciones: number | null;
        correria: string | null; parcial: boolean | null; motivo: string | null;
        candidatos: string[];
        ultima: { id: number; sku: string; result: string; started_at: string; parcial: number } | null;
      }[];
    }>("/api/estaciones"),
    guardar: (mac: string, v: { nombre?: string | null; sku?: string | null; operador?: string | null; lote_id?: string | null }, actor?: string) =>
      j<{ ok: boolean; error?: string }>(`/api/estaciones/${mac}`,
        { method: "PUT", body: JSON.stringify({ ...v, actor }) }),
  },

  // Que corre el boton de cada equipo si se pulsara ahora.
  boton: () => j<{
    ok: boolean; sku_activo: string | null; operador_activo: string | null;
    ocupadas: string[];
    vigilando: {
      mac: string; unidad: string | null; host: string | null; presses: number | null;
      correria: string | null; motivo: string | null; candidatos: string[];
    }[];
  }>("/api/boton/estado"),

  // ── Avanzado: osciloscopio lento ──
  // OJO con las expectativas: ~324 muestras/s. No hay diagrama de ojo ni
  // tiempo de subida; lo que mide es NIVEL y ESTABILIDAD.
  // `destino` es una de las dos puertas: por producto (sku) o por equipos
  // sueltos (hosts, EN ORDEN — define los nombres M, L1, L2).
  avanzado: {
    lineas: (d: Destino) => j<{
      ok: boolean; error?: string; sku: string | null; con_golden: boolean;
      ms_por_muestra: number; lineas: LineaOnda[];
    }>("/api/avanzado/lineas", { method: "POST", body: JSON.stringify(d) }),
    onda: (d: Destino, a: string, b: string, ciclos = 3) => j<
      { ok: boolean; error?: string } & LineaOnda & { muestras: Muestra[]; misma_unidad: boolean }
    >("/api/avanzado/onda", { method: "POST", body: JSON.stringify({ ...d, a, b, ciclos }) }),
    acoplamiento: (d: Destino, canal: string) => j<{
      ok: boolean; error?: string; excitado: string;
      lineas: { canal: string; g: number; mv: number }[];
    }>("/api/avanzado/acoplamiento", { method: "POST", body: JSON.stringify({ ...d, canal }) }),
    // Que hay conectado AHORA, sin golden y sin veredicto.
    barrido: (d: Destino) => j<{
      ok: boolean; error?: string; canales: number; huella: string;
      unidades: { host: string; canales: number; base: number; etiqueta: string }[];
      conexiones: string[][]; aislados: string[];
    }>("/api/avanzado/barrido", { method: "POST", body: JSON.stringify(d) }),
    // Salud de las placas, con el arnes FUERA.
    modulos: (d: Destino) => j<{
      ok: boolean; error?: string; total: number;
      malos: { canal: string; g: number; v: number; r: number }[];
    }>("/api/avanzado/modulos", { method: "POST", body: JSON.stringify(d) }),
  },

  // ── Diagnostico ──
  diagnostico: {
    patrones: (f: { sku?: string; desde?: string; hasta?: string } = {}) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
      return j<{ patrones: PatronFallo[]; piezas_fallidas: number; piezas_total: number }>(
        `/api/diagnostico/patrones?${p}`);
    },
    // Mide de verdad sobre el tester: distingue abierto de pegado a masa.
    clasificar: (test_id: number) =>
      j<{ ok: boolean; resultados: Clasificacion2[]; sin_abiertos?: boolean; error?: string }>(
        "/api/diagnostico/clasificar", { method: "POST", body: JSON.stringify({ test_id }) }),
  },

  fixtures: {
    list: () => j<{ fixtures: FixtureInfo[] }>("/api/fixtures"),
    get:  (id: string) => j<any>(`/api/fixtures/${id}`),
  },

  // ── Mudanza de estacion ──
  // El codigo va por git; los datos NO. Esto es lo que se lleva a mano.
  datos: {
    resumen: () => j<{
      ok: boolean;
      catalogo: Record<string, number>;
      historial: Record<string, number>;
      goldens: number; fixtures: number;
    }>("/api/datos/resumen"),
    // Descarga directa: la hace el navegador, no fetch, para que salga el
    // dialogo de guardar y el fichero no tenga que pasar por memoria.
    urlExportar: (historial: boolean) => `/api/datos/exportar?historial=${historial ? "1" : "0"}`,
    importar: (bundle: unknown) => j<{
      ok: boolean; respaldo?: string; origen?: string; creado?: string;
      resumen?: Record<string, number>; error?: string;
    }>("/api/datos/importar", { method: "POST", body: JSON.stringify(bundle) }),
  },
};

// ── Eventos en vivo ──────────────────────────────────────────
let socket: Socket | null = null;
export function liveSocket(): Socket {
  if (!socket) socket = io({ path: "/socket.io" });
  return socket;
}
