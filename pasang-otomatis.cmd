@echo off
chcp 65001 >nul
title Pasang Otomatisasi Helper Backup
cd /d "%~dp0"
echo.
echo  Pasang otomatisasi helper backup listrik:
echo   - helper nyala otomatis saat login Windows
echo   - tombol "Nyalakan helper otomatis" di halaman Backup ^& Restore
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pasang-otomatis.ps1"
echo.
pause
