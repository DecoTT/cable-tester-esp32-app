
import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Terminal, 
  Circle, 
  CheckCircle, 
  AlertTriangle, 
  Info,
  Settings,
  Trash2
} from 'lucide-react';
import { ArduinoMessage } from '@/services/arduinoService';

interface ArduinoMessagesPanelProps {
  messages: ArduinoMessage[];
  isConnected: boolean;
  onSendCommand: (command: string) => void;
  onClearMessages: () => void;
}

const ArduinoMessagesPanel: React.FC<ArduinoMessagesPanelProps> = ({
  messages,
  isConnected,
  onSendCommand,
  onClearMessages
}) => {
  const [filter, setFilter] = useState<string>('ALL');
  const [customCommand, setCustomCommand] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const getMessageIcon = (type: string) => {
    switch (type) {
      case 'RESULT':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'STATUS':
        return <Settings className="w-4 h-4 text-blue-500" />;
      case 'INFO':
        return <Info className="w-4 h-4 text-gray-500" />;
      case 'SKU':
      case 'OPERATOR':
        return <Circle className="w-4 h-4 text-purple-500" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    }
  };

  const getMessageBadgeVariant = (type: string) => {
    switch (type) {
      case 'RESULT':
        return 'default';
      case 'STATUS':
        return 'secondary';
      case 'INFO':
        return 'outline';
      case 'SKU':
      case 'OPERATOR':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  const filteredMessages = filter === 'ALL' 
    ? messages 
    : messages.filter(msg => msg.type === filter);

  const handleSendCommand = () => {
    if (customCommand.trim() && isConnected) {
      onSendCommand(customCommand.trim());
      setCustomCommand('');
    }
  };

  return (
    <Card className="h-96">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <Terminal className="w-5 h-5" />
            <span>Mensajes del Arduino</span>
            <Badge variant={isConnected ? "default" : "destructive"}>
              {isConnected ? 'Conectado' : 'Desconectado'}
            </Badge>
          </CardTitle>
          
          <div className="flex items-center space-x-2">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos</SelectItem>
                <SelectItem value="RESULT">Resultados</SelectItem>
                <SelectItem value="STATUS">Estados</SelectItem>
                <SelectItem value="INFO">Info</SelectItem>
                <SelectItem value="SKU">SKU</SelectItem>
              </SelectContent>
            </Select>
            
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onClearMessages}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Messages Display */}
        <ScrollArea className="h-48 w-full" ref={scrollRef}>
          <div className="space-y-2">
            {filteredMessages.map((message, index) => (
              <div key={index} className="flex items-start space-x-2 p-2 bg-gray-50 rounded text-sm">
                {getMessageIcon(message.type)}
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <Badge variant={getMessageBadgeVariant(message.type)} className="text-xs">
                      {message.type}
                    </Badge>
                    <span className="text-xs text-gray-500">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="mt-1 font-mono">{message.content}</p>
                </div>
              </div>
            ))}
            
            {filteredMessages.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No hay mensajes para mostrar
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Command Input */}
        <div className="flex space-x-2">
          <input
            type="text"
            value={customCommand}
            onChange={(e) => setCustomCommand(e.target.value)}
            placeholder="Enviar comando al Arduino..."
            className="flex-1 px-3 py-2 border rounded-md text-sm"
            disabled={!isConnected}
            onKeyPress={(e) => e.key === 'Enter' && handleSendCommand()}
          />
          <Button 
            onClick={handleSendCommand}
            disabled={!isConnected || !customCommand.trim()}
            size="sm"
          >
            Enviar
          </Button>
        </div>
        
        <div className="text-xs text-gray-500">
          Comandos: START_TEST:SKU:OP, GET_STATUS, SET_SKU:codigo
        </div>
      </CardContent>
    </Card>
  );
};

export default ArduinoMessagesPanel;
