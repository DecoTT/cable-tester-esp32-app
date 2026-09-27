import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppHeader from "@/components/AppHeader";
import NavigationTabs, { type TabId } from "@/components/NavigationTabs";
import AppFooter from "@/components/AppFooter";
import PruebasTab from "@/components/tabs/PruebasTab";
import ResultadosTab from "@/components/tabs/ResultadosTab";
import SkusTab from "@/components/tabs/SkusTab";
import SocketTab from "@/components/tabs/SocketTab";
import DiagnosticoTab from "@/components/tabs/DiagnosticoTab";
import EtiquetasTab from "@/components/tabs/EtiquetasTab";
import LogsTab from "@/components/tabs/LogsTab";
import OperadorTab from "@/components/tabs/OperadorTab";
import ConfiguracionTab from "@/components/tabs/ConfiguracionTab";
import { api } from "@/services/api";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

// Misma disposicion que la app vieja: header con estado, pestañas, footer con
// admin. La gente ya la conoce; lo que cambia esta detras.
function Shell() {
  const [tab, setTab] = useState<TabId>("pruebas");
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null);
  const [operator, setOperator] = useState<string>(() => localStorage.getItem("ct32.operator") || "");

  // El SKU vive AQUI, no dentro de Pruebas.
  //
  // Socket y Pruebas tienen que estar hablando de la misma pieza: el mapa que
  // se aprende en Socket solo significa algo referido a un SKU concreto, y si
  // cada pestaña guarda su propio SKU nadie puede decir para que producto es el
  // fixture que acaba de recorrer. Persistido para que al recargar la estacion
  // siga en el producto que se esta corriendo.
  const [sku, setSku] = useState<string>(() => localStorage.getItem("ct32.sku") || "");

  useEffect(() => {
    const ping = () => api.health().then(() => setBridgeOk(true)).catch(() => setBridgeOk(false));
    ping();
    const t = setInterval(ping, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { localStorage.setItem("ct32.operator", operator); }, [operator]);
  useEffect(() => { localStorage.setItem("ct32.sku", sku); }, [sku]);

  // El bridge tambien necesita saber que producto y que operador estan puestos.
  //
  // No es duplicar estado por gusto: una prueba lanzada con el BOTON FISICO no
  // pasa por el navegador, asi que el bridge tiene que poder responder solo a
  // "¿que estoy probando y quien lo prueba?". localStorage no le sirve: vive en
  // el navegador, y el boton se pulsa aunque la pantalla este apagada.
  useEffect(() => {
    api.saveSettings({ sku_activo: sku, operador_activo: operator }, operator || "sistema")
       .catch(() => { /* sin bridge, el boton tampoco va a disparar nada */ });
  }, [sku, operator]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <AppHeader bridgeOk={bridgeOk} operator={operator} />

        <div className="bg-white rounded-lg shadow-lg">
          <NavigationTabs activeTab={tab} setActiveTab={setTab} />
          <div className="p-6">
            {tab === "pruebas"       && <PruebasTab operator={operator} sku={sku} setSku={setSku} />}
            {tab === "resultados"    && <ResultadosTab />}
            {tab === "skus"          && <SkusTab operator={operator} />}
            {tab === "socket"        && <SocketTab sku={sku} setSku={setSku} />}
            {tab === "diagnostico"   && <DiagnosticoTab skuActivo={sku} />}
            {tab === "etiquetas"     && <EtiquetasTab operator={operator} />}
            {tab === "logs"          && <LogsTab />}
            {tab === "operador"      && <OperadorTab operator={operator} setOperator={setOperator} />}
            {tab === "configuracion" && <ConfiguracionTab operator={operator} />}
          </div>
        </div>

        <AppFooter activeTab={tab} setActiveTab={setTab} />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Shell />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
