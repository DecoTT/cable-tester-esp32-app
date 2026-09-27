import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CircleCheck, CircleX, TriangleAlert, X, Download } from "lucide-react";
import { api } from "@/services/api";

// Historial de pruebas desde SQLite.
//
// Se muestran también los ERROR, no solo PASS y FAIL: una prueba que no se pudo
// completar es trazabilidad igual, y si se ocultaran, un tester que falla a
// ratos sería invisible en el historial.

const HOY = () => new Date().toISOString().slice(0, 10);

export default function ResultadosTab() {
  const [sku, setSku] = useState("");
  const [operador, setOperador] = useState("");
  const [resultado, setResultado] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [detalle, setDetalle] = useState<any>(null);

  const skus = useQuery({ queryKey: ["skus"], queryFn: api.skus.list });
  const ops  = useQuery({ queryKey: ["operadores"], queryFn: () => api.operadores().then((d) => d.operadores) });

  const filtros = { sku, operador, resultado, desde, hasta };
  const q = useQuery({
    queryKey: ["pruebas", filtros],
    queryFn: () => api.pruebas(filtros),
    refetchInterval: 5000,
  });

  const hayFiltro = !!(sku || operador || resultado || desde || hasta);
  const limpiar = () => { setSku(""); setOperador(""); setResultado(""); setDesde(""); setHasta(""); };

  const totales = useMemo(() => {
    const r = q.data?.resumen ?? [];
    return {
      total:  r.reduce((a: number, x: any) => a + x.total, 0),
      buenos: r.reduce((a: number, x: any) => a + x.buenos, 0),
      malos:  r.reduce((a: number, x: any) => a + x.malos, 0),
      errores: r.reduce((a: number, x: any) => a + x.errores, 0),
    };
  }, [q.data]);

  const exportar = () => {
    const filas = q.data?.pruebas ?? [];
    const cab = ["id", "fecha", "sku", "operador", "resultado", "ms", "lote", "golden", "fallos"];
    const csv = [cab.join(",")].concat(filas.map((p: any) => [
      p.id, p.started_at, p.sku, p.operator, p.result, p.duration_ms,
      p.lote_id ?? "", p.job_huella ?? "",
      `"${JSON.parse(p.faults || "[]").map((f: any) => f.texto).join(" | ").replace(/"/g, "'")}"`,
    ].join(","))).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `pruebas-${HOY()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const icono = (r: string) =>
    r === "PASS" ? <CircleCheck className="w-4 h-4 text-green-600" />
    : r === "FAIL" ? <CircleX className="w-4 h-4 text-red-600" />
    : <TriangleAlert className="w-4 h-4 text-amber-600" />;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <Label>SKU</Label>
          <Select value={sku || "__all"} onValueChange={(v) => setSku(v === "__all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Todos</SelectItem>
              {skus.data?.map((s) => <SelectItem key={s.codigo} value={s.codigo}>{s.codigo}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Operador</Label>
          <Select value={operador || "__all"} onValueChange={(v) => setOperador(v === "__all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Todos</SelectItem>
              {ops.data?.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Resultado</Label>
          <Select value={resultado || "__all"} onValueChange={(v) => setResultado(v === "__all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Todos</SelectItem>
              <SelectItem value="PASS">Buenos</SelectItem>
              <SelectItem value="FAIL">Rechazados</SelectItem>
              <SelectItem value="ERROR">Errores</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="d">Desde</Label>
          <Input id="d" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="h">Hasta</Label>
          <Input id="h" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-2">
        {hayFiltro && (
          <Button variant="outline" size="sm" onClick={limpiar}>
            <X className="w-4 h-4 mr-1" />Limpiar filtros
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={exportar} disabled={!q.data?.pruebas?.length}>
          <Download className="w-4 h-4 mr-1" />Exportar CSV
        </Button>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Total",       v: totales.total,   c: "text-slate-900" },
          { l: "Buenos",      v: totales.buenos,  c: "text-green-600" },
          { l: "Rechazados",  v: totales.malos,   c: "text-red-600" },
          { l: "Errores",     v: totales.errores, c: "text-amber-600" },
        ].map((k) => (
          <Card key={k.l}><CardContent className="p-4 text-center">
            <div className={`text-3xl font-bold ${k.c}`}>{k.v}</div>
            <div className="text-sm text-gray-500">{k.l}</div>
          </CardContent></Card>
        ))}
      </div>

      {(q.data?.resumen?.length ?? 0) > 1 && (
        <Card>
          <CardHeader><CardTitle>Por SKU</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {q.data!.resumen.map((r: any) => (
              <div key={r.sku} className="flex items-center justify-between text-sm">
                <span className="font-mono">{r.sku}</span>
                <span className="flex gap-3">
                  <span>{r.total} total</span>
                  <span className="text-green-600">{r.buenos} buenos</span>
                  <span className="text-red-600">{r.malos} malos</span>
                  {r.errores > 0 && <span className="text-amber-600">{r.errores} err</span>}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Pruebas</CardTitle></CardHeader>
        <CardContent className="p-0">
          {q.isLoading ? (
            <p className="p-6 text-sm text-gray-500">Cargando…</p>
          ) : !q.data?.pruebas?.length ? (
            <p className="p-6 text-sm text-gray-500">
              {hayFiltro ? "Nada con esos filtros." : "Todavía no hay pruebas registradas."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="p-3">Fecha</th><th className="p-3">SKU</th>
                    <th className="p-3">Operador</th><th className="p-3">Resultado</th>
                    <th className="p-3">Tiempo</th><th className="p-3">Lote</th>
                    <th className="p-3">Golden</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.pruebas.map((p: any) => {
                    const fallos = JSON.parse(p.faults || "[]");
                    return (
                      <tr key={p.id} className="border-t hover:bg-gray-50 cursor-pointer"
                          onClick={() => setDetalle(detalle?.id === p.id ? null : { ...p, fallos })}>
                        <td className="p-3 whitespace-nowrap">
                          {new Date(p.started_at).toLocaleString()}
                        </td>
                        <td className="p-3 font-mono">{p.sku}</td>
                        <td className="p-3">{p.operator}</td>
                        <td className="p-3">
                          <span className="inline-flex items-center gap-1.5">
                            {icono(p.result)}
                            {p.result === "PASS" ? "Bueno" : p.result === "FAIL" ? "Rechazado" : "Error"}
                            {fallos.length > 0 && <Badge variant="secondary">{fallos.length}</Badge>}
                          </span>
                        </td>
                        <td className="p-3">{(p.duration_ms / 1000).toFixed(1)} s</td>
                        <td className="p-3 font-mono">{p.lote_id || "—"}</td>
                        {/* La huella del golden identifica EXACTAMENTE contra qué
                            se validó esta pieza, aunque después se recapture. */}
                        <td className="p-3 font-mono text-xs">{p.job_huella || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {detalle && (
        <Card>
          <CardHeader><CardTitle>Prueba #{detalle.id} — {detalle.sku}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <div><span className="text-gray-500">Operador</span><br /><b>{detalle.operator}</b></div>
              <div><span className="text-gray-500">Job</span><br /><b>{detalle.job_nombre || "—"}</b></div>
              <div><span className="text-gray-500">Golden</span><br />
                   <b className="font-mono">{detalle.job_huella || "—"}</b></div>
            </div>
            {detalle.notes && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                {detalle.notes}
              </div>
            )}
            {detalle.fallos.length > 0 ? (
              <div className="space-y-2">
                {detalle.fallos.map((f: any, i: number) => (
                  <div key={i} className="rounded-md border p-3">
                    <Badge variant={f.tipo === "ABIERTO" ? "outline" : "destructive"}>{f.tipo}</Badge>
                    <div className="font-mono mt-1">{f.texto}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">Sin fallos.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
