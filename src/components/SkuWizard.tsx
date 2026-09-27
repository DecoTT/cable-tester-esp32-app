import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Cable, Link2, ShieldCheck, Map as MapIcon, Save,
  CheckCircle2, ChevronLeft, ChevronRight, X, TriangleAlert,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api, liveSocket, type DiscoveredTester, type FixtureInfo } from "@/services/api";
import { useToast } from "@/hooks/use-toast";

// Alta de SKU.
//
// CAMBIO DE MODELO respecto a la version anterior: ya no es "un tester = un
// SKU". Con la PC orquestando, un SKU son VARIAS unidades EN UN ORDEN, y ese
// orden define los nombres de canal (M, L1, L2...). Un golden capturado con las
// unidades en otro orden NO significa lo mismo, asi que el orden es parte de la
// receta y se guarda con el job.
//
// Los pasos son bloqueantes a proposito. En particular "validar modulos": un
// canal pegado a masa y un cable roto se ven IGUAL en el mapa, asi que si se
// captura el golden con una placa defectuosa, el defecto queda congelado como
// estado normal y el tester deja de vigilar esas lineas para siempre.

type StepId = "sku" | "unidades" | "modulos" | "golden" | "guardar";

const STEPS: { id: StepId; label: string; Icon: typeof Cable }[] = [
  { id: "sku",      label: "SKU",              Icon: Cable },
  { id: "unidades", label: "Unidades",         Icon: Link2 },
  { id: "modulos",  label: "Validar módulos",  Icon: ShieldCheck },
  { id: "golden",   label: "Capturar golden",  Icon: MapIcon },
  { id: "guardar",  label: "Guardar",          Icon: Save },
];

interface CanalMalo { canal: string; g: number; v: number; r: number }

export default function SkuWizard({ operator, onDone }: { operator: string; onDone: () => void }) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ fase: string; hecho: number; total: number } | null>(null);

  // 1 — producto
  const [sku, setSku] = useState("");
  const [desc, setDesc] = useState("");
  const [pack, setPack] = useState("10");
  const [labelsPerPack, setLabelsPerPack] = useState("2");
  const [labelType, setLabelType] = useState<"large" | "standard">("large");

  // 2 — unidades, EN ORDEN
  const [disponibles, setDisponibles] = useState<DiscoveredTester[]>([]);
  const [orden, setOrden] = useState<DiscoveredTester[]>([]);
  const [totalCh, setTotalCh] = useState(0);

  // 3 — módulos
  const [chk, setChk] = useState<{ ok: boolean; malos: CanalMalo[]; total: number } | null>(null);

  // 4 — golden
  //
  // El fixture es lo que traduce M.J11 -> CN15.3 en los informes. Se referencia
  // DESDE el golden (produccion.js lo carga por su nombre al probar), asi que si
  // no se elige aqui, el recorrido del socket no llega nunca al operador: la
  // pieza falla y el informe dice "M.J11", que no indica a que conector ir.
  const [fixId, setFixId] = useState("");
  const [fixtures, setFixtures] = useState<FixtureInfo[]>([]);
  const [esperadas, setEsperadas] = useState("");
  const [gold, setGold] = useState<{ huella: string; nets: number; aislados: number } | null>(null);
  const [rechazo, setRechazo] = useState<string | null>(null);

  useEffect(() => {
    const cargar = () => api.testers.discovered().then(setDisponibles).catch(() => {});
    cargar();
    const t = setInterval(cargar, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { api.fixtures.list().then((d) => setFixtures(d.fixtures)).catch(() => {}); }, []);

  // Sugerencia: el que la pestana Socket habria creado para este SKU.
  useEffect(() => {
    if (fixId || !sku.trim()) return;
    const propio = fixtures.find((f) => f.id === `fixture-${sku.trim()}`);
    if (propio) setFixId(propio.id);
  }, [fixtures, sku, fixId]);

  useEffect(() => {
    const s = liveSocket();
    const on = (p: any) => setProg(p);
    s.on("medida:progreso", on);
    return () => { s.off("medida:progreso", on); };
  }, []);

  const libres = disponibles.filter((d) => !orden.some((o) => o.unit === d.unit));
  const etiquetaPos = (i: number) => (i === 0 ? "M" : `L${i}`);

  const fijarUnidades = async (lista: DiscoveredTester[]) => {
    const hosts = lista.map((u) => u.ip || u.host || "").filter(Boolean);
    if (!hosts.length) { setTotalCh(0); return; }
    try {
      const r = await api.medida.setUnidades(hosts);
      setTotalCh(r.total);
    } catch (e: any) {
      toast({ variant: "destructive", title: "No se pudieron abrir las unidades", description: e.message });
      setTotalCh(0);
    }
  };

  const añadir = (u: DiscoveredTester) => { const n = [...orden, u]; setOrden(n); fijarUnidades(n); };
  const quitar = (i: number) => { const n = orden.filter((_, k) => k !== i); setOrden(n); fijarUnidades(n); };

  const validarModulos = async () => {
    setBusy(true); setChk(null);
    try { setChk(await api.medida.modulos()); }
    catch (e: any) { toast({ variant: "destructive", title: "Error", description: e.message }); }
    finally { setBusy(false); setProg(null); }
  };

  const capturarGolden = async () => {
    setBusy(true); setGold(null); setRechazo(null);
    try {
      const r = await api.medida.guardarGolden(
        sku.trim(), esperadas ? Number(esperadas) : undefined, fixId || undefined);
      setGold({ huella: r.golden.huella, nets: r.golden.nets.length, aislados: r.golden.aislados.length });
      if (r.sin_esperadas) {
        toast({
          title: "Golden capturado, pero sin número esperado",
          description: "Sin ese dato no se puede detectar que FALTE un hilo. Confírmalo con ingeniería.",
        });
      }
    } catch (e: any) {
      // El 422 trae el motivo concreto: conexiones que no cuadran, o contactos
      // flojos. Mostrarlo tal cual evita que el operador adivine.
      setRechazo(e.message || "rechazado");
      if (e.detalle?.lineas) {
        setRechazo(`${e.message}\n` + e.detalle.lineas.map((l: any) =>
          `  ${l.linea}  ${l.r.toFixed(1)} Ω`).join("\n"));
      }
    } finally { setBusy(false); setProg(null); }
  };

  const guardar = async () => {
    setBusy(true);
    try {
      await api.skus.upsert({
        codigo: sku.trim(), descripcion: desc,
        standard_pack: Number(pack) || 10,
        labels_per_pack: Number(labelsPerPack) || 2,
        label_type: labelType,
      }, operator);
      await api.medida.job(sku.trim(), sku.trim(), `Golden ${sku.trim()}`, operator);
      toast({ title: "SKU listo", description: `${sku} guardado y job aprobado.` });
      onDone();
    } catch (e: any) {
      toast({ variant: "destructive", title: "No se pudo guardar", description: e.message });
    } finally { setBusy(false); }
  };

  const canNext = useMemo(() => {
    switch (STEPS[step].id) {
      case "sku":      return sku.trim().length > 0;
      case "unidades": return orden.length > 0 && totalCh > 0;
      // Bloqueante: capturar un golden sobre una placa con un canal a masa
      // congela el defecto y el tester deja de vigilar esa línea.
      case "modulos":  return chk?.ok === true;
      case "golden":   return !!gold;
      default:         return true;
    }
  }, [step, sku, orden, totalCh, chk, gold]);

  const Current = STEPS[step];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Alta de SKU</h2>

      <div className="flex flex-wrap items-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm ${
              i === step ? "bg-blue-600 text-white"
              : i < step ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>
              {i < step ? <CheckCircle2 className="w-4 h-4" /> : <s.Icon className="w-4 h-4" />}
              <span>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <ChevronRight className="w-4 h-4 text-gray-300 mx-0.5" />}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2">
          <Current.Icon className="w-5 h-5" /> {step + 1}. {Current.label}
        </CardTitle></CardHeader>
        <CardContent className="space-y-4">

          {/* ── 1. SKU ── */}
          {Current.id === "sku" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="sku">Código de SKU</Label>
                <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU4589" />
                <p className="text-xs text-gray-500 mt-1">
                  Va impreso en la etiqueta de trazabilidad. Cambiarlo después obliga a reimprimir.
                </p>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="desc">Descripción</Label>
                <Input id="desc" value={desc} onChange={(e) => setDesc(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="pack">Standard pack</Label>
                <Input id="pack" type="number" min={1} value={pack} onChange={(e) => setPack(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="lpp">Etiquetas por bolsa</Label>
                <Input id="lpp" type="number" min={1} value={labelsPerPack}
                       onChange={(e) => setLabelsPerPack(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label>Tipo de etiqueta</Label>
                <div className="flex gap-2 mt-1">
                  {(["large", "standard"] as const).map((t) => (
                    <Button key={t} type="button" variant={labelType === t ? "default" : "outline"}
                            onClick={() => setLabelType(t)}>{t === "large" ? "Grande" : "Estándar"}</Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── 2. Unidades, EN ORDEN ── */}
          {Current.id === "unidades" && (
            <>
              <Alert>
                <AlertDescription>
                  Añade las unidades <strong>en el orden físico del montaje</strong>. El orden
                  define los nombres de canal (M, L1, L2…), así que un golden capturado
                  con otro orden no vale. Se guarda con el job.
                </AlertDescription>
              </Alert>

              {orden.length > 0 && (
                <div className="space-y-2">
                  {orden.map((u, i) => (
                    <div key={u.unit} className="flex items-center justify-between border rounded-lg p-3 bg-blue-50 border-blue-200">
                      <div className="flex items-center gap-3">
                        <Badge className="font-mono">{etiquetaPos(i)}</Badge>
                        <Badge variant="secondary">{u.unit}</Badge>
                        <span className="font-mono text-xs text-gray-500">{u.ip || u.host}</span>
                        <span className="text-xs text-gray-500">fw {u.fw}</span>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => quitar(i)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  <div className="text-sm text-gray-600">
                    {orden.length} unidad(es) · <b>{totalCh} canales</b>
                  </div>
                </div>
              )}

              {libres.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-600">Disponibles</div>
                  {libres.map((u) => (
                    <button key={u.unit} onClick={() => añadir(u)}
                      className="w-full text-left border rounded-lg p-3 flex items-center gap-3 hover:bg-gray-50">
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                      <Badge>{u.unit}</Badge>
                      <span className="font-mono text-xs text-gray-500">{u.ip || u.host}</span>
                      <span className="text-xs text-gray-500">fw {u.fw}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <Alert><AlertDescription>
                  {orden.length ? "No quedan más unidades en la red."
                                : "No se ve ninguna unidad. Comprueba que estén encendidas y en la misma red."}
                </AlertDescription></Alert>
              )}
            </>
          )}

          {/* ── 3. Validar módulos ── */}
          {Current.id === "modulos" && (
            <>
              <Alert>
                <AlertDescription>
                  <strong>Desconecta el arnés</strong> antes de este paso. En el mapa, un canal
                  pegado a masa y un cable roto se ven idénticos: sin esta comprobación no hay
                  forma de saber de quién es la culpa, y un defecto de placa quedaría congelado
                  dentro del golden.
                </AlertDescription>
              </Alert>

              <Button onClick={validarModulos} disabled={busy}>
                {busy ? "Midiendo…" : "Validar módulos"}
              </Button>

              {busy && prog?.fase === "modulos" && (
                <div className="space-y-1">
                  <Progress value={(prog.hecho / prog.total) * 100} />
                  <div className="text-xs text-gray-500">{prog.hecho} de {prog.total} canales</div>
                </div>
              )}

              {chk && (chk.ok ? (
                <Alert className="border-green-300 bg-green-50">
                  <AlertDescription className="text-green-900">
                    <b>{chk.total}/{chk.total} OK</b> — ningún canal pegado a masa.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <AlertDescription>
                    <b>{chk.malos.length} canal(es) defectuoso(s) de {chk.total}.</b>
                    <div className="mt-2 font-mono text-xs space-y-0.5">
                      {chk.malos.map((m) => (
                        <div key={m.canal}>{m.canal} — {m.v.toFixed(3)} V · {m.r.toFixed(0)} Ω a GND</div>
                      ))}
                    </div>
                    <div className="mt-2">
                      No se puede capturar el golden así: congelaría el defecto y el tester
                      aceptaría esas líneas rotas para siempre.
                    </div>
                  </AlertDescription>
                </Alert>
              ))}
            </>
          )}

          {/* ── 4. Golden ── */}
          {Current.id === "golden" && (
            <>
              <Alert>
                <AlertDescription>
                  Monta el <strong>arnés bueno aprobado por ingeniería</strong> y captura.
                </AlertDescription>
              </Alert>

              <div className="max-w-md">
                <Label htmlFor="fixgold">Fixture (socket)</Label>
                <Select value={fixId || "__sin__"}
                        onValueChange={(v) => setFixId(v === "__sin__" ? "" : v)}>
                  <SelectTrigger id="fixgold">
                    <SelectValue placeholder="Sin fixture" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__sin__">Sin fixture — los informes dirán M.J11</SelectItem>
                    {fixtures.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.nombre} · {f.pines} pines · {f.conectores.join(", ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-1">
                  Es lo que convierte <strong>M.J11</strong> en <strong>CN15.3</strong> en los
                  informes de fallo. Se recorre en la pestaña <strong>Socket</strong>; si aún no
                  lo has hecho, puedes capturar sin él y volver a capturar después.
                </p>
              </div>

              <div className="max-w-xs">
                <Label htmlFor="esp">Conexiones esperadas</Label>
                <Input id="esp" type="number" min={1} value={esperadas}
                       onChange={(e) => setEsperadas(e.target.value)} placeholder="46" />
                <p className="text-xs text-gray-500 mt-1">
                  El número que aprueba ingeniería. Sin él no se puede detectar que
                  <strong> falte</strong> un hilo: una línea ausente no tiene resistencia que medir.
                </p>
              </div>

              <Button onClick={capturarGolden} disabled={busy}>
                {busy ? "Midiendo…" : "Capturar golden"}
              </Button>

              {busy && prog?.fase === "barrido" && (
                <div className="space-y-1">
                  <Progress value={(prog.hecho / prog.total) * 100} />
                  <div className="text-xs text-gray-500">{prog.hecho} de {prog.total} canales</div>
                </div>
              )}

              {rechazo && (
                <Alert variant="destructive">
                  <TriangleAlert className="w-4 h-4" />
                  <AlertDescription className="whitespace-pre-wrap font-mono text-xs">{rechazo}</AlertDescription>
                </Alert>
              )}

              {gold && (
                <Alert className="border-green-300 bg-green-50">
                  <AlertDescription className="text-green-900">
                    <b>{gold.nets} conexiones</b>, {gold.aislados} canal(es) libre(s) ·
                    huella <span className="font-mono">{gold.huella}</span>
                    {!fixId && (
                      <div className="text-amber-800 mt-1">
                        Sin fixture: los fallos se reportarán como <span className="font-mono">M.J11</span>.
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}

          {/* ── 5. Guardar ── */}
          {Current.id === "guardar" && (
            <div className="space-y-3 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><span className="text-gray-500">SKU</span><br /><b>{sku}</b></div>
                <div><span className="text-gray-500">Standard pack</span><br /><b>{pack}</b></div>
                <div>
                  <span className="text-gray-500">Unidades (en orden)</span><br />
                  <b>{orden.map((u, i) => `${etiquetaPos(i)}=${u.unit}`).join("  ")}</b>
                </div>
                <div><span className="text-gray-500">Canales</span><br /><b>{totalCh}</b></div>
                <div>
                  <span className="text-gray-500">Golden</span><br />
                  <b>{gold?.nets} conexiones</b> · <span className="font-mono">{gold?.huella}</span>
                </div>
                <div><span className="text-gray-500">Módulos</span><br /><b>{chk?.total}/{chk?.total} OK</b></div>
              </div>
              <Button onClick={guardar} disabled={busy} className="w-full">
                <Save className="w-4 h-4 mr-2" />{busy ? "Guardando…" : "Guardar y aprobar"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => (step ? setStep(step - 1) : onDone())}>
          <ChevronLeft className="w-4 h-4 mr-1" /> {step ? "Atrás" : "Cancelar"}
        </Button>
        {step < STEPS.length - 1 && (
          <Button onClick={() => setStep(step + 1)} disabled={!canNext}>
            Siguiente <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}
