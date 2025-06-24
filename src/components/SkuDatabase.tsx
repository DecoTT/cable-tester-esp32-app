
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Package } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface Sku {
  codigo: string;
  descripcion: string;
  fechaCreacion: string;
  operadorCreacion: string;
}

interface SkuDatabaseProps {
  skus: Sku[];
  setSkus: React.Dispatch<React.SetStateAction<Sku[]>>;
  currentOperator: string;
}

const SkuDatabase: React.FC<SkuDatabaseProps> = ({ skus, setSkus, currentOperator }) => {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingSku, setEditingSku] = useState<Sku | null>(null);
  const [newSkuCodigo, setNewSkuCodigo] = useState('');
  const [newSkuDescripcion, setNewSkuDescripcion] = useState('');

  const getCurrentDateString = () => {
    const now = new Date();
    return now.getFullYear().toString() + 
           (now.getMonth() + 1).toString().padStart(2, '0') + 
           now.getDate().toString().padStart(2, '0');
  };

  const handleAddSku = () => {
    if (!newSkuCodigo.trim()) {
      toast({
        title: "Error",
        description: "El código SKU es obligatorio",
        variant: "destructive"
      });
      return;
    }

    if (skus.find(sku => sku.codigo === newSkuCodigo.toUpperCase())) {
      toast({
        title: "Error",
        description: "Este SKU ya existe en la base de datos",
        variant: "destructive"
      });
      return;
    }

    const newSku: Sku = {
      codigo: newSkuCodigo.toUpperCase(),
      descripcion: newSkuDescripcion.trim(),
      fechaCreacion: getCurrentDateString(),
      operadorCreacion: currentOperator || 'Sin operador'
    };

    setSkus(prev => [...prev, newSku]);
    setNewSkuCodigo('');
    setNewSkuDescripcion('');
    setIsAddDialogOpen(false);

    toast({
      title: "SKU agregado",
      description: `SKU ${newSku.codigo} agregado exitosamente`,
    });
  };

  const handleEditSku = () => {
    if (!editingSku || !editingSku.descripcion.trim()) {
      toast({
        title: "Error",
        description: "La descripción es obligatoria",
        variant: "destructive"
      });
      return;
    }

    setSkus(prev => prev.map(sku => 
      sku.codigo === editingSku.codigo 
        ? { ...sku, descripcion: editingSku.descripcion.trim() }
        : sku
    ));
    
    setIsEditDialogOpen(false);
    setEditingSku(null);

    toast({
      title: "SKU actualizado",
      description: `SKU ${editingSku.codigo} actualizado exitosamente`,
    });
  };

  const openEditDialog = (sku: Sku) => {
    setEditingSku({ ...sku });
    setIsEditDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Base de Datos de SKUs</h2>
          <p className="text-gray-600">Gestión de códigos y descripciones de productos</p>
        </div>
        
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center space-x-2">
              <Plus className="w-4 h-4" />
              <span>Agregar SKU</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Agregar Nuevo SKU</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Código SKU</label>
                <Input
                  value={newSkuCodigo}
                  onChange={(e) => setNewSkuCodigo(e.target.value.toUpperCase())}
                  placeholder="Ej: NP-SCA-4"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Descripción</label>
                <Input
                  value={newSkuDescripcion}
                  onChange={(e) => setNewSkuDescripcion(e.target.value)}
                  placeholder="Descripción del producto"
                  className="mt-1"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleAddSku}>
                  Agregar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Package className="w-8 h-8 text-blue-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total SKUs</p>
                <p className="text-2xl font-bold text-blue-600">{skus.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Edit className="w-8 h-8 text-green-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Con Descripción</p>
                <p className="text-2xl font-bold text-green-600">
                  {skus.filter(sku => sku.descripcion.trim()).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Package className="w-8 h-8 text-yellow-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Sin Descripción</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {skus.filter(sku => !sku.descripcion.trim()).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SKU List */}
      <Card>
        <CardHeader>
          <CardTitle>Lista de SKUs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Código SKU</th>
                  <th className="text-left p-2">Descripción</th>
                  <th className="text-left p-2">Fecha Creación</th>
                  <th className="text-left p-2">Operador</th>
                  <th className="text-left p-2">Estado</th>
                  <th className="text-left p-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {skus.map((sku) => (
                  <tr key={sku.codigo} className="border-b hover:bg-gray-50">
                    <td className="p-2 font-mono font-bold">{sku.codigo}</td>
                    <td className="p-2">
                      {sku.descripcion || (
                        <span className="text-gray-400 italic">Sin descripción</span>
                      )}
                    </td>
                    <td className="p-2">{sku.fechaCreacion}</td>
                    <td className="p-2">{sku.operadorCreacion}</td>
                    <td className="p-2">
                      <Badge variant={sku.descripcion.trim() ? "default" : "secondary"}>
                        {sku.descripcion.trim() ? "Completo" : "Incompleto"}
                      </Badge>
                    </td>
                    <td className="p-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(sku)}
                        className="flex items-center space-x-1"
                      >
                        <Edit className="w-3 h-3" />
                        <span>Editar</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {skus.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No hay SKUs registrados. Agregue el primer SKU para comenzar.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar SKU: {editingSku?.codigo}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Código SKU</label>
              <Input
                value={editingSku?.codigo || ''}
                disabled
                className="mt-1 bg-gray-100"
              />
              <p className="text-xs text-gray-500 mt-1">El código SKU no se puede modificar</p>
            </div>
            <div>
              <label className="text-sm font-medium">Descripción</label>
              <Input
                value={editingSku?.descripcion || ''}
                onChange={(e) => setEditingSku(prev => prev ? {...prev, descripcion: e.target.value} : null)}
                placeholder="Descripción del producto"
                className="mt-1"
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleEditSku}>
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SkuDatabase;
