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
const hasil = Core.hitung({ settings: data.settings, catatan: data.catatan });
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
cek("bulan aktif", hasil.bulanAktif, "2026-10");

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
