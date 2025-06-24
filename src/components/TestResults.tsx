
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, AlertTriangle, Clock } from 'lucide-react';

interface TestResult {
  id: string;
  sku: string;
  result: 'OK' | 'Error 1' | 'Critico' | 'Error 2' | 'Error 3';
  startTime: Date;
  endTime: Date;
  duration: number;
  operator: string;
  date: string;
}

interface TestResultsProps {
  results: TestResult[];
}

const TestResults: React.FC<TestResultsProps> = ({ results }) => {
  const getResultIcon = (result: string) => {
    switch (result) {
      case 'OK':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'Critico':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    }
  };

  const getResultBadgeVariant = (result: string) => {
    switch (result) {
      case 'OK':
        return 'default';
      case 'Critico':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  const todayResults = results.filter(r => {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    return r.date === today;
  });

  const okCount = todayResults.filter(r => r.result === 'OK').length;
  const errorCount = todayResults.filter(r => r.result !== 'OK').length;
  const avgDuration = todayResults.length > 0 
    ? (todayResults.reduce((sum, r) => sum + r.duration, 0) / todayResults.length).toFixed(2)
    : '0';

  return (
    <div className="space-y-6">
      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <CheckCircle className="w-8 h-8 text-green-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Pruebas OK Hoy</p>
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
                <p className="text-sm font-medium text-gray-600">Errores Hoy</p>
                <p className="text-2xl font-bold text-red-600">{errorCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Clock className="w-8 h-8 text-blue-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Tiempo Promedio</p>
                <p className="text-2xl font-bold text-blue-600">{avgDuration}s</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <AlertTriangle className="w-8 h-8 text-yellow-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Eficiencia</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {todayResults.length > 0 ? Math.round((okCount / todayResults.length) * 100) : 0}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results Table */}
      <Card>
        <CardHeader>
          <CardTitle>Resultados de Pruebas Recientes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Hora</th>
                  <th className="text-left p-2">SKU</th>
                  <th className="text-left p-2">Resultado</th>
                  <th className="text-left p-2">Duración</th>
                  <th className="text-left p-2">Operador</th>
                  <th className="text-left p-2">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {results.slice(0, 20).map((result) => (
                  <tr key={result.id} className="border-b hover:bg-gray-50">
                    <td className="p-2">
                      {result.startTime.toLocaleTimeString()}
                    </td>
                    <td className="p-2 font-mono">{result.sku}</td>
                    <td className="p-2">
                      <Badge variant={getResultBadgeVariant(result.result)} className="flex items-center space-x-1 w-fit">
                        {getResultIcon(result.result)}
                        <span>{result.result}</span>
                      </Badge>
                    </td>
                    <td className="p-2">{result.duration.toFixed(2)}s</td>
                    <td className="p-2">{result.operator}</td>
                    <td className="p-2">{result.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {results.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No hay resultados de pruebas disponibles
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TestResults;
