// seed.js — Precarga de la base con los SKUs y montajes reales.
//
//   node bridge/seed.js
//
// Idempotente: se puede correr varias veces sin duplicar nada.
//
// ⚠️ LOS CODIGOS DE SKU SON PROVISIONALES. Estan marcados con TODO. Cambialos
// por los de verdad ANTES de usar esto en produccion: el codigo va impreso en
// la etiqueta de trazabilidad, y renombrarlo despues obliga a reimprimir.

import { pathToFileURL } from "node:url";
import { db, now, audit } from "./db.js";

// ── Montajes ─────────────────────────────────────────────────
//
// El ORDEN de los hosts define los nombres de canal (M, L1, L2...). Un golden
// capturado con un orden NO vale con otro, asi que esto es parte de la receta,
// no una preferencia.
export const MONTAJES = {
  // Tester #1: tres unidades, arnes grande.
  arnes_grande: {
    nombre: "Tester #1 — arnés grande (3 unidades)",
    hosts: ["192.168.1.90", "192.168.1.101", "192.168.1.102"],
    unidades: ["2898", "700C", "424C"],
    canales: 96,
    // 96 canales - 4 libres del esquematico = 92 = 46 parejas.
    esperadas: 46,
  },
  // Tester #2: una unidad, cable amarillo con socket. Varios SKUs distintos.
  socket_amarillo: {
    nombre: "Tester #2 — cable amarillo con socket",
    hosts: ["192.168.1.96"],
    unidades: ["8744"],
    canales: 32,
    esperadas: 16,   // bucle CN1<->CN2, 1 a 1
  },
};

const SKUS = [
  {
    codigo: "TODO-ARNES-GRANDE",          // TODO: codigo real
    descripcion: "Arnés grande — 46 líneas, 3 unidades",
    standard_pack: 10,                    // TODO: confirmar con produccion
    labels_per_pack: 2,
    label_type: "large",
    montaje: "arnes_grande",
  },
  {
    codigo: "TODO-SOCKET-A",              // TODO: codigo real
    descripcion: "Socket amarillo — SKU A",
    standard_pack: 10,
    labels_per_pack: 2,
    label_type: "standard",
    montaje: "socket_amarillo",
  },
  {
    codigo: "TODO-SOCKET-B",              // TODO: codigo real
    descripcion: "Socket amarillo — SKU B",
    standard_pack: 10,
    labels_per_pack: 2,
    label_type: "standard",
    montaje: "socket_amarillo",
  },
  {
    codigo: "TODO-SOCKET-C",              // TODO: codigo real
    descripcion: "Socket amarillo — SKU C",
    standard_pack: 10,
    labels_per_pack: 2,
    label_type: "standard",
    montaje: "socket_amarillo",
  },
];

export function precargar() {
  const ts = now();
  const ins = db.prepare(`
    INSERT INTO skus(codigo, descripcion, standard_pack, labels_per_pack,
                     label_type, active, created_at, updated_at)
    VALUES(?,?,?,?,?,1,?,?)
    ON CONFLICT(codigo) DO UPDATE SET
      descripcion     = excluded.descripcion,
      standard_pack   = excluded.standard_pack,
      labels_per_pack = excluded.labels_per_pack,
      label_type      = excluded.label_type,
      updated_at      = excluded.updated_at
  `);

  for (const s of SKUS) ins.run(s.codigo, s.descripcion, s.standard_pack,
                                s.labels_per_pack, s.label_type, ts, ts);

  // Las unidades conocidas, por su numero. La IP se guarda como referencia pero
  // NO se usa para identificar: el DHCP las mueve.
  const iu = db.prepare(`
    INSERT INTO tester_units(mac, unit, role, ip, last_seen, notes)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(mac) DO UPDATE SET ip = excluded.ip, last_seen = excluded.last_seen
  `);
  const UNIDADES = [
    ["1C:DB:D4:F8:28:98", "2898", "192.168.1.90",  "Tester #1 — posición M"],
    ["E8:F6:0A:2A:70:0C", "700C", "192.168.1.101", "Tester #1 — posición L1"],
    ["1C:DB:D4:F7:42:4C", "424C", "192.168.1.102", "Tester #1 — posición L2"],
    ["E8:F6:0A:2C:87:44", "8744", "192.168.1.96",  "Tester #2 — socket amarillo"],
  ];
  for (const [mac, unit, ip, notas] of UNIDADES) iu.run(mac, unit, "MASTER", ip, ts, notas);

  audit("seed", "precarga", "skus", null, `${SKUS.length} SKU, ${UNIDADES.length} unidades`);
  return { skus: SKUS.length, unidades: UNIDADES.length };
}

// En Windows comparar import.meta.url con argv[1] a mano falla por las barras
// y el prefijo del disco; pathToFileURL lo normaliza. Y argv[1] no existe si el
// modulo se importa, de ahi la guarda.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = precargar();
  console.log(`[seed] ${r.skus} SKU(s) y ${r.unidades} unidad(es) precargadas.`);
  console.log("[seed] OJO: los codigos de SKU son provisionales (TODO-...).");
  for (const [k, m] of Object.entries(MONTAJES)) {
    console.log(`[seed] ${k}: ${m.unidades.join(" → ")}  (${m.canales} ch, ${m.esperadas} conexiones)`);
  }
}
