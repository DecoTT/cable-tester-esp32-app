
import React from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  FlaskConical, 
  BarChart3, 
  Package, 
  AlertTriangle, 
  Tags, 
  FileText
} from 'lucide-react';

interface NavigationTabsProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const NavigationTabs: React.FC<NavigationTabsProps> = ({ activeTab, setActiveTab }) => {
  return (
    <div className="border-b">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-6 h-auto p-2">
          <TabsTrigger value="testing" className="flex flex-col items-center space-y-2 p-4 h-auto">
            <FlaskConical className="w-5 h-5" />
            <span className="text-sm font-medium">Pruebas</span>
          </TabsTrigger>
          
          <TabsTrigger value="results" className="flex flex-col items-center space-y-2 p-4 h-auto">
            <BarChart3 className="w-5 h-5" />
            <span className="text-sm font-medium">Resultados</span>
          </TabsTrigger>
          
          <TabsTrigger value="skus" className="flex flex-col items-center space-y-2 p-4 h-auto">
            <Package className="w-5 h-5" />
            <span className="text-sm font-medium">SKUs</span>
          </TabsTrigger>
          
          <TabsTrigger value="codigos" className="flex flex-col items-center space-y-2 p-4 h-auto">
            <AlertTriangle className="w-5 h-5" />
            <span className="text-sm font-medium">Códigos</span>
          </TabsTrigger>
          
          <TabsTrigger value="labels" className="flex flex-col items-center space-y-2 p-4 h-auto">
            <Tags className="w-5 h-5" />
            <span className="text-sm font-medium">Etiquetas</span>
          </TabsTrigger>
          
          <TabsTrigger value="logs" className="flex flex-col items-center space-y-2 p-4 h-auto">
            <FileText className="w-5 h-5" />
            <span className="text-sm font-medium">Logs</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
};

export default NavigationTabs;
