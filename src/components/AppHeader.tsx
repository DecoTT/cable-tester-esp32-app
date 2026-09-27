import { User } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Props {
  bridgeOk: boolean | null;
  operator: string;
}

export default function AppHeader({ bridgeOk, operator }: Props) {
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
