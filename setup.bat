@echo off
setlocal EnableDelayedExpansion
title Cable Tester 32 - Setup

echo.
echo  +-------------------------------------------+
echo  ^|  Cable Tester 32CH  -  App de produccion  ^|
echo  +-------------------------------------------+
echo.

cd /d "%~dp0"

:: ===========================================================================
::  [1/5]  Node
:: ===========================================================================
:: La app necesita Node 22.5 o superior porque usa node:sqlite, el SQLite
:: integrado. Con una version mas vieja el bridge arranca y revienta al abrir
:: la base, asi que la version se comprueba ANTES de instalar nada.
echo  [1/5] Buscando Node 22.5 o superior...
call :find_node
if defined NODEDIR goto :node_ok

echo.
echo  No hay un Node valido en este equipo.
echo.
echo  Se puede instalar automaticamente una copia LOCAL en la carpeta
echo  .node de este proyecto: unos 30 MB, no toca el sistema y no pide
echo  permisos de administrador.
echo.
set /p INSTALLNODE=  Instalar Node ahora? [S/n]:
if /i "%INSTALLNODE%"=="n" goto :node_manual

echo.
echo  Descargando Node LTS...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }; $rel = (Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object { $_.lts -ne $false } | Select-Object -First 1; $v = $rel.version; $name = ('node-{0}-win-{1}' -f $v, $arch); $zip = Join-Path $env:TEMP ($name + '.zip'); Invoke-WebRequest -Uri ('https://nodejs.org/dist/{0}/{1}.zip' -f $v, $name) -OutFile $zip -UseBasicParsing; if (Test-Path '.node-tmp') { Remove-Item '.node-tmp' -Recurse -Force }; if (Test-Path '.node') { Remove-Item '.node' -Recurse -Force }; Expand-Archive -Path $zip -DestinationPath '.node-tmp' -Force; Move-Item (Join-Path '.node-tmp' $name) '.node'; Remove-Item '.node-tmp' -Recurse -Force; Remove-Item $zip -Force; Write-Host ('  Node ' + $v + ' instalado en .node')"
if errorlevel 1 goto :node_winget

call :find_node
if defined NODEDIR goto :node_ok

:node_winget
:: La copia local fallo (sin red, proxy o antivirus). Segundo intento: winget,
:: que instala en el sistema y puede pedir elevacion.
echo.
echo  La copia local no se pudo instalar. Probando con winget...
where winget >nul 2>&1
if errorlevel 1 goto :node_manual
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto :node_manual
:: winget solo actualiza el PATH de los procesos NUEVOS: esta ventana no lo ve.
call :find_node
if defined NODEDIR goto :node_ok
echo.
echo  Node quedo instalado pero esta ventana todavia no lo ve.
echo  Cierra esta ventana y vuelve a ejecutar setup.bat.
echo.
pause
exit /b 0

:node_manual
echo.
echo  [ERROR] No se pudo instalar Node automaticamente.
echo.
echo  Instalalo a mano desde:
echo    https://nodejs.org/en/download
echo  Hace falta la version 22.5 o superior. Luego vuelve a ejecutar setup.bat.
echo.
start https://nodejs.org/en/download
pause
exit /b 1

:node_ok
set "PATH=%NODEDIR%;%PATH%"
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODEVER=%%v"
echo  Node %NODEVER%  --  %NODEDIR%

:: ===========================================================================
::  [2/5]  Dependencias de la app
:: ===========================================================================
echo.
echo  [2/5] Instalando dependencias de la app...
echo  Son unos 400 MB la primera vez. No cierres esta ventana.
echo.
if not exist "package-lock.json" goto :npm_install
if exist "node_modules" goto :npm_install
call npm ci --no-audit --no-fund
if not errorlevel 1 goto :npm_ok
echo.
echo  npm ci no cuadro con el lockfile. Reintentando con npm install...

:npm_install
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo  [ERROR] Fallo la instalacion de dependencias.
    echo  Revisa la conexion a internet y vuelve a ejecutar setup.bat.
    pause
    exit /b 1
)

:npm_ok
echo  Dependencias instaladas.

:: ===========================================================================
::  [3/5]  Compilar la UI
:: ===========================================================================
:: El bridge sirve dist\. Sin compilar arranca igual, pero la pagina sale en
:: blanco y el operador no tiene forma de saber por que.
echo.
echo  [3/5] Compilando la UI...
call npm run build
if errorlevel 1 (
    echo.
    echo  [ERROR] Fallo la compilacion de la UI.
    pause
    exit /b 1
)
echo  UI compilada en dist\.

:: ===========================================================================
::  [4/5]  Python para las herramientas de linea de comandos
:: ===========================================================================
:: La app NO necesita Python: el motor de medida esta portado a Node. Python
:: solo hace falta para tools\ (OTA, descubrimiento, sweep, analog), que vive
:: en el proyecto hermano CableTester32. Si no esta, este paso se omite y la
:: app sigue siendo utilizable.
set "TOOLSDIR=%~dp0..\CableTester32"
echo.
echo  [4/5] Herramientas de linea de comandos (Python)...
if not exist "%TOOLSDIR%\tools\requirements.txt" (
    echo  No se encontro ..\CableTester32\tools -- se omite este paso.
    echo  La app funciona sin el; solo faltaran el OTA y los scripts de medida.
    goto :verify
)

call :find_python
if defined PY goto :python_ok

echo  Python no esta instalado.
set /p INSTALLPY=  Instalarlo con winget (hace falta para el OTA)? [S/n]:
if /i "%INSTALLPY%"=="n" (
    echo  Omitido. Puedes instalarlo luego y volver a ejecutar setup.bat.
    goto :verify
)
where winget >nul 2>&1
if errorlevel 1 (
    echo  winget no esta disponible. Instala Python a mano desde:
    echo    https://www.python.org/downloads/
    echo  Marca "Add Python to PATH" durante la instalacion.
    goto :verify
)
winget install -e --id Python.Python.3.12 --scope machine --accept-source-agreements --accept-package-agreements
call :find_python
if not defined PY (
    echo.
    echo  Python quedo instalado pero esta ventana todavia no lo ve.
    echo  Cierra esta ventana y vuelve a ejecutar setup.bat para terminar
    echo  de preparar las herramientas.
    goto :verify
)

:python_ok
for /f "tokens=2" %%v in ('"%PY%" --version 2^>^&1') do set "PYVER=%%v"
echo  Python %PYVER% encontrado.
"%PY%" -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" 2>nul
if errorlevel 1 (
    echo  [AVISO] Se necesita Python 3.10 o superior. Encontrado %PYVER%.
    echo  Se omiten las herramientas.
    goto :verify
)

if not exist "%TOOLSDIR%\.venv" (
    echo  Creando entorno virtual en ..\CableTester32\.venv ...
    "%PY%" -m venv "%TOOLSDIR%\.venv"
    if errorlevel 1 (
        echo  [AVISO] No se pudo crear el entorno virtual. Se omite.
        goto :verify
    )
) else (
    echo  El entorno virtual ya existe -- se reutiliza.
)
"%TOOLSDIR%\.venv\Scripts\python.exe" -m pip install --upgrade pip --quiet
"%TOOLSDIR%\.venv\Scripts\python.exe" -m pip install -r "%TOOLSDIR%\tools\requirements.txt" --quiet
if errorlevel 1 (
    echo  [AVISO] Algunas dependencias de Python no se instalaron.
) else (
    echo  Herramientas listas: esptool, pyserial, zeroconf.
)

:: ===========================================================================
::  [5/5]  Verificacion
:: ===========================================================================
:verify
echo.
echo  [5/5] Verificando...
node -e "require('node:sqlite'); console.log('  node:sqlite OK')"
if errorlevel 1 (
    echo  [AVISO] Este Node no trae node:sqlite. El bridge no podra abrir la
    echo  base de datos. Hace falta Node 22.5 o superior.
)
if exist "dist\index.html" (echo   dist\index.html OK) else (echo   [AVISO] falta dist\index.html)
if exist "bridge\index.js" (echo   bridge\index.js OK) else (echo   [AVISO] falta bridge\index.js)

echo.
echo  ===========================================================
echo   Setup terminado.
echo.
echo   Para arrancar la app:
echo     doble clic en  run.bat     (abre http://localhost:3001)
echo.
if exist "%TOOLSDIR%\.venv\Scripts\python.exe" (
    echo   Herramientas de linea de comandos:
    echo     cd ..\CableTester32
    echo     .venv\Scripts\activate
    echo     python tools\ct.py --list
    echo.
)
echo   Antes de producir: revisa los SKU con codigo TODO- en la
echo   pestana SKUs, salen marcados en ambar.
echo  ===========================================================
echo.
pause
exit /b 0


:: ===========================================================================
::  Subrutinas
:: ===========================================================================

:: --- Localiza un Node 22.5 o superior ---------------------------------------
:: Deja NODEDIR con la carpeta que contiene node.exe, o sin definir.
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
:: %1 = ruta a node.exe (o la palabra node). errorlevel 0 si es 22.5 o mayor.
:: Comparar la cadena no vale: "v9" es mayor que "v22" alfabeticamente.
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

:: --- Localiza un Python usable ----------------------------------------------
:: Deja PY con la ruta del interprete, o sin definir. Se prueba primero el
:: lanzador py, que encuentra instalaciones que NO estan en el PATH: el estado
:: normal despues de instalar desde winget o la Store.
:find_python
set "PY="
for /f "delims=" %%P in ('py -3 -c "import sys;print(sys.executable)" 2^>nul') do set "PY=%%P"
if defined PY exit /b 0
python -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>&1
if not errorlevel 1 (
    for /f "delims=" %%P in ('python -c "import sys;print(sys.executable)" 2^>nul') do set "PY=%%P"
)
if defined PY exit /b 0
for %%D in (
    "%LocalAppData%\Programs\Python\Python313\python.exe"
    "%LocalAppData%\Programs\Python\Python312\python.exe"
    "%LocalAppData%\Programs\Python\Python311\python.exe"
    "%ProgramFiles%\Python313\python.exe"
    "%ProgramFiles%\Python312\python.exe"
    "%ProgramFiles%\Python311\python.exe"
) do (
    if exist %%D (set "PY=%%~D" & exit /b 0)
)
exit /b 1
