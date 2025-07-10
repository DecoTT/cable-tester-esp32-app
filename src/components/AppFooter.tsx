
import React from 'react';
import AdminTabs from './AdminTabs';

interface AppFooterProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const AppFooter: React.FC<AppFooterProps> = ({ activeTab, setActiveTab }) => {
  return (
    <div className="bg-white rounded-lg shadow-lg p-4">
      <div className="flex justify-between items-center">
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
        
        <AdminTabs activeTab={activeTab} setActiveTab={setActiveTab} />
      </div>
    </div>
  );
};

export default AppFooter;
