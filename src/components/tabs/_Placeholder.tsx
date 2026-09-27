import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Construction } from "lucide-react";

// Pestaña aun no implementada. Muestra en que fase llega y de que depende,
// para que quien abra la app sepa que falta sin buscar en el plan.
export default function Placeholder({ title, phase, depends, bullets }:
  { title: string; phase: string; depends?: string; bullets: string[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold">{title}</h2>
        <Badge variant="outline">{phase}</Badge>
      </div>
      <Card>
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-gray-500"><Construction className="w-5 h-5" /> Pendiente de implementar</div>
          {depends && <p className="text-sm text-amber-700">Depende de: {depends}</p>}
          <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
            {bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
