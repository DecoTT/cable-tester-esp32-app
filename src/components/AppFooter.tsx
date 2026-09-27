import { Info, Settings, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getVersionString } from "@/config/version";
import type { TabId } from "./NavigationTabs";

export default function AppFooter({ activeTab, setActiveTab }: { activeTab: TabId; setActiveTab: (t: TabId) => void }) {
  return (
    <div className="bg-white rounded-lg shadow-lg p-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>
            © {new Date().getFullYear()} SBC Group —{" "}
            <a href="https://sbcgroup.com.mx/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">ES</a>{" "}
            <a href="https://sbcgroup.com.mx/en/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">EN</a>
          </span>
          <span className="flex items-center gap-1 text-xs text-gray-500 font-mono">
            <Info className="h-3 w-3" /> {getVersionString()}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant={activeTab === "operador" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("operador")}>
            <User className="w-4 h-4 mr-1" /> Operador
          </Button>
          <Button variant={activeTab === "configuracion" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("configuracion")}>
            <Settings className="w-4 h-4 mr-1" /> Configuración
          </Button>
        </div>
      </div>
    </div>
  );
}
