
# Arduino Bridge Server

Servidor Node.js que actúa como puente entre la aplicación web de Control de Calidad y el Arduino.

## Instalación

```bash
cd arduino-bridge
npm install
```

## Uso

### Desarrollo
```bash
npm run dev
```

### Producción
```bash
npm start
```

## Configuración

El servidor se ejecuta por defecto en el puerto 3001. Puedes cambiarlo con la variable de entorno `PORT`:

```bash
PORT=3002 npm start
```

## Protocolo Arduino

### Comandos enviados al Arduino:
- `START_TEST:SKU:OPERATOR` - Iniciar una prueba

### Respuestas esperadas del Arduino:
- `RESULT:OK` - Prueba exitosa
- `RESULT:CODIGO_ERROR` - Prueba con error

## API Endpoints

### REST API
- `GET /api/status` - Estado de conexión
- `POST /api/connect` - Conectar a Arduino
- `POST /api/disconnect` - Desconectar Arduino
- `POST /api/start-test` - Iniciar prueba

### WebSocket Events
- `connection` - Cliente conectado
- `status` - Estado actual
- `test_result` - Resultado de prueba
- `connection_lost` - Pérdida de conexión

## Ejemplo código Arduino

```cpp
void setup() {
  Serial.begin(9600);
}

void loop() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    
    if (command.startsWith("START_TEST:")) {
      // Realizar prueba
      delay(2000); // Simular tiempo de prueba
      
      // Enviar resultado
      Serial.println("RESULT:OK");
      // o Serial.println("RESULT:CODIGO_ERROR");
    }
  }
}
```
