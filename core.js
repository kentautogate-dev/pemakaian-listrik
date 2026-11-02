/*
 * core.js — mesin perhitungan "Pemakaian kWh Listrik Rumah"
 * Tanpa dependensi, bisa dipakai di browser (window.KwhCore) maupun Node (module.exports).
 *
 * Model data:
 *   state = {
 *     v: 2,
 *     settings: { nama, hargaKwh, tarifDasar, ppj, jamCatat },
 *     catatan: [ { id, tanggal: "YYYY-MM-DD", sisa: <kWh sisa token>, masuk: <kWh token diisi>, catatan } ]
 *   }
 *
 * Aturan hitung (sama seperti catatan manual yang dipakai pemilik rumah):
 *   pemakaian(hari n) = sisa(hari n) + token_masuk_pada_pembacaan_berikutnya - sisa(pembacaan berikutnya)
 * Pemakaian diatribusikan ke hari pembacaan pertama (hari n).
 */
(function (root) {
  "use strict";

  var VERSI = 2;
  var HARGA_BAWAAN = 1835;

  var nf0 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  var nf2 = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  var NAMA_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  var NAMA_HARI_PENDEK = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  var NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni",
                    "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  var NAMA_BULAN_PENDEK = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
                           "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

  /* ---------------- util ---------------- */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function angka(n, desimal) {
    var d = desimal === undefined ? 1 : desimal;
    if (n === null || n === undefined || isNaN(n)) return "—";
    if (d === 0) return nf0.format(n);
    if (d === 2) return nf2.format(n);
    return nf1.format(n);
  }
  function rp(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return "Rp " + nf0.format(Math.round(n));
  }
  function kwh(n, desimal) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return angka(n, desimal === undefined ? 1 : desimal) + " kWh";
  }

  function parseTanggal(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (isNaN(d.getTime())) return null;
    return d;
  }
  function toISO(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function tanggalSekarang() { return toISO(new Date()); }
  function tambahHari(iso, n) {
    var d = parseTanggal(iso);
    if (!d) return iso;
    d.setDate(d.getDate() + n);
    return toISO(d);
  }
  function bedaHari(a, b) {
    var da = parseTanggal(a), db = parseTanggal(b);
    if (!da || !db) return 0;
    return Math.round((db - da) / 86400000);
  }
  function labelTanggal(iso, denganTahun) {
    var d = parseTanggal(iso);
    if (!d) return iso;
    return d.getDate() + " " + NAMA_BULAN_PENDEK[d.getMonth()] + (denganTahun === false ? "" : " " + d.getFullYear());
  }
  function namaHari(iso) {
    var d = parseTanggal(iso);
    return d ? NAMA_HARI[d.getDay()] : "";
  }
  function namaHariPendek(iso) {
    var d = parseTanggal(iso);
    return d ? NAMA_HARI_PENDEK[d.getDay()] : "";
  }
  function bulanKey(iso) { return String(iso || "").slice(0, 7); }
  function labelBulan(key) {
    var m = /^(\d{4})-(\d{2})$/.exec(key || "");
    if (!m) return key;
    return NAMA_BULAN[+m[2] - 1] + " " + m[1];
  }
  function labelBulanPendek(key) {
    var m = /^(\d{4})-(\d{2})$/.exec(key || "");
    if (!m) return key;
    return NAMA_BULAN_PENDEK[+m[2] - 1] + " " + m[1].slice(2);
  }
  function seninDari(iso) {
    var d = parseTanggal(iso);
    if (!d) return iso;
    var delta = (d.getDay() + 6) % 7; // Senin = 0
    d.setDate(d.getDate() - delta);
    return toISO(d);
  }
  function labelMinggu(key) {
    var akhir = tambahHari(key, 6);
    var a = parseTanggal(key), b = parseTanggal(akhir);
    if (!a || !b) return key;
    var kiri = a.getDate() + " " + NAMA_BULAN_PENDEK[a.getMonth()];
    var kanan = b.getDate() + " " + NAMA_BULAN_PENDEK[b.getMonth()];
    return kiri + " – " + kanan;
  }
  function jumlahHariBulan(key) {
    var m = /^(\d{4})-(\d{2})$/.exec(key || "");
    if (!m) return 30;
    return new Date(+m[1], +m[2], 0).getDate();
  }
  function bulat(n, desimal) {
    var f = Math.pow(10, desimal === undefined ? 1 : desimal);
    return Math.round(n * f) / f;
  }

  /* ---------------- parsing angka (format Indonesia) ---------------- */
  function parseAngka(nilai) {
    if (typeof nilai === "number") return isFinite(nilai) ? nilai : null;
    if (nilai === null || nilai === undefined) return null;
    var s = String(nilai).trim().replace(/\s|kWh/gi, "");
    if (s === "" || s === "-") return null;
    var negatif = false;
    if (/^\(.*\)$/.test(s)) { negatif = true; s = s.slice(1, -1); }
    if (s.indexOf(",") > -1) {
      // koma = desimal, titik = ribuan
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      var titik = s.split(".").length - 1;
      if (titik > 1) {
        s = s.replace(/\./g, ""); // 1.286.000 -> ribuan
      } else if (titik === 1) {
        var belakang = s.split(".")[1] || "";
        if (belakang.length === 3 && s.split(".")[0].length <= 3) {
          s = s.replace(".", ""); // 1.286 -> 1286 (ribuan)
        }
        // selain itu biarkan sebagai desimal (1286.5)
      }
    }
    var n = Number(s);
    if (!isFinite(n)) return null;
    return negatif ? -n : n;
  }

  /* ---------------- normalisasi state ---------------- */
  function pengaturanBawaan() {
    return {
      nama: "Rumah",
      hargaKwh: HARGA_BAWAAN,
      tarifDasar: 1699.53,
      ppj: 0,
      jamCatat: "09:00"
    };
  }

  function normalise(state) {
    var masuk = state && typeof state === "object" ? state : {};
    var s = pengaturanBawaan();
    var set = masuk.settings || {};
    if (typeof set.nama === "string" && set.nama.trim()) s.nama = set.nama.trim();
    if (isFinite(Number(set.hargaKwh))) s.hargaKwh = Math.max(0, Number(set.hargaKwh));
    if (isFinite(Number(set.tarifDasar))) s.tarifDasar = Math.max(0, Number(set.tarifDasar));
    if (isFinite(Number(set.ppj))) s.ppj = Math.min(30, Math.max(0, Number(set.ppj)));
    if (typeof set.jamCatat === "string") s.jamCatat = set.jamCatat;

    var daftar = Array.isArray(masuk.catatan) ? masuk.catatan : [];
    var perTanggal = {};
    var urutan = [];
    for (var i = 0; i < daftar.length; i++) {
      var r = daftar[i];
      if (!r || typeof r !== "object") continue;
      var tgl = normalTanggal(r.tanggal);
      if (!tgl) continue;
      var sisa = parseAngka(r.sisa);
      if (sisa === null || sisa < 0) continue;
      var rec = {
        id: typeof r.id === "string" && r.id ? r.id : "r" + tgl + "-" + i,
        tanggal: tgl,
        sisa: bulat(sisa, 2),
        masuk: Math.max(0, parseAngka(r.masuk) || 0),
        catatan: typeof r.catatan === "string" ? r.catatan.slice(0, 160) : ""
      };
      if (!perTanggal[tgl]) urutan.push(tgl);
      perTanggal[tgl] = rec; // tanggal dobel: yang terakhir menang
    }
    urutan.sort();
    var catatan = urutan.map(function (t) { return perTanggal[t]; });

    return { v: VERSI, settings: s, catatan: catatan };
  }

  function normalTanggal(nilai) {
    var s = String(nilai || "").trim();
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) {
      var iso = m[1] + "-" + pad2(+m[2]) + "-" + pad2(+m[3]);
      return parseTanggal(iso) ? iso : null;
    }
    m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s);
    if (m) {
      var d = +m[1], mo = +m[2], y = +m[3];
      if (mo > 12 && d <= 12) { var t = d; d = mo; mo = t; }
      var dt = new Date(y, mo - 1, d);
      if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
      return y + "-" + pad2(mo) + "-" + pad2(d);
    }
    return null;
  }

  /* ---------------- inti perhitungan ---------------- */
  function hitung(state, opsi) {
    var st = normalise(state);
    var set = st.settings;
    var daftar = st.catatan;
    var harga = set.hargaKwh;
    var sekarang = (opsi && opsi.sekarang) || tanggalSekarang();
    var kunciSekarang = bulanKey(sekarang);

    var catatan = [];          // tiap catatan + hasil hitung
    var totalKwh = 0, totalRp = 0, totalMasuk = 0;
    var maks = null, min = null;

    for (var i = 0; i < daftar.length; i++) {
      var r = daftar[i];
      var nxt = daftar[i + 1] || null;
      var rec = {
        id: r.id, tanggal: r.tanggal, sisa: r.sisa, masuk: r.masuk, catatan: r.catatan,
        hari: namaHari(r.tanggal),
        pemakaian: null, biaya: null, jeda: null, anomali: null
      };
      if (nxt) {
        rec.jeda = bedaHari(r.tanggal, nxt.tanggal);
        // token yang diisi sebelum pembacaan berikutnya ikut menambah saldo interval ini
        var p = r.sisa + (nxt.masuk || 0) - nxt.sisa;
        if (p < 0) {
          rec.anomali = "negatif";
          rec.pemakaian = null;
        } else {
          rec.pemakaian = bulat(p, 2);
          rec.biaya = bulat(rec.pemakaian * harga, 0);
          totalKwh += rec.pemakaian;
          totalRp += rec.biaya;
          if (!maks || rec.pemakaian > maks.pemakaian) maks = rec;
          if (!min || rec.pemakaian < min.pemakaian) min = rec;
        }
      }
      if (rec.masuk > 0) totalMasuk += rec.masuk;
      catatan.push(rec);
    }
    totalKwh = bulat(totalKwh, 2);
    totalRp = Math.round(totalRp);

    // hari yang punya pemakaian
    var harian = catatan.filter(function (r) { return r.pemakaian !== null; });
    var nHari = harian.length;
    var rata = nHari ? totalKwh / nHari : 0;
    var nilai = harian.map(function (r) { return r.pemakaian; });
    var median = 0, sd = 0;
    if (nilai.length) {
      var urut = nilai.slice().sort(function (a, b) { return a - b; });
      var tengah = Math.floor(urut.length / 2);
      median = urut.length % 2 ? urut[tengah] : (urut[tengah - 1] + urut[tengah]) / 2;
      var varians = nilai.reduce(function (s, v) { return s + Math.pow(v - rata, 2); }, 0) / nilai.length;
      sd = Math.sqrt(varians);
    }

    var hariNol = harian.filter(function (r) { return r.pemakaian === 0; });
    var lonjakan = harian.filter(function (r) { return r.pemakaian > 0 && r.pemakaian >= rata + sd; })
      .sort(function (a, b) { return b.pemakaian - a.pemakaian; }).slice(0, 6);

    // per nama hari
    var perHari = {};
    NAMA_HARI.forEach(function (n) { perHari[n] = { kwh: 0, hari: 0, rata: 0 }; });
    harian.forEach(function (r) {
      var n = r.hari;
      perHari[n].kwh += r.pemakaian;
      perHari[n].hari += 1;
    });
    Object.keys(perHari).forEach(function (n) {
      perHari[n].kwh = bulat(perHari[n].kwh, 2);
      perHari[n].rata = perHari[n].hari ? bulat(perHari[n].kwh / perHari[n].hari, 2) : 0;
    });

    // mingguan (Senin–Minggu)
    var petaMinggu = {}, urutanMinggu = [];
    harian.forEach(function (r) {
      var key = seninDari(r.tanggal);
      if (!petaMinggu[key]) {
        petaMinggu[key] = { key: key, label: labelMinggu(key), kwh: 0, biaya: 0, hari: 0 };
        urutanMinggu.push(key);
      }
      petaMinggu[key].kwh += r.pemakaian;
      petaMinggu[key].biaya += r.biaya;
      petaMinggu[key].hari += 1;
    });
    urutanMinggu.sort();
    var mingguan = urutanMinggu.map(function (k) {
      var m = petaMinggu[k];
      m.kwh = bulat(m.kwh, 2);
      return m;
    });

    // bulanan
    var petaBulan = {}, urutanBulan = [];
    catatan.forEach(function (r) {
      var key = bulanKey(r.tanggal);
      if (!petaBulan[key]) {
        petaBulan[key] = {
          key: key, label: labelBulan(key), kwh: 0, biaya: 0, hari: 0, sisaAwal: r.sisa,
          sisaAkhir: r.sisa, masukKwh: 0, masukRp: 0, hariNol: 0, catatan: 0, maksHari: null
        };
        urutanBulan.push(key);
      }
      var m = petaBulan[key];
      m.catatan += 1;
      m.sisaAkhir = r.sisa;
      if (r.masuk > 0) { m.masukKwh += r.masuk; m.masukRp += r.masuk * harga; }
      if (r.pemakaian !== null) {
        m.kwh += r.pemakaian;
        m.biaya += r.biaya;
        m.hari += 1;
        if (r.pemakaian === 0) m.hariNol += 1;
        if (!m.maksHari || r.pemakaian > m.maksHari.pemakaian) m.maksHari = r;
      }
    });
    urutanBulan.sort();
    var bulanan = urutanBulan.map(function (k) {
      var m = petaBulan[k];
      m.kwh = bulat(m.kwh, 2);
      m.masukKwh = bulat(m.masukKwh, 2);
      m.masukRp = Math.round(m.masukRp);
      m.rataHarian = m.hari ? bulat(m.kwh / m.hari, 2) : 0;
      m.jumlahHari = jumlahHariBulan(k);
      return m;
    });

    // saldo & proyeksi
    var terakhir = catatan.length ? catatan[catatan.length - 1] : null;
    var sisaAkhir = terakhir ? terakhir.sisa : 0;
    var saldoRp = Math.round(sisaAkhir * harga);

    var ekor = harian.slice(-14);
    var rata14 = ekor.length ? ekor.reduce(function (s, r) { return s + r.pemakaian; }, 0) / ekor.length : rata;
    var estimasiHari = rata14 > 0 ? Math.ceil(sisaAkhir / rata14) : null;
    var estimasiTanggal = (estimasiHari !== null && terakhir) ? tambahHari(terakhir.tanggal, estimasiHari) : null;

    var bulanTerakhir = bulanan.length ? bulanan[bulanan.length - 1] : null;

    // perbandingan memakai bulan yang sedang dilihat (bukan bulan kalender terakhir,
    // supaya bulan berjalan yang belum lengkap tidak mengacaukan angka)
    var kunciAktif = pilihBulanAktif(bulanan, kunciSekarang);
    var idxAktif = -1;
    bulanan.forEach(function (b, i) { if (b.key === kunciAktif) idxAktif = i; });
    var bulanAktifObj = idxAktif >= 0 ? bulanan[idxAktif] : null;
    var bulanPembanding = idxAktif > 0 ? bulanan[idxAktif - 1] : null;
    var deltaAktif = (bulanAktifObj && bulanPembanding && bulanPembanding.kwh > 0)
      ? bulat((bulanAktifObj.kwh - bulanPembanding.kwh) / bulanPembanding.kwh * 100, 1) : null;

    // proyeksi 30 hari & bulan berjalan
    var proyeksi30Kwh = bulat(rata * 30, 1);
    var proyeksi30Rp = Math.round(rata * 30 * harga);

    // pembelian token
    var pembelian = catatan.filter(function (r) { return r.masuk > 0; })
      .map(function (r) { return { tanggal: r.tanggal, kwh: r.masuk, rp: Math.round(r.masuk * harga) }; });

    var ringkasan = {
      hargaKwh: harga,
      jumlahCatatan: catatan.length,
      jumlahHari: nHari,
      totalKwh: totalKwh,
      totalRp: totalRp,
      totalMasukKwh: bulat(totalMasuk, 2),
      totalMasukRp: Math.round(totalMasuk * harga),
      rataHarian: bulat(rata, 2),
      medianHarian: bulat(median, 2),
      stdev: bulat(sd, 2),
      maks: maks,
      min: min,
      hariNol: hariNol,
      lonjakan: lonjakan,
      perHari: perHari,
      sisaAkhir: sisaAkhir,
      saldoRp: saldoRp,
      rata14: bulat(rata14, 2),
      estimasiHari: estimasiHari,
      estimasiTanggal: estimasiTanggal,
      proyeksi30Kwh: proyeksi30Kwh,
      proyeksi30Rp: proyeksi30Rp,
      proyeksiTahunKwh: bulat(rata * 365, 0),
      proyeksiTahunRp: Math.round(rata * 365 * harga),
      bulanTerakhir: bulanAktifObj || bulanTerakhir,
      bulanSebelumnya: bulanPembanding,
      deltaBulan: deltaAktif,
      bulanBerjalan: !!(bulanAktifObj && bulanAktifObj.key === kunciSekarang),
      pembelian: pembelian,
      terakhir: terakhir
    };

    var bulanAktif = pilihBulanAktif(bulanan, kunciSekarang);
    var hasil = {
      versi: VERSI,
      settings: set,
      catatan: catatan,
      harian: harian,
      mingguan: mingguan,
      bulanan: bulanan,
      ringkasan: ringkasan,
      bulanAktif: bulanAktif
    };
    hasil.insight = buatInsight(hasil);
    return hasil;
  }

  /**
   * Bulan yang ditampilkan secara default: bulan kalender saat ini.
   * Bila bulan ini belum punya catatan, tetap dipilih (aplikasi menampilkan bulan kosong
   * supaya pengguna bisa langsung mencatat). Bila `sekarangKey` tidak diberikan,
   * jatuh ke perilaku lama: bulan terakhir yang sudah ada pemakaian.
   */
  function pilihBulanAktif(bulanan, sekarangKey) {
    // Default: bulan kalender saat ini (walau belum ada catatan di bulan itu).
    if (sekarangKey) return sekarangKey;
    if (!bulanan.length) return null;
    for (var i = bulanan.length - 1; i >= 0; i--) {
      if (bulanan[i].hari >= 2) return bulanan[i].key;
    }
    return bulanan[bulanan.length - 1].key;
  }

  function buatInsight(h) {
    var r = h.ringkasan;
    var out = [];
    if (!r.jumlahHari) {
      return [{ tipe: "info", teks: "Belum ada pasangan catatan yang bisa dihitung. Catat sisa kWh selama 2 hari berturut-turut untuk mulai melihat pemakaian." }];
    }

    out.push({
      tipe: "ringkas",
      teks: "Rata-rata pemakaian " + angka(r.rataHarian, 1) + " kWh/hari (Rp " + nf0.format(Math.round(r.rataHarian * r.hargaKwh)) +
            "/hari). Tertinggi " + angka(r.maks.pemakaian, 1) + " kWh pada " + labelTanggal(r.maks.tanggal, false) +
            ", terendah " + angka(r.min.pemakaian, 1) + " kWh pada " + labelTanggal(r.min.tanggal, false) + "."
    });

    // hari paling boros/hemat
    var urut = Object.keys(r.perHari).filter(function (n) { return r.perHari[n].hari > 0; })
      .sort(function (a, b) { return r.perHari[b].rata - r.perHari[a].rata; });
    if (urut.length > 1) {
      var atas = urut[0], bawah = urut[urut.length - 1];
      out.push({
        tipe: "pola",
        teks: namaHariPanjang(atas) + " paling boros (" + angka(r.perHari[atas].rata, 1) + " kWh/hari), " +
              namaHariPanjang(bawah) + " paling hemat (" + angka(r.perHari[bawah].rata, 1) + " kWh/hari). " +
              "Selisihnya " + angka(r.perHari[atas].rata - r.perHari[bawah].rata, 1) + " kWh/hari."
      });
    }

    if (r.lonjakan.length) {
      var daftar = r.lonjakan.slice(0, 3).map(function (x) {
        return labelTanggal(x.tanggal, false) + " (" + angka(x.pemakaian, 1) + " kWh)";
      }).join(", ");
      out.push({ tipe: "waspada", teks: "Hari dengan pemakaian jauh di atas rata-rata: " + daftar + ". Cek pemakaian besar (AC, pompa air, setrika, water heater) di hari-hari itu." });
    }

    if (r.hariNol.length) {
      var tgl = r.hariNol.slice(0, 4).map(function (x) { return labelTanggal(x.tanggal, false); }).join(", ");
      out.push({
        tipe: r.hariNol.length > 2 ? "waspada" : "info",
        teks: r.hariNol.length + " hari tercatat 0 kWh (" + tgl + (r.hariNol.length > 4 ? ", …" : "") +
              "). Bisa berarti rumah kosong, atau angka sisa meteran tidak sempat dicatat sebelum token diisi."
      });
    }

    if (r.estimasiHari !== null) {
      out.push({
        tipe: "info",
        teks: "Sisa token " + angka(r.sisaAkhir, 0) + " kWh (≈ " + rp(r.saldoRp) + "). Dengan pemakaian " +
              angka(r.rata14, 1) + " kWh/hari (rata-rata 14 hari terakhir), token cukup untuk ±" + r.estimasiHari +
              " hari lagi (sekitar " + labelTanggal(r.estimasiTanggal) + ")."
      });
    }

    if (r.pembelian.length) {
      var beli = r.pembelian.map(function (b) { return labelTanggal(b.tanggal, false) + ": " + angka(b.kwh, 0) + " kWh (" + rp(b.rp) + ")"; }).join("; ");
      out.push({ tipe: "token", teks: "Pengisian token pada periode ini — " + beli + "." });
    }

    out.push({
      tipe: "proyeksi",
      teks: "Proyeksi biaya: " + rp(r.proyeksi30Rp) + "/30 hari (≈ " + rp(r.proyeksiTahunRp) + "/tahun) pada tarif " +
            rp(r.hargaKwh) + "/kWh."
    });

    if (r.deltaBulan !== null && !r.bulanBerjalan) {
      var arah = r.deltaBulan >= 0 ? "naik" : "turun";
      out.push({
        tipe: r.deltaBulan > 10 ? "waspada" : "info",
        teks: "Pemakaian " + h.ringkasan.bulanTerakhir.label + " " + arah + " " + angka(Math.abs(r.deltaBulan), 1) +
              "% dibanding bulan sebelumnya (" + angka(h.ringkasan.bulanTerakhir.kwh, 1) + " kWh vs " +
              angka(h.ringkasan.bulanSebelumnya ? h.ringkasan.bulanSebelumnya.kwh : 0, 1) + " kWh)."
      });
    } else if (r.bulanBerjalan && r.bulanTerakhir && r.bulanTerakhir.kwh > 0) {
      out.push({
        tipe: "info",
        teks: "Bulan ini masih berjalan (" + angka(r.bulanTerakhir.kwh, 1) + " kWh sejauh ini). " +
              "Perbandingan dengan bulan lalu ditampilkan setelah bulan selesai."
      });
    }

    return out;
  }
  function namaHariPanjang(n) { return n; }

  /* ---------------- CSV ---------------- */
  function pecahBarisCsv(baris) {
    var sel = [], buf = "", dalamKutip = false;
    for (var i = 0; i < baris.length; i++) {
      var c = baris[i];
      if (c === '"') {
        if (dalamKutip && baris[i + 1] === '"') { buf += '"'; i++; }
        else dalamKutip = !dalamKutip;
      } else if ((c === "," || c === ";" || c === "\t") && !dalamKutip) {
        sel.push(buf); buf = "";
      } else {
        buf += c;
      }
    }
    sel.push(buf);
    return sel;
  }

  function parseCsv(teks) {
    var baris = String(teks || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(function (b) { return b.trim() !== ""; });
    if (!baris.length) return [];
    var mulai = 0;
    if (/tanggal|date/i.test(baris[0]) && !/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4}/.test(baris[0])) mulai = 1;

    var hasil = [];
    for (var i = mulai; i < baris.length; i++) {
      var sel = pecahBarisCsv(baris[i]);
      if (sel.length < 2) continue;
      var tgl = normalTanggal(String(sel[0]).replace(/^"|"$/g, "").trim());
      if (!tgl) continue;
      var sisa = parseAngka(sel[1]);
      if (sisa === null || sisa < 0) continue;
      var masuk = 0;
      var catatan = "";
      if (sel.length >= 3) {
        var c3 = String(sel[2]).replace(/^"|"$/g, "").trim();
        var n3 = parseAngka(c3);
        if (n3 !== null && c3 !== "") {
          masuk = Math.max(0, n3);
          catatan = sel.length >= 4 ? String(sel[3]).replace(/^"|"$/g, "").trim() : "";
        } else {
          catatan = c3;
        }
      }
      hasil.push({ tanggal: tgl, sisa: bulat(sisa, 2), masuk: masuk, catatan: catatan });
    }
    return hasil;
  }

  function toCsv(catatan) {
    var baris = ["tanggal,sisa,masuk,catatan"];
    (catatan || []).slice().sort(function (a, b) { return a.tanggal < b.tanggal ? -1 : 1; })
      .forEach(function (r) {
        var note = String(r.catatan || "").replace(/"/g, '""');
        baris.push(r.tanggal + "," + r.sisa + "," + (r.masuk || 0) + ',"' + note + '"');
      });
    return baris.join("\r\n");
  }

  var KwhCore = {
    VERSI: VERSI,
    HARGA_BAWAAN: HARGA_BAWAAN,
    NAMA_HARI: NAMA_HARI,
    NAMA_BULAN: NAMA_BULAN,
    pengaturanBawaan: pengaturanBawaan,
    normalise: normalise,
    hitung: hitung,
    parseCsv: parseCsv,
    toCsv: toCsv,
    parseAngka: parseAngka,
    normalTanggal: normalTanggal,
    labelTanggal: labelTanggal,
    labelBulan: labelBulan,
    labelBulanPendek: labelBulanPendek,
    labelMinggu: labelMinggu,
    namaHari: namaHari,
    namaHariPendek: namaHariPendek,
    seninDari: seninDari,
    bulanKey: bulanKey,
    tambahHari: tambahHari,
    bedaHari: bedaHari,
    jumlahHariBulan: jumlahHariBulan,
    tanggalSekarang: tanggalSekarang,
    angka: angka,
    rp: rp,
    kwh: kwh,
    bulat: bulat
  };

  if (typeof module !== "undefined" && module.exports) module.exports = KwhCore;
  root.KwhCore = KwhCore;
})(typeof globalThis !== "undefined" ? globalThis : this);
