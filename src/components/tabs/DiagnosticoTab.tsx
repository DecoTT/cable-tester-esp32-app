import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Stethoscope, Zap, TriangleAlert, Scissors, CircleHelp, Waves } from "lucide-react";
import AdvancedScope from "@/components/AdvancedScope";
import { api, type PatronFallo, type Clasificacion2 } from "@/services/api";
import { useToast } from "@/hooks/use-toast";

// Diagnóstico.
//
// La pestaña de Pruebas dice si la pieza pasa. Esta dice DÓNDE está el problema
// y, sobre todo, QUÉ tipo de problema es — que es lo que decide cómo se repara.
//
// DOS COSAS QUE EL MAPA NO PUEDE DECIR POR SÍ SOLO
//
// 1. Un canal pegado a masa y un cable roto salen EXACTAMENTE IGUAL: los dos
//    como "aislado". Para quien repara la diferencia lo es todo — un abierto es
//    un crimp mal hecho, un corto a masa es un pin corrido o una rebaba. Se
//    distinguen con una medida analógica suelta, que es lo que hace el botón
//    "Clasificar": excita un extremo dejando el otro en alta impedancia y mira
//    si la tensión se mantiene o cae.
//
// 2. Veinte fallos repartidos son ruido; veinte fallos en la MISMA línea son un
//    utillaje que hay que arreglar hoy. Por eso los patrones se agrupan por
//    línea, no por pieza.

const hoy    = () => new Date().toISOString().slice(0, 10);
const haceN  = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const hora   = (s: string) => new Date(s).toLocaleString();

function IconoTipo({ tipo }: { tipo: string }) {
  if (tipo === "gnd")     return <Zap className="w-4 h-4 text-amber-600" />;
  if (tipo === "abierto") return <Scissors className="w-4 h-4 text-red-600" />;
  return <CircleHelp className="w-4 h-4 text-slate-400" />;
}

export default function DiagnosticoTab({ skuActivo, equipo }: { skuActivo: string; equipo: string }) {
  const { toast } = useToast();
  const [desde, setDesde] = useState(haceN(30));
  const [hasta, setHasta] = useState(hoy());
  // Arranca en el producto que se esta corriendo en Pruebas.
  //
  // Es filtro PROPIO, no el estado compartido: aqui tiene sentido mirar "todos"
  // los productos para ver patrones, y hacerlo no deberia cambiar el SKU que el
  // operador tiene puesto en la pantalla de produccion.
  const [sku, setSku]     = useState(skuActivo);
  useEffect(() => { setSku(skuActivo); }, [skuActivo]);

  // Si hay un EQUIPO fijado arriba, manda él: "voy a ver qué le pasa a la
  // 8744" no debería obligar a adivinar antes qué producto lleva puesto.
  const estaciones = useQuery({
    queryKey: ["estaciones"], queryFn: api.estaciones.list,
    enabled: !!equipo, refetchInterval: 10000,
  });
  const laDelEquipo = (estaciones.data?.estaciones ?? []).find((e) => e.mac === equipo);
  useEffect(() => {
    const suyo = laDelEquipo?.correria || laDelEquipo?.sku;
    if (suyo) setSku(suyo);
  }, [laDelEquipo?.correria, laDelEquipo?.sku]);
  const [testSel, setTestSel] = useState<number | null>(null);
  const [clasif, setClasif]   = useState<Clasificacion2[] | null>(null);
  const [midiendo, setMidiendo] = useState(false);
  // "Avanzado" va aqui dentro y no en una pestaña nueva: es la misma pregunta
  // —que le pasa a esta linea— con mas detalle, y la barra de pestañas ya esta
  // llena.
  const [avanzado, setAvanzado] = useState(false);

  const skus = useQuery({ queryKey: ["skus"], queryFn: api.skus.list });

  const filtro = { sku: sku || undefined, desde, hasta };
  const patrones = useQuery({
    queryKey: ["patrones", filtro],
    queryFn: () => api.diagnostico.patrones(filtro),
  });

  // Las piezas que fallaron, para poder clasificar una concreta.
  const fallidas = useQuery({
    queryKey: ["pruebas-fail", filtro],
    queryFn: () => api.pruebas({ ...filtro, resultado: "FAIL" }),
  });

  const prueba = useMemo(
    () => fallidas.data?.pruebas?.find((p: any) => p.id === testSel) ?? null,
    [fallidas.data, testSel],
  );

  const fallosDe = (p: any) => {
    try { return JSON.parse(p?.faults || "[]"); } catch { return []; }
  };

  const clasificar = async () => {
    if (!testSel) return;
    setMidiendo(true); setClasif(null);
    try {
      const r = await api.diagnostico.clasificar(testSel);
      if (!r.ok) return toast({ title: "No se pudo clasificar", description: r.error, variant: "destructive" });
      if (r.sin_abiertos) {
        toast({
          title: "Nada que clasificar",
          description: "Esta pieza no tiene canales aislados: los cortos ya vienen identificados.",
        });
        return;
      }
      setClasif(r.resultados);
    } catch (e: any) {
      toast({ title: "Error de medida", description: e.message, variant: "destructive" });
    } finally { setMidiendo(false); }
  };

  const tasa = patrones.data && patrones.data.piezas_total
    ? (patrones.data.piezas_fallidas / patrones.data.piezas_total) * 100
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Stethoscope className="w-6 h-6" /> Diagnóstico
          </h2>
          <p className="text-gray-600">
            Qué falla, dónde, y de qué tipo. Un abierto y un corto a masa se ven
            igual en el mapa y se arreglan distinto.
          </p>
          {laDelEquipo && (
            <p className="text-sm text-slate-600 mt-1">
              Sobre el equipo <b>{laDelEquipo.unit}</b>
              {laDelEquipo.notes ? ` — ${laDelEquipo.notes}` : ""}
              {laDelEquipo.correria
                ? <> · lleva <b>{laDelEquipo.correria}</b></>
                : <span className="text-amber-700"> · {laDelEquipo.motivo}</span>}
            </p>
          )}
        </div>
        <Button variant={avanzado ? "default" : "outline"} onClick={() => setAvanzado(!avanzado)}>
          <Waves className="w-4 h-4 mr-2" />
          {avanzado ? "Ocultar avanzado" : "Avanzado"}
        </Button>
      </div>

      {avanzado && (
        <Card>
          <CardHeader>
            <CardTitle>Avanzado — voltios reales por línea</CardTitle>
            <p className="text-sm text-gray-600">
              {sku
                ? <>Sobre <b>{sku}</b>, con las unidades y el orden de su golden.</>
                : <span className="text-amber-700">Elige un producto en el filtro de arriba.</span>}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-xs">
              <Label htmlFor="sku-av">Producto</Label>
              <Select value={sku || "__ninguno__"}
                      onValueChange={(v) => setSku(v === "__ninguno__" ? "" : v)}>
                <SelectTrigger id="sku-av"><SelectValue placeholder="Elige un producto…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ninguno__">Ninguno</SelectItem>
                  {(skus.data ?? []).map((s) => (
                    <SelectItem key={s.codigo} value={s.codigo}>{s.codigo} — {s.descripcion}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <AdvancedScope sku={sku} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="d1">Desde</Label>
              <Input id="d1" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="d2">Hasta</Label>
              <Input id="d2" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            <div className="min-w-[14rem]">
              <Label htmlFor="sk">Producto</Label>
              <Select value={sku || "__todos__"} onValueChange={(v) => setSku(v === "__todos__" ? "" : v)}>
                <SelectTrigger id="sk"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__todos__">Todos</SelectItem>
                  {(skus.data ?? []).map((s) => (
                    <SelectItem key={s.codigo} value={s.codigo}>{s.codigo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {patrones.data && (
              <div className="text-sm text-gray-600 pb-2">
                <b>{patrones.data.piezas_fallidas}</b> de {patrones.data.piezas_total} piezas
                {" "}({tasa.toFixed(1)} %)
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Dónde duele ── */}
        <Card>
          <CardHeader>
            <CardTitle>Líneas que más fallan</CardTitle>
            <p className="text-sm text-gray-600">
              Agrupado por línea, no por pieza: repetirse en la misma es utillaje,
              repartirse es proceso.
            </p>
          </CardHeader>
          <CardContent>
            {patrones.isLoading && <p className="text-sm text-gray-500">Cargando…</p>}
            {patrones.data?.patrones.length === 0 && (
              <p className="text-sm text-gray-500">Ningún fallo en este rango. Buena señal.</p>
            )}
            <div className="space-y-2">
              {(patrones.data?.patrones ?? []).slice(0, 15).map((p: PatronFallo, i) => {
                const maxVeces = patrones.data!.patrones[0].veces;
                return (
                  <div key={i} className="rounded border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant={p.tipo === "CORTO" ? "destructive" : "secondary"}>{p.tipo}</Badge>
                        <span className="text-sm truncate" title={p.texto}>{p.texto}</span>
                      </div>
                      <span className="text-sm font-bold tabular-nums shrink-0">{p.veces}×</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded bg-slate-100 overflow-hidden">
                      <div className="h-full bg-slate-400" style={{ width: `${(p.veces / maxVeces) * 100}%` }} />
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {p.sku} · última {p.ultima ? hora(p.ultima) : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* ── Abierto o masa ── */}
        <Card>
          <CardHeader>
            <CardTitle>Abierto o pegado a masa</CardTitle>
            <p className="text-sm text-gray-600">
              Elige una pieza fallida y mídela. <strong>Con el arnés puesto en el
              tester</strong>: esto no lee el historial, mide de nuevo.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="pz">Pieza fallida</Label>
              <Select value={testSel ? String(testSel) : ""}
                      onValueChange={(v) => { setTestSel(Number(v)); setClasif(null); }}>
                <SelectTrigger id="pz"><SelectValue placeholder="Elige una prueba…" /></SelectTrigger>
                <SelectContent>
                  {(fallidas.data?.pruebas ?? []).slice(0, 40).map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      #{p.id} · {p.sku} · {hora(p.started_at)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {prueba && (
              <div className="rounded border p-2 space-y-1">
                <div className="text-xs text-gray-500">Lo que se registró entonces:</div>
                {fallosDe(prueba).map((f: any, i: number) => (
                  <div key={i} className="text-sm flex gap-2">
                    <Badge variant={f.tipo === "CORTO" ? "destructive" : "secondary"} className="shrink-0">
                      {f.tipo}
                    </Badge>
                    <span className="truncate" title={f.texto}>{f.texto}</span>
                  </div>
                ))}
              </div>
            )}

            <Button onClick={clasificar} disabled={!testSel || midiendo}>
              {midiendo ? "Midiendo…" : "Clasificar aislados"}
            </Button>

            {clasif && clasif.length > 0 && (
              <div className="space-y-2">
                {clasif.map((c, i) => (
                  <Alert key={i} className={c.tipo === "gnd" ? "border-amber-300 bg-amber-50" : ""}>
                    <IconoTipo tipo={c.tipo} />
                    <AlertDescription>
                      <div className="font-medium">
                        {c.fisico || c.canal} —{" "}
                        {c.tipo === "gnd" ? "PEGADO A MASA" : c.tipo === "abierto" ? "ABIERTO" : "no medible"}
                        {typeof c.v === "number" && (
                          <span className="font-mono text-xs text-gray-500"> ({c.v.toFixed(3)} V)</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-600">{c.consejo}</div>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            )}

            {clasif && clasif.length === 0 && (
              <Alert>
                <TriangleAlert className="w-4 h-4" />
                <AlertDescription>
                  No se pudo mapear ningún canal de esa prueba al montaje actual.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
