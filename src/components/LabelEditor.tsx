import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, ChevronUp, ChevronDown, Type, QrCode, Image, Minus } from "lucide-react";
import type { LabelElement, LabelTemplate } from "@/services/api";

// Editor visual de plantillas de etiqueta.
//
// EL JSON NO DESAPARECE. Es la misma plantilla vista de dos maneras, y las dos
// se pueden editar: el formulario para colocar cosas sin pelearse con llaves, y
// el JSON para pegar una plantilla entera, duplicarla o tocar algo que el
// formulario no cubra.
//
// LA SINCRONIZACIÓN, QUE ES LO DELICADO
//
// La verdad es el OBJETO, no el texto. El formulario escribe en el objeto y el
// texto se regenera; al escribir en el texto se intenta parsear y, solo si es
// válido, se actualiza el objeto.
//
// Mientras el cursor está dentro del textarea NO se regenera el texto: si se
// reformateara a cada tecla, el cursor saltaría al final y sería imposible
// escribir. Por eso hay un flag de foco y no un useEffect que lo pise todo.
//
// EL LIENZO es una vista a escala, no el render real: sirve para colocar, no
// para juzgar el resultado. Lo que se imprime lo dice la vista previa en PDF,
// que la hace pdfkit — que es quien va a imprimir de verdad.

const TAMANOS = {
  large:    { w: 212.6, h: 141.7, nombre: "7,5 × 5 cm" },
  standard: { w: 93.6,  h: 72.0,  nombre: '1,3" × 1"' },
};

const NUEVO: Record<LabelElement["type"], LabelElement> = {
  text: { type: "text", x: 6, y: 6, w: 100, value: "{sku}", size: 8, align: "left" },
  qr:   { type: "qr",   x: 6, y: 6, w: 50,  value: "{qr}" },
  logo: { type: "logo", x: 4, y: 4, w: 34 },
  line: { type: "line", x: 4, y: 20, w: 100, h: 0 },
};

const ICONO = { text: Type, qr: QrCode, logo: Image, line: Minus };

export default function LabelEditor({
  template, onChange,
}: {
  template: LabelTemplate;
  onChange: (t: LabelTemplate) => void;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const [texto, setTexto] = useState(() => JSON.stringify(template, null, 2));
  const [jsonMal, setJsonMal] = useState(false);
  const editandoJson = useRef(false);

  // El texto solo se regenera desde el objeto cuando NO se está escribiendo en
  // él. Si no, cada tecla reformatearía y el cursor saltaría al final.
  const textoMostrado = editandoJson.current ? texto : JSON.stringify(template, null, 2);

  const size = TAMANOS[template.size] ?? TAMANOS.large;
  const els = template.elements ?? [];

  const set = (t: LabelTemplate) => { onChange(t); setTexto(JSON.stringify(t, null, 2)); };
  const setEls = (elements: LabelElement[]) => set({ ...template, elements });

  const editar = (i: number, cambios: Partial<LabelElement>) =>
    setEls(els.map((e, k) => (k === i ? { ...e, ...cambios } : e)));

  const mover = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= els.length) return;
    const copia = [...els];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    setEls(copia);
    setSel(j);
  };

  const escala = 2.2;   // px por punto en el lienzo

  const previoTexto = useMemo(() => (e: LabelElement) => {
    if (e.type === "text") return e.value || "";
    if (e.type === "qr")   return "QR";
    if (e.type === "logo") return "logo";
    return "";
  }, []);

  return (
    <div className="space-y-4">
      {/* ── Lienzo ── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label>Disposición <span className="text-xs font-normal text-gray-500">— {size.nombre}</span></Label>
          <Select value={template.size} onValueChange={(v) => set({ ...template, size: v as "large" | "standard" })}>
            <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="large">Large — 7,5 × 5 cm</SelectItem>
              <SelectItem value="standard">Standard — 1,3" × 1"</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="relative border-2 border-dashed rounded bg-white mx-auto overflow-hidden"
             style={{ width: size.w * escala, height: size.h * escala }}>
          {els.map((e, i) => (
            <button
              key={i}
              onClick={() => setSel(i)}
              className={`absolute text-left overflow-hidden ${
                sel === i ? "ring-2 ring-blue-500 bg-blue-50/60" : "hover:bg-slate-100/60"}`}
              style={{
                left: e.x * escala, top: e.y * escala,
                width: (e.w ?? 20) * escala,
                height: e.type === "qr" ? (e.w ?? 20) * escala
                      : e.type === "line" ? 2
                      : Math.max(8, (e.size ?? 8) * escala),
                border: e.type === "line" ? "none" : "1px dotted rgba(0,0,0,.25)",
                background: e.type === "line" ? "#334155" : undefined,
                fontSize: Math.max(6, (e.size ?? 8) * escala * 0.8),
                fontWeight: e.bold ? 700 : 400,
                textAlign: e.align ?? "left",
                whiteSpace: "nowrap",
              }}
              title={`${e.type} · x${e.x} y${e.y}`}
            >
              {previoTexto(e)}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1 text-center">
          Vista a escala para colocar. Lo que se imprime lo dice la vista previa en PDF.
        </p>
      </div>

      {/* ── Añadir ── */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(NUEVO) as LabelElement["type"][]).map((t) => {
          const Icono = ICONO[t];
          return (
            <Button key={t} size="sm" variant="outline"
                    onClick={() => { setEls([...els, { ...NUEVO[t] }]); setSel(els.length); }}>
              <Plus className="w-3 h-3 mr-1" /><Icono className="w-3 h-3 mr-1" />{t}
            </Button>
          );
        })}
      </div>

      {/* ── Lista y edición ── */}
      <div className="space-y-1">
        {els.map((e, i) => {
          const Icono = ICONO[e.type];
          return (
            <div key={i} className={`rounded border ${sel === i ? "border-blue-400" : ""}`}>
              <div className="flex items-center gap-2 px-2 py-1">
                <button className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        onClick={() => setSel(sel === i ? null : i)}>
                  <Icono className="w-4 h-4 shrink-0 text-slate-500" />
                  <Badge variant="outline" className="shrink-0">{e.type}</Badge>
                  <span className="text-sm truncate">{e.value ?? `x${e.x} y${e.y}`}</span>
                </button>
                <Button size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => mover(i, -1)} disabled={i === 0}>
                  <ChevronUp className="w-3 h-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => mover(i, 1)} disabled={i === els.length - 1}>
                  <ChevronDown className="w-3 h-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600"
                        onClick={() => { setEls(els.filter((_, k) => k !== i)); setSel(null); }}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>

              {sel === i && (
                <div className="border-t p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {e.type !== "line" && e.type !== "logo" && (
                    <div className="col-span-2 sm:col-span-4">
                      <Label className="text-xs">Contenido</Label>
                      <Input value={e.value ?? ""} onChange={(ev) => editar(i, { value: ev.target.value })} />
                      <p className="text-xs text-gray-500 mt-0.5">
                        {"{sku} {desc} {date} {qty} {lote} {qr} {unidad} {mac} {ip} {fw}"}
                      </p>
                    </div>
                  )}
                  <div><Label className="text-xs">X</Label>
                    <Input type="number" value={e.x} onChange={(ev) => editar(i, { x: Number(ev.target.value) })} /></div>
                  <div><Label className="text-xs">Y</Label>
                    <Input type="number" value={e.y} onChange={(ev) => editar(i, { y: Number(ev.target.value) })} /></div>
                  <div><Label className="text-xs">Ancho</Label>
                    <Input type="number" value={e.w ?? 0} onChange={(ev) => editar(i, { w: Number(ev.target.value) })} /></div>
                  {e.type === "text" && (
                    <div><Label className="text-xs">Cuerpo</Label>
                      <Input type="number" value={e.size ?? 8} onChange={(ev) => editar(i, { size: Number(ev.target.value) })} /></div>
                  )}
                  {e.type === "text" && (
                    <>
                      <div>
                        <Label className="text-xs">Alineación</Label>
                        <Select value={e.align ?? "left"} onValueChange={(v) => editar(i, { align: v as any })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="left">Izquierda</SelectItem>
                            <SelectItem value="center">Centro</SelectItem>
                            <SelectItem value="right">Derecha</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end gap-2 pb-1">
                        <Switch checked={!!e.bold} onCheckedChange={(v) => editar(i, { bold: v })} />
                        <span className="text-sm">Negrita</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── QR ── */}
      <div>
        <Label className="text-xs">Formato del QR</Label>
        <Input value={template.qr_format ?? ""} placeholder="{sku}.{date}.{qty}.{lote}"
               onChange={(ev) => set({ ...template, qr_format: ev.target.value || undefined })} />
        <p className="text-xs text-gray-500 mt-0.5">
          Vacío = <span className="font-mono">{"{sku}.{date}.{qty}.{lote}"}</span>. Lo que se
          guarda en la base es esto mismo, así que un QR impreso y su registro no pueden discrepar.
        </p>
      </div>

      {/* ── JSON, que sigue estando ── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label htmlFor="json">JSON</Label>
          {jsonMal && <span className="text-xs text-red-600">JSON inválido — no se aplica</span>}
        </div>
        <textarea
          id="json"
          value={textoMostrado}
          rows={10}
          spellCheck={false}
          className={`w-full font-mono text-xs rounded border p-2 ${jsonMal ? "border-red-400" : ""}`}
          onFocus={() => { editandoJson.current = true; setTexto(JSON.stringify(template, null, 2)); }}
          onBlur={() => { editandoJson.current = false; setJsonMal(false); }}
          onChange={(ev) => {
            const t = ev.target.value;
            setTexto(t);
            try {
              const obj = JSON.parse(t);
              setJsonMal(false);
              onChange(obj);            // solo el objeto: el texto lo lleva el usuario
            } catch { setJsonMal(true); }
          }}
        />
        <p className="text-xs text-gray-500 mt-0.5">
          Editable: lo que escribas aquí se refleja arriba en cuanto el JSON sea válido.
        </p>
      </div>
    </div>
  );
}
