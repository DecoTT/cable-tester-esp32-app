import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText, FileDown, RefreshCw } from "lucide-react";
import { api, type RegistroAudit } from "@/services/api";

// Logs.
//
// Tres registros que ya existían en la base y no se podían mirar sin abrir
// SQLite: pruebas, etiquetas y auditoría.
//
// La auditoría es la que importa cuando algo sale mal semanas después: quién
// aprobó qué golden y quién cambió qué configuración. Por eso se puede filtrar
// por fecha, actor y acción, y no solo "las últimas 200 líneas" — que es lo que
// había y no responde a ninguna pregunta real.
//
// Exporta CSV y JSON de lo que hay EN PANTALLA, con los filtros aplicados: si
// exportara todo daría igual haber filtrado, y quien lo abre en Excel no sabría
// qué está mirando.

const hoy   = () => new Date().toISOString().slice(0, 10);
const haceN = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const hora  = (s: string) => (s ? new Date(s).toLocaleString() : "—");

type Vista = "auditoria" | "pruebas" | "etiquetas";

/** CSV con comillas escapadas: un detalle de auditoría lleva comas y JSON. */
function aCsv(filas: Record<string, unknown>[]): string {
  if (!filas.length) return "";
  const cols = Object.keys(filas[0]);
  const celda = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...filas.map((f) => cols.map((c) => celda(f[c])).join(","))].join("\n");
}

function descargar(nombre: string, contenido: string, tipo: string) {
  // BOM para que Excel en Windows no destroce los acentos al abrir el CSV.
  const bom = tipo.startsWith("text/csv") ? "﻿" : "";
  const url = URL.createObjectURL(new Blob([bom + contenido], { type: tipo }));
  const a = document.createElement("a");
  a.href = url; a.download = nombre; a.click();
  URL.revokeObjectURL(url);
}

export default function LogsTab() {
  const [vista, setVista] = useState<Vista>("auditoria");
  const [desde, setDesde] = useState(haceN(7));
  const [hasta, setHasta] = useState(hoy());
  const [actor, setActor] = useState("");
  const [accion, setAccion] = useState("");
  const [buscar, setBuscar] = useState("");

  const filtro = { desde, hasta, actor: actor || undefined, accion: accion || undefined, buscar: buscar || undefined };

  const audit = useQuery({
    queryKey: ["audit", filtro],
    queryFn: () => api.audit({ ...filtro, limit: 1000 }),
    enabled: vista === "auditoria",
  });
  const pruebas = useQuery({
    queryKey: ["logs-pruebas", desde, hasta],
    queryFn: () => api.pruebas({ desde, hasta }),
    enabled: vista === "pruebas",
  });
  const etiquetas = useQuery({
    queryKey: ["logs-etiquetas"],
    queryFn: () => api.etiquetas(),
    enabled: vista === "etiquetas",
  });

  // Lo que se ve es lo que se exporta.
  const filas = useMemo<Record<string, unknown>[]>(() => {
    if (vista === "auditoria") {
      return (audit.data?.registros ?? []).map((r: RegistroAudit) => ({
        id: r.id, fecha: r.ts, actor: r.actor, accion: r.action,
        entidad: r.entity ?? "", referencia: r.entity_id ?? "", detalle: r.details ?? "",
      }));
    }
    if (vista === "pruebas") {
      return (pruebas.data?.pruebas ?? []).map((p: any) => ({
        id: p.id, fecha: p.started_at, sku: p.sku, operador: p.operator,
        resultado: p.result, duracion_ms: p.duration_ms, lote: p.lote_id ?? "",
        fallos: p.faults ?? "",
      }));
    }
    return (etiquetas.data?.etiquetas ?? []).map((e: any) => ({
      id: e.id, fecha: e.created_at, sku: e.sku, cantidad: e.qty,
      lote: e.lote_id ?? "", qr: e.qr_data, impresa: e.printed ? "sí" : "no",
      impresora: e.printer ?? "",
    }));
  }, [vista, audit.data, pruebas.data, etiquetas.data]);

  const cargando = audit.isFetching || pruebas.isFetching || etiquetas.isFetching;
  const recargar = () => { audit.refetch(); pruebas.refetch(); etiquetas.refetch(); };

  const sello = `${vista}_${desde}_${hasta}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <ScrollText className="w-6 h-6" /> Logs
          </h2>
          <p className="text-gray-600">
            Pruebas, etiquetas y auditoría desde la base, por rango de fechas.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={recargar} disabled={cargando}>
            <RefreshCw className={`w-4 h-4 mr-2 ${cargando ? "animate-spin" : ""}`} />Actualizar
          </Button>
          <Button variant="outline" disabled={!filas.length}
                  onClick={() => descargar(`${sello}.csv`, aCsv(filas), "text/csv;charset=utf-8")}>
            <FileDown className="w-4 h-4 mr-2" />CSV
          </Button>
          <Button variant="outline" disabled={!filas.length}
                  onClick={() => descargar(`${sello}.json`, JSON.stringify(filas, null, 2), "application/json")}>
            <FileDown className="w-4 h-4 mr-2" />JSON
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[10rem]">
              <Label htmlFor="v">Registro</Label>
              <Select value={vista} onValueChange={(v) => setVista(v as Vista)}>
                <SelectTrigger id="v"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auditoria">Auditoría</SelectItem>
                  <SelectItem value="pruebas">Pruebas</SelectItem>
                  <SelectItem value="etiquetas">Etiquetas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="l1">Desde</Label>
              <Input id="l1" type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                     disabled={vista === "etiquetas"} />
            </div>
            <div>
              <Label htmlFor="l2">Hasta</Label>
              <Input id="l2" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                     disabled={vista === "etiquetas"} />
            </div>

            {vista === "auditoria" && (
              <>
                <div className="min-w-[9rem]">
                  <Label htmlFor="ac">Actor</Label>
                  <Select value={actor || "__t__"} onValueChange={(v) => setActor(v === "__t__" ? "" : v)}>
                    <SelectTrigger id="ac"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__t__">Todos</SelectItem>
                      {(audit.data?.actores ?? []).map((a) => (
                        <SelectItem key={a} value={a}>{a}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[11rem]">
                  <Label htmlFor="an">Acción</Label>
                  <Select value={accion || "__t__"} onValueChange={(v) => setAccion(v === "__t__" ? "" : v)}>
                    <SelectTrigger id="an"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__t__">Todas</SelectItem>
                      {(audit.data?.acciones ?? []).map((a) => (
                        <SelectItem key={a} value={a}>{a}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 min-w-[12rem]">
                  <Label htmlFor="bs">Buscar</Label>
                  <Input id="bs" value={buscar} placeholder="SKU, golden, detalle…"
                         onChange={(e) => setBuscar(e.target.value)} />
                </div>
              </>
            )}

            <div className="text-sm text-gray-600 pb-2">
              {filas.length} fila(s)
              {vista === "auditoria" && audit.data && audit.data.total > filas.length &&
                ` de ${audit.data.total} — afina el filtro`}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {vista === "auditoria" ? "Auditoría" : vista === "pruebas" ? "Pruebas" : "Etiquetas"}
          </CardTitle>
          {vista === "auditoria" && (
            <p className="text-sm text-gray-600">
              Quién aprobó qué golden, quién cambió qué ajuste, quién importó datos.
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 border-b">
                <tr className="text-left">
                  {filas.length > 0
                    ? Object.keys(filas[0]).map((c) => (
                        <th key={c} className="px-3 py-2 font-medium capitalize whitespace-nowrap">{c}</th>
                      ))
                    : <th className="px-3 py-2 font-medium">—</th>}
                </tr>
              </thead>
              <tbody>
                {filas.length === 0 && (
                  <tr><td className="px-3 py-6 text-gray-500">
                    {cargando ? "Cargando…" : "Nada en este rango."}
                  </td></tr>
                )}
                {filas.map((f, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-slate-50 align-top">
                    {Object.entries(f).map(([c, v]) => {
                      // Las columnas cortas no se parten: un id troceado en dos
                      // lineas ("8" / "4") no se puede ni leer ni citar.
                      const corta = ["id", "actor", "accion", "sku", "operador",
                                     "resultado", "cantidad", "impresa", "lote",
                                     "duracion_ms", "entidad", "referencia"].includes(c);
                      return (
                        <td key={c} className={`px-3 py-1.5 ${corta ? "whitespace-nowrap" : ""}`}>
                          {c === "fecha"
                            ? <span className="whitespace-nowrap">{hora(String(v))}</span>
                            : c === "resultado"
                              ? <Badge variant={v === "PASS" ? "default" : v === "FAIL" ? "destructive" : "secondary"}>
                                  {String(v)}
                                </Badge>
                              : c === "detalle" || c === "fallos" || c === "qr"
                                ? <span className="break-all line-clamp-2" title={String(v ?? "")}>{String(v ?? "")}</span>
                                : <span>{String(v ?? "")}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
