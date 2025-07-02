
// Arduino Mega - Sistema Híbrido de Control de Calidad
// Modo 1: Botón físico para secuencias automáticas (12 pruebas consecutivas)
// Modo 2: Comandos desde app para pruebas individuales

// Configuración de pines
const int BUTTON_PIN = 2;  // Pin del botón (usa pull-up interno)
const int LED_PIN = 13;    // LED integrado para indicar actividad

// Variables de control del botón físico
bool buttonPressed = false;
bool testRunning = false;
int currentTest = 0;
const int TOTAL_TESTS = 12;
unsigned long previousMillis = 0;
const unsigned long TEST_INTERVAL = 3000;  // 3 segundos entre pruebas

// Variables del sistema
String currentSKU = "1234";           // SKU por defecto
String currentOperator = "Operador";  // Operador por defecto
bool systemInitialized = false;      // Control de inicialización

// Array con los mensajes de prueba (10 OK + 2 Error)
String testMessages[TOTAL_TESTS] = {
  "RESULT:OK",       // Prueba 1
  "RESULT:OK",       // Prueba 2
  "RESULT:OK",       // Prueba 3
  "RESULT:OK",       // Prueba 4
  "RESULT:Error 1",  // Prueba 5 - Error
  "RESULT:OK",       // Prueba 6
  "RESULT:OK",       // Prueba 7
  "RESULT:OK",       // Prueba 8
  "RESULT:Error 1",  // Prueba 9 - Error
  "RESULT:OK",       // Prueba 10
  "RESULT:OK",       // Prueba 11
  "RESULT:OK"        // Prueba 12
};

void setup() {
  // Inicializar comunicación serial
  Serial.begin(9600);
  
  // Configurar pines
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // Botón con pull-up interno
  pinMode(LED_PIN, OUTPUT);
  
  digitalWrite(LED_PIN, LOW);
  
  // Esperar estabilización y enviar datos iniciales UNA SOLA VEZ
  delay(2000);
  sendInitialData();
}

void loop() {
  // Verificar comandos del puerto serial
  checkSerialCommands();
  
  // Verificar si se presionó el botón físico (solo si no hay prueba corriendo)
  if (!testRunning) {
    checkButton();
  }
  
  // Ejecutar secuencia de pruebas si está activa
  if (testRunning) {
    runTestSequence();
  }
}

void sendInitialData() {
  if (!systemInitialized) {
    Serial.println("INFO:Sistema Arduino iniciado");
    Serial.println("SKU:" + currentSKU);
    Serial.println("OPERATOR:" + currentOperator);
    Serial.println("STATUS:Listo para recibir comandos");
    systemInitialized = true;
  }
}

void checkSerialCommands() {
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    
    if (command.startsWith("START_TEST:")) {
      handleStartTestCommand(command);
    }
    else if (command.equals("GET_STATUS")) {
      handleGetStatusCommand();
    }
    else if (command.startsWith("SET_SKU:")) {
      handleSetSKUCommand(command);
    }
    else if (command.startsWith("SET_OPERATOR:")) {
      handleSetOperatorCommand(command);
    }
    else if (command.equals("STOP_TEST")) {
      handleStopTestCommand();
    }
    else {
      Serial.println("INFO:Comando no reconocido: " + command);
    }
  }
}

void handleStartTestCommand(String command) {
  // Formato: START_TEST:SKU:OPERATOR
  Serial.println("INFO:Comando START_TEST recibido");
  
  // Parsear SKU y Operador del comando
  int firstColon = command.indexOf(':');
  int secondColon = command.indexOf(':', firstColon + 1);
  
  if (firstColon > 0 && secondColon > firstColon) {
    String sku = command.substring(firstColon + 1, secondColon);
    String operatorName = command.substring(secondColon + 1);
    
    // Actualizar variables solo si son diferentes
    if (sku != currentSKU) {
      currentSKU = sku;
      Serial.println("SKU:" + currentSKU);
    }
    if (operatorName != currentOperator) {
      currentOperator = operatorName;
      Serial.println("OPERATOR:" + currentOperator);
    }
  }
  
  // Ejecutar UNA sola prueba simulada (MODO APP)
  Serial.println("STATUS:Ejecutando prueba individual");
  digitalWrite(LED_PIN, HIGH);
  
  // Simular tiempo de prueba
  delay(1000);
  
  // Enviar resultado simulado (80% OK, 20% Error)
  String result = (random(100) < 80) ? "RESULT:OK" : "RESULT:Error 1";
  Serial.println(result);
  
  digitalWrite(LED_PIN, LOW);
  Serial.println("STATUS:Prueba individual completada");
}

void handleGetStatusCommand() {
  Serial.println("STATUS:" + String(testRunning ? "Secuencia activa" : "Listo"));
  Serial.println("SKU:" + currentSKU);
  Serial.println("OPERATOR:" + currentOperator);
  Serial.println("INFO:Pruebas pendientes: " + String(testRunning ? (TOTAL_TESTS - currentTest) : 0));
}

void handleSetSKUCommand(String command) {
  int colonPos = command.indexOf(':');
  if (colonPos > 0) {
    String newSKU = command.substring(colonPos + 1);
    if (newSKU != currentSKU) {
      currentSKU = newSKU;
      Serial.println("SKU:" + currentSKU);
      Serial.println("INFO:SKU actualizado correctamente");
    }
  }
}

void handleSetOperatorCommand(String command) {
  int colonPos = command.indexOf(':');
  if (colonPos > 0) {
    String newOperator = command.substring(colonPos + 1);
    if (newOperator != currentOperator) {
      currentOperator = newOperator;
      Serial.println("OPERATOR:" + currentOperator);
      Serial.println("INFO:Operador actualizado correctamente");
    }
  }
}

void handleStopTestCommand() {
  if (testRunning) {
    testRunning = false;
    currentTest = 0;
    digitalWrite(LED_PIN, LOW);
    Serial.println("INFO:Secuencia de pruebas detenida");
    Serial.println("STATUS:Listo");
  }
}

void checkButton() {
  // Leer estado del botón (LOW = presionado debido al pull-up)
  bool currentButtonState = !digitalRead(BUTTON_PIN);
  
  // Detectar flanco de subida (botón presionado)
  if (currentButtonState && !buttonPressed) {
    buttonPressed = true;
    startPhysicalButtonSequence();
  }
  
  // Resetear flag cuando se suelta el botón
  if (!currentButtonState) {
    buttonPressed = false;
  }
}

void startPhysicalButtonSequence() {
  Serial.println("INFO:Botón físico presionado - Iniciando secuencia");
  Serial.println("STATUS:Secuencia de 12 pruebas iniciada");
  
  testRunning = true;
  currentTest = 0;
  previousMillis = millis();
  
  // Encender LED para indicar que las pruebas están corriendo
  digitalWrite(LED_PIN, HIGH);
  
  // Enviar primer resultado inmediatamente
  sendTestResult();
}

void runTestSequence() {
  unsigned long currentMillis = millis();
  
  // Verificar si han pasado los segundos necesarios
  if (currentMillis - previousMillis >= TEST_INTERVAL) {
    previousMillis = currentMillis;
    currentTest++;
    
    // Verificar si aún hay pruebas pendientes
    if (currentTest < TOTAL_TESTS) {
      sendTestResult();
    } else {
      // Finalizar secuencia de pruebas
      endTestSequence();
    }
  }
}

void sendTestResult() {
  // Parpadear LED para indicar envío
  digitalWrite(LED_PIN, LOW);
  delay(100);
  digitalWrite(LED_PIN, HIGH);
  
  // Enviar información de estado y resultado
  Serial.println("STATUS:Prueba " + String(currentTest + 1) + "/" + String(TOTAL_TESTS));
  Serial.println(testMessages[currentTest]);
}

void endTestSequence() {
  Serial.println("STATUS:Secuencia completada");
  Serial.println("INFO:12 pruebas finalizadas - Sistema listo");
  
  // Apagar LED y resetear variables
  digitalWrite(LED_PIN, LOW);
  testRunning = false;
  currentTest = 0;
}
