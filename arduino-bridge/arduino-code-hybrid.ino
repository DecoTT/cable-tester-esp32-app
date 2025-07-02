
// Arduino Mega - Sistema Híbrido para Control de Calidad
// Maneja tanto botón físico como comandos desde la aplicación

// Configuración de pines
const int BUTTON_PIN = 2;  // Pin del botón (usa pull-up interno)
const int LED_PIN = 13;    // LED integrado para indicar actividad

// Variables de control
bool buttonPressed = false;
bool testRunning = false;
int currentTest = 0;
const int TOTAL_TESTS = 12;
unsigned long previousMillis = 0;
const unsigned long TEST_INTERVAL = 5000;  // 5 segundos

// Estado del sistema
String currentSKU = "TEST-SKU";
String currentOperator = "Arduino";

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
  
  // Mensaje inicial
  Serial.println("INFO:Sistema de Control de Calidad iniciado");
  Serial.println("SKU:" + currentSKU);
  Serial.println("OPERATOR:" + currentOperator);
  Serial.println("STATUS:Listo para pruebas");
}

void loop() {
  // Verificar comandos del puerto serial
  checkSerialCommands();
  
  // Verificar si se presionó el botón físico
  checkButton();
  
  // Ejecutar secuencia de pruebas si está activa
  if (testRunning) {
    runTestSequence();
  }
}

void checkSerialCommands() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    
    if (command.startsWith("START_TEST:")) {
      handleStartTestCommand(command);
    } else if (command == "GET_STATUS") {
      handleGetStatusCommand();
    } else if (command.startsWith("SET_SKU:")) {
      handleSetSKUCommand(command);
    } else if (command == "STOP_TEST") {
      handleStopTestCommand();
    }
  }
}

void handleStartTestCommand(String command) {
  // Parsear comando: START_TEST:SKU:OPERATOR
  int firstColon = command.indexOf(':', 0);
  int secondColon = command.indexOf(':', firstColon + 1);
  
  if (firstColon != -1 && secondColon != -1) {
    currentSKU = command.substring(firstColon + 1, secondColon);
    currentOperator = command.substring(secondColon + 1);
    
    Serial.println("SKU:" + currentSKU);
    Serial.println("OPERATOR:" + currentOperator);
  }
  
  Serial.println("INFO:Comando START_TEST recibido");
  Serial.println("STATUS:Ejecutando prueba individual");
  
  // Simular una prueba individual (no secuencia completa)
  delay(1000);  // Simular tiempo de prueba
  
  // Enviar resultado aleatorio (90% OK, 10% Error)
  if (random(100) < 90) {
    Serial.println("RESULT:OK");
  } else {
    Serial.println("RESULT:Error 1");
  }
  
  Serial.println("STATUS:Prueba completada");
}

void handleGetStatusCommand() {
  Serial.println("SKU:" + currentSKU);
  Serial.println("OPERATOR:" + currentOperator);
  Serial.println("STATUS:" + (testRunning ? "Ejecutando secuencia" : "Listo"));
  Serial.println("INFO:Estado enviado");
}

void handleSetSKUCommand(String command) {
  int colonIndex = command.indexOf(':');
  if (colonIndex != -1) {
    currentSKU = command.substring(colonIndex + 1);
    Serial.println("SKU:" + currentSKU);
    Serial.println("INFO:SKU actualizado");
  }
}

void handleStopTestCommand() {
  if (testRunning) {
    testRunning = false;
    digitalWrite(LED_PIN, LOW);
    Serial.println("INFO:Secuencia de pruebas detenida");
    Serial.println("STATUS:Listo");
  }
}

void checkButton() {
  // Leer estado del botón (LOW = presionado debido al pull-up)
  bool currentButtonState = !digitalRead(BUTTON_PIN);
  
  // Detectar flanco de subida (botón presionado)
  if (currentButtonState && !buttonPressed && !testRunning) {
    buttonPressed = true;
    startButtonSequence();
  }
  
  // Resetear flag cuando se suelta el botón
  if (!currentButtonState) {
    buttonPressed = false;
  }
}

void startButtonSequence() {
  Serial.println("INFO:Botón físico presionado");
  Serial.println("STATUS:Iniciando secuencia de 12 pruebas");
  Serial.println("SKU:" + currentSKU);
  
  testRunning = true;
  currentTest = 0;
  previousMillis = millis();
  
  // Encender LED para indicar que las pruebas están corriendo
  digitalWrite(LED_PIN, HIGH);
  
  // Enviar primer mensaje inmediatamente
  sendTestMessage();
}

void runTestSequence() {
  unsigned long currentMillis = millis();
  
  // Verificar si han pasado 5 segundos
  if (currentMillis - previousMillis >= TEST_INTERVAL) {
    previousMillis = currentMillis;
    currentTest++;
    
    // Verificar si aún hay pruebas pendientes
    if (currentTest < TOTAL_TESTS) {
      sendTestMessage();
    } else {
      // Finalizar secuencia de pruebas
      endTestSequence();
    }
  }
}

void sendTestMessage() {
  Serial.println("STATUS:Prueba " + String(currentTest + 1) + "/" + String(TOTAL_TESTS));
  Serial.println(testMessages[currentTest]);
  
  // Parpadear LED para indicar envío
  digitalWrite(LED_PIN, LOW);
  delay(100);
  digitalWrite(LED_PIN, HIGH);
}

void endTestSequence() {
  digitalWrite(LED_PIN, LOW);
  testRunning = false;
  currentTest = 0;
  
  Serial.println("INFO:Secuencia de 12 pruebas completada");
  Serial.println("STATUS:Listo para nueva secuencia");
}
