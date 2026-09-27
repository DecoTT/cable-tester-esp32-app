import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { User } from "lucide-react";
import { toast } from "@/hooks/use-toast";

// El operador se guarda en localStorage SOLO como comodidad de la sesion.
// Lo que vale para trazabilidad es el campo 'actor' que viaja en cada
// peticion al bridge y queda en la tabla audit / tests.
export default function OperadorTab({ operator, setOperator }: { operator: string; setOperator: (s: string) => void }) {
  const [draft, setDraft] = useState(operator);

  const save = () => {
    const v = draft.trim();
    if (!v) return;
    setOperator(v);
    toast({ title: "Operador activo", description: v });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Operador</h2>
        <p className="text-gray-600">Quién está en la estación. Queda registrado en cada prueba, etiqueta y cambio.</p>
      </div>
      <Card className="max-w-lg">
        <CardHeader><CardTitle className="flex items-center gap-2"><User className="w-5 h-5" /> Operador activo</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Nombre del operador"
                   onKeyDown={e => e.key === "Enter" && save()} />
            <Button onClick={save} disabled={!draft.trim()}>Guardar</Button>
          </div>
          {operator && <p className="text-sm text-gray-600">Actual: <b>{operator}</b></p>}
          <p className="text-xs text-gray-500">Fase 5: tabla de operadores en DB, activo/inactivo, estadísticas por operador.</p>
        </CardContent>
      </Card>
    </div>
  );
}
