# Cable Tester 32CH (ESP32) — App de producción

App local para validar arneses con el tester ESP32 (firmware v0.6+), registrar
trazabilidad e imprimir etiquetas.

> **Viene de [`cable-test-scribe`](https://github.com/DecoTT/cable-test-scribe)**, la
> app del tester anterior — su historia está en este repositorio, debajo de la
> primera versión ESP32. Aquel sigue en producción con el tester viejo y **no se
> mantiene compatibilidad** entre los dos: son equipos distintos.
>
> Ver [PLAN.md](PLAN.md) para el diseño completo y la lista de bugs del proyecto
> anterior que **no** se portaron.

> **Necesita el repositorio hermano** [`cable-tester-esp32`](https://github.com/DecoTT/cable-tester-esp32)
> (firmware, herramientas y documentación) clonado **al lado**, en la misma
> carpeta padre: `setup.bat` busca sus herramientas de Python en
> `..\CableTester32	ools`.

---

## Arrancar

En una PC de producción, sin tocar nada más:

```
setup.bat     # una vez: instala Node si falta, dependencias, compila la UI
run.bat       # cada día: bridge + UI y abre http://localhost:3001
```

`setup.bat` no necesita permisos de administrador: si el equipo no tiene un
Node ≥ 22.5, baja una copia **local** a `.node\` que usa solo esta app.
También prepara el `.venv` de `../CableTester32/tools` (OTA y scripts de
medida) si ese proyecto está al lado.

A mano, si ya tienes el entorno montado:

```bash
npm install
npm run build     # compila la UI
npm start         # bridge + UI en http://localhost:3001
```

**Desarrollo** (recarga en caliente):

```bash
npm run dev       # UI en :8080 con proxy al bridge en :3001
```

Requiere **Node ≥ 22.5** — usa `node:sqlite`, el SQLite integrado, así que no
hay compilación nativa en Windows.

---

## Arquitectura en una línea

**El navegador nunca habla con el ESP32. Solo el bridge.**

```
Navegador ──HTTP/WS──► Bridge (Node) ──HTTP LAN o USB serial──► ESP32 master ──ESP-NOW──► hijos
                        · SQLite
                        · Impresión
                        · Descubrimiento mDNS
```

El bridge consume **solo** `/api/*` del firmware (JSON versionado, `api=1`).
Nunca parsea el texto de `/cmd`, que es para humanos y cambia.

---

## Estado

| Fase | Qué | Estado |
|---|---|---|
| 0 | Base: React+shadcn, bridge sirviendo el SPA, SQLite | ✅ |
| 1 | Conexión al tester: mDNS + IP manual + USB, estado en vivo | ✅ |
| 2 | SKUs, fixtures, captura y aprobación de goldens | ✅ |
| 3 | Corrida de producción completa | ✅ |
| 4 | Etiquetas + standard pack + lotes; editor visual de plantilla | ✅ |
| 5 | Logs, auditoría, exportación CSV/JSON | ✅ |
| 6 | Diagrama del arnés con la falla resaltada, Electron | pendiente |

La fase 3 **ya no necesita firmware nuevo**: el motor de medida está portado a
Node y la PC orquesta por HTTP, así que `POST /api/test` en el ESP32 dejó de
hacer falta. Lo mismo con el mapeo de 96 canales, que era el otro motivo de la
fase 6.

**Pendiente de verdad:** el diagrama del arnés con la falla resaltada, y
empaquetar como Electron. Diagnóstico ya dice a qué conector ir y de qué tipo es
el fallo; el dibujo es el siguiente escalón, no un sustituto.

---

## Impresión

**No hay interruptor: la impresora elegida ES el interruptor.** En Configuración
se elige una y queda como predeterminada para todas las etiquetas; dejando
**«Ninguna — solo PDF»**, el PDF se genera igual en `data/labels/` y no se
imprime nada.

Antes existía un `print_enabled` aparte, y servía para que en planta eligieran
impresora, no saliera nada y nadie entendiera por qué.

El PDF **se guarda siempre**, se imprima o no, y se puede reimprimir. La vista
previa no es un modo de desarrollo: sirve para revisar antes de gastar etiqueta.

---

## Datos

Todo en `data/` — **no va al repo**:

```
data/cabletester.db     SQLite: SKUs, jobs, pruebas, lotes, auditoría
data/goldens/           goldens capturados
data/fixtures/          mapas de socket aprendidos
data/labels/            PDFs generados
data/backups/           respaldos
```

La PC es la fuente de verdad. El tester no guarda nada irreemplazable: si se
borra su NVS, se reconfigura desde aquí y a seguir.

`CT32_DATA=<ruta>` apunta la app a otra carpeta de datos: sirve para probar una
importación contra una copia, o para tener dos estaciones en la misma PC.

### Mudanza a otra estación

El código viaja por git; los datos **no**. Para montar una estación nueva:

1. Clonar el repo y ejecutar `setup.bat`.
2. En la estación de origen: **Configuración → Datos de la estación → Exportar**.
   Sale un `.ct32.json` con SKUs, jobs, goldens, sockets, equipos, operadores,
   ajustes y —si se quiere— el historial de producción.
3. En la nueva: **Importar** ese fichero.

Lo que **no** viaja, a propósito:

- Los PDFs ya generados: se regeneran solos.
- `printer_name` y `bridge_port`: son de la máquina. Importar el nombre de una
  impresora que allí no existe deja la estación imprimiendo al vacío.

Importar **reemplaza** por clave primaria, así que antes copia la base en
`data/backups/`. Si algo falla a mitad, se deshace entera: una importación a
medias es peor que ninguna, porque parece que funcionó.

> Los goldens viajan **dentro** del fichero, no por referencia. Un job sin su
> golden no puede juzgar ninguna pieza.

---

## Switch físico (disparador)

Un interruptor cableado al módulo ESP32 que **ejecuta la prueba** sin tocar la
pantalla. No todos los puestos lo necesitan, así que viene **desactivado**. Se
configura en `Configuración → ⋮ del equipo → Ver detalles`.

La configuración vive en la **NVS del propio ESP32**, no en esta PC: sobrevive a
reinicios y a un OTA, y viaja con el equipo si cambia de estación. Por eso el
diálogo la lee del equipo cada vez que se abre, en vez de fiarse de lo que la
app creía saber.

| Pin | Estado |
|---|---|
| IO4, IO5 | Libres. La serigrafía dice LINK_RX/LINK_TX, pero ese UART está reservado y **sin implementar**: no hay una línea de código que los use |
| IO6, IO7 | Libres, sin doble uso — los recomendados |
| IO10 | Ya lleva el botón BTN_START de la placa; usarlo aquí le quita el parpadeo de IP |
| IO0-2, IO3, IO8-9, IO18-19 | **Ocupados**: 74HC595, ADC, I²C y USB. El firmware los rechaza |

Con nivel activo **BAJO** basta cablear el switch entre el pin y GND: la
resistencia de pull-up la pone el ESP32.

> **Cómo se escribe, y por qué así.** El firmware publica el disparador en
> `/api/status`, pero **no tiene endpoint JSON para escribirlo**: solo el
> comando de consola `trigger`. El bridge lo manda por `/cmd` **sin mirar la
> respuesta** —la regla de no parsear el texto de `/cmd` sigue intacta— y
> confirma el cambio **releyendo `/api/status`**. Si el firmware lo rechazó
> (pin ocupado), el estado no cambia y la app avisa en vez de dar por buena una
> escritura que no ocurrió. Comprobado: pedir IO8 falla con mensaje claro.
>
> Lo limpio sería un `POST /api/trigger` en el firmware. Es media hora de
> trabajo más compilar y OTA a las cuatro unidades; la API del bridge no
> cambiaría.

---

## El botón físico

Un pulsador entre **IO4 y GND** (normalmente abierto) ejecuta **la misma prueba
que el botón de la pantalla**, con el SKU y el operador que estén puestos. Se
configura en `Configuración → ⋮ del equipo → Ver detalles`. Necesita firmware
**1.7.0** o superior.

El equipo **no** prueba por su cuenta: solo cuenta la pulsación, y mide la PC,
que es donde vive el golden. Por eso funciona igual con una unidad que con tres.

La pantalla no hace falta para que dispare —el bridge guarda el producto y el
operador activos en `settings`— pero si no hay ninguno de los dos, avisa y no
prueba: una pieza sin operador no es trazable.

Si alguien dice «pulsé y no pasó nada», la respuesta está en la consola del
bridge: cada pulsación deja una línea `[boton] …`.

---

## Lotes y etiquetas — se cuentan las BUENAS

El operador separa el material bueno del malo; la app no necesita saber qué
pieza es cuál. Lo único que cuenta es cuántas **buenas** lleva el lote.

Con standard pack de 10: probar 12 con 2 malas saca la etiqueta **al llegar a
10 buenas**, con `QTY: 10`. La bolsa incompleta espera al cierre del lote, que
es cuando se sabe que ya no entran más piezas, y se etiqueta con su cantidad
**real** — una bolsa que dice 10 y trae 7 es un problema en recepción.

Sale sola, sin volver a la pantalla: es lo que cierra el ciclo del botón físico.
Se desactiva en Configuración si prefieres pedirla a mano.

Al cerrar el lote **no se repiten** las bolsas que ya salieron: cuatro etiquetas
para dos bolsas son piezas contadas dos veces. Una reimpresión sí rehace todo,
que para eso se pide.

---

## Diagnóstico y logs

**Diagnóstico** responde a dos preguntas que el veredicto no contesta:

- *¿Abierto o pegado a masa?* En el mapa se ven **igual** —los dos salen como
  canal aislado— y se arreglan distinto: un abierto es un crimp, un corto a masa
  es un pin corrido o una rebaba. Se eligen una pieza fallida y se **mide otra
  vez** sobre el tester, con el arnés puesto. Medido: 32 canales en 2,1 s.
- *¿Dónde duele?* Las líneas que más fallan, agrupadas **por línea y no por
  pieza**: repetirse en la misma es utillaje, repartirse es proceso.

Dentro de Diagnóstico, el botón **Avanzado** abre el *osciloscopio lento*:
voltios reales por línea, una gráfica por cada línea del golden.

**No es integridad de señal.** El techo medido son **3,09 ms por muestra**
(~324 muestras/s), porque cada lectura del ADC promedia 64. No hay diagrama de
ojo ni tiempo de subida: el flanco de un arnés son decenas de nanosegundos.

Lo que mide es el **nivel** y su **estabilidad**, y con eso basta:

```
J00 -> J16   3300 mV   desviación   0,0 mV   unida
J02 -> J18   1842 mV   desviación 335,0 mV   AL AIRE
```

Un pin conectado sigue al excitador y no se mueve; uno al aire vaga por
acoplamiento. Sacude el arnés mientras mide y un **contacto intermitente** sale
en la traza aunque una prueba suelta lo apruebe.

La vista de **acoplamiento** enseña por qué el barrido exige dos muestras que
coincidan: con `M.J00` excitado, dos canales que no tocan nada marcan 2,4 V.

**Logs** saca de la base lo que antes solo se veía abriendo SQLite: auditoría
(quién aprobó qué golden, quién cambió qué ajuste), pruebas y etiquetas, por
rango de fechas, con CSV y JSON **de lo que hay en pantalla** — si exportara
todo, filtrar no serviría de nada. El CSV lleva BOM para que Excel no destroce
los acentos.

---

## Plantillas de etiqueta

JSON por SKU, con variables propias (`cliente`, `parte`, lo que haga falta) que
se sustituyen con `{nombre}` junto a los datos de la corrida (`{sku}`, `{date}`,
`{qty}`, `{lote}`, `{qr}`). Unidades en puntos (1/72"), como pdfkit.

Al aprobar un job se **congela una copia** de la plantilla: lo que se imprimió
para ese lote es reproducible aunque la plantilla del SKU cambie después.

**El texto que no cabe se encoge, y si ni así entra se recorta con puntos
suspensivos.** pdfkit con `lineBreak:false` no avisa: el sobrante se sale por el
borde y el PDF sale igual de «bien». Medido sobre la plantilla anterior, un SKU
de 17 caracteres a 18 pt ocupaba 204,3 de los 204,6 pt disponibles, y la línea
del QR con un lote con fecha se iba a 209,5. Recortado se ve; desbordado no.

Se edita en **Etiquetas**, con editor visual y JSON **sobre la misma
plantilla**: el formulario para colocar sin pelearse con llaves, el JSON para
pegar una entera o tocar lo que el formulario no cubra. La verdad es el objeto;
el texto se regenera salvo mientras se escribe en él, para que el cursor no
salte a cada tecla.

Hay una tercera plantilla, `device`: etiqueta el **equipo**, no la pieza. Se
genera desde Etiquetas eligiendo una unidad, y sus datos (unidad, MAC, IP,
firmware) salen del registro y del descubrimiento mDNS — no se teclean.

Ver [PLAN.md §11](PLAN.md).
