/* Uji logika core.js terhadap data Oktober 2026 yang sudah diverifikasi manual. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const akar = path.join(__dirname, "..");
const ctx = {
  module: { exports: {} },
  console,
  Intl,
  Date,
  Math,
  JSON,
  Number,
  String,
  Array,
  Object,
  RegExp,
  isFinite,
  isNaN
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(akar, "core.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(akar, "data-oktober-2026.js"), "utf8"), ctx);

const Core = ctx.module.exports;
const data = ctx.window.DATA_OKTOBER_2026;
// Tanggal "sekarang" dibuat tetap agar uji tidak berubah-ubah mengikuti jam komputer.
const hasil = Core.hitung({ settings: data.settings, catatan: data.catatan }, { sekarang: "2026-11-02" });
const r = hasil.ringkasan;

let gagal = 0;
function cek(nama, aktual, harap, toleransi) {
  let ok;
  if (typeof harap === "number" && typeof aktual === "number") {
    ok = Math.abs(aktual - harap) <= (toleransi === undefined ? 0.011 : toleransi);
  } else if (Array.isArray(harap)) {
    ok = JSON.stringify(aktual) === JSON.stringify(harap);
  } else {
    ok = aktual === harap;
  }
  console.log((ok ? "OK   " : "GAGAL") + " " + nama + " => " + JSON.stringify(aktual) + (ok ? "" : " (harap " + JSON.stringify(harap) + ")"));
  if (!ok) gagal++;
}

// --- angka kunci yang sudah dicocokkan dengan lembar catatan asli ---
cek("jumlah catatan", hasil.catatan.length, 32);
cek("jumlah hari terhitung", r.jumlahHari, 31);
cek("total kWh Oktober", r.totalKwh, 180);
cek("total biaya Oktober", r.totalRp, 330300);
cek("token masuk", r.totalMasukKwh, 109);
cek("rata-rata harian", r.rataHarian, 5.81, 0.02);
cek("median harian", r.medianHarian, 6);
cek("stdev", r.stdev, 3.59, 0.02);
cek("sisa akhir", r.sisaAkhir, 1215);
cek("saldo rupiah", r.saldoRp, 1215 * 1835);
cek("bulan aktif", hasil.bulanAktif, "2026-11");

// --- default bulan mengikuti bulan kalender saat ini ---
const ujiBulan = (tanggal) => Core.hitung({ settings: data.settings, catatan: data.catatan }, { sekarang: tanggal }).bulanAktif;
cek("bulan aktif 2 Nov 2026", ujiBulan("2026-11-02"), "2026-11");
cek("bulan aktif 31 Okt 2026", ujiBulan("2026-10-31"), "2026-10");
cek("bulan aktif 15 Sep 2026 (tak ada data)", ujiBulan("2026-09-15"), "2026-09");
cek("bulan aktif 5 Des 2026 (tak ada data)", ujiBulan("2026-12-05"), "2026-12");

// --- mingguan (Senin-Minggu) sesuai subtotal di sheet: 39, 47, 31, 46, 17 kWh ---
const kwhMinggu = hasil.mingguan.filter(m => m.key >= "2026-09-28" && m.key <= "2026-10-26").map(m => m.kwh);
cek("kWh mingguan", kwhMinggu, [39, 47, 31, 46, 17]);

// --- rata-rata per nama hari ---
const harapHari = { Senin: 3.0, Selasa: 7.5, Rabu: 5.5, Kamis: 6.6, Jumat: 6.4, Sabtu: 5.6, Minggu: 5.75 };
Object.keys(harapHari).forEach(n => cek("rata " + n, r.perHari[n].rata, harapHari[n], 0.02));

// --- hari nol & puncak ---
cek("hari nol", r.hariNol.map(x => x.tanggal), ["2026-10-12", "2026-10-24", "2026-10-31"]);
cek("pemakaian maksimum", r.maks.pemakaian, 13);
cek("tanggal maksimum", r.maks.tanggal, "2026-10-02");
cek("jumlah lonjakan", r.lonjakan.length, 5);

// --- ringkasan bulan Oktober ---
const okt = hasil.bulanan.find(b => b.key === "2026-10");
cek("bulan Oktober kWh", okt.kwh, 180);
cek("bulan Oktober biaya", okt.biaya, 330300);
cek("bulan Oktober sisa awal", okt.sisaAwal, 1286);
cek("bulan Oktober sisa akhir", okt.sisaAkhir, 1215);
cek("bulan Oktober token masuk", okt.masukKwh, 109);
cek("bulan Oktober hari", okt.hari, 31);

// --- konsistensi saldo: sisa awal + masuk - sisa akhir = total kWh ---
cek("konsistensi saldo", Core.bulat(okt.sisaAwal + okt.masukKwh - okt.sisaAkhir, 2), 180);

// --- analisa per bulan (untuk tampilan "terbaru + arsip") ---
cek("jumlah analisa bulanan", hasil.insightBulanan.length, hasil.bulanan.length);
const insOkt = hasil.insightBulanan.find(b => b.key === "2026-10");
const insNov = hasil.insightBulanan.find(b => b.key === "2026-11");
cek("analisa bulan Oktober ada", !!insOkt, true);
cek("analisa Oktober menyebut 180 kWh", /180/.test(insOkt.items.map(i => i.teks).join(" ")), true);
cek("analisa Oktober punya poin", insOkt.items.length >= 3, true);
cek("analisa bulan November ada", !!insNov, true);
cek("analisa November: belum ada pemakaian", /Belum ada pemakaian terhitung/.test(insNov.items[0].teks), true);

// --- proyeksi ---
cek("proyeksi 30 hari", r.proyeksi30Kwh, 174.2, 0.02);
cek("proyeksi 30 hari rupiah", r.proyeksi30Rp, 319645, 1);

// --- parser angka & CSV ---
cek("parseAngka 1.286,00", Core.parseAngka("1.286,00"), 1286);
cek("parseAngka 1.286", Core.parseAngka("1.286"), 1286);
cek("parseAngka 1286.5", Core.parseAngka("1286.5"), 1286.5);
cek("parseAngka 1.286.000", Core.parseAngka("1.286.000"), 1286000);
const csv = "tanggal,sisa,masuk,catatan\n2026-10-01,1286,0,awal\n2026-10-02,\"1.279,00\",0,\n";
const baris = Core.parseCsv(csv);
cek("parseCsv jumlah", baris.length, 2);
cek("parseCsv tanggal", baris[1].tanggal, "2026-10-02");
cek("parseCsv sisa", baris[1].sisa, 1279);
const bolakBalik = Core.parseCsv(Core.toCsv(data.catatan));
cek("CSV bolak-balik jumlah", bolakBalik.length, data.catatan.length);
cek("CSV bolak-balik sisa", bolakBalik[0].sisa, 1286);

/* =====================================================================
 * Uji urutan token (kasus laporan pengguna 9–11 November 2026):
 *  - 9 Nov  sisa 1.186
 *  - 10 Nov sisa 1.183  → pemakaian 10 Nov HARUS 1 kWh (bukan 110 kWh)
 *  - 11 Nov sisa 1.182, DIBACA DULU lalu beli token 109 kWh → meter 1.291
 *    Token itu milik interval 11 Nov → 12 Nov.
 * ===================================================================== */
const kasusTok = Core.hitung({
  settings: { hargaKwh: 1835 },
  catatan: [
    { tanggal: "2026-11-09", sisa: 1186, masuk: 0 },
    { tanggal: "2026-11-10", sisa: 1183, masuk: 0 },
    { tanggal: "2026-11-11", sisa: 1182, masuk: 109, catatan: "beli token setelah baca" }
  ]
}, { sekarang: "2026-11-11" });
const u9 = kasusTok.catatan.find(x => x.tanggal === "2026-11-09");
const u10 = kasusTok.catatan.find(x => x.tanggal === "2026-11-10");
const u11 = kasusTok.catatan.find(x => x.tanggal === "2026-11-11");
cek("token sesudah catat: pemakaian 9 Nov", u9.pemakaian, 3);
cek("token sesudah catat: pemakaian 10 Nov = 1 kWh", u10.pemakaian, 1);
cek("token sesudah catat: 11 Nov belum bisa dihitung", u11.pemakaian, null);
cek("token sesudah catat: token dianggap setelah pembacaan", u11.masukSebelum, false);
cek("token sesudah catat: sisa efektif = 1.182 + 109 = 1.291", kasusTok.ringkasan.sisaAkhir, 1291);
cek("token sesudah catat: saldo rupiah 1.291 kWh", kasusTok.ringkasan.saldoRp, Math.round(1291 * 1835));
cek("token sesudah catat: total kWh belum 110", kasusTok.ringkasan.totalKwh, 4);

// Bila besok (12 Nov) tercatat sisa 1.285 → pemakaian 11 Nov = 1.182 + 109 − 1.285 = 6 kWh
const kasusTok2 = Core.hitung({
  settings: { hargaKwh: 1835 },
  catatan: [
    { tanggal: "2026-11-09", sisa: 1186, masuk: 0 },
    { tanggal: "2026-11-10", sisa: 1183, masuk: 0 },
    { tanggal: "2026-11-11", sisa: 1182, masuk: 109 },
    { tanggal: "2026-11-12", sisa: 1285, masuk: 0 }
  ]
}, { sekarang: "2026-11-12" });
const v11 = kasusTok2.catatan.find(x => x.tanggal === "2026-11-11");
cek("lanjutan: pemakaian 11 Nov = 6 kWh", v11.pemakaian, 6);
cek("lanjutan: total kWh 3+1+6 = 10", kasusTok2.ringkasan.totalKwh, 10);

// Bila pengguna memilih "token SEBELUM dibaca" (angka sisa 1.291 setelah isi token):
const kasusTok3 = Core.hitung({
  settings: { hargaKwh: 1835 },
  catatan: [
    { tanggal: "2026-11-09", sisa: 1186, masuk: 0 },
    { tanggal: "2026-11-10", sisa: 1183, masuk: 0 },
    { tanggal: "2026-11-11", sisa: 1291, masuk: 109, urutanToken: "sebelum" },
    { tanggal: "2026-11-12", sisa: 1285, masuk: 0 }
  ]
}, { sekarang: "2026-11-12" });
cek("token sebelum catat: pemakaian 10 Nov = 1 kWh", kasusTok3.catatan.find(x => x.tanggal === "2026-11-10").pemakaian, 1);
cek("token sebelum catat: pemakaian 11 Nov = 6 kWh", kasusTok3.catatan.find(x => x.tanggal === "2026-11-11").pemakaian, 6);

// Token yang sudah masuk sebelum pembacaan terdeteksi otomatis dari saldo naik
const kasusNaik = Core.hitung({
  settings: { hargaKwh: 1835 },
  catatan: [
    { tanggal: "2026-10-11", sisa: 1205, masuk: 0 },
    { tanggal: "2026-10-12", sisa: 1309, masuk: 109 }
  ]
}, { sekarang: "2026-10-12" });
cek("auto: token sebelum (saldo naik) terdeteksi", kasusNaik.catatan.find(x => x.tanggal === "2026-10-12").masukSebelum, true);
cek("auto: pemakaian 11 Okt = 1.205+109-1.309 = 5", kasusNaik.catatan.find(x => x.tanggal === "2026-10-11").pemakaian, 5);

// CSV menyimpan urutan token
const csvToken = Core.toCsv([{ tanggal: "2026-11-11", sisa: 1182, masuk: 109, urutanToken: "sesudah", catatan: "" }]);
cek("CSV memuat urutan_token", /,sesudah/.test(csvToken), true);
cek("CSV parse urutan_token", Core.parseCsv(csvToken)[0].urutanToken, "sesudah");

// --- tanggal dobel: yang terakhir menang ---
const dobel = Core.normalise({ catatan: [
  { tanggal: "2026-10-01", sisa: 100 },
  { tanggal: "2026-10-01", sisa: 90 }
] });
cek("tanggal dobel jadi 1", dobel.catatan.length, 1);
cek("tanggal dobel nilai terakhir", dobel.catatan[0].sisa, 90);

// --- pemakaian negatif ditandai anomali, tidak dijumlahkan ---
const aneh = Core.normalise({ catatan: [
  { tanggal: "2026-10-01", sisa: 100 },
  { tanggal: "2026-10-02", sisa: 130 }
] });
const hasilAneh = Core.hitung(aneh);
cek("anomali negatif terdeteksi", hasilAneh.catatan[0].anomali, "negatif");
cek("anomali tidak dijumlah", hasilAneh.ringkasan.totalKwh, 0);

console.log(gagal === 0 ? "\nSEMUA UJI LULUS" : "\n" + gagal + " UJI GAGAL");
process.exit(gagal === 0 ? 0 : 1);
