@echo off
chcp 65001 >nul
title KRYPTON - Think. Act. Automate.
cd /d "%~dp0"

if exist "%~dp0dist\krypton.exe" (
    "%~dp0dist\krypton.exe" wakeup
) else (
    bun run "%~dp0src\index.ts" wakeup
)

if errorlevel 1 (
    echo.
    echo KRYPTON exited with an error. Press any key to close...
    pause >nul
)
