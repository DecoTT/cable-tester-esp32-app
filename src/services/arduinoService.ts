import { io, Socket } from 'socket.io-client';

export interface ArduinoTestResult {
  result: string;
  timestamp: string;
  duration: number;
}

export interface ArduinoMessage {
  type: 'INFO' | 'STATUS' | 'RESULT' | 'SKU' | 'OPERATOR' | 'UNKNOWN';
  content: string;
  timestamp: string;
  raw: string;
}

export interface ArduinoStatus {
  connected: boolean;
  clients: number;
  timestamp: string;
}

class ArduinoService {
  private socket: Socket | null = null;
  private baseURL: string;
  private isConnected: boolean = false;

  constructor() {
    this.baseURL = import.meta.env.VITE_ARDUINO_SERVER_URL || 'http://localhost:3001';
  }

  // Inicializar conexión WebSocket
  initializeSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = io(this.baseURL);

        this.socket.on('connect', () => {
          console.log('Conectado al servidor Arduino Bridge');
          resolve();
        });

        this.socket.on('connect_error', (error) => {
          console.error('Error conectando al servidor:', error);
          reject(error);
        });

        this.socket.on('disconnect', () => {
          console.log('Desconectado del servidor Arduino Bridge');
          this.isConnected = false;
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  // Desconectar WebSocket
  disconnectSocket() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // Obtener estado
  async getStatus(): Promise<ArduinoStatus> {
    const response = await fetch(`${this.baseURL}/api/status`);
    if (!response.ok) {
      throw new Error('Error obteniendo estado del Arduino');
    }
    return response.json();
  }

  // Conectar a Arduino
  async connectToArduino(): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${this.baseURL}/api/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error('Error conectando a Arduino');
    }
    
    const result = await response.json();
    this.isConnected = result.success;
    return result;
  }

  // Desconectar Arduino
  async disconnectArduino(): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${this.baseURL}/api/disconnect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error('Error desconectando Arduino');
    }
    
    const result = await response.json();
    this.isConnected = !result.success;
    return result;
  }

  // Iniciar prueba
  async startTest(sku: string, operator: string): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${this.baseURL}/api/start-test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sku, operator }),
    });
    
    if (!response.ok) {
      throw new Error('Error iniciando prueba');
    }
    
    return response.json();
  }

  // Enviar comando específico al Arduino
  async sendCommand(command: string): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${this.baseURL}/api/send-command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command }),
    });
    
    if (!response.ok) {
      throw new Error('Error enviando comando');
    }
    
    return response.json();
  }

  // Obtener logs del Arduino
  async getArduinoLogs(): Promise<ArduinoMessage[]> {
    const response = await fetch(`${this.baseURL}/api/arduino-logs`);
    if (!response.ok) {
      throw new Error('Error obteniendo logs del Arduino');
    }
    return response.json();
  }

  // Escuchar resultados de pruebas (solo RESULT:)
  onTestResult(callback: (result: ArduinoTestResult) => void) {
    if (this.socket) {
      this.socket.on('test_result', callback);
    }
  }

  // Escuchar TODOS los mensajes del Arduino
  onArduinoMessage(callback: (message: ArduinoMessage) => void) {
    if (this.socket) {
      this.socket.on('arduino_message', callback);
    }
  }

  // Escuchar mensajes informativos
  onArduinoInfo(callback: (message: ArduinoMessage) => void) {
    if (this.socket) {
      this.socket.on('arduino_info', callback);
    }
  }

  // Escuchar cambios de estado
  onStatusChange(callback: (status: ArduinoStatus) => void) {
    if (this.socket) {
      this.socket.on('status', callback);
    }
  }

  // Escuchar pérdida de conexión
  onConnectionLost(callback: (error: { error: string }) => void) {
    if (this.socket) {
      this.socket.on('connection_lost', callback);
    }
  }

  // Verificar si está conectado
  isArduinoConnected(): boolean {
    return this.isConnected;
  }
}

export const arduinoService = new ArduinoService();
