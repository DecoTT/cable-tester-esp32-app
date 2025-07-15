
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
  // Formato: START_TEST:SKU:OPERATOR:TESTID
  Serial.println("INFO:Comando START_TEST recibido");
  
  // Parsear SKU y Operador del comando
  int firstColon = command.indexOf(':');
  int secondColon = command.indexOf(':', firstColon + 1);
  int thirdColon = command.indexOf(':', secondColon + 1);
  
  if (firstColon > 0 && secondColon > firstColon) {
    String sku = command.substring(firstColon + 1, secondColon);
    String operatorName = command.substring(secondColon + 1, thirdColon > 0 ? thirdColon : command.length());
    
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
  
  // Determinar número de cables basado en SKU (simulación realista)
  int cableCount = 6; // Por defecto 6 cables
  if (currentSKU.toInt() % 3 == 0) {
    cableCount = 2;  // Cables de 2 conductores
  } else if (currentSKU.toInt() % 2 == 0) {
    cableCount = 4;  // Cables de 4 conductores
  }
  
  // Informar inicio de prueba
  Serial.println("INFO:Iniciando prueba de " + String(cableCount) + " cables");
  Serial.println("STATUS:Ejecutando prueba individual");
  digitalWrite(LED_PIN, HIGH);
  
  // Pequeña pausa antes de comenzar
  delay(500);
  
  // Informar que se está verificando continuidad
  Serial.println("INFO:Verificando continuidad");
  
  // Simular prueba de cada canal individual
  bool hasFailure = false;
  String finalResult = "OK";
  
  for (int i = 0; i < cableCount; i++) {
    // Simular tiempo de prueba por canal
    delay(200 + random(400)); // 200-600ms por canal
    
    // 85% probabilidad de OK, 15% de FAIL
    bool channelOK = (random(100) < 85);
    String channelResult = channelOK ? "OK" : "FAIL";
    
    Serial.println("CHANNEL:" + String(i) + ":" + channelResult);
    
    if (!channelOK) {
      hasFailure = true;
    }
  }
  
  // Determinar resultado final basado en los canales
  if (hasFailure) {
    // Diferentes tipos de errores basados en el patrón de fallas
    int errorType = random(3);
    switch (errorType) {
      case 0:
        finalResult = "Falla continuidad";
        break;
      case 1:
        finalResult = "Error 1";
        break;
      case 2:
        finalResult = "Error 2";
        break;
    }
  }
  
  // Pequeña pausa antes del resultado final
  delay(300);
  
  // Enviar resultado final
  Serial.println("RESULT:" + finalResult);
  
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
