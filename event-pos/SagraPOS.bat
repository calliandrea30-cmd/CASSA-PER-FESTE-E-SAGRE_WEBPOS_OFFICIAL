@echo off
:: ╔══════════════════════════════════════════════════════════════════════════╗
:: ║                  🏪 SAGRA POS — PROGRAMMA UNIFICATO                      ║
:: ║                  Doppio clic per avviare su Windows                      ║
:: ╚══════════════════════════════════════════════════════════════════════════╝

setlocal EnableDelayedExpansion
title SagraPOS Launcher
chcp 65001 > nul 2>&1
cls
cd /d "%~dp0"
set PROJECT_ROOT=%~dp0
set CONFIG_FILE=%PROJECT_ROOT%config.local.json

echo ============================================================================
echo                      🏪 SAGRA POS — AVVIO SISTEMA
echo                   Sistema POS per Sagre ed Eventi
echo ============================================================================
echo.

:: ── 1. Verifica Node.js ───────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo ============================================================================
    echo [ERRORE] Node.js non e' installato su questo computer.
    echo Scaricalo gratuitamente da: https://nodejs.org ^(versione LTS^)
    echo ============================================================================
    echo.
    start https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo [OK] Node.js %%v trovato.

:: ── 2. Verifica dipendenze ────────────────────────────────────────────────────
if not exist "%PROJECT_ROOT%node_modules\" (
    echo.
    echo [INFO] Prima installazione: scarico i componenti necessari...
    echo Questa operazione richiede solo pochi minuti...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERRORE] Installazione dipendenze fallita.
        echo Controlla la connessione internet e riprova.
        pause
        exit /b 1
    )
    echo [OK] Componenti installati con successo!
)

:: ── 3. Generazione Prisma Client se mancante ─────────────────────────────────
if not exist "%PROJECT_ROOT%node_modules\.prisma\client\" (
    echo [INFO] Generazione client Database...
    pushd "%PROJECT_ROOT%apps\api"
    call npx prisma generate
    popd
)

:: ── 4. Compilazione componenti se non precompilati ────────────────────────────
if not exist "%PROJECT_ROOT%apps\api\dist\index.js" (
    echo [INFO] Compilo API Server...
    pushd "%PROJECT_ROOT%apps\api"
    call npx prisma generate
    call npx tsc
    if errorlevel 1 (
        echo [ERRORE] Compilazione API Server fallita.
        popd
        pause
        exit /b 1
    )
    popd
    echo [OK] API Server compilato!
)

if not exist "%PROJECT_ROOT%apps\print-agent\dist\index.js" (
    echo [INFO] Compilo Print Agent...
    pushd "%PROJECT_ROOT%apps\print-agent"
    call npx tsc
    if errorlevel 1 (
        echo [ERRORE] Compilazione Print Agent fallita.
        popd
        pause
        exit /b 1
    )
    popd
    echo [OK] Print Agent compilato!
)

if not exist "%PROJECT_ROOT%apps\web\.next\" (
    echo [INFO] Compilo Interfaccia Web (potrebbe richiedere 1-2 minuti)...
    pushd "%PROJECT_ROOT%apps\web"
    call npx next build
    if errorlevel 1 (
        echo [ERRORE] Compilazione Interfaccia Web fallita.
        popd
        pause
        exit /b 1
    )
    popd
    echo [OK] Interfaccia Web compilata!
)

:: ── 5. Menu scelta modalita' ─────────────────────────────────────────────────
set CURRENT_MODE=
if exist "%CONFIG_FILE%" (
    findstr /C:"\"isServer\": true" "%CONFIG_FILE%" > nul 2>&1
    if not errorlevel 1 set CURRENT_MODE=1
    findstr /C:"\"isServer\": false" "%CONFIG_FILE%" > nul 2>&1
    if not errorlevel 1 set CURRENT_MODE=2
)

echo.
echo ============================================================================
echo Come vuoi utilizzare questo computer?
echo.
echo   [1] CASSA 1 — SERVER PRINCIPALE (Questo computer fa da server + cassa)
echo   [2] CASSA AGGIUNTIVA / SECONDARIA (Questo computer si collega alla Cassa 1)
echo   [3] Reset configurazione e riparti da zero
echo ============================================================================
echo.

set SCELTA=
if defined CURRENT_MODE (
    if "%CURRENT_MODE%"=="1" echo [INFO] Modalita' salvata: [1] CASSA 1 (SERVER PRINCIPALE)
    if "%CURRENT_MODE%"=="2" echo [INFO] Modalita' salvata: [2] CASSA AGGIUNTIVA
    echo Premi INVIO per confermare la modalita' salvata, o digita 1, 2 o 3:
    set /p SCELTA="Scelta [default: %CURRENT_MODE%]: "
    if "!SCELTA!"=="" set SCELTA=%CURRENT_MODE%
) else (
    set /p SCELTA="Digita 1 o 2 e premi Invio [default: 1]: "
    if "!SCELTA!"=="" set SCELTA=1
)
if "!SCELTA!"=="" set SCELTA=1

if "!SCELTA!"=="3" (
    del "%CONFIG_FILE%" >nul 2>&1
    echo [OK] Configurazione resettata.
    set /p SCELTA="Scegli ora: 1 (Server) o 2 (Cassa Aggiuntiva): "
    if "!SCELTA!"=="" set SCELTA=1
)

:: ══════════════════════════════════════════════════════════════════════════════
:: MODALITA' 1: CASSA 1 (SERVER PRINCIPALE)
:: ══════════════════════════════════════════════════════════════════════════════
if "!SCELTA!"=="1" (
    echo.
    echo ============================================================================
    echo                  AVVIO CASSA 1 (SERVER PRINCIPALE)
    echo ============================================================================

    :: Rileva IP locale
    set SERVER_IP=127.0.0.1
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
        for /f "tokens=1" %%b in ("%%a") do (
            if "!SERVER_IP!"=="127.0.0.1" set SERVER_IP=%%b
        )
    )

    (
        echo {
        echo   "isServer": true,
        echo   "serverIp": "!SERVER_IP!"
        echo }
    ) > "%CONFIG_FILE%"

    :: Database Prisma DB Push
    echo [INFO] Inizializzazione database...
    pushd "%PROJECT_ROOT%apps\api"
    call npx prisma db push --accept-data-loss >nul 2>&1
    popd

    :: Configura Print Agent locale
    (
        echo {
        echo   "SERVER_URL": "http://127.0.0.1:3001",
        echo   "STATION_ID": "",
        echo   "AGENT_ID": "agent-server-local",
        echo   "printers": []
        echo }
    ) > "%PROJECT_ROOT%apps\print-agent\config.json"

    :: Avvia API Server
    echo [INFO] Avvio API Server (porta 3001)...
    pushd "%PROJECT_ROOT%apps\api"
    start "SagraPOS API Server" /min cmd /c "set PORT=3001&&set HOST=0.0.0.0&&set NODE_ENV=production&&node dist\index.js"
    popd

    timeout /t 2 > nul

    :: Avvia Web App su 0.0.0.0
    echo [INFO] Avvio Interfaccia Web (porta 3000)...
    pushd "%PROJECT_ROOT%apps\web"
    start "SagraPOS Web" /min cmd /c "npx next start -p 3000 -H 0.0.0.0"
    popd

    :: Avvia Print Agent
    echo [INFO] Avvio Print Agent stampante...
    pushd "%PROJECT_ROOT%apps\print-agent"
    start "SagraPOS Print Agent" /min cmd /c "node dist\index.js"
    popd

    timeout /t 3 > nul

    echo.
    echo ============================================================================
    echo                     SAGRA POS OPERATIVO! (CASSA 1)
    echo ============================================================================
    echo   SU QUESTO COMPUTER : http://localhost:3000
    echo ----------------------------------------------------------------------------
    echo   DA IPAD / TABLET / ALTRI COMPUTER (Stesso Wi-Fi):
    echo   👉 Cucina (KDS) : http://!SERVER_IP!:3000/kds
    echo   👉 Admin        : http://!SERVER_IP!:3000/admin
    echo   👉 Cassa mobile : http://!SERVER_IP!:3000
    echo.
    echo   ATTENZIONE: Sull'iPad NON scrivere 'localhost'! Usa http://!SERVER_IP!:3000
    echo.
    echo   NON CHIUDERE QUESTA FINESTRA DURANTE IL SERVIZIO!
    echo ============================================================================
    echo.

    start http://localhost:3000
    pause
    goto :eof
)

:: ══════════════════════════════════════════════════════════════════════════════
:: MODALITA' 2: CASSA AGGIUNTIVA (CLIENT)
:: ══════════════════════════════════════════════════════════════════════════════
echo.
echo ============================================================================
echo                  AVVIO CASSA AGGIUNTIVA (CLIENT)
echo ============================================================================

set SERVER_IP=
if exist "%CONFIG_FILE%" (
    for /f "tokens=2 delims=:," %%a in ('findstr /c:"serverIp" "%CONFIG_FILE%"') do (
        set SERVER_IP=%%~a
    )
)

set SERVER_IP=!SERVER_IP: =!
set SERVER_IP=!SERVER_IP:"=!

if "!SERVER_IP!"=="" (
    set /p SERVER_IP="Inserisci l'indirizzo IP del SERVER Cassa 1 (es. 192.168.1.100): "
)

(
    echo {
    echo   "isServer": false,
    echo   "serverIp": "!SERVER_IP!"
    echo }
) > "%CONFIG_FILE%"

:: Configura Print Agent locale per cassa aggiuntiva
(
    echo {
    echo   "SERVER_URL": "http://!SERVER_IP!:3001",
    echo   "STATION_ID": "",
    echo   "AGENT_ID": "agent-client-%COMPUTERNAME%",
    echo   "printers": []
    echo }
) > "%PROJECT_ROOT%apps\print-agent\config.json"

:: Avvia Print Agent locale
echo [INFO] Avvio Print Agent per stampanti collegate a questa cassa...
pushd "%PROJECT_ROOT%apps\print-agent"
start "SagraPOS Print Agent" /min cmd /c "node dist\index.js"
popd

echo.
echo ============================================================================
echo              CASSA AGGIUNTIVA COLLEGATA AL SERVER Cassa 1!
echo ============================================================================
echo   Server: http://!SERVER_IP!:3000
echo.
echo   Il browser si sta aprendo sulla schermata di vendita.
echo   NON CHIUDERE QUESTA FINESTRA DURANTE IL SERVIZIO!
echo ============================================================================
echo.

start http://!SERVER_IP!:3000
pause
goto :eof
