@echo off
setlocal
title SagraPOS Launcher
chcp 65001 >nul 2>&1
cd /d "%~dp0event-pos"
if not exist "SagraPOS.bat" (
    echo.
    echo ============================================================================
    echo [ERRORE] File SagraPOS.bat non trovato nella cartella event-pos.
    echo ============================================================================
    pause
    exit /b 1
)
call SagraPOS.bat
if errorlevel 1 (
    echo.
    echo ============================================================================
    echo [AVVISO] SagraPOS e' terminato con codice: %ERRORLEVEL%
    echo ============================================================================
    pause
)
