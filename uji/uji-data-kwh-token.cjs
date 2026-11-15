/*
 * Uji data historis "DATA KWH TOKEN.xls" (Mei–September 2026).
 * Jalankan: node uji/uji-data-kwh-token.cjs
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const akar = path.resolve(__dirname, "..");
const ctx = { module: { exports: {} }, console, Intl, Date, Math, JSON, Number, String, Array, Object, RegExp, isFinite, isNaN };
ctx.window = ctx;
vm.createContext(ctx);
for (const berkas of ["core.js", "data-oktober-2026.js", "data-kwh-token.js"]) {
  vm.runInContext(fs.readFileSync(path.join(akar, berkas), "utf8"), ctx, { filename: berkas });
}
const Core = ctx.module.exports;

let gagal = 0;
function cek(nama, dapat, harap) {
  const sama = typeof harap === "number" ? Math.abs(Number(dapat) - harap) < 0.01 : dapat === harap;
  console.log((sama ? "OK   " : "GAGAL") + " " + nama + " => " + JSON.stringify(dapat) + (sama ? "" : " (harap " + JSON.stringify(harap) + ")"));
  if (!sama) gagal++;
}

// gabungkan seperti app.js
let state = Core.normalise(ctx.window.DATA_OKTOBER_2026);
const ada = new Set(state.catatan.map(r => r.tanggal));
let tambah = 0;
for (const r of ctx.window.DATA_KWH_TOKEN.catatan) {
  if (ada.has(r.tanggal)) continue;
  state.catatan.push(Object.assign({ id: "kwh-token-" + r.tanggal }, r));
  ada.add(r.tanggal);
  tambah++;
}
state = Core.normalise(state);
const h = Core.hitung(state, { sekarang: "2026-11-15" });

cek("catatan historis ditambahkan", tambah, 136);
cek("total catatan", h.catatan.length, 168);
cek("catatan pertama", h.catatan[0].tanggal, "2026-05-18");
cek("catatan terakhir", h.catatan[h.catatan.length - 1].tanggal, "2026-11-01");
cek("tidak ada anomali", h.catatan.filter(r => r.anomali).length, 0);

const bulan = {};
h.bulanan.forEach(b => { bulan[b.key] = b; });
cek("Mei 2026 kWh", bulan["2026-05"].kwh, 151);
cek("Mei 2026 token", bulan["2026-05"].masukKwh, 217.99);
cek("Juni 2026 kWh", bulan["2026-06"].kwh, 329.86);
cek("Juni 2026 token", bulan["2026-06"].masukKwh, 218);
cek("Juli 2026 kWh", bulan["2026-07"].kwh, 110.14);
cek("Agustus 2026 kWh", bulan["2026-08"].kwh, 171);
cek("September 2026 kWh", bulan["2026-09"].kwh, 164);
cek("Oktober 2026 kWh", bulan["2026-10"].kwh, 180);

const token = h.catatan.filter(r => r.masuk > 0 && r.tanggal < "2026-10-01");
cek("jumlah pengisian token historis", token.length, 7);
cek("total token historis", token.reduce((s, r) => s + r.masuk, 0), 762.99);
cek("ada token 108,99 (17 Mei)", token.some(r => Math.abs(r.masuk - 108.99) < 0.01 && r.tanggal === "2026-05-18"), true);

console.log(gagal === 0 ? "\nSEMUA UJI DATA HISTORIS LULUS" : "\n" + gagal + " UJI GAGAL");
process.exit(gagal === 0 ? 0 : 1);
