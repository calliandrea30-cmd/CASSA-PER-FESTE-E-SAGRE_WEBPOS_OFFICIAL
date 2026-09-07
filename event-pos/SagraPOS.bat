@echo off
if not defined SAGRAPOS_PERSISTENT_SHELL (
    set SAGRAPOS_PERSISTENT_SHELL=1
    cmd /k "%~f0" %*
    exit /b
)

setlocal EnableDelayedExpansion
title SagraPOS - Console Principale
chcp 65001 >nul 2>&1
cls

REM ============================================================================
REM Identificazione percorso cartella principale
REM ============================================================================
set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%event-pos\package.json" (
    set "PROJECT_ROOT=%SCRIPT_DIR%event-pos\"
) else if exist "%SCRIPT_DIR%package.json" (
    set "PROJECT_ROOT=%SCRIPT_DIR%"
) else (
    echo.
    echo ============================================================================
    echo [ERRORE] Impossibile localizzare la cartella dei componenti di SagraPOS.
    echo Assicurati di non aver spostato il file SagraPOS.bat fuori dalla cartella.
    echo ============================================================================
    echo.
    pause
    exit /b 1
)

set "CONFIG_FILE=%PROJECT_ROOT%config.local.json"

REM ----------------------------------------------------------------------------
REM 0. Chiusura preventiva eventuali servizi SagraPOS rimasti aperti in precedenza
REM ----------------------------------------------------------------------------
taskkill /FI "WINDOWTITLE eq SagraPOS_API_Service*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq SagraPOS_Web_Service*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq SagraPOS_Print_Service*" /T /F >nul 2>&1

echo ============================================================================
echo                      SAGRA POS - AVVIO SISTEMA
echo                   Sistema POS per Sagre ed Eventi
echo ============================================================================
echo.

REM ----------------------------------------------------------------------------
REM 1. Verifica Node.js
REM ----------------------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 goto :ERRORE_NODE
for /f "tokens=*" %%v in ('node --version') do echo [OK] Node.js %%v rilevato.

REM ----------------------------------------------------------------------------
REM 2. Verifica e installazione dipendenze
REM ----------------------------------------------------------------------------
if exist "%PROJECT_ROOT%node_modules\next\" goto :SKIP_NPM_INSTALL
echo.
echo ============================================================================
echo [INFO] Prima installazione: scarico e configuro le librerie necessarie...
echo Questo processo richiede qualche minuto a seconda del computer.
echo.
echo NOTA: Eventuali scritte di avviso gialle sono del tutto NORMALI.
echo NON premere tasti: attendi il messaggio di completamento!
echo ============================================================================
echo.
pushd "%PROJECT_ROOT%"
cmd /c npm install --no-audit --no-fund
if errorlevel 1 (
    popd
    goto :ERRORE_INSTALL
)
popd
echo.
echo [OK] Tutte le librerie sono state installate con successo!
:SKIP_NPM_INSTALL

REM ----------------------------------------------------------------------------
REM 3. Generazione Database Client Prisma se mancante
REM ----------------------------------------------------------------------------
if exist "%PROJECT_ROOT%node_modules\.prisma\client\" goto :SKIP_PRISMA_GEN
echo [INFO] Inizializzazione Database Client Prisma...
pushd "%PROJECT_ROOT%apps\api"
cmd /c npx prisma generate
popd
echo [OK] Database Client generato!
:SKIP_PRISMA_GEN

REM ----------------------------------------------------------------------------
REM 4. Compilazione API Server se non presente
REM ----------------------------------------------------------------------------
if exist "%PROJECT_ROOT%apps\api\dist\index.js" goto :SKIP_API_BUILD
echo [INFO] Compilazione API Server...
pushd "%PROJECT_ROOT%apps\api"
cmd /c npx prisma generate
cmd /c npx tsc
if errorlevel 1 (
    popd
    goto :ERRORE_BUILD
)
popd
echo [OK] API Server compilato!
:SKIP_API_BUILD

REM ----------------------------------------------------------------------------
REM 5. Compilazione Print Agent se non presente
REM ----------------------------------------------------------------------------
if exist "%PROJECT_ROOT%apps\print-agent\dist\index.js" goto :SKIP_PRINT_BUILD
echo [INFO] Compilazione Print Agent...
pushd "%PROJECT_ROOT%apps\print-agent"
cmd /c npx tsc
if errorlevel 1 (
    popd
    goto :ERRORE_BUILD
)
popd
echo [OK] Print Agent compilato!
:SKIP_PRINT_BUILD

REM ----------------------------------------------------------------------------
REM 6. Compilazione Web App Next.js se non presente
REM ----------------------------------------------------------------------------
if exist "%PROJECT_ROOT%apps\web\.next\" goto :SKIP_WEB_BUILD
echo.
echo ============================================================================
echo [INFO] Prima compilazione interfaccia Web in corso...
echo Questa operazione richiede circa 1 minuto solo la prima volta.
echo ============================================================================
pushd "%PROJECT_ROOT%apps\web"
cmd /c npx next build
if errorlevel 1 (
    popd
    goto :ERRORE_BUILD
)
popd
echo [OK] Interfaccia Web compilata con successo!
:SKIP_WEB_BUILD

REM ----------------------------------------------------------------------------
REM 7. Controllo e pulizia vecchie configurazioni errate
REM ----------------------------------------------------------------------------
if exist "%CONFIG_FILE%" (
    findstr /C:"!SERVER_IP!" "%CONFIG_FILE%" >nul 2>&1
    if not errorlevel 1 del /f /q "%CONFIG_FILE%" >nul 2>&1
)

:MENU
set "CURRENT_MODE="
if exist "%CONFIG_FILE%" (
    findstr /C:"\"isServer\": true" "%CONFIG_FILE%" >nul 2>&1
    if not errorlevel 1 set "CURRENT_MODE=1"
    findstr /C:"\"isServer\": false" "%CONFIG_FILE%" >nul 2>&1
    if not errorlevel 1 set "CURRENT_MODE=2"
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

set "SCELTA="
if defined CURRENT_MODE (
    if "%CURRENT_MODE%"=="1" echo [INFO] Modalita attualmente salvata: [1] CASSA 1 (SERVER PRINCIPALE)
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
echo.
echo [ATTENZIONE] Scelta non valida ("%SCELTA%"), riprova.
goto :MENU

REM ============================================================================
REM MODALITA 1: CASSA 1 (SERVER PRINCIPALE)
REM ============================================================================
:MODO_SERVER
echo.
echo ============================================================================
echo                  AVVIO CASSA 1 (SERVER PRINCIPALE)
echo ============================================================================
echo.

REM Rilevamento IP locale IPv4
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

REM Salvataggio configurazione server
(
    echo {
    echo   "isServer": true,
    echo   "serverIp": "!SERVER_IP!"
    echo }
) > "%CONFIG_FILE%"

REM Creazione/allineamento tabelle database locale
echo [INFO] Inizializzazione database locale...
pushd "%PROJECT_ROOT%apps\api"
cmd /c npx prisma db push --accept-data-loss
popd

REM Configurazione Print Agent locale
(
    echo {
    echo   "SERVER_URL": "http://127.0.0.1:3001",
    echo   "STATION_ID": "",
    echo   "AGENT_ID": "agent-server-local",
    echo   "printers": []
    echo }
) > "%PROJECT_ROOT%apps\print-agent\config.json"

REM Avvio API Server
echo [INFO] Avvio API Server porta 3001...
pushd "%PROJECT_ROOT%apps\api"
start "SagraPOS API Server" /min cmd /k "title SagraPOS_API_Service && set PORT=3001 && set HOST=0.0.0.0 && set NODE_ENV=production && node dist\index.js"
popd

REM Attesa breve
ping -n 3 127.0.0.1 >nul 2>&1

REM Avvio Web App
echo [INFO] Avvio Interfaccia Web porta 3000...
pushd "%PROJECT_ROOT%apps\web"
start "SagraPOS Web" /min cmd /k "title SagraPOS_Web_Service && npx next start -p 3000 -H 0.0.0.0"
popd

REM Avvio Print Agent
echo [INFO] Avvio Print Agent stampante...
pushd "%PROJECT_ROOT%apps\print-agent"
start "SagraPOS Print Agent" /min cmd /k "title SagraPOS_Print_Service && node dist\index.js"
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
echo   Usa l'indirizzo con l'IP numerico: http://!SERVER_IP!:3000
echo.
echo ============================================================================
echo   NON CHIUDERE QUESTA FINESTRA! RIMANE APERTA DURANTE IL SERVIZIO.
echo   Per spegnere SagraPOS a fine serata, premi un tasto qui sotto.
echo ============================================================================
echo.

start http://localhost:3000
pause
goto :FINE

REM ============================================================================
REM MODALITA 2: CASSA AGGIUNTIVA (CLIENT)
REM ============================================================================
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

REM Salvataggio configurazione client
(
    echo {
    echo   "isServer": false,
    echo   "serverIp": "!CLIENT_SERVER_IP!"
    echo }
) > "%CONFIG_FILE%"

REM Configurazione Print Agent locale per cassa aggiuntiva
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
start "SagraPOS Print Agent" /min cmd /k "title SagraPOS_Print_Service && node dist\index.js"
popd

echo.
echo ============================================================================
echo              CASSA AGGIUNTIVA COLLEGATA AL SERVER Cassa 1!
echo ============================================================================
echo   Server collegato: http://!CLIENT_SERVER_IP!:3000
echo.
echo   Il browser si sta aprendo sulla schermata di vendita.
echo ============================================================================
echo   NON CHIUDERE QUESTA FINESTRA! RIMANE APERTA DURANTE IL SERVIZIO.
echo   Per spegnere SagraPOS a fine serata, premi un tasto qui sotto.
echo ============================================================================
echo.

start http://!CLIENT_SERVER_IP!:3000
pause
goto :FINE

REM ============================================================================
REM RESET CONFIGURAZIONE
REM ============================================================================
:RESET_CONFIG
if exist "%CONFIG_FILE%" del /f /q "%CONFIG_FILE%" >nul 2>&1
echo.
echo [OK] Configurazione resettata con successo!
echo.
set "CURRENT_MODE="
goto :MENU

REM ============================================================================
REM GESTIONE ERRORI E CHIUSURA PROTETTA
REM ============================================================================
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
echo [ATTENZIONE] L'installazione delle librerie non si e' completata.
echo.
echo Possibili cause:
echo 1. I file erano bloccati da un processo Node rimasto attivo in background.
echo 2. E' stato premuto accidentalmente Ctrl+C o interrotto il download.
echo 3. L'antivirus o Windows Defender ha bloccato momentaneamente un file.
echo.
echo VUOI RIPULIRE E RIPROVARE IN AUTOMATICO?
echo Digita R e premi Invio per pulire e riprovare subito, oppure premi solo Invio per uscire:
echo ============================================================================
echo.
set "RETRY="
set /p "RETRY=Scelta [R = Riprova, Invio = Esci]: "
if /i "!RETRY!"=="R" (
    echo.
    echo [INFO] Chiusura processi e rimozione cartella parziale...
    taskkill /FI "WINDOWTITLE eq SagraPOS_API_Service*" /T /F >nul 2>&1
    taskkill /FI "WINDOWTITLE eq SagraPOS_Web_Service*" /T /F >nul 2>&1
    taskkill /FI "WINDOWTITLE eq SagraPOS_Print_Service*" /T /F >nul 2>&1
    rd /s /q "%PROJECT_ROOT%node_modules" >nul 2>&1
    cls
    goto :MENU
)
pause
exit /b 1

:ERRORE_BUILD
echo.
echo ============================================================================
echo [ERRORE] Compilazione fallita. Controlla i messaggi di errore sopra riportati.
echo ============================================================================
echo.
pause
exit /b 1

:FINE
echo.
echo ============================================================================
echo Arresto dei servizi di SagraPOS in corso...
echo ============================================================================
taskkill /FI "WINDOWTITLE eq SagraPOS_API_Service*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq SagraPOS_Web_Service*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq SagraPOS_Print_Service*" /T /F >nul 2>&1
echo [OK] Tutti i servizi sono stati arrestati.
echo.
echo Premi un tasto per chiudere questa finestra...
pause
exit /b 0
