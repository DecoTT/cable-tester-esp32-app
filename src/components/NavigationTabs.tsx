import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FlaskConical, BarChart3, Package, Stethoscope, Tags, FileText, Cable } from "lucide-react";

// Mismas 6 pestañas principales que la app vieja, en el mismo orden.
// "Códigos" pasa a "Diagnóstico": las fallas ahora vienen estructuradas del
// tester y se muestran en terminos del conector, no como codigos opacos.
export type TabId =
  | "pruebas" | "resultados" | "skus" | "socket" | "diagnostico" | "etiquetas" | "logs"
  | "operador" | "configuracion";

const MAIN: { id: TabId; label: string; Icon: typeof FlaskConical }[] = [
  { id: "pruebas",     label: "Pruebas",     Icon: FlaskConical },
  { id: "resultados",  label: "Resultados",  Icon: BarChart3 },
  { id: "skus",        label: "SKUs",        Icon: Package },
  { id: "socket",      label: "Socket",      Icon: Cable },
  { id: "diagnostico", label: "Diagnóstico", Icon: Stethoscope },
  { id: "etiquetas",   label: "Etiquetas",   Icon: Tags },
  { id: "logs",        label: "Logs",        Icon: FileText },
];

export default function NavigationTabs({ activeTab, setActiveTab }: { activeTab: TabId; setActiveTab: (t: TabId) => void }) {
  return (
    <div className="border-b">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)} className="w-full">
        <TabsList className="grid w-full grid-cols-7 h-auto p-2">
          {MAIN.map(({ id, label, Icon }) => (
            <TabsTrigger key={id} value={id} className="flex flex-col items-center space-y-2 p-4 h-auto">
              <Icon className="w-5 h-5" />
              <span className="text-sm font-medium">{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
