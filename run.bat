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

rem El navegador se abre en otra ventana y con unos segundos de retraso, para
rem que el bridge ya este escuchando cuando cargue la pagina.
start "" cmd /c "timeout /t 3 >nul & start "" http://localhost:%PORT%/"

echo  Bridge + UI en http://localhost:%PORT%/
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
