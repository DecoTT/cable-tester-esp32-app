# CableTester32 App — Plan de desarrollo

**Estado:** plan aprobado pendiente · **Fecha:** 2026-09-21  
**Origen:** `cable-test-scribe` (Lovable, React + bridge Node para Arduino)  
**Destino:** app local de producción para el tester ESP32 (firmware v0.6, `docs/API.md` del firmware)

---

## 1. Decisión de plataforma: se mantiene el stack web

**Recomendación: React + shadcn-ui en el frontend, Node en el bridge. NO migrar a Python.**

| Razón | Detalle |
|---|---|
| **Familiaridad del operador** | La UI ya la conoce la gente. Los mismos componentes shadcn dan un look casi idéntico sin rehacer diseño |
| **Impresión ya resuelta** | `pdfkit` + QR + envío por SO (PowerShell / `Out-Printer`) está probado con Zebra. En Python habría que resolverlo de nuevo |
| **El bridge encaja exacto** | Un servidor local que habla con el tester y es dueño de DB, impresión y logs. Es justo la arquitectura que el firmware v0.6 espera: la PC es la fuente de verdad |
| **Serial ya está** | `serialport` en Node funciona; sirve para el modo USB del tester |

### 1.1 Un solo proceso, un solo puerto

Hoy son dos procesos (`vite dev` + `node server.js`). En producción **el bridge sirve el frontend compilado** como estáticos → `http://localhost:3001` y ya. Un solo `npm start`, un solo puerto, sin dev server en planta.

Envolver en Electron/Tauri para tener un `.exe` con icono queda como fase opcional al final. No bloquea nada.

---

## 2. Arquitectura

```
┌──────────────┐   HTTP + WebSocket   ┌──────────────────┐   HTTP (LAN)  o  USB serial   ┌─────────────┐
│  Navegador   │ ◄──────────────────► │   Bridge (Node)  │ ◄───────────────────────────► │ ESP32 master│
│  React UI    │                      │                  │                               │  (v0.6+)    │
└──────────────┘                      │  · SQLite        │                               └──────┬──────┘
                                      │  · Impresión     │                                      │ ESP-NOW
                                      │  · Descubrimiento│                               ┌──────┴──────┐
                                      │  · Auditoría     │                               │ links 1..N  │
                                      └──────────────────┘                               └─────────────┘
```

**Regla dura:** el navegador **nunca** habla con el ESP32. Solo el bridge. Así el transporte (LAN o USB) es invisible para la UI, y el tester sigue siendo una herramienta de comandos sin estado propio.

**Regla dura 2:** el bridge consume **solo** `/api/*` del firmware (JSON versionado). Nunca parsea el texto de `/cmd`.

---

## 3. Lo que cambia respecto a la app vieja

### 3.1 El protocolo con el tester desaparece como problema

| Viejo (Arduino) | Nuevo (ESP32 v0.6) |
|---|---|
| Stream de texto `INFO:` `STATUS:` `CHANNEL:` `RESULT:` parseado con regex en el bridge | `GET /api/status`, `POST /api/golden`, `POST /api/test` → JSON |
| Resultado = un código opaco (`"OK"`, `"Error 1"`) | Resultado = `PASS/FAIL` + lista de fallas estructuradas `{type, a, b}` |
| El tester "sabe" el SKU y el operador | El tester no sabe nada: la PC le empuja el job y registra todo |
| Un test activo en un `Map` con emparejamiento FIFO frágil | Una prueba = una petición síncrona con respuesta |

Todo `parseArduinoMessage()` y el `activeTests` FIFO del bridge viejo **no se portan**.

### 3.2 "Códigos" cambia de naturaleza

Antes: catálogo de strings libres que el Arduino devolvía, con descripción tecleada a mano.
Ahora: las fallas vienen **estructuradas** del tester (`open`/`short` + canales). La descripción para el operador sale de la **tabla de fixture** del SKU (`M.J19` → `JST3 pos 5`), no de un catálogo.

La pestaña se conserva por familiaridad pero pasa a ser **Diagnóstico**: muestra la falla en términos del conector y, más adelante, sobre un diagrama del arnés. El catálogo de notas por patrón de falla queda opcional.

### 3.3 Almacenamiento: de JSON + localStorage a SQLite

La app vieja tiene **dos fuentes de verdad** (localStorage en el navegador y JSON en el servidor) sincronizadas por debounce de 5 s. Para trazabilidad eso no sirve: se pierde al limpiar el navegador, no hay historial, no hay concurrencia segura.

**SQLite en el bridge, único dueño de los datos.** El navegador solo muestra.

---

## 4. Bugs de la app vieja que NO se portan

Encontrados al revisar `QualityApp.tsx` y `server.js`. Conviene tenerlos presentes para no reproducirlos:

| Bug | Dónde | Consecuencia | Solución en la nueva |
|---|---|---|---|
| **El número de lote vive en React state** (`useState('0001')`) | `QualityApp.tsx:35` | Al recargar la página **se reinicia a 0001** → lotes duplicados en etiquetas | Secuencia en SQLite, nunca en memoria del navegador |
| `useEffect` de cambio de SKU con dependencias `[okCount, testResults, ...]` | `QualityApp.tsx:265` | Se re-dispara con cada cable OK; puede imprimir etiquetas parciales espurias | Lógica de standard pack **en el bridge**, disparada por evento de resultado, no por render |
| Umbral de impresión automática fijo en `SP × 2` ("pares") | `QualityApp.tsx:425` | No sirve para SKUs con otro empaque | `standard_pack` y `labels_per_pack` por SKU en DB |
| Conteo `okCount` en localStorage por fecha | `QualityApp.tsx:153` | Se desincroniza del servidor; no sobrevive cambio de PC | Se calcula desde la tabla `tests` |
| DB JSON reescrita entera en cada sync | `server.js:95` | Sin transacciones; una escritura a medias corrompe todo | SQLite |
| `lovable-tagger` en devDependencies | `package.json` | Dependencia de la plataforma Lovable en producción | Se elimina |

---

## 5. Modelo de datos (SQLite)

```sql
skus        codigo PK, descripcion, standard_pack, labels_per_pack, label_type, active, created_at
fixtures    id PK, sku, nombre, labels JSON  -- {"M.J19":"JST3 pos 5", ...}
jobs        id PK, sku, fixture_id, nets BLOB, nets_count, crc, channels,
            captured_by, captured_at, approved_by, approved_at, status  -- draft|approved|retired
tester_units id PK, mac, unit, role, sku_bound, last_seen
tests       id PK, sku, job_id, operator, tester_mac, started_at, ended_at, duration_ms,
            result, faults JSON, notes
lotes       id PK (secuencia 0001...), sku, fecha, operador, cantidad, buenos, malos
labels      id PK, lote_id, sku, qty, qr_data, printer, printed_at
operators   id PK, nombre, active
audit       id PK, ts, actor, action, entity, entity_id, details JSON
settings    key PK, value
```

**Clave de trazabilidad:** `tests.job_id` → `jobs.crc`. Cada prueba registra **contra qué golden exacto** se validó y quién lo aprobó. Si aparece un problema en campo, se rastrea.

---

## 6. Pestañas: qué se mantiene, qué cambia

| Pestaña | Estado | Cambios |
|---|---|---|
| **Pruebas** | Se mantiene | SKU ahora selecciona un job aprobado. Antes de correr: verificación previa (tester correcto, links en línea, RSSI, golden cargado). Resultado con fallas por conector |
| **Resultados** | Se mantiene | Desde SQLite. Filtro por fecha/SKU/operador |
| **SKUs** | Se mantiene + crece | Añade: standard pack, etiquetas por pack, tipo de etiqueta, **fixture** (tabla de nombres de conector), **jobs/goldens** (capturar → revisar → aprobar) |
| **Códigos** → **Diagnóstico** | Cambia | Fallas estructuradas en términos del conector. Diagrama del arnés en fase posterior |
| **Etiquetas** | Se mantiene | Misma lógica (auto, par, parcial, manual), mismo QR `SKU.FECHA.QTY.LOTE`, mismos dos tamaños. Pero el disparo automático vive en el bridge |
| **Logs** | Se mantiene | Desde SQLite. Export CSV/JSON. Añade vista de auditoría |
| **Operador** | Se mantiene | Tabla propia, activo/inactivo |
| **Archivos** → **Configuración** | Cambia | Impresora, tester (descubrimiento mDNS + IP manual + puerto USB), respaldo/restauración de DB |

---

## 7. Flujos nuevos que el tester habilita

### 7.1 Captura de golden (ingeniería)
1. SKUs → seleccionar SKU → "Capturar golden"
2. Bridge verifica tester → `map` → muestra nets **en nombres de conector** (vía fixture)
3. Ingeniería revisa contra el plano; opcionalmente **doble captura** (dos muestras deben coincidir)
4. "Aprobar" → `jobs.status = approved`, se registra quién y cuándo en `audit`

### 7.2 Corrida de producción (operador)
1. Pruebas → SKU + operador → "Iniciar"
2. Bridge: `GET /api/status` → ¿MAC correcta? ¿links en línea? ¿RSSI ok? Si no → bloquea con mensaje claro
3. Bridge: `POST /api/golden` con el job aprobado (o verifica CRC si ya está cargado)
4. Bridge: `POST /api/test` → resultado estructurado
5. Registra en `tests`; si PASS actualiza conteo del lote; si toca, imprime etiquetas
6. Si FAIL: muestra `ABIERTO JST3 pos 5 ↔ JST1 pos 12` con opción de reintentar

### 7.3 Liberar / reasignar un tester
Configuración → tester → "Liberar" → `tester_clear` por API + `tester_units.sku_bound = null` + auditoría.

---

## 8. Fases

| Fase | Entregable | Depende de |
|---|---|---|
| **0** ✅ | Proyecto limpio: React + shadcn (componentes reutilizados del viejo), bridge Node sirviendo el SPA, SQLite con esquema, sin Lovable | — |
| **1** ✅ | Capa de conexión al tester: HTTP y USB serial detrás de una misma interfaz, descubrimiento mDNS, IP manual. Pestaña Configuración funcional con `/api/status` en vivo | Firmware v0.6 ✅ |
| **2** ✅ | Asistente de alta de SKU: 6 pasos guiados (SKU → tester → unidades → validar módulos → capturar golden → guardar). Commit atómico | `map` + `api/selfcheck` ✅ |
| **3** | Corrida de producción: verificación previa → push golden → test → registro → fallas por conector | `POST /api/test` ✅ en firmware v0.7 |
| **4** | Etiquetas + standard pack + lotes: portar lógica al bridge, secuencia de lote en DB, impresión | Fase 3 |
| **5** | Logs, auditoría, export, operadores | Fase 3 |
| **6** | Mapeo distribuido (96 canales) en la UI · diagrama del arnés · Electron opcional | Firmware distribuido (pendiente) |

**Fases 0-2 se pueden hacer ya**, con el firmware actual. La 3 necesita `POST /api/test`, que es el siguiente trabajo de firmware.

---

## 9. Qué se reutiliza del proyecto viejo, literalmente

- `src/components/ui/*` — los 40+ componentes shadcn, tal cual
- Estructura visual de `TestingTab`, `LabelGenerator`, `NavigationTabs`, `AppHeader/Footer`
- Del bridge: generación de PDF de etiquetas (`pdfkit` + `qrcode`, ambos tamaños), listado de impresoras (`wmic` / `lpstat`), envío a impresora, QR con formato `SKU.FECHA.QTY.LOTE`
- `tailwind.config.ts`, `components.json`, estilos

Lo que se reescribe: `QualityApp.tsx` (la lógica de negocio sale del componente), `arduinoService.ts` → `testerService.ts` (contra `/api/*`), toda la capa serial-parser del bridge, persistencia.

---

## 10. Decisiones tomadas (2026-09-21)

- [x] **Un bridge gestiona varios testers.** Cada tester vinculado a su SKU. El bridge descubre por mDNS, acepta IP manual y puerto USB. Tabla `tester_units`.
- [x] **Impresión con interruptor.** Sin impresora de etiquetas en desarrollo → `settings.print_enabled = false`. Siempre se genera el **PDF a carpeta** (`labels/`) y se muestra **vista previa** en la UI; enviar a impresora es opcional. Esto queda como función permanente: previsualizar antes de imprimir en producción.
- [x] **Editor de etiqueta por job.** Plantilla editable por SKU/job: texto de cliente, líneas extra, tamaños de fuente, logo. Ver §11.
- [x] **De momento solo el ESP32 propio.** Sin compatibilidad con el Arduino viejo.

### Aún abiertas (no bloquean)
- [ ] Diagrama del arnés: SVG por SKU o generado desde la tabla de fixture (Fase 6)
- [ ] Electron sí/no (Fase 6)
- [ ] Doble captura de golden obligatoria o recomendada

---

## 11. Editor de etiquetas — diseño

Cada SKU tiene una **plantilla** (JSON en `skus.label_template`). Se edita en la UI con vista previa en vivo y se renderiza con `pdfkit` en el bridge. Los datos de la corrida (`sku`, `date`, `qty`, `lote`) y las variables propias del SKU (`cliente`, `parte_cliente`, etc.) se sustituyen con `{nombre}`.

```json
{
  "size": "large",
  "vars": { "cliente": "KIA", "parte_cliente": "91234-AB000" },
  "elements": [
    { "type": "logo",  "x": 4,  "y": 4,  "w": 40 },
    { "type": "text",  "x": 0,  "y": 8,  "w": 213, "value": "{sku}",              "size": 18, "bold": true, "align": "center" },
    { "type": "text",  "x": 0,  "y": 30, "w": 213, "value": "Cliente: {cliente}", "size": 8,  "align": "center" },
    { "type": "text",  "x": 0,  "y": 40, "w": 213, "value": "P/N: {parte_cliente}", "size": 8, "align": "center" },
    { "type": "text",  "x": 0,  "y": 50, "w": 213, "value": "Fecha: {date}  Lote: {lote}  QTY: {qty}", "size": 7, "align": "center" },
    { "type": "qr",    "x": 66, "y": 60, "w": 80,  "value": "{sku}.{date}.{qty}.{lote}" },
    { "type": "text",  "x": 0,  "y": 128, "w": 213, "value": "{sku}.{date}.{qty}.{lote}", "size": 6, "align": "center" }
  ]
}
```

- Unidades en **puntos** (1/72"), igual que pdfkit. `large` = 212.6 × 141.7 pt (7.5 × 5 cm); `standard` = 93.6 × 72 pt (1.3" × 1").
- Las dos plantillas actuales (standard y large) se cargan como **plantillas por defecto** para que el arranque sea idéntico a hoy.
- El QR conserva el formato `SKU.FECHA.QTY.LOTE` por defecto; es editable por si un cliente exige otro.
- Al aprobar un job se **congela una copia** de la plantilla en `jobs.label_template`: lo que se imprimió para ese lote es reproducible aunque la plantilla del SKU cambie después.


---

## 12. Asistente de alta de SKU — implementado (Fase 2)

Seis pasos guiados. Cada uno **bloquea el siguiente** hasta cumplirse: el objetivo es que
un ingeniero de proceso lo haga sin saber comandos y sin poder saltarse una validación.

| # | Paso | Qué valida | Bloquea si |
|---|---|---|---|
| 1 | **SKU** | Código, descripción, standard pack, etiquetas por pack, tamaño | Falta el código |
| 2 | **Tester** | Elegir el equipo dedicado. Avisa si ya está vinculado a otro SKU y si se reinició por `BROWNOUT` | No hay tester conectado |
| 3 | **Unidades** | ¿Cuántos canales necesita el arnés? Compara con las unidades enlazadas | Faltan o sobran hijos |
| 4 | **Validar módulos** | Con el arnés **DESCONECTADO**: `api/selfcheck` sobre las 96 líneas | Hay algún pin pegado |
| 5 | **Capturar golden** | Con el arnés bueno: `api/map`, muestra los nets para revisión | No hay captura válida |
| 6 | **Guardar** | Resumen y commit atómico | Sin operador fijado |

### 12.1 Por qué el paso 4 es obligatorio

Si un pin está pegado a GND y se captura el golden así, **el defecto queda congelado** como
«así es este producto» — y después todos los arneses buenos son rechazados. Fue exactamente
el fallo de la vía huérfana en U2 P04, que costó una revisión de PCB.

El self-check es **digital**, no usa el MUX+ADC: por eso cubre las 96 líneas a través del
enlace, mientras que `leaktest` solo ve la unidad local.

### 12.2 Guía para enlazar hijos

Si faltan unidades, el paso 3 muestra las instrucciones exactas: abrir la web del master,
`link_pair`, encender la unidad dentro de 60 s, esperar el magenta. Incluye la alternativa
sin radio (`link_master <MAC>` por USB).

### 12.3 Commit atómico

`POST /api/wizard/commit` guarda en **una transacción**: SKU, fixture, job aprobado, MACs de
todas las unidades y vínculo con el tester. Retira automáticamente el golden anterior del SKU.

Sin transacción se podría quedar un SKU con job pero sin tester asignado (o al revés), y eso
en producción sería un rechazo incomprensible para el operador.
