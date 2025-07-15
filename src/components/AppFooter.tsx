
import React from 'react';
import { Info } from 'lucide-react';
import AdminTabs from './AdminTabs';
import { getVersionString, getVersionInfo } from '@/config/version';

interface AppFooterProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const AppFooter: React.FC<AppFooterProps> = ({ activeTab, setActiveTab }) => {
  const handleVersionClick = () => {
    const versionInfo = getVersionInfo();
    console.log('📋 Información de versión:', versionInfo);
    alert(`Versión: ${versionInfo.fullVersion}\nCompilado: ${versionInfo.buildDate}\nEntorno: ${versionInfo.environment}`);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-600">
            © 2025 SBC Group - <a 
              href="https://sbcgroup.com.mx/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline"
            >
              ES
            </a> <a 
              href="https://sbcgroup.com.mx/en/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline"
            >
              EN
            </a>
          </div>
          
          {/* Información de versión */}
          <button
            onClick={handleVersionClick}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
            title="Haz clic para ver información detallada de la versión"
          >
            <Info className="h-3 w-3" />
            <span className="font-mono">{getVersionString()}</span>
          </button>
        </div>
        
        <AdminTabs activeTab={activeTab} setActiveTab={setActiveTab} />
      </div>
    </div>
  );
};

export default AppFooter;
