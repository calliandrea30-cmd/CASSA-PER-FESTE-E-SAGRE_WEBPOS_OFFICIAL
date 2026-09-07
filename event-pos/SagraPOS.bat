@echo off
setlocal EnableDelayedExpansion
title SagraPOS Launcher
chcp 65001 >nul 2>&1
cls

set "PROJECT_ROOT=%~dp0"
set "CONFIG_FILE=%PROJECT_ROOT%config.local.json"

echo ============================================================================
echo                      SAGRA POS - AVVIO SISTEMA
echo                   Sistema POS per Sagre ed Eventi
echo ============================================================================
echo.

REM 1. Controllo presenza Node.js
where node >nul 2>&1
if errorlevel 1 goto :ERRORE_NODE
for /f "tokens=*" %%v in ('node --version') do echo [OK] Node.js %%v rilevato.

REM 2. Controllo dipendenze node_modules
if not exist "%PROJECT_ROOT%node_modules\" (
    echo.
    echo [INFO] Prima installazione: scarico le librerie necessarie...
    echo (Questa operazione puo richiedere qualche minuto...)
    call npm install
    if errorlevel 1 goto :ERRORE_INSTALL
    echo [OK] Librerie installate con successo!
)

REM 3. Generazione Prisma Client se mancante
if not exist "%PROJECT_ROOT%node_modules\.prisma\client\" (
    echo [INFO] Inizializzazione Prisma Database Client...
    pushd "%PROJECT_ROOT%apps\api"
    call npx prisma generate
    popd
)

REM 4. Compilazione API Server se mancante
if not exist "%PROJECT_ROOT%apps\api\dist\index.js" (
    echo [INFO] Compilazione API Server...
    pushd "%PROJECT_ROOT%apps\api"
    call npx prisma generate
    call npx tsc
    if errorlevel 1 goto :ERRORE_BUILD
    popd
    echo [OK] API Server compilato!
)

REM 5. Compilazione Print Agent se mancante
if not exist "%PROJECT_ROOT%apps\print-agent\dist\index.js" (
    echo [INFO] Compilazione Print Agent...
    pushd "%PROJECT_ROOT%apps\print-agent"
    call npx tsc
    if errorlevel 1 goto :ERRORE_BUILD
    popd
    echo [OK] Print Agent compilato!
)

REM 6. Compilazione Web App se mancante
if not exist "%PROJECT_ROOT%apps\web\.next\" (
    echo.
    echo ============================================================================
    echo [INFO] Prima compilazione interfaccia Web (richiede 1-2 minuti)...
    echo ============================================================================
    pushd "%PROJECT_ROOT%apps\web"
    call npx next build
    if errorlevel 1 goto :ERRORE_BUILD
    popd
    echo [OK] Interfaccia Web compilata!
)

:MENU
set CURRENT_MODE=
if exist "%CONFIG_FILE%" (
    findstr /C:"\"isServer\": true" "%CONFIG_FILE%" >nul 2>&1
    if not errorlevel 1 set CURRENT_MODE=1
    findstr /C:"\"isServer\": false" "%CONFIG_FILE%" >nul 2>&1
    if not errorlevel 1 set CURRENT_MODE=2
)

echo.
echo ============================================================================
echo COME VUOI UTILIZZARE QUESTO COMPUTER?
echo ============================================================================
echo   [1] CASSA 1 - SERVER PRINCIPALE (Questo computer fa da Server e Cassa)
echo   [2] CASSA AGGIUNTIVA / CLIENT   (Questo computer si collega a Cassa 1)
echo   [3] Reset configurazione salvata
echo ============================================================================
echo.

set SCELTA=
if defined CURRENT_MODE (
    if "%CURRENT_MODE%"=="1" echo [INFO] Modalita attualmente salvata: [1] CASSA 1 (SERVER)
    if "%CURRENT_MODE%"=="2" echo [INFO] Modalita attualmente salvata: [2] CASSA AGGIUNTIVA
    echo Premi INVIO per confermare la modalita salvata, o digita 1, 2 o 3:
    set /p "SCELTA=Scelta [default: %CURRENT_MODE%]: "
    if "!SCELTA!"=="" set "SCELTA=%CURRENT_MODE%"
) else (
    set /p "SCELTA=Digita 1 per Server o 2 per Cassa Aggiuntiva [default: 1]: "
    if "!SCELTA!"=="" set "SCELTA=1"
)
if "!SCELTA!"=="" set "SCELTA=1"

if "%SCELTA%"=="1" goto :MODO_SERVER
if "%SCELTA%"=="2" goto :MODO_CLIENT
if "%SCELTA%"=="3" goto :RESET_CONFIG
echo Scelta non valida, riprova.
goto :MENU

:MODO_SERVER
echo.
echo ============================================================================
echo                  AVVIO CASSA 1 (SERVER PRINCIPALE)
echo ============================================================================
echo.

REM Rileva indirizzo IP locale su scheda attiva
set "SERVER_IP=127.0.0.1"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        if "!SERVER_IP!"=="127.0.0.1" (
            set "DETECTED_IP=%%b"
            set "DETECTED_IP=!DETECTED_IP: =!"
            if not "!DETECTED_IP!"=="" set "SERVER_IP=!DETECTED_IP!"
        )
    )
)

REM Salva configurazione server
(
    echo {
    echo   "isServer": true,
    echo   "serverIp": "!SERVER_IP!"
    echo }
) > "%CONFIG_FILE%"

REM Allineamento schema database Prisma
echo [INFO] Inizializzazione database locale...
pushd "%PROJECT_ROOT%apps\api"
call npx prisma db push --accept-data-loss
popd

REM Configura Print Agent locale
(
    echo {
    echo   "SERVER_URL": "http://127.0.0.1:3001",
    echo   "STATION_ID": "",
    echo   "AGENT_ID": "agent-server-local",
    echo   "printers": []
    echo }
) > "%PROJECT_ROOT%apps\print-agent\config.json"

REM Avvio API Server
echo [INFO] Avvio API Server (porta 3001)...
pushd "%PROJECT_ROOT%apps\api"
start "SagraPOS API Server" /min cmd /c "set PORT=3001&&set HOST=0.0.0.0&&set NODE_ENV=production&&node dist\index.js || pause"
popd

REM Attesa breve
ping -n 3 127.0.0.1 >nul 2>&1

REM Avvio Interfaccia Web su 0.0.0.0
echo [INFO] Avvio Interfaccia Web (porta 3000)...
pushd "%PROJECT_ROOT%apps\web"
start "SagraPOS Web" /min cmd /c "npx next start -p 3000 -H 0.0.0.0 || pause"
popd

REM Avvio Print Agent
echo [INFO] Avvio Print Agent stampante...
pushd "%PROJECT_ROOT%apps\print-agent"
start "SagraPOS Print Agent" /min cmd /c "node dist\index.js || pause"
popd

REM Attesa avvio completo
ping -n 4 127.0.0.1 >nul 2>&1

echo.
echo ============================================================================
echo                     SAGRA POS OPERATIVO! (CASSA 1)
echo ============================================================================
echo   SU QUESTO COMPUTER : http://localhost:3000
echo ----------------------------------------------------------------------------
echo   DA IPAD / TABLET / ALTRI COMPUTER (Connessi allo stesso Wi-Fi):
echo   * Cucina (KDS) : http://!SERVER_IP!:3000/kds
echo   * Admin        : http://!SERVER_IP!:3000/admin
echo   * Cassa mobile : http://!SERVER_IP!:3000
echo.
echo   ATTENZIONE: Sull'iPad NON scrivere 'localhost'!
echo   Usa l'indirizzo con l'IP: http://!SERVER_IP!:3000
echo.
echo   NON CHIUDERE QUESTA FINESTRA DURANTE IL SERVIZIO!
echo ============================================================================
echo.

start http://localhost:3000
pause
goto :FINE

:MODO_CLIENT
echo.
echo ============================================================================
echo                  AVVIO CASSA AGGIUNTIVA (CLIENT)
echo ============================================================================
echo.

set "CLIENT_SERVER_IP="
if exist "%CONFIG_FILE%" (
    for /f "tokens=2 delims=:," %%a in ('findstr /c:"serverIp" "%CONFIG_FILE%"') do (
        set "CLIENT_SERVER_IP=%%~a"
    )
)
if defined CLIENT_SERVER_IP (
    set "CLIENT_SERVER_IP=!CLIENT_SERVER_IP: =!"
    set "CLIENT_SERVER_IP=!CLIENT_SERVER_IP:"=!"
)

if "!CLIENT_SERVER_IP!"=="" (
    echo Inserisci l'indirizzo IP del computer Cassa 1 ^(Server^):
    echo ^(Lo trovi scritto nella schermata di Cassa 1, es: 192.168.1.100^)
    set /p "CLIENT_SERVER_IP=Indirizzo IP Server: "
) else (
    echo Indirizzo IP Server memorizzato: !CLIENT_SERVER_IP!
    echo Premi INVIO per confermare, o digita il nuovo IP del Server:
    set /p "INPUT_IP=IP Server [default: !CLIENT_SERVER_IP!]: "
    if not "!INPUT_IP!"=="" set "CLIENT_SERVER_IP=!INPUT_IP!"
)
if "!CLIENT_SERVER_IP!"=="" set "CLIENT_SERVER_IP=127.0.0.1"

REM Salva configurazione client
(
    echo {
    echo   "isServer": false,
    echo   "serverIp": "!CLIENT_SERVER_IP!"
    echo }
) > "%CONFIG_FILE%"

REM Configura Print Agent locale per cassa aggiuntiva
(
    echo {
    echo   "SERVER_URL": "http://!CLIENT_SERVER_IP!:3001",
    echo   "STATION_ID": "",
    echo   "AGENT_ID": "agent-client-%COMPUTERNAME%",
    echo   "printers": []
    echo }
) > "%PROJECT_ROOT%apps\print-agent\config.json"

echo [INFO] Avvio Print Agent per stampanti collegate a questa cassa...
pushd "%PROJECT_ROOT%apps\print-agent"
start "SagraPOS Print Agent" /min cmd /c "node dist\index.js || pause"
popd

echo.
echo ============================================================================
echo              CASSA AGGIUNTIVA COLLEGATA AL SERVER Cassa 1!
echo ============================================================================
echo   Server collegato: http://!CLIENT_SERVER_IP!:3000
echo.
echo   Il browser si sta aprendo sulla schermata di vendita.
echo   NON CHIUDERE QUESTA FINESTRA DURANTE IL SERVIZIO!
echo ============================================================================
echo.

start http://!CLIENT_SERVER_IP!:3000
pause
goto :FINE

:RESET_CONFIG
if exist "%CONFIG_FILE%" del /f /q "%CONFIG_FILE%" >nul 2>&1
echo.
echo [OK] Configurazione resettata con successo!
echo.
set "CURRENT_MODE="
goto :MENU

:ERRORE_NODE
echo.
echo ============================================================================
echo [ERRORE] Node.js non e' installato su questo computer.
echo Scaricalo e installalo gratuitamente da: https://nodejs.org
echo (Scegli la versione LTS consigliata per la maggior parte degli utenti)
echo ============================================================================
echo.
start https://nodejs.org
pause
exit /b 1

:ERRORE_INSTALL
echo.
echo ============================================================================
echo [ERRORE] Installazione dei componenti fallita.
echo Verifica la connessione a Internet e riprova.
echo ============================================================================
pause
exit /b 1

:ERRORE_BUILD
echo.
echo ============================================================================
echo [ERRORE] Compilazione fallita. Controlla i messaggi sopra riportati.
echo ============================================================================
pause
exit /b 1

:FINE
exit /b 0
