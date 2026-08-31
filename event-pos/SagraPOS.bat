@echo off
:: ============================================================================
::  SagraPOS — Launcher Universale (Windows)
::  Doppio clic su questa icona per avviare la Cassa!
:: ============================================================================

title SagraPOS Launcher
chcp 65001 > nul
cls
cd /d "%~dp0"

echo ============================================================================
echo                      🏪 SagraPOS — AVVIO SISTEMA
echo ============================================================================
echo.

:: Se è già configurato da un avvio precedente, leggi config.local.json
if exist "config.local.json" (
    findstr /C:"\"isServer\": false" "config.local.json" > nul
    if not errorlevel 1 (
        echo [INFO] Configurazione rilevata: CASSA AGGIUNTIVA (Client)
        echo Avvio in corso...
        timeout /t 1 > nul
        call AVVIA_CASSA_AGGIUNTIVA.bat
        goto :eof
    )
    findstr /C:"\"isServer\": true" "config.local.json" > nul
    if not errorlevel 1 (
        echo [INFO] Configurazione rilevata: CASSA 1 (Server Principale)
        echo Avvio in corso...
        timeout /t 1 > nul
        call AVVIA_CASSA_1_SERVER.bat
        goto :eof
    )
)

:: Se prima volta, mostra menu di scelta semplice
echo Scegli la modalita di avvio per questo computer:
echo.
echo   [1] CASSA 1 - SERVER PRINCIPALE (Questo computer fa da server + cassa)
echo   [2] CASSA AGGIUNTIVA (Questo computer si collega alla Cassa 1)
echo.
echo (Questa scelta verra salvata, non dovrai ripeterla ai prossimi avvii)
echo.
set /p SCELTA="Digita 1 o 2 e premi Invio: "

if "%SCELTA%"=="2" (
    echo.
    echo Avvio configurazione Cassa Aggiuntiva...
    call AVVIA_CASSA_AGGIUNTIVA.bat
) else (
    echo.
    echo Avvio Cassa 1 (Server Principale)...
    call AVVIA_CASSA_1_SERVER.bat
)
