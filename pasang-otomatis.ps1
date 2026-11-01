# Pasang / lepas otomatisasi helper backup.
#   pasang-otomatis.ps1          -> pasang (auto-start saat login + tombol backup-listrik:// di halaman backup)
#   pasang-otomatis.ps1 -Hapus   -> lepas semuanya
#   tambahkan -Diam untuk mode tanpa interaksi (dipakai saat pengujian)
param(
    [switch]$Hapus,
    [switch]$Diam
)

$ErrorActionPreference = "Stop"
$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs = Join-Path $folder "jalankan-helper.vbs"
$protokol = "backup-listrik"
$regPath = "HKCU:\Software\Classes\$protokol"
$menuStartup = [Environment]::GetFolderPath("Startup")
$lnkStartup = Join-Path $menuStartup "Helper Backup Listrik.lnk"
$log = Join-Path $folder "uji\helper-otomatis.log"

function Info($teks) { Write-Host $teks }
function Ok($teks) { Write-Host $teks -ForegroundColor Green }
function Warn($teks) { Write-Host $teks -ForegroundColor Yellow }

Info "== Otomatisasi Helper Backup Listrik =="
Info "Folder : $folder"
Info ""

if ($Hapus) {
    if (Test-Path $regPath) {
        Remove-Item $regPath -Recurse -Force -ErrorAction SilentlyContinue
        Ok "[OK] Protokol tombol 'backup-listrik://' dihapus."
    } else {
        Warn "Protokol 'backup-listrik://' memang belum terpasang."
    }
    if (Test-Path $lnkStartup) {
        Remove-Item $lnkStartup -Force -ErrorAction SilentlyContinue
        Ok "[OK] Auto-start saat login dihapus."
    } else {
        Warn "Auto-start saat login memang belum terpasang."
    }
    Info ""
    Info "Helper tidak lagi menyala otomatis. Untuk menyalakan manual:"
    Info "  - klik dua kali 'mulai-backup.cmd', atau"
    Info "  - klik dua kali shortcut 'Backup Listrik' di Desktop."
    exit 0
}

if (-not (Test-Path $vbs)) {
    throw "Berkas 'jalankan-helper.vbs' tidak ditemukan di folder aplikasi."
}

# 1) Auto-start saat login Windows (shortcut di folder Startup)
try {
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($lnkStartup)
    $sc.TargetPath = "wscript.exe"
    $sc.Arguments = '"' + $vbs + '"'
    $sc.WorkingDirectory = $folder
    $sc.WindowStyle = 7
    $sc.Description = "Helper backup listrik (otomatis saat login)"
    $sc.Save()
    Ok "[OK] Auto-start saat login dipasang:"
    Info "     $lnkStartup"
} catch {
    Warn "[!] Gagal memasang auto-start: $($_.Exception.Message)"
}

# 2) Protokol tombol di halaman backup: backup-listrik://mulai
try {
    New-Item -Path $regPath -Force | Out-Null
    Set-ItemProperty -Path $regPath -Name "(default)" -Value "URL:Backup Listrik"
    New-ItemProperty -Path $regPath -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
    New-Item -Path "$regPath\shell\open\command" -Force | Out-Null
    $perintahReg = 'wscript.exe "' + $vbs + '" "%1"'
    Set-ItemProperty -Path "$regPath\shell\open\command" -Name "(default)" -Value $perintahReg
    Ok "[OK] Tombol 'Nyalakan helper' di halaman backup dipasang."
    Info "     Protokol: ${protokol}://mulai"
} catch {
    Warn "[!] Gagal memasang protokol tombol: $($_.Exception.Message)"
}

# 3) Laporan singkat
Info ""
$terpasang = 0
if (Test-Path $lnkStartup) { $terpasang++ }
if (Test-Path $regPath) { $terpasang++ }
if ($terpasang -eq 2) {
    Ok "Selesai: helper akan otomatis menyala saat login, dan tombol di halaman backup aktif."
} else {
    Warn "Sebagian otomatisasi gagal dipasang. Lihat pesan di atas."
}
Info ""
Info "Mulai sekarang: saat Windows login, helper backup menyala di latar belakang."
Info "Di halaman 'Backup & Restore', tombol 'Nyalakan helper otomatis' juga bisa dipakai kapan saja."
Info "Windows mungkin menampilkan konfirmasi 'Open Backup Listrik?' saat tombol diklik - pilih Buka/Open."
Info ""
if (-not $Diam) {
    Info "Untuk melepas otomatisasi: jalankan 'hapus-otomatis.cmd'."
    Info "Helper tetap bisa dinyalakan manual lewat 'mulai-backup.cmd'."
} 
Info ""
Info "Log helper otomatis: $log"
