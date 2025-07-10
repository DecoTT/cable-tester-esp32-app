
import React from 'react';
import { Button } from '@/components/ui/button';
import { HardDrive, User } from 'lucide-react';

interface AdminTabsProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const AdminTabs: React.FC<AdminTabsProps> = ({ activeTab, setActiveTab }) => {
  return (
    <div className="flex items-center space-x-2">
      <Button
        variant={activeTab === 'files' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => setActiveTab('files')}
        className="flex items-center space-x-2 px-3 py-2"
      >
        <HardDrive className="w-4 h-4" />
        <span className="text-sm">Archivos</span>
      </Button>
      
      <Button
        variant={activeTab === 'operator' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => setActiveTab('operator')}
        className="flex items-center space-x-2 px-3 py-2"
      >
        <User className="w-4 h-4" />
        <span className="text-sm">Operador</span>
      </Button>
    </div>
  );
};

export default AdminTabs;
