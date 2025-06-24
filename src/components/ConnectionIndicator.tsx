
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff } from 'lucide-react';

interface ConnectionIndicatorProps {
  isConnected: boolean;
}

const ConnectionIndicator: React.FC<ConnectionIndicatorProps> = ({ isConnected }) => {
  return (
    <div className="flex items-center space-x-2">
      <div 
        className={`w-3 h-3 rounded-full ${
          isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
        }`}
      />
      <Badge 
        variant={isConnected ? "default" : "destructive"}
        className="flex items-center space-x-1"
      >
        {isConnected ? (
          <>
            <Wifi className="w-3 h-3" />
            <span>Conectado</span>
          </>
        ) : (
          <>
            <WifiOff className="w-3 h-3" />
            <span>Desconectado</span>
          </>
        )}
      </Badge>
    </div>
  );
};

export default ConnectionIndicator;
