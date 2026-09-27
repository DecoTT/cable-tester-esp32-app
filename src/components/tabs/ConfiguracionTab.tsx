import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Radar, Usb, Wifi, Printer, Plug, Unplug, RefreshCw, Activity, Download, Upload, Database, MoreVertical } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import DeviceDetails from "@/components/DeviceDetails";
import Estaciones from "@/components/Estaciones";
import { api, liveSocket, type DiscoveredTester, type TesterUnit, type TesterStatus } from "@/services/api";

const rssiLabel = (r: number) => r > -60 ? "excelente" : r > -75 ? "bueno" : r > -85 ? "justo" : "MALO";

export default function ConfiguracionTab({ operator }: { operator: string }) {
  const qc = useQueryClient();
  const [discovered, setDiscovered] = useState<DiscoveredTester[]>([]);
  const [manualIp, setManualIp] = useState("");
  const [serialPath, setSerialPath] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, TesterStatus>>({});

  const testers  = useQuery({ queryKey: ["testers"],  queryFn: api.testers.list, refetchInterval: 5000 });
  const ports    = useQuery({ queryKey: ["ports"],    queryFn: api.testers.serialPorts });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const printers = useQuery({ queryKey: ["printers"], queryFn: api.printers });

  // ── Mudanza de estacion ───────────────────────────────────────────────
  // El repo no lleva datos: ni SKUs de cliente, ni goldens, ni produccion.
  // Esto es lo que se manda aparte y se importa en la PC de planta.
  const datos = useQuery({ queryKey: ["datos-resumen"], queryFn: api.datos.resumen });
  const [conHistorial, setConHistorial] = useState(true);
  const [importando, setImportando] = useState(false);
  const [detalle, setDetalle] = useState<TesterUnit | null>(null);

  const importar = async (file: File) => {
    setImportando(true);
    try {
      const texto = await file.text();
      let bundle: unknown;
      try { bundle = JSON.parse(texto); }
      catch { return toast({ title: "Fichero ilegible", description: "No es un JSON válido.", variant: "destructive" }); }

      const r = await api.datos.importar(bundle);
      if (!r.ok) return toast({ title: "No se importó", description: r.error, variant: "destructive" });

      const filas = Object.entries(r.resumen ?? {}).map(([k, v]) => `${v} ${k}`).join(", ");
      toast({
        title: `Importado desde ${r.origen ?? "otra estación"}`,
        description: `${filas}. Copia de seguridad previa: ${r.respaldo}`,
      });
      qc.invalidateQueries();
    } finally { setImportando(false); }
  };

  // Lista mDNS en vivo por WebSocket, con carga inicial por HTTP
  useEffect(() => {
    api.testers.discovered().then(setDiscovered).catch(() => {});
    const s = liveSocket();
    const onDisc = (list: DiscoveredTester[]) => setDiscovered(list);
    const onConn = () => qc.invalidateQueries({ queryKey: ["testers"] });
    s.on("testers:discovered", onDisc);
    s.on("testers:connected", onConn);
    return () => { s.off("testers:discovered", onDisc); s.off("testers:connected", onConn); };
  }, [qc]);

  // Estado en vivo de los conectados
  useEffect(() => {
    const macs = (testers.data || []).filter(t => t.connected).map(t => t.mac);
    if (!macs.length) return;
    const tick = async () => {
      for (const mac of macs) {
        const r = await api.testers.status(mac).catch(() => null);
        if (r?.ok && r.status) setLive(prev => ({ ...prev, [mac]: r.status! }));
      }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [testers.data]);

  const connect = async (opts: { host?: string; serialPath?: string }, label: string) => {
    setBusy(label);
    try {
      const r = await api.testers.connect(opts, operator);
      if (r.ok && r.status) {
        toast({ title: "Tester conectado", description: `${r.status.unit} · ${r.status.role} · vía ${r.via}` });
        qc.invalidateQueries({ queryKey: ["testers"] });
      } else {
        toast({ title: "No se pudo conectar", description: r.error, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const disconnect = async (mac: string) => {
    await api.testers.disconnect(mac);
    setLive(prev => { const n = { ...prev }; delete n[mac]; return n; });
    qc.invalidateQueries({ queryKey: ["testers"] });
  };

  const saveSetting = async (kv: Record<string, string | boolean>) => {
    await api.saveSettings(kv, operator);
    qc.invalidateQueries({ queryKey: ["settings"] });
    toast({ title: "Configuración guardada" });
  };


  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Configuración</h2>
        <p className="text-gray-600">Testers, impresora y ajustes de la estación.</p>
      </div>

      {/* ── Descubrimiento en la LAN ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Radar className="w-5 h-5" /> Testers en la red (mDNS)</CardTitle>
        </CardHeader>
        <CardContent>
          {discovered.length === 0 ? (
            <p className="text-sm text-gray-500">
              Ningún tester anunciándose. Debe estar encendido, con WiFi, y en la <strong>misma red</strong> que esta PC
              (mDNS no cruza routers). Si la web del tester abre pero aquí no aparece, revisa que la red de Windows sea <em>Privada</em>.
            </p>
          ) : (
            <div className="space-y-2">
              {discovered.map(d => {
                const already = testers.data?.some(t => t.unit === d.unit && t.connected);
                return (
                  <div key={d.unit} className="flex items-center justify-between border rounded-lg p-3">
                    <div className="flex items-center gap-3">
                      <Badge>{d.unit}</Badge>
                      <Badge variant="outline">{d.role}</Badge>
                      <span className="font-mono text-sm">{d.ip}</span>
                      <span className="text-xs text-gray-500">fw {d.fw} · api {d.api}</span>
                      {d.sku && <Badge variant="secondary">SKU {d.sku}</Badge>}
                    </div>
                    <Button size="sm" disabled={!!busy || already || !d.ip}
                            onClick={() => connect({ host: d.ip! }, d.unit)}>
                      <Plug className="w-4 h-4 mr-1" /> {already ? "Conectado" : busy === d.unit ? "…" : "Conectar"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Conexión manual ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Wifi className="w-5 h-5" /> Por IP</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-gray-500">Respaldo cuando mDNS no funciona (redes corporativas, VLANs).</p>
            <div className="flex gap-2">
              <Input value={manualIp} onChange={e => setManualIp(e.target.value)} placeholder="192.168.1.90" className="font-mono" />
              <Button disabled={!manualIp || !!busy} onClick={() => connect({ host: manualIp.trim() }, "ip")}>Conectar</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Usb className="w-5 h-5" /> Por USB</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-gray-500">Para PCs sin red con el tester. Mismo protocolo, sin WiFi.</p>
            <div className="flex gap-2">
              <Select value={serialPath} onValueChange={setSerialPath}>
                <SelectTrigger><SelectValue placeholder="Puerto COM…" /></SelectTrigger>
                <SelectContent>
                  {(ports.data || []).map(p => (
                    <SelectItem key={p.path} value={p.path}>{p.path} — {p.manufacturer || p.vendorId}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={() => ports.refetch()}><RefreshCw className="w-4 h-4" /></Button>
              <Button disabled={!serialPath || !!busy} onClick={() => connect({ serialPath }, "usb")}>Conectar</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Testers registrados ── */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5" /> Testers de esta estación</CardTitle></CardHeader>
        <CardContent>
          {(testers.data || []).length === 0 ? (
            <p className="text-sm text-gray-500">Aún no hay testers registrados. Conecta uno arriba.</p>
          ) : (
            <div className="space-y-3">
              {testers.data!.map(t => {
                const s = live[t.mac];
                return (
                  <div key={t.mac} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`w-2.5 h-2.5 rounded-full ${t.connected ? "bg-green-500" : "bg-gray-300"}`} />
                        <Badge>{t.unit}</Badge>
                        <Badge variant="outline">{t.role || "?"}</Badge>
                        <span className="font-mono text-xs text-gray-500">{t.mac}</span>
                        {t.sku_bound ? <Badge variant="secondary">SKU {t.sku_bound}</Badge>
                                     : <Badge variant="outline" className="text-gray-400">sin SKU</Badge>}
                      </div>
                      <div className="flex items-center gap-1">
                        {t.connected
                          ? <Button size="sm" variant="outline" onClick={() => disconnect(t.mac)}><Unplug className="w-4 h-4 mr-1" /> Desconectar</Button>
                          : <Button size="sm" disabled={!!busy || !(t.ip || t.serial_port)}
                                    onClick={() => connect(t.ip ? { host: t.ip } : { serialPath: t.serial_port! }, t.mac)}>
                              <Plug className="w-4 h-4 mr-1" /> Reconectar</Button>}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" title="Más opciones">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setDetalle(t)}>
                              Ver detalles y switch físico
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    {s && (
                      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div><span className="text-gray-500">Canales</span><br /><b>{s.channels_total}</b> ({1 + s.peer_count} unid.)</div>
                        <div><span className="text-gray-500">Golden</span><br />
                          {s.golden.loaded ? <b>{s.golden.name}</b> : s.golden.crc ? <b className="text-red-600">CORRUPTO</b> : <span className="text-gray-400">ninguno</span>}</div>
                        <div><span className="text-gray-500">Expanders</span><br />
                          U1 {s.expanders.u1 ? "✓" : "✗"} · U2 {s.expanders.u2 ? "✓" : "✗"}</div>
                        <div><span className="text-gray-500">Reinicio</span><br />
                          <span className={s.reset_reason.includes("BROWNOUT") ? "text-red-600 font-bold" : ""}>{s.reset_reason.split(" ")[0]}</span></div>
                        {s.peers.map(p => (
                          <div key={p.mac} className="col-span-2 flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${p.online ? "bg-green-500" : "bg-red-500"}`} />
                            <span className="text-gray-500">Hijo</span> <b>{p.unit}</b>
                            {p.online ? <span className="text-xs text-gray-500">{p.rssi} dBm ({rssiLabel(p.rssi)})</span>
                                      : <span className="text-xs text-red-600">sin respuesta</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Impresión ── */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Printer className="w-5 h-5" /> Impresión de etiquetas</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="font-medium">Impresora</p>
            <p className="text-xs text-gray-500">
              La que elijas aquí queda como predeterminada y se usa en cada etiqueta.
              <strong> Sin ninguna elegida, se genera el PDF y no se imprime</strong> — el
              PDF se guarda siempre, se imprima o no.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Etiqueta automática al completar la bolsa</p>
              <p className="text-xs text-gray-500">
                Cuenta piezas <strong>buenas</strong>: con standard pack de 10, probar 12
                con 2 malas saca la etiqueta al llegar a 10. La bolsa incompleta espera al
                cierre del lote. Quítalo si prefieres pedir la etiqueta a mano.
              </p>
            </div>
            <Switch checked={settings.data?.etiqueta_automatica !== "0"}
                    onCheckedChange={v => saveSetting({ etiqueta_automatica: v ? "1" : "0" })} />
          </div>

          <div className="flex gap-2 items-center">
            <Select value={settings.data?.printer_name || "__pdf__"}
                    onValueChange={v => saveSetting({ printer_name: v === "__pdf__" ? "" : v })}>
              <SelectTrigger className="max-w-md"><SelectValue placeholder="Impresora…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__pdf__">Ninguna — solo PDF</SelectItem>
                {(printers.data?.printers || []).map(p => (
                  <SelectItem key={p.name} value={p.name}>{p.name}{p.isDefault ? " (predeterminada del sistema)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => printers.refetch()}><RefreshCw className="w-4 h-4" /></Button>
          </div>
        </CardContent>
      </Card>

      <DeviceDetails unidad={detalle} abierto={!!detalle} onCerrar={() => setDetalle(null)} />

      <Estaciones operator={operator} />

      {/* ── Datos de la estación ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Database className="w-5 h-5" /> Datos de la estación</CardTitle>
          <p className="text-sm text-gray-600">
            El código se distribuye por git; los datos <strong>no</strong>. SKUs, goldens,
            sockets, equipos y producción viajan en este fichero, que se importa en la
            PC de planta después de ejecutar <span className="font-mono">setup.bat</span>.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {datos.data?.ok && (
            <div className="text-sm text-gray-700 grid sm:grid-cols-2 gap-x-6 gap-y-1">
              <div>SKUs: <b>{datos.data.catalogo.skus}</b> · Jobs: <b>{datos.data.catalogo.jobs}</b> · Equipos: <b>{datos.data.catalogo.tester_units}</b></div>
              <div>Goldens: <b>{datos.data.goldens}</b> · Sockets: <b>{datos.data.fixtures}</b> · Operadores: <b>{datos.data.catalogo.operators}</b></div>
              <div className="sm:col-span-2 text-gray-500 text-xs">
                Historial: {datos.data.historial.lotes} lotes, {datos.data.historial.tests} pruebas,
                {" "}{datos.data.historial.labels} etiquetas, {datos.data.historial.audit} registros de auditoría
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Incluir historial de producción</p>
              <p className="text-xs text-gray-500">
                Lotes, pruebas, etiquetas y auditoría. Quítalo para mandar solo la receta
                —SKUs, goldens, sockets y equipos— sin el historial de esta estación.
              </p>
            </div>
            <Switch checked={conHistorial} onCheckedChange={setConHistorial} />
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <Button asChild>
              <a href={api.datos.urlExportar(conHistorial)} download>
                <Download className="w-4 h-4 mr-2" />Exportar
              </a>
            </Button>

            <Button variant="outline" asChild disabled={importando}>
              <label className="cursor-pointer">
                <Upload className="w-4 h-4 mr-2" />
                {importando ? "Importando…" : "Importar…"}
                <input type="file" accept=".json,.ct32.json,application/json" className="hidden"
                       onChange={(e) => {
                         const f = e.target.files?.[0];
                         e.target.value = "";   // permite reimportar el mismo fichero
                         if (f) importar(f);
                       }} />
              </label>
            </Button>
          </div>

          <p className="text-xs text-amber-700">
            Importar <strong>reemplaza</strong> lo que coincida por código: un SKU con el
            mismo código queda con los datos del fichero. Antes de tocar nada se guarda
            una copia de la base en <span className="font-mono">data/backups/</span>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
