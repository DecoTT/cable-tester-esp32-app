// discovery.js — Encuentra testers en la LAN por mDNS.
//
// El firmware anuncia _cabletester._tcp con TXT: unit, fw, api, role, sku.
// Esto es lo que evita teclear IPs: el bridge mantiene una lista viva y la
// UI la muestra. Requiere que PC y tester esten en la MISMA red (mDNS no
// cruza NAT): ver notas de red en el proyecto de firmware.

import { Bonjour } from "bonjour-service";

const SERVICE_TYPE = "cabletester";

export class TesterDiscovery {
  constructor(onChange) {
    this.found = new Map();      // key = mac o nombre del servicio
    this.onChange = onChange || (() => {});
    this.bonjour = null;
    this.browser = null;
  }

  start() {
    if (this.browser) return;
    this.bonjour = new Bonjour();
    this.browser = this.bonjour.find({ type: SERVICE_TYPE }, (svc) => this._up(svc));
    this.browser.on("down", (svc) => this._down(svc));
    console.log(`[mdns] buscando _${SERVICE_TYPE}._tcp`);
  }

  stop() {
    try { this.browser?.stop(); this.bonjour?.destroy(); } catch {}
    this.browser = null; this.bonjour = null;
  }

  _key(svc) { return svc.txt?.unit || svc.name; }

  _up(svc) {
    const ip = (svc.addresses || []).find(a => a.includes(".")) || svc.referer?.address || null;
    const entry = {
      unit:  svc.txt?.unit || "?",
      role:  svc.txt?.role || "?",
      sku:   svc.txt?.sku && svc.txt.sku !== "-" ? svc.txt.sku : null,
      fw:    svc.txt?.fw || "?",
      api:   Number(svc.txt?.api || 0),
      host:  svc.host?.replace(/\.$/, "") || null,
      ip, port: svc.port || 80,
      seen:  new Date().toISOString(),
    };
    this.found.set(this._key(svc), entry);
    console.log(`[mdns] +${entry.unit} ${entry.role} ${ip}:${entry.port} sku=${entry.sku ?? "-"}`);
    this.onChange(this.list());
  }

  _down(svc) {
    const k = this._key(svc);
    if (this.found.delete(k)) {
      console.log(`[mdns] -${k}`);
      this.onChange(this.list());
    }
  }

  list() { return Array.from(this.found.values()); }
}
