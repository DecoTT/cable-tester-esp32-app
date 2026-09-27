import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Factory, RefreshCw, Save } from "lucide-react";
import { api } from "@/services/api";
import { useToast } from "@/hooks/use-toast";

// Estaciones: un puesto de trabajo = un equipo con botón.
//
// POR QUÉ ESTO EXISTE
//
// Con dos o tres puestos colgando del mismo bridge, un producto y un operador
// globales hacen que el operador de un puesto se lleve el producto del otro. El
// botón funcionaría igual y la trazabilidad mentiría — que es peor que no
// registrar nada.
//
// Cada estación lleva lo suyo. El puesto que tiene la pantalla delante trabaja
// con datos completos; los demás, con lo que tengan configurado aquí.
//
// LO QUE NO SE HACE: perder la pieza. Si a un puesto le falta el operador, la
// prueba se registra igual y queda marcada como PARCIAL. Un registro incompleto
// se puede completar después; una pieza que no aparece en el historial está
// perdida para siempre.

const hora = (s?: string | null) => (s ? new Date(s).toLocaleString() : "—");

export default function Estaciones({ operator }: { operator: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [borrador, setBorrador] = useState<Record<string, { sku?: string; operador?: string; nombre?: string }>>({});

  const est = useQuery({ queryKey: ["estaciones"], queryFn: api.estaciones.list, refetchInterval: 5000 });
  const skus = useQuery({ queryKey: ["skus"], queryFn: api.skus.list });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.medida.jobs().then((d) => d.jobs) });

  const conGolden = (skus.data ?? []).filter(
    (s) => s.active && jobs.data?.some((j: any) => j.sku === s.codigo));

  const guardar = async (mac: string, actual: any) => {
    const b = borrador[mac] ?? {};
    try {
      await api.estaciones.guardar(mac, {
        nombre:   b.nombre   ?? actual.nombre,
        sku:      b.sku      ?? actual.sku,
        operador: b.operador ?? actual.operador,
        lote_id:  actual.lote_id ?? null,
      }, operator || "sistema");
      setBorrador((x) => ({ ...x, [mac]: {} }));
      qc.invalidateQueries({ queryKey: ["estaciones"] });
      toast({ title: `${actual.unit} configurada` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "No se pudo guardar", description: e.message });
    }
  };

  const filas = est.data?.estaciones ?? [];
  const conBoton = filas.filter((f) => f.con_boton);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Factory className="w-5 h-5" /> Estaciones
          <Button size="icon" variant="ghost" className="ml-auto"
                  onClick={() => est.refetch()} title="Actualizar">
            <RefreshCw className={`w-4 h-4 ${est.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </CardTitle>
        <p className="text-sm text-gray-600">
          Un puesto de trabajo es un equipo con botón, y lleva <strong>su</strong> producto
          y <strong>su</strong> operador. Sin operador la prueba se registra igual, marcada
          como <strong>parcial</strong>: perder la pieza del historial es peor que
          registrarla incompleta.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {conBoton.length === 0 && (
          <p className="text-sm text-gray-500">
            Ningún equipo tiene botón configurado. Se pone en el menú ⋮ de cada equipo,
            arriba.
          </p>
        )}

        {conBoton.map((f) => {
          const b = borrador[f.mac] ?? {};
          const cambiado = b.sku !== undefined || b.operador !== undefined || b.nombre !== undefined;
          return (
            <div key={f.mac} className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge>{f.unit}</Badge>
                <span className="text-sm text-gray-600">{f.notes || f.ip}</span>
                {f.correria
                  ? <Badge variant={f.parcial ? "outline" : "secondary"}>
                      el botón corre {f.correria}{f.parcial ? " · parcial" : ""}
                    </Badge>
                  : <Badge variant="outline" className="text-amber-700">
                      el botón no haría nada: {f.motivo}
                    </Badge>}
                <span className="text-xs text-gray-500 ml-auto">
                  {f.pulsaciones != null ? `${f.pulsaciones} pulsación(es)` : ""}
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Nombre del puesto</Label>
                  <Input value={b.nombre ?? f.nombre ?? ""} placeholder="Mesa 2"
                         onChange={(e) => setBorrador((x) => ({ ...x, [f.mac]: { ...b, nombre: e.target.value } }))} />
                </div>
                <div>
                  <Label className="text-xs">Producto</Label>
                  <Select value={(b.sku ?? f.sku) || "__auto__"}
                          onValueChange={(v) => setBorrador((x) => ({ ...x, [f.mac]: { ...b, sku: v === "__auto__" ? "" : v } }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">Automático — el último corrido aquí</SelectItem>
                      {conGolden.map((s) => (
                        <SelectItem key={s.codigo} value={s.codigo}>{s.codigo}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Operador</Label>
                  <Input value={b.operador ?? f.operador ?? ""} placeholder="sin operador → parcial"
                         onChange={(e) => setBorrador((x) => ({ ...x, [f.mac]: { ...b, operador: e.target.value } }))} />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button size="sm" disabled={!cambiado} onClick={() => guardar(f.mac, f)}>
                  <Save className="w-4 h-4 mr-1" />Guardar
                </Button>
                <span className="text-xs text-gray-500">
                  {f.ultima
                    ? <>última: {f.ultima.sku} · <b>{f.ultima.result}</b>
                        {f.ultima.parcial ? " (parcial)" : ""} · {hora(f.ultima.started_at)}</>
                    : "sin pruebas todavía"}
                </span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
