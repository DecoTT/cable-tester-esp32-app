import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Printer, Package, Calendar, Hash, QrCode } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Lote } from '@/types';
import { printLabels } from '@/utils/printUtils';

interface LabelGeneratorProps {
  currentSku: string;
  currentLote: string;
  okCount: number;
  loteDatabase: Lote[];
  standardPack: number;
  onGeneratePartial: (count: number) => void;
}

const LabelGenerator: React.FC<LabelGeneratorProps> = ({ 
  currentSku, 
  currentLote, 
  okCount,
  loteDatabase,
  standardPack,
  onGeneratePartial
}) => {
  const [manualQty, setManualQty] = useState(standardPack.toString());
  const [customSku, setCustomSku] = useState(currentSku);
  const [customLote, setCustomLote] = useState(currentLote);

  const getCurrentDateString = () => {
    const now = new Date();
    return now.getFullYear().toString() + 
           (now.getMonth() + 1).toString().padStart(2, '0') + 
           now.getDate().toString().padStart(2, '0');
  };

  const generateQRData = (sku: string, fecha: string, qty: string, lote: string) => {
    return `${sku}+${fecha}+${qty}+${lote}`;
  };

  const generateAutoLabel = () => {
    if (!currentSku) {
      toast({
        title: "Error",
        description: "No hay SKU activo para generar etiqueta automática",
        variant: "destructive"
      });
      return;
    }

    const labelsToGenerate = [
      {
        sku: currentSku,
        date: getCurrentDateString(),
        qty: standardPack.toString(),
        lote: currentLote
      }
    ];

    printLabels(labelsToGenerate);
    
    toast({
      title: "Etiqueta generada automáticamente",
      description: `Etiqueta para ${currentSku} - Lote ${currentLote} - ${standardPack} unidades`,
    });
  };

  const generateManualLabel = () => {
    if (!customSku || !manualQty) {
      toast({
        title: "Error",
        description: "Complete todos los campos para generar etiqueta manual",
        variant: "destructive"
      });
      return;
    }

    const labelsToGenerate = [
      {
        sku: customSku,
        date: getCurrentDateString(),
        qty: manualQty,
        lote: customLote
      }
    ];

    printLabels(labelsToGenerate);
    
    toast({
      title: "Etiqueta generada manualmente",
      description: `Etiqueta para ${customSku} - Lote ${customLote} - ${manualQty} unidades`,
    });
  };

  const printPairs = () => {
    const requiredForPair = standardPack * 2;
    if (okCount < requiredForPair) {
      toast({
        title: "Información",
        description: `Necesita ${requiredForPair - okCount} cables OK más para imprimir pares (${requiredForPair} total)`,
        variant: "default"
      });
      return;
    }

    const labelsToGenerate = [
      {
        sku: currentSku,
        date: getCurrentDateString(),
        qty: standardPack.toString(),
        lote: currentLote
      },
      {
        sku: currentSku,
        date: getCurrentDateString(),
        qty: standardPack.toString(),
        lote: currentLote
      }
    ];

    printLabels(labelsToGenerate);
    
    toast({
      title: "Par de etiquetas impresas",
      description: `2 etiquetas para ${currentSku} - Lote ${currentLote} (${standardPack} c/u)`,
    });
  };

  const printPartial = () => {
    const partialCount = okCount % standardPack;
    if (partialCount === 0) {
      toast({
        title: "No hay parciales",
        description: "No hay cables pendientes para etiqueta parcial",
        variant: "default"
      });
      return;
    }

    onGeneratePartial(partialCount);
  };

  // Vista previa de etiqueta
  const LabelPreview = ({ sku, qty, lote, fecha }: { sku: string, qty: string, lote: string, fecha: string }) => (
    <div className="border-2 border-dashed border-gray-300 p-4 bg-white rounded-lg">
      <div className="text-center space-y-2">
        <div className="text-xs font-bold">{sku}</div>
        <div className="text-xs">Fecha: {fecha}</div>
        <div className="text-xs">Lote: {lote}</div>
        <div className="text-xs">QTY: {qty}</div>
        <div className="flex justify-center">
          <div className="w-16 h-16 border border-gray-400 bg-gray-100 flex items-center justify-center">
            <QrCode className="w-8 h-8 text-gray-600" />
          </div>
        </div>
        <div className="text-xs text-gray-500">
          {generateQRData(sku, fecha, qty, lote)}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Generador de Etiquetas</h2>
        <p className="text-gray-600">
          Imprime automáticamente 2 etiquetas cada {standardPack * 2} cables OK ({standardPack} c/u)
        </p>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Package className="w-8 h-8 text-blue-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Cables OK Actuales</p>
                <p className="text-2xl font-bold text-blue-600">{okCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Printer className="w-8 h-8 text-green-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Para Imprimir</p>
                <p className="text-2xl font-bold text-green-600">
                  {(standardPack * 2) - (okCount % (standardPack * 2))}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Hash className="w-8 h-8 text-purple-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Standard Pack</p>
                <p className="text-2xl font-bold text-purple-600">{standardPack}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Calendar className="w-8 h-8 text-yellow-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Parciales</p>
                <p className="text-2xl font-bold text-yellow-600">{okCount % standardPack}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Automatic Label Generation */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Printer className="w-5 h-5" />
              <span>Impresión Automática</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                Se imprime automáticamente cada {standardPack * 2} cables OK (2 etiquetas de {standardPack} c/u)
              </p>
              <div className="flex items-center space-x-2">
                <Badge variant="outline">SKU: {currentSku || 'No definido'}</Badge>
                <Badge variant="outline">SP: {standardPack}</Badge>
                <Badge variant="outline">Lote: {currentLote}</Badge>
              </div>
            </div>

            <div className="space-y-2">
              <Button 
                onClick={generateAutoLabel}
                disabled={!currentSku}
                className="w-full"
              >
                <Printer className="w-4 h-4 mr-2" />
                Imprimir Etiqueta ({standardPack} unidades)
              </Button>
              
              <Button 
                onClick={printPairs}
                disabled={okCount < standardPack * 2}
                variant="outline" 
                className="w-full"
              >
                <Printer className="w-4 h-4 mr-2" />
                Imprimir Par ({standardPack * 2} unidades)
              </Button>

              <Button 
                onClick={printPartial}
                disabled={okCount % standardPack === 0}
                variant="secondary" 
                className="w-full"
              >
                <Printer className="w-4 h-4 mr-2" />
                Imprimir Parcial ({okCount % standardPack} unidades)
              </Button>
            </div>

            {okCount >= standardPack * 2 && okCount % (standardPack * 2) === 0 && (
              <div className="bg-green-50 p-3 rounded-lg">
                <p className="text-sm text-green-600 font-medium">
                  ✓ Próxima impresión automática en {(standardPack * 2) - (okCount % (standardPack * 2))} cables
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Manual Label Generation */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Printer className="w-5 h-5" />
              <span>Generación Manual</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">SKU</label>
                <Input
                  value={customSku}
                  onChange={(e) => setCustomSku(e.target.value.toUpperCase())}
                  placeholder="Ingrese SKU"
                  className="mt-1"
                />
              </div>
              
              <div>
                <label className="text-sm font-medium">Cantidad</label>
                <Input
                  value={manualQty}
                  onChange={(e) => setManualQty(e.target.value)}
                  placeholder="10"
                  type="number"
                  className="mt-1"
                />
              </div>
              
              <div>
                <label className="text-sm font-medium">Lote</label>
                <Input
                  value={customLote}
                  onChange={(e) => setCustomLote(e.target.value)}
                  placeholder="0001"
                  className="mt-1"
                />
              </div>
            </div>

            <Button 
              onClick={generateManualLabel}
              className="w-full"
              variant="secondary"
            >
              <Printer className="w-4 h-4 mr-2" />
              Generar Etiqueta Manual
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Label Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Vista Previa de Etiqueta (1.3" x 1")</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center space-x-4">
            <div>
              <p className="text-sm font-medium mb-2 text-center">Etiqueta Automática</p>
              <LabelPreview 
                sku={currentSku || 'NP-SCA-4'}
                qty="10"
                lote={currentLote}
                fecha={getCurrentDateString()}
              />
            </div>
            <div>
              <p className="text-sm font-medium mb-2 text-center">Etiqueta Manual</p>
              <LabelPreview 
                sku={customSku || 'NP-SCA-4'}
                qty={manualQty}
                lote={customLote}
                fecha={getCurrentDateString()}
              />
            </div>
          </div>
          
          <div className="mt-4 p-3 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-600">
              <strong>Formato QR/DataMatrix:</strong> SKU+FECHA+QTY+LOTE
            </p>
            <p className="text-xs text-blue-500 mt-1">
              Las etiquetas se imprimen en pares (2 por línea) automáticamente cada 20 cables OK
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Lote History */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de Lotes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Lote</th>
                  <th className="text-left p-2">SKU</th>
                  <th className="text-left p-2">Fecha</th>
                  <th className="text-left p-2">Operador</th>
                  <th className="text-left p-2">Buenos</th>
                  <th className="text-left p-2">Malos</th>
                  <th className="text-left p-2">Procesados</th>
                  <th className="text-left p-2">Eficiencia</th>
                </tr>
              </thead>
              <tbody>
                {loteDatabase.map((lote) => (
                  <tr key={`${lote.id}-${lote.sku}`} className="border-b hover:bg-gray-50">
                    <td className="p-2 font-mono">{lote.id}</td>
                    <td className="p-2 font-mono">{lote.sku}</td>
                    <td className="p-2">{lote.fecha}</td>
                    <td className="p-2">{lote.operador}</td>
                    <td className="p-2 text-green-600 font-medium">{lote.buenos}</td>
                    <td className="p-2 text-red-600 font-medium">{lote.malos}</td>
                    <td className="p-2">{lote.procesados}</td>
                    <td className="p-2">
                      <Badge variant={lote.procesados > 0 && (lote.buenos / lote.procesados) >= 0.9 ? "default" : "secondary"}>
                        {lote.procesados > 0 ? Math.round((lote.buenos / lote.procesados) * 100) : 0}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {loteDatabase.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No hay lotes registrados
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LabelGenerator;
