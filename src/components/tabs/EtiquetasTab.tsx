import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Eye, FileDown } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { api, type LabelTemplate } from "@/services/api";
import LabelEditor from "@/components/LabelEditor";

const todayYMD = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};

// Fase 0-1: vista previa y generacion de PDF con las plantillas por defecto,
// editando el JSON a mano. El editor visual por SKU llega en Fase 4; esto
// valida ya toda la tuberia: plantilla → pdfkit → PDF → (impresora opcional).
export default function EtiquetasTab({ operator }: { operator: string }) {
  const defaults = useQuery({ queryKey: ["label-defaults"], queryFn: api.labels.defaults });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });

  const [size, setSize] = useState<"large" | "standard">("large");
  const [tpl, setTpl] = useState<LabelTemplate | null>(null);
  const [sku, setSku]   = useState("NP-SCA-4");
  const [qty, setQty]   = useState("10");
  const [lote, setLote] = useState("0001");
  const [pdf, setPdf]   = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Etiqueta de EQUIPO ────────────────────────────────────────────────
  // No etiqueta una pieza producida, sino el tester: el modulo 32PO se marca
  // con su unidad (8744) para saber cual es sin abrir la app. Los datos salen
  // de lo que ya se conoce —la MAC del registro, el firmware del mDNS—, no se
  // teclean: una etiqueta de equipo escrita a mano es una etiqueta que miente.
  const unidades    = useQuery({ queryKey: ["testers"],    queryFn: api.testers.list });
  const descubiertos = useQuery({ queryKey: ["discovered"], queryFn: api.testers.discovered, refetchInterval: 5000 });
  const [mac, setMac] = useState("");
  const [modelo, setModelo] = useState("Tester 32PO Module");
  const [canales, setCanales] = useState("32");

  const equipo = useMemo(() => {
    const u = (unidades.data ?? []).find((x) => x.mac === mac);
    if (!u) return null;
    const viva = (descubiertos.data ?? []).find((d) => d.unit === u.unit);
    return {
      modelo, unidad: u.unit, mac: u.mac,
      ip: viva?.ip || u.ip || "—",
      fw: viva?.fw || u.fw || "—",
      canales,
      date: new Date().toISOString().slice(0, 10),
    };
  }, [mac, modelo, canales, unidades.data, descubiertos.data]);

  const etiquetaEquipo = async (soloPrevia: boolean) => {
    if (!equipo) return;
    const tpl = defaults.data?.templates?.device;
    if (!tpl) return toast({ title: "Falta la plantilla de equipo", variant: "destructive" });
    setBusy(true);
    try {
      if (soloPrevia) {
        const r = await api.labels.preview(tpl, equipo as any);
        if (r.ok && r.pdf_base64) setPdf(`data:application/pdf;base64,${r.pdf_base64}`);
        else toast({ title: "Error", description: r.error, variant: "destructive" });
      } else {
        const r = await api.labels.print(tpl, [equipo as any], operator);
        if (!r.ok) return toast({ title: "Error", description: r.error, variant: "destructive" });
        toast({
          title: r.printed ? `Etiqueta de ${equipo.unidad} impresa` : `PDF de ${equipo.unidad} generado`,
          description: r.printed ? `Enviada a ${r.printer}` : "Guardado en data/labels/",
        });
        if (r.pdf_url) setPdf(r.pdf_url);
      }
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const t = defaults.data?.templates?.[size];
    if (t) setTpl(structuredClone(t));
  }, [defaults.data, size]);

  const template = tpl;

  const label = { sku, date: todayYMD(), qty, lote };
  const qr = `${sku}.${label.date}.${qty}.${lote}`;

  const preview = async () => {
    if (!template) return toast({ title: "Plantilla inválida", description: "El JSON no se puede parsear", variant: "destructive" });
    setBusy(true);
    try {
      const r = await api.labels.preview(template, label);
      if (r.ok && r.pdf_base64) setPdf(`data:application/pdf;base64,${r.pdf_base64}`);
      else toast({ title: "Error", description: r.error, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const generate = async () => {
    if (!template) return;
    setBusy(true);
    try {
      const r = await api.labels.print(template, [label], operator);
      if (!r.ok) return toast({ title: "Error", description: r.error, variant: "destructive" });
      toast({
        title: r.printed ? "Etiqueta impresa" : "PDF generado",
        description: r.printed ? `Enviada a ${r.printer}`
                   : r.printError ? `${r.printer} falló: ${r.printError}. El PDF está guardado.`
                   : "Sin impresora elegida — guardado en data/labels/",
      });
      if (r.pdf_url) setPdf(r.pdf_url);
    } finally { setBusy(false); }
  };

  const impresora = settings.data?.printer_name || "";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Etiquetas</h2>
          <p className="text-gray-600">Plantilla → PDF → vista previa. Formato QR: <span className="font-mono">SKU.FECHA.QTY.LOTE</span></p>
        </div>
        <Badge variant={impresora ? "default" : "outline"}>
          {impresora ? `Impresora: ${impresora}` : "Sin impresora — solo PDF"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Datos de prueba</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-xs text-gray-500">SKU</label><Input value={sku} onChange={e => setSku(e.target.value.toUpperCase())} /></div>
              <div><label className="text-xs text-gray-500">Cantidad</label><Input value={qty} onChange={e => setQty(e.target.value)} type="number" /></div>
              <div><label className="text-xs text-gray-500">Lote</label><Input value={lote} onChange={e => setLote(e.target.value)} /></div>
            </div>
            <div>
              <label className="text-xs text-gray-500">Tamaño</label>
              <Select value={size} onValueChange={v => setSize(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="large">Large — {defaults.data?.sizes?.large?.name || "7.5 × 5 cm"}</SelectItem>
                  <SelectItem value="standard">Standard — {defaults.data?.sizes?.standard?.name || '1.3" × 1"'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs font-mono text-gray-500">QR: {qr}</p>
            <div className="flex gap-2">
              <Button onClick={preview} disabled={busy || !template} variant="outline"><Eye className="w-4 h-4 mr-1" /> Vista previa</Button>
              <Button onClick={generate} disabled={busy || !template}>
                {impresora ? <Printer className="w-4 h-4 mr-1" /> : <FileDown className="w-4 h-4 mr-1" />}
                {impresora ? "Imprimir" : "Generar PDF"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plantilla</CardTitle>
            <p className="text-sm text-gray-600">
              Editor visual y JSON, sobre la misma plantilla: lo que cambies en uno
              aparece en el otro.
            </p>
          </CardHeader>
          <CardContent>
            {tpl
              ? <LabelEditor template={tpl} onChange={setTpl} />
              : <p className="text-sm text-gray-500">Cargando plantilla…</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Etiqueta de equipo</CardTitle>
          <p className="text-sm text-gray-600">
            Para marcar el módulo físico con su unidad. Los datos salen del registro
            y del descubrimiento en red, no se teclean.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="md:col-span-1">
              <label className="text-xs text-gray-500">Equipo</label>
              <Select value={mac} onValueChange={setMac}>
                <SelectTrigger><SelectValue placeholder="Elige la unidad…" /></SelectTrigger>
                <SelectContent>
                  {(unidades.data ?? []).map((u) => {
                    const viva = (descubiertos.data ?? []).some((d) => d.unit === u.unit);
                    return (
                      <SelectItem key={u.mac} value={u.mac}>
                        {u.unit} — {u.notes || u.mac}{viva ? " · en red" : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Modelo</label>
              <Input value={modelo} onChange={(e) => setModelo(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Canales</label>
              <Input value={canales} onChange={(e) => setCanales(e.target.value)} />
            </div>
          </div>

          {equipo && (
            <div className="text-xs font-mono text-gray-600 rounded border bg-slate-50 p-2 space-y-0.5">
              <div>MAC {equipo.mac} · IP {equipo.ip} · fw {equipo.fw}</div>
              <div>QR: CT32.{equipo.unidad}.{equipo.mac}</div>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" disabled={!equipo || busy} onClick={() => etiquetaEquipo(true)}>
              <Eye className="w-4 h-4 mr-1" /> Vista previa
            </Button>
            <Button disabled={!equipo || busy} onClick={() => etiquetaEquipo(false)}>
              {impresora ? <Printer className="w-4 h-4 mr-1" /> : <FileDown className="w-4 h-4 mr-1" />}
              {impresora ? "Imprimir etiqueta de equipo" : "Generar PDF de equipo"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {pdf && (
        <Card>
          <CardHeader><CardTitle>Vista previa</CardTitle></CardHeader>
          <CardContent>
            <iframe title="preview" src={pdf} className="w-full h-[420px] border rounded" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
