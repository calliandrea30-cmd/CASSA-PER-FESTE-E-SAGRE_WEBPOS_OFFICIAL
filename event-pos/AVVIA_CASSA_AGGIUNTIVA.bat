@echo off
setlocal enabledelayedexpansion
title SagraPOS — Cassa Aggiuntiva
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║         SAGRA POS — CASSA AGGIUNTIVA (Windows)       ║
echo ╚══════════════════════════════════════════════════════╝
echo.

:: ── 0. Verifica Node.js ────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Node.js non trovato!
    echo Scaricalo da: https://nodejs.org
    pause
    exit /b 1
)

:: ── 1. Leggi o chiedi l'IP del server ────────────────────────────────────
set SERVER_IP=

:: Prova a leggere da config.local.json
if exist "config.local.json" (
    for /f "tokens=2 delims=:, " %%a in ('findstr /C:"serverIp" config.local.json') do (
        set RAW=%%a
        :: Rimuove virgolette
        set SERVER_IP=!RAW:"=!
    )
    :: Controlla che non sia il server (isServer: true)
    findstr /C:"\"isServer\": true" config.local.json >nul 2>&1
    if not errorlevel 1 (
        :: Questo è il server — ignora l'IP
        set SERVER_IP=
    )
)

if not "!SERVER_IP!"=="" (
    echo [OK] IP server letto da config.local.json: !SERVER_IP!
    echo      (Cancella config.local.json per cambiarlo)
    goto :skip_ask
)

:: Prima esecuzione o reset: chiedi l'IP
echo Inserisci l'indirizzo IP del SERVER MASTER (Cassa 1).
echo Lo trovi nella finestra del server, sotto "IP Server".
echo.
:ask_ip
set /p SERVER_IP="Indirizzo IP del server (es. 192.168.1.10): "
if "!SERVER_IP!"=="" (
    echo [WARN] IP non inserito. Riprova.
    goto :ask_ip
)

:: Salva in config.local.json
(
  echo {
  echo   "serverIp": "!SERVER_IP!",
  echo   "isServer": false
  echo }
) > config.local.json
echo [OK] IP salvato in config.local.json (non verra' piu' richiesto)

:skip_ask

:: ── 2. Verifica connessione al server ────────────────────────────────────
echo.
echo [INFO] Verifica connessione al server (!SERVER_IP!:3001)...
set SERVER_READY=0
for /l %%i in (1,1,30) do (
    if !SERVER_READY!==0 (
        timeout /t 1 /nobreak >nul
        netstat -an | findstr ":3001" | findstr "!SERVER_IP!" >nul 2>&1
        if not errorlevel 1 (
            set SERVER_READY=1
        ) else (
            curl -sf "http://!SERVER_IP!:3001/health" >nul 2>&1
            if not errorlevel 1 (
                set SERVER_READY=1
            ) else (
                echo    Tentativo %%i/30...
            )
        )
    )
)

if !SERVER_READY!==0 (
    echo [WARN] Il server non risponde su http://!SERVER_IP!:3001
    echo.
    echo Possibili cause:
    echo  - Il server non e' stato avviato (avvia AVVIA_CASSA_1_SERVER.bat sul server)
    echo  - L'IP !SERVER_IP! non e' corretto
    echo  - Firewall o rete separata
    echo.
    set /p CONTINUA="Continuare comunque? (s/n): "
    if /i not "!CONTINUA!"=="s" (
        exit /b 1
    )
) else (
    echo [OK] Server raggiungibile!
)

:: ── 3. Genera config.json per il print-agent ─────────────────────────────
for /f %%H in ('hostname') do set HOSTNAME=%%H
set AGENT_ID=agent-!HOSTNAME!-!RANDOM!

(
  echo {
  echo   "SERVER_URL": "http://!SERVER_IP!:3001",
  echo   "STATION_ID": "",
  echo   "AGENT_ID": "!AGENT_ID!",
  echo   "printers": []
  echo }
) > apps\print-agent\config.json
echo [OK] config.json del print-agent generata

:: ── 4. Build e avvio Print Agent ─────────────────────────────────────────
if not exist "apps\print-agent\dist\" (
    echo [INFO] Compilo il print-agent...
    cd apps\print-agent
    call npx tsc >nul 2>&1
    cd ..\..
)

if exist "apps\print-agent\dist\index.js" (
    echo [INFO] Avvio Print Agent...
    start /min "SagraPOS PrintAgent" cmd /c "cd /d "%~dp0apps\print-agent" && node dist\index.js"
    echo [OK] Print Agent avviato
) else (
    echo [WARN] Print Agent non avviato (dist\index.js non trovato).
    echo        La stampa locale non sara' disponibile.
)

:: ── 5. Apri browser all'indirizzo del server ──────────────────────────────
echo [INFO] Apertura browser...
timeout /t 2 /nobreak >nul
start http://!SERVER_IP!:3000

:: ── 6. Riepilogo ─────────────────────────────────────────────────────────
echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║       CASSA AGGIUNTIVA OPERATIVA!                    ║
echo ╠══════════════════════════════════════════════════════╣
echo ║  POS   : http://!SERVER_IP!:3000
echo ║  Admin : http://!SERVER_IP!:3000/admin
echo ╠══════════════════════════════════════════════════════╣
echo ║  NON CHIUDERE QUESTA FINESTRA DURANTE IL SERVIZIO!   ║
echo ║  Premi un tasto per terminare a fine serata.         ║
echo ╚══════════════════════════════════════════════════════╝
echo.
pause

:: ── Cleanup ───────────────────────────────────────────────────────────────
echo Arresto Print Agent...
taskkill /FI "WINDOWTITLE eq SagraPOS PrintAgent*" /F >nul 2>&1
echo Arrivederci!
endlocal
