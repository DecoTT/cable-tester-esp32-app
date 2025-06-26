
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { User, Clock, UserCheck, Activity } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { TestResult } from '@/types';

interface OperatorManagerProps {
  currentOperator: string;
  setCurrentOperator: (operator: string) => void;
  results: TestResult[];
}

const OperatorManager: React.FC<OperatorManagerProps> = ({ 
  currentOperator, 
  setCurrentOperator, 
  results 
}) => {
  const [newOperatorName, setNewOperatorName] = useState('');
  const [isChangeDialogOpen, setIsChangeDialogOpen] = useState(false);

  const getCurrentDateString = () => {
    const now = new Date();
    return now.getFullYear().toString() + 
           (now.getMonth() + 1).toString().padStart(2, '0') + 
           now.getDate().toString().padStart(2, '0');
  };

  const handleOperatorChange = () => {
    if (!newOperatorName.trim()) {
      toast({
        title: "Error",
        description: "El nombre del operador es obligatorio",
        variant: "destructive"
      });
      return;
    }

    const oldOperator = currentOperator;
    setCurrentOperator(newOperatorName.trim());
    setNewOperatorName('');
    setIsChangeDialogOpen(false);

    // Log del cambio de operador
    const changeLog = {
      timestamp: new Date().toISOString(),
      oldOperator,
      newOperator: newOperatorName.trim(),
      date: getCurrentDateString()
    };
    
    const existingChanges = JSON.parse(localStorage.getItem('operator_changes') || '[]');
    existingChanges.push(changeLog);
    localStorage.setItem('operator_changes', JSON.stringify(existingChanges));

    toast({
      title: "Operador cambiado",
      description: `Operador cambiado de "${oldOperator}" a "${newOperatorName.trim()}"`,
    });
  };

  const getOperatorStats = () => {
    const allOperators = [...new Set(results.map(r => r.operator))].filter(op => op);
    
    return allOperators.map(operator => {
      const operatorResults = results.filter(r => r.operator === operator);
      const todayResults = operatorResults.filter(r => r.date === getCurrentDateString());
      const okCount = operatorResults.filter(r => r.result === 'OK').length;
      const totalCount = operatorResults.length;
      const efficiency = totalCount > 0 ? Math.round((okCount / totalCount) * 100) : 0;
      const avgDuration = totalCount > 0 
        ? (operatorResults.reduce((sum, r) => sum + r.duration, 0) / totalCount).toFixed(2)
        : '0';

      return {
        name: operator,
        totalTests: totalCount,
        todayTests: todayResults.length,
        okCount,
        efficiency,
        avgDuration: parseFloat(avgDuration)
      };
    });
  };

  const getOperatorChanges = () => {
    const changes = JSON.parse(localStorage.getItem('operator_changes') || '[]');
    return changes.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  };

  const getCurrentShiftInfo = () => {
    const todayResults = results.filter(r => r.date === getCurrentDateString() && r.operator === currentOperator);
    const okCount = todayResults.filter(r => r.result === 'OK').length;
    const totalCount = todayResults.length;
    const efficiency = totalCount > 0 ? Math.round((okCount / totalCount) * 100) : 0;
    
    const firstTest = todayResults.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0];
    const lastTest = todayResults.sort((a, b) => b.startTime.getTime() - a.startTime.getTime())[0];
    
    const shiftStart = firstTest ? firstTest.startTime.toLocaleTimeString() : 'No iniciado';
    const shiftEnd = lastTest ? lastTest.startTime.toLocaleTimeString() : 'En progreso';

    return {
      shiftStart,
      shiftEnd,
      totalTests: totalCount,
      okCount,
      efficiency
    };
  };

  const operatorStats = getOperatorStats();
  const operatorChanges = getOperatorChanges();
  const currentShift = getCurrentShiftInfo();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Gestión de Operadores</h2>
          <p className="text-gray-600">Control de operador actual y historial de cambios</p>
        </div>
        
        <Dialog open={isChangeDialogOpen} onOpenChange={setIsChangeDialogOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center space-x-2">
              <User className="w-4 h-4" />
              <span>Cambiar Operador</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cambiar Operador</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Operador Actual</label>
                <Input
                  value={currentOperator}
                  disabled
                  className="mt-1 bg-gray-100"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Nuevo Operador</label>
                <Input
                  value={newOperatorName}
                  onChange={(e) => setNewOperatorName(e.target.value)}
                  placeholder="Nombre del nuevo operador"
                  className="mt-1"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setIsChangeDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleOperatorChange}>
                  Cambiar Operador
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Current Operator */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <UserCheck className="w-5 h-5" />
            <span>Operador Actual</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Nombre</p>
                <p className="text-2xl font-bold text-blue-600">
                  {currentOperator || 'Sin asignar'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Fecha</p>
                <p className="text-lg font-medium">
                  {getCurrentDateString()}
                </p>
              </div>
            </div>
            
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Inicio del turno</p>
                <p className="text-lg font-medium">
                  {currentShift.shiftStart}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Última actividad</p>
                <p className="text-lg font-medium">
                  {currentShift.shiftEnd}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current Shift Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Activity className="w-8 h-8 text-blue-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Pruebas Hoy</p>
                <p className="text-2xl font-bold text-blue-600">{currentShift.totalTests}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <UserCheck className="w-8 h-8 text-green-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Pruebas OK</p>
                <p className="text-2xl font-bold text-green-600">{currentShift.okCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Clock className="w-8 h-8 text-purple-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Eficiencia</p>
                <p className="text-2xl font-bold text-purple-600">{currentShift.efficiency}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <User className="w-8 h-8 text-yellow-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Estado</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {currentOperator ? 'Activo' : 'Inactivo'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Operator Statistics */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Activity className="w-5 h-5" />
              <span>Estadísticas por Operador</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {operatorStats.map((operator) => (
                <div key={operator.name} className="p-4 border rounded-lg">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-medium">{operator.name}</h3>
                    <Badge variant={operator.name === currentOperator ? "default" : "outline"}>
                      {operator.name === currentOperator ? 'Actual' : 'Anterior'}
                    </Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Total pruebas</p>
                      <p className="font-medium">{operator.totalTests}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Pruebas hoy</p>
                      <p className="font-medium">{operator.todayTests}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Eficiencia</p>
                      <p className="font-medium">{operator.efficiency}%</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Tiempo promedio</p>
                      <p className="font-medium">{operator.avgDuration}s</p>
                    </div>
                  </div>
                </div>
              ))}
              
              {operatorStats.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No hay estadísticas de operadores disponibles
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Operator Changes Log */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Clock className="w-5 h-5" />
              <span>Historial de Cambios</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {operatorChanges.map((change: any, index: number) => (
                <div key={index} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm">
                        <span className="font-medium">{change.oldOperator || 'Sin operador'}</span>
                        <span className="text-gray-500"> → </span>
                        <span className="font-medium">{change.newOperator}</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(change.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {change.date}
                    </Badge>
                  </div>
                </div>
              ))}
              
              {operatorChanges.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No hay cambios de operador registrados
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default OperatorManager;
