import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { AlertCircle } from 'lucide-react';
import AppHeader from './AppHeader';
import NavigationTabs from './NavigationTabs';
import TestingTab from './TestingTab';
import TestResults from './TestResults';
import SkuDatabase from './SkuDatabase';
import LabelGenerator from './LabelGenerator';
import LogsViewer from './LogsViewer';
import OperatorManager from './OperatorManager';
import AppFooter from './AppFooter';

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

interface Lote {
  id: string;
  sku: string;
  fecha: string;
  operador: string;
  cantidad: number;
  buenos: number;
  malos: number;
  procesados: number;
}

interface Sku {
  codigo: string;
  descripcion: string;
  fechaCreacion: string;
}

const QualityApp = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [currentSku, setCurrentSku] = useState('');
  const [currentOperator, setCurrentOperator] = useState('');
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [testStartTime, setTestStartTime] = useState<Date | null>(null);
  const [okCount, setOkCount] = useState(0);
  const [totalProcessed, setTotalProcessed] = useState(0);
  const [currentLote, setCurrentLote] = useState('0001');
  const [logFormat, setLogFormat] = useState<'csv' | 'json' | 'txt'>('csv');
  const [skuDatabase, setSkuDatabase] = useState<Sku[]>([]);
  const [loteDatabase, setLoteDatabase] = useState<Lote[]>([]);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [currentError, setCurrentError] = useState('');
  const [activeTab, setActiveTab] = useState('testing');

  // Cargar datos del localStorage al iniciar
  useEffect(() => {
    const savedSkus = localStorage.getItem('quality_skus');
    const savedLotes = localStorage.getItem('quality_lotes');
    const savedResults = localStorage.getItem('quality_results_' + getCurrentDateString());
    const savedOperator = localStorage.getItem('current_operator');
    const savedLogFormat = localStorage.getItem('log_format');

    if (savedSkus) setSkuDatabase(JSON.parse(savedSkus));
    if (savedLotes) setLoteDatabase(JSON.parse(savedLotes));
    if (savedResults) setTestResults(JSON.parse(savedResults));
    if (savedOperator) setCurrentOperator(savedOperator);
    if (savedLogFormat) setLogFormat(savedLogFormat as 'csv' | 'json' | 'txt');
  }, []);

  // Guardar datos en localStorage cuando cambien
  useEffect(() => {
    localStorage.setItem('quality_skus', JSON.stringify(skuDatabase));
  }, [skuDatabase]);

  useEffect(() => {
    localStorage.setItem('quality_lotes', JSON.stringify(loteDatabase));
  }, [loteDatabase]);

  useEffect(() => {
    localStorage.setItem('quality_results_' + getCurrentDateString(), JSON.stringify(testResults));
  }, [testResults]);

  useEffect(() => {
    if (currentOperator) {
      localStorage.setItem('current_operator', currentOperator);
    }
  }, [currentOperator]);

  useEffect(() => {
    localStorage.setItem('log_format', logFormat);
  }, [logFormat]);

  const getCurrentDateString = () => {
    const now = new Date();
    return now.getFullYear().toString() + 
           (now.getMonth() + 1).toString().padStart(2, '0') + 
           now.getDate().toString().padStart(2, '0');
  };

  const getCurrentTimeString = () => {
    const now = new Date();
    return now.getHours().toString().padStart(2, '0') + ':' + 
           now.getMinutes().toString().padStart(2, '0') + ':' + 
           now.getSeconds().toString().padStart(2, '0');
  };

  const connectToArduino = async () => {
    console.log('Intentando conectar con Arduino...');
    
    setTimeout(() => {
      setIsConnected(true);
      toast({
        title: "Conexión establecida",
        description: "Arduino conectado correctamente",
      });
    }, 1500);
  };

  const disconnectArduino = () => {
    setIsConnected(false);
    setIsTestRunning(false);
    toast({
      title: "Desconectado",
      description: "Arduino desconectado",
      variant: "destructive"
    });
  };

  const startTest = () => {
    if (!currentSku || !currentOperator) {
      toast({
        title: "Error",
        description: "Debe especificar SKU y operador antes de iniciar la prueba",
        variant: "destructive"
      });
      return;
    }

    setIsTestRunning(true);
    setTestStartTime(new Date());
    
    simulateArduinoTest();
  };

  const simulateArduinoTest = () => {
    const testDuration = Math.random() * 3000 + 1000;
    
    setTimeout(() => {
      const results = ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'Error 1', 'Critico'];
      const randomResult = results[Math.floor(Math.random() * results.length)] as TestResult['result'];
      
      if (randomResult !== 'OK') {
        setCurrentError(`Error detectado: ${randomResult}`);
        setShowErrorDialog(true);
      }
      
      completeTest(randomResult);
    }, testDuration);
  };

  const completeTest = (result: TestResult['result']) => {
    if (!testStartTime) return;

    const endTime = new Date();
    const duration = (endTime.getTime() - testStartTime.getTime()) / 1000;

    const newResult: TestResult = {
      id: Date.now().toString(),
      sku: currentSku,
      result,
      startTime: testStartTime,
      endTime,
      duration,
      operator: currentOperator,
      date: getCurrentDateString()
    };

    setTestResults(prev => [newResult, ...prev]);
    setTotalProcessed(prev => prev + 1);
    
    if (result === 'OK') {
      setOkCount(prev => prev + 1);
    }

    setIsTestRunning(false);
    setTestStartTime(null);

    if (!skuDatabase.find(sku => sku.codigo === currentSku)) {
      const newSku: Sku = {
        codigo: currentSku,
        descripcion: '',
        fechaCreacion: getCurrentDateString()
      };
      setSkuDatabase(prev => [...prev, newSku]);
    }

    if (result === 'OK' && (okCount + 1) % 10 === 0) {
      generateLabel();
    }
  };

  const generateLabel = () => {
    toast({
      title: "Etiqueta generada",
      description: `Etiqueta automática para lote ${currentLote} - 10 cables OK`,
    });
    
    const existingLote = loteDatabase.find(l => l.id === currentLote && l.sku === currentSku);
    
    if (existingLote) {
      setLoteDatabase(prev => prev.map(l => 
        l.id === currentLote && l.sku === currentSku 
          ? { ...l, cantidad: l.cantidad + 10, buenos: l.buenos + 10, procesados: totalProcessed }
          : l
      ));
    } else {
      const newLote: Lote = {
        id: currentLote,
        sku: currentSku,
        fecha: getCurrentDateString(),
        operador: currentOperator,
        cantidad: 10,
        buenos: 10,
        malos: totalProcessed - okCount,
        procesados: totalProcessed
      };
      setLoteDatabase(prev => [...prev, newLote]);
    }
  };

  const exportLogs = () => {
    const today = getCurrentDateString();
    const todayResults = testResults.filter(r => r.date === today);
    
    let content = '';
    let filename = '';
    
    switch (logFormat) {
      case 'csv':
        content = 'SKU,Resultado,Inicio,Fin,Duracion,Operador,Fecha\n' +
                 todayResults.map(r => 
                   `${r.sku},${r.result},${r.startTime.toLocaleTimeString()},${r.endTime.toLocaleTimeString()},${r.duration}s,${r.operator},${r.date}`
                 ).join('\n');
        filename = `quality_log_${today}.csv`;
        break;
      case 'json':
        content = JSON.stringify(todayResults, null, 2);
        filename = `quality_log_${today}.json`;
        break;
      case 'txt':
        content = todayResults.map(r => 
          `${r.date} ${r.startTime.toLocaleTimeString()} - SKU: ${r.sku} | Resultado: ${r.result} | Duración: ${r.duration}s | Operador: ${r.operator}`
        ).join('\n');
        filename = `quality_log_${today}.txt`;
        break;
    }
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    
    toast({
      title: "Log exportado",
      description: `Archivo ${filename} descargado`,
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <AppHeader 
          isConnected={isConnected}
          onConnect={connectToArduino}
          onDisconnect={disconnectArduino}
        />

        <div className="bg-white rounded-lg shadow-lg">
          <NavigationTabs activeTab={activeTab} setActiveTab={setActiveTab} />

          <div className="p-6">
            {activeTab === 'testing' && (
              <TestingTab
                currentSku={currentSku}
                setCurrentSku={setCurrentSku}
                currentOperator={currentOperator}
                setCurrentOperator={setCurrentOperator}
                currentLote={currentLote}
                isConnected={isConnected}
                isTestRunning={isTestRunning}
                onStartTest={startTest}
                okCount={okCount}
                totalProcessed={totalProcessed}
                getCurrentDateString={getCurrentDateString}
                getCurrentTimeString={getCurrentTimeString}
              />
            )}

            {activeTab === 'results' && (
              <TestResults results={testResults} />
            )}

            {activeTab === 'skus' && (
              <SkuDatabase 
                skus={skuDatabase} 
                setSkus={setSkuDatabase}
                currentOperator={currentOperator}
              />
            )}

            {activeTab === 'labels' && (
              <LabelGenerator 
                currentSku={currentSku}
                currentLote={currentLote}
                okCount={okCount}
                loteDatabase={loteDatabase}
              />
            )}

            {activeTab === 'logs' && (
              <LogsViewer 
                results={testResults}
                logFormat={logFormat}
                setLogFormat={setLogFormat}
                onExport={exportLogs}
              />
            )}

            {activeTab === 'operator' && (
              <OperatorManager 
                currentOperator={currentOperator}
                setCurrentOperator={setCurrentOperator}
                results={testResults}
              />
            )}
          </div>
        </div>

        <Dialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center space-x-2 text-red-600">
                <AlertCircle className="w-5 h-5" />
                <span>Error en la Prueba</span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {currentError}
                </AlertDescription>
              </Alert>
              <p className="text-sm text-gray-600">
                El cable no pasó la prueba. Verifique la conexión y vuelva a intentar.
              </p>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setShowErrorDialog(false)}>
                  Cerrar
                </Button>
                <Button onClick={() => {
                  setShowErrorDialog(false);
                  startTest();
                }}>
                  Reintentar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <AppFooter />
      </div>
    </div>
  );
};

export default QualityApp;
