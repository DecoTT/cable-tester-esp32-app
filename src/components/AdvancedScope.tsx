import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Waves, Info } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea,
} from "recharts";
import { api, type LineaOnda, type Muestra } from "@/services/api";
import { useToast } from "@/hooks/use-toast";

// Osciloscopio lento.
//
// LO QUE ESTO NO ES, DICHO ANTES DE QUE NADIE SE ILUSIONE
//
// No es un instrumento de integridad de señal. No hay diagrama de ojo, ni
// tiempo de subida, ni jitter: el techo son ~324 muestras/s, porque cada
// lectura del ADC promedia 64 muestras. Medido: 3,09 ms por muestra. El RC de
// un arnés con 680 Ω son decenas de nanosegundos, así que el flanco siempre ha
// ocurrido ya cuando llega la primera muestra.
//
// LO QUE SÍ, Y POR QUÉ IMPORTA
//
// El dato no es el flanco: es el NIVEL y su ESTABILIDAD. Un pin conectado sigue
// al excitador y no se mueve (desviación 0,0 mV); uno al aire vaga por
// acoplamiento (300 mV de desviación). Eso distingue "conectado" de "al aire"
// mejor que el valor medio, y además enseña en pantalla por qué hace falta la
// doble muestra.
//
// Y destapa lo que un PASS/FAIL no ve: un contacto INTERMITENTE. Sacudiendo el
// arnés mientras se mide, un crimp flojo salta a la vista en la traza aunque en
// una prueba suelta dé bien.

const COLOR: Record<string, string> = {
  unida:      "#16a34a",
  resistiva:  "#d97706",
  al_aire:    "#dc2626",
  abierta:    "#dc2626",
  error:      "#64748b",
  indefinido: "#64748b",
};

const ETIQUETA: Record<string, string> = {
  unida: "UNIDA", resistiva: "RESISTIVA", al_aire: "AL AIRE",
  abierta: "ABIERTA", error: "ERROR", indefinido: "?",
};

/** Bandas de fondo donde el excitador estaba en ALTO. */
function bandasAltas(traza: Muestra[]) {
  const out: { x1: number; x2: number }[] = [];
  let ini: number | null = null;
  traza.forEach((m, i) => {
    if (m.nivel === 1 && ini === null) ini = m.t;
    const fin = m.nivel !== 1 || i === traza.length - 1;
    if (fin && ini !== null) { out.push({ x1: ini, x2: m.t }); ini = null; }
  });
  return out;
}

function Traza({ traza, color, alto = 150 }: { traza: Muestra[]; color: string; alto?: number }) {
  return (
    <ResponsiveContainer width="100%" height={alto}>
      <LineChart data={traza} margin={{ top: 5, right: 8, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        {bandasAltas(traza).map((b, i) => (
          <ReferenceArea key={i} x1={b.x1} x2={b.x2} fill="#94a3b8" fillOpacity={0.12} />
        ))}
        <XAxis dataKey="t" tick={{ fontSize: 10 }} unit=" ms"
               label={{ value: "ms", position: "insideBottomRight", fontSize: 10 }} />
        <YAxis domain={[0, 3400]} tick={{ fontSize: 10 }} width={44} unit=" mV" />
        <Tooltip formatter={(v: any) => [`${v} mV`, "medido"]}
                 labelFormatter={(t) => `t = ${t} ms`} />
        <Line type="linear" dataKey="mv" stroke={color} dot={false} strokeWidth={2} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function AdvancedScope({ sku }: { sku: string }) {
  const { toast } = useToast();
  const [lineas, setLineas] = useState<LineaOnda[] | null>(null);
  const [midiendo, setMidiendo] = useState(false);
  const [detalle, setDetalle] = useState<(LineaOnda & { muestras?: Muestra[] }) | null>(null);
  const [acopl, setAcopl] = useState<{ excitado: string; lineas: { canal: string; mv: number }[] } | null>(null);
  const [canalAc, setCanalAc] = useState("");

  const medir = async () => {
    if (!sku) return toast({ title: "Elige un producto arriba", variant: "destructive" });
    setMidiendo(true); setLineas(null); setDetalle(null); setAcopl(null);
    try {
      const r = await api.avanzado.lineas(sku);
      if (!r.ok) return toast({ title: "No se pudo medir", description: r.error, variant: "destructive" });
      setLineas(r.lineas);
      if (r.lineas[0]) setCanalAc(r.lineas[0].a);
    } catch (e: any) {
      toast({ title: "Error de medida", description: e.message, variant: "destructive" });
    } finally { setMidiendo(false); }
  };

  const verDetalle = async (l: LineaOnda) => {
    setMidiendo(true);
    try {
      const r = await api.avanzado.onda(sku, l.a, l.b, 4);
      if (!r.ok) return toast({ title: "Error", description: r.error, variant: "destructive" });
      setDetalle(r);
    } finally { setMidiendo(false); }
  };

  const verAcoplamiento = async () => {
    if (!canalAc) return;
    setMidiendo(true);
    try {
      const r = await api.avanzado.acoplamiento(sku, canalAc);
      if (!r.ok) return toast({ title: "Error", description: r.error, variant: "destructive" });
      setAcopl(r);
    } finally { setMidiendo(false); }
  };

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="w-4 h-4" />
        <AlertDescription className="text-sm">
          <strong>Qué es esto.</strong> Un osciloscopio <em>lento</em>: ~324 muestras/s,
          voltios reales del arnés. <strong>No hay diagrama de ojo</strong> ni tiempo de
          subida — eso necesita muestrear a GHz, y el flanco de un arnés son decenas de
          nanosegundos. Lo que mide es el <strong>nivel</strong> y su{" "}
          <strong>estabilidad</strong>: un pin conectado sigue al excitador y no se mueve;
          uno al aire vaga por acoplamiento. Sacude el arnés mientras mide y un contacto
          intermitente aparece en la traza.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap gap-2">
        <Button onClick={medir} disabled={midiendo || !sku}>
          <Waves className="w-4 h-4 mr-2" />
          {midiendo ? "Midiendo…" : "Medir todas las líneas del golden"}
        </Button>
        {lineas && (
          <>
            <Select value={canalAc} onValueChange={setCanalAc}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Canal…" /></SelectTrigger>
              <SelectContent>
                {lineas.map((l) => (
                  <SelectItem key={l.a} value={l.a}>{l.a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={verAcoplamiento} disabled={midiendo || !canalAc}>
              <Activity className="w-4 h-4 mr-2" />Ver acoplamiento
            </Button>
          </>
        )}
      </div>

      {lineas && (
        <div className="grid gap-3 md:grid-cols-2">
          {lineas.map((l, i) => (
            <Card key={i} className="overflow-hidden">
              <CardHeader className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base font-mono">{l.a} → {l.b}</CardTitle>
                  <Badge style={{ backgroundColor: COLOR[l.tipo] }} className="text-white">
                    {ETIQUETA[l.tipo]}
                  </Badge>
                </div>
                <p className="text-xs text-gray-600">{l.explicacion}</p>
              </CardHeader>
              <CardContent className="pb-3">
                {l.traza && <Traza traza={l.traza} color={COLOR[l.tipo]} />}
                <div className="flex gap-4 text-xs text-gray-600 mt-1">
                  <span>alto <b>{l.alto.media?.toFixed(0)} mV</b></span>
                  <span>desviación{" "}
                    <b className={l.alto.sd && l.alto.sd > 100 ? "text-red-600" : ""}>
                      {l.alto.sd?.toFixed(1)} mV
                    </b>
                  </span>
                  <span>bajo <b>{l.bajo.media?.toFixed(0)} mV</b></span>
                  <button className="ml-auto underline" onClick={() => verDetalle(l)}>
                    ver más ciclos
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {detalle && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base font-mono">
              {detalle.a} → {detalle.b}
              <span className="ml-2 text-xs font-sans font-normal text-gray-500">
                fondo gris = excitador en ALTO
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {detalle.muestras && <Traza traza={detalle.muestras} color={COLOR[detalle.tipo]} alto={240} />}
            <p className="text-sm text-gray-600 mt-2">{detalle.explicacion}</p>
          </CardContent>
        </Card>
      )}

      {acopl && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Acoplamiento con {acopl.excitado} excitado</CardTitle>
            <p className="text-sm text-gray-600">
              Los canales al aire recogen tensión del excitado sin estar conectados a él.
              No es un fallo: es la razón de que el barrido exija <strong>dos muestras</strong>{" "}
              que coincidan antes de dar una conexión por buena.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {acopl.lineas.slice(0, 12).map((l) => (
                <div key={l.canal} className="flex items-center gap-2 text-sm">
                  <span className="font-mono w-24 shrink-0">{l.canal}</span>
                  <div className="flex-1 h-3 bg-slate-100 rounded overflow-hidden">
                    <div className="h-full bg-slate-400"
                         style={{ width: `${Math.min(100, ((l.mv ?? 0) / 3300) * 100)}%` }} />
                  </div>
                  <span className="tabular-nums w-16 text-right">{l.mv} mV</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
