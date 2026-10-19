// hosts.js — De MAC a la IP de AHORA.
//
// EL PROBLEMA QUE RESUELVE
//
// Un job guarda las unidades sobre las que se capturo el golden. Durante mucho
// tiempo las guardo por IP, y eso funciona hasta el dia que el equipo cambia de
// red: en planta el DHCP reparte otras direcciones y la prueba se queda
// intentando hablar con una IP que ya no existe.
//
// PASO DE VERDAD (2026-10-19): el job de MPG-A1 llevaba
// 192.168.1.90/.101/.102 de la red del taller. En Guadalajara el modem dio
// .73/.74/.75. El mDNS encontraba los tres equipos perfectamente —se ven en la
// consola del bridge— y aun asi la prueba fallaba con "U0 (192.168.1.90) no
// responde tras 3 intentos", despues de 143 segundos de timeouts.
//
// Lo que NO cambia nunca es la MAC. Asi que el job identifica sus unidades por
// MAC y la IP se resuelve en cada uso, con esta prioridad:
//
//   1. mDNS  -> es la de ahora mismo, la que acaba de anunciarse
//   2. tester_units.ip -> la ultima vista; sirve si el mDNS no llega
//                         (VLAN, red corporativa, Windows en modo Publico)
//
// La IP guardada en el job se mantiene como pista para diagnosticar, pero ya
// no manda.

import { db, now } from "./db.js";

/** Las dos ultimas parejas de la MAC, que es como se llama a la unidad: "2898". */
export function unidadDeMac(mac) {
  const h = String(mac || "").replace(/[^0-9a-fA-F]/g, "");
  return h.length >= 4 ? h.slice(-4).toUpperCase() : null;
}

/**
 * Guardar en tester_units la IP que acaba de anunciar el mDNS.
 *
 * Sin esto la direccion de la tabla envejece y el plan B no sirve de nada:
 * seria la IP de la red anterior, justo el fallo del que venimos.
 */
export function refrescarIps(lista) {
  const upd = db.prepare("UPDATE tester_units SET ip = ?, last_seen = ? WHERE unit = ? AND (ip IS NULL OR ip <> ?)");
  const t = now();
  for (const d of lista ?? []) {
    if (!d?.unit || !d?.ip) continue;
    try {
      const r = upd.run(d.ip, t, d.unit, d.ip);
      if (r.changes) console.log(`[mdns] ${d.unit} ahora en ${d.ip}`);
    } catch { /* una unidad sin registrar todavia no tiene fila */ }
  }
}

/** IP actual de una MAC, o null si no se sabe de ella. */
export function ipDeMac(mac, discovery) {
  const fila = db.prepare("SELECT unit, ip FROM tester_units WHERE mac = ?").get(mac);
  const unidad = fila?.unit ?? unidadDeMac(mac);
  const visto = (discovery?.list() ?? []).find((d) => d.unit === unidad);
  return visto?.ip || fila?.ip || null;
}

/**
 * Las IPs de un job, EN SU ORDEN.
 *
 * El orden es parte de la receta: define si una unidad es M, L1 o L2, y con eso
 * como se llaman sus canales. Resolver por MAC no puede reordenarlas.
 *
 * Devuelve { hosts, faltan, porMac }. `faltan` lleva las unidades que no se
 * pueden localizar, para poder decir cual falta por su nombre en vez de soltar
 * un timeout de dos minutos.
 */
export function hostsDeJob(job, discovery) {
  let macs = [];
  try { macs = JSON.parse(job?.tester_macs || "[]"); } catch { macs = []; }
  let guardados = [];
  try { guardados = JSON.parse(job?.hosts || "[]"); } catch { guardados = []; }

  // Jobs anteriores a que se guardara la MAC: se sigue por IP, que es lo unico
  // que hay. Se avisa una vez para que se sepa por que ese no esta protegido.
  if (!macs.length) {
    return { hosts: guardados, faltan: [], porMac: false };
  }

  const hosts = [];
  const faltan = [];
  macs.forEach((mac, i) => {
    const ip = ipDeMac(mac, discovery);
    if (ip) hosts.push(ip);
    else {
      const u = db.prepare("SELECT unit FROM tester_units WHERE mac = ?").get(mac);
      faltan.push({
        mac, unidad: u?.unit ?? unidadDeMac(mac) ?? mac,
        posicion: i === 0 ? "M" : `L${i}`,
        ultima_ip: guardados[i] ?? null,
      });
    }
  });
  return { hosts, faltan, porMac: true };
}

/** Mensaje para el operador cuando falta alguna unidad. */
export function mensajeFaltan(faltan) {
  const q = faltan.map((f) => `${f.unidad} (${f.posicion})`).join(", ");
  return `No encuentro en la red: ${q}. ` +
    "Comprueba que esten encendidos y en la misma red que esta PC, " +
    "y que la red de Windows este marcada como Privada.";
}
