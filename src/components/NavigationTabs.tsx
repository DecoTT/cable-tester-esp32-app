
import React from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  FlaskConical, 
  BarChart3, 
  Package, 
  AlertTriangle, 
  Tags, 
  FileText, 
  User,
  HardDrive
} from 'lucide-react';

interface NavigationTabsProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const NavigationTabs: React.FC<NavigationTabsProps> = ({ activeTab, setActiveTab }) => {
  return (
    <div className="border-b">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-8 h-auto p-1">
          <TabsTrigger value="testing" className="flex flex-col items-center space-y-1 p-3 h-auto">
            <FlaskConical className="w-4 h-4" />
            <span className="text-xs">Pruebas</span>
          </TabsTrigger>
          
          <TabsTrigger value="results" className="flex flex-col items-center space-y-1 p-3 h-auto">
            <BarChart3 className="w-4 h-4" />
            <span className="text-xs">Resultados</span>
          </TabsTrigger>
          
          <TabsTrigger value="skus" className="flex flex-col items-center space-y-1 p-3 h-auto">
            <Package className="w-4 h-4" />
            <span className="text-xs">SKUs</span>
          </TabsTrigger>
          
          <TabsTrigger value="codigos" className="flex flex-col items-center space-y-1 p-3 h-auto">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-xs">Códigos</span>
          </TabsTrigger>
          
          <TabsTrigger value="labels" className="flex flex-col items-center space-y-1 p-3 h-auto">
            <Tags className="w-4 h-4" />
            <span className="text-xs">Etiquetas</span>
          </TabsTrigger>
          
          <TabsTrigger value="logs" className="flex flex-col items-center space-y-1 p-3 h-auto">
            <FileText className="w-4 h-4" />
            <span className="text-xs">Logs</span>
          </TabsTrigger>
          
          <TabsTrigger value="operator" className="flex flex-col items-center space-y-1 p-3 h-auto">
            <User className="w-4 h-4" />
            <span className="text-xs">Operador</span>
          </TabsTrigger>

          <TabsTrigger value="files" className="flex flex-col items-center space-y-1 p-3 h-auto">
            <HardDrive className="w-4 h-4" />
            <span className="text-xs">Archivos</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
};

export default NavigationTabs;
