import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleLeft, TriangleAlert, RefreshCw, HardDriveDownload, Wifi } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, type TesterUnit } from "@/services/api";
import { useToast } from "@/hooks/use-toast";

// Detalle de un equipo: lo que no cabe en la fila.
//
// EL SWITCH FÍSICO (disparador)
//
// Es un interruptor cableado a un pin del módulo ESP32 que ejecuta la prueba
// sin tocar la pantalla. No todos los puestos lo necesitan, así que viene
// DESACTIVADO de fábrica y aquí se pone o se quita.
//
// La configuración vive en la NVS del propio ESP32, no en esta PC: sobrevive a
// reinicios y a un OTA, y sigue al equipo si se lo llevan a otra estación. Por
// eso esta ventana lo LEE del equipo cada vez que se abre en vez de fiarse de
// lo que la app creía saber.
//
// Los pines ocupados los rechaza el firmware —poner el disparador en IO8 sería
// pisar el reloj del I²C y dejar el tester midiendo basura— y el bridge lo
// confirma releyendo el estado: si no cambió, esto avisa en vez de dar por
// buena una escritura que no ocurrió.

interface Props {
  unidad: TesterUnit | null;
  abierto: boolean;
  onCerrar: () => void;
}

export default function DeviceDetails({ unidad, abierto, onCerrar }: Props) {
  const { toast } = useToast();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.testers.trigger>> | null>(null);
  // Que lanzaria el boton de ESTE equipo. Lo decide el bridge mirando a que
  // jobs pertenece la unidad, no lo que haya en pantalla: pulsar aqui no puede
  // arrancar el producto de otro puesto.
  const [queCorre, setQueCorre] = useState<{ correria: string | null; motivo: string | null; candidatos: string[] } | null>(null);

  // ── El job que lleva DENTRO el equipo ────────────────────────────────
  //
  // Distinto del job que corre la PC: este vive en la NVS del ESP32 y es lo
  // que le permite juzgar una pieza sin ordenador. Se lee del equipo, no de la
  // base: lo que importa es lo que TIENE, no lo que creemos haberle mandado.
  const [golden, setGolden] = useState<any>(null);
  const [jobElegido, setJobElegido] = useState<string>("");
  const [cargando2, setCargando2] = useState(false);
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.medida.jobs().then((d) => d.jobs) });

  // Solo los de UNA unidad: el modo autónomo mide con un equipo, y un arnés de
  // tres no se puede probar sin PC.
  const jobsDeUnEquipo = (jobs.data ?? []).filter((j: any) => {
    try { return JSON.parse(j.hosts || "[]").length === 1 && j.status === "approved"; }
    catch { return false; }
  });

  const cargarGolden = async (mac: string) => {
    try {
      const g = await api.testers.goldenDe(mac);
      setGolden(g.ok ? g.golden : null);
    } catch { setGolden(null); }
  };

  const montarJob = async (autonomo: boolean) => {
    if (!unidad || !jobElegido) return;
    setCargando2(true);
    try {
      const r = await api.testers.cargarJob(unidad.mac, Number(jobElegido), autonomo, "configuracion");
      if (!r.ok) {
        toast({ variant: "destructive", title: "No se montó el job", description: r.error });
      } else {
        toast({
          title: autonomo ? "Equipo listo para trabajar solo" : "Job montado en el equipo",
          description: autonomo
            ? "Tiene el golden y el botón mide por su cuenta. Sin PC no hay lote ni etiqueta."
            : "El golden quedó grabado. El botón sigue avisando a la PC.",
        });
      }
      await cargarGolden(unidad.mac);
      await cargar();
    } finally { setCargando2(false); }
  };

  const volverAsistido = async () => {
    if (!unidad) return;
    setCargando2(true);
    try {
      const r = await api.testers.modoAsistido(unidad.mac, "configuracion");
      if (!r.ok) toast({ variant: "destructive", title: "No se pudo cambiar", description: r.error });
      else toast({ title: "Vuelve a medir la PC", description: "El botón avisa y la app corre la prueba." });
      await cargar();
    } finally { setCargando2(false); }
  };
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Borrador local: lo que el operador está eligiendo, todavía sin mandar.
  const [activo, setActivo] = useState(false);
  const [pin, setPin] = useState<number>(4);
  // Normalmente abierto = el pulsador solo cierra el circuito al pulsarlo, que
  // es lo normal. Cableado entre el pin y GND, el pull-up interno mantiene el
  // pin en ALTO y la pulsacion lo lleva a BAJO: por eso NO equivale a "activo
  // en BAJO". Se nombra como en planta, no como en el firmware.
  const [normalmenteAbierto, setNormalmenteAbierto] = useState(true);
  const [modo, setModo] = useState<"avisar" | "local">("avisar");

  const cargar = async () => {
    if (!unidad) return;
    setCargando(true);
    try {
      const d = await api.testers.trigger(unidad.mac);
      setInfo(d);
      api.boton()
        .then((b) => setQueCorre(b.vigilando.find((x) => x.mac === unidad.mac) ?? null))
        .catch(() => setQueCorre(null));
      cargarGolden(unidad.mac);
      const t = d.trigger;
      setActivo(!!t && t.pin >= 0);
      if (t && t.pin >= 0) setPin(t.pin);
      setNormalmenteAbierto(t ? t.active_low : true);
      setModo((t as any)?.mode === "local" ? "local" : "avisar");
    } catch (e: any) {
      toast({ title: "No se pudo leer el equipo", description: e.message, variant: "destructive" });
    } finally { setCargando(false); }
  };

  useEffect(() => { if (abierto) cargar(); /* eslint-disable-next-line */ }, [abierto, unidad?.mac]);

  const guardar = async () => {
    if (!unidad) return;
    setGuardando(true);
    try {
      const r = await api.testers.setTrigger(unidad.mac, activo ? pin : null, normalmenteAbierto, "configuracion", modo);
      if (!r.ok) {
        toast({ title: "El equipo no aceptó el cambio", description: r.error, variant: "destructive" });
      } else {
        toast({
          title: activo ? `Switch en IO${r.trigger!.pin}` : "Switch desactivado",
          description: activo
            ? `${normalmenteAbierto ? "Normalmente abierto" : "Normalmente cerrado"}. ` +
              (modo === "avisar"
                ? "Al pulsarlo, la app corre la prueba del SKU que esté puesto."
                : "Al pulsarlo, el equipo corre su prueba interna.")
            : "Este equipo ya no responde a ningún switch físico.",
        });
      }
      await cargar();
    } finally { setGuardando(false); }
  };

  const t = info?.trigger;
  const sinConexion = info && !info.ok;
  const cambiado = !!t && (activo !== (t.pin >= 0) ||
    (activo && (pin !== t.pin || normalmenteAbierto !== t.active_low ||
                modo !== ((t as any).mode === "local" ? "local" : "avisar"))));

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Equipo {unidad?.unit}
            {unidad?.connected && <Badge variant="secondary">conectado</Badge>}
          </DialogTitle>
          <DialogDescription>{unidad?.notes || "Sin nota"}</DialogDescription>
        </DialogHeader>

        {/* ── Identidad ── */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div className="text-gray-500">MAC</div>
          <div className="font-mono">{unidad?.mac}</div>
          <div className="text-gray-500">IP</div>
          <div className="font-mono">{unidad?.ip || "—"}</div>
          <div className="text-gray-500">Rol</div>
          <div>{unidad?.role || "—"}</div>
          <div className="text-gray-500">Firmware</div>
          <div>{info?.fw || unidad?.fw || "—"}</div>
          <div className="text-gray-500">Canales</div>
          <div>{info?.canales ?? "—"}</div>
          <div className="text-gray-500">Encendido desde</div>
          <div>{info?.uptime_s != null ? `${Math.floor(info.uptime_s / 60)} min` : "—"}</div>
          <div className="text-gray-500">Último arranque</div>
          <div>{info?.reset_reason || "—"}</div>
          <div className="text-gray-500">Memoria libre</div>
          <div>{info?.heap_free != null ? `${Math.round(info.heap_free / 1024)} kB` : "—"}</div>
        </div>

        {sinConexion && (
          <Alert variant="destructive">
            <TriangleAlert className="w-4 h-4" />
            <AlertDescription>
              {info?.error} — el switch se lee y se escribe en el equipo, así que
              hace falta que esté en la red.
            </AlertDescription>
          </Alert>
        )}

        {/* ── Switch físico ── */}
        <div className="border rounded-lg p-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium flex items-center gap-2">
                <ToggleLeft className="w-4 h-4" /> Switch físico (disparador)
              </p>
              <p className="text-xs text-gray-500">
                Un interruptor cableado al módulo que ejecuta la prueba sin tocar la
                pantalla. No todos los puestos lo necesitan: viene desactivado.
              </p>
              {t && (
                <p className="text-xs mt-1">
                  Ahora mismo:{" "}
                  {t.pin >= 0
                    ? <b>IO{t.pin}, activo {t.active_low ? "BAJO" : "ALTO"}</b>
                    : <b>desactivado</b>}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Switch checked={activo} onCheckedChange={setActivo} disabled={!info?.ok || cargando} />
              <Button size="icon" variant="ghost" onClick={cargar} disabled={cargando} title="Releer del equipo">
                <RefreshCw className={`w-4 h-4 ${cargando ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {activo && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pin">Pin del módulo ESP32</Label>
                <Select value={String(pin)} onValueChange={(v) => setPin(Number(v))}>
                  <SelectTrigger id="pin"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(info?.pines ?? []).map((p) => (
                      <SelectItem key={p.pin} value={String(p.pin)}>
                        IO{p.pin}
                        {p.estado === "recomendado" && " — recomendado"}
                        {p.estado === "ocupado_util" && " — ya trae botón"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-1">
                  {info?.pines?.find((p) => p.pin === pin)?.nota}
                </p>
              </div>
              <div>
                <Label htmlFor="niv">Tipo de botón</Label>
                <Select value={normalmenteAbierto ? "no" : "nc"}
                        onValueChange={(v) => setNormalmenteAbierto(v === "no")}>
                  <SelectTrigger id="niv"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no">Normalmente abierto (NO) — lo habitual</SelectItem>
                    <SelectItem value="nc">Normalmente cerrado (NC)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-1">
                  Cableado entre el pin y <b>GND</b>, sin resistencia: la de pull-up la
                  pone el ESP32. Con NC el contacto está cerrado en reposo y se abre al
                  pulsar.
                </p>
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="modo">Qué hace al pulsarlo</Label>
                <Select value={modo} onValueChange={(v) => setModo(v as "avisar" | "local")}>
                  <SelectTrigger id="modo"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="avisar">
                      Lanza la prueba de la app, con el SKU que esté puesto — recomendado
                    </SelectItem>
                    <SelectItem value="local">
                      El equipo corre su prueba interna (necesita golden en su memoria)
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-1">
                  {modo === "avisar"
                    ? "El equipo solo avisa de la pulsación; mide la PC, que es donde vive el golden. Funciona igual con una unidad que con tres."
                    : "El equipo mide solo, con el golden de su NVS. Si no lo tiene, la pulsación no hace nada."}
                </p>
              </div>
            </div>
          )}

          <div className="text-xs text-gray-600 space-y-1">
            <p className="font-medium">Pines disponibles</p>
            <ul className="list-disc ml-4">
              {(info?.pines ?? []).map((p) => (
                <li key={p.pin}><span className="font-mono">IO{p.pin}</span> — {p.nota}</li>
              ))}
            </ul>
            <p className="font-medium pt-1">Ocupados — el equipo los rechaza</p>
            <ul className="list-disc ml-4">
              {(info?.prohibidos ?? []).map((p) => (
                <li key={p.pin}><span className="font-mono">IO{p.pin}</span> — {p.motivo}</li>
              ))}
            </ul>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={guardar} disabled={!info?.ok || guardando || !cambiado}>
              {guardando ? "Guardando…" : activo ? "Aplicar al equipo" : "Quitar el switch"}
            </Button>
            {cambiado && <span className="text-xs text-amber-700">Sin aplicar</span>}
          </div>

          {activo && queCorre && (
            <div className="rounded border bg-slate-50 p-2 text-sm">
              {queCorre.correria
                ? <>Pulsarlo aquí corre <b>{queCorre.correria}</b> en este equipo.</>
                : <span className="text-amber-800">
                    Pulsarlo aquí no haría nada: {queCorre.motivo}.
                  </span>}
              {queCorre.candidatos.length > 1 && (
                <div className="text-xs text-gray-500 mt-0.5">
                  Productos aprobados en este equipo: {queCorre.candidatos.join(", ")}
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-gray-500">
            Se guarda en la memoria del propio equipo: sobrevive a reinicios y a una
            actualización por OTA, y viaja con él si cambia de estación. El producto lo
            decide <strong>el equipo que se pulsa</strong>, no la pantalla.
          </p>
        </div>

        {/* ── Job montado en el equipo ── */}
        <div className="border rounded-lg p-4 space-y-3">
          <div>
            <p className="font-medium flex items-center gap-2">
              <HardDriveDownload className="w-4 h-4" /> Job montado en el equipo
            </p>
            <p className="text-xs text-gray-500">
              El golden grabado en la memoria del ESP32. Es lo que le permite juzgar una
              pieza <strong>sin PC</strong>. Distinto del job que corre la app: este vive
              dentro del equipo y se lee de él, no de la base.
            </p>
          </div>

          {/* loaded=false con crc≠0 NO es "sin golden": es CORRUPTO. Lo dice el
              propio firmware, y confundir los dos casos manda a buscar por el
              lado equivocado. */}
          <div className="text-sm rounded border bg-slate-50 p-2">
            {golden?.loaded
              ? <>Lleva <b>{golden.sku || "(sin SKU)"}</b>
                  {golden.nets_count != null && <> · {golden.nets_count} conexiones</>}
                  {golden.crc != null && <span className="font-mono text-xs text-gray-500"> · crc {golden.crc}</span>}
                </>
              : golden && Number(golden.crc) !== 0
                ? <span className="text-amber-800">
                    <b>Golden corrupto</b> — hay algo grabado (crc {golden.crc}) pero el CRC no
                    cuadra. Vuelve a montarlo antes de dejarlo solo.
                  </span>
                : <span className="text-gray-500">Sin golden grabado: este equipo no puede juzgar nada solo.</span>}
          </div>

          <div className="grid sm:grid-cols-2 gap-2">
            <div className="sm:col-span-2">
              <Label htmlFor="job">Montar este producto</Label>
              <Select value={jobElegido} onValueChange={setJobElegido}>
                <SelectTrigger id="job"><SelectValue placeholder="Elige un producto…" /></SelectTrigger>
                <SelectContent>
                  {jobsDeUnEquipo.map((j: any) => (
                    <SelectItem key={j.id} value={String(j.id)}>
                      {j.sku} — {j.nets_count ?? "?"} conexiones
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!jobsDeUnEquipo.length && (
                <p className="text-xs text-amber-700 mt-1">
                  No hay productos de una sola unidad aprobados. Un arnés que usa varios
                  equipos no se puede probar sin PC.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!jobElegido || cargando2 || !info?.ok}
                    onClick={() => montarJob(false)}>
              Solo grabar el golden
            </Button>
            <Button disabled={!jobElegido || cargando2 || !info?.ok}
                    onClick={() => montarJob(true)}>
              <Wifi className="w-4 h-4 mr-2" />
              {cargando2 ? "Montando…" : "Dejarlo listo para trabajar solo"}
            </Button>
            {t?.pin != null && t.pin >= 0 && (t as any).mode === "local" && (
              <Button variant="ghost" disabled={cargando2} onClick={volverAsistido}>
                Volver a que mida la PC
              </Button>
            )}
          </div>

          <p className="text-xs text-gray-500">
            <strong>Trabajar solo</strong> = golden grabado + botón en modo local. Mide y
            canta el veredicto en los LEDs sin ordenador, pero <strong>no hay lote, ni
            etiqueta, ni quién lo probó</strong>: sirve para no parar la línea si se cae la
            PC, no para producir a ciegas. Se comprueba el CRC de lo grabado contra el de
            la base; si no cuadra, no se da por bueno.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
