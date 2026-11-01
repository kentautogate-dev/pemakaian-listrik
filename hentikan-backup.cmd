@echo off
chcp 65001 >nul
title Hentikan Helper Backup Listrik
echo Mencari helper backup di port 8787...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$koneksi = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue; if ($koneksi) { $koneksi | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force; Write-Host ('Helper dihentikan (PID ' + $_.OwningProcess + ').') } catch { Write-Host ('Gagal menghentikan PID ' + $_.OwningProcess + ': ' + $_.Exception.Message) } } } else { Write-Host 'Tidak ada helper yang berjalan di port 8787.' }"
echo.
pause
