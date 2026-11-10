@echo off
setlocal EnableDelayedExpansion
title Cable Tester 32 - Actualizando
cd /d "%~dp0"

echo.
echo  Cable Tester 32CH  -  actualizando
echo.

rem Esta ventana la abre la propia app, que esta a punto de cerrarse sola unas
rem lineas mas abajo. Por eso el trabajo se hace AQUI y no dentro del bridge:
rem un proceso no puede pararse a si mismo a mitad de actualizarse.

where git >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] No hay git en este equipo, asi que no se puede actualizar solo.
    echo.
    echo  Descarga el proyecto de nuevo desde:
    echo    https://github.com/DecoTT/cable-tester-esp32-app
    echo.
    pause
    exit /b 1
)

if not exist ".git" (
    echo  [ERROR] Esta carpeta no se descargo con git -- seguramente es un ZIP.
    echo.
    echo  Descarga el proyecto de nuevo desde:
    echo    https://github.com/DecoTT/cable-tester-esp32-app
    echo.
    pause
    exit /b 1
)

rem Codigo editado a mano: actualizar lo perderia. Se para aqui y se avisa, en
rem vez de descubrirlo cuando el pull falle a medias.
rem
rem --untracked-files=no a proposito: solo cuentan los archivos que git SIGUE.
rem Los datos de la estacion -base, goldens, fixtures, etiquetas, respaldos-
rem estan en .gitignore y el pull NO los toca. Un archivo suelto en la carpeta
rem de datos saldria como "?? data/" y bloquearia la actualizacion por nada.
set "SUCIO="
for /f "delims=" %%L in ('git status --porcelain --untracked-files^=no') do set "SUCIO=1"
if defined SUCIO (
    echo  [ERROR] Alguien edito el codigo de esta carpeta:
    echo.
    git status --short --untracked-files=no
    echo.
    echo  Actualizar perderia esos cambios. Guardalos o deshazlos antes.
    echo  Los datos de la estacion no tienen nada que ver: la base, los goldens
    echo  y el historial no se tocan al actualizar.
    echo.
    pause
    exit /b 1
)

if not defined PORT set "PORT=3001"

echo  Cerrando la app...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /c:"LISTENING" ^| findstr /c:":%PORT% "') do (
    taskkill /PID %%P /F >nul 2>&1
)
rem Un momento para que suelte el puerto y la base de datos.
ping -n 3 127.0.0.1 >nul

echo  Descargando cambios...
git pull --ff-only
if errorlevel 1 (
    echo.
    echo  [ERROR] No se pudieron descargar los cambios.
    echo  Revisa la conexion a internet. La app se vuelve a abrir sin actualizar.
    echo.
    pause
    goto :arrancar
)

echo.
echo  Instalando dependencias...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo  [ERROR] Fallo la instalacion de dependencias.
    echo  La app se vuelve a abrir, pero puede no funcionar bien.
    echo  Ejecuta setup.bat para repararla.
    echo.
    pause
    goto :arrancar
)

echo.
echo  Compilando la interfaz...
call npm run build
if errorlevel 1 (
    echo.
    echo  [ERROR] Fallo la compilacion. Ejecuta setup.bat.
    echo.
    pause
    goto :arrancar
)

echo.
echo  Actualizado a:
git log -1 --format="    %%h  %%s"
echo.

:arrancar
rem Se vuelve a abrir SIEMPRE, incluso si algo fallo: dejar la estacion sin app
rem por una actualizacion que no salio es peor que seguir con la version vieja.
echo  Abriendo la app...
start "" "%~dp0run.bat"
exit /b 0
