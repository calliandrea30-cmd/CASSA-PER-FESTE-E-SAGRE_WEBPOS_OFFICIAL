@echo off
setlocal enabledelayedexpansion
title SagraPOS — Server Master
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║            SAGRA POS — SERVER MASTER (Windows)       ║
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
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER% trovato

:: ── 1. Individua IP locale ─────────────────────────────────────────────────
set SERVER_IP=127.0.0.1
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    set IP_RAW=%%a
    set IP_RAW=!IP_RAW: =!
    if not "!IP_RAW:~0,3!"=="169" (
        if not "!IP_RAW!"=="127.0.0.1" (
            set SERVER_IP=!IP_RAW!
        )
    )
)
echo [OK] IP Server rilevato: %SERVER_IP%

:: Salva l'IP in .server_ip
echo %SERVER_IP%> .server_ip

:: Salva config.local.json
(
  echo {
  echo   "serverIp": "%SERVER_IP%",
  echo   "isServer": true
  echo }
) > config.local.json
echo [OK] Configurazione salvata in config.local.json

:: ── 2. Banner ─────────────────────────────────────────────────────────────
echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║  IP Server : %SERVER_IP%
echo ║  POS       : http://%SERVER_IP%:3000
echo ║  API       : http://%SERVER_IP%:3001
echo ║  Admin     : http://%SERVER_IP%:3000/admin
echo ╠══════════════════════════════════════════════════════╣
echo ║  Altre casse: apri AVVIA_CASSA_AGGIUNTIVA.bat        ║
echo ╚══════════════════════════════════════════════════════╝
echo.

:: ── 3. Libera le porte 3000 e 3001 se occupate ───────────────────────────
echo [INFO] Verifica porte 3000 e 3001...
for %%P in (3001 3000) do (
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%%P " ^| findstr "LISTENING"') do (
        echo [WARN] Porta %%P occupata dal PID %%a — lo termino...
        taskkill /PID %%a /F >nul 2>&1
    )
)
timeout /t 1 /nobreak >nul

:: ── 4. Installa dipendenze se necessario ─────────────────────────────────
if not exist "node_modules\" (
    echo [INFO] Prima esecuzione: installo le dipendenze npm...
    npm install
    if errorlevel 1 (
        echo [ERRORE] npm install fallito. Verifica la connessione a internet.
        pause
        exit /b 1
    )
    echo [OK] Dipendenze installate
) else (
    echo [OK] node_modules presente
)

:: ── 5. Build API se dist mancante ────────────────────────────────────────
if not exist "apps\api\dist\" (
    echo [INFO] Compilo l'API TypeScript...
    cd apps\api
    call npx tsc
    if errorlevel 1 (
        echo [ERRORE] Compilazione API fallita.
        cd ..\..
        pause
        exit /b 1
    )
    cd ..\..
    echo [OK] API compilata in apps\api\dist\
) else (
    echo [OK] apps\api\dist\ presente
)

:: ── 6. Build Web App se .next mancante ───────────────────────────────────
if not exist "apps\web\.next\" (
    echo [INFO] Build Next.js in corso (prima esecuzione, potrebbero volerci minuti)...
    cd apps\web
    call npx next build
    if errorlevel 1 (
        echo [ERRORE] Build Next.js fallita.
        cd ..\..
        pause
        exit /b 1
    )
    cd ..\..
    echo [OK] Web App compilata in apps\web\.next\
) else (
    echo [OK] apps\web\.next\ presente
)

:: ── 7. Genera config.json per il print-agent server ──────────────────────
(
  echo {
  echo   "SERVER_URL": "http://127.0.0.1:3001",
  echo   "STATION_ID": "",
  echo   "AGENT_ID": "agent-server-local",
  echo   "printers": []
  echo }
) > apps\print-agent\config.json
echo [OK] config.json del print-agent generata

:: ── 8. Avvia API ──────────────────────────────────────────────────────────
echo.
echo [INFO] Avvio API server (porta 3001)...
start /min "SagraPOS API" cmd /c "cd /d "%~dp0apps\api" && set NODE_ENV=production && node dist\index.js"

:: ── 9. Attendi che l'API sia pronta ──────────────────────────────────────
echo [INFO] Attendo che l'API sia pronta...
set API_READY=0
for /l %%i in (1,1,30) do (
    if !API_READY!==0 (
        timeout /t 1 /nobreak >nul
        netstat -an | findstr ":3001" | findstr "LISTENING" >nul 2>&1
        if not errorlevel 1 (
            set API_READY=1
            echo [OK] API pronta sulla porta 3001
        ) else (
            echo    Tentativo %%i/30...
        )
    )
)
if !API_READY!==0 (
    echo [WARN] API non ha risposto entro 30s — procedo comunque.
)

:: ── 10. Avvia Web App ─────────────────────────────────────────────────────
echo [INFO] Avvio Web App (porta 3000)...
start /min "SagraPOS Web" cmd /c "cd /d "%~dp0apps\web" && npx next start -p 3000 -H 0.0.0.0"

:: ── 11. Build e avvio Print Agent ────────────────────────────────────────
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
)

:: ── 12. Attendi porta 3000 e apri browser ────────────────────────────────
echo [INFO] Attendo porta 3000...
:waitweb
timeout /t 2 /nobreak >nul
netstat -an | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 goto waitweb

echo [INFO] Apertura browser...
start http://127.0.0.1:3000

:: ── 13. Riepilogo ────────────────────────────────────────────────────────
echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║           SAGRA POS OPERATIVO!                       ║
echo ╠══════════════════════════════════════════════════════╣
echo ║  POS   : http://localhost:3000                       ║
echo ║  Admin : http://localhost:3000/admin                 ║
echo ║  KDS   : http://localhost:3000/kds                   ║
echo ║  API   : http://localhost:3001                       ║
echo ╠══════════════════════════════════════════════════════╣
echo ║  Altre casse: http://%SERVER_IP%:3000
echo ╠══════════════════════════════════════════════════════╣
echo ║  NON CHIUDERE QUESTA FINESTRA DURANTE IL SERVIZIO!   ║
echo ║  Premi un tasto per terminare tutto a fine serata.   ║
echo ╚══════════════════════════════════════════════════════╝
echo.
pause

:: ── Cleanup ───────────────────────────────────────────────────────────────
echo Arresto SagraPOS...
taskkill /FI "WINDOWTITLE eq SagraPOS API*"         /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq SagraPOS Web*"         /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq SagraPOS PrintAgent*"  /F >nul 2>&1
echo Arrivederci!
endlocal
