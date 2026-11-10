import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Play, CircleCheck, CircleX, TriangleAlert, PackagePlus, PackageCheck, RotateCcw,
} from "lucide-react";
import { api, liveSocket, type Fallo } from "@/services/api";
import { useToast } from "@/hooks/use-toast";

// Pantalla de producción. Es la que el operador mira todo el día, así que el
// veredicto tiene que leerse de lejos y los fallos decir a qué conector ir.
//
// Las unidades NO se eligen aquí: van dentro del job, en el orden con el que se
// capturó el golden. Elegirlas a mano sería una fuente de fallos falsos.

interface Resultado {
  id: number; resultado: "PASS" | "FAIL" | "ERROR";
  fallos: Fallo[];
  // Lo que NO rechaza la pieza pero el operador debe mirar: un contacto que
  // conduce pero va justo. Solo lo traen los subensambles, que son los que
  // miden resistencia.
  recomendaciones?: Fallo[];
  error: string | null;
  duracion_ms: number; huella: string | null; golden: string;
  // Contra qué se validó. Sin esto el veredicto no se puede leer solo.
  sku?: string; golden_nombre?: string | null; por_mac?: boolean;
  job: { id: number; nombre: string; nets: number; unidades: number };
}

export default function PruebasTab({ operator, sku, setSku }: {
  operator: string;
  // El SKU viene de arriba: lo comparte con la pestana Socket, que necesita
  // saber para que producto se esta aprendiendo el fixture.
  sku: string;
  setSku: (v: string) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [lote, setLote] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ hecho: number; total: number } | null>(null);
  const [res, setRes] = useState<Resultado | null>(null);

  const skus = useQuery({ queryKey: ["skus"], queryFn: api.skus.list });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.medida.jobs().then((d) => d.jobs) });

  // Solo se pueden probar SKUs con golden aprobado: sin referencia no hay
  // veredicto posible.
  const probables = useMemo(
    () => (skus.data ?? []).filter((s) => s.active && jobs.data?.some((j: any) => j.sku === s.codigo)),
    [skus.data, jobs.data],
  );
  const job = jobs.data?.find((j: any) => j.sku === sku);

  useEffect(() => {
    const s = liveSocket();
    const on = (p: any) => { if (p.fase === "prueba") setProg({ hecho: p.hecho, total: p.total }); };

    // El BOTÓN FÍSICO no pasa por esta pantalla: la prueba la lanza el bridge.
    // Estos eventos son la única forma que tiene la pantalla de enterarse, así
    // que el resultado tiene que verse aquí igual que si se hubiera pulsado
    // "Probar" — el operador no debería notar la diferencia.
    const onBoton = (p: any) => {
      setBusy(true); setRes(null); setProg(null);
      toast({ title: `Botón de ${p.unidad}`, description: `${p.sku} · ${p.operador}` });
    };
    const onResultado = (p: any) => {
      if (!p.origen || p.origen === "app") return;   // el de la pantalla ya se pinta solo
      setBusy(false); setProg(null);
      setRes(p);
      qc.invalidateQueries({ queryKey: ["pruebas"] });
      if (p.lote_id || lote) api.lotes.list(p.sku).then((l) =>
        setLote(l.lotes.find((x: any) => x.id === lote?.id) ?? null)).catch(() => {});
    };
    const onSinContexto = (p: any) => {
      setBusy(false);
      toast({ variant: "destructive", title: `${p.unidad}: botón sin efecto`, description: p.mensaje });
    };
    const onErrorBoton = (p: any) => {
      setBusy(false);
      toast({ variant: "destructive", title: `${p.unidad}: la prueba falló`, description: p.error });
    };
    // Bolsa completa: la etiqueta ya salió. El operador tiene que enterarse
    // aunque la prueba la haya lanzado el botón y no esta pantalla.
    const onPack = (p: any) => {
      qc.invalidateQueries({ queryKey: ["lotes"] });
      toast({
        title: `Bolsa completa — ${p.packs * p.piezas_por_pack} piezas`,
        description: p.impreso
          ? `Etiqueta impresa en ${p.impresora}. Lote ${p.lote}, ${p.buenos} buenas.`
          : `Etiqueta generada (PDF). Lote ${p.lote}, ${p.buenos} buenas.`,
      });
    };
    const onPackError = (p: any) => toast({
      variant: "destructive",
      title: "La pieza se registró, la etiqueta no salió",
      description: `${p.error}. Reimprímela desde Etiquetas.`,
    });

    s.on("medida:progreso", on);
    s.on("boton:pulsado", onBoton);
    s.on("prueba:resultado", onResultado);
    s.on("boton:sin_contexto", onSinContexto);
    s.on("boton:error", onErrorBoton);
    s.on("lote:pack", onPack);
    s.on("lote:pack_error", onPackError);
    return () => {
      s.off("medida:progreso", on);
      s.off("boton:pulsado", onBoton);
      s.off("prueba:resultado", onResultado);
      s.off("boton:sin_contexto", onSinContexto);
      s.off("boton:error", onErrorBoton);
      s.off("lote:pack", onPack);
      s.off("lote:pack_error", onPackError);
    };
  }, [qc, toast, lote]);

  const abrirLote = async () => {
    try {
      const r = await api.lotes.abrir(sku, operator);
      setLote(r.lote);
      toast({ title: `Lote ${r.lote.id} abierto`, description: `${sku} · ${operator}` });
    } catch (e: any) { toast({ variant: "destructive", title: "Error", description: e.message }); }
  };

  const cerrarLote = async () => {
    if (!lote) return;
    try {
      await api.lotes.cerrar(lote.id);
      toast({ title: `Lote ${lote.id} cerrado`, description: `${lote.buenos} buenos · ${lote.malos} malos` });
      setLote(null);
    } catch (e: any) { toast({ variant: "destructive", title: "Error", description: e.message }); }
  };

  const correr = async () => {
    setBusy(true); setRes(null); setProg(null);
    try {
      const r = await api.prueba(sku, operator, lote?.id);
      setRes(r);
      if (lote) {
        const l = await api.lotes.list(sku);
        setLote(l.lotes.find((x: any) => x.id === lote.id) ?? lote);
      }
      qc.invalidateQueries({ queryKey: ["pruebas"] });
    } catch (e: any) {
      toast({ variant: "destructive", title: "No se pudo probar", description: e.message });
    } finally { setBusy(false); setProg(null); }
  };

  const faltaOperador = !operator.trim();

  return (
    <div className="space-y-6">
      {faltaOperador && (
        <Alert variant="destructive">
          <AlertDescription>
            No hay operador. Fíjalo en <b>Operador</b> (abajo a la derecha): cada prueba
            queda registrada a su nombre.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Prueba</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Producto</Label>
              <Select value={sku} onValueChange={(v) => { setSku(v); setRes(null); }}>
                <SelectTrigger><SelectValue placeholder="Elige el SKU" /></SelectTrigger>
                <SelectContent>
                  {probables.map((s) => (
                    <SelectItem key={s.codigo} value={s.codigo}>
                      {s.codigo} — {s.descripcion || "sin descripción"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!probables.length && !skus.isLoading && (
                <p className="text-sm text-amber-600 mt-2">
                  Ningún SKU tiene golden aprobado todavía. Créalo en <b>SKUs</b>.
                </p>
              )}
            </div>

            {job && (
              <div className="text-sm text-gray-600 flex flex-wrap gap-2 items-center">
                <Badge variant="secondary">{job.nets_count} conexiones</Badge>
                <Badge variant="secondary">{job.channels} canales</Badge>
                <Badge variant="secondary">{JSON.parse(job.hosts || "[]").length} unidad(es)</Badge>
                <span className="font-mono text-xs">golden {job.huella}</span>
              </div>
            )}

            <Button size="lg" className="w-full h-16 text-lg"
                    onClick={correr} disabled={!sku || busy || faltaOperador}>
              <Play className="w-6 h-6 mr-2" />{busy ? "Probando…" : "Probar"}
            </Button>

            {busy && prog && (
              <div className="space-y-1">
                <Progress value={(prog.hecho / prog.total) * 100} />
                <div className="text-xs text-gray-500">{prog.hecho} de {prog.total} canales</div>
              </div>
            )}

            {res && (
              <div className={`rounded-lg border-2 p-6 ${
                res.resultado === "PASS" ? "border-green-500 bg-green-50"
                : res.resultado === "FAIL" ? "border-red-500 bg-red-50"
                : "border-amber-500 bg-amber-50"}`}>
                <div className="flex items-center gap-3">
                  {res.resultado === "PASS" ? <CircleCheck className="w-10 h-10 text-green-600" />
                   : res.resultado === "FAIL" ? <CircleX className="w-10 h-10 text-red-600" />
                   : <TriangleAlert className="w-10 h-10 text-amber-600" />}
                  <div>
                    <div className={`text-3xl font-bold ${
                      res.resultado === "PASS" ? "text-green-700"
                      : res.resultado === "FAIL" ? "text-red-700" : "text-amber-700"}`}>
                      {res.resultado === "PASS" ? "BUENO"
                       : res.resultado === "FAIL" ? "RECHAZADO" : "ERROR"}
                    </div>
                    <div className="text-sm text-gray-600">
                      {(res.duracion_ms / 1000).toFixed(1)} s
                      {res.huella && <> · huella <span className="font-mono">{res.huella}</span></>}
                    </div>
                    {/* CONTRA QUÉ SE VALIDÓ ESTA PIEZA.
                        Con el botón, el producto que corre no tiene por qué ser
                        el del desplegable de arriba: lo decide el equipo que se
                        presionó. Si el veredicto no lo dice, nadie sabe contra
                        qué golden se aprobó o se rechazó la pieza. */}
                    {res.sku && (
                      <div className="text-sm mt-0.5">
                        <span className="text-gray-500">Validado contra </span>
                        <span className="font-semibold">{res.sku}</span>
                        {res.golden_nombre && <>
                          <span className="text-gray-500"> · golden </span>
                          <span className="font-mono">{res.golden_nombre}</span>
                        </>}
                        <span className="text-gray-500"> · esperaba </span>
                        <span className="font-mono">{res.golden}</span>
                        {res.job?.nets != null && <>
                          <span className="text-gray-500"> · {res.job.nets} conexiones en </span>
                          <span>{res.job.unidades} equipo(s)</span>
                        </>}
                      </div>
                    )}
                    {res.por_mac === false && (
                      <div className="text-sm mt-1 text-amber-800">
                        ⚠ Este producto está guardado con <b>direcciones de red</b>, no con
                        los equipos. Si el router reparte distinto, puede medirse el equipo
                        equivocado. Vuelve a capturar su golden.
                      </div>
                    )}
                  </div>
                </div>

                {res.error && (
                  <p className="mt-3 text-sm text-amber-900">
                    {res.error}
                    <br />
                    <span className="text-xs">
                      No es un veredicto sobre la pieza: la prueba no se pudo completar.
                    </span>
                  </p>
                )}

                {res.fallos.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {res.fallos.map((f, i) => (
                      <div key={i} className="bg-white rounded-md border p-3">
                        <Badge variant={f.tipo === "ABIERTO" ? "outline" : "destructive"}>{f.tipo}</Badge>
                        <div className="font-mono text-sm mt-1">{f.texto}</div>
                      </div>
                    ))}
                    <p className="text-xs text-gray-600">
                      {res.fallos.some((f) => f.texto.includes("M.") || f.texto.includes("L1."))
                        ? "Los nombres son internos del tester. Recorre el socket en la pestaña Socket para verlos como CN15.3."
                        : null}
                    </p>
                  </div>
                )}

                {!!res.recomendaciones?.length && (
                  <div className="mt-4 space-y-2">
                    <p className="text-sm font-medium text-amber-800">
                      La pieza pasa, pero conviene revisar:
                    </p>
                    {res.recomendaciones.map((f, i) => (
                      <div key={i} className="bg-amber-50 border border-amber-300 rounded-md p-3">
                        <Badge className="bg-amber-500">{f.tipo}</Badge>
                        <div className="font-mono text-sm mt-1 text-amber-900">{f.texto}</div>
                      </div>
                    ))}
                    <p className="text-xs text-amber-700">
                      Conduce, así que el test digital la da por buena — pero una resistencia
                      alta es un crimpe flojo, y eso falla en planta a ratos. Mejor corregirlo
                      ahora que con el arnés armado.
                    </p>
                  </div>
                )}

                <Button variant="outline" className="mt-4" onClick={correr} disabled={busy}>
                  <RotateCcw className="w-4 h-4 mr-2" />Repetir
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Lote</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {lote ? (
              <>
                <div className="text-center py-2">
                  <div className="text-4xl font-bold font-mono">{lote.id}</div>
                  <div className="text-sm text-gray-500">{lote.sku}</div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><div className="text-2xl font-bold">{lote.cantidad}</div>
                       <div className="text-xs text-gray-500">total</div></div>
                  <div><div className="text-2xl font-bold text-green-600">{lote.buenos}</div>
                       <div className="text-xs text-gray-500">buenos</div></div>
                  <div><div className="text-2xl font-bold text-red-600">{lote.malos}</div>
                       <div className="text-xs text-gray-500">malos</div></div>
                </div>
                <Button variant="outline" className="w-full" onClick={cerrarLote}>
                  <PackageCheck className="w-4 h-4 mr-2" />Cerrar lote
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  Sin lote abierto. Se puede probar igual; el lote sirve para agrupar
                  la producción y generar etiquetas.
                </p>
                <Button className="w-full" onClick={abrirLote} disabled={!sku || faltaOperador}>
                  <PackagePlus className="w-4 h-4 mr-2" />Abrir lote
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
