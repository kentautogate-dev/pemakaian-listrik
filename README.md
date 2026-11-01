# Pemakaian Listrik Rumah — pencatat kWh & biaya (versi 2)

Aplikasi web **offline** untuk mencatat pemakaian listrik rumah dari **angka sisa kWh di meteran/token**, lalu menghitung sendiri pemakaian, biaya, rekap mingguan/bulanan, dan perkiraan kapan token habis. Tidak butuh internet, server, atau akun — cukup buka `index.html` di browser.

Data Oktober 2026 (hasil pemindahan dari catatan manual) sudah dimuat sebagai data awal, jadi grafik dan analisa langsung terisi.

## Cara pakai harian (30 detik)

1. Buka `index.html` (klik dua kali).
2. Setiap pagi, baca angka **sisa kWh** di meteran, lalu isi:
   - **Tanggal catat** — otomatis hari ini.
   - **Sisa kWh di meteran** — angka yang tampil (boleh pakai titik/koma, mis. `1.286`).
   - **Token masuk (kWh)** — hanya diisi bila Anda mengisi token sebelum membaca angka tadi (mis. `109`).
   - **Catatan** — opsional (cuaca, rumah kosong, dsb).
3. Pratinjau langsung menunjukkan pemakaian & biaya hari sebelumnya, lalu klik **Simpan catatan**.
4. Pemakaian hari ini baru terhitung setelah catatan besok masuk (butuh dua angka untuk selisih).

> Catatan pertama = titik awal. Semakin rapi jam mencatat (mis. selalu jam 09.00), semakin akurat angka kWh/hari.

## Yang dihitung

| Nilai | Rumus |
|---|---|
| Pemakaian satu hari | `sisa hari ini + token masuk pada pembacaan berikutnya − sisa pembacaan berikutnya` |
| Biaya | `pemakaian × harga per kWh` |
| Rata-rata harian | `total kWh ÷ jumlah hari yang terhitung` |
| Subtotal mingguan | pekan **Senin–Minggu** (sama seperti catatan manual) |
| Rekap bulanan | total kWh, biaya, token masuk, sisa token awal → akhir |
| Estimasi token habis | `sisa token ÷ rata-rata 14 hari terakhir` |
| Proyeksi | `rata-rata harian × 30 hari` dan setahun |

Contoh dari data asli: 11 Okt sisa **1.205 kWh**, 12 Okt diisi token **109 kWh** dan sisa menjadi **1.309 kWh** → pemakaian 11 Okt = `1.205 + 109 − 1.309 = 5 kWh` = **Rp 9.175** pada harga Rp 1.835/kWh.

Angka kunci Oktober 2026: **180 kWh / Rp 330.300**, rata-rata **5,81 kWh/hari**, sisa token akhir **1.215 kWh** (Rp 2.229.525). Cocok dengan rekonsiliasi saldo: `1.286 + 109 − 1.215 = 180 kWh`.

## Harga & tarif

- Harga bawaan: **Rp 1.835/kWh**, mengikuti catatan manual.
- Di **Pengaturan** tersedia kolom **tarif dasar PLN** dan **PPJ (%)**; tombol **Pakai harga ini** menjumlahkannya menjadi harga efektif. Contoh: R-2/TR Rp 1.699,53 × (1 + 8%) = **Rp 1.835,49/kWh** — mendekati angka yang Anda pakai.
- Mengubah harga hanya memengaruhi tampilan biaya; angka kWh tidak berubah.

## Fitur

- **Grafik** harian / mingguan / bulanan, dengan pilihan satuan **kWh** atau **Rupiah**, garis rata-rata.
- **Analisa otomatis**: hari paling boros/hemat, hari yang jauh di atas rata-rata, hari tercatat 0 kWh, pola per hari dalam seminggu, estimasi token habis.
- **Saldo token**: sisa kWh, nilai rupiah, perkiraan habis, riwayat pengisian token, kalkulator beli token (Rp → kWh).
- **Tabel catatan harian** per bulan dengan subtotal mingguan dan total bulanan; bisa **ubah** (✎) dan **hapus** (🗑) dengan tombol **Urungkan** pada notifikasi.
- **Rekap bulanan** seluruh periode.
- **Impor** CSV / backup JSON, **ekspor** CSV / JSON, dan **cetak laporan** A4 untuk bulan yang sedang dipilih.
- **Tema gelap**, tampilan responsif untuk HP, pintasan `Ctrl+Enter` untuk menyimpan, `Esc` menutup dialog.

## Impor data

Klik **Impor**, pilih berkas CSV (contoh `contoh-catatan.csv`) atau backup JSON.

```csv
tanggal,sisa,masuk,catatan
2026-11-01,1215,0,pagi
2026-11-02,1209,0,
```

- Tanggal: `YYYY-MM-DD` (juga menerima `DD/MM/YYYY`).
- Angka boleh format Indonesia (`1.209,5`) maupun biasa (`1209.5`).
- Baris dengan tanggal yang sudah ada akan dilewati, kecuali centang **Timpa catatan yang tanggalnya sudah ada**.

## Backup & Restore (drive L:\ dan GitHub)

Ada halaman khusus **Backup & Restore** di aplikasi (menu di atas: *Catatan Listrik* / *Backup & Restore*).
Karena browser tidak boleh menulis ke `L:\` atau menjalankan `git push` sendiri, halaman ini memakai
**helper lokal** kecil (`server-backup.js`, Node.js) yang hanya mendengarkan di `127.0.0.1:8787`.

### Sekali persiapan

1. Pastikan **Node.js** terpasang (`node -v` di Command Prompt). Git dibutuhkan untuk backup GitHub.
2. Nyalakan helper: klik dua kali **shortcut `Backup Listrik` di Desktop**, atau **`mulai-backup.cmd`** di folder aplikasi.
   Jendela hitam **Helper Backup Listrik** akan terbuka dan aplikasi ikut terbuka.
   (Halaman Backup & Restore di aplikasi juga menampilkan langkah ini lengkap dengan path folder Anda.)
3. Buka halaman **Backup & Restore** → isi:
   - **Folder backup di L:\\** (default `L:\BACKUP_PEMAKAIAN_LISTRIK`),
   - **URL repo GitHub** (opsional) — buat dulu repo **kosong** di GitHub, mis. `https://github.com/username/pemakaian-listrik.git`,
   - **Cabang** (default `main`).
4. Untuk GitHub, login sekali: tutup dulu, klik dua kali **`login-github.cmd`**, ikuti jendela login GitHub.
   Setelah berhasil, tombol backup GitHub bisa dipakai.

> Status di halaman backup akan berubah hijau otomatis (±3 detik) setelah helper dinyalakan — tidak perlu memuat ulang.
> Jika muncul pesan helper belum aktif padahal jendela helper terbuka, tekan **Coba lagi**; panduan pemecahan masalah ada
> di bagian “Jika ada masalah” di bawah.

Helper tidak perlu dinyalakan untuk pemakaian harian aplikasi — hanya saat mau backup/restore.

### Cara backup

1. Pilih **Tujuan backup**: `Drive L:\`, `GitHub`, atau `Keduanya`.
2. Centang **Sertakan file project** bila ingin kode aplikasi + laporan ikut dibackup (disarankan).
3. Klik **Mulai backup**. Muncul **bar persen**, tahap proses, dan log langkah demi langkah.
4. Hasil backup ke L:\ berupa folder bertanggal, mis. `L:\BACKUP_PEMAKAIAN_LISTRIK\2026-11-01_18-30-00\`:
   - `data\terbaru.json` + `data\data-<waktu>.json` — data catatan dari browser,
   - `project\` — salinan seluruh file project,
   - `proyek.zip` — versi zip dari folder project,
   - `repo.bundle` — cadangan repo git (bila project sudah jadi repo),
   - `info.txt` — ringkasan backup.
5. Backup ke GitHub akan `git init` (sekali), commit, lalu push. Data disimpan di
   `data/terbaru.json` dan `data/riwayat/`.

> Backup pertama sudah dibuat di `L:\BACKUP_PEMAKAIAN_LISTRIK\2026-11-01_18-47-02`
> (data 32 catatan + 38 berkas project, termasuk `proyek.zip`).

### Cara restore

1. Pilih **Sumber**: `Drive L:\` atau `GitHub`.
2. Pilih **Yang dipulihkan**: `Data catatan saja`, `File project saja`, atau `Data + file project`.
3. Klik **Muat daftar**, pilih snapshot (L:\) atau commit (GitHub), lalu **Restore**.
4. Ikuti bar persen sampai selesai.
   - Restore data mengganti data di browser (data lama hilang — backup dulu bila ragu).
   - Restore file project membuat **cadangan keamanan otomatis** di L:\ (`<waktu>-sebelum-restore`) sebelum menimpa,
     lalu **muat ulang halaman** agar file baru dipakai.
   - Restore file project menimpa berkas yang ada di backup, tetapi **tidak menghapus** berkas tambahan
     yang tidak ada di backup (mis. file uji). Untuk bersih total, hapus manual file yang tidak diinginkan.

### Jika ada masalah

| Gejala | Solusi |
|---|---|
| Halaman backup bilang helper belum aktif | Jalankan `mulai-backup.cmd`; pastikan port 8787 tidak dipakai program lain |
| Drive L:\ tidak terdeteksi | Pastikan drive L: terpasang; helper membuat folder backup otomatis saat backup pertama |
| **“Repository not found” saat backup GitHub** | Tiga penyebab: (a) repo belum dibuat, (b) **username di URL salah**, (c) repo private & belum login. Buat repo **kosong** di https://github.com/new, cek username Anda di halaman profil GitHub (username ≠ email/nama tampilan), contoh URL benar: `https://github.com/kentautogate-dev/pemakaian-listrik.git`, lalu jalankan `login-github.cmd` sekali |
| Push GitHub gagal (login) | Jalankan `login-github.cmd` sekali, selesaikan jendela login GitHub, lalu coba backup lagi |
| Push ditolak (`non-fast-forward`/`rejected`) | Repo GitHub berisi commit yang tidak ada di lokal; pulihkan lewat Restore → GitHub, atau buat repo baru yang kosong |
| Cek cepat bantuan | Buka `http://127.0.0.1:8787/api/status` di browser; bila muncul `{"ok":true,...}` helper sehat |

> Backup GitHub sekarang memeriksa akses repo lebih dulu (tahap ±25%). Kalau URL/repo/log–in bermasalah, proses
> berhenti cepat dengan pesan + daftar **“Saran perbaikan”** di halaman, jadi tidak menunggu sampai akhir.

> Catatan keamanan: helper hanya bisa diakses dari komputer ini (`127.0.0.1`) dan tidak menyimpan token GitHub.
> Token hanya dipakai sesaat bila Anda mengisi variabel lingkungan `GITHUB_TOKEN` sebelum menjalankan helper.

## Cadangan & pindah perangkat

Data disimpan otomatis di **localStorage** browser. Agar aman:

1. **Ekspor → JSON** secara berkala (mis. tiap akhir bulan).
2. Untuk pindah browser/komputer: ekspor JSON di perangkat lama, lalu **Impor** file JSON tersebut di perangkat baru.

> Penyimpanan terikat pada browser + alamat halaman. Membuka aplikasi lewat `file://` dan lewat `http://localhost` dianggap dua penyimpanan berbeda — pilih satu cara dan konsisten.

## Data bawaan (Oktober 2026)

32 catatan: 1–31 Oktober 2026 + 1 November 2026 (pembanding agar pemakaian 31 Oktober bisa dihitung). Sumber: pembacaan ulang lembar catatan manual "BULAN: OKTOBER 2026".

- Tanggal/waktu baca: pagi ±09.00; minggu mengikuti Senin–Minggu.
- 12 Oktober ada pengisian token **109 kWh**.
- Catatan pada kolom catatan berasal dari kolom keterangan lembar asli (MENDUNG, ASAP, HUJAN, CERAH, MANTAP).
- Untuk menghapus/mengganti: **Pengaturan → Hapus semua data**, atau **Muat data Oktober 2026** untuk memuat ulang.
- Lembar asli punya dua salah hitung (baris 13 Okt dan baris 1 Nov). Aplikasi menghitung ulang dengan benar — rinciannya ada di laporan analisa.

## Laporan analisa

Lihat `analisa/laporan-analisa-oktober-2026.html` (siap cetak A4, ada versi `.md`), atau buka laporan langsung dari aplikasi lewat **Ekspor → Cetak laporan**.

## Berkas

| Berkas | Isi |
|---|---|
| `index.html` | Halaman aplikasi |
| `styles.css` | Tampilan terang/gelap + gaya cetak |
| `core.js` | Mesin hitung (tanpa DOM, bisa diuji terpisah) |
| `app.js` | Antarmuka, tabel, grafik, impor/ekspor |
| `backup.js` | Halaman Backup & Restore (bar persen, log, snapshot, commit) |
| `server-backup.js` | Helper lokal Node.js: backup/restore ke L:\ dan GitHub (port 8787) |
| `mulai-backup.cmd` | Nyalakan helper + buka aplikasi |
| `hentikan-backup.cmd` | Hentikan helper (port 8787) |
| `login-github.cmd` / `login-github.ps1` | Login GitHub sekali untuk backup (Git Credential Manager) |
| `data-oktober-2026.js` | Data catatan Oktober 2026 |
| `backup-config.json` | Pengaturan folder L:\ & repo GitHub (dibuat otomatis oleh helper) |
| `contoh-catatan.csv` | Contoh format impor |
| `uji/core.test.cjs` | Uji logika dengan Node (`node uji/core.test.cjs`) |
| `uji/uji-backup.mjs` | Uji otomatis helper backup (`node uji/uji-backup.mjs`) |
| `uji/` | Skrip & tangkapan layar pengujian browser |
| `analisa/` | Data olahan, laporan analisa, dan skrip hitung |

## Catatan teknis

- Vanilla HTML/CSS/JS, tanpa CDN dan tanpa dependensi — aman dipakai offline.
- Logika hitung dipisah di `core.js` sehingga bisa diuji tanpa browser: `node uji/core.test.cjs` (semua pemeriksaan harus `OK`).
- Fitur backup butuh **Node.js** (untuk helper) dan **git** (untuk GitHub); aplikasi harian tetap jalan tanpa keduanya.
- Helper backup hanya mendengarkan `127.0.0.1:8787`, data dikirim dari browser lewat `fetch` (CORS lokal), sehingga
  aplikasi tetap bisa dibuka langsung dari `index.html` (`file://`) tanpa mengubah data yang sudah ada.
- Harga, tarif, nama rumah, dan jam catat bisa diubah kapan saja di **Pengaturan**.
