@echo off
chcp 65001 >nul
title Lepas Otomatisasi Helper Backup
cd /d "%~dp0"
echo.
echo  Melepas otomatisasi helper backup listrik...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pasang-otomatis.ps1" -Hapus
echo.
pause
