// db.js — SQLite con el modulo integrado de Node (>= 22.5). Sin compilacion nativa.
//
// Unica fuente de verdad de la estacion. El navegador nunca guarda estado
// propio; todo lo que importa para trazabilidad vive aqui.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// CT32_DATA permite apuntar a OTRA carpeta de datos: probar una importacion
// contra una copia, o tener dos estaciones en la misma PC, sin arriesgar los
// datos de produccion. Sin la variable, todo sigue igual que siempre.
export const DATA_DIR = process.env.CT32_DATA
  ? path.resolve(process.env.CT32_DATA)
  : path.resolve(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "cabletester.db");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "labels"), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "backups"), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// ── Esquema ──────────────────────────────────────────────────
// Ver PLAN.md §5. Las fechas son ISO-8601 en UTC puestas por la PC:
// el tester no tiene RTC y nunca es autoridad de tiempo.
db.exec(`
CREATE TABLE IF NOT EXISTS skus (
  codigo          TEXT PRIMARY KEY,
  descripcion     TEXT NOT NULL DEFAULT '',
  standard_pack   INTEGER NOT NULL DEFAULT 10,
  labels_per_pack INTEGER NOT NULL DEFAULT 2,
  label_type      TEXT NOT NULL DEFAULT 'large',   -- 'large' | 'standard'
  label_template  TEXT,                              -- JSON, ver PLAN.md §11
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fixtures (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sku         TEXT NOT NULL REFERENCES skus(codigo),
  nombre      TEXT NOT NULL,
  labels      TEXT NOT NULL DEFAULT '{}',   -- JSON {"M.J19":"JST3 pos 5", ...}
  created_at  TEXT NOT NULL
);

-- Un job = un golden aprobado para un SKU sobre un fixture concreto.
-- nets: un byte por canal (net_id, 0 = aislado), igual que en el firmware.
CREATE TABLE IF NOT EXISTS jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sku             TEXT NOT NULL REFERENCES skus(codigo),
  fixture_id      INTEGER REFERENCES fixtures(id),
  nombre          TEXT NOT NULL,
  channels        INTEGER NOT NULL,
  nets            BLOB NOT NULL,
  nets_count      INTEGER NOT NULL,
  crc             INTEGER NOT NULL,
  tester_macs     TEXT NOT NULL DEFAULT '[]',  -- JSON: MACs con las que se capturo, en orden
  label_template  TEXT,                        -- copia congelada al aprobar
  status          TEXT NOT NULL DEFAULT 'draft', -- draft | approved | retired
  captured_by     TEXT,
  captured_at     TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS tester_units (
  mac         TEXT PRIMARY KEY,
  unit        TEXT NOT NULL,
  role        TEXT,
  sku_bound   TEXT REFERENCES skus(codigo),
  ip          TEXT,
  serial_port TEXT,
  fw          TEXT,
  api         INTEGER,
  last_seen   TEXT,
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS tests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sku          TEXT NOT NULL,
  job_id       INTEGER REFERENCES jobs(id),
  job_crc      INTEGER,
  operator     TEXT NOT NULL,
  tester_mac   TEXT,
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  duration_ms  INTEGER,
  result       TEXT NOT NULL,      -- PASS | FAIL | ERROR
  faults       TEXT NOT NULL DEFAULT '[]',  -- JSON [{type,a,b,label_a,label_b}]
  lote_id      TEXT,
  notes        TEXT
);
CREATE INDEX IF NOT EXISTS idx_tests_started ON tests(started_at);
CREATE INDEX IF NOT EXISTS idx_tests_sku     ON tests(sku);

-- El numero de lote es una SECUENCIA en DB. En la app vieja vivia en el estado
-- de React y se reiniciaba a 0001 al recargar la pagina: lotes duplicados.
CREATE TABLE IF NOT EXISTS lotes (
  id          TEXT PRIMARY KEY,   -- '0001', '0002', ...
  sku         TEXT NOT NULL,
  fecha       TEXT NOT NULL,      -- YYYYMMDD, formato del QR
  operador    TEXT NOT NULL,
  cantidad    INTEGER NOT NULL DEFAULT 0,
  buenos      INTEGER NOT NULL DEFAULT 0,
  malos       INTEGER NOT NULL DEFAULT 0,
  parcial     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  closed_at   TEXT
);

CREATE TABLE IF NOT EXISTS labels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lote_id     TEXT REFERENCES lotes(id),
  sku         TEXT NOT NULL,
  qty         INTEGER NOT NULL,
  qr_data     TEXT NOT NULL,
  pdf_path    TEXT,
  printer     TEXT,
  printed     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operators (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT NOT NULL UNIQUE,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

-- Todo lo que cambia estado pasa por aqui: quien, que, cuando.
CREATE TABLE IF NOT EXISTS audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  details     TEXT               -- JSON
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT
);

-- Una ESTACION es un equipo con boton: un puesto de trabajo fisico.
--
-- Por que su propio contexto y no los ajustes globales: con dos o tres puestos
-- colgando del mismo bridge, un "sku_activo" unico hace que el operador de un
-- puesto se lleve el producto del otro. El boton funcionaria igual y la
-- trazabilidad mentiria, que es peor que no registrar nada.
--
-- El puesto que lleva la pantalla trabaja con datos COMPLETOS (producto,
-- operador y lote). Los demas pueden ir con lo que tengan: si falta el
-- operador se registra igual, marcado como parcial. Perder la pieza del
-- historial es peor que registrarla incompleta.
CREATE TABLE IF NOT EXISTS estaciones (
  mac         TEXT PRIMARY KEY REFERENCES tester_units(mac),
  nombre      TEXT,
  sku         TEXT,
  operador    TEXT,
  lote_id     TEXT,
  updated_at  TEXT NOT NULL
);
`);

// ── Migraciones ──────────────────────────────────────────────
//
// El esquema original guardaba el golden EN el ESP32 y ataba el job a las MAC
// de los testers. Con la PC orquestando, el golden vive aqui y las unidades se
// identifican por su ORDEN (que es lo que define los nombres de canal), no por
// su MAC ni por su IP — el DHCP las mueve.
//
// ADD COLUMN es idempotente a mano: SQLite no tiene IF NOT EXISTS para columnas,
// asi que se comprueba antes. Migrar sin romper bases existentes importa: hay
// datos de produccion.
function añadirColumna(tabla, columna, definicion) {
  const cols = db.prepare(`PRAGMA table_info(${tabla})`).all();
  if (cols.some((c) => c.name === columna)) return;
  db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
}

añadirColumna("jobs", "hosts",     "TEXT NOT NULL DEFAULT '[]'");   // orden de unidades
añadirColumna("jobs", "esperadas", "INTEGER");                      // conexiones que aprueba ingenieria
añadirColumna("jobs", "huella",    "TEXT");                         // md5 del barrido
añadirColumna("jobs", "golden",    "TEXT");                         // fichero de golden asociado

// Una prueba de un puesto secundario puede no tener operador ni lote. Se
// registra igual y se marca: 0 = completa, 1 = parcial.
añadirColumna("tests", "parcial", "INTEGER NOT NULL DEFAULT 0");
añadirColumna("fixtures", "fixture_id", "TEXT");                    // id del fixture aprendido por socket

// ── Helpers ──────────────────────────────────────────────────
export const now = () => new Date().toISOString();

export const todayYMD = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};

export function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value == null ? null : String(value));
}

export function audit(actor, action, entity, entityId = null, details = null) {
  db.prepare(
    "INSERT INTO audit(ts, actor, action, entity, entity_id, details) VALUES(?,?,?,?,?,?)"
  ).run(now(), actor || "sistema", action, entity, entityId == null ? null : String(entityId),
        details == null ? null : JSON.stringify(details));
}

// Siguiente numero de lote, atomico. 4 digitos como en la app vieja.
export function nextLoteId() {
  const row = db.prepare("SELECT MAX(CAST(id AS INTEGER)) AS m FROM lotes").get();
  const n = (row?.m || 0) + 1;
  return String(n).padStart(4, "0");
}

// Valores por defecto de configuracion en el primer arranque
const DEFAULTS = {
  // No hay interruptor de impresion: la impresora elegida ES el interruptor.
  // Vacio = solo PDF. Un booleano aparte solo servia para que en planta
  // eligieran impresora y no saliera nada, sin entender por que.
  printer_name:  "",
  label_type:    "large",
  bridge_port:   "3001",
  // Al completar una bolsa (standard pack de piezas BUENAS) la etiqueta sale
  // sola. Es lo que cierra el ciclo del boton fisico: sin esto el operador
  // tendria que volver a la pantalla, que es lo que el boton viene a evitar.
  etiqueta_automatica: "1",
};
for (const [k, v] of Object.entries(DEFAULTS)) {
  if (getSetting(k) === null) setSetting(k, v);
}

console.log(`[db]   SQLite en ${DB_PATH}`);
