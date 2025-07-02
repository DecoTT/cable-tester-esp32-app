import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { AlertCircle } from 'lucide-react';
import { TestResult, Lote, Sku, CodigoGlobal } from '@/types';
import AppHeader from './AppHeader';
import NavigationTabs from './NavigationTabs';
import TestingTab from './TestingTab';
import TestResults from './TestResults';
import SkuDatabase from './SkuDatabase';
import CodigosDatabase from './CodigosDatabase';
import LabelGenerator from './LabelGenerator';
import LogsViewer from './LogsViewer';
import OperatorManager from './OperatorManager';
import AppFooter from './AppFooter';
import { ArduinoMessage, arduinoService, ArduinoTestResult } from '@/services/arduinoService';
import ArduinoMessagesPanel from './ArduinoMessagesPanel';

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
  const [codigosDatabase, setCodigosDatabase] = useState<CodigoGlobal[]>([]);
  const [loteDatabase, setLoteDatabase] = useState<Lote[]>([]);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [showNewSkuDialog, setShowNewSkuDialog] = useState(false);
  const [showNewCodigoDialog, setShowNewCodigoDialog] = useState(false);
  const [currentError, setCurrentError] = useState('');
  const [currentNewSku, setCurrentNewSku] = useState('');
  const [currentNewCodigo, setCurrentNewCodigo] = useState<CodigoGlobal | null>(null);
  const [tempSkuDescription, setTempSkuDescription] = useState('');
  const [tempCodigoDescription, setTempCodigoDescription] = useState('');
  const [tempCodigoNotas, setTempCodigoNotas] = useState('');
  const [activeTab, setActiveTab] = useState('testing');
  const [currentStandardPack, setCurrentStandardPack] = useState(10);
  const [serverConnected, setServerConnected] = useState(false);
  const [arduinoMessages, setArduinoMessages] = useState<ArduinoMessage[]>([]);
  const [realTimeProcessing, setRealTimeProcessing] = useState(true);

  useEffect(() => {
    const savedSkus = localStorage.getItem('quality_skus');
    const savedCodigos = localStorage.getItem('quality_codigos');
    const savedLotes = localStorage.getItem('quality_lotes');
    const savedResults = localStorage.getItem('quality_results_' + getCurrentDateString());
    const savedOperator = localStorage.getItem('current_operator');
    const savedLogFormat = localStorage.getItem('log_format');

    if (savedSkus) setSkuDatabase(JSON.parse(savedSkus));
    if (savedCodigos) setCodigosDatabase(JSON.parse(savedCodigos));
    if (savedLotes) setLoteDatabase(JSON.parse(savedLotes));
    if (savedResults) setTestResults(JSON.parse(savedResults));
    if (savedOperator) setCurrentOperator(savedOperator);
    if (savedLogFormat) setLogFormat(savedLogFormat as 'csv' | 'json' | 'txt');
  }, []);

  useEffect(() => {
    localStorage.setItem('quality_skus', JSON.stringify(skuDatabase));
  }, [skuDatabase]);

  useEffect(() => {
    localStorage.setItem('quality_codigos', JSON.stringify(codigosDatabase));
  }, [codigosDatabase]);

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

  useEffect(() => {
    if (currentSku) {
      const sku = skuDatabase.find(s => s.codigo === currentSku);
      if (sku) {
        setCurrentStandardPack(sku.standardPack || 10);
      } else {
        setCurrentStandardPack(10); // Default para SKUs nuevos
      }
    }
  }, [currentSku, skuDatabase]);

  useEffect(() => {
    // Inicializar conexión con el servidor Arduino Bridge
    const initializeArduinoService = async () => {
      try {
        await arduinoService.initializeSocket();
        setServerConnected(true);
        
        // Configurar listeners para CONTINUOS listening
        arduinoService.onTestResult(handleArduinoTestResult);
        arduinoService.onArduinoMessage(handleArduinoMessage);
        arduinoService.onArduinoInfo(handleArduinoInfo);
        arduinoService.onStatusChange(handleStatusChange);
        arduinoService.onConnectionLost(handleConnectionLost);
        
      } catch (error) {
        console.error('Error inicializando servicio Arduino:', error);
        setServerConnected(false);
      }
    };

    initializeArduinoService();

    return () => {
      arduinoService.disconnectSocket();
    };
  }, []);

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
    if (!serverConnected) {
      toast({
        title: "Error",
        description: "No hay conexión con el servidor Arduino Bridge",
        variant: "destructive"
      });
      return;
    }

    console.log('Intentando conectar con Arduino...');
    
    try {
      const result = await arduinoService.connectToArduino();
      if (result.success) {
        setIsConnected(true);
        toast({
          title: "Conexión establecida",
          description: result.message,
        });
      } else {
        toast({
          title: "Error de conexión",
          description: result.message,
          variant: "destructive"
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Error conectando a Arduino: " + (error as Error).message,
        variant: "destructive"
      });
    }
  };

  const disconnectArduino = async () => {
    try {
      const result = await arduinoService.disconnectArduino();
      setIsConnected(false);
      setIsTestRunning(false);
      toast({
        title: "Desconectado",
        description: result.message,
        variant: "destructive"
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Error desconectando Arduino: " + (error as Error).message,
        variant: "destructive"
      });
    }
  };

  const startTest = async () => {
    if (!currentSku || !currentOperator) {
      toast({
        title: "Error",
        description: "Debe especificar SKU y operador antes de iniciar la prueba",
        variant: "destructive"
      });
      return;
    }

    if (!serverConnected) {
      toast({
        title: "Error",
        description: "No hay conexión con el servidor Arduino Bridge",
        variant: "destructive"
      });
      return;
    }

    try {
      setIsTestRunning(true);
      setTestStartTime(new Date());
      
      const result = await arduinoService.startTest(currentSku, currentOperator);
      if (!result.success) {
        setIsTestRunning(false);
        setTestStartTime(null);
        toast({
          title: "Error",
          description: result.message,
          variant: "destructive"
        });
      }
    } catch (error) {
      setIsTestRunning(false);
      setTestStartTime(null);
      toast({
        title: "Error",
        description: "Error iniciando prueba: " + (error as Error).message,
        variant: "destructive"
      });
    }
  };

  const handleArduinoMessage = (message: ArduinoMessage) => {
    console.log('Mensaje Arduino recibido:', message);
    
    setArduinoMessages(prev => [...prev.slice(-99), message]); // Mantener últimos 100
    
    // Auto-actualizar SKU si el Arduino lo informa (solo si es diferente y no vacío)
    if (message.type === 'SKU' && message.content && message.content !== currentSku) {
      setCurrentSku(message.content);
      // Solo mostrar toast si es un cambio significativo, no al inicio
      if (currentSku) {
        toast({
          title: "SKU Auto-detectado",
          description: `SKU actualizado a: ${message.content}`,
        });
      }
    }
    
    // Auto-actualizar operador si el Arduino lo informa (solo si es diferente y no vacío)
    if (message.type === 'OPERATOR' && message.content && message.content !== currentOperator) {
      setCurrentOperator(message.content);
      // Solo mostrar toast si es un cambio significativo, no al inicio
      if (currentOperator && currentOperator !== 'Arduino') {
        toast({
          title: "Operador Auto-detectado",
          description: `Operador actualizado a: ${message.content}`,
        });
      }
    }
  };

  const handleArduinoInfo = (message: ArduinoMessage) => {
    console.log('Info Arduino:', message);
    // Mostrar notificaciones para mensajes importantes
    if (message.content.toLowerCase().includes('iniciando')) {
      toast({
        title: "Arduino",
        description: message.content,
      });
    }
  };

  const handleArduinoTestResult = (arduinoResult: ArduinoTestResult) => {
    // PROCESAMIENTO CONTINUO - No depende de isTestRunning
    if (!realTimeProcessing) return;
    
    console.log('Resultado de prueba recibido:', arduinoResult);
    
    const now = new Date();
    const startTime = testStartTime || new Date(now.getTime() - 2000); // Default 2 seg atrás si no hay inicio
    const duration = arduinoResult.duration || (now.getTime() - startTime.getTime()) / 1000;

    const newResult: TestResult = {
      id: Date.now().toString(),
      sku: currentSku || 'UNKNOWN',
      result: arduinoResult.result,
      startTime,
      endTime: now,
      duration,
      operator: currentOperator || 'Arduino',
      date: getCurrentDateString()
    };

    setTestResults(prev => [newResult, ...prev]);
    setTotalProcessed(prev => prev + 1);
    
    if (arduinoResult.result === 'OK') {
      setOkCount(prev => prev + 1);
    }

    // SIEMPRE resetear estado de prueba al recibir cualquier resultado
    setIsTestRunning(false);
    setTestStartTime(null);

    // Verificar si el SKU existe en la base de datos
    if (currentSku && !skuDatabase.find(sku => sku.codigo === currentSku)) {
      setCurrentNewSku(currentSku);
      setShowNewSkuDialog(true);
    }

    // Verificar si el código ya existe en la DB de códigos
    if (!codigosDatabase.find(codigo => codigo.codigo === arduinoResult.result)) {
      const newCodigo: CodigoGlobal = {
        codigo: arduinoResult.result,
        descripcion: '',
        notas: '',
        fechaCreacion: getCurrentDateString()
      };
      setCurrentNewCodigo(newCodigo);
      setCodigosDatabase(prev => [...prev, newCodigo]);
      
      if (arduinoResult.result !== 'OK') {
        setShowNewCodigoDialog(true);
      }
    }

    if (arduinoResult.result !== 'OK') {
      const codigoInfo = codigosDatabase.find(codigo => codigo.codigo === arduinoResult.result);
      if (codigoInfo) {
        setCurrentError(`Código: ${arduinoResult.result}\nDescripción: ${codigoInfo.descripcion}\nNotas: ${codigoInfo.notas}`);
      } else {
        setCurrentError(`Código detectado: ${arduinoResult.result}`);
      }
      setShowErrorDialog(true);
    }

    // Generar etiqueta automática cada N cables OK
    if (arduinoResult.result === 'OK' && (okCount + 1) % currentStandardPack === 0) {
      generateLabel();
    }
  };

  const handleStatusChange = (status: any) => {
    setIsConnected(status.connected);
  };

  const handleConnectionLost = (error: { error: string }) => {
    setIsConnected(false);
    setIsTestRunning(false);
    toast({
      title: "Conexión perdida",
      description: "Se perdió la conexión con Arduino: " + error.error,
      variant: "destructive"
    });
  };

  const handleNewSkuSave = () => {
    const newSku: Sku = {
      codigo: currentNewSku,
      descripcion: tempSkuDescription,
      fechaCreacion: getCurrentDateString(),
      standardPack: 10 // Default SP para SKUs nuevos
    };
    setSkuDatabase(prev => [...prev, newSku]);
    setCurrentStandardPack(10);
    setShowNewSkuDialog(false);
    setTempSkuDescription('');
    setCurrentNewSku('');
  };

  const handleNewCodigoSave = () => {
    if (currentNewCodigo) {
      setCodigosDatabase(prev => prev.map(codigo => 
        codigo.codigo === currentNewCodigo.codigo 
          ? { ...codigo, descripcion: tempCodigoDescription, notas: tempCodigoNotas }
          : codigo
      ));
    }
    setShowNewCodigoDialog(false);
    setTempCodigoDescription('');
    setTempCodigoNotas('');
    setCurrentNewCodigo(null);
  };

  const generateLabel = () => {
    toast({
      title: "Etiqueta generada",
      description: `Etiqueta automática para lote ${currentLote} - ${currentStandardPack} cables OK`,
    });
    
    const existingLote = loteDatabase.find(l => l.id === currentLote && l.sku === currentSku);
    
    if (existingLote) {
      setLoteDatabase(prev => prev.map(l => 
        l.id === currentLote && l.sku === currentSku 
          ? { ...l, cantidad: l.cantidad + currentStandardPack, buenos: l.buenos + currentStandardPack, procesados: totalProcessed }
          : l
      ));
    } else {
      const newLote: Lote = {
        id: currentLote,
        sku: currentSku,
        fecha: getCurrentDateString(),
        operador: currentOperator,
        cantidad: currentStandardPack,
        buenos: currentStandardPack,
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

  const handleSendArduinoCommand = async (command: string) => {
    try {
      const result = await arduinoService.sendCommand(command);
      if (result.success) {
        toast({
          title: "Comando enviado",
          description: `Comando: ${command}`,
        });
      } else {
        toast({
          title: "Error",
          description: result.message,
          variant: "destructive"
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Error enviando comando: " + (error as Error).message,
        variant: "destructive"
      });
    }
  };

  const clearArduinoMessages = () => {
    setArduinoMessages([]);
    toast({
      title: "Mensajes limpiados",
      description: "Se han eliminado todos los mensajes del Arduino",
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <AppHeader 
          isConnected={isConnected && serverConnected}
          onConnect={connectToArduino}
          onDisconnect={disconnectArduino}
        />

        <div className="bg-white rounded-lg shadow-lg">
          <NavigationTabs activeTab={activeTab} setActiveTab={setActiveTab} />

          <div className="p-6">
            {activeTab === 'testing' && (
              <div className="space-y-6">
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
                  standardPack={currentStandardPack}
                />
                
                {/* Panel de Mensajes del Arduino en tiempo real */}
                <ArduinoMessagesPanel
                  messages={arduinoMessages}
                  isConnected={isConnected && serverConnected}
                  onSendCommand={handleSendArduinoCommand}
                  onClearMessages={clearArduinoMessages}
                />
              </div>
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

            {activeTab === 'codigos' && (
              <CodigosDatabase 
                codigos={codigosDatabase} 
                setCodigos={setCodigosDatabase}
                currentOperator={currentOperator}
              />
            )}

            {activeTab === 'labels' && (
              <LabelGenerator 
                currentSku={currentSku}
                currentLote={currentLote}
                okCount={okCount}
                loteDatabase={loteDatabase}
                standardPack={currentStandardPack}
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
                <span>Información del Código</span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <pre className="whitespace-pre-wrap">{currentError}</pre>
                </AlertDescription>
              </Alert>
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

        <Dialog open={showNewSkuDialog} onOpenChange={setShowNewSkuDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nuevo SKU Detectado</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p>Se ha detectado un nuevo SKU: <strong>{currentNewSku}</strong></p>
              <div>
                <label className="block text-sm font-medium mb-2">Descripción (opcional)</label>
                <Input
                  value={tempSkuDescription}
                  onChange={(e) => setTempSkuDescription(e.target.value)}
                  placeholder="Descripción del SKU"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => {
                  handleNewSkuSave();
                }}>
                  Guardar sin descripción
                </Button>
                <Button onClick={handleNewSkuSave}>
                  Guardar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showNewCodigoDialog} onOpenChange={setShowNewCodigoDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nuevo Código Detectado</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p>Se ha detectado un nuevo código: <strong>{currentNewCodigo?.codigo}</strong></p>
              <div>
                <label className="block text-sm font-medium mb-2">Descripción</label>
                <Input
                  value={tempCodigoDescription}
                  onChange={(e) => setTempCodigoDescription(e.target.value)}
                  placeholder="Descripción del código"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Notas</label>
                <Textarea
                  value={tempCodigoNotas}
                  onChange={(e) => setTempCodigoNotas(e.target.value)}
                  placeholder="Notas adicionales"
                  rows={3}
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => {
                  handleNewCodigoSave();
                }}>
                  Guardar sin información
                </Button>
                <Button onClick={handleNewCodigoSave}>
                  Guardar
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
