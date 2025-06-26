
export interface TestResult {
  id: string;
  sku: string;
  result: string; // Ahora usamos string genérico ya que los códigos vienen de la DB
  startTime: Date;
  endTime: Date;
  duration: number;
  operator: string;
  date: string;
}

export interface Lote {
  id: string;
  sku: string;
  fecha: string;
  operador: string;
  cantidad: number;
  buenos: number;
  malos: number;
  procesados: number;
}

export interface Sku {
  codigo: string;
  descripcion: string;
  fechaCreacion: string;
  standardPack: number; // Valor entre 0-9999, por defecto 10
}

export interface CodigoGlobal {
  codigo: string;
  descripcion: string;
  notas: string;
  fechaCreacion: string;
}
