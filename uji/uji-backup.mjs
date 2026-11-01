#!/usr/bin/env node
/*
 * uji-backup.mjs — uji otomatis untuk `server-backup.js`.
 *
 * Menjalankan server backup sebagai proses anak memakai salinan project di
 * folder temp (BACKUP_PROJECT), folder backup temp (BACKUP_FOLDER), bare repo
 * git temp sebagai remote GitHub (lewat konfigurasi temp), dan port bebas
 * (BACKUP_PORT, bukan 8787). Folder project asli TIDAK pernah diubah dan
 * TIDAK pernah di-`git init`.
 *
 * Cara menjalankan (dari folder project):
 *   node uji/uji-backup.mjs
 *
 * Exit code 0 hanya bila semua pemeriksaan lulus.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

/* ========================================================================== *
 * Jalur & konstanta
 * ========================================================================== */

const AKAR_PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BERKAS_SERVER = path.join(AKAR_PROJECT, "server-backup.js");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "uji-backup-"));
const PROYEK = path.join(TEMP, "project");
const BACKUP = path.join(TEMP, "backup");
const REMOTE = path.join(TEMP, "remote.git");
const KONFIG = path.join(TEMP, "backup-config.json");
const LOG_SERVER = path.join(TEMP, "server.log");

const ID_SNAPSHOT = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

const DATA = {
  v: 1,
  settings: { tarif: 1444.7, ppn: false, nama: "Rumah Uji" },
  catatan: [
    { id: "c1", tanggal: "2026-10-01", sisa: 12.5, masuk: 0, catatan: "awal" },
    { id: "c2", tanggal: "2026-10-02", sisa: 9.75, masuk: 0, catatan: "pemakaian harian" },
    { id: "c3", tanggal: "2026-10-03", sisa: 50, masuk: 100000, catatan: "isi token" }
  ]
};

let PORT = 0;
let serverAnak = null;
let powershellAda = false;

let jumlahOk = 0;
let jumlahGagal = 0;
const daftarGagal = [];

/* ========================================================================== *
 * Util kecil
 * ========================================================================== */

function tidur(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(kondisi, pesan) {
  if (!kondisi) throw new Error(pesan);
}

function assertSama(nyata, harapan, pesan) {
  const a = JSON.stringify(nyata);
  const b = JSON.stringify(harapan);
  if (a !== b) {
    throw new Error(`${pesan}\n      nyata  : ${potong(a, 400)}\n      harapan: ${potong(b, 400)}`);
  }
}

function potong(teks, maks) {
  const t = String(teks == null ? "" : teks);
  return t.length > maks ? `${t.slice(0, maks)}...` : t;
}

async function cek(nama, fn) {
  try {
    await fn();
    jumlahOk += 1;
    console.log(`OK    ${nama}`);
  } catch (e) {
    jumlahGagal += 1;
    daftarGagal.push({ nama, pesan: e.message });
    console.log(`GAGAL ${nama}`);
    for (const baris of String(e.message).split("\n")) console.log(`      -> ${baris}`);
  }
}

/* ========================================================================== *
 * HTTP client ke server
 * ========================================================================== */

function httpJson(metode, jalur, isi) {
  return new Promise((resolve, reject) => {
    const data = isi === undefined ? null : JSON.stringify(isi);
    const opsi = {
      host: "127.0.0.1",
      port: PORT,
      path: jalur,
      method: metode,
      timeout: 60000,
      headers: { Origin: "null", Accept: "application/json" }
    };
    if (data !== null) {
      opsi.headers["Content-Type"] = "application/json";
      opsi.headers["Content-Length"] = Buffer.byteLength(data);
    }
    const req = http.request(opsi, (res) => {
      let teks = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        teks += c;
      });
      res.on("end", () => {
        let body = null;
        try {
          body = teks ? JSON.parse(teks) : null;
        } catch (e) {
          body = teks;
        }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Timeout HTTP")));
    if (data !== null) req.write(data);
    req.end();
  });
}

/* ========================================================================== *
 * Git helper (untuk menyiapkan & memeriksa repo uji)
 * ========================================================================== */

function gitQ(args, opsi = {}) {
  const r = spawnSync("git", args, {
    cwd: opsi.cwd || PROYEK,
    encoding: "utf8",
    windowsHide: true,
    timeout: opsi.timeoutMs || 60000
  });
  return {
    ok: r.status === 0,
    status: r.status,
    out: String(r.stdout || "").trim(),
    err: String(r.stderr || "").trim(),
    error: r.error || null
  };
}

function gitWajib(args, opsi = {}) {
  const r = gitQ(args, opsi);
  if (!r.ok) {
    throw new Error(`git ${args.join(" ")} gagal: ${r.err || (r.error && r.error.message) || "tanpa pesan"}`);
  }
  return r;
}

function gitBare(args) {
  return gitQ(["--git-dir", REMOTE, ...args]);
}

/* ========================================================================== *
 * Deteksi PowerShell (untuk tahu apakah proyek.zip wajib ada)
 * ========================================================================== */

function deteksiPowerShell() {
  for (const exe of ["pwsh", "powershell"]) {
    const r = spawnSync(
      exe,
      ["-NoProfile", "-NonInteractive", "-Command", "Get-Command Compress-Archive -ErrorAction Stop | Out-Null"],
      { encoding: "utf8", windowsHide: true, timeout: 40000 }
    );
    if (r.status === 0) return true;
  }
  return false;
}

/* ========================================================================== *
 * Port bebas
 * ========================================================================== */

async function cariPortBebas(mulai = 8799) {
  for (let p = mulai; p < mulai + 80; p += 1) {
    const bebas = await new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(false));
      s.listen(p, "127.0.0.1", () => s.close(() => resolve(true)));
    });
    if (bebas) return p;
  }
  throw new Error("Tidak ada port bebas untuk uji.");
}

/* ========================================================================== *
 * Persiapan folder temp
 * ========================================================================== */

async function siapkan() {
  fs.mkdirSync(PROYEK, { recursive: true });

  // Salinan berkas project asli (tanpa uji/, tanpa .git, tanpa server-backup.js).
  const berkasProject = [
    "index.html",
    "core.js",
    "app.js",
    "styles.css",
    "README.md",
    "data-oktober-2026.js",
    "contoh-catatan.csv"
  ];
  for (const nama of berkasProject) {
    const asal = path.join(AKAR_PROJECT, nama);
    if (fs.existsSync(asal)) fs.copyFileSync(asal, path.join(PROYEK, nama));
  }

  // Berkas dummy: harus ikut backup.
  fs.mkdirSync(path.join(PROYEK, "dummy"), { recursive: true });
  fs.writeFileSync(path.join(PROYEK, "dummy", "catatan.txt"), "berkas dummy untuk uji backup\n", "utf8");
  fs.mkdirSync(path.join(PROYEK, "sub"), { recursive: true });
  fs.writeFileSync(path.join(PROYEK, "sub", "angka.txt"), "1 2 3 4 5\n", "utf8");

  // Berkas yang HARUS dikecualikan dari backup project.
  fs.mkdirSync(path.join(PROYEK, ".backup"), { recursive: true });
  fs.writeFileSync(path.join(PROYEK, ".backup", "rahasia.txt"), "jangan disalin\n", "utf8");
  fs.mkdirSync(path.join(PROYEK, "node_modules", "paket"), { recursive: true });
  fs.writeFileSync(path.join(PROYEK, "node_modules", "paket", "index.js"), "module.exports = 1;\n", "utf8");
  fs.mkdirSync(path.join(PROYEK, "__pycache__"), { recursive: true });
  fs.writeFileSync(path.join(PROYEK, "__pycache__", "x.pyc"), "abc", "utf8");
  fs.writeFileSync(
    path.join(PROYEK, "backup-config.json"),
    `${JSON.stringify({ folderBackup: "Z:\\TIDAK_DIPAKAI" }, null, 2)}\n`,
    "utf8"
  );

  // Folder backup & konfigurasi server (terpisah dari project).
  fs.mkdirSync(BACKUP, { recursive: true });
  const konfigAwal = {
    folderBackup: BACKUP,
    repoGithub: "",
    cabang: "main",
    port: PORT,
    versi: 1
  };
  fs.writeFileSync(KONFIG, `${JSON.stringify(konfigAwal, null, 2)}\n`, "utf8");

  // Jadikan temp project sebuah repo git dengan satu commit, supaya jalur
  // git bundle & restore project benar-benar teruji.
  gitWajib(["init", "-q"], { cwd: PROYEK });
  gitWajib(["config", "user.email", "uji@lokal"], { cwd: PROYEK });
  gitWajib(["config", "user.name", "Uji Backup"], { cwd: PROYEK });
  gitWajib(["add", "-A"], { cwd: PROYEK });
  gitWajib(["commit", "-q", "-m", "commit awal uji"], { cwd: PROYEK });

  // Remote GitHub tiruan: bare repo lokal.
  gitWajib(["init", "--bare", "-q", REMOTE], { cwd: TEMP });
}

/* ========================================================================== *
 * Server proses anak
 * ========================================================================== */

function mulaiServer() {
  const fdLog = fs.openSync(LOG_SERVER, "a");
  const env = {
    ...process.env,
    BACKUP_PROJECT: PROYEK,
    BACKUP_FOLDER: BACKUP,
    BACKUP_CONFIG: KONFIG,
    BACKUP_PORT: String(PORT)
  };
  delete env.BACKUP_REMOTE; // remote diatur lewat konfigurasi temp
  delete env.GITHUB_TOKEN; // jangan pakai token sungguhan saat uji

  serverAnak = spawn(process.execPath, [BERKAS_SERVER], {
    cwd: PROYEK,
    env,
    stdio: ["ignore", fdLog, fdLog],
    windowsHide: true
  });
  serverAnak.on("exit", (kode) => {
    if (kode !== null && kode !== 0) {
      console.error(`[uji] server anak berhenti dengan kode ${kode}`);
    }
  });
}

async function tungguServerSiap(batasMs = 40000) {
  const mulai = Date.now();
  while (Date.now() - mulai < batasMs) {
    if (serverAnak && serverAnak.exitCode !== null) {
      throw new Error(`Server berhenti dini (kode ${serverAnak.exitCode}). Log: ${cuplikanLog()}`);
    }
    try {
      const r = await httpJson("GET", "/api/status");
      if (r.status === 200 && r.body && r.body.ok === true) return r.body;
    } catch (e) {
      /* server belum siap */
    }
    await tidur(120);
  }
  throw new Error(`Server tidak siap dalam batas waktu. Log: ${cuplikanLog()}`);
}

function cuplikanLog(maks = 2000) {
  try {
    const teks = fs.readFileSync(LOG_SERVER, "utf8");
    return potong(teks.slice(-maks), maks);
  } catch (e) {
    return "(log tidak terbaca)";
  }
}

async function matikanServer() {
  if (!serverAnak || serverAnak.exitCode !== null) return;
  const anak = serverAnak;
  await new Promise((resolve) => {
    const batas = setTimeout(() => {
      try {
        anak.kill("SIGKILL");
      } catch (e) {
        /* abaikan */
      }
      resolve();
    }, 8000);
    anak.once("exit", () => {
      clearTimeout(batas);
      resolve();
    });
    try {
      anak.kill();
    } catch (e) {
      clearTimeout(batas);
      resolve();
    }
  });
}

/* ========================================================================== *
 * Polling job
 * ========================================================================== */

async function tungguJob(jobId, opsi = {}) {
  const batasMs = opsi.batasMs || 240000;
  const intervalMs = opsi.intervalMs || 45;
  const mulai = Date.now();
  const contohPersen = [];
  let terakhir = null;

  while (Date.now() - mulai < batasMs) {
    const r = await httpJson("GET", `/api/job/${encodeURIComponent(jobId)}`);
    if (r.status !== 200 || !r.body || r.body.ok !== true) {
      throw new Error(`Job ${jobId} tidak bisa dibaca: status ${r.status} ${potong(JSON.stringify(r.body), 300)}`);
    }
    const job = r.body.job;
    contohPersen.push(job.persen);
    terakhir = job;
    if (job.selesai === true) return { job, contohPersen };
    await tidur(intervalMs);
  }
  throw new Error(
    `Job ${jobId} tidak selesai dalam batas waktu. Terakhir: ${potong(
      JSON.stringify(terakhir && { persen: terakhir.persen, tahap: terakhir.tahap, galat: terakhir.galat }),
      300
    )}`
  );
}

async function mulaiBackup(isi) {
  return httpJson("POST", "/api/backup", isi);
}

async function mulaiRestore(isi) {
  return httpJson("POST", "/api/restore", isi);
}

/** Tunggu sampai detik jam berganti, supaya id snapshot unik antar-backup. */
async function tungguDetikBaru() {
  const detik = Math.floor(Date.now() / 1000);
  while (Math.floor(Date.now() / 1000) === detik) await tidur(40);
}

/* ========================================================================== *
 * Program utama
 * ========================================================================== */

async function utama() {
  PORT = await cariPortBebas(8799);
  powershellAda = deteksiPowerShell();

  console.log("=== UJI server-backup.js ===");
  console.log(`Temp       : ${TEMP}`);
  console.log(`Project uji: ${PROYEK}`);
  console.log(`Backup uji : ${BACKUP}`);
  console.log(`Remote uji : ${REMOTE} (${pathToFileURL(REMOTE).href})`);
  console.log(`Port uji   : ${PORT}`);
  console.log(`PowerShell : ${powershellAda ? "ada" : "tidak ada"}`);
  console.log("");

  await siapkan();
  mulaiServer();
  const statusAwal = await tungguServerSiap();

  let snapshotA = null;
  let snapshotB = null;
  let jobDataLokal = null;
  let resp409 = null;

  /* ---------------------------------------------------------------- status */

  await cek("GET /api/status merespons & identitas aplikasi benar", async () => {
    assert(statusAwal.ok === true, "ok bukan true");
    assert(statusAwal.aplikasi === "pemakaian-listrik-backup", `aplikasi = ${statusAwal.aplikasi}`);
    assert(statusAwal.versi === 1, `versi = ${statusAwal.versi}`);
    assert(typeof statusAwal.waktu === "string" && !Number.isNaN(Date.parse(statusAwal.waktu)), `waktu = ${statusAwal.waktu}`);
  });

  await cek("GET /api/status: project.folder & folderBackup.path sesuai env uji", async () => {
    assert(
      path.resolve(statusAwal.project.folder) === path.resolve(PROYEK),
      `project.folder = ${statusAwal.project.folder}, harusnya ${PROYEK}`
    );
    assert(statusAwal.project.jumlahBerkas >= 8, `project.jumlahBerkas = ${statusAwal.project.jumlahBerkas}`);
    assert(
      path.resolve(statusAwal.folderBackup.path) === path.resolve(BACKUP),
      `folderBackup.path = ${statusAwal.folderBackup.path}, harusnya ${BACKUP}`
    );
    assert(statusAwal.folderBackup.ada === true, "folderBackup.ada harus true");
    assert(
      typeof statusAwal.folderBackup.bebasMB === "number" && statusAwal.folderBackup.bebasMB > 0,
      `folderBackup.bebasMB = ${statusAwal.folderBackup.bebasMB}`
    );
  });

  await cek("GET /api/status: snapshots=0, jobAktif=null, git terdeteksi", async () => {
    assert(statusAwal.snapshots === 0, `snapshots = ${statusAwal.snapshots}`);
    assert(statusAwal.jobAktif === null, `jobAktif = ${statusAwal.jobAktif}`);
    assert(statusAwal.github.gitTersedia === true, "github.gitTersedia harus true");
    assert(statusAwal.github.repo === true, "github.repo harus true (repo git temp)");
    assert(typeof statusAwal.github.commit === "string" && statusAwal.github.commit.length > 0, "github.commit kosong");
    assert(statusAwal.github.kotor === false, "github.kotor harus false sebelum ada perubahan");
  });

  await cek("Response API memakai header CORS Access-Control-Allow-Origin: *", async () => {
    const r = await httpJson("GET", "/api/status");
    assert(r.headers["access-control-allow-origin"] === "*", `header = ${r.headers["access-control-allow-origin"]}`);
  });

  /* ----------------------------------------------------------- konfigurasi */

  await cek("GET /api/konfigurasi mengembalikan konfigurasi efektif (env menang)", async () => {
    const r = await httpJson("GET", "/api/konfigurasi");
    assert(r.status === 200 && r.body.ok === true, `status ${r.status} ${potong(JSON.stringify(r.body), 200)}`);
    assert(path.resolve(r.body.konfigurasi.folderBackup) === path.resolve(BACKUP), `folderBackup = ${r.body.konfigurasi.folderBackup}`);
    assert(r.body.konfigurasi.cabang === "main", `cabang = ${r.body.konfigurasi.cabang}`);
    assert(r.body.konfigurasi.port === PORT, `port = ${r.body.konfigurasi.port}, harusnya ${PORT}`);
  });

  const remoteUrl = pathToFileURL(REMOTE).href;

  await cek("POST /api/konfigurasi menyimpan cabang & repoGithub ke file", async () => {
    const r = await httpJson("POST", "/api/konfigurasi", { cabang: "uji-cabang", repoGithub: remoteUrl });
    assert(r.status === 200 && r.body.ok === true, `status ${r.status} ${potong(JSON.stringify(r.body), 300)}`);
    assert(r.body.konfigurasi.cabang === "uji-cabang", `cabang = ${r.body.konfigurasi.cabang}`);
    assert(r.body.konfigurasi.repoGithub === remoteUrl, `repoGithub = ${r.body.konfigurasi.repoGithub}`);
    const isi = JSON.parse(fs.readFileSync(KONFIG, "utf8"));
    assert(isi.cabang === "uji-cabang", `file konfigurasi: cabang = ${isi.cabang}`);
    assert(isi.repoGithub === remoteUrl, "file konfigurasi tidak menyimpan repoGithub");
    const r2 = await httpJson("GET", "/api/konfigurasi");
    assert(r2.body.konfigurasi.cabang === "uji-cabang", "GET /api/konfigurasi tidak mencerminkan perubahan");
  });

  await cek("POST /api/konfigurasi menolak folderBackup relatif (400)", async () => {
    const r = await httpJson("POST", "/api/konfigurasi", { folderBackup: "backup-relatif" });
    assert(r.status === 400, `status = ${r.status}`);
    assert(r.body && r.body.ok === false, `body = ${potong(JSON.stringify(r.body), 200)}`);
    assert(typeof r.body.galat === "string" && r.body.galat.length > 10, "galat harus pesan Indonesia yang jelas");
  });

  await cek("POST /api/konfigurasi menolak repoGithub tidak valid (400)", async () => {
    const r = await httpJson("POST", "/api/konfigurasi", { repoGithub: "bukan-url-github" });
    assert(r.status === 400, `status = ${r.status}`);
    assert(r.body && r.body.ok === false && typeof r.body.galat === "string", `body = ${potong(JSON.stringify(r.body), 200)}`);
  });

  await cek("POST /api/konfigurasi menolak cabang tidak aman (400)", async () => {
    const r = await httpJson("POST", "/api/konfigurasi", { cabang: "a b" });
    assert(r.status === 400, `status = ${r.status}`);
    assert(r.body && r.body.ok === false, `body = ${potong(JSON.stringify(r.body), 200)}`);
  });

  await cek("POST /api/konfigurasi mengembalikan cabang main & remote uji", async () => {
    const r = await httpJson("POST", "/api/konfigurasi", { cabang: "main", repoGithub: remoteUrl });
    assert(r.status === 200 && r.body.ok === true, `status ${r.status}`);
    assert(r.body.konfigurasi.cabang === "main", `cabang = ${r.body.konfigurasi.cabang}`);
    assert(r.body.konfigurasi.repoGithub === remoteUrl, `repoGithub = ${r.body.konfigurasi.repoGithub}`);
  });

  /* -------------------------------------------------------- backup lokal 1 */

  await cek("POST /api/backup lokal (data saja) membuat job yang sukses 100", async () => {
    const r = await mulaiBackup({ sumber: "lokal", project: false, data: DATA });
    assert(r.status === 200 && r.body && r.body.ok === true, `status ${r.status} ${potong(JSON.stringify(r.body), 300)}`);
    assert(typeof r.body.jobId === "string" && r.body.jobId.length > 3, `jobId = ${r.body.jobId}`);

    jobDataLokal = await tungguJob(r.body.jobId);
    const job = jobDataLokal.job;
    assert(job.jenis === "backup-lokal", `jenis = ${job.jenis}`);
    assert(job.galat === null, `galat = ${job.galat}`);
    assert(job.selesai === true && job.persen === 100, `selesai=${job.selesai} persen=${job.persen}`);
    assert(typeof job.hasil === "object" && job.hasil !== null, "hasil kosong");
    assert(typeof job.hasil.snapshot === "string" && ID_SNAPSHOT.test(job.hasil.snapshot), `hasil.snapshot = ${job.hasil && job.hasil.snapshot}`);
    assert(fs.existsSync(job.hasil.folder), `folder snapshot tidak ada: ${job.hasil.folder}`);
    assert(job.hasil.adaZip === false, `adaZip = ${job.hasil.adaZip}, harusnya false untuk backup data saja`);
    assert(job.hasil.adaBundle === false, `adaBundle = ${job.hasil.adaBundle}, harusnya false untuk backup data saja`);
    assert(Number.isFinite(job.hasil.ukuranMB) && job.hasil.ukuranMB >= 0, `ukuranMB = ${job.hasil.ukuranMB}`);
    snapshotA = job.hasil.snapshot;
  });

  await cek("Job publik: persen monoton naik, format log benar, berakhir 100", async () => {
    assert(jobDataLokal, "job sebelumnya gagal sehingga data job tidak ada");
    const contoh = [0, ...jobDataLokal.contohPersen];
    for (let i = 1; i < contoh.length; i += 1) {
      assert(contoh[i] >= contoh[i - 1], `persen turun dari ${contoh[i - 1]} ke ${contoh[i]}`);
    }
    assert(jobDataLokal.job.persen === 100, `persen akhir = ${jobDataLokal.job.persen}`);
    assert(Array.isArray(jobDataLokal.job.log) && jobDataLokal.job.log.length >= 3, `log = ${jobDataLokal.job.log && jobDataLokal.job.log.length}`);
    assert(
      jobDataLokal.job.log.every(
        (e) => typeof e.waktu === "string" && typeof e.persen === "number" && typeof e.pesan === "string"
      ),
      "format entri log tidak sesuai {waktu, persen, pesan}"
    );
    assert(typeof jobDataLokal.job.tahap === "string" && jobDataLokal.job.tahap.length > 0, "tahap kosong");
    assert(typeof jobDataLokal.job.mulai === "string" && typeof jobDataLokal.job.selesaiWaktu === "string", "mulai/selesaiWaktu kosong");
    assert(
      jobDataLokal.job.log.some((e) => /Memeriksa folder backup/i.test(e.pesan)),
      "log tidak memuat tahap awal backup lokal"
    );
  });

  await cek("Snapshot lokal data berisi terbaru.json & data-<id>.json dengan isi benar", async () => {
    assert(snapshotA, "snapshotA tidak terbentuk");
    const folder = path.join(BACKUP, snapshotA);
    const terbaru = path.join(folder, "data", "terbaru.json");
    const salinan = path.join(folder, "data", `data-${snapshotA}.json`);
    assert(fs.existsSync(terbaru), `tidak ada ${terbaru}`);
    assert(fs.existsSync(salinan), `tidak ada ${salinan}`);
    assertSama(JSON.parse(fs.readFileSync(terbaru, "utf8")), DATA, "isi terbaru.json tidak sama dengan data yang dikirim");
    assertSama(JSON.parse(fs.readFileSync(salinan, "utf8")), DATA, "isi data-<stamp>.json tidak sama dengan data yang dikirim");
  });

  await cek("GET /api/snapshots mendaftar snapshot data dengan metadata benar", async () => {
    const r = await httpJson("GET", "/api/snapshots");
    assert(r.status === 200 && r.body.ok === true, `status ${r.status}`);
    assert(r.body.total === 1, `total = ${r.body.total}`);
    assert(Array.isArray(r.body.snapshots) && r.body.snapshots.length === 1, `snapshots = ${r.body.snapshots && r.body.snapshots.length}`);
    const s = r.body.snapshots[0];
    assert(s.id === snapshotA, `id = ${s.id}`);
    assert(s.adaData === true, "adaData harus true");
    assert(s.adaProject === false, "adaProject harus false");
    assert(s.adaZip === false, "adaZip harus false");
    assert(s.adaBundle === false, "adaBundle harus false");
    assert(typeof s.waktu === "string" && !Number.isNaN(Date.parse(s.waktu)), `waktu = ${s.waktu}`);
    assert(Number.isFinite(s.ukuranMB) && s.ukuranMB >= 0, `ukuranMB = ${s.ukuranMB}`);
    assert(s.jumlahBerkas >= 2, `jumlahBerkas = ${s.jumlahBerkas}`);
  });

  /* -------------------------------------------------------- backup lokal 2 */

  await cek("POST /api/backup lokal (data+project) sukses dengan zip & bundle", async () => {
    await tungguDetikBaru();
    const r = await mulaiBackup({ sumber: "lokal", project: true, data: DATA });
    assert(r.status === 200 && r.body && r.body.ok === true, `status ${r.status} ${potong(JSON.stringify(r.body), 300)}`);
    assert(typeof r.body.jobId === "string", "jobId kosong");

    // Job kedua saat job pertama masih berjalan harus ditolak 409.
    resp409 = await mulaiBackup({ sumber: "lokal", project: false, data: DATA });

    const { job } = await tungguJob(r.body.jobId);
    assert(job.galat === null, `galat = ${job.galat}`);
    assert(job.selesai === true && job.persen === 100, `selesai=${job.selesai} persen=${job.persen}`);
    const hasil = job.hasil;
    assert(hasil && typeof hasil.snapshot === "string" && ID_SNAPSHOT.test(hasil.snapshot), `snapshot = ${hasil && hasil.snapshot}`);
    assert(hasil.snapshot !== snapshotA, "id snapshot kedua sama dengan snapshot pertama");
    assert(hasil.jumlahBerkas >= 9, `jumlahBerkas = ${hasil.jumlahBerkas}`);
    assert(hasil.adaBundle === true, `adaBundle = ${hasil.adaBundle} (repo git temp punya commit) -> ${potong(JSON.stringify(job.log), 500)}`);
    if (powershellAda) {
      assert(hasil.adaZip === true, `adaZip = ${hasil.adaZip} (PowerShell tersedia) -> ${potong(JSON.stringify(job.log), 500)}`);
    }
    snapshotB = hasil.snapshot;
  });

  await cek("POST /api/backup saat masih ada job berjalan ditolak 409", async () => {
    assert(resp409 !== null, "respons backup kedua tidak terekam");
    assert(resp409.status === 409, `status = ${resp409.status}, harusnya 409`);
    assert(resp409.body && resp409.body.ok === false, `body = ${potong(JSON.stringify(resp409.body), 200)}`);
    assert(typeof resp409.body.galat === "string" && resp409.body.galat.length > 10, "galat 409 harus jelas");
  });

  await cek("Snapshot project menyalin berkas & mengecualikan .git/.backup/node_modules", async () => {
    assert(snapshotB, "snapshotB tidak terbentuk");
    const folder = path.join(BACKUP, snapshotB);
    const proj = path.join(folder, "project");
    assert(fs.existsSync(proj), `folder ${proj} tidak ada`);
    assert(fs.existsSync(path.join(proj, "index.html")), "index.html tidak ikut tersalin");
    assert(fs.existsSync(path.join(proj, "dummy", "catatan.txt")), "dummy/catatan.txt tidak ikut tersalin");
    assert(fs.existsSync(path.join(proj, "sub", "angka.txt")), "sub/angka.txt tidak ikut tersalin");
    assert(!fs.existsSync(path.join(proj, ".git")), ".git tidak boleh disalin");
    assert(!fs.existsSync(path.join(proj, ".backup")), ".backup tidak boleh disalin");
    assert(!fs.existsSync(path.join(proj, "node_modules")), "node_modules tidak boleh disalin");
    assert(!fs.existsSync(path.join(proj, "__pycache__")), "__pycache__ tidak boleh disalin");
    assert(!fs.existsSync(path.join(proj, "backup-config.json")), "backup-config.json tidak boleh disalin");
    assert(fs.existsSync(path.join(folder, "repo.bundle")), "repo.bundle tidak ada");
    if (powershellAda) assert(fs.existsSync(path.join(folder, "proyek.zip")), "proyek.zip tidak ada");
    assert(fs.existsSync(path.join(folder, "data", "terbaru.json")), "data snapshot tidak ada");
  });

  await cek("Snapshot berisi info.txt ringkasan (waktu, data, berkas project)", async () => {
    assert(snapshotB, "snapshotB tidak terbentuk");
    const info = path.join(BACKUP, snapshotB, "info.txt");
    assert(fs.existsSync(info), "info.txt tidak ada");
    const teks = fs.readFileSync(info, "utf8");
    assert(/Berkas proyek\s*:\s*\d+/.test(teks), `info.txt tidak menyebut berkas proyek: ${potong(teks, 300)}`);
    assert(/Jumlah data\s*:\s*3 catatan/.test(teks), `info.txt tidak menyebut jumlah data: ${potong(teks, 300)}`);
    assert(teks.includes(snapshotB), "info.txt tidak menyebut id snapshot");
    assert(/Waktu dibuat/i.test(teks), "info.txt tidak menyebut waktu dibuat");
  });

  await cek("GET /api/snapshots mengurutkan snapshot terbaru lebih dulu", async () => {
    const r = await httpJson("GET", "/api/snapshots");
    assert(r.body.total === 2, `total = ${r.body.total}`);
    assert(r.body.snapshots[0].id === snapshotB, `[0] = ${r.body.snapshots[0].id}, harusnya ${snapshotB}`);
    assert(r.body.snapshots[1].id === snapshotA, `[1] = ${r.body.snapshots[1].id}, harusnya ${snapshotA}`);
  });

  /* ------------------------------------------------------- restore lokal   */

  await cek("Restore data lokal mengembalikan isi data yang sama", async () => {
    const r = await mulaiRestore({ sumber: "lokal", snapshot: snapshotA, bagian: "data" });
    assert(r.status === 200 && r.body && r.body.ok === true, `status ${r.status} ${potong(JSON.stringify(r.body), 300)}`);
    const { job } = await tungguJob(r.body.jobId);
    assert(job.jenis === "restore-lokal", `jenis = ${job.jenis}`);
    assert(job.galat === null, `galat = ${job.galat}`);
    assert(job.persen === 100, `persen = ${job.persen}`);
    assert(job.hasil && job.hasil.snapshot === snapshotA, `hasil.snapshot = ${job.hasil && job.hasil.snapshot}`);
    assertSama(job.hasil.data, DATA, "data hasil restore tidak sama");
  });

  await cek("Restore project lokal mengembalikan berkas & membuat cadangan keamanan", async () => {
    const berkasIndex = path.join(PROYEK, "index.html");
    const asli = fs.readFileSync(berkasIndex, "utf8");
    fs.writeFileSync(berkasIndex, `${asli}\n<!-- DIUBAH UJI -->\n`, "utf8");
    assert(fs.readFileSync(berkasIndex, "utf8").includes("DIUBAH UJI"), "gagal mengubah berkas uji");

    const r = await mulaiRestore({ sumber: "lokal", snapshot: snapshotB, bagian: "project" });
    assert(r.status === 200 && r.body && r.body.ok === true, `status ${r.status} ${potong(JSON.stringify(r.body), 300)}`);
    const { job } = await tungguJob(r.body.jobId);
    assert(job.galat === null, `galat = ${job.galat}`);
    const sesudah = fs.readFileSync(berkasIndex, "utf8");
    assert(!sesudah.includes("DIUBAH UJI"), "index.html tidak kembali ke versi snapshot");
    assert(job.hasil.projectFiles >= 9, `projectFiles = ${job.hasil.projectFiles}`);
    assert(typeof job.hasil.cadangan === "string" && fs.existsSync(job.hasil.cadangan), `cadangan tidak ada: ${job.hasil.cadangan}`);
    const cadanganIndex = path.join(job.hasil.cadangan, "project", "index.html");
    assert(fs.existsSync(cadanganIndex), `cadangan ${cadanganIndex} tidak ada`);
    assert(fs.readFileSync(cadanganIndex, "utf8").includes("DIUBAH UJI"), "cadangan tidak memuat versi sebelum restore");
    assert(fs.existsSync(path.join(PROYEK, "backup-config.json")), "backup-config.json project jangan sampai terhapus");
  });

  /* ------------------------------------------------------ backup github    */

  await cek("POST /api/backup github sukses & commit ada di bare repo", async () => {
    await tungguDetikBaru();
    const r = await mulaiBackup({
      sumber: "github",
      project: true,
      data: DATA,
      pesan: "Backup uji dari uji-backup"
    });
    assert(r.status === 200 && r.body && r.body.ok === true, `status ${r.status} ${potong(JSON.stringify(r.body), 400)}`);
    const { job } = await tungguJob(r.body.jobId, { batasMs: 240000 });
    assert(job.jenis === "backup-github", `jenis = ${job.jenis}`);
    assert(job.galat === null, `galat = ${job.galat}`);
    assert(job.persen === 100, `persen = ${job.persen}`);

    const hasil = job.hasil;
    assert(typeof hasil.commit === "string" && /^[0-9a-f]{7,40}$/i.test(hasil.commit), `hasil.commit = ${hasil && hasil.commit}`);
    assert(hasil.cabang === "main", `hasil.cabang = ${hasil.cabang}`);
    assert(typeof hasil.remote === "string" && hasil.remote.startsWith("file://"), `hasil.remote = ${hasil.remote}`);
    assert(typeof hasil.url === "string" && hasil.url.length > 0, `hasil.url = ${hasil.url}`);
    assert(hasil.adaPerubahan === true, `hasil.adaPerubahan = ${hasil.adaPerubahan}`);

    const rev = gitBare(["rev-parse", "--verify", "refs/heads/main"]);
    assert(rev.ok, `cabang main tidak ada di bare repo: ${rev.err}`);
    const subjek = gitBare(["log", "-1", "--pretty=format:%s", "main"]);
    assert(subjek.ok && subjek.out.includes("Backup uji dari uji-backup"), `subjek commit di remote = ${subjek.out}`);
    const hashBare = gitBare(["rev-parse", "main"]).out;
    const hashLokal = gitQ(["rev-parse", "HEAD"], { cwd: PROYEK }).out;
    assert(hashBare === hashLokal, `commit bare repo (${hashBare}) != HEAD project (${hashLokal})`);
  });

  await cek("Commit GitHub berisi data/terbaru.json & data/riwayat yang isinya sama", async () => {
    const tampil = gitBare(["show", "main:data/terbaru.json"]);
    assert(tampil.ok, `git show main:data/terbaru.json gagal: ${tampil.err}`);
    assertSama(JSON.parse(tampil.out), DATA, "isi data/terbaru.json di commit tidak sama");
    const riwayat = gitBare(["ls-tree", "--name-only", "main:data/riwayat"]);
    assert(riwayat.ok, `data/riwayat tidak ada di commit: ${riwayat.err}`);
    assert(
      riwayat.out.split(/\r?\n/).some((n) => /^data-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/.test(n.trim())),
      `berkas riwayat tidak ditemukan: ${potong(riwayat.out, 300)}`
    );
  });

  await cek("GET /api/github/log menampilkan commit dengan dataTersedia=true", async () => {
    const r = await httpJson("GET", "/api/github/log");
    assert(r.status === 200 && r.body.ok === true, `status ${r.status} ${potong(JSON.stringify(r.body), 300)}`);
    assert(r.body.repo === true, "repo harus true");
    assert(r.body.cabang === "main", `cabang = ${r.body.cabang}`);
    assert(Array.isArray(r.body.commits) && r.body.commits.length >= 1, `commits = ${r.body.commits && r.body.commits.length}`);
    const c = r.body.commits[0];
    assert(typeof c.hash === "string" && c.hash.length >= 7, `hash = ${c.hash}`);
    assert(typeof c.singkat === "string" && c.singkat.length >= 4, `singkat = ${c.singkat}`);
    assert(!Number.isNaN(Date.parse(c.tanggal)), `tanggal = ${c.tanggal}`);
    assert(typeof c.judul === "string" && c.judul.length > 0, `judul = ${c.judul}`);
    assert(c.dataTersedia === true, `dataTersedia commit terbaru = ${c.dataTersedia}`);
    assert(r.body.peringatan == null, `fetch seharusnya sukses, peringatan = ${r.body.peringatan}`);
  });

  await cek("Restore data GitHub mengembalikan isi data yang sama", async () => {
    const r = await mulaiRestore({ sumber: "github", bagian: "data" });
    assert(r.status === 200 && r.body && r.body.ok === true, `status ${r.status} ${potong(JSON.stringify(r.body), 300)}`);
    const { job } = await tungguJob(r.body.jobId, { batasMs: 240000 });
    assert(job.jenis === "restore-github", `jenis = ${job.jenis}`);
    assert(job.galat === null, `galat = ${job.galat}`);
    assert(job.hasil && typeof job.hasil.commit === "string" && job.hasil.commit.length >= 7, "hasil.commit kosong");
    assertSama(job.hasil.data, DATA, "data hasil restore GitHub tidak sama");
  });

  await cek("Restore project GitHub mengembalikan berkas ke versi commit", async () => {
    const berkasApp = path.join(PROYEK, "app.js");
    const asli = fs.readFileSync(berkasApp, "utf8");
    fs.writeFileSync(berkasApp, `${asli}\n// DIUBAH UJI GITHUB\n`, "utf8");
    assert(fs.readFileSync(berkasApp, "utf8").includes("DIUBAH UJI GITHUB"), "gagal mengubah berkas uji");

    const r = await mulaiRestore({ sumber: "github", bagian: "project" });
    assert(r.status === 200 && r.body && r.body.ok === true, `status ${r.status} ${potong(JSON.stringify(r.body), 300)}`);
    const { job } = await tungguJob(r.body.jobId, { batasMs: 240000 });
    assert(job.galat === null, `galat = ${job.galat}`);
    const sesudah = fs.readFileSync(berkasApp, "utf8");
    assert(!sesudah.includes("DIUBAH UJI GITHUB"), "app.js tidak kembali ke versi commit");
    assert(typeof job.hasil.cadangan === "string" && fs.existsSync(job.hasil.cadangan), `cadangan tidak ada: ${job.hasil.cadangan}`);
    const cadanganApp = path.join(job.hasil.cadangan, "project", "app.js");
    assert(fs.existsSync(cadanganApp), `cadangan ${cadanganApp} tidak ada`);
    assert(fs.readFileSync(cadanganApp, "utf8").includes("DIUBAH UJI GITHUB"), "cadangan tidak memuat versi sebelum restore");
  });

  /* ------------------------------------------------------------ validasi   */

  await cek("GET /api/job/<tidak-ada> mengembalikan 404", async () => {
    const r = await httpJson("GET", "/api/job/job-tidak-ada-123456");
    assert(r.status === 404, `status = ${r.status}`);
    assert(r.body && r.body.ok === false, `body = ${potong(JSON.stringify(r.body), 200)}`);
    assert(typeof r.body.galat === "string", "galat harus ada");
  });

  await cek("Backup GitHub tanpa perubahan (data null) tetap sukses & adaPerubahan=false", async () => {
    const r = await mulaiBackup({ sumber: "github", project: true, data: null });
    assert(r.status === 200 && r.body && r.body.ok === true, `status ${r.status} ${potong(JSON.stringify(r.body), 300)}`);
    const { job } = await tungguJob(r.body.jobId, { batasMs: 240000 });
    assert(job.galat === null, `galat = ${job.galat}`);
    assert(job.persen === 100, `persen = ${job.persen}`);
    assert(job.hasil.adaPerubahan === false, `adaPerubahan = ${job.hasil.adaPerubahan}, harusnya false`);
    assert(typeof job.hasil.commit === "string" && job.hasil.commit.length >= 7, "hasil.commit kosong");
    const log = job.log.map((e) => e.pesan).join(" | ");
    assert(/Tidak ada perubahan untuk di-commit/i.test(log), `log tidak menyebut tidak ada perubahan: ${potong(log, 500)}`);
  });

  await cek("POST /api/backup sumber keduanya menjalankan lokal + GitHub (progres benar)", async () => {
    await tungguDetikBaru();
    const r = await mulaiBackup({ sumber: "keduanya", project: true, data: DATA });
    assert(r.status === 200 && r.body && r.body.ok === true, `status ${r.status} ${potong(JSON.stringify(r.body), 300)}`);
    const { job, contohPersen } = await tungguJob(r.body.jobId, { batasMs: 300000 });
    assert(job.galat === null, `galat = ${job.galat}`);
    assert(job.persen === 100, `persen = ${job.persen}`);
    assert(job.jenis === "backup-keduanya", `jenis = ${job.jenis}`);
    const hasil = job.hasil;
    assert(hasil && hasil.sumber === "keduanya", `hasil.sumber = ${hasil && hasil.sumber}`);
    assert(hasil.lokal && ID_SNAPSHOT.test(hasil.lokal.snapshot), `hasil.lokal.snapshot = ${hasil.lokal && hasil.lokal.snapshot}`);
    assert(hasil.github && /^[0-9a-f]{7,40}$/i.test(hasil.github.commit), `hasil.github.commit = ${hasil.github && hasil.github.commit}`);
    assert(hasil.snapshot === hasil.lokal.snapshot, "hasil.snapshot harus sama dengan hasil.lokal.snapshot");
    assert(hasil.commit === hasil.github.commit, "hasil.commit harus sama dengan hasil.github.commit");
    const contoh = [0, ...contohPersen];
    for (let i = 1; i < contoh.length; i += 1) {
      assert(contoh[i] >= contoh[i - 1], `persen job keduanya turun dari ${contoh[i - 1]} ke ${contoh[i]}`);
    }
  });

  await cek("POST /api/restore menolak snapshot path traversal (400)", async () => {
    for (const jahat of ["../evil", "..", "2026-01-01_00-00-00/../../x"]) {
      const r = await mulaiRestore({ sumber: "lokal", snapshot: jahat, bagian: "data" });
      assert(r.status === 400, `snapshot "${jahat}" status = ${r.status}, harusnya 400`);
      assert(r.body && r.body.ok === false, `snapshot "${jahat}" body = ${potong(JSON.stringify(r.body), 200)}`);
      assert(typeof r.body.galat === "string" && r.body.galat.length > 10, `snapshot "${jahat}" galat tidak jelas`);
    }
  });

  await cek("POST /api/restore menolak hash commit tidak valid (400)", async () => {
    for (const jahat of ["zzz", "abc; rm -rf /", "123"]) {
      const r = await mulaiRestore({ sumber: "github", commit: jahat, bagian: "data" });
      assert(r.status === 400, `commit "${jahat}" status = ${r.status}, harusnya 400`);
      assert(r.body && r.body.ok === false, `commit "${jahat}" body = ${potong(JSON.stringify(r.body), 200)}`);
    }
  });

  await cek("Preflight OPTIONS mengembalikan CORS * dan mengizinkan Content-Type", async () => {
    const r = await httpJson("OPTIONS", "/api/status");
    assert(r.status === 204 || r.status === 200, `status = ${r.status}`);
    assert(r.headers["access-control-allow-origin"] === "*", `allow-origin = ${r.headers["access-control-allow-origin"]}`);
    assert(
      String(r.headers["access-control-allow-headers"] || "").toLowerCase().includes("content-type"),
      `allow-headers = ${r.headers["access-control-allow-headers"]}`
    );
    assert(String(r.headers["access-control-allow-methods"] || "").includes("POST"), "allow-methods harus memuat POST");
  });

  await cek("GET /api/status akhir: jobAktif null, snapshot & git konsisten", async () => {
    const r = await httpJson("GET", "/api/status");
    assert(r.status === 200 && r.body.ok === true, `status ${r.status}`);
    assert(r.body.jobAktif === null, `jobAktif = ${r.body.jobAktif}`);
    assert(r.body.snapshots === 3, `snapshots = ${r.body.snapshots}, harusnya 3 (data saja, data+project, keduanya)`);
    assert(r.body.github.repo === true, "github.repo harus true");
    assert(r.body.github.kotor === false, `github.kotor = ${r.body.github.kotor}, harusnya false`);
    assert(r.body.github.cabang === "main", `github.cabang = ${r.body.github.cabang}`);
    assert(r.body.github.jumlahSnapshot === 3, `github.jumlahSnapshot = ${r.body.github.jumlahSnapshot}`);
    assert(typeof r.body.github.remote === "string" && r.body.github.remote.startsWith("file://"), `remote = ${r.body.github.remote}`);
    assert(
      typeof r.body.github.commit === "string" && /^[0-9a-f]{7,}\s+.+$/.test(r.body.github.commit),
      `format github.commit harus "<hash> <subjek>": ${r.body.github.commit}`
    );
  });
}

/* ========================================================================== *
 * Titik masuk
 * ========================================================================== */

process.on("exit", () => {
  try {
    if (serverAnak && serverAnak.exitCode === null) serverAnak.kill();
  } catch (e) {
    /* abaikan */
  }
});

try {
  await utama();
} catch (e) {
  jumlahGagal += 1;
  daftarGagal.push({ nama: "Persiapan / jalannya uji", pesan: e.message });
  console.error("");
  console.error("UJI BERHENTI KARENA GALAT:");
  console.error(e && e.stack ? e.stack : e);
  console.error("");
  console.error("Cuplikan log server:");
  console.error(cuplikanLog(4000));
} finally {
  await matikanServer();
}

const total = jumlahOk + jumlahGagal;
console.log("");
console.log("================================================================");
console.log(`RINGKASAN: ${jumlahOk} OK, ${jumlahGagal} GAGAL dari ${total} cek`);
if (jumlahGagal > 0) {
  console.log("");
  console.log("Daftar cek gagal:");
  for (const g of daftarGagal) console.log(` - ${g.nama}: ${potong(g.pesan, 500)}`);
  console.log("");
  console.log(`Folder temp (untuk diperiksa): ${TEMP}`);
  console.log(`Log server: ${LOG_SERVER}`);
} else {
  console.log("Semua cek lulus.");
  try {
    fs.rmSync(TEMP, { recursive: true, force: true });
  } catch (e) {
    /* abaikan kegagalan bersih-bersih temp */
  }
}
console.log("================================================================");

process.exitCode = jumlahGagal === 0 ? 0 : 1;
