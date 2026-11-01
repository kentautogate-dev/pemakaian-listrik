# Login + push pertama ke GitHub untuk fitur backup.
# Jalankan lewat login-github.cmd (klik dua kali), BUKAN dengan PowerShell yang dibatasi.
$ErrorActionPreference = "Continue"
$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $folder
$env:GIT_TERMINAL_PROMPT = "1"

Write-Host "== Login GitHub untuk backup ==" -ForegroundColor Cyan
Write-Host ""

$konfig = $null
if (Test-Path "backup-config.json") {
    try { $konfig = Get-Content "backup-config.json" -Raw | ConvertFrom-Json } catch { $konfig = $null }
}

$url = ""
$cabang = "main"
if ($konfig) {
    if ($konfig.repoGithub) { $url = $konfig.repoGithub.Trim() }
    if ($konfig.cabang) { $cabang = $konfig.cabang.Trim() }
}

if (-not $url) {
    Write-Host "[!] URL repo GitHub belum diisi." -ForegroundColor Yellow
    Write-Host "    Buka aplikasi -> halaman Backup & Restore -> isi 'URL repo GitHub' -> Simpan pengaturan."
    Write-Host "    Buat repo kosong dulu di https://github.com/new"
    Write-Host "    Contoh URL: https://github.com/username-anda/pemakaian-listrik.git"
    exit 1
}

Write-Host "Repo   : $url"
Write-Host "Cabang : $cabang"
Write-Host ""

# pastikan folder ini repo git
git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Membuat repo git lokal..."
    git init -b $cabang | Out-Null
}

# pastikan remote origin
$remoteSekarang = (git remote get-url origin 2>$null)
if (-not $remoteSekarang) {
    git remote add origin $url | Out-Null
    Write-Host "Remote origin ditambahkan."
} elseif ($remoteSekarang -ne $url) {
    git remote set-url origin $url | Out-Null
    Write-Host "Remote origin diperbarui."
}

# identitas git (pakai global bila ada)
$nama = (git config --global user.name 2>$null)
$email = (git config --global user.email 2>$null)
if ($nama) { git config user.name $nama }
if ($email) { git config user.email $email }

Write-Host ""
Write-Host "Menguji akses ke repo (tanpa login)..." -ForegroundColor DarkGray
$uji = git ls-remote --heads origin 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] Repo belum bisa diakses tanpa login." -ForegroundColor Yellow
    Write-Host "    Ini normal untuk repo private/baru. Lanjut login sekarang."
    Write-Host "    (Kalau nanti tetap gagal: pastikan repo SUDAH dibuat di https://github.com/new dan username di URL benar.)"
} else {
    Write-Host "[OK] Repo bisa diakses." -ForegroundColor Green
}

Write-Host ""
Write-Host "Menyiapkan commit pertama..."
git add -A | Out-Null
git commit -m "Persiapan backup listrik $(Get-Date -Format 'yyyy-MM-dd HH:mm')" 2>$null | Out-Null

Write-Host ""
Write-Host "Mengirim ke GitHub. Jendela login GitHub akan muncul — ikuti sampai selesai." -ForegroundColor Yellow
$keluaran = git push -u origin $cabang 2>&1
$keluaran | ForEach-Object { Write-Host $_ }
$hasil = $LASTEXITCODE

Write-Host ""
if ($hasil -eq 0) {
    Write-Host "[OK] Login & push berhasil." -ForegroundColor Green
    Write-Host "     Sekarang tombol backup ke GitHub di aplikasi sudah bisa dipakai."
    exit 0
}

$teks = ($keluaran | Out-String)
Write-Host "[GAGAL] Push belum berhasil (kode $hasil)." -ForegroundColor Red
Write-Host ""
if ($teks -match "Repository not found|not found") {
    Write-Host "Penyebab paling mungkin: repo belum ada / username di URL salah." -ForegroundColor Yellow
    Write-Host "  1. Buka https://github.com/new -> buat repo KOSONG bernama 'pemakaian-listrik' (tanpa README)."
    Write-Host "  2. Cek username GitHub Anda (buka profil di github.com) — username BUKAN email/nama tampilan."
    Write-Host "  3. Betulkan URL di aplikasi (Pengaturan backup), lalu jalankan login-github.cmd lagi."
} elseif ($teks -match "Authentication failed|could not read Username|permission denied|403") {
    Write-Host "Penyebab: login GitHub belum berhasil." -ForegroundColor Yellow
    Write-Host "  Jalankan lagi login-github.cmd, lalu selesaikan jendela login GitHub."
    Write-Host "  Bila jendela login tidak muncul, buka aplikasi 'Git Credential Manager' atau coba:"
    Write-Host "  git credential-manager configure"
} elseif ($teks -match "non-fast-forward|fetch first|rejected") {
    Write-Host "Penyebab: repo GitHub sudah berisi commit lain." -ForegroundColor Yellow
    Write-Host "  Pilihan: pulihkan lewat Restore dari GitHub, ATAU buat repo baru yang kosong lalu ganti URL."
} else {
    Write-Host "Periksa pesan di atas. Pastikan koneksi internet lancar dan repo sudah dibuat."
}
exit 1
