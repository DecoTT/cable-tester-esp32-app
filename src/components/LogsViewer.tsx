
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Download, FileText, Calendar, Clock } from 'lucide-react';
import { TestResult } from '@/types';

interface LogsViewerProps {
  results: TestResult[];
  logFormat: 'csv' | 'json' | 'txt';
  setLogFormat: (format: 'csv' | 'json' | 'txt') => void;
  onExport: () => void;
}

const LogsViewer: React.FC<LogsViewerProps> = ({ 
  results, 
  logFormat, 
  setLogFormat, 
  onExport 
}) => {
  const getCurrentDateString = () => {
    const now = new Date();
    return now.getFullYear().toString() + 
           (now.getMonth() + 1).toString().padStart(2, '0') + 
           now.getDate().toString().padStart(2, '0');
  };

  const todayResults = results.filter(r => r.date === getCurrentDateString());
  const weekResults = results.filter(r => {
    const resultDate = new Date(
      parseInt(r.date.substring(0, 4)),
      parseInt(r.date.substring(4, 6)) - 1,
      parseInt(r.date.substring(6, 8))
    );
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return resultDate >= weekAgo;
  });

  const getLogPreview = () => {
    const sampleResults = todayResults.slice(0, 5);
    
    switch (logFormat) {
      case 'csv':
        return 'SKU,Resultado,Inicio,Fin,Duracion,Operador,Fecha\n' +
               sampleResults.map(r => 
                 `${r.sku},${r.result},${r.startTime.toLocaleTimeString()},${r.endTime.toLocaleTimeString()},${r.duration}s,${r.operator},${r.date}`
               ).join('\n') +
               (sampleResults.length < todayResults.length ? '\n...' : '');
      
      case 'json':
        return JSON.stringify(sampleResults, null, 2) + 
               (sampleResults.length < todayResults.length ? '\n...' : '');
      
      case 'txt':
        return sampleResults.map(r => 
          `${r.date} ${r.startTime.toLocaleTimeString()} - SKU: ${r.sku} | Resultado: ${r.result} | Duración: ${r.duration}s | Operador: ${r.operator}`
        ).join('\n') +
        (sampleResults.length < todayResults.length ? '\n...' : '');
      
      default:
        return '';
    }
  };

  const getUniqueOperators = () => {
    const operators = [...new Set(results.map(r => r.operator))];
    return operators.filter(op => op);
  };

  const getOperatorChanges = () => {
    const changes = [];
    let currentOperator = '';
    
    for (const result of results.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())) {
      if (result.operator !== currentOperator) {
        changes.push({
          operator: result.operator,
          time: result.startTime,
          date: result.date
        });
        currentOperator = result.operator;
      }
    }
    
    return changes;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Visor de Logs</h2>
          <p className="text-gray-600">Exportación y visualización de logs por día</p>
        </div>
        
        <div className="flex items-center space-x-4">
          <Select value={logFormat} onValueChange={(value: 'csv' | 'json' | 'txt') => setLogFormat(value)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
              <SelectItem value="txt">TXT</SelectItem>
            </SelectContent>
          </Select>
          
          <Button onClick={onExport} className="flex items-center space-x-2">
            <Download className="w-4 h-4" />
            <span>Exportar Log</span>
          </Button>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Calendar className="w-8 h-8 text-blue-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Registros Hoy</p>
                <p className="text-2xl font-bold text-blue-600">{todayResults.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Clock className="w-8 h-8 text-green-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Esta Semana</p>
                <p className="text-2xl font-bold text-green-600">{weekResults.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <FileText className="w-8 h-8 text-purple-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Registros</p>
                <p className="text-2xl font-bold text-purple-600">{results.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Download className="w-8 h-8 text-yellow-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Formato</p>
                <p className="text-2xl font-bold text-yellow-600">{logFormat.toUpperCase()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Log Preview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <FileText className="w-5 h-5" />
              <span>Vista Previa del Log ({logFormat.toUpperCase()})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-xs overflow-x-auto">
              <pre>{getLogPreview() || 'No hay datos para mostrar'}</pre>
            </div>
            <div className="mt-4 text-sm text-gray-600">
              <p>Archivo: quality_log_{getCurrentDateString()}.{logFormat}</p>
              <p>Registros de hoy: {todayResults.length}</p>
            </div>
          </CardContent>
        </Card>

        {/* Operator Changes */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Clock className="w-5 h-5" />
              <span>Cambios de Operador</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {getOperatorChanges().map((change, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium">{change.operator}</p>
                    <p className="text-sm text-gray-600">
                      {change.time.toLocaleString()}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {change.date}
                  </Badge>
                </div>
              ))}
              
              {getOperatorChanges().length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No hay cambios de operador registrados
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Daily Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Resumen por Día</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Fecha</th>
                  <th className="text-left p-2">Total Pruebas</th>
                  <th className="text-left p-2">OK</th>
                  <th className="text-left p-2">Errores</th>
                  <th className="text-left p-2">Críticos</th>
                  <th className="text-left p-2">Eficiencia</th>
                  <th className="text-left p-2">Operadores</th>
                </tr>
              </thead>
              <tbody>
                {[...new Set(results.map(r => r.date))].sort().reverse().map((date) => {
                  const dayResults = results.filter(r => r.date === date);
                  const okCount = dayResults.filter(r => r.result === 'OK').length;
                  const errorCount = dayResults.filter(r => r.result !== 'OK' && r.result !== 'Critico').length;
                  const criticalCount = dayResults.filter(r => r.result === 'Critico').length;
                  const efficiency = dayResults.length > 0 ? Math.round((okCount / dayResults.length) * 100) : 0;
                  const operators = [...new Set(dayResults.map(r => r.operator))];
                  
                  return (
                    <tr key={date} className="border-b hover:bg-gray-50">
                      <td className="p-2 font-mono">{date}</td>
                      <td className="p-2">{dayResults.length}</td>
                      <td className="p-2 text-green-600 font-medium">{okCount}</td>
                      <td className="p-2 text-yellow-600 font-medium">{errorCount}</td>
                      <td className="p-2 text-red-600 font-medium">{criticalCount}</td>
                      <td className="p-2">
                        <Badge variant={efficiency >= 90 ? "default" : efficiency >= 70 ? "secondary" : "destructive"}>
                          {efficiency}%
                        </Badge>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {operators.map(op => (
                            <Badge key={op} variant="outline" className="text-xs">
                              {op}
                            </Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            
            {results.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No hay datos de logs disponibles
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LogsViewer;
