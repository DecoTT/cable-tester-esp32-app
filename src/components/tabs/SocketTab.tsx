import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Play, Square, Undo2, Save, Volume2, VolumeX, CircleCheck, TriangleAlert } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, liveSocket, type EventoSocket, type FixtureInfo } from "@/services/api";
import { useToast } from "@/hooks/use-toast";

// Validación de socket y aprendizaje del fixture.
//
// QUÉ PROBLEMA RESUELVE
//
// El motor de medida habla en coordenadas internas del tester — "M.J11",
// "L1.J14" — y eso no le dice nada a nadie: no sabes a qué conector ir, a qué
// pin, ni si falta un cable o está mal crimpeado.
//
// Aquí se construye la traducción MIDIENDO, no leyendo esquemáticos: el
// operador mete 3,3 V con una punta en cada pin del JST, el tester detecta qué
// canal se puso alto y pita. Recorrido el socket entero, la tabla está
// completa — y es la del fixture real, no la del dibujo.
//
// De paso valida el socket: si un conector de 10 posiciones solo da 9 pitidos,
// hay un contacto muerto, y se sabe antes de montar ningún arnés.

function usePitido() {
  const ctx = useRef<AudioContext | null>(null);
  const [activo, setActivo] = useState(true);

  const pitar = (hz: number, ms: number) => {
    if (!activo) return;
    try {
      ctx.current ??= new AudioContext();
      const c = ctx.current;
      if (c.state === "suspended") c.resume();
      const osc = c.createOscillator();
      const gan = c.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      // Rampa corta: un tono cuadrado seco cansa mucho en una jornada entera.
      gan.gain.setValueAtTime(0.0001, c.currentTime);
      gan.gain.exponentialRampToValueAtTime(0.25, c.currentTime + 0.01);
      gan.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + ms / 1000);
      osc.connect(gan); gan.connect(c.destination);
      osc.start(); osc.stop(c.currentTime + ms / 1000 + 0.02);
    } catch { /* sin audio, se sigue viendo en pantalla */ }
  };

  return {
    activo, setActivo,
    ok:    () => pitar(1320, 90),    // pin nuevo detectado
    fin:   () => { pitar(880, 120); setTimeout(() => pitar(1320, 160), 140); },
    error: () => { pitar(220, 180); setTimeout(() => pitar(180, 260), 190); },
  };
}

interface PinDetectado { pin: number; canal: string; conector: string | null }
interface ConectorHecho { conector: string; detectados: number; esperados: number; ok: boolean; faltan: number }

export default function SocketTab({ sku, setSku }: { sku: string; setSku: (v: string) => void }) {
  const { toast } = useToast();
  const pito = usePitido();

  // Para QUE producto se recorre este socket.
  //
  // Un mapa de fixture sin SKU no se puede usar: el golden lo referencia por
  // nombre, y si nadie dice cual es, los informes siguen saliendo en M.Jxx.
  // Por defecto viene el SKU que se este corriendo en Pruebas.
  const skus = useQuery({ queryKey: ["skus"], queryFn: api.skus.list });

  const [corriendo, setCorriendo] = useState(false);
  const [conector, setConector] = useState("");
  const [esperados, setEsperados] = useState(10);
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [pines, setPines] = useState<PinDetectado[]>([]);
  const [hechos, setHechos] = useState<ConectorHecho[]>([]);
  const [fixtureId, setFixtureId] = useState("");
  const [fixtures, setFixtures] = useState<FixtureInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [descartes, setDescartes] = useState<{ canal: string; mv: number; t: number }[]>([]);
  // Un socket puede servir a varios SKU, asi que el nombre se puede editar: el
  // sugerido es por SKU, pero si dos productos comparten fixture se le pone el
  // mismo nombre a proposito y los dos goldens apuntan ahi.
  const [nombreTocado, setNombreTocado] = useState(false);

  // ── Sobre qué equipos se escucha ─────────────────────────────────────
  //
  // El motor de socket mide sobre las unidades ABIERTAS en el bridge, y hasta
  // ahora nadie las abría desde aquí: solo quedaban abiertas si antes habías
  // pasado por el asistente de SKU en la misma sesión. Entrar directo a Socket
  // daba "no hay unidades. POST /api/medida/unidades primero", que además no
  // le dice nada a quien está en planta con la punta en la mano.
  //
  // Se eligen aquí, EN ORDEN — el primero es M, luego L1, L2 — porque un
  // socket se recorre igual antes de que exista el SKU.
  const [equipos, setEquipos] = useState<string[]>([]);
  const enRed = useQuery({ queryKey: ["discovered"], queryFn: api.testers.discovered, refetchInterval: 8000 });
  const jobs  = useQuery({ queryKey: ["jobs"], queryFn: () => api.medida.jobs().then((d) => d.jobs) });

  // Si el SKU elegido ya tiene golden, se proponen SUS unidades y su orden:
  // recorrer el socket con otro orden daría nombres que no significan lo mismo.
  useEffect(() => {
    if (!sku || equipos.length) return;
    const j = (jobs.data ?? []).find((x: any) => x.sku === sku && x.status === "approved");
    if (!j) return;
    try {
      const hosts = JSON.parse(j.hosts || "[]");
      if (hosts.length) setEquipos(hosts);
    } catch { /* job sin hosts: se eligen a mano */ }
  }, [sku, jobs.data]);   // eslint-disable-line react-hooks/exhaustive-deps

  const alternar = (ip: string) =>
    setEquipos((x) => x.includes(ip) ? x.filter((y) => y !== ip) : [...x, ip]);

  useEffect(() => { api.fixtures.list().then((d) => setFixtures(d.fixtures)).catch(() => {}); }, []);

  useEffect(() => {
    if (!nombreTocado) setFixtureId(sku ? `fixture-${sku}` : "");
  }, [sku, nombreTocado]);

  useEffect(() => {
    const s = liveSocket();
    const onEv = (ev: EventoSocket) => {
      switch (ev.tipo) {
        case "arrancado": setCorriendo(true); break;
        case "parado":    setCorriendo(false); setEnCurso(null); break;
        case "conector":  setEnCurso(ev.conector); setPines([]); break;
        case "detectado":
          pito.ok();
          setPines((p) => [...p, { pin: ev.pin, canal: ev.canal, conector: ev.conector }]);
          setTotal((t) => t + 1);
          break;
        // No es un fallo: es el filtro haciendo su trabajo. Se enseña para que
        // el operador sepa que la app SI esta viendo algo, y que lo descarta
        // por buenas razones — si no, parece que no responde.
        case "descartado":
          setDescartes((d) => [{ canal: ev.canal, mv: ev.mv, t: Date.now() }, ...d].slice(0, 5));
          break;
        case "deshecho":
          setPines((p) => p.slice(0, -1));
          setTotal((t) => Math.max(0, t - 1));
          break;
        case "conector_fin":
          ev.ok ? pito.fin() : pito.error();
          setHechos((h) => [...h, {
            conector: ev.conector, detectados: ev.detectados,
            esperados: ev.esperados, ok: ev.ok, faltan: ev.faltan,
          }]);
          setEnCurso(null); setPines([]);
          break;
        case "error":
          pito.error();
          toast({ variant: "destructive", title: "Error de medida", description: ev.mensaje });
          break;
      }
    };
    s.on("socket:evento", onEv);
    return () => { s.off("socket:evento", onEv); };
  }, [pito, toast]);

  const arrancar = async () => {
    if (!equipos.length) {
      return toast({
        variant: "destructive",
        title: "Elige los equipos",
        description: "Hay que decir sobre qué unidades se escucha, y en qué orden.",
      });
    }
    try {
      // Abrir las unidades ANTES de escuchar. Es lo que faltaba: sin esto el
      // bridge no tiene sobre qué medir y rechaza la sesión.
      await api.medida.setUnidades(equipos);
      await api.socket.arrancar();
    } catch (e: any) {
      toast({ variant: "destructive", title: "No se pudo arrancar", description: e.message });
    }
  };
  const parar = async () => { try { await api.socket.parar(); } catch { /* ya parada */ } };

  const empezarConector = async () => {
    if (!conector.trim()) return;
    try { await api.socket.conector(conector.trim(), esperados); }
    catch (e: any) { toast({ variant: "destructive", title: "Error", description: e.message }); }
  };

  const cerrar = async () => {
    try {
      const r = await api.socket.cerrar();
      if (!r.ok) {
        toast({
          variant: "destructive",
          title: `${r.conector}: faltan ${r.faltan} contacto(s)`,
          description: `Detectados ${r.detectados} de ${r.esperados}. Revisa esos pines antes de montar un arnés.`,
        });
      }
      setConector("");
    } catch (e: any) { toast({ variant: "destructive", title: "Error", description: e.message }); }
  };

  const guardar = async () => {
    if (!fixtureId.trim()) return;
    try {
      await api.socket.guardar(fixtureId.trim(), fixtureId.trim());
      const d = await api.fixtures.list();
      setFixtures(d.fixtures);
      // Guardarlo NO basta: el golden es quien lo referencia. Si no se vuelve a
      // capturar eligiendo este fixture, los informes siguen en M.Jxx y el
      // recorrido no sirve de nada.
      toast({
        title: "Fixture guardado",
        description: `${total} pin(es) como "${fixtureId}". Falta un paso: vuelve a `
          + `capturar el golden de ${sku || "el SKU"} eligiendo este fixture, `
          + `o los informes seguiran diciendo M.Jxx.`,
      });
    } catch (e: any) { toast({ variant: "destructive", title: "No se pudo guardar", description: e.message }); }
  };

  const faltanPorDetectar = enCurso ? Math.max(0, esperados - pines.length) : 0;

  return (
    <div className="space-y-6">
      <Alert>
        <AlertDescription>
          Mete <strong>3,3 V</strong> con la punta en cada pin del conector JST. Cada
          pin nuevo <strong>pita</strong> y queda anotado, sin que tengas que apartar la
          vista. El tester solo escucha: la tensión la pones tú.
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>
              Recorrido
              {sku && <span className="ml-2 text-sm font-normal text-slate-500">para {sku}</span>}
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" onClick={() => pito.setActivo(!pito.activo)}
                      title={pito.activo ? "Silenciar" : "Activar sonido"}>
                {pito.activo ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </Button>
              {corriendo
                ? <Button variant="destructive" onClick={parar}><Square className="w-4 h-4 mr-2" />Parar</Button>
                : <Button onClick={arrancar}><Play className="w-4 h-4 mr-2" />Escuchar</Button>}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="sku-socket">Producto</Label>
              <Select value={sku} onValueChange={setSku}>
                <SelectTrigger id="sku-socket">
                  <SelectValue placeholder="¿Para qué SKU es este socket?" />
                </SelectTrigger>
                <SelectContent>
                  {(skus.data ?? []).filter((x) => x.active).map((x) => (
                    <SelectItem key={x.codigo} value={x.codigo}>
                      {x.codigo} — {x.descripcion}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!sku && (
                <p className="text-xs text-amber-700 mt-1">
                  Sin SKU, el mapa que recorras no se puede enlazar a ningún golden.
                </p>
              )}
            </div>

            <div>
              <Label>Equipos, en el orden del montaje</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {(enRed.data ?? []).map((d) => {
                  const i = equipos.indexOf(d.ip || "");
                  return (
                    <button key={d.unit} type="button" disabled={corriendo}
                            onClick={() => d.ip && alternar(d.ip)}
                            className={`px-3 py-1.5 rounded border text-sm disabled:opacity-50 ${
                              i >= 0 ? "bg-slate-900 text-white border-slate-900" : "hover:bg-slate-100"}`}>
                      {i >= 0 && <span className="font-mono mr-1">{i === 0 ? "M" : `L${i}`}</span>}
                      {d.unit}
                    </button>
                  );
                })}
                {!(enRed.data ?? []).length && (
                  <span className="text-sm text-gray-500">Ningún equipo en la red.</span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {equipos.length
                  ? <>{equipos.length * 32} canales. <strong>Todas escuchan a la vez</strong>:
                      no hay una que mande y otras que acompañen. Las etiquetas
                      (<span className="font-mono">M</span>, <span className="font-mono">L1</span>,
                      <span className="font-mono"> L2</span>) son la <strong>posición</strong>, no
                      una jerarquía — pero define los nombres de canal, así que con otro orden los
                      nombres no significan lo mismo.</>
                  : <>Elige sobre qué unidades se escucha. Si el SKU ya tiene golden, se
                      proponen las suyas.</>}
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[10rem]">
                <Label htmlFor="conector">Conector</Label>
                <Input id="conector" value={conector} placeholder="CN15"
                       onChange={(e) => setConector(e.target.value)} disabled={!!enCurso} />
              </div>
              <div className="w-32">
                <Label htmlFor="esperados">Posiciones</Label>
                <Input id="esperados" type="number" min={1} value={esperados}
                       onChange={(e) => setEsperados(Number(e.target.value))} disabled={!!enCurso} />
              </div>
              {enCurso
                ? <Button onClick={cerrar} variant="secondary">Cerrar {enCurso}</Button>
                : <Button onClick={empezarConector} disabled={!corriendo || !conector.trim()}>Empezar</Button>}
              <Button variant="outline" onClick={() => api.socket.deshacer().catch(() => {})}
                      disabled={!pines.length} title="Si la punta resbaló">
                <Undo2 className="w-4 h-4 mr-2" />Deshacer
              </Button>
            </div>

            {descartes.length > 0 && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                <span className="font-medium">Descartados por acoplamiento:</span>{" "}
                {descartes.map((d) => `${d.canal} (${d.mv} mV)`).join(", ")}
                <div className="text-amber-700 mt-0.5">
                  Se pusieron altos pero a media tensión: es el vecino, no la punta. Un pin
                  tocado marca ~3300 mV.
                </div>
              </div>
            )}

            {enCurso && (
              <div className="rounded-lg border p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium">{enCurso}</span>
                  <span className={`text-2xl font-bold tabular-nums ${
                    pines.length === esperados ? "text-green-600" : "text-slate-700"}`}>
                    {pines.length} / {esperados}
                  </span>
                </div>
                {faltanPorDetectar > 0 && (
                  <p className="text-sm text-slate-500 mb-3">
                    Faltan {faltanPorDetectar}. Si ya los tocaste todos y no pitan,
                    esos contactos están muertos.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {pines.map((p) => (
                    <Badge key={p.pin} variant="secondary" className="font-mono">
                      {p.pin} → {p.canal}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {!enCurso && !hechos.length && (
              <p className="text-sm text-slate-500">
                Dale a <strong>Escuchar</strong>, pon el nombre del conector y sus
                posiciones, y empieza a tocar pines.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Conectores hechos</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!hechos.length && <p className="text-sm text-slate-500">Ninguno todavía.</p>}
            {hechos.map((h, i) => (
              <div key={i} className={`flex items-center gap-2 rounded-md border p-3 ${
                h.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
                {h.ok ? <CircleCheck className="w-4 h-4 text-green-600 shrink-0" />
                      : <TriangleAlert className="w-4 h-4 text-red-600 shrink-0" />}
                <div className="min-w-0">
                  <div className="font-medium">{h.conector}</div>
                  <div className="text-sm text-slate-600">
                    {h.detectados} de {h.esperados}
                    {!h.ok && <strong className="text-red-700"> — faltan {h.faltan}</strong>}
                  </div>
                </div>
              </div>
            ))}

            <div className="pt-3 border-t space-y-2">
              <Label htmlFor="fix">Guardar como fixture</Label>
              <Input id="fix" value={fixtureId} placeholder="fixture-SKU4589"
                     onChange={(e) => { setNombreTocado(true); setFixtureId(e.target.value); }} />
              <p className="text-xs text-slate-500">
                Sale del SKU. Si varios productos comparten el mismo socket, ponles
                el <strong>mismo nombre</strong> a propósito: un fixture, varios goldens.
              </p>
              <Button className="w-full" onClick={guardar} disabled={!total || !fixtureId.trim()}>
                <Save className="w-4 h-4 mr-2" />Guardar {total ? `(${total} pines)` : ""}
              </Button>
              <p className="text-xs text-slate-500">
                A partir de aquí los informes dirán <strong>CN15.3</strong> en vez de
                <strong> M.J11</strong>.
              </p>
            </div>

            {fixtures.length > 0 && (
              <div className="pt-3 border-t">
                <div className="text-sm font-medium mb-2">Guardados</div>
                {fixtures.map((f) => (
                  <div key={f.id} className="text-sm text-slate-600">
                    {f.nombre} · {f.pines} pines · {f.conectores.join(", ")}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
