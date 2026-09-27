import { User, Cpu } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/services/api";

interface Props {
  bridgeOk: boolean | null;
  operator: string;
  equipo: string;
  setEquipo: (v: string) => void;
}

// El EQUIPO ACTIVO vive aqui arriba, al lado del operador.
//
// Hasta ahora todo se entraba por el SKU: elegir producto y que el job decida
// que equipos usa. Pero medio trabajo real es al reves — "voy a ver que le pasa
// a la 8744", "a esta le monto otro job" — y por la ruta del SKU eso obliga a
// adivinar que producto toca antes de poder mirar el equipo.
//
// Elegirlo aqui no cambia lo que hace Pruebas: ahi manda el job, como siempre.
// Lo que hace es fijar sobre QUE equipo trabajan Diagnostico y el avanzado.
export default function AppHeader({ bridgeOk, operator, equipo, setEquipo }: Props) {
  const equipos = useQuery({ queryKey: ["testers"], queryFn: api.testers.list, refetchInterval: 10000 });
  const vivos = useQuery({ queryKey: ["discovered"], queryFn: api.testers.discovered, refetchInterval: 10000 });
  const enRed = (unit: string) => (vivos.data ?? []).some((d) => d.unit === unit);
  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* El mismo logo que la pestaña del navegador: el operador lo ve
              dos veces y lo reconoce una. */}
          <img src="/logo.svg" alt="" width="40" height="40" className="rounded-lg" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Cable Tester 32CH</h1>
            <p className="text-gray-600 mt-1">Validación y trazabilidad de arneses</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={equipo || "__ninguno__"}
                  onValueChange={(v) => setEquipo(v === "__ninguno__" ? "" : v)}>
            <SelectTrigger className="w-56 h-9">
              <Cpu className="w-4 h-4 mr-1 shrink-0 text-slate-500" />
              <SelectValue placeholder="Equipo…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__ninguno__">Ningún equipo fijado</SelectItem>
              {(equipos.data ?? []).map((u) => (
                <SelectItem key={u.mac} value={u.mac}>
                  {u.unit} {u.notes ? `— ${u.notes}` : ""}{enRed(u.unit) ? "" : " · fuera de red"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {operator && (
            <Badge variant="outline" className="flex items-center gap-1 text-sm">
              <User className="w-3 h-3" /> {operator}
            </Badge>
          )}
          <span className={`inline-flex items-center gap-2 text-sm font-medium ${
            bridgeOk ? "text-green-600" : bridgeOk === false ? "text-red-600" : "text-gray-400"}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${
              bridgeOk ? "bg-green-500" : bridgeOk === false ? "bg-red-500" : "bg-gray-300"}`} />
            {bridgeOk ? "Bridge en línea" : bridgeOk === false ? "Bridge sin conexión" : "…"}
          </span>
        </div>
      </div>
    </div>
  );
}
