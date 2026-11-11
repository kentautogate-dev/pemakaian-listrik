"use strict";

/*
 * server-backup.js
 * ----------------------------------------------------------------------------
 * Helper lokal untuk fitur "Backup" aplikasi Pemakaian Listrik Rumah.
 *
 * Tugas:
 *   - backup data aplikasi & folder project ke drive lokal (default L:\...)
 *   - backup data aplikasi & folder project ke repo GitHub (git)
 *   - restore data / project dari snapshot lokal maupun dari commit GitHub
 *   - menjalankan pekerjaan sebagai "job" dengan progres persen yang bisa
 *     dipantau UI lewat polling HTTP (GET /api/job/:id)
 *
 * Karakteristik:
 *   - Node.js murni (ES2022), tanpa dependensi npm, tanpa framework.
 *   - "use strict", hanya memakai modul inti: http, fs, path, os, child_process.
 *   - Bind HANYA ke 127.0.0.1 (tidak bisa diakses dari jaringan).
 *   - CORS "*" karena aplikasi dibuka dari file:// (Origin = "null").
 *   - Semua pesan galat & tahap job memakai bahasa Indonesia.
 *   - Penulisan hanya di dalam folder backup & folder project.
 *
 * Menjalankan:
 *   node server-backup.js
 *   Port & folder diambil dari backup-config.json (dibuat otomatis) dan bisa
 *   di-override untuk pengujian lewat env:
 *     BACKUP_PORT, BACKUP_FOLDER, BACKUP_REMOTE, BACKUP_PROJECT, BACKUP_CONFIG
 *   Opsional: GITHUB_TOKEN (hanya dipakai untuk perintah git push, tidak
 *   pernah disimpan ke config maupun ditulis ke log).
 *
 * API (semua JSON):
 *   GET  /api/status
 *   GET  /api/konfigurasi
 *   POST /api/konfigurasi   {folderBackup?, repoGithub?, cabang?}
 *   GET  /api/snapshots
 *   GET  /api/github/log
 *   POST /api/backup        {sumber:"lokal"|"github"|"keduanya", project:boolean,
 *                            data:object|null, pesan?:string} -> {ok, jobId}
 *   POST /api/restore       {sumber:"lokal"|"github", snapshot?:string,
 *                            commit?:string, bagian:"data"|"project"|"keduanya"}
 *   GET  /api/job/:id
 *
 * Kode balikan: 200 sukses, 400 validasi, 404 tidak ditemukan,
 * 409 ada job lain yang masih berjalan, 500 galat server.
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

/* ========================================================================== *
 * Konstanta
 * ========================================================================== */

const NAMA_APLIKASI = "pemakaian-listrik-backup";
const VERSI = 1;
const HOST = "127.0.0.1";
const PORT_BAWAAN = 8787;

const BATAS_JOBS = 20;          // simpan 20 job terakhir di memori
const BATAS_LOG = 400;          // maksimum baris log per job
const BATAS_BODY = 32 * 1024 * 1024; // 32 MB (data aplikasi tidak akan sebesar ini)

const PROJECT = path.resolve(process.env.BACKUP_PROJECT || __dirname);
const BERKAS_KONFIG = process.env.BACKUP_CONFIG
  ? path.resolve(process.env.BACKUP_CONFIG)
  : path.join(PROJECT, "backup-config.json");

const ID_SNAPSHOT = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;
const HASH_COMMIT = /^[0-9a-fA-F]{4,40}$/;

// Nama berkas/folder yang tidak ikut disalin saat backup project.
const NAMA_DIABAIKAN = new Set([".git", "backup-config.json", "solax-config.json", "node_modules", "__pycache__"]);
// Berkas yang tidak boleh ditimpa saat restore project.
const TIDAK_DITIMPA_RESTORE = new Set(["backup-config.json", "solax-config.json"]);

const KONFIG_BAWAAN = Object.freeze({
  folderBackup: "L:\\BACKUP_PEMAKAIAN_LISTRIK",
  repoGithub: "",
  cabang: "main",
  port: PORT_BAWAAN,
  versi: VERSI
});

/* ========================================================================== *
 * Galat khusus
 * ========================================================================== */

class GalatJob extends Error {
  constructor(pesan) {
    super(pesan);
    this.nama = "GalatJob";
  }
}

class GalatHttp extends Error {
  constructor(kode, pesan) {
    super(pesan);
    this.kode = kode;
  }
}

/* ========================================================================== *
 * Util umum
 * ========================================================================== */

function duaAngka(n) {
  return String(n).padStart(2, "0");
}

/** Stempel waktu lokal "YYYY-MM-DD_HH-MM-SS" (dipakai sebagai id snapshot). */
function stampLokal(d = new Date()) {
  return (
    `${d.getFullYear()}-${duaAngka(d.getMonth() + 1)}-${duaAngka(d.getDate())}` +
    `_${duaAngka(d.getHours())}-${duaAngka(d.getMinutes())}-${duaAngka(d.getSeconds())}`
  );
}

function isoWaktu(d = new Date()) {
  return d.toISOString();
}

function mb(dariByte) {
  return Math.round((Number(dariByte || 0) / (1024 * 1024)) * 100) / 100;
}

function tidur(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ubah id snapshot "YYYY-MM-DD_HH-MM-SS" (waktu lokal) menjadi string ISO. */
function waktuDariId(id) {
  const teks = String(id || "");
  if (!ID_SNAPSHOT.test(teks)) return null;
  const [tanggal, jam] = teks.split("_");
  const [tahun, bulan, hari] = tanggal.split("-").map(Number);
  const [jamLokal, menit, detik] = jam.split("-").map(Number);
  const d = new Date(tahun, bulan - 1, hari, jamLokal, menit, detik);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Apakah `anak` berada di dalam `induk` (path absolut, aman dari ".."). */
function diDalam(anak, induk) {
  let a = path.resolve(anak);
  let i = path.resolve(induk);
  if (process.platform === "win32") {
    a = a.toLowerCase();
    i = i.toLowerCase();
  }
  const dasar = i.endsWith(path.sep) ? i : i + path.sep;
  return a === i || a.startsWith(dasar);
}

/** Potong teks panjang untuk pesan galat/log. */
function ringkas(teks, maks = 300) {
  const t = saringToken(String(teks == null ? "" : teks).replace(/\s+/g, " ").trim());
  return t.length > maks ? `${t.slice(0, maks - 1)}...` : t;
}

/** Jangan pernah bocorkan token GitHub ke pesan/log. */
function saringToken(teks) {
  const token = String(process.env.GITHUB_TOKEN || "").trim();
  if (!token) return teks;
  return String(teks).split(token).join("***");
}

/** URL aman untuk ditampilkan (sembunyikan kredensial bila ada). */
function urlTampil(url) {
  const t = saringToken(String(url || "").trim());
  return t.replace(/^(https?:\/\/)[^/@]+@/i, "$1***@");
}

/** Ubah URL remote git menjadi URL yang bisa dibuka di browser. */
function urlRepo(remote) {
  const r = String(remote || "").trim();
  if (!r) return "";
  const ssh = /^git@([^:]+):(.+)$/.exec(r);
  if (ssh) return `https://${ssh[1]}/${ssh[2].replace(/\.git$/i, "")}`;
  if (/^https?:\/\//i.test(r)) return r.replace(/\.git$/i, "");
  if (/^file:\/\//i.test(r)) return decodeURIComponent(r.replace(/^file:\/\//i, ""));
  return r;
}

/** Kutip string untuk skrip PowerShell (single quote, escape dengan ''). */
function kutipPs(nilai) {
  return "'" + String(nilai).replace(/'/g, "''") + "'";
}

function jumlahCatatan(data) {
  if (!data || typeof data !== "object") return 0;
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data.catatan)) return data.catatan.length;
  return 0;
}

function bacaJsonAman(berkas) {
  try {
    let teks = fs.readFileSync(berkas, "utf8");
    if (teks.charCodeAt(0) === 0xfeff) teks = teks.slice(1); // buang BOM UTF-8
    const isi = JSON.parse(teks);
    if (isi && typeof isi === "object" && !Array.isArray(isi)) return isi;
    return null;
  } catch (e) {
    return null;
  }
}

/* ========================================================================== *
 * Menjalankan proses anak (git / PowerShell)
 *
 * Keluaran ditangkap lewat berkas sementara, bukan pipe stdio, supaya aman
 * dijalankan walau stdio pipe dibatasi, dan supaya tidak ada deadlock saat
 * keluarannya besar.
 * ========================================================================== */

let nomorProses = 0;

/**
 * Jalankan sebuah perintah tanpa shell.
 * @returns {Promise<{ok:boolean, kode:number|null, stdout:string, stderr:string, galat:Error|null}>}
 */
function jalankan(perintah, args, opsi = {}) {
  const cwd = opsi.cwd || PROJECT;
  const timeoutMs = opsi.timeoutMs || 60000;
  const envTambahan = opsi.env || {};

  return new Promise((resolve) => {
    const idp = `sb-${process.pid}-${Date.now()}-${++nomorProses}`;
    const berkasOut = path.join(os.tmpdir(), `${idp}.out`);
    const berkasErr = path.join(os.tmpdir(), `${idp}.err`);

    let fdOut = null;
    let fdErr = null;
    let anak = null;
    let sudahSelesai = false;
    let timerBatas = null;
    let habisWaktu = false;

    const tutupBerkas = () => {
      try { if (fdOut !== null) fs.closeSync(fdOut); } catch (e) { /* abaikan */ }
      try { if (fdErr !== null) fs.closeSync(fdErr); } catch (e) { /* abaikan */ }
      fdOut = null;
      fdErr = null;
    };

    const bacaDanHapus = () => {
      let out = "";
      let err = "";
      try { out = fs.readFileSync(berkasOut, "utf8"); } catch (e) { out = ""; }
      try { err = fs.readFileSync(berkasErr, "utf8"); } catch (e) { err = ""; }
      try { fs.unlinkSync(berkasOut); } catch (e) { /* abaikan */ }
      try { fs.unlinkSync(berkasErr); } catch (e) { /* abaikan */ }
      return { out, err };
    };

    const selesaikan = (kode, galat) => {
      if (sudahSelesai) return;
      sudahSelesai = true;
      if (timerBatas) clearTimeout(timerBatas);
      tutupBerkas();
      const { out, err } = bacaDanHapus();
      resolve({
        ok: kode === 0,
        kode: kode === null || kode === undefined ? -1 : kode,
        stdout: out,
        stderr: err,
        galat: galat || null
      });
    };

    try {
      fdOut = fs.openSync(berkasOut, "w");
      fdErr = fs.openSync(berkasErr, "w");
      anak = spawn(perintah, args, {
        cwd,
        windowsHide: true,
        stdio: ["ignore", fdOut, fdErr],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          ...envTambahan
        }
      });
    } catch (e) {
      selesaikan(-1, e);
      return;
    }

    timerBatas = setTimeout(() => {
      habisWaktu = true;
      try { anak.kill(); } catch (e) { /* abaikan */ }
      setTimeout(() => {
        try { anak.kill("SIGKILL"); } catch (e) { /* abaikan */ }
        selesaikan(-1, new Error(`Perintah ${perintah} melebihi batas waktu`));
      }, 1500);
    }, timeoutMs);

    anak.on("error", (e) => selesaikan(-1, e));
    anak.on("close", (kode) => {
      selesaikan(
        kode === null ? -1 : kode,
        habisWaktu
          ? new Error(`Perintah ${perintah} melebihi batas waktu ${Math.round(timeoutMs / 1000)} detik`)
          : null
      );
    });
  });
}

/* ========================================================================== *
 * Git helper
 * ========================================================================== */

let cacheGitAda = null;

async function gitAda() {
  if (cacheGitAda !== null) return cacheGitAda;
  const r = await jalankan("git", ["--version"], { timeoutMs: 20000 });
  cacheGitAda = r.ok;
  return cacheGitAda;
}

async function apakahRepoGit() {
  if (!fs.existsSync(path.join(PROJECT, ".git"))) return false;
  const r = await jalankan("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: PROJECT,
    timeoutMs: 30000
  });
  return r.ok && r.stdout.trim() === "true";
}

async function cabangAktifGit() {
  const r = await jalankan("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: PROJECT,
    timeoutMs: 30000
  });
  return r.ok ? r.stdout.trim() : "";
}

async function gitConfig(level, kunci) {
  const r = await jalankan("git", ["config", level, "--get", kunci], {
    cwd: PROJECT,
    timeoutMs: 30000
  });
  return r.ok ? r.stdout.trim() : "";
}

/** Pastikan identitas git lokal terisi (fallback identitas global atau bawaan). */
async function pastikanIdentitasGit() {
  const emailLokal = await gitConfig("--local", "user.email");
  const namaLokal = await gitConfig("--local", "user.name");
  if (!emailLokal) {
    const emailGlobal = await gitConfig("--global", "user.email");
    const email = emailGlobal || "backup@lokal";
    await jalankan("git", ["config", "--local", "user.email", email], { cwd: PROJECT, timeoutMs: 30000 });
  }
  if (!namaLokal) {
    const namaGlobal = await gitConfig("--global", "user.name");
    const nama = namaGlobal || "Backup Listrik";
    await jalankan("git", ["config", "--local", "user.name", nama], { cwd: PROJECT, timeoutMs: 30000 });
  }
}

/* ========================================================================== *
 * Konfigurasi
 * ========================================================================== */

function muatKonfigurasiBerkas() {
  const isi = bacaJsonAman(BERKAS_KONFIG);
  if (!isi) return { ...KONFIG_BAWAAN };
  return { ...KONFIG_BAWAAN, ...isi };
}

function pastikanBerkasKonfig() {
  if (fs.existsSync(BERKAS_KONFIG)) return;
  try {
    fs.mkdirSync(path.dirname(BERKAS_KONFIG), { recursive: true });
    fs.writeFileSync(BERKAS_KONFIG, `${JSON.stringify(KONFIG_BAWAAN, null, 2)}\n`, "utf8");
    console.log(`[konfigurasi] dibuat: ${BERKAS_KONFIG}`);
  } catch (e) {
    console.error(`[konfigurasi] gagal membuat ${BERKAS_KONFIG}: ${e.message}`);
  }
}

/** Konfigurasi efektif = isi berkas konfigurasi + override env (env menang). */
function konfigurasi() {
  const dariBerkas = muatKonfigurasiBerkas();
  const konf = { ...KONFIG_BAWAAN, ...dariBerkas };

  if (typeof konf.folderBackup !== "string" || !konf.folderBackup.trim()) {
    konf.folderBackup = KONFIG_BAWAAN.folderBackup;
  }
  if (typeof konf.repoGithub !== "string") konf.repoGithub = "";
  if (typeof konf.cabang !== "string" || !konf.cabang.trim()) konf.cabang = "main";

  const portBerkas = Number(konf.port);
  konf.port = Number.isInteger(portBerkas) && portBerkas > 0 && portBerkas < 65536 ? portBerkas : PORT_BAWAAN;
  konf.versi = VERSI;

  if (process.env.BACKUP_FOLDER) konf.folderBackup = process.env.BACKUP_FOLDER;
  if (process.env.BACKUP_REMOTE) konf.repoGithub = process.env.BACKUP_REMOTE;
  if (process.env.BACKUP_PORT) {
    const portEnv = Number(process.env.BACKUP_PORT);
    if (Number.isInteger(portEnv) && portEnv > 0 && portEnv < 65536) konf.port = portEnv;
  }
  return konf;
}

function simpanKonfigurasi(konf) {
  const isi = {
    folderBackup: konf.folderBackup,
    repoGithub: konf.repoGithub,
    cabang: konf.cabang,
    port: Number(konf.port) || PORT_BAWAAN,
    versi: VERSI
  };
  fs.mkdirSync(path.dirname(BERKAS_KONFIG), { recursive: true });
  fs.writeFileSync(BERKAS_KONFIG, `${JSON.stringify(isi, null, 2)}\n`, "utf8");
}

/* ========================================================================== *
 * SolaxCloud (PLTS) — konfigurasi & proxy data realtime
 * ========================================================================== */

const BERKAS_SOLAX = process.env.SOLAX_CONFIG
  ? path.resolve(process.env.SOLAX_CONFIG)
  : path.join(PROJECT, "solax-config.json");

const SOLAX_BAWAAN = Object.freeze({
  tokenId: "",
  wifiSn: "",
  url: "https://www.solaxcloud.com",
  ambangSoc: 20
});

function muatSolax() {
  const isi = bacaJsonAman(BERKAS_SOLAX);
  return { ...SOLAX_BAWAAN, ...(isi || {}) };
}

function simpanSolax(konf) {
  const isi = {
    tokenId: konf.tokenId,
    wifiSn: konf.wifiSn,
    url: konf.url,
    ambangSoc: konf.ambangSoc
  };
  fs.mkdirSync(path.dirname(BERKAS_SOLAX), { recursive: true });
  fs.writeFileSync(BERKAS_SOLAX, `${JSON.stringify(isi, null, 2)}\n`, "utf8");
}

function periksaSolax(body) {
  const tokenId = String(body.tokenId == null ? "" : body.tokenId).trim();
  const wifiSn = String(body.wifiSn == null ? "" : body.wifiSn).trim();
  const url = String(body.url == null ? "" : body.url).trim() || SOLAX_BAWAAN.url;
  const ambangSoc = Number(body.ambangSoc);
  if (!tokenId) return "TokenId SolaxCloud wajib diisi (menu Service → API di SolaxCloud).";
  if (tokenId.length > 300 || /\s/.test(tokenId)) return "TokenId tidak valid (tidak boleh mengandung spasi).";
  if (!wifiSn) return "WiFi SN / Registration Number inverter wajib diisi.";
  if (wifiSn.length > 100 || /\s/.test(wifiSn)) return "WiFi SN tidak valid (tanpa spasi).";
  if (!/^https?:\/\/[^\s/]+\/?$/i.test(url)) return "URL API harus diawali http:// atau https://";
  if (!isFinite(ambangSoc) || ambangSoc < 0 || ambangSoc > 100) return "Ambang SOC harus 0–100%.";
  return "";
}

function statusInverterTeks(kode) {
  const peta = {
    100: "Menunggu operasi", 101: "Self-test", 102: "Normal", 103: "Gangguan (recoverable)",
    104: "Gangguan permanen", 105: "Update firmware", 106: "Pemeriksaan EPS",
    107: "Mode EPS / OFF-GRID", 108: "Self-test (regulasi Italia)", 109: "Mode tidur",
    110: "Standby", 111: "Bangun dari baterai (PV wake-up)", 112: "Pemeriksaan genset",
    113: "Genset berjalan", 114: "RSD standby", 130: "Mode VPP", 131: "TOU — self use",
    132: "TOU — charging", 133: "TOU — discharging", 134: "TOU — baterai off",
    135: "TOU — peak shaving", 150: "Self use", 151: "Force time use", 152: "Back up mode",
    153: "Feed-in priority", 154: "Demand mode", 155: "Const power mode",
    160: "OpenADR mode", 170: "STOP mode", 171: "DEBUG mode"
  };
  return peta[kode] || ("Status kode " + kode);
}

function pesanGalatSolax(data) {
  const kode = Number(data && data.code);
  if (kode === 103) return "TokenId SolaxCloud tidak valid/kedaluwarsa. Salin ulang token dari menu Service → API.";
  if (kode === 10406) return "Batas frekuensi API SolaxCloud tercapai. Tunggu beberapa menit lalu coba lagi.";
  if (kode === 10500) return "Akun SolaxCloud tidak punya akses ke perangkat ini (periksa WiFi SN).";
  if (kode === 10001) return "SolaxCloud gagal memproses permintaan. Periksa WiFi SN dan coba lagi.";
  return "SolaxCloud menolak permintaan: " + ((data && (data.exception || data.message)) || ("kode " + kode));
}

function angkaAtauNull(nilai) {
  if (nilai === null || nilai === undefined || nilai === "") return null;
  const n = Number(nilai);
  return isFinite(n) ? n : null;
}

function petaSolaxRealtime(r, konf) {
  const pv = ["powerdc1", "powerdc2", "powerdc3", "powerdc4"]
    .reduce((s, k) => s + (angkaAtauNull(r[k]) || 0), 0);
  const soc = angkaAtauNull(r.soc);
  const batPower = angkaAtauNull(r.batPower);
  const feedin = angkaAtauNull(r.feedinpower);
  const statusKode = r.inverterStatus !== undefined && r.inverterStatus !== null ? Number(r.inverterStatus) : null;
  const ambang = Number(konf.ambangSoc) || 20;
  const offGrid = statusKode === 107;
  const socRendah = soc !== null && soc <= ambang;
  const pltsProduksi = pv > 50;

  let statusTeks = "PLTS normal";
  let peringatan = "";
  if (offGrid) {
    statusTeks = "Mode EPS / OFF-GRID (grid PLN mati)";
    peringatan = "Inverter sedang mode EPS (off-grid). Beban dilayani dari baterai/PV.";
  } else if (socRendah && !pltsProduksi) {
    statusTeks = "Baterai lemah & PLTS tidak produksi";
    peringatan = "SOC baterai " + soc + "% dan PV " + Math.round(pv) + " W. Kemungkinan besar beban rumah dari PLN.";
  } else if (!pltsProduksi) {
    statusTeks = "PLTS tidak produksi (malam/hujan)";
    peringatan = "PV ≈ 0 W. Beban bisa dari baterai atau PLN.";
  } else if (socRendah) {
    statusTeks = "Produksi PLTS rendah, baterai lemah";
    peringatan = "SOC " + soc + "% (di bawah ambang " + ambang + "%).";
  }

  return {
    ambilWaktu: isoWaktu(),
    wifiSn: konf.wifiSn,
    inverterSN: r.inverterSN || "",
    acpowerW: angkaAtauNull(r.acpower),
    pvW: Math.round(pv),
    batPowerW: batPower,
    socPct: soc,
    feedinpowerW: feedin,
    feedinEnergyKwh: angkaAtauNull(r.feedinenergy),
    consumeEnergyKwh: angkaAtauNull(r.consumeenergy),
    yieldTodayKwh: angkaAtauNull(r.yieldtoday),
    yieldTotalKwh: angkaAtauNull(r.yieldtotal),
    inverterStatusKode: statusKode,
    inverterStatusTeks: statusKode !== null ? statusInverterTeks(statusKode) : "",
    batStatus: r.batStatus !== null && r.batStatus !== undefined ? String(r.batStatus) : "",
    uploadTime: r.uploadTime || "",
    pltsProduksi: pltsProduksi,
    offGrid: offGrid,
    socRendah: socRendah,
    ambangSoc: ambang,
    statusTeks: statusTeks,
    peringatan: peringatan
  };
}

async function ambilSolaxRealtime() {
  const konf = muatSolax();
  const tokenId = String(konf.tokenId || "").trim();
  const wifiSn = String(konf.wifiSn || "").trim();
  if (!tokenId || !wifiSn) return { terkonfigurasi: false, konfigurasi: { wifiSn, url: konf.url, ambangSoc: konf.ambangSoc, tokenTerisi: false } };

  const alamat = String(konf.url || SOLAX_BAWAAN.url).replace(/\/+$/, "") + "/api/v2/dataAccess/realtimeInfo/get";
  let resp;
  try {
    resp = await fetch(alamat, {
      method: "POST",
      headers: { "Content-Type": "application/json", tokenId },
      body: JSON.stringify({ wifiSn }),
      signal: AbortSignal.timeout(20000)
    });
  } catch (e) {
    throw new GalatHttp(502, "Tidak bisa menghubungi SolaxCloud: " + (e && e.message ? e.message : "jaringan bermasalah"));
  }
  const teks = await resp.text();
  let data = null;
  try { data = JSON.parse(teks); } catch (e) { data = null; }
  if (!data) throw new GalatHttp(502, "Jawaban SolaxCloud tidak valid (bukan JSON).");
  if (!data.success) throw new GalatHttp(502, pesanGalatSolax(data));

  const hasil = petaSolaxRealtime(data.result || {}, konf);
  return { terkonfigurasi: true, data: hasil, konfigurasi: { wifiSn, url: konf.url, ambangSoc: konf.ambangSoc, tokenTerisi: true } };
}

async function apiSolaxStatus() {
  const hasil = await ambilSolaxRealtime();
  return { ok: true, ...hasil };
}

async function postSolaxKonfigurasi(req) {
  const body = await bacaBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GalatHttp(400, "Body harus berupa objek JSON.");
  }
  const lama = muatSolax();
  const tokenId = String(body.tokenId == null ? "" : body.tokenId).trim() || String(lama.tokenId || "").trim();
  const wifiSn = String(body.wifiSn == null ? "" : body.wifiSn).trim() || String(lama.wifiSn || "").trim();
  const url = (String(body.url == null ? "" : body.url).trim() || lama.url || SOLAX_BAWAAN.url).replace(/\/+$/, "");
  const ambangSoc = Number(body.ambangSoc);

  const salah = periksaSolax({ tokenId, wifiSn, url, ambangSoc });
  if (salah) throw new GalatHttp(400, salah);

  simpanSolax({ tokenId, wifiSn, url, ambangSoc });
  return {
    ok: true,
    terkonfigurasi: true,
    konfigurasi: { wifiSn, url, ambangSoc, tokenTerisi: true }
  };
}

/* ========================================================================== *
 * Validasi konfigurasi (pesan galat bahasa Indonesia, "" = valid)
 * ========================================================================== */

function periksaFolderBackup(nilai) {
  const t = String(nilai == null ? "" : nilai).trim();
  if (!t) return "Folder backup wajib diisi (contoh: L:\\BACKUP_PEMAKAIAN_LISTRIK).";
  if (!/^[A-Za-z]:[\\/]/.test(t)) {
    return "Folder backup harus berupa path absolut berhuruf drive, contoh: L:\\BACKUP_PEMAKAIAN_LISTRIK.";
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(t)) return "Folder backup tidak boleh mengandung '..'.";
  if (t.length > 240) return "Folder backup terlalu panjang.";
  return "";
}

function periksaRepoGithub(nilai) {
  const t = String(nilai == null ? "" : nilai).trim();
  if (!t) return ""; // boleh kosong (belum diatur)
  if (/\s/.test(t)) return "URL repo GitHub tidak boleh mengandung spasi.";
  if (/^https?:\/\/[^/\s]+\/.+/i.test(t)) return "";
  if (/^file:\/\/.+/i.test(t)) return "";
  if (/^ssh:\/\/.+/i.test(t)) return "";
  if (/^git@[A-Za-z0-9._-]+:[^\s]+$/.test(t)) return "";
  return (
    "URL repo GitHub tidak valid. Gunakan https://github.com/user/repo.git, " +
    "git@github.com:user/repo.git, atau file:///path/repo.git."
  );
}

function periksaCabang(nilai) {
  const t = String(nilai == null ? "" : nilai).trim();
  if (!t) return "Nama cabang wajib diisi (contoh: main).";
  if (t.length > 100) return "Nama cabang terlalu panjang.";
  if (t.startsWith("-") || t.startsWith(".") || t.includes("..")) return "Nama cabang tidak valid.";
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(t)) {
    return "Nama cabang hanya boleh berisi huruf, angka, titik, garis bawah, garis miring, dan strip.";
  }
  return "";
}

/* ========================================================================== *
 * Berkas: kumpulkan, salin, ukuran
 * ========================================================================== */

/**
 * Kumpulkan semua berkas di bawah `akar` (rekursif), melewati symlink.
 * @param {string} akar
 * @param {(rel:string, abs:string)=>boolean} [saring] true = lewati
 * @returns {Promise<string[]>} daftar path relatif terhadap `akar`
 */
async function kumpulkanBerkas(akar, saring) {
  const hasil = [];
  const lewati = typeof saring === "function" ? saring : () => false;

  async function jalan(dir) {
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(akar, abs);
      if (lewati(rel, abs)) continue;
      if (entry.isDirectory()) {
        await jalan(abs);
      } else if (entry.isFile()) {
        hasil.push(rel);
      }
    }
  }

  await jalan(akar);
  return hasil;
}

/** Saringan berkas project yang ikut di-backup/dicadangkan. */
function penyaringProject() {
  const akarBackup = path.resolve(konfigurasi().folderBackup);
  return (rel, abs) => {
    const bagian = String(rel).split(path.sep);
    for (const b of bagian) {
      if (NAMA_DIABAIKAN.has(b)) return true;
      if (b.startsWith(".")) return true; // .git, .backup, .vscode, dst.
    }
    // Jangan pernah menyalin folder backup itu sendiri bila berada di dalam project.
    if (diDalam(abs, akarBackup)) return true;
    return false;
  };
}

/**
 * Salin daftar berkas relatif dari `sumber` ke `tujuan`, melaporkan progres.
 * @returns {Promise<number>} jumlah berkas yang disalin
 */
async function salinDaftar(sumber, tujuan, daftar, opsi = {}) {
  const mulai = typeof opsi.mulai === "number" ? opsi.mulai : 0;
  const selesai = typeof opsi.selesai === "number" ? opsi.selesai : 100;
  const label = opsi.label || "Menyalin";
  const lapor = typeof opsi.lapor === "function" ? opsi.lapor : () => {};
  const total = daftar.length;
  const setiap = Math.max(1, Math.ceil(total / 20));

  let n = 0;
  for (const rel of daftar) {
    const asal = path.join(sumber, rel);
    const tuj = path.join(tujuan, rel);
    await fs.promises.mkdir(path.dirname(tuj), { recursive: true });
    await fs.promises.copyFile(asal, tuj);
    n += 1;
    const p = total > 0 ? mulai + (n / total) * (selesai - mulai) : selesai;
    const pesan = n === 1 || n === total || n % setiap === 0 ? `${label} ${n}/${total}: ${rel}` : null;
    lapor(p, null, pesan);
  }
  return n;
}

/** Jumlah byte seluruh berkas di bawah `akar`. */
async function hitungUkuran(akar) {
  let total = 0;

  async function jalan(dir) {
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await jalan(abs);
      } else if (entry.isFile()) {
        try {
          total += (await fs.promises.stat(abs)).size;
        } catch (e) {
          /* abaikan berkas yang tidak bisa dibaca */
        }
      }
    }
  }

  await jalan(akar);
  return total;
}

/** Sisa ruang bebas (MB) pada drive folder backup. 0 bila tidak diketahui. */
function bebasMB(akar) {
  const kandidat = [];
  try {
    if (fs.existsSync(akar)) kandidat.push(akar);
  } catch (e) { /* abaikan */ }
  const root = path.parse(path.resolve(akar)).root;
  if (root) kandidat.push(root);
  if (typeof fs.statfsSync !== "function") return 0;
  for (const target of kandidat) {
    try {
      const st = fs.statfsSync(target);
      return mb(Number(st.bavail) * Number(st.bsize));
    } catch (e) {
      /* coba kandidat berikutnya */
    }
  }
  return 0;
}

/* ========================================================================== *
 * Data aplikasi: tulis & baca
 * ========================================================================== */

async function tulisDataSnapshot(folderSnapshot, stamp, data) {
  const folderData = path.join(folderSnapshot, "data");
  await fs.promises.mkdir(folderData, { recursive: true });
  const teks = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(path.join(folderData, "terbaru.json"), teks, "utf8");
  await fs.promises.writeFile(path.join(folderData, `data-${stamp}.json`), teks, "utf8");
}

async function tulisDataProject(stamp, data) {
  const folderData = path.join(PROJECT, "data");
  const folderRiwayat = path.join(folderData, "riwayat");
  await fs.promises.mkdir(folderRiwayat, { recursive: true });
  const teks = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(path.join(folderData, "terbaru.json"), teks, "utf8");
  await fs.promises.writeFile(path.join(folderRiwayat, `data-${stamp}.json`), teks, "utf8");
}

async function bacaDataDariSnapshot(folderSnapshot) {
  const folderData = path.join(folderSnapshot, "data");
  let berkas = path.join(folderData, "terbaru.json");

  if (!fs.existsSync(berkas)) {
    let daftar = [];
    try {
      daftar = fs
        .readdirSync(folderData)
        .filter((n) => /^data-.+\.json$/i.test(n))
        .sort();
    } catch (e) {
      daftar = [];
    }
    if (!daftar.length) throw new GalatJob("Folder data tidak ditemukan di snapshot ini.");
    berkas = path.join(folderData, daftar[daftar.length - 1]);
  }

  let teks;
  try {
    teks = await fs.promises.readFile(berkas, "utf8");
  } catch (e) {
    throw new GalatJob(`Gagal membaca berkas data snapshot: ${e.message}`);
  }
  try {
    return JSON.parse(teks);
  } catch (e) {
    throw new GalatJob(`Berkas data snapshot bukan JSON yang valid (${path.basename(berkas)}).`);
  }
}

/* ========================================================================== *
 * PowerShell (untuk membuat proyek.zip)
 * ========================================================================== */

let cachePowerShell; // undefined = belum dicek, null = tidak ada, string = exe

async function cariPowerShell() {
  if (cachePowerShell !== undefined) return cachePowerShell;
  for (const exe of ["pwsh", "powershell"]) {
    const r = await jalankan(
      exe,
      ["-NoProfile", "-NonInteractive", "-Command", "Get-Command Compress-Archive -ErrorAction Stop | Out-Null"],
      { timeoutMs: 40000 }
    );
    if (r.ok) {
      cachePowerShell = exe;
      return exe;
    }
  }
  cachePowerShell = null;
  return null;
}

/* ========================================================================== *
 * Snapshot lokal
 * ========================================================================== */

async function hitungSnapshot(akar) {
  try {
    if (!fs.existsSync(akar)) return 0;
    const entries = await fs.promises.readdir(akar, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && ID_SNAPSHOT.test(e.name)).length;
  } catch (e) {
    return 0;
  }
}

async function infoSnapshot(folder, id) {
  const adaZip = fs.existsSync(path.join(folder, "proyek.zip"));
  const adaBundle = fs.existsSync(path.join(folder, "repo.bundle"));

  let adaData = false;
  try {
    const folderData = path.join(folder, "data");
    if (fs.existsSync(folderData) && fs.statSync(folderData).isDirectory()) {
      adaData = (await fs.promises.readdir(folderData)).length > 0;
    }
  } catch (e) {
    adaData = false;
  }

  let adaProject = false;
  try {
    const folderProject = path.join(folder, "project");
    adaProject = fs.existsSync(folderProject) && fs.statSync(folderProject).isDirectory();
  } catch (e) {
    adaProject = false;
  }

  const daftar = await kumpulkanBerkas(folder, () => false);
  const ukuran = await hitungUkuran(folder);

  return {
    id,
    waktu: waktuDariId(id),
    ukuranMB: mb(ukuran),
    adaData,
    adaProject,
    jumlahBerkas: daftar.length,
    adaZip,
    adaBundle
  };
}

async function apiSnapshots() {
  const konf = konfigurasi();
  const akar = path.resolve(konf.folderBackup);
  const daftar = [];

  if (fs.existsSync(akar)) {
    let entries = [];
    try {
      entries = await fs.promises.readdir(akar, { withFileTypes: true });
    } catch (e) {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !ID_SNAPSHOT.test(entry.name)) continue;
      daftar.push(await infoSnapshot(path.join(akar, entry.name), entry.name));
    }
  }

  daftar.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return { ok: true, folderBackup: akar, snapshots: daftar.slice(0, 50), total: daftar.length };
}

/* ========================================================================== *
 * Job & progres
 * ========================================================================== */

const jobs = new Map();
let jobAktif = null;

function pangkasJobs() {
  if (jobs.size <= BATAS_JOBS) return;
  for (const [id, job] of jobs) {
    if (jobs.size <= BATAS_JOBS) break;
    if (job.selesai) jobs.delete(id);
  }
}

function jagaLog(job) {
  if (job.log.length > BATAS_LOG) job.log.splice(0, job.log.length - BATAS_LOG);
}

/**
 * Buat pelapor progres yang:
 *  - memetakan persen fase (0..100) ke rentang [dari, sampai] job,
 *  - selalu monoton naik (tidak pernah turun),
 *  - tidak pernah menghasilkan 100 (100 hanya saat job sukses).
 */
function buatPelapor(job, dari = 0, sampai = 100) {
  return function lapor(persen, tahap, pesan) {
    const mentah = Math.max(0, Math.min(100, Number(persen) || 0));
    const dipetakan = Math.round(dari + (mentah * (sampai - dari)) / 100);
    const nilai = Math.min(99, Math.max(dipetakan, job.persen));
    job.persen = nilai;
    if (tahap) job.tahap = tahap;
    if (pesan) {
      job.log.push({ waktu: isoWaktu(), persen: nilai, pesan });
      jagaLog(job);
    }
  };
}

function buatJob(jenis) {
  const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id,
    jenis,
    persen: 0,
    tahap: "Menunggu",
    log: [{ waktu: isoWaktu(), persen: 0, pesan: "Job dibuat, menunggu dijalankan." }],
    selesai: false,
    galat: null,
    hasil: null,
    mulai: isoWaktu(),
    selesaiWaktu: null
  };
  jobs.set(id, job);
  jobAktif = id;
  pangkasJobs();
  return job;
}

function mulaiJob(job, kerja) {
  setImmediate(async () => {
    try {
      const hasil = await kerja();
      job.persen = 100;
      job.tahap = "Selesai";
      job.log.push({ waktu: isoWaktu(), persen: 100, pesan: "Selesai." });
      job.hasil = hasil;
      job.selesai = true;
      job.selesaiWaktu = isoWaktu();
    } catch (e) {
      job.galat = e instanceof GalatJob ? e.message : `Terjadi kesalahan tak terduga: ${saringToken(e.message || String(e))}`;
      job.tahap = "Gagal";
      job.log.push({ waktu: isoWaktu(), persen: job.persen, pesan: job.galat });
      job.selesai = true;
      job.selesaiWaktu = isoWaktu();
      if (!(e instanceof GalatJob)) console.error(`[job ${job.id}]`, e);
    } finally {
      jagaLog(job);
      if (jobAktif === job.id) jobAktif = null;
      pangkasJobs();
    }
  });
}

function jobPublik(job) {
  return {
    id: job.id,
    jenis: job.jenis,
    persen: job.persen,
    tahap: job.tahap,
    log: job.log.slice(),
    selesai: job.selesai,
    galat: job.galat,
    hasil: job.hasil,
    mulai: job.mulai,
    selesaiWaktu: job.selesaiWaktu
  };
}

/* ========================================================================== *
 * BACKUP LOKAL
 * ========================================================================== */

async function backupLokal(lapor, opsi = {}) {
  const data = opsi.data === undefined ? null : opsi.data;
  const project = Boolean(opsi.project);
  const konf = konfigurasi();
  const akar = path.resolve(konf.folderBackup);
  const stamp = stampLokal();

  /* 3%: validasi folder backup */
  lapor(3, "Memeriksa folder backup", `Memeriksa folder backup: ${akar}`);
  const akarDrive = path.parse(akar).root;
  if (!akarDrive || !fs.existsSync(akarDrive)) {
    throw new GalatJob(`Drive backup tidak ditemukan: ${akar}`);
  }
  try {
    fs.mkdirSync(akar, { recursive: true });
  } catch (e) {
    throw new GalatJob(`Folder backup tidak bisa dibuat: ${akar} (${e.message})`);
  }

  /* 6%: folder snapshot */
  lapor(6, "Membuat folder snapshot", `Membuat folder snapshot ${stamp}`);
  const folderSnapshot = path.resolve(akar, stamp);
  if (!diDalam(folderSnapshot, akar) || folderSnapshot === akar) {
    throw new GalatJob("Folder snapshot tidak valid.");
  }
  try {
    fs.mkdirSync(folderSnapshot, { recursive: true });
  } catch (e) {
    throw new GalatJob(`Gagal membuat folder snapshot: ${e.message}`);
  }

  /* 10%: tulis data */
  if (data) {
    lapor(10, "Menulis data", `Menulis data (${jumlahCatatan(data)} catatan) ke snapshot.`);
    try {
      await tulisDataSnapshot(folderSnapshot, stamp, data);
    } catch (e) {
      throw new GalatJob(`Gagal menulis data ke snapshot: ${e.message}`);
    }
  } else {
    lapor(10, "Menulis data", "Data tidak dikirim; snapshot dibuat tanpa data.");
  }

  /* 12-70%: salin berkas project */
  let jumlahBerkasProject = 0;
  let projectDisalin = false;
  if (project) {
    lapor(12, "Menyalin berkas project", "Menghitung berkas project yang akan disalin...");
    let daftar = [];
    try {
      daftar = await kumpulkanBerkas(PROJECT, penyaringProject());
    } catch (e) {
      throw new GalatJob(`Gagal membaca daftar berkas project: ${e.message}`);
    }
    const folderTujuan = path.join(folderSnapshot, "project");
    try {
      await fs.promises.mkdir(folderTujuan, { recursive: true });
    } catch (e) {
      throw new GalatJob(`Gagal membuat folder project di snapshot: ${e.message}`);
    }
    if (daftar.length === 0) {
      lapor(70, "Menyalin berkas project", "Tidak ada berkas project untuk disalin.");
    } else {
      try {
        jumlahBerkasProject = await salinDaftar(PROJECT, folderTujuan, daftar, {
          mulai: 12,
          selesai: 70,
          label: "Menyalin berkas project",
          lapor
        });
        projectDisalin = jumlahBerkasProject > 0;
      } catch (e) {
        throw new GalatJob(`Gagal menyalin berkas project: ${e.message}`);
      }
    }
  } else {
    lapor(12, "Menyalin berkas project", "Opsi project tidak aktif; berkas project dilewati.");
    lapor(70, "Menyalin berkas project", "Penyalinan project dilewati.");
  }

  /* 72%: info.txt */
  lapor(72, "Menulis info", "Menulis info.txt...");
  const ukuranSementara = await hitungUkuran(folderSnapshot);
  const isiInfo = [
    "=== Backup Pemakaian Listrik Rumah ===",
    `Waktu dibuat  : ${new Date().toLocaleString("id-ID")}`,
    `Snapshot      : ${stamp}`,
    "Sumber        : lokal",
    `Jumlah data   : ${jumlahCatatan(data)} catatan`,
    `Berkas proyek : ${jumlahBerkasProject}`,
    `Ukuran total  : ${mb(ukuranSementara)} MB`,
    `Folder        : ${folderSnapshot}`,
    ""
  ].join("\r\n");
  try {
    await fs.promises.writeFile(path.join(folderSnapshot, "info.txt"), isiInfo, "utf8");
  } catch (e) {
    lapor(72, "Menulis info", `Peringatan: gagal menulis info.txt (${e.message}).`);
  }

  /* 75-85%: git bundle (tidak fatal bila gagal) */
  let adaBundle = false;
  if (projectDisalin && (await apakahRepoGit())) {
    lapor(75, "Membuat repo bundle", "Membuat repo.bundle dari riwayat git project...");
    const berkasBundle = path.join(folderSnapshot, "repo.bundle");
    const r = await jalankan("git", ["bundle", "create", berkasBundle, "--all"], {
      cwd: PROJECT,
      timeoutMs: 180000
    });
    if (r.ok && fs.existsSync(berkasBundle)) {
      adaBundle = true;
      lapor(85, "Membuat repo bundle", "repo.bundle berhasil dibuat.");
    } else {
      lapor(85, "Membuat repo bundle", `Peringatan: repo.bundle dilewati (${ringkas(r.stderr) || "gagal membuat bundle"}).`);
    }
  } else {
    lapor(75, "Membuat repo bundle", projectDisalin ? "Bukan repositori git; repo.bundle dilewati." : "Project tidak disalin; repo.bundle dilewati.");
    lapor(85, "Membuat repo bundle", "Tahap repo.bundle selesai.");
  }

  /* 86-95%: proyek.zip (tidak fatal bila gagal) */
  let adaZip = false;
  if (projectDisalin) {
    lapor(86, "Membuat arsip zip", "Membuat arsip proyek.zip...");
    const exe = await cariPowerShell();
    const berkasZip = path.join(folderSnapshot, "proyek.zip");
    if (exe) {
      const sumberZip = path.join(folderSnapshot, "project") + path.sep + "*";
      const skrip =
        "$ProgressPreference='SilentlyContinue'; " +
        `Compress-Archive -Path ${kutipPs(sumberZip)} -DestinationPath ${kutipPs(berkasZip)} -Force -ErrorAction Stop`;
      const r = await jalankan(exe, ["-NoProfile", "-NonInteractive", "-Command", skrip], {
        cwd: folderSnapshot,
        timeoutMs: 240000
      });
      if (r.ok && fs.existsSync(berkasZip)) {
        adaZip = true;
        lapor(95, "Membuat arsip zip", "Arsip proyek.zip berhasil dibuat.");
      } else {
        lapor(95, "Membuat arsip zip", `Peringatan: proyek.zip dilewati (${ringkas(r.stderr || r.stdout) || "Compress-Archive gagal"}).`);
      }
    } else {
      lapor(95, "Membuat arsip zip", "Peringatan: PowerShell tidak tersedia; proyek.zip dilewati.");
    }
  } else {
    lapor(86, "Membuat arsip zip", "Tidak ada project; proyek.zip dilewati.");
    lapor(95, "Membuat arsip zip", "Tahap arsip selesai.");
  }

  const ukuranAkhir = await hitungUkuran(folderSnapshot);
  return {
    snapshot: stamp,
    folder: folderSnapshot,
    jumlahBerkas: jumlahBerkasProject,
    ukuranMB: mb(ukuranAkhir),
    adaZip,
    adaBundle,
    adaData: Boolean(data),
    jumlahData: jumlahCatatan(data)
  };
}

/* ========================================================================== *
 * BACKUP GITHUB
 * ========================================================================== */

/** Terjemahkan galat git/GitHub menjadi petunjuk yang bisa ditindaklanjuti. */
function petunjukGalatGithub(sebab) {
  const teks = String(sebab || "").toLowerCase();
  const buatRepo =
    " Periksa: (1) repo sudah dibuat di https://github.com/new (kosong, tanpa README), " +
    "(2) ejaan username di URL benar (format https://github.com/<username>/<nama-repo>.git), " +
    "(3) bila repo private, login dulu lewat login-github.cmd.";
  if (/repository not found|status code: 404/.test(teks)) {
    return "Repo GitHub tidak ditemukan atau tidak bisa diakses." + buatRepo;
  }
  if (/authentication failed|could not read username|terminal prompts disabled|permission denied|access denied|403/.test(teks)) {
    return "GitHub menolak login (belum terautentikasi). Jalankan login-github.cmd sekali, lalu coba lagi.";
  }
  if (/non-fast-forward|fetch first|rejected|could not push some refs/.test(teks)) {
    return "Repo GitHub berisi commit yang tidak ada di komputer ini (push ditolak). " +
      "Pulihkan dulu lewat Restore dari GitHub, atau buat repo baru yang kosong.";
  }
  if (/does not appear to be a git repository|could not read from remote repository|not a valid repository/.test(teks)) {
    return "URL repo tidak valid atau tidak bisa dibaca. Periksa kembali URL di Pengaturan backup.";
  }
  if (/could not resolve host|failed to connect|timed out|network is unreachable|ssl/.test(teks)) {
    return "Tidak bisa menghubungi GitHub (jaringan/DNS/SSL). Periksa koneksi internet lalu coba lagi.";
  }
  return "Jalankan login-github.cmd sekali untuk login Git Credential Manager, lalu coba lagi.";
}

async function backupGithub(lapor, opsi = {}) {
  const data = opsi.data === undefined ? null : opsi.data;
  const project = Boolean(opsi.project);
  const pesan = typeof opsi.pesan === "string" ? opsi.pesan.trim().slice(0, 200) : "";
  const konf = konfigurasi();
  const stamp = stampLokal();
  const remote = String(konf.repoGithub || "").trim();

  /* 5%: validasi konfigurasi */
  lapor(5, "Memeriksa konfigurasi GitHub", "Memeriksa URL repo GitHub...");
  if (!remote) throw new GalatJob("URL repo GitHub belum diisi (Pengaturan Backup).");
  if (!(await gitAda())) {
    throw new GalatJob("Git belum terpasang di komputer ini. Pasang Git lalu coba lagi.");
  }

  /* 10%: siapkan repositori */
  lapor(10, "Menyiapkan repositori", "Menyiapkan repositori git di folder project...");
  const repoAda = await apakahRepoGit();
  if (!repoAda) {
    const r = await jalankan("git", ["init"], { cwd: PROJECT, timeoutMs: 60000 });
    if (!r.ok) throw new GalatJob(`Gagal membuat repositori git: ${ringkas(r.stderr) || "git init gagal"}.`);
    lapor(10, "Menyiapkan repositori", "Repositori git baru dibuat.");
    const adaCabang = (
      await jalankan("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${konf.cabang}`], {
        cwd: PROJECT,
        timeoutMs: 30000
      })
    ).ok;
    if (!adaCabang) {
      const chk = await jalankan("git", ["checkout", "-b", konf.cabang], { cwd: PROJECT, timeoutMs: 60000 });
      if (!chk.ok) throw new GalatJob(`Gagal membuat cabang ${konf.cabang}: ${ringkas(chk.stderr)}`);
      lapor(10, "Menyiapkan repositori", `Cabang ${konf.cabang} dibuat.`);
    }
  } else {
    const aktif = await cabangAktifGit();
    const adaCabang = (
      await jalankan("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${konf.cabang}`], {
        cwd: PROJECT,
        timeoutMs: 30000
      })
    ).ok;
    if (!adaCabang) {
      const chk = await jalankan("git", ["checkout", "-b", konf.cabang], { cwd: PROJECT, timeoutMs: 60000 });
      if (!chk.ok) throw new GalatJob(`Gagal membuat cabang ${konf.cabang}: ${ringkas(chk.stderr)}`);
    } else if (aktif !== konf.cabang) {
      const chk = await jalankan("git", ["checkout", konf.cabang], { cwd: PROJECT, timeoutMs: 60000 });
      if (!chk.ok) {
        throw new GalatJob(
          `Tidak bisa berpindah ke cabang ${konf.cabang}. Simpan atau batalkan perubahan yang belum di-commit, lalu coba lagi.`
        );
      }
    }
  }

  await pastikanIdentitasGit();

  /* 20%: pastikan remote origin */
  lapor(20, "Mengatur remote GitHub", `Mengatur remote origin: ${urlTampil(remote)}`);
  const urlLama = await jalankan("git", ["remote", "get-url", "origin"], { cwd: PROJECT, timeoutMs: 30000 });
  const urlLamaTeks = urlLama.ok ? urlLama.stdout.trim() : "";
  if (!urlLamaTeks) {
    const r = await jalankan("git", ["remote", "add", "origin", remote], { cwd: PROJECT, timeoutMs: 30000 });
    if (!r.ok) throw new GalatJob(`Gagal menambahkan remote origin: ${ringkas(r.stderr)}`);
  } else if (urlLamaTeks !== remote) {
    const r = await jalankan("git", ["remote", "set-url", "origin", remote], { cwd: PROJECT, timeoutMs: 30000 });
    if (!r.ok) throw new GalatJob(`Gagal mengubah remote origin: ${ringkas(r.stderr)}`);
  }

  /* 25%: periksa akses ke repo sebelum menulis & commit (biar gagal cepat + pesan jelas) */
  lapor(25, "Memeriksa akses GitHub", `Memeriksa remote ${urlTampil(remote)}...`);
  const rPing = await jalankan("git", ["ls-remote", "--heads", "origin"], { cwd: PROJECT, timeoutMs: 45000 });
  if (!rPing.ok) {
    const sebabPing = ringkas(`${rPing.stderr} ${rPing.stdout}`) || "tidak bisa mengakses repo";
    throw new GalatJob(
      "Gagal mengakses repo GitHub: " + String(sebabPing).replace(/\.\s*$/, "") + ". " + petunjukGalatGithub(`${rPing.stderr} ${rPing.stdout}`)
    );
  }
  lapor(26, "Memeriksa akses GitHub", "Repo GitHub bisa diakses.");

  /* 27%: bila repo GitHub sudah punya commit (mis. README awal), selaraskan riwayat
     agar push tidak ditolak "non-fast-forward". */
  const remotePunyaCabang = new RegExp(
    `refs/heads/${String(konf.cabang).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    "m"
  ).test(rPing.stdout);
  if (remotePunyaCabang) {
    lapor(27, "Menyelaraskan riwayat", `Mengambil riwayat cabang ${konf.cabang} dari GitHub...`);
    const rFetch = await jalankan("git", ["fetch", "--quiet", "origin", konf.cabang], { cwd: PROJECT, timeoutMs: 120000 });
    if (!rFetch.ok) {
      throw new GalatJob(
        "Gagal mengambil riwayat repo GitHub: " + ringkas(rFetch.stderr || rFetch.stdout) + ". " +
        petunjukGalatGithub(`${rFetch.stderr} ${rFetch.stdout}`)
      );
    }
    const rHead = await jalankan("git", ["rev-parse", "--verify", "--quiet", "HEAD"], { cwd: PROJECT, timeoutMs: 30000 });
    let perluSelaras = false;
    if (rHead.ok) {
      const rBase = await jalankan("git", ["merge-base", "HEAD", "FETCH_HEAD"], { cwd: PROJECT, timeoutMs: 60000 });
      perluSelaras = !rBase.ok; // riwayat tidak berhubungan
    }
    if (perluSelaras) {
      const rReset = await jalankan("git", ["reset", "--soft", "FETCH_HEAD"], { cwd: PROJECT, timeoutMs: 60000 });
      if (!rReset.ok) {
        throw new GalatJob("Gagal menyelaraskan riwayat dengan repo GitHub: " + ringkas(rReset.stderr));
      }
      lapor(
        28,
        "Menyelaraskan riwayat",
        "Repo GitHub sudah berisi commit awal (mis. README). Riwayat lokal diselaraskan; backup akan menjadi commit baru di atasnya."
      );
    }
  }

  /* 30%: tulis data ke folder project */
  if (data) {
    lapor(30, "Menulis data", `Menulis data terbaru & riwayat (${jumlahCatatan(data)} catatan)...`);
    try {
      await tulisDataProject(stamp, data);
    } catch (e) {
      throw new GalatJob(`Gagal menulis berkas data di folder project: ${e.message}`);
    }
  } else {
    lapor(30, "Menulis data", "Data tidak dikirim; hanya perubahan project yang di-commit.");
  }

  /* 40%: git add */
  lapor(40, "Menambah berkas ke git", project ? "Menambahkan seluruh berkas project (git add -A)..." : "Menambahkan berkas data (git add -A -- data)...");
  const argsAdd = project ? ["add", "-A"] : ["add", "-A", "--", "data"];
  const rAdd = await jalankan("git", argsAdd, { cwd: PROJECT, timeoutMs: 120000 });
  if (!rAdd.ok) throw new GalatJob(`Gagal menambahkan berkas ke git: ${ringkas(rAdd.stderr)}`);

  /* 55%: commit */
  lapor(55, "Membuat commit", "Memeriksa perubahan lalu membuat commit...");
  const status = await jalankan("git", ["status", "--porcelain"], { cwd: PROJECT, timeoutMs: 60000 });
  if (!status.ok) throw new GalatJob(`Gagal membaca status git: ${ringkas(status.stderr)}`);
  let adaPerubahan = status.stdout.trim().length > 0;
  const pesanCommit = pesan || `Backup data listrik ${stamp}`;

  if (adaPerubahan) {
    const rc = await jalankan("git", ["commit", "-m", pesanCommit], { cwd: PROJECT, timeoutMs: 120000 });
    if (!rc.ok) {
      const gabungan = ringkas(`${rc.stdout} ${rc.stderr}`);
      if (/nothing to commit|no changes added/i.test(gabungan)) {
        adaPerubahan = false;
        lapor(55, "Membuat commit", "Tidak ada perubahan untuk di-commit.");
      } else {
        throw new GalatJob(`Gagal membuat commit: ${gabungan}`);
      }
    } else {
      lapor(55, "Membuat commit", `Commit dibuat: ${pesanCommit}`);
    }
  } else {
    lapor(55, "Membuat commit", "Tidak ada perubahan untuk di-commit.");
  }

  const adaHead = await jalankan("git", ["rev-parse", "--verify", "--quiet", "HEAD"], {
    cwd: PROJECT,
    timeoutMs: 30000
  });
  if (!adaHead.ok) {
    throw new GalatJob("Belum ada berkas yang bisa di-backup di folder project.");
  }

  /* 70-92%: push */
  lapor(70, "Mengunggah ke GitHub", `Mengunggah cabang ${konf.cabang} ke GitHub...`);
  const argsPush = [];
  const token = String(process.env.GITHUB_TOKEN || "").trim();
  if (token && /^https?:\/\/github\.com\//i.test(remote)) {
    // Token hanya untuk perintah push ini; tidak disimpan ke config/remote.
    argsPush.push("-c", `url.https://x-access-token:${token}@github.com/.insteadOf=https://github.com/`);
  }
  argsPush.push("push", "-u", "origin", konf.cabang);
  const rPush = await jalankan("git", argsPush, { cwd: PROJECT, timeoutMs: 180000 });
  if (!rPush.ok) {
    const sebab = ringkas(rPush.stderr || rPush.stdout) || "push gagal";
    throw new GalatJob("Gagal push ke GitHub: " + String(sebab).replace(/\.\s*$/, "") + ". " + petunjukGalatGithub(`${rPush.stderr} ${rPush.stdout}`));
  }
  lapor(92, "Mengunggah ke GitHub", "Push selesai.");

  /* 100% (diisi oleh job runner): hasil */
  const log = await jalankan("git", ["log", "-1", "--pretty=format:%h%x09%s"], {
    cwd: PROJECT,
    timeoutMs: 60000
  });
  const bagian = log.ok ? log.stdout.trim().split("\t") : [];
  const singkat = (bagian[0] || "").trim();
  const judul = (bagian.slice(1).join("\t") || "").trim();

  return {
    commit: singkat,
    judul,
    remote: urlTampil(remote),
    cabang: konf.cabang,
    url: urlRepo(remote),
    adaPerubahan,
    adaData: Boolean(data),
    jumlahData: jumlahCatatan(data)
  };
}

/* ========================================================================== *
 * RESTORE LOKAL
 * ========================================================================== */

async function pencadanganKeamananProject(lapor, mulai, selesai, label) {
  const konf = konfigurasi();
  const akar = path.resolve(konf.folderBackup);
  const stamp = stampLokal();
  const folderCadangan = path.join(akar, `${stamp}-sebelum-restore`);
  const folderCadanganProject = path.join(folderCadangan, "project");

  try {
    await fs.promises.mkdir(folderCadanganProject, { recursive: true });
    const daftar = await kumpulkanBerkas(PROJECT, penyaringProject());
    await salinDaftar(PROJECT, folderCadanganProject, daftar, {
      mulai,
      selesai,
      label: label || "Mencadangkan",
      lapor
    });
  } catch (e) {
    throw new GalatJob(`Gagal membuat cadangan keamanan project: ${e.message}`);
  }
  return folderCadangan;
}

async function restoreLokal(lapor, opsi = {}) {
  const bagian = opsi.bagian || "keduanya";
  const konf = konfigurasi();
  const akar = path.resolve(konf.folderBackup);
  const id = String(opsi.snapshot || "").trim();

  lapor(5, "Memeriksa snapshot", "Memeriksa snapshot yang dipilih...");
  if (!ID_SNAPSHOT.test(id)) {
    throw new GalatJob("Snapshot tidak valid. Format yang benar: YYYY-MM-DD_HH-MM-SS.");
  }
  if (!fs.existsSync(akar)) throw new GalatJob(`Folder backup tidak ditemukan: ${akar}`);
  const folderSnapshot = path.resolve(akar, id);
  if (folderSnapshot === akar || !diDalam(folderSnapshot, akar)) {
    throw new GalatJob("Snapshot tidak valid.");
  }
  if (!fs.existsSync(folderSnapshot) || !fs.statSync(folderSnapshot).isDirectory()) {
    throw new GalatJob(`Snapshot tidak ditemukan: ${id}`);
  }

  const hasil = { sumber: "lokal", snapshot: id, folder: folderSnapshot };

  if (bagian === "data" || bagian === "keduanya") {
    lapor(15, "Membaca data snapshot", "Membaca data dari snapshot...");
    hasil.data = await bacaDataDariSnapshot(folderSnapshot);
    lapor(40, "Membaca data snapshot", `Data dibaca (${jumlahCatatan(hasil.data)} catatan).`);
  }

  if (bagian === "project" || bagian === "keduanya") {
    const folderProjectSnapshot = path.join(folderSnapshot, "project");
    if (!fs.existsSync(folderProjectSnapshot) || !fs.statSync(folderProjectSnapshot).isDirectory()) {
      throw new GalatJob(`Snapshot ${id} tidak berisi folder project (backup data saja).`);
    }

    lapor(45, "Mencadangkan project saat ini", "Membuat cadangan keamanan project sebelum restore...");
    const cadangan = await pencadanganKeamananProject(lapor, 45, 65, "Mencadangkan");

    lapor(68, "Memulihkan berkas project", `Menyalin berkas project dari snapshot ${id}...`);
    let daftarSnapshot = [];
    try {
      daftarSnapshot = await kumpulkanBerkas(folderProjectSnapshot, () => false);
    } catch (e) {
      throw new GalatJob(`Gagal membaca berkas project di snapshot: ${e.message}`);
    }
    const daftarSiap = daftarSnapshot.filter((rel) => {
      const bagianRel = String(rel).split(path.sep);
      if (bagianRel.some((b) => b === ".git")) return false;
      if (bagianRel.length === 1 && TIDAK_DITIMPA_RESTORE.has(bagianRel[0])) return false;
      const tujuan = path.resolve(PROJECT, rel);
      if (!diDalam(tujuan, PROJECT)) return false; // pengaman path traversal
      return true;
    });

    let jumlah = 0;
    try {
      jumlah = await salinDaftar(folderProjectSnapshot, PROJECT, daftarSiap, {
        mulai: 68,
        selesai: 96,
        label: "Memulihkan",
        lapor
      });
    } catch (e) {
      throw new GalatJob(`Gagal memulihkan berkas project: ${e.message}`);
    }

    hasil.projectFiles = jumlah;
    hasil.cadangan = cadangan;
    lapor(96, "Memulihkan berkas project", `${jumlah} berkas project dipulihkan.`);
  }

  return hasil;
}

/* ========================================================================== *
 * RESTORE GITHUB
 * ========================================================================== */

async function restoreGithub(lapor, opsi = {}) {
  const bagian = opsi.bagian || "keduanya";
  const konf = konfigurasi();
  const targetCommit = String(opsi.commit || "").trim();
  const remote = String(konf.repoGithub || "").trim();

  lapor(5, "Memeriksa repositori", "Memeriksa repositori git project...");
  if (!(await gitAda())) {
    throw new GalatJob("Git belum terpasang di komputer ini. Pasang Git lalu coba lagi.");
  }
  if (!(await apakahRepoGit())) {
    throw new GalatJob("Folder project belum berupa repositori git. Lakukan backup GitHub dulu.");
  }
  if (!remote) throw new GalatJob("URL repo GitHub belum diisi (Pengaturan Backup).");
  if (targetCommit && !HASH_COMMIT.test(targetCommit)) {
    throw new GalatJob("Hash commit tidak valid. Gunakan hash dari daftar riwayat GitHub.");
  }

  /* fetch */
  lapor(10, "Mengambil data dari GitHub", `Mengambil data terbaru dari GitHub (cabang ${konf.cabang})...`);
  const fetch = await jalankan("git", ["fetch", "origin", konf.cabang], {
    cwd: PROJECT,
    timeoutMs: 120000
  });
  if (!fetch.ok) {
    const sebab = ringkas(fetch.stderr || fetch.stdout) || "fetch gagal";
    throw new GalatJob(
      `Gagal mengambil data dari GitHub: ${sebab} ` +
        "Jalankan `login-github.cmd` sekali untuk login Git Credential Manager, lalu coba lagi."
    );
  }

  const target = targetCommit || `origin/${konf.cabang}`;
  const cek = await jalankan("git", ["rev-parse", "--verify", "--quiet", `${target}^{commit}`], {
    cwd: PROJECT,
    timeoutMs: 60000
  });
  if (!cek.ok) throw new GalatJob(`Commit "${target}" tidak ditemukan di repositori.`);
  const hash = cek.stdout.trim();
  const hasil = { sumber: "github", commit: hash.slice(0, 7), hash, cabang: konf.cabang };

  /* data */
  if (bagian === "data" || bagian === "keduanya") {
    lapor(25, "Membaca data commit", `Membaca data/terbaru.json dari commit ${hash.slice(0, 7)}...`);
    const tampil = await jalankan("git", ["show", `${hash}:data/terbaru.json`], {
      cwd: PROJECT,
      timeoutMs: 60000
    });
    if (!tampil.ok) {
      throw new GalatJob(
        `Data tidak ditemukan di commit ${hash.slice(0, 7)}. Pastikan commit tersebut dibuat oleh fitur Backup.`
      );
    }
    try {
      hasil.data = JSON.parse(tampil.stdout);
    } catch (e) {
      throw new GalatJob("Berkas data/terbaru.json pada commit tersebut bukan JSON yang valid.");
    }
    lapor(48, "Membaca data commit", `Data dibaca (${jumlahCatatan(hasil.data)} catatan).`);
  }

  /* project */
  if (bagian === "project" || bagian === "keduanya") {
    lapor(55, "Mencadangkan project saat ini", "Membuat cadangan keamanan project sebelum restore...");
    const akar = path.resolve(konf.folderBackup);
    let cadangan = null;
    if (fs.existsSync(akar)) {
      try {
        fs.mkdirSync(akar, { recursive: true });
      } catch (e) {
        throw new GalatJob(`Folder backup tidak bisa dibuat: ${akar} (${e.message})`);
      }
      cadangan = await pencadanganKeamananProject(lapor, 55, 78, "Mencadangkan");
    } else {
      lapor(60, "Mencadangkan project saat ini", "Folder backup tidak tersedia; cadangan keamanan dilewati.");
    }

    lapor(82, "Memulihkan project", `Menjalankan git reset --hard ${hash.slice(0, 7)}...`);
    const reset = await jalankan("git", ["reset", "--hard", hash], { cwd: PROJECT, timeoutMs: 120000 });
    if (!reset.ok) throw new GalatJob(`Gagal memulihkan project dari commit: ${ringkas(reset.stderr)}`);

    const daftar = await kumpulkanBerkas(PROJECT, penyaringProject());
    hasil.projectFiles = daftar.length;
    hasil.cadangan = cadangan;
    lapor(96, "Memulihkan project", "Berkas project dipulihkan ke versi commit.");
  }

  return hasil;
}

/* ========================================================================== *
 * Status
 * ========================================================================== */

async function infoGithub(konf) {
  const info = {
    gitTersedia: await gitAda(),
    repo: false,
    remote: "",
    cabang: konf.cabang,
    cabangAktif: "",
    commit: "",
    commitSingkat: "",
    commitJudul: "",
    kotor: false,
    jumlahSnapshot: 0
  };

  info.repo = await apakahRepoGit();
  if (info.repo) {
    const rRemote = await jalankan("git", ["remote", "get-url", "origin"], { cwd: PROJECT, timeoutMs: 20000 });
    info.remote = rRemote.ok ? urlTampil(rRemote.stdout.trim()) : "";
    info.cabangAktif = await cabangAktifGit();

    const rLog = await jalankan("git", ["log", "-1", "--pretty=format:%h%x09%s"], {
      cwd: PROJECT,
      timeoutMs: 20000
    });
    if (rLog.ok && rLog.stdout.trim()) {
      const bagian = rLog.stdout.trim().split("\t");
      info.commitSingkat = (bagian[0] || "").trim();
      info.commitJudul = bagian.slice(1).join("\t").trim();
      info.commit = `${info.commitSingkat} ${info.commitJudul}`.trim();
    }

    const rStatus = await jalankan("git", ["status", "--porcelain"], { cwd: PROJECT, timeoutMs: 30000 });
    info.kotor = rStatus.ok ? rStatus.stdout.trim().length > 0 : false;
  }

  info.jumlahSnapshot = await hitungSnapshot(path.resolve(konf.folderBackup));
  return info;
}

async function muatStatus() {
  const konf = konfigurasi();
  const akar = path.resolve(konf.folderBackup);
  const daftarProject = await kumpulkanBerkas(PROJECT, penyaringProject());
  const github = await infoGithub(konf);

  return {
    ok: true,
    aplikasi: NAMA_APLIKASI,
    versi: VERSI,
    waktu: isoWaktu(),
    project: { folder: PROJECT, jumlahBerkas: daftarProject.length },
    folderBackup: { path: akar, ada: fs.existsSync(akar), bebasMB: bebasMB(akar) },
    github,
    snapshots: github.jumlahSnapshot,
    jobAktif
  };
}

/* ========================================================================== *
 * HTTP: util
 * ========================================================================== */

function setHeaderUmum(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
}

function kirim(res, kode, objek) {
  try {
    const teks = JSON.stringify(objek);
    res.statusCode = kode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(teks));
    res.end(teks);
  } catch (e) {
    try {
      res.statusCode = 500;
      res.end('{"ok":false,"galat":"Gagal mengirim respons."}');
    } catch (e2) {
      /* koneksi sudah putus, abaikan */
    }
  }
}

function bacaBody(req, batas = BATAS_BODY) {
  return new Promise((resolve, reject) => {
    const potongan = [];
    let ukuran = 0;
    let sudah = false;

    req.on("data", (c) => {
      if (sudah) return;
      ukuran += c.length;
      if (ukuran > batas) {
        sudah = true;
        reject(new GalatHttp(413, "Body permintaan terlalu besar."));
        try { req.destroy(); } catch (e) { /* abaikan */ }
        return;
      }
      potongan.push(c);
    });
    req.on("end", () => {
      if (sudah) return;
      sudah = true;
      const teks = Buffer.concat(potongan).toString("utf8").trim();
      if (!teks) return resolve(null);
      try {
        resolve(JSON.parse(teks));
      } catch (e) {
        reject(new GalatHttp(400, "Body JSON tidak valid."));
      }
    });
    req.on("error", (e) => {
      if (sudah) return;
      sudah = true;
      reject(e);
    });
  });
}

function keBoolean(nilai) {
  if (typeof nilai === "string") return nilai === "true" || nilai === "1" || nilai === "ya";
  return Boolean(nilai);
}

/* ========================================================================== *
 * HTTP: handler per endpoint
 * ========================================================================== */

/* ========================================================================== *
 * Cek URL repo GitHub (tanpa mengubah apa pun)
 * ========================================================================== */

function pisahRepoGithub(url) {
  const t = String(url || "").trim();
  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(t);
  if (ssh) return { owner: ssh[1], repo: ssh[2].replace(/\.git$/i, "") };
  const http = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(t);
  if (http) return { owner: http[1], repo: http[2].replace(/\.git$/i, "") };
  return null;
}

async function apiCekGithub(req) {
  const body = await bacaBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GalatHttp(400, "Body harus berupa objek JSON.");
  }
  const url = String(body.url || "").trim();
  if (!url) throw new GalatHttp(400, "URL repo belum diisi.");
  const salah = periksaRepoGithub(url);
  if (salah) throw new GalatHttp(400, salah);
  const bagian = pisahRepoGithub(url);
  if (!bagian) {
    throw new GalatHttp(400, "Hanya repo github.com yang bisa dicek otomatis. Remote file:///ssh lokal diuji lewat backup.");
  }

  const hasil = {
    ok: true,
    url: urlRepo(url),
    owner: bagian.owner,
    repo: bagian.repo,
    akunAda: null,
    repoPublikAda: null,
    akses: false,
    pesan: "",
    langkah: []
  };

  const r = await jalankan("git", ["ls-remote", "--heads", url], { timeoutMs: 30000 });
  hasil.akses = r.ok;
  const sebabGit = ringkas(`${r.stderr} ${r.stdout}`);

  const kodeApi = async (jalurApi) => {
    try {
      const resp = await fetch(`https://api.github.com${jalurApi}`, {
        headers: { "User-Agent": "pemakaian-listrik-backup", Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(15000)
      });
      return resp.status;
    } catch (e) {
      return 0;
    }
  };

  const kodeAkun = await kodeApi(`/users/${encodeURIComponent(bagian.owner)}`);
  hasil.akunAda = kodeAkun === 200;
  const kodeRepo = await kodeApi(`/repos/${encodeURIComponent(bagian.owner)}/${encodeURIComponent(bagian.repo)}`);
  hasil.repoPublikAda = kodeRepo === 200;

  if (hasil.akses) {
    hasil.pesan = "Repo bisa diakses dari komputer ini — siap untuk backup GitHub.";
    hasil.langkah = ["Pilih tujuan GitHub (atau Keduanya) lalu klik Mulai backup."];
  } else if (kodeAkun === 404) {
    hasil.pesan = `Username GitHub "${bagian.owner}" tidak ditemukan.`;
    hasil.langkah = [
      "Buka profil GitHub Anda dan salin username yang benar (username bukan email/nama tampilan).",
      "Betulkan URL di kolom atas, lalu klik Cek repo lagi.",
      `Format: https://github.com/<username>/${bagian.repo}.git`
    ];
  } else if (kodeRepo === 404) {
    hasil.pesan = "Repo tidak terlihat publik — kemungkinan belum dibuat, atau repo private.";
    hasil.langkah = [
      `Buka https://github.com/new lalu buat repo kosong bernama "${bagian.repo}" (tanpa README/.gitignore).`,
      "Bila repo sudah ada tetapi private: jalankan login-github.cmd sekali.",
      "Klik Cek repo lagi setelah itu."
    ];
  } else {
    hasil.pesan = "Repo terlihat publik tetapi git tidak bisa mengaksesnya: " + sebabGit;
    hasil.langkah = ["Periksa koneksi internet / proxy lalu coba lagi."];
  }
  return hasil;
}

async function postKonfigurasi(req) {
  const body = await bacaBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GalatHttp(400, "Body harus berupa objek JSON.");
  }
  pastikanBerkasKonfig();
  const baru = { ...KONFIG_BAWAAN, ...muatKonfigurasiBerkas() };

  if (Object.prototype.hasOwnProperty.call(body, "folderBackup")) {
    const pesan = periksaFolderBackup(body.folderBackup);
    if (pesan) throw new GalatHttp(400, pesan);
    baru.folderBackup = String(body.folderBackup).trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, "repoGithub")) {
    const pesan = periksaRepoGithub(body.repoGithub);
    if (pesan) throw new GalatHttp(400, pesan);
    baru.repoGithub = String(body.repoGithub == null ? "" : body.repoGithub).trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, "cabang")) {
    const pesan = periksaCabang(body.cabang);
    if (pesan) throw new GalatHttp(400, pesan);
    baru.cabang = String(body.cabang).trim();
  }
  baru.versi = VERSI;

  try {
    simpanKonfigurasi(baru);
  } catch (e) {
    throw new GalatHttp(500, `Gagal menyimpan konfigurasi: ${e.message}`);
  }
  return { ok: true, konfigurasi: konfigurasi() };
}

async function postBackup(req) {
  if (jobAktif) {
    throw new GalatHttp(409, `Masih ada proses yang berjalan (job ${jobAktif}). Tunggu sampai selesai.`);
  }
  const body = await bacaBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GalatHttp(400, "Body harus berupa objek JSON.");
  }
  const sumber = String(body.sumber || "").trim();
  if (!["lokal", "github", "keduanya"].includes(sumber)) {
    throw new GalatHttp(400, 'Sumber backup harus "lokal", "github", atau "keduanya".');
  }
  const project = keBoolean(body.project);
  const data = body.data === undefined ? null : body.data;
  if (data !== null && typeof data !== "object") {
    throw new GalatHttp(400, "Field data harus berupa objek JSON atau null.");
  }
  if (data === null && !project) {
    throw new GalatHttp(400, "Tidak ada yang di-backup: kirim data atau aktifkan opsi project.");
  }
  const pesan = typeof body.pesan === "string" ? body.pesan.trim().slice(0, 200) : "";

  // Cek ulang setelah body dibaca: dua permintaan yang hampir bersamaan tidak
  // boleh sama-sama membuat job.
  if (jobAktif) {
    throw new GalatHttp(409, `Masih ada proses yang berjalan (job ${jobAktif}). Tunggu sampai selesai.`);
  }

  const jenis =
    sumber === "lokal" ? "backup-lokal" : sumber === "github" ? "backup-github" : "backup-keduanya";
  const job = buatJob(jenis);

  mulaiJob(job, async () => {
    const hasil = {};
    if (sumber === "lokal" || sumber === "keduanya") {
      const laporLokal = buatPelapor(job, 0, sumber === "keduanya" ? 45 : 100);
      hasil.lokal = await backupLokal(laporLokal, { data, project });
    }
    if (sumber === "github" || sumber === "keduanya") {
      const laporGithub = buatPelapor(job, sumber === "keduanya" ? 45 : 0, 100);
      hasil.github = await backupGithub(laporGithub, { data, project, pesan });
    }
    if (sumber === "keduanya") {
      return {
        sumber,
        snapshot: hasil.lokal.snapshot,
        commit: hasil.github.commit,
        lokal: hasil.lokal,
        github: hasil.github
      };
    }
    if (sumber === "lokal") return { ...hasil.lokal, sumber: "lokal" };
    return { ...hasil.github, sumber: "github" };
  });

  return { ok: true, jobId: job.id };
}

async function postRestore(req) {
  if (jobAktif) {
    throw new GalatHttp(409, `Masih ada proses yang berjalan (job ${jobAktif}). Tunggu sampai selesai.`);
  }
  const body = await bacaBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GalatHttp(400, "Body harus berupa objek JSON.");
  }
  const sumber = String(body.sumber || "").trim();
  if (!["lokal", "github"].includes(sumber)) {
    throw new GalatHttp(400, 'Sumber restore harus "lokal" atau "github".');
  }
  const bagian = String(body.bagian || "keduanya").trim();
  if (!["data", "project", "keduanya"].includes(bagian)) {
    throw new GalatHttp(400, 'Bagian restore harus "data", "project", atau "keduanya".');
  }

  const snapshot = body.snapshot == null ? "" : String(body.snapshot).trim();
  const commit = body.commit == null ? "" : String(body.commit).trim();

  if (sumber === "lokal") {
    if (!snapshot) throw new GalatHttp(400, "Field snapshot wajib diisi untuk restore lokal.");
    if (!ID_SNAPSHOT.test(snapshot)) {
      throw new GalatHttp(400, "Snapshot tidak valid. Format yang benar: YYYY-MM-DD_HH-MM-SS.");
    }
    if (snapshot.includes("..") || snapshot.includes("/") || snapshot.includes("\\")) {
      throw new GalatHttp(400, "Snapshot tidak valid.");
    }
  } else if (commit && !HASH_COMMIT.test(commit)) {
    throw new GalatHttp(400, "Hash commit tidak valid. Gunakan hash dari daftar riwayat GitHub.");
  }

  const jenis = sumber === "lokal" ? "restore-lokal" : "restore-github";

  // Cek ulang setelah body dibaca agar dua permintaan bersamaan tidak
  // menghasilkan dua job sekaligus.
  if (jobAktif) {
    throw new GalatHttp(409, `Masih ada proses yang berjalan (job ${jobAktif}). Tunggu sampai selesai.`);
  }

  const job = buatJob(jenis);

  mulaiJob(job, async () => {
    if (sumber === "lokal") {
      return restoreLokal(buatPelapor(job, 0, 100), { snapshot, bagian });
    }
    return restoreGithub(buatPelapor(job, 0, 100), { commit, bagian });
  });

  return { ok: true, jobId: job.id };
}

async function getGithubLog() {
  const konf = konfigurasi();
  const hasil = {
    ok: true,
    repo: false,
    cabang: konf.cabang,
    remote: "",
    commits: [],
    peringatan: null
  };

  if (!(await apakahRepoGit())) {
    hasil.peringatan = "Folder project belum berupa repositori git. Lakukan backup GitHub dulu.";
    return hasil;
  }
  hasil.repo = true;

  const rRemote = await jalankan("git", ["remote", "get-url", "origin"], { cwd: PROJECT, timeoutMs: 20000 });
  hasil.remote = rRemote.ok ? urlTampil(rRemote.stdout.trim()) : "";

  if (hasil.remote) {
    const fetch = await jalankan("git", ["fetch", "origin", konf.cabang], {
      cwd: PROJECT,
      timeoutMs: 20000
    });
    if (!fetch.ok) {
      hasil.peringatan =
        `Gagal mengambil data terbaru dari GitHub: ${ringkas(fetch.stderr || fetch.stdout) || "fetch gagal"} ` +
        "(menampilkan riwayat lokal).";
    }
  } else {
    hasil.peringatan = "Remote GitHub belum diatur (Pengaturan Backup).";
  }

  const log = await jalankan("git", ["log", "--pretty=format:%H%x09%h%x09%aI%x09%s", "-n", "20"], {
    cwd: PROJECT,
    timeoutMs: 20000
  });
  if (!log.ok) {
    if (!hasil.peringatan) {
      hasil.peringatan = "Belum ada riwayat commit di repositori.";
    }
    return hasil;
  }

  for (const baris of log.stdout.split(/\r?\n/)) {
    if (!baris.trim()) continue;
    const bagian = baris.split("\t");
    const hash = (bagian[0] || "").trim();
    if (!hash) continue;
    const singkat = (bagian[1] || "").trim();
    const tanggal = (bagian[2] || "").trim();
    const judul = bagian.slice(3).join("\t").trim();
    const cekData = await jalankan("git", ["cat-file", "-e", `${hash}:data/terbaru.json`], {
      cwd: PROJECT,
      timeoutMs: 20000
    });
    hasil.commits.push({ hash, singkat, tanggal, judul, dataTersedia: cekData.ok });
  }

  if (!hasil.commits.length && !hasil.peringatan) {
    hasil.peringatan = "Belum ada riwayat commit di repositori.";
  }
  return hasil;
}

/* ========================================================================== *
 * HTTP: router
 * ========================================================================== */

const server = http.createServer((req, res) => {
  tangani(req, res).catch((e) => {
    try {
      const kode = e instanceof GalatHttp ? e.kode : 500;
      kirim(res, kode, {
        ok: false,
        galat: e instanceof GalatHttp ? e.message : `Terjadi kesalahan di server: ${saringToken(e.message || String(e))}`
      });
    } catch (e2) {
      /* respons sudah terkirim */
    }
  });
});

async function tangani(req, res) {
  const metode = String(req.method || "GET").toUpperCase();
  let jalur = "/";
  try {
    jalur = new URL(req.url || "/", `http://${HOST}`).pathname;
  } catch (e) {
    jalur = "/";
  }
  if (jalur.length > 1) jalur = jalur.replace(/\/+$/, "") || "/";

  setHeaderUmum(res);

  if (metode === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    if (metode === "GET" && (jalur === "/" || jalur === "/api")) {
      kirim(res, 200, {
        ok: true,
        aplikasi: NAMA_APLIKASI,
        versi: VERSI,
        waktu: isoWaktu(),
        petunjuk: "Server helper backup lokal. UI aplikasi memakai endpoint /api/*.",
        endpoints: [
          "GET /api/status",
          "GET /api/konfigurasi",
          "POST /api/konfigurasi",
          "GET /api/snapshots",
          "GET /api/github/log",
          "POST /api/cek-github",
          "GET /api/solax/status",
          "POST /api/solax/konfigurasi",
          "POST /api/backup",
          "POST /api/restore",
          "GET /api/job/:id"
        ]
      });
      return;
    }

    if (metode === "GET" && jalur === "/api/status") {
      kirim(res, 200, await muatStatus());
      return;
    }

    if (metode === "GET" && jalur === "/api/konfigurasi") {
      kirim(res, 200, { ok: true, konfigurasi: konfigurasi() });
      return;
    }

    if (metode === "POST" && jalur === "/api/konfigurasi") {
      kirim(res, 200, await postKonfigurasi(req));
      return;
    }

    if (metode === "GET" && jalur === "/api/snapshots") {
      kirim(res, 200, await apiSnapshots());
      return;
    }

    if (metode === "GET" && jalur === "/api/github/log") {
      kirim(res, 200, await getGithubLog());
      return;
    }

    if (metode === "POST" && jalur === "/api/cek-github") {
      kirim(res, 200, await apiCekGithub(req));
      return;
    }

    if (metode === "GET" && jalur === "/api/solax/status") {
      kirim(res, 200, await apiSolaxStatus());
      return;
    }

    if (metode === "POST" && jalur === "/api/solax/konfigurasi") {
      kirim(res, 200, await postSolaxKonfigurasi(req));
      return;
    }

    if (metode === "POST" && jalur === "/api/backup") {
      kirim(res, 200, await postBackup(req));
      return;
    }

    if (metode === "POST" && jalur === "/api/restore") {
      kirim(res, 200, await postRestore(req));
      return;
    }

    if (metode === "GET" && jalur.startsWith("/api/job/")) {
      const id = decodeURIComponent(jalur.slice("/api/job/".length));
      const job = jobs.get(id);
      if (!job) throw new GalatHttp(404, "Job tidak ditemukan.");
      kirim(res, 200, { ok: true, job: jobPublik(job) });
      return;
    }

    throw new GalatHttp(404, `Endpoint tidak ditemukan: ${metode} ${jalur}`);
  } catch (e) {
    const kode = e instanceof GalatHttp ? e.kode : 500;
    if (kode >= 500) console.error("[server] galat:", e);
    kirim(res, kode, {
      ok: false,
      galat: e instanceof GalatHttp ? e.message : `Terjadi kesalahan di server: ${saringToken(e.message || String(e))}`
    });
  }
}

/* ========================================================================== *
 * Mulai
 * ========================================================================== */

async function main() {
  pastikanBerkasKonfig();
  const konf = konfigurasi();
  const port = konf.port;

  server.on("error", (e) => {
    console.error(`Gagal menjalankan server backup: ${e.message}`);
    process.exit(1);
  });

  server.listen(port, HOST, () => {
    console.log(`[server] ${NAMA_APLIKASI} v${VERSI} siap di http://${HOST}:${port}`);
    console.log(`[server] project : ${PROJECT}`);
    console.log(`[server] backup  : ${path.resolve(konf.folderBackup)}`);
    console.log(`[server] konfig  : ${BERKAS_KONFIG}`);
  });

  for (const sinyal of ["SIGINT", "SIGTERM"]) {
    process.on(sinyal, () => {
      console.log(`[server] berhenti (${sinyal}).`);
      process.exit(0);
    });
  }
}

main().catch((e) => {
  console.error(`Gagal menjalankan server backup: ${e.message}`);
  process.exit(1);
});
