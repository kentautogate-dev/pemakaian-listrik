@echo off
chcp 65001 >nul
title Mulai Helper Backup Listrik
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Node.js belum terpasang di komputer ini.
  echo     Fitur backup L:\ dan GitHub membutuhkan Node.js.
  echo     Unduh di https://nodejs.org lalu coba lagi.
  echo.
  pause
  exit /b 1
)

echo ================================================
echo   Helper Backup - Pemakaian Listrik Rumah
echo   Server lokal: http://127.0.0.1:8787
echo   Tutup jendela ini untuk menghentikan helper.
echo ================================================
echo.

start "Helper Backup Listrik" cmd /k node "%~dp0server-backup.js"

timeout /t 2 >nul
start "" "%~dp0index.html"
exit /b 0
