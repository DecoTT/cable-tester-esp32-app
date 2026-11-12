@echo off
setlocal EnableDelayedExpansion
title Cable Tester 32 - Actualizando

rem ACTUALIZAR SIN GIT
rem
rem La estacion de planta se instala descomprimiendo el ZIP de GitHub, y una
rem copia asi no se puede actualizar con "git pull" porque no hay .git. Hasta
rem ahora eso obligaba a que alguien se acordara de reinstalarla a mano, y por
rem eso Guadalajara estuvo semanas con un fallo ya corregido.
rem
rem Aqui se hacen las dos: si la carpeta es un clon, git pull; si es un ZIP, se
rem baja el ZIP de nuevo y se pone encima. En los dos casos data/ NO SE TOCA:
rem la base, los goldens, los fixtures y el historial estan fuera del repo, asi
rem que ni el pull ni el ZIP los llevan dentro.

rem ── Trabajar desde una COPIA en el temporal ────────────────────────────────
rem
rem Un .bat NO puede sobreescribirse a si mismo mientras corre: cmd.exe lo lee
rem por posicion de byte segun avanza, no lo carga entero. Si la actualizacion
rem pisa este fichero a mitad, cmd sigue leyendo en el offset viejo del fichero
rem nuevo y ejecuta basura. Por eso este script se copia al temporal y es la
rem copia la que hace el trabajo.
if /i not "%CT32_RELANZADO%"=="1" (
    set "CT32_RELANZADO=1"
    set "CT32_RAIZ=%~dp0"
    rem Nombre distinto cada vez. Con un nombre fijo, una ventana de una
    rem actualizacion anterior que siguiera abierta -esperando un "pulse una
    rem tecla" tras un error- deja el fichero en uso, la copia falla y la
    rem actualizacion no arranca. Visto en pruebas.
    set "CT32_BAT=%TEMP%\ct32-actualizar-%RANDOM%%RANDOM%.bat"
    copy /y "%~f0" "!CT32_BAT!" >nul
    if errorlevel 1 (
        echo  [ERROR] No pude prepararme en la carpeta temporal.
        pause
        exit /b 1
    )
    start "" cmd /c ""!CT32_BAT!""
    exit /b 0
)

cd /d "%CT32_RAIZ%."
if errorlevel 1 (
    echo  [ERROR] No encuentro la carpeta de la app: %CT32_RAIZ%
    pause
    exit /b 1
)

echo.
echo  Cable Tester 32CH  -  actualizando
echo.
echo  Carpeta: %CT32_RAIZ%
echo.

set "REPO=DecoTT/cable-tester-esp32-app"
if not defined PORT set "PORT=3001"

rem ── Cerrar la app ──────────────────────────────────────────────────────────
echo  Cerrando la app...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /c:"LISTENING" ^| findstr /c:":%PORT% "') do (
    taskkill /PID %%P /F >nul 2>&1
)
rem Un momento para que suelte el puerto y la base de datos.
ping -n 3 127.0.0.1 >nul

rem ── Traer los cambios ──────────────────────────────────────────────────────
if exist ".git" goto :porgit
goto :porzip

:porgit
where git >nul 2>&1
if errorlevel 1 (
    echo  [AVISO] Es un clon de git pero no hay git instalado. Se baja el ZIP.
    goto :porzip
)
rem Codigo editado a mano: actualizar lo perderia. Se para aqui y se avisa.
rem
rem --untracked-files=no a proposito: solo cuentan los archivos que git SIGUE.
rem Los datos de la estacion estan en .gitignore y el pull NO los toca. Un
rem archivo suelto en data/ saldria como "?? data/" y bloquearia por nada.
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
echo  Descargando cambios (git)...
git pull --ff-only
if errorlevel 1 (
    echo.
    echo  [ERROR] No se pudieron descargar los cambios.
    echo  Revisa la conexion a internet. La app se vuelve a abrir sin actualizar.
    echo.
    pause
    goto :arrancar
)
goto :dependencias

:porzip
rem Se apunta QUE commit es el ultimo ANTES de bajar el ZIP, y ese es el que
rem se sella despues. El orden importa: si alguien publica algo entre la
rem descarga y el sello, sellar "lo ultimo de ahora" diria que la estacion
rem tiene una version MAS NUEVA de la que de verdad le quedo, y la app ya
rem nunca ofreceria esa actualizacion. Al reves no hace dano: como mucho se
rem ofrece una que ya esta puesta, y volver a ponerla no rompe nada.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $r=Invoke-RestMethod -UseBasicParsing -Headers @{'User-Agent'='cabletester32'} -Uri ('https://api.github.com/repos/' + $env:REPO + '/commits/main'); $j=[pscustomobject]@{sha=$r.sha; fecha=$r.commit.committer.date; titulo=(($r.commit.message -split '\n')[0]); instalado_en=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Out-String; [IO.File]::WriteAllText((Join-Path $env:TEMP 'ct32-sello.json'), $j, (New-Object Text.UTF8Encoding $false))"
if errorlevel 1 (
    echo  [AVISO] No pude preguntar que version hay publicada.
    echo          Se actualiza igual, pero la app no sabra cual tiene.
    if exist "%TEMP%\ct32-sello.json" del /q "%TEMP%\ct32-sello.json"
)

echo  Descargando la ultima version (ZIP)...
set "NUEVO=%TEMP%\ct32-nuevo"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $z=Join-Path $env:TEMP 'ct32.zip'; $d=Join-Path $env:TEMP 'ct32-nuevo'; if(Test-Path $d){Remove-Item $d -Recurse -Force}; Invoke-WebRequest -UseBasicParsing -Uri ('https://codeload.github.com/' + $env:REPO + '/zip/refs/heads/main') -OutFile $z; Expand-Archive -Path $z -DestinationPath $d -Force; $p=Get-ChildItem $d -Directory | Select-Object -First 1; if(-not $p){throw 'el ZIP venia vacio'}; if(-not (Test-Path (Join-Path $p.FullName 'package.json'))){throw 'el ZIP no trae package.json'}; $p.FullName | Set-Content -Encoding ascii (Join-Path $env:TEMP 'ct32-origen.txt')"
if errorlevel 1 (
    echo.
    echo  [ERROR] No se pudo descargar la nueva version.
    echo  Revisa la conexion a internet. La app se vuelve a abrir sin actualizar.
    echo.
    pause
    goto :arrancar
)

set /p ORIGEN=<"%TEMP%\ct32-origen.txt"
echo  Instalando...
rem /XD data: por si acaso. El ZIP no trae data/ -esta en .gitignore-, pero una
rem copia que puede borrar la produccion de una estacion se escribe con cinturon
rem y tirantes. Sin /PURGE: solo anade y reemplaza, nunca borra lo que no venga.
robocopy "%ORIGEN%" "%CT32_RAIZ%." /E /NFL /NDL /NJH /NJS /NP /XD data node_modules .git >nul
if errorlevel 8 (
    echo.
    echo  [ERROR] Fallo al copiar los archivos nuevos.
    echo  Tus datos NO se han tocado. La app se vuelve a abrir como estaba.
    echo.
    pause
    goto :arrancar
)

rem Dejar sellado QUE version quedo instalada. Un ZIP no lo dice por si mismo,
rem asi que sin esto la app seguiria sin saber que tiene. Va en data/ porque es
rem lo unico que no se pisa en la proxima actualizacion.
if exist "%TEMP%\ct32-sello.json" (
    if not exist "%CT32_RAIZ%data" mkdir "%CT32_RAIZ%data"
    copy /y "%TEMP%\ct32-sello.json" "%CT32_RAIZ%data\version.json" >nul
    if errorlevel 1 echo  [AVISO] Actualizado, pero no pude anotar la version instalada.
) else (
    echo  [AVISO] Actualizado, pero sin anotar la version instalada.
)

:dependencias
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
echo  Actualizado.
if exist ".git" git log -1 --format="    %%h  %%s"
echo.

:arrancar
rem Se vuelve a abrir SIEMPRE, incluso si algo fallo: dejar la estacion sin app
rem por una actualizacion que no salio es peor que seguir con la version vieja.
echo  Abriendo la app...
start "" "%CT32_RAIZ%run.bat"
exit /b 0
