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
import { Play, Square, Undo2, Save, Volume2, VolumeX, CircleCheck, TriangleAlert, Lightbulb, Hand } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, liveSocket, type EventoSocket, type FixtureInfo, type PinIdent } from "@/services/api";
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
    // Identificar: un pin da un tono claro; varios a la vez, dos tonos graves.
    // Si sonaran igual, el aviso de "la punta toca dos" se perderia justo
    // cuando el operador no esta mirando la pantalla, que es siempre.
    ident: () => pitar(1050, 80),
    varios: () => { pitar(500, 70); setTimeout(() => pitar(400, 90), 80); },
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
  const [aviso, setAviso] = useState<string | null>(null);
  const [puentes, setPuentes] = useState<{ canal: string; ohm: number | null; t: number }[]>([]);
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

  // ── Identificar un pin con la punta ──────────────────────────────────
  //
  // Es el recorrido al reves: en vez de "abre CN13 y ve tocando", se toca lo
  // que sea y la app dice cual es. Hace falta porque los numeros de pin son el
  // ORDEN en que se mapeo el conector, no algo que se pueda leer en la pieza:
  // cuando la prueba dice ABIERTO CN9.4 <-> CN13.7, no hay forma de saber que
  // metal es sin volver a tocarlo.
  const [identOn, setIdentOn] = useState(false);
  const [identFx, setIdentFx] = useState("");
  const [ultimo, setUltimo] = useState<{ pines: PinIdent[]; cuando: string; varios: boolean } | null>(null);
  const [tocando, setTocando] = useState<PinIdent[]>([]);
  const [histIdent, setHistIdent] = useState<{ pines: PinIdent[]; cuando: string; varios: boolean }[]>([]);
  const ultimaClave = useRef("");

  useEffect(() => {
    if (!identOn) return;
    const t = setInterval(async () => {
      try {
        const d = await api.socket.identEstado();
        // Pita al APARECER, no mientras la punta sigue apoyada: un pitido
        // continuo no informa de nada y en una jornada entera es insufrible.
        const clave = d.actual.map((p) => p.fisico ?? p.interno).sort().join("+");
        if (clave && clave !== ultimaClave.current) {
          if (d.actual.length > 1) pito.varios(); else pito.ident();
        }
        ultimaClave.current = clave;
        setTocando(d.actual); setUltimo(d.ultimo); setHistIdent(d.historial);
        if (!d.activa) setIdentOn(false);
      } catch { /* el bridge se reinicio */ }
    }, 300);
    return () => clearInterval(t);
  }, [identOn]);

  const abrirIdent = async () => {
    const fx = identFx || fixtureId;
    if (!fx) return toast({ title: "Elige el fixture", description: "Hace falta para traducir el canal a conector y pin.", variant: "destructive" });
    try {
      const d = await api.socket.identAbrir(fx, 15);
      setIdentOn(true); setUltimo(null); setTocando([]); setHistIdent([]);
      ultimaClave.current = "";
      if (d.avisos?.length) toast({ title: "Aviso del fixture", description: d.avisos.join(" · ") });
    } catch (e: any) {
      toast({ title: "No se pudo abrir", description: String(e?.message ?? e), variant: "destructive" });
    }
  };

  const cerrarIdent = async () => { setIdentOn(false); await api.socket.identCerrar().catch(() => {}); };

  const alternar = (ip: string) =>
    setEquipos((x) => x.includes(ip) ? x.filter((y) => y !== ip) : [...x, ip]);

  // ── Ordenar pulsando el boton de cada caja ───────────────────────────
  //
  // Elegir el orden desde la pantalla obliga a saber que caja es "424C", y
  // nadie lo sabe mientras no haya etiquetas pegadas. Pulsando el boton de la
  // que va en M, luego la de L1, luego la de L2, el orden sale del hardware:
  // no hay nada que recordar. El equipo destella su numero de posicion para
  // que no haya que fiarse de la pantalla.
  const [capturando, setCapturando] = useState(false);
  const [resta, setResta] = useState(0);
  const [pulsadas, setPulsadas] = useState<{ unit: string; posicion: string }[]>([]);
  const [modoOrden, setModoOrden] = useState<"boton" | "punta" | "reset">("reset");
  const [choque, setChoque] = useState<string | null>(null);

  useEffect(() => {
    if (!capturando) return;
    const t = setInterval(async () => {
      try {
        const d = await api.testers.orden();
        setPulsadas(d.unidades.map((u) => ({ unit: u.unit, posicion: u.posicion })));
        setResta(d.resta);
        setChoque(d.choque);
        if (d.unidades.length) setEquipos(d.unidades.map((u) => u.ip));
        if (!d.capturando) setCapturando(false);
      } catch { /* el bridge se reinicio: el sondeo siguiente lo dira */ }
    }, 500);
    return () => clearInterval(t);
  }, [capturando]);

  const ordenarConBoton = async (modo: "boton" | "punta" | "reset" = "boton") => {
    setPulsadas([]); setEquipos([]); setChoque(null); setModoOrden(modo);
    try {
      const d = await api.testers.capturarOrden(120, modo);
      setCapturando(true); setResta(d.segundos);
      toast({
        title: modo === "punta" ? "Toca un pin de cada caja, en orden"
             : modo === "reset" ? "Pulsa SW2 en cada caja, en orden"
             : "Pulsa los botones en orden",
        description: d.aviso ?? (
          modo === "punta"
            ? "Con el arnés DESCONECTADO: un pin cualquiera del socket que va en M, luego L1, luego L2."
            : modo === "reset"
              ? "SW2 es el reset: cada caja arranca de nuevo y tarda unos 10 s en volver. Deja un respiro entre una y otra."
              : "Primero la caja que va en M, luego L1, luego L2. No van a probar: la pulsación solo ordena."),
        variant: d.aviso ? "destructive" : undefined,
      });
    } catch (e: any) {
      toast({ title: "No se pudo abrir la captura", description: String(e?.message ?? e), variant: "destructive" });
    }
  };

  const cerrarCaptura = async () => {
    setCapturando(false);
    await api.testers.cerrarOrden().catch(() => {});
  };

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
        case "conector":  setEnCurso(ev.conector); setPines([]); setAviso(null); break;
        case "detectado":
          pito.ok();
          setPines((p) => [...p, { pin: ev.pin, canal: ev.canal, conector: ev.conector }]);
          setTotal((t) => t + 1);
          break;
        // No es un fallo: es el filtro haciendo su trabajo. Se enseña para que
        // el operador sepa que la app SI esta viendo algo, y que lo descarta
        // por buenas razones — si no, parece que no responde.
        // Tocar un pin sin conector abierto no anota nada — y hay que decirlo,
        // porque si no parece que la punta no funciona.
        case "sin_conector":
          setAviso(ev.mensaje);
          break;
        // Esto NO es ruido: es un pin con continuidad que no deberia tenerla.
        // Se separa de los descartes y se avisa fuerte.
        case "puente":
          pito.error();
          setPuentes((p) => [{ canal: ev.canal, ohm: ev.ohm, t: Date.now() }, ...p].slice(0, 5));
          toast({ variant: "destructive", title: `Puente en ${ev.canal}`, description: ev.mensaje });
          break;
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Identificar un pin</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={identFx || fixtureId} onValueChange={setIdentFx} disabled={identOn}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Fixture" /></SelectTrigger>
              <SelectContent>
                {fixtures.map((f) => <SelectItem key={f.id} value={f.id}>{f.nombre ?? f.id}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" onClick={() => pito.setActivo(!pito.activo)}
                    title={pito.activo ? "Silenciar" : "Activar sonido"}>
              {pito.activo ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </Button>
            {identOn
              ? <Button variant="secondary" onClick={cerrarIdent}>Terminar</Button>
              : <Button onClick={abrirIdent}>Empezar</Button>}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-600">
            Toca un pin con la punta de 3,3 V y te digo cuál es. Al revés que el recorrido:
            aquí no hay que abrir ningún conector. Los números de pin son el <strong>orden en
            que se recorrió</strong> ese conector al mapearlo, no una serigrafía — por eso
            <span className="font-mono"> CN13.7</span> no se puede deducir mirando la pieza.
          </p>

          {identOn && (
            <div className={`rounded-lg border-2 p-6 text-center ${
              tocando.length ? "border-emerald-500 bg-emerald-50" : "border-dashed border-slate-300"}`}>
              {tocando.length ? (
                <>
                  <div className="text-4xl font-bold text-emerald-900 font-mono">
                    {tocando.map((p) => p.fisico ?? p.interno).join("  +  ")}
                  </div>
                  <div className="text-sm text-emerald-800 mt-1 font-mono">
                    {tocando.map((p) => p.interno).join("  ")}
                  </div>
                  {tocando.length > 1 && (
                    <div className="text-sm text-amber-700 mt-2">
                      La punta toca <strong>{tocando.length} pines a la vez</strong>. Afínala
                      o el nombre no significa nada.
                    </div>
                  )}
                </>
              ) : (
                <div className="text-slate-500">Esperando la punta…</div>
              )}
            </div>
          )}

          {!tocando.length && ultimo && (
            <div className="rounded-lg border p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide">El último que tocaste</div>
              <div className="text-3xl font-bold font-mono">
                {ultimo.pines.map((p) => p.fisico ?? p.interno).join("  +  ")}
              </div>
              <div className="text-sm text-gray-500 font-mono">
                {ultimo.pines.map((p) => p.interno).join("  ")}
              </div>
            </div>
          )}

          {histIdent.length > 1 && (
            <div className="text-sm">
              <span className="text-gray-500">Antes: </span>
              {histIdent.slice(1, 8).map((h, i) => (
                <span key={i} className="font-mono mr-3">
                  {h.pines.map((p) => p.fisico ?? p.interno).join("+")}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
              <div className="flex items-center justify-between">
                <Label>Equipos, en el orden del montaje</Label>
                <div className="flex items-center gap-1">
                {capturando
                  ? <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={cerrarCaptura}>
                      Pulsando… {resta}s — terminar
                    </Button>
                  : <>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={corriendo}
                              onClick={() => ordenarConBoton("reset")}
                              title="SW2 del módulo: lo llevan todas las placas, soldadas o no">
                        <Hand className="w-3.5 h-3.5 mr-1" />Ordenar con SW2
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={corriendo}
                              onClick={() => ordenarConBoton("boton")}
                              title="Solo en los equipos con el botón de disparo soldado en IO4">
                        …o con el botón
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={corriendo}
                              onClick={() => ordenarConBoton("punta")}
                              title="Para los equipos sin botón soldado: toca un pin de cada socket, en orden">
                        …o con la punta
                      </Button>
                    </>}
                {equipos.length > 1 && !capturando && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={corriendo}
                          onClick={() => {
                            api.testers.identificar(equipos).catch(() => {});
                            toast({
                              title: "Mira las cajas",
                              description: `Un destello = ${equipos.length > 0 ? "M" : ""}, dos = L1${
                                equipos.length > 2 ? ", tres = L2" : ""}. Doce segundos.`,
                            });
                          }}>
                    <Lightbulb className="w-3.5 h-3.5 mr-1" />¿Cuál es cuál?
                  </Button>
                )}
                </div>
              </div>
              {capturando && (
                <div className="text-sm rounded border border-blue-200 bg-blue-50 text-blue-900 p-2 mt-1">
                  {pulsadas.length === 0
                    ? (modoOrden === "reset"
                        ? <>Pulsa <strong>SW2</strong> (el de <span className="font-mono">EN</span>) en el
                            equipo que va en <strong>M</strong>. Se reinicia y vuelve en ~10 s;
                            al contarse destella su número de posición.</>
                        : modoOrden === "punta"
                        ? <>Toca con la punta un pin cualquiera del socket del equipo que va en
                            <strong> M</strong>, con el <strong>arnés desconectado</strong>. Cada uno
                            destella su número de posición al contarse.</>
                        : <>Pulsa el botón del equipo que va en <strong>M</strong>. Cada uno destella
                            su número de posición al contarse.</>)
                    : <>{pulsadas.map((p) => `${p.posicion} = ${p.unit}`).join("  ·  ")}
                        {pulsadas.length < (enRed.data ?? []).length &&
                          <> — ahora el de <strong>{pulsadas.length === 1 ? "L1" : `L${pulsadas.length}`}</strong>.</>}</>}
                  {choque && <div className="text-red-700 mt-1">{choque}</div>}
                </div>
              )}
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

            {aviso && !enCurso && (
              <div className="text-sm rounded border border-blue-200 bg-blue-50 text-blue-900 p-2">
                {aviso} Pon su nombre arriba y pulsa <strong>Empezar</strong>.
              </div>
            )}

            {puentes.length > 0 && (
              <div className="text-sm rounded border border-red-300 bg-red-50 text-red-900 p-2">
                <span className="font-medium">Con continuidad, no acoplamiento:</span>{" "}
                {puentes.map((p) => `${p.canal}${p.ohm != null ? ` (~${p.ohm} Ω)` : ""}`).join(", ")}
                <div className="text-red-800 mt-0.5">
                  Estos pines siguen arriba aunque se fuercen a masa: hay camino de continua.
                  No son fantasmas — revisa el socket.
                </div>
              </div>
            )}

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
