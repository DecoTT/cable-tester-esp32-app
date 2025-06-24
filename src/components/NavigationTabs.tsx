
import React from 'react';
import { 
  Play, 
  CheckCircle,
  Package,
  Printer,
  Download,
  User
} from 'lucide-react';

interface NavigationTabsProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const NavigationTabs: React.FC<NavigationTabsProps> = ({ activeTab, setActiveTab }) => {
  const tabs = [
    { id: 'testing', label: 'Pruebas', icon: Play },
    { id: 'results', label: 'Resultados', icon: CheckCircle },
    { id: 'skus', label: 'SKUs', icon: Package },
    { id: 'labels', label: 'Etiquetas', icon: Printer },
    { id: 'logs', label: 'Logs', icon: Download },
    { id: 'operator', label: 'Operador', icon: User }
  ];

  return (
    <div className="flex border-b">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`flex items-center space-x-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
            activeTab === tab.id 
              ? 'border-blue-500 text-blue-600 bg-blue-50' 
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <tab.icon className="w-4 h-4" />
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
};

export default NavigationTabs;
