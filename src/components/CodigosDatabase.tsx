
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Code, Plus, Edit, Trash2, Save, X } from 'lucide-react';

interface CodigoGlobal {
  codigo: string;
  descripcion: string;
  notas: string;
  fechaCreacion: string;
}

interface CodigosDatabaseProps {
  codigos: CodigoGlobal[];
  setCodigos: (codigos: CodigoGlobal[]) => void;
  currentOperator: string;
}

const CodigosDatabase: React.FC<CodigosDatabaseProps> = ({
  codigos,
  setCodigos,
  currentOperator
}) => {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingCodigo, setEditingCodigo] = useState<string | null>(null);
  const [newCodigo, setNewCodigo] = useState({
    codigo: '',
    descripcion: '',
    notas: ''
  });
  const [editData, setEditData] = useState({
    descripcion: '',
    notas: ''
  });

  const getCurrentDateString = () => {
    const now = new Date();
    return now.getFullYear().toString() + 
           (now.getMonth() + 1).toString().padStart(2, '0') + 
           now.getDate().toString().padStart(2, '0');
  };

  const handleAddCodigo = () => {
    if (!newCodigo.codigo.trim()) {
      toast({
        title: "Error",
        description: "El código es requerido",
        variant: "destructive"
      });
      return;
    }

    if (codigos.find(c => c.codigo === newCodigo.codigo)) {
      toast({
        title: "Error",
        description: "Este código ya existe",
        variant: "destructive"
      });
      return;
    }

    const codigo: CodigoGlobal = {
      codigo: newCodigo.codigo.toUpperCase(),
      descripcion: newCodigo.descripcion,
      notas: newCodigo.notas,
      fechaCreacion: getCurrentDateString()
    };

    setCodigos([...codigos, codigo]);
    setNewCodigo({ codigo: '', descripcion: '', notas: '' });
    setIsAddDialogOpen(false);
    
    toast({
      title: "Código agregado",
      description: `Código ${codigo.codigo} agregado exitosamente`,
    });
  };

  const handleEditCodigo = (codigo: CodigoGlobal) => {
    setEditingCodigo(codigo.codigo);
    setEditData({
      descripcion: codigo.descripcion,
      notas: codigo.notas
    });
  };

  const handleSaveEdit = () => {
    if (!editingCodigo) return;

    setCodigos(codigos.map(codigo => 
      codigo.codigo === editingCodigo 
        ? { ...codigo, descripcion: editData.descripcion, notas: editData.notas }
        : codigo
    ));

    setEditingCodigo(null);
    setEditData({ descripcion: '', notas: '' });
    
    toast({
      title: "Código actualizado",
      description: "Los cambios han sido guardados",
    });
  };

  const handleDeleteCodigo = (codigoToDelete: string) => {
    setCodigos(codigos.filter(codigo => codigo.codigo !== codigoToDelete));
    
    toast({
      title: "Código eliminado",
      description: `Código ${codigoToDelete} eliminado`,
      variant: "destructive"
    });
  };

  const getCodigoBadgeColor = (codigo: string) => {
    if (codigo === 'OK') return 'bg-green-500';
    if (codigo === 'Critico') return 'bg-red-500';
    if (codigo.startsWith('Error')) return 'bg-orange-500';
    return 'bg-blue-500';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Base de Datos de Códigos Globales</h2>
          <p className="text-gray-600 mt-1">
            Gestión de códigos de respuesta del sistema de pruebas
          </p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center space-x-2">
              <Plus className="w-4 h-4" />
              <span>Agregar Código</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Agregar Nuevo Código</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Código *</label>
                <Input
                  value={newCodigo.codigo}
                  onChange={(e) => setNewCodigo({...newCodigo, codigo: e.target.value.toUpperCase()})}
                  placeholder="Ej: OK, Critico, 5001, Error 1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Descripción</label>
                <Input
                  value={newCodigo.descripcion}
                  onChange={(e) => setNewCodigo({...newCodigo, descripcion: e.target.value})}
                  placeholder="Descripción del código"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Notas</label>
                <Textarea
                  value={newCodigo.notas}
                  onChange={(e) => setNewCodigo({...newCodigo, notas: e.target.value})}
                  placeholder="Notas adicionales sobre el código"
                  rows={3}
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleAddCodigo}>
                  Agregar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Code className="w-5 h-5" />
            <span>Códigos Registrados ({codigos.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {codigos.length === 0 ? (
            <div className="text-center py-8">
              <Code className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No hay códigos registrados</p>
              <p className="text-sm text-gray-400 mt-2">
                Los códigos se crean automáticamente cuando se detectan en las pruebas
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Notas</TableHead>
                  <TableHead>Fecha Creación</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codigos.map((codigo) => (
                  <TableRow key={codigo.codigo}>
                    <TableCell>
                      <Badge className={`${getCodigoBadgeColor(codigo.codigo)} text-white`}>
                        {codigo.codigo}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {editingCodigo === codigo.codigo ? (
                        <Input
                          value={editData.descripcion}
                          onChange={(e) => setEditData({...editData, descripcion: e.target.value})}
                          className="w-full"
                        />
                      ) : (
                        <span>{codigo.descripcion || '-'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingCodigo === codigo.codigo ? (
                        <Textarea
                          value={editData.notas}
                          onChange={(e) => setEditData({...editData, notas: e.target.value})}
                          className="w-full"
                          rows={2}
                        />
                      ) : (
                        <span className="text-sm">{codigo.notas || '-'}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {codigo.fechaCreacion}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        {editingCodigo === codigo.codigo ? (
                          <>
                            <Button
                              size="sm"
                              onClick={handleSaveEdit}
                              className="flex items-center space-x-1"
                            >
                              <Save className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingCodigo(null)}
                              className="flex items-center space-x-1"
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEditCodigo(codigo)}
                              className="flex items-center space-x-1"
                            >
                              <Edit className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDeleteCodigo(codigo.codigo)}
                              className="flex items-center space-x-1"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Códigos Comunes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 border rounded-lg">
              <Badge className="bg-green-500 text-white mb-2">OK</Badge>
              <p className="text-sm text-gray-600">Prueba exitosa</p>
            </div>
            <div className="text-center p-4 border rounded-lg">
              <Badge className="bg-red-500 text-white mb-2">Critico</Badge>
              <p className="text-sm text-gray-600">Error crítico</p>
            </div>
            <div className="text-center p-4 border rounded-lg">
              <Badge className="bg-blue-500 text-white mb-2">5001</Badge>
              <p className="text-sm text-gray-600">Código de sistema</p>
            </div>
            <div className="text-center p-4 border rounded-lg">
              <Badge className="bg-orange-500 text-white mb-2">Error 1</Badge>
              <p className="text-sm text-gray-600">Error tipo 1</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default CodigosDatabase;
