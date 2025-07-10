
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Download, 
  Database, 
  FileText, 
  Calendar, 
  RefreshCw, 
  AlertCircle,
  HardDrive,
  Clock
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { fileService } from '@/services/fileService';

interface FileManagerProps {
  skuDatabase: any[];
  codigosDatabase: any[];
  loteDatabase: any[];
  onDatabaseSync?: () => void;
}

const FileManager: React.FC<FileManagerProps> = ({
  skuDatabase,
  codigosDatabase,
  loteDatabase,
  onDatabaseSync
}) => {
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [logData, setLogData] = useState<any>({});
  const [isLoading, setIsLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');

  useEffect(() => {
    loadAvailableDates();
  }, []);

  const loadAvailableDates = async () => {
    const result = await fileService.getAvailableLogDates();
    if (result.success) {
      setAvailableDates(result.dates);
      if (result.dates.length > 0) {
        setSelectedDate(result.dates[0]);
      }
    }
  };

  const loadLogsForDate = async (date: string) => {
    if (!date) return;
    
    setIsLoading(true);
    const result = await fileService.getLogsForDate(date);
    if (result.success) {
      setLogData(result.files);
    } else {
      setLogData({});
      toast({
        title: "Error",
        description: "Error cargando logs para la fecha seleccionada",
        variant: "destructive"
      });
    }
    setIsLoading(false);
  };

  const syncAllDatabases = async () => {
    setSyncStatus('syncing');
    
    try {
      const [skuResult, codigosResult, lotesResult] = await Promise.all([
        fileService.syncSkuDatabase(skuDatabase),
        fileService.syncCodigosDatabase(codigosDatabase),
        fileService.syncLotesDatabase(loteDatabase)
      ]);

      if (skuResult.success && codigosResult.success && lotesResult.success) {
        setSyncStatus('success');
        toast({
          title: "Sincronización exitosa",
          description: "Todas las bases de datos han sido sincronizadas con el servidor",
        });
        onDatabaseSync?.();
      } else {
        setSyncStatus('error');
        toast({
          title: "Error de sincronización",
          description: "Hubo un error al sincronizar algunas bases de datos",
          variant: "destructive"
        });
      }
    } catch (error) {
      setSyncStatus('error');
      toast({
        title: "Error",
        description: "Error durante la sincronización: " + (error as Error).message,
        variant: "destructive"
      });
    }

    setTimeout(() => setSyncStatus('idle'), 3000);
  };

  const downloadFile = (content: string, filename: string, type: string = 'text/plain') => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportDateRange = async () => {
    if (availableDates.length < 2) {
      toast({
        title: "Insuficientes datos",
        description: "Se necesitan al menos 2 fechas con logs para exportar un rango",
        variant: "destructive"
      });
      return;
    }

    const startDate = availableDates[availableDates.length - 1];
    const endDate = availableDates[0];
    
    setIsLoading(true);
    const result = await fileService.exportLogs(startDate, endDate, ['system', 'tests', 'labels']);
    
    if (result.success) {
      const exportContent = JSON.stringify(result.data, null, 2);
      downloadFile(exportContent, `logs_export_${startDate}_to_${endDate}.json`, 'application/json');
      
      toast({
        title: "Exportación exitosa",
        description: `Logs exportados desde ${startDate} hasta ${endDate}`,
      });
    } else {
      toast({
        title: "Error de exportación",
        description: result.message || "Error exportando logs",
        variant: "destructive"
      });
    }
    setIsLoading(false);
  };

  const formatDate = (dateStr: string) => {
    if (dateStr.length !== 8) return dateStr;
    return `${dateStr.substring(6, 8)}/${dateStr.substring(4, 6)}/${dateStr.substring(0, 4)}`;
  };

  const getSyncStatusBadge = () => {
    switch (syncStatus) {
      case 'syncing':
        return <Badge variant="secondary">Sincronizando...</Badge>;
      case 'success':
        return <Badge variant="default">Sincronizado ✓</Badge>;
      case 'error':
        return <Badge variant="destructive">Error ✗</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Administrador de Archivos</h2>
          <p className="text-gray-600">Gestión de bases de datos y logs del sistema</p>
        </div>
        
        <div className="flex items-center space-x-4">
          {getSyncStatusBadge()}
          <Button 
            onClick={syncAllDatabases} 
            disabled={syncStatus === 'syncing'}
            className="flex items-center space-x-2"
          >
            <RefreshCw className={`w-4 h-4 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
            <span>Sincronizar BD</span>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="databases" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="databases">Bases de Datos</TabsTrigger>
          <TabsTrigger value="logs">Logs del Sistema</TabsTrigger>
          <TabsTrigger value="statistics">Estadísticas</TabsTrigger>
        </TabsList>

        <TabsContent value="databases" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">SKUs</CardTitle>
                <Database className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{skuDatabase.length}</div>
                <p className="text-xs text-muted-foreground">
                  Códigos registrados
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Códigos</CardTitle>
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{codigosDatabase.length}</div>
                <p className="text-xs text-muted-foreground">
                  Códigos de error/estado
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Lotes</CardTitle>
                <HardDrive className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{loteDatabase.length}</div>
                <p className="text-xs text-muted-foreground">
                  Lotes registrados
                </p>
              </CardContent>
            </Card>
          </div>

          <Alert>
            <Database className="h-4 w-4" />
            <AlertDescription>
              Las bases de datos se sincronizan automáticamente con el servidor Arduino Bridge. 
              Use el botón "Sincronizar BD" para forzar una sincronización manual.
            </AlertDescription>
          </Alert>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <div className="flex items-center space-x-4">
            <Select value={selectedDate} onValueChange={(value) => {
              setSelectedDate(value);
              loadLogsForDate(value);
            }}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Seleccionar fecha" />
              </SelectTrigger>
              <SelectContent>
                {availableDates.map(date => (
                  <SelectItem key={date} value={date}>
                    {formatDate(date)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button onClick={() => loadLogsForDate(selectedDate)} disabled={isLoading}>
              <Calendar className="w-4 h-4 mr-2" />
              Cargar Logs
            </Button>

            <Button onClick={exportDateRange} disabled={isLoading || availableDates.length < 2}>
              <Download className="w-4 h-4 mr-2" />
              Exportar Rango
            </Button>
          </div>

          {selectedDate && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* System Logs */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Clock className="w-5 h-5" />
                    <span>Logs del Sistema</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {logData.system ? (
                    <div>
                      <p className="text-sm text-gray-600 mb-2">
                        {logData.system.length} eventos registrados
                      </p>
                      <div className="max-h-40 overflow-y-auto bg-gray-50 p-2 rounded text-xs">
                        {logData.system.slice(-10).map((log: any, index: number) => (
                          <div key={index} className="mb-1">
                            <span className="font-mono text-blue-600">{log.timestamp.substring(11, 19)}</span>
                            <span className="ml-2 font-medium">{log.type}</span>
                            <span className="ml-2 text-gray-700">{log.message}</span>
                          </div>
                        ))}
                      </div>
                      <Button 
                        size="sm" 
                        className="mt-2 w-full"
                        onClick={() => downloadFile(
                          JSON.stringify(logData.system, null, 2),
                          `${selectedDate}_system.json`,
                          'application/json'
                        )}
                      >
                        <Download className="w-3 h-3 mr-1" />
                        Descargar
                      </Button>
                    </div>
                  ) : (
                    <p className="text-gray-500">No hay logs del sistema para esta fecha</p>
                  )}
                </CardContent>
              </Card>

              {/* Test Logs */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <FileText className="w-5 h-5" />
                    <span>Logs de Pruebas</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {logData.tests ? (
                    <div>
                      <p className="text-sm text-gray-600 mb-2">
                        {logData.tests.split('\n').length - 1} pruebas registradas
                      </p>
                      <div className="max-h-40 overflow-y-auto bg-gray-50 p-2 rounded text-xs font-mono">
                        {logData.tests.split('\n').slice(-10).map((line: string, index: number) => (
                          line.trim() && (
                            <div key={index} className="mb-1">
                              {line}
                            </div>
                          )
                        ))}
                      </div>
                      <Button 
                        size="sm" 
                        className="mt-2 w-full"
                        onClick={() => downloadFile(
                          logData.tests,
                          `${selectedDate}_tests.csv`,
                          'text/csv'
                        )}
                      >
                        <Download className="w-3 h-3 mr-1" />
                        Descargar CSV
                      </Button>
                    </div>
                  ) : (
                    <p className="text-gray-500">No hay logs de pruebas para esta fecha</p>
                  )}
                </CardContent>
              </Card>

              {/* Label Logs */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <HardDrive className="w-5 h-5" />
                    <span>Logs de Etiquetas</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {logData.labels ? (
                    <div>
                      <p className="text-sm text-gray-600 mb-2">
                        {logData.labels.split('\n').length - 1} etiquetas registradas
                      </p>
                      <div className="max-h-40 overflow-y-auto bg-gray-50 p-2 rounded text-xs font-mono">
                        {logData.labels.split('\n').slice(-10).map((line: string, index: number) => (
                          line.trim() && (
                            <div key={index} className="mb-1">
                              {line}
                            </div>
                          )
                        ))}
                      </div>
                      <Button 
                        size="sm" 
                        className="mt-2 w-full"
                        onClick={() => downloadFile(
                          logData.labels,
                          `${selectedDate}_labels.txt`,
                          'text/plain'
                        )}
                      >
                        <Download className="w-3 h-3 mr-1" />
                        Descargar TXT
                      </Button>
                    </div>
                  ) : (
                    <p className="text-gray-500">No hay logs de etiquetas para esta fecha</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="statistics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Estadísticas de Archivos</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Fechas con logs:</span>
                    <Badge variant="outline">{availableDates.length}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>SKUs únicos:</span>
                    <Badge variant="outline">{skuDatabase.length}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Códigos registrados:</span>
                    <Badge variant="outline">{codigosDatabase.length}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Lotes procesados:</span>
                    <Badge variant="outline">{loteDatabase.length}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Estado del Sistema</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span>Servidor Arduino Bridge:</span>
                    <Badge variant="default">Online</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Bases de datos:</span>
                    <Badge variant="default">Sincronizadas</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Logs automáticos:</span>
                    <Badge variant="default">Activos</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Última sincronización:</span>
                    <Badge variant="outline">Ahora</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default FileManager;
