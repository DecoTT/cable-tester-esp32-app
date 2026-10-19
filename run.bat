@echo off
setlocal EnableDelayedExpansion
title Cable Tester 32 - App

rem %~dp0 = la carpeta donde vive ESTE run.bat, nunca una ruta fija.
rem (En Eyve el setup GENERABA el run.bat con la ruta ya expandida, y la copia
rem  del run.bat en otra carpeta lanzaba el proyecto equivocado. Aqui run.bat
rem  se escribe a mano y resuelve todo en tiempo de ejecucion.)
cd /d "%~dp0"

echo.
echo  Cable Tester 32CH  -  arrancando...
echo.

call :find_node
if not defined NODEDIR (
    echo  [ERROR] No encuentro un Node 22.5 o superior.
    echo.
    echo  Ejecuta primero  setup.bat
    echo.
    pause
    exit /b 1
)
set "PATH=%NODEDIR%;%PATH%"

rem Sin parentesis dentro de los bloques if: un ")" en el texto de un echo
rem cierra el bloque antes de tiempo y cmd muere con "No se esperaba . en
rem este momento". Paso aqui con "(no hay node_modules)".
if not exist "node_modules" (
    echo  [ERROR] Faltan las dependencias: no hay carpeta node_modules.
    echo.
    echo  Ejecuta primero  setup.bat
    echo.
    pause
    exit /b 1
)

if not exist "dist\index.html" (
    echo  [AVISO] La UI no esta compilada: el navegador vera una pagina en
    echo  blanco. Compilando ahora...
    call npm run build
    if errorlevel 1 (
        echo  [ERROR] Fallo la compilacion. Ejecuta setup.bat.
        pause
        exit /b 1
    )
)

rem El puerto por defecto del bridge es 3001. Si se cambio en Ajustes, el valor
rem vive en la base de datos y esta ventana no lo sabe: abre la direccion que
rem imprima el bridge unas lineas mas abajo.
if not defined PORT set "PORT=3001"

rem Puerto ya ocupado: decirlo en cristiano.
rem
rem Si la ventana anterior se cerro sin Ctrl+C, el node puede seguir vivo y
rem quedarse con el puerto. Sin esto, el arranque muere con un volcado de Node
rem -EADDRINUSE y veinte lineas de pila- que no le dice nada a quien esta en
rem planta, y ademas la ventana se cierra sola tras el mensaje.
set "OCUPADO="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /c:"LISTENING" ^| findstr /c:":%PORT% "') do set "OCUPADO=%%P"
if defined OCUPADO (
    echo  [ERROR] El puerto %PORT% ya lo tiene el proceso !OCUPADO!.
    echo.
    echo  Lo normal es que la app ya este abierta en otra ventana. Usa esa.
    echo.
    echo  Si no es asi, quedo un proceso colgado. Para cerrarlo:
    echo      taskkill /PID !OCUPADO! /F
    echo.
    echo  Y vuelve a ejecutar run.bat.
    echo.
    pause
    exit /b 1
)

rem El navegador se abre cuando el bridge RESPONDE, no a los N segundos.
rem
rem Antes eran 3 segundos fijos, y en el primer arranque pueden no llegar:
rem abrir la base, crear las tablas y arrancar mDNS lleva mas en una maquina
rem recien preparada.
rem
rem OJO: el 'localhost rechazo la conexion' que se veia NO era por esto. Era
rem que 'localhost' resuelve primero a ::1 (IPv6) y el bridge solo escucha en
rem 127.0.0.1. Por eso aqui se abre 127.0.0.1 y no localhost. La espera es una
rem mejora aparte, para el arranque en frio.
rem
rem Se consulta la pagina de verdad, no solo si el puerto acepta conexiones:
rem el puerto empieza a escuchar un instante antes de que haya nada servido.
rem Hasta 60 s, y si no llega no se abre nada — el error se lee en esta ventana.
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$u='http://127.0.0.1:%PORT%/'; for($i=0; $i -lt 120; $i++) { try { $r=Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 2; if ($r.StatusCode -eq 200) { Start-Process $u; exit } } catch { }; Start-Sleep -Milliseconds 500 }"

echo  Bridge + UI en http://127.0.0.1:%PORT%/
echo  Para cerrar la app: Ctrl+C en esta ventana, o cierrala.
echo.

node bridge\index.js

echo.
echo  El bridge se detuvo.
pause
exit /b 0


:: ===========================================================================
::  Subrutinas (misma logica que setup.bat: run.bat tiene que poder arrancar
::  sin haber generado ningun fichero intermedio)
:: ===========================================================================

:: --- Localiza un Node 22.5 o superior ---------------------------------------
:: La copia local .node va PRIMERO: si el equipo tiene un Node viejo en el
:: PATH, la copia local es la que manda.
:find_node
set "NODEDIR="
if exist "%~dp0.node\node.exe" (
    call :node_ver_ok "%~dp0.node\node.exe"
    if not errorlevel 1 (
        set "NODEDIR=%~dp0.node"
        exit /b 0
    )
)
where node >nul 2>&1
if errorlevel 1 exit /b 1
call :node_ver_ok "node"
if errorlevel 1 exit /b 1
for /f "delims=" %%P in ('where node') do (
    set "NODEDIR=%%~dpP"
    goto :fn_got
)
:fn_got
if not defined NODEDIR exit /b 1
:: %%~dpP termina en barra; se quita para poder componer "%NODEDIR%\node.exe".
set "NODEDIR=!NODEDIR:~0,-1!"
exit /b 0

:: --- La version de Node es suficiente? --------------------------------------
:: El bridge usa node:sqlite, que llego en 22.5. Comparar la cadena no vale:
:: "v9" es mayor que "v22" alfabeticamente.
:node_ver_ok
set "NMAJ="
set "NMIN="
for /f "tokens=1,2 delims=v." %%a in ('%1 -v 2^>nul') do (
    set "NMAJ=%%a"
    set "NMIN=%%b"
)
if not defined NMAJ exit /b 1
if !NMAJ! GTR 22 exit /b 0
if !NMAJ! LSS 22 exit /b 1
if !NMIN! GEQ 5 exit /b 0
exit /b 1
