
import React from 'react';
import { Button } from '@/components/ui/button';
import { Wifi, WifiOff } from 'lucide-react';
import ConnectionIndicator from './ConnectionIndicator';

interface AppHeaderProps {
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({ isConnected, onConnect, onDisconnect }) => {
  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Sistema de Control de Calidad</h1>
          <p className="text-gray-600 mt-2">Pruebas automatizadas con 1100 Tester</p>
        </div>
        <div className="flex items-center space-x-4">
          <ConnectionIndicator isConnected={isConnected} />
          <Button 
            onClick={isConnected ? onDisconnect : onConnect}
            variant={isConnected ? "destructive" : "default"}
            className="flex items-center space-x-2"
          >
            {isConnected ? <WifiOff className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
            <span>{isConnected ? 'Desconectar' : 'Conectar'}</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AppHeader;
