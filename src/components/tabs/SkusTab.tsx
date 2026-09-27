import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Package, MoreVertical, Pencil, EyeOff, Eye, Fingerprint } from "lucide-react";
import SkuWizard from "@/components/SkuWizard";
import { api, type Sku } from "@/services/api";
import { useToast } from "@/hooks/use-toast";

// Un SKU es el producto; el JOB es su golden aprobado, con el orden de unidades
// dentro. Antes esta pantalla mostraba "tester vinculado", que era del modelo
// viejo —un tester = un SKU, golden dentro del ESP32—. Ahora el golden vive en
// la PC y lo que importa es si el SKU tiene un job aprobado y con qué huella.

export default function SkusTab({ operator }: { operator: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [wizard, setWizard] = useState(false);
  const [editando, setEditando] = useState<Sku | null>(null);

  const skus = useQuery({ queryKey: ["skus"], queryFn: api.skus.list });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.medida.jobs().then((d) => d.jobs) });

  const refrescar = () => { qc.invalidateQueries({ queryKey: ["skus"] }); qc.invalidateQueries({ queryKey: ["jobs"] }); };

  const guardarEdicion = async (s: Sku) => {
    try {
      await api.skus.upsert({
        codigo: s.codigo, descripcion: s.descripcion,
        standard_pack: s.standard_pack, labels_per_pack: s.labels_per_pack,
        label_type: s.label_type, active: s.active,
      }, operator);
      setEditando(null); refrescar();
      toast({ title: "SKU actualizado", description: s.codigo });
    } catch (e: any) {
      toast({ variant: "destructive", title: "No se pudo guardar", description: e.message });
    }
  };

  const alternarActivo = async (s: Sku) => {
    await guardarEdicion({ ...s, active: s.active ? 0 : 1 });
  };

  if (wizard) return <SkuWizard operator={operator} onDone={() => { setWizard(false); refrescar(); }} />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">SKUs</h2>
          <p className="text-sm text-gray-600">
            Cada SKU tiene su golden aprobado y el orden de unidades con el que se capturó.
          </p>
        </div>
        <Button onClick={() => setWizard(true)}>
          <Plus className="w-4 h-4 mr-2" />Nuevo SKU
        </Button>
      </div>

      {skus.isLoading ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : !skus.data?.length ? (
        <Card><CardContent className="p-8 text-center space-y-3">
          <Package className="w-10 h-10 mx-auto text-gray-300" />
          <p className="text-gray-600">Todavía no hay ningún SKU.</p>
          <Button onClick={() => setWizard(true)}><Plus className="w-4 h-4 mr-2" />Nuevo SKU</Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {skus.data.map((s) => {
            const job = jobs.data?.find((j: any) => j.sku === s.codigo);
            return (
              <Card key={s.codigo} className={s.active ? "" : "opacity-60"}>
                <CardContent className="p-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-lg">{s.codigo}</span>
                      {!s.active && <Badge variant="outline">inactivo</Badge>}
                      {s.codigo.startsWith("TODO-") && (
                        <Badge variant="outline" className="text-amber-700 border-amber-300">
                          código provisional
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">{s.descripcion || "—"}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Badge variant="secondary">pack {s.standard_pack}</Badge>
                      <Badge variant="secondary">{s.labels_per_pack} etiqueta(s)</Badge>
                      <Badge variant="outline">{s.label_type}</Badge>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 shrink-0">
                    <div className="text-right text-sm">
                      {job ? (
                        <>
                          <div className="inline-flex items-center gap-2">
                            <Fingerprint className="w-4 h-4 text-gray-400" />
                            <span className="font-mono text-xs">{job.huella}</span>
                          </div>
                          <div className="text-gray-600">
                            {job.nets_count} conexiones · {job.channels} canales
                          </div>
                          <div className="text-xs text-gray-500">
                            {(JSON.parse(job.hosts || "[]") as string[]).length} unidad(es)
                          </div>
                        </>
                      ) : (
                        <span className="text-amber-600">sin golden aprobado</span>
                      )}
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditando(s)}>
                          <Pencil className="w-4 h-4 mr-2" />Editar SKU
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setWizard(true)}>
                          <Fingerprint className="w-4 h-4 mr-2" />
                          {job ? "Recapturar golden" : "Capturar golden"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => alternarActivo(s)}>
                          {s.active ? <><EyeOff className="w-4 h-4 mr-2" />Desactivar</>
                                    : <><Eye className="w-4 h-4 mr-2" />Reactivar</>}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* El código NO se edita: va impreso en las etiquetas ya producidas, y
          cambiarlo rompería la trazabilidad de lo que ya salió. */}
      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar {editando?.codigo}</DialogTitle>
            <DialogDescription>
              El código no se puede cambiar: va impreso en las etiquetas ya producidas.
              Si necesitas otro, crea un SKU nuevo.
            </DialogDescription>
          </DialogHeader>

          {editando && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="d">Descripción</Label>
                <Input id="d" value={editando.descripcion}
                       onChange={(e) => setEditando({ ...editando, descripcion: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="p">Standard pack</Label>
                  <Input id="p" type="number" min={1} value={editando.standard_pack}
                         onChange={(e) => setEditando({ ...editando, standard_pack: Number(e.target.value) })} />
                </div>
                <div>
                  <Label htmlFor="l">Etiquetas por bolsa</Label>
                  <Input id="l" type="number" min={1} value={editando.labels_per_pack}
                         onChange={(e) => setEditando({ ...editando, labels_per_pack: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <Label>Tipo de etiqueta</Label>
                <div className="flex gap-2 mt-1">
                  {(["large", "standard"] as const).map((t) => (
                    <Button key={t} type="button" variant={editando.label_type === t ? "default" : "outline"}
                            onClick={() => setEditando({ ...editando, label_type: t })}>
                      {t === "large" ? "Grande" : "Estándar"}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button onClick={() => editando && guardarEdicion(editando)}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
