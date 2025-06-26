import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Play, 
  Square, 
  CheckCircle,
  XCircle,
  Package,
  Printer,
  Clock,
  User
} from 'lucide-react';

interface TestingTabProps {
  currentSku: string;
  setCurrentSku: (sku: string) => void;
  currentOperator: string;
  setCurrentOperator: (operator: string) => void;
  currentLote: string;
  isConnected: boolean;
  isTestRunning: boolean;
  onStartTest: () => void;
  okCount: number;
  totalProcessed: number;
  getCurrentDateString: () => string;
  getCurrentTimeString: () => string;
  standardPack: number;
}

const TestingTab: React.FC<TestingTabProps> = ({
  currentSku,
  setCurrentSku,
  currentOperator,
  setCurrentOperator,
  currentLote,
  isConnected,
  isTestRunning,
  onStartTest,
  okCount,
  totalProcessed,
  getCurrentDateString,
  getCurrentTimeString,
  standardPack
}) => {
  return (
    <div className="space-y-6">
      {/* Control Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Package className="w-5 h-5" />
              <span>SKU Actual</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              value={currentSku}
              onChange={(e) => setCurrentSku(e.target.value.toUpperCase())}
              placeholder="Ingrese SKU"
              className="mb-4"
            />
            <div className="text-sm text-gray-600">
              <p>Formato: NP-SCA-4</p>
              <p>Lote actual: {currentLote}</p>
              <p>Standard Pack: {standardPack} unidades</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <User className="w-5 h-5" />
              <span>Operador</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              value={currentOperator}
              onChange={(e) => setCurrentOperator(e.target.value)}
              placeholder="Nombre del operador"
              className="mb-4"
            />
            <div className="text-sm text-gray-600">
              <p>Fecha: {getCurrentDateString()}</p>
              <p>Hora: {getCurrentTimeString()}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Clock className="w-5 h-5" />
              <span>Control de Prueba</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={onStartTest}
              disabled={!isConnected || isTestRunning || !currentSku || !currentOperator}
              className="w-full mb-4"
              size="lg"
            >
              {isTestRunning ? (
                <>
                  <Square className="w-4 h-4 mr-2" />
                  Probando...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Iniciar Prueba
                </>
              )}
            </Button>
            
            {isTestRunning && (
              <div className="text-center">
                <div className="animate-pulse text-blue-600 font-medium">
                  Prueba en progreso...
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <CheckCircle className="w-8 h-8 text-green-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Cables OK</p>
                <p className="text-2xl font-bold text-green-600">{okCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <XCircle className="w-8 h-8 text-red-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Cables Malos</p>
                <p className="text-2xl font-bold text-red-600">{totalProcessed - okCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Package className="w-8 h-8 text-blue-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Procesados</p>
                <p className="text-2xl font-bold text-blue-600">{totalProcessed}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Printer className="w-8 h-8 text-purple-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Próxima Etiqueta</p>
                <p className="text-2xl font-bold text-purple-600">{standardPack - (okCount % standardPack)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default TestingTab;
