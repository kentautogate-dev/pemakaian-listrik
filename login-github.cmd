@echo off
chcp 65001 >nul
title Login GitHub (sekali saja)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0login-github.ps1"
echo.
pause
