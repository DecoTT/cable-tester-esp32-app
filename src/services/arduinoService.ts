import { io, Socket } from 'socket.io-client';

export interface ArduinoTestResult {
  result: string;
  timestamp: string;
  duration: number;
  sku?: string;
  operator?: string;
  testId?: string;
  cableCount?: number;
  channelResults?: string[];
}

export interface ArduinoMessage {
  type: 'INFO' | 'STATUS' | 'RESULT' | 'SKU' | 'OPERATOR' | 'UNKNOWN' | 'CHANNEL_RESULT' | 'TEST_START';
  content: string;
  timestamp: string;
  raw: string;
  channelData?: {
    channel: number;
    result: string;
  };
}

// NEW: Interface for Arduino state
export interface ArduinoState {
  sku: string;
  operator: string;
  status: string;
  cableCount: number;
  channelResults: string[];
}

// NEW: Interface for channel results
export interface ChannelResult {
  channel: number;
  result: string;
  timestamp: string;
}

// NEW: Interface for test started event
export interface TestStarted {
  testId: string;
  cableCount: number;
  timestamp: string;
}

export interface ArduinoStatus {
  connected: boolean;
  clients: number;
  timestamp: string;
  serverPort?: number;
  activeTests?: number;
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
          console.log('✅ Conectado al servidor Arduino Bridge');
          resolve();
        });

        this.socket.on('connect_error', (error) => {
          console.error('❌ Error conectando al servidor:', error);
          reject(error);
        });

        this.socket.on('disconnect', () => {
          console.log('🔌 Desconectado del servidor Arduino Bridge');
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

  // UPDATED: Enhanced start test with better parameter handling
  async startTest(sku: string, operator: string): Promise<{ success: boolean; message: string }> {
    console.log(`🚀 Iniciando prueba - SKU: ${sku}, Operador: ${operator}`);
    
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
    
    const result = await response.json();
    console.log(`📊 Respuesta del servidor:`, result);
    return result;
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

  // NEW: Get current Arduino state
  async getArduinoState(): Promise<ArduinoState> {
    const response = await fetch(`${this.baseURL}/api/arduino-state`);
    if (!response.ok) {
      throw new Error('Error obteniendo estado del Arduino');
    }
    const data = await response.json();
    return data.state;
  }

  // NEW: Set SKU on Arduino
  async setSku(sku: string): Promise<{ success: boolean; message: string }> {
    return this.sendCommand(`SET_SKU:${sku}`);
  }

  // NEW: Set operator on Arduino
  async setOperator(operator: string): Promise<{ success: boolean; message: string }> {
    return this.sendCommand(`SET_OPERATOR:${operator}`);
  }

  // NEW: Stop current test
  async stopTest(): Promise<{ success: boolean; message: string }> {
    return this.sendCommand('STOP_TEST');
  }

  // NEW: Request Arduino status
  async requestArduinoStatus(): Promise<{ success: boolean; message: string }> {
    return this.sendCommand('GET_STATUS');
  }

  // IMPROVED: Test result handler with better validation
  onTestResult(callback: (result: ArduinoTestResult) => void) {
    if (this.socket) {
      this.socket.on('test_result', (result: ArduinoTestResult) => {
        console.log('📊 Resultado de prueba recibido:', {
          result: result.result,
          duration: result.duration,
          sku: result.sku,
          operator: result.operator,
          testId: result.testId,
          timestamp: result.timestamp
        });
        
        // Validate result data
        if (result.duration === undefined || result.duration < 0) {
          console.warn('⚠️ Duración inválida en resultado:', result);
        }
        
        callback(result);
      });
    }
  }

  // UPDATED: Enhanced Arduino message handler with new message types
  onArduinoMessage(callback: (message: ArduinoMessage) => void) {
    if (this.socket) {
      this.socket.on('arduino_message', (message: ArduinoMessage) => {
        // Log important message types to reduce noise
        if (['RESULT', 'SKU', 'OPERATOR', 'TEST_START', 'CHANNEL_RESULT'].includes(message.type)) {
          console.log(`📨 Arduino mensaje [${message.type}]:`, message.content);
        }
        
        callback(message);
      });
    }
  }

  // NEW: Listen for test started events
  onTestStarted(callback: (testStarted: TestStarted) => void) {
    if (this.socket) {
      this.socket.on('test_started', (testStarted: TestStarted) => {
        console.log('🚀 Test iniciado:', testStarted);
        callback(testStarted);
      });
    }
  }

  // NEW: Listen for individual channel results
  onChannelResult(callback: (channelResult: ChannelResult) => void) {
    if (this.socket) {
      this.socket.on('channel_result', (channelResult: ChannelResult) => {
        console.log(`🔌 Canal ${channelResult.channel}:`, channelResult.result);
        callback(channelResult);
      });
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
