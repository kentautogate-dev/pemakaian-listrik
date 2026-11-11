/*
 * app.js — antarmuka aplikasi Pemakaian kWh Listrik Rumah (versi 2)
 * Bergantung pada core.js (KwhCore) dan data-oktober-2026.js (data bawaan, opsional).
 */
(function () {
  "use strict";

  var Core = window.KwhCore;
  var STORE = "kwh-rumah-v2";
  var THEME = "kwh-rumah-tema";

  var state = { v: 2, settings: Core.pengaturanBawaan(), catatan: [] };
  var modeGrafik = "harian";
  var metrikGrafik = "kwh";
  var bulanPilih = null;
  var tabAktif = "harian";
  var editId = null;
  var undoHapus = null;
  var fileImpor = null;
  var barisImpor = [];
  var adaPenyimpanan = true;

  var $ = function (id) { return document.getElementById(id); };
  var fmtRp = Core.rp;
  var fmtKwh = function (n, d) { return Core.kwh(n, d === undefined ? 1 : d); };
  var angka = Core.angka;
  var esc = function (s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  /* ================= ikon svg (tanpa emoji, agar konsisten) ================= */
  var IKON = {
    grafik: '<path d="M2.5 13.5V2.5M2.5 13.5h11"/><path d="M5 11V7.2M8 11V4.6M11 11V8.4"/>',
    kompas: '<circle cx="8" cy="8" r="6"/><path d="M10.4 5.6 9 9 5.6 10.4 7 7z"/>',
    peringatan: '<path d="M8 2.2 14 13H2z"/><path d="M8 6.2v3.1M8 11.4h.01"/>',
    info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.4M8 5.1h.01"/>',
    tiket: '<path d="M2.2 5h11.6v2.1a1.6 1.6 0 0 0 0 2.8v2.1H2.2V9.9a1.6 1.6 0 0 0 0-2.8z"/><path d="M6 5v1.6M6 8.6V11"/>',
    tren: '<path d="M2.2 11.8 6 8l2.6 1.9 5-5.6"/><path d="M13.6 4.3h-2.8M13.6 4.3v2.7"/>',
    pensil: '<path d="M11.4 2.6l2 2L5.4 12.6 2.4 13.6l1-3z"/><path d="M9.9 4.1l2 2"/>',
    hapus: '<path d="M2.8 4.2h10.4M6.2 4.2V2.9h3.6v1.3"/><path d="M4.8 4.2l.8 9.3h4.8l.8-9.3M6.6 6.6v4.6M9.4 6.6v4.6"/>'
  };
  function ikon(nama, kelas) {
    return '<svg class="ikon-svg ' + (kelas || "") + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (IKON[nama] || "") + "</svg>";
  }

  /* ================= penyimpanan ================= */
  function muatData() {
    var mentah = null;
    try { mentah = localStorage.getItem(STORE); }
    catch (e) { adaPenyimpanan = false; }

    if (mentah) {
      try {
        var obj = JSON.parse(mentah);
        if (obj && (obj.catatan || obj.settings)) {
          state = Core.normalise(obj);
          return;
        }
      } catch (e) { /* data rusak -> pakai data bawaan */ }
    }

    // pemakaian pertama: muat data Oktober 2026 (bila tersedia)
    if (window.DATA_OKTOBER_2026) {
      state = Core.normalise(window.DATA_OKTOBER_2026);
      state.catatan.forEach(function (r) { r.id = "bawaan-" + r.tanggal; });
      simpan();
      window.__dataBawaan = true;
    } else {
      state = Core.normalise({ settings: Core.pengaturanBawaan(), catatan: [] });
    }
  }

  function simpan() {
    try {
      localStorage.setItem(STORE, JSON.stringify(state));
    } catch (e) {
      if (adaPenyimpanan) {
        adaPenyimpanan = false;
        $("banner").classList.remove("hidden");
        $("banner").innerHTML = "<b>Penyimpanan browser tidak aktif.</b> Catatan tetap bisa dipakai, tetapi tidak tersimpan otomatis setelah halaman ditutup. " +
          "Simpan berkala lewat <b>Ekspor → JSON backup</b>.";
      }
    }
  }
  function unduh(nama, mime, isi) {
    var blob = new Blob([isi], { type: mime + ";charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = nama;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 600);
  }
  function capWaktu() {
    var d = new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  }
  function stempel() {
    var d = new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  }

  /* ================= toast ================= */
  var toastTimer = null;
  function tampilToast(teks, jenis, aksi) {
    var t = $("toast");
    t.innerHTML = '<span>' + teks + "</span>" + (aksi ? '<button type="button" class="toast-aksi">' + aksi.label + "</button>" : "");
    t.className = "toast show " + (jenis || "");
    if (aksi) {
      t.querySelector(".toast-aksi").addEventListener("click", function () {
        aksi.jalankan();
        sembunyikanToast();
      });
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(sembunyikanToast, aksi ? 7000 : 3400);
  }
  function sembunyikanToast() { $("toast").className = "toast"; }

  /* ================= tema ================= */
  function pasangTema(t) {
    document.documentElement.setAttribute("data-tema", t);
    var tombol = $("btnTema");
    tombol.title = t === "gelap" ? "Ganti ke tema terang" : "Ganti ke tema gelap";
    tombol.setAttribute("aria-pressed", t === "gelap" ? "true" : "false");
    try { localStorage.setItem(THEME, t); } catch (e) {}
  }
  function muatTema() {
    var t = "terang";
    try { t = localStorage.getItem(THEME) || "terang"; } catch (e) {}
    pasangTema(t);
  }

  /* ================= helper tampilan ================= */
  function bulanDariCatatan(h, key) {
    return (h.bulanan || []).filter(function (b) { return b.key === key; })[0] || null;
  }
  function catatanBulan(h, key) {
    return h.catatan.filter(function (r) { return Core.bulanKey(r.tanggal) === key; });
  }
  function infoPenyimpanan() {
    if (window.__dataBawaan) {
      tampilToast("Data Oktober 2026 sudah dimuat. Bisa diubah atau dihapus di Pengaturan.", "ok");
      window.__dataBawaan = false;
    }
  }

  /* ================= render: header & statistik ================= */
  function renderHeader(h) {
    var s = h.settings;
    $("subline").textContent = s.nama + " • " + fmtRp(s.hargaKwh) + "/kWh • " + h.catatan.length + " catatan" +
      (h.catatan.length ? " • terakhir " + Core.labelTanggal(h.catatan[h.catatan.length - 1].tanggal) : "");
  }

  function kartuStatistik(h) {
    var r = h.ringkasan;
    var bulan = bulanDariCatatan(h, h.bulanAktif);
    var kartu = [];

    if (bulan && bulan.hari > 0) {
      var pembanding = r.bulanSebelumnya;
      var delta = r.bulanBerjalan
        ? '<span class="chip">bulan berjalan</span>'
        : ((r.deltaBulan !== null && pembanding)
            ? (r.deltaBulan > 0
                ? '<span class="chip naik">▲ ' + angka(Math.abs(r.deltaBulan), 1) + "% vs " + Core.labelBulanPendek(pembanding.key) + "</span>"
                : '<span class="chip turun">▼ ' + angka(Math.abs(r.deltaBulan), 1) + "% vs " + Core.labelBulanPendek(pembanding.key) + "</span>")
            : "");
      kartu.push({
        label: "Pemakaian " + bulan.label,
        nilai: angka(bulan.kwh, 1) + " <small>kWh</small>",
        kaki: fmtRp(bulan.biaya) + " " + delta
      });
    } else if (bulan) {
      kartu.push({
        label: "Pemakaian " + bulan.label,
        nilai: "—",
        kaki: "Menunggu catatan berikutnya untuk menghitung pemakaian"
      });
    } else {
      kartu.push({
        label: "Pemakaian " + (h.bulanAktif ? Core.labelBulan(h.bulanAktif) : "bulan ini"),
        nilai: "—",
        kaki: "Belum ada catatan bulan ini"
      });
    }

    kartu.push({
      label: "Rata-rata harian",
      nilai: angka(r.rataHarian, 2) + " <small>kWh/hari</small>",
      kaki: fmtRp(r.rataHarian * r.hargaKwh) + "/hari • median " + angka(r.medianHarian, 1)
    });

    kartu.push({
      label: "Sisa token sekarang",
      nilai: angka(r.sisaAkhir, 0) + " <small>kWh</small>",
      kaki: fmtRp(r.saldoRp) + (r.estimasiHari !== null
        ? " • cukup ±" + r.estimasiHari + " hari (s.d. " + Core.labelTanggal(r.estimasiTanggal, false) + ")"
        : "") +
        (r.tokenTertunda > 0
          ? ' <span class="chip">+ ' + angka(r.tokenTertunda, 0) + " kWh token baru</span>"
          : "")
    });

    kartu.push({
      label: "Proyeksi 30 hari",
      nilai: fmtRp(r.proyeksi30Rp),
      kaki: "≈ " + angka(r.proyeksi30Kwh, 1) + " kWh • setahun " + fmtRp(r.proyeksiTahunRp)
    });

    $("stats").innerHTML = kartu.map(function (k) {
      return '<div class="card stat"><div class="label">' + k.label + "</div>" +
        '<div class="nilai">' + k.nilai + "</div>" +
        '<div class="kaki">' + k.kaki + "</div></div>";
    }).join("");
  }
  function bulanSebelum(h) {
    var idx = -1;
    h.bulanan.forEach(function (b, i) { if (b.key === h.bulanAktif) idx = i; });
    return idx > 0 ? h.bulanan[idx - 1].key : null;
  }

  /* ================= render: grafik ================= */
  function niceMax(v) {
    if (!(v > 0)) return 10;
    var exp = Math.floor(Math.log10(v));
    var base = Math.pow(10, exp);
    var f = v / base;
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nf * base;
  }
  function angkaRingkas(v, pakaiRp) {
    if (pakaiRp) {
      if (v >= 1000000) return "Rp" + angka(v / 1000000, 1) + "jt";
      if (v >= 1000) return "Rp" + angka(v / 1000, 0) + "rb";
      return "Rp" + angka(v, 0);
    }
    return angka(v, v >= 100 ? 0 : 1);
  }

  function dataGrafik(h) {
    if (modeGrafik === "harian") {
      var key = bulanPilih || h.bulanAktif;
      var daftar = catatanBulan(h, key).filter(function (r) { return r.pemakaian !== null; });
      return {
        judul: Core.labelBulan(key),
        items: daftar.map(function (r) {
          var hari = parseInt(r.tanggal.slice(8, 10), 10);
          return {
            label: String(hari),
            nilai: metrikGrafik === "kwh" ? r.pemakaian : r.biaya,
            teks: Core.labelTanggal(r.tanggal, false) + " (" + Core.namaHariPendek(r.tanggal) + "): " +
                  fmtKwh(r.pemakaian) + " • " + fmtRp(r.biaya)
          };
        })
      };
    }
    if (modeGrafik === "mingguan") {
      var minggu = h.mingguan.slice(-10);
      return {
        judul: "10 pekan terakhir",
        items: minggu.map(function (m) {
          return {
            label: m.label.split(" – ")[0],
            nilai: metrikGrafik === "kwh" ? m.kwh : m.biaya,
            teks: "Pekan " + m.label + ": " + fmtKwh(m.kwh) + " • " + fmtRp(m.biaya) + " (" + m.hari + " hari)"
          };
        })
      };
    }
    var bulanan = h.bulanan.slice(-12);
    return {
      judul: "12 bulan terakhir",
      items: bulanan.map(function (b) {
        return {
          label: Core.labelBulanPendek(b.key),
          nilai: metrikGrafik === "kwh" ? b.kwh : b.biaya,
          teks: b.label + ": " + fmtKwh(b.kwh) + " • " + fmtRp(b.biaya) + " (" + b.hari + " hari tercatat)"
        };
      })
    };
  }

  function gambarGrafik(h) {
    var host = $("chart");
    var pakaiRp = metrikGrafik === "rp";
    var d = dataGrafik(h);
    var items = d.items;
    $("chartInfo").textContent = d.judul;

    if (!items.length) {
      host.innerHTML = '<div class="empty"><div class="besar">' + ikon("grafik") + "</div><div>Belum ada data untuk digrafikkan.</div>" +
        '<div class="muted">Catat sisa kWh dua hari berturut-turut agar pemakaian terhitung.</div></div>';
      $("chartCap").textContent = "";
      return;
    }

    var lebarWadah = host.clientWidth || 760;
    var W = Math.max(340, Math.min(780, Math.round(lebarWadah)));
    var H = Math.round(Math.min(320, Math.max(250, W * 0.44)));
    var padL = pakaiRp ? Math.max(66, Math.round(W * 0.12)) : Math.max(40, Math.round(W * 0.075));
    var padR = 12, padT = 22, padB = 42;
    var fSumbu = W < 480 ? 10 : 11;
    var fLabel = W < 480 ? 9.5 : 10.5;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var maks = Math.max.apply(null, items.map(function (i) { return i.nilai; }));
    var atas = niceMax(maks * 1.02);
    var ticks = 4;
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Grafik pemakaian">';

    for (var t = 0; t <= ticks; t++) {
      var v = atas / ticks * t;
      var y = padT + innerH - (v / atas) * innerH;
      svg += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) +
        '" style="stroke:var(--garis)" stroke-width="1" stroke-dasharray="' + (t === 0 ? "0" : "3 4") + '"/>';
      svg += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="' + fSumbu + '" style="fill:var(--teks-lembut)">' +
        angkaRingkas(v, pakaiRp) + "</text>";
    }

    var n = items.length;
    var slot = innerW / n;
    var lebarBatang = Math.max(3, Math.min(46, slot * (n > 20 ? 0.74 : 0.58)));
    var langkahLabel = n <= 10 ? 1 : Math.ceil(n / 10);

    items.forEach(function (it, i) {
      var hgt = it.nilai / atas * innerH;
      var x = padL + slot * i + (slot - lebarBatang) / 2;
      var y = padT + innerH - hgt;
      svg += "<g><title>" + esc(it.teks) + "</title>";
      svg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + lebarBatang.toFixed(1) +
        '" height="' + Math.max(1.5, hgt).toFixed(1) + '" rx="4" style="fill:' +
        (i === n - 1 ? "var(--aksen)" : "var(--aksen-lembut)") + '"/>';
      if (n <= 14) {
        svg += '<text x="' + (x + lebarBatang / 2).toFixed(1) + '" y="' + (y - 6).toFixed(1) +
          '" text-anchor="middle" font-size="' + fLabel + '" font-weight="700" style="fill:var(--teks)">' +
          angkaRingkas(it.nilai, pakaiRp) + "</text>";
      }
      var tampilLabel = n <= 14 ? true : (i % langkahLabel === 0 || i === n - 1);
      if (tampilLabel) {
        svg += '<text x="' + (x + lebarBatang / 2).toFixed(1) + '" y="' + (H - 13) +
          '" text-anchor="middle" font-size="' + fLabel + '" style="fill:var(--teks-lembut)">' + esc(it.label) + "</text>";
      }
      svg += "</g>";
    });

    var rata = items.reduce(function (s, i) { return s + i.nilai; }, 0) / n;
    if (rata > 0) {
      var yr = padT + innerH - (rata / atas) * innerH;
      svg += '<line x1="' + padL + '" y1="' + yr.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yr.toFixed(1) +
        '" style="stroke:var(--kuning)" stroke-width="1.5" stroke-dasharray="6 4" opacity=".85"/>';
      svg += '<text x="' + (W - padR) + '" y="' + (yr - 6).toFixed(1) + '" text-anchor="end" font-size="' + fSumbu + '" style="fill:var(--kuning)">rata-rata</text>';
    }
    svg += "</svg>";
    host.innerHTML = svg;

    var total = items.reduce(function (s, i) { return s + i.nilai; }, 0);
    $("chartCap").textContent = pakaiRp
      ? "Total " + d.judul + ": " + fmtRp(total) + " • rata-rata " + fmtRp(rata) + " per " + satuanGrafik() + "."
      : "Total " + d.judul + ": " + fmtKwh(total) + " • rata-rata " + fmtKwh(rata) + " per " + satuanGrafik() + ".";
  }
  function satuanGrafik() {
    return modeGrafik === "harian" ? "hari" : modeGrafik === "mingguan" ? "pekan" : "bulan";
  }

  /* ================= render: analisa & token ================= */
  function itemInsight(i) {
    var petaIkon = { ringkas: "grafik", pola: "kompas", waspada: "peringatan", info: "info", token: "tiket", proyeksi: "tren" };
    return '<li class="insight-item ' + esc(i.tipe) + '"><span class="ikon">' + ikon(petaIkon[i.tipe] || "info") +
      '</span><p>' + esc(i.teks) + "</p></li>";
  }

  /**
   * Kartu analisa dibuat hemat layar:
   * - bulan terbaru/terpilih tampil terbuka (analisa terbaru),
   * - analisa bulan-bulan sebelumnya dilipat dalam "Arsip analisa" (bisa dibuka per bulan),
   * - daftar arsip diberi batas tinggi + scroll.
   */
  function renderInsight(h) {
    var daftar = h.insightBulanan || [];
    var key = bulanPilih || h.bulanAktif;
    var terbaru = null;
    daftar.forEach(function (b) { if (b.key === key) terbaru = b; });
    if (!terbaru && daftar.length) terbaru = daftar[daftar.length - 1];
    var lainnya = daftar.filter(function (b) { return !terbaru || b.key !== terbaru.key; })
      .sort(function (a, b) { return b.key.localeCompare(a.key); });

    var r = h.ringkasan;
    var umum = '<div class="analisa-umum">' +
      "<span>Saldo token <b>" + angka(r.sisaAkhir, 0) + " kWh</b> (" + fmtRp(r.saldoRp) + ")" +
        (r.estimasiHari !== null ? " • cukup ±" + r.estimasiHari + " hari" : "") + "</span>" +
      "<span>Proyeksi 30 hari <b>" + fmtRp(r.proyeksi30Rp) + "</b> (≈ " + angka(r.proyeksi30Kwh, 1) + " kWh)</span>" +
      "</div>";

    var html = '<div class="analisa-terbaru">' +
      '<div class="analisa-judul">Analisa terbaru — <b>' + esc(terbaru ? terbaru.label : "bulan ini") + "</b></div>" +
      (terbaru
        ? '<ul class="insight">' + terbaru.items.map(itemInsight).join("") + "</ul>"
        : '<div class="muted">Belum ada data untuk dianalisa.</div>') +
      umum + "</div>";

    if (lainnya.length) {
      html += '<details class="analisa-arsip">' +
        "<summary>Arsip analisa bulan sebelumnya <span class=\"muted\">(" + lainnya.length + " bulan) — klik untuk buka</span></summary>" +
        '<div class="arsip-scroll">' +
        lainnya.map(function (b) {
          var info = b.hari ? fmtKwh(b.kwh) + " • " + fmtRp(b.biaya) : "belum ada data";
          return '<details class="arsip-bulan"><summary><span>' + esc(b.label) + '</span><span class="muted">' + info + "</span></summary>" +
            '<ul class="insight">' + b.items.map(itemInsight).join("") + "</ul></details>";
        }).join("") +
        "</div></details>";
    }
    $("insight").innerHTML = html;
  }

  function renderPolaHari(h) {
    var per = h.ringkasan.perHari;
    var nama = Core.NAMA_HARI;
    var maks = 0;
    nama.forEach(function (n) { if (per[n].rata > maks) maks = per[n].rata; });
    var baris = nama.map(function (n) {
      var persen = maks ? (per[n].rata / maks) * 100 : 0;
      return '<div class="pola-baris"><span class="pola-nama">' + n + "</span>" +
        '<span class="pola-batang"><i style="width:' + persen.toFixed(1) + '%"></i></span>' +
        '<span class="pola-nilai">' + (per[n].hari ? angka(per[n].rata, 1) + " kWh" : "—") + "</span></div>";
    }).join("");
    $("polaHari").innerHTML = '<div class="pola-judul">Rata-rata per hari (kWh/hari)</div>' + baris;
  }

  function renderToken(h) {
    var r = h.ringkasan;
    var s = h.settings;
    var hargaEfektif = s.tarifDasar > 0 ? s.tarifDasar * (1 + s.ppj / 100) : s.hargaKwh;
    var html = '<div class="token-baris"><span>Sisa token</span><b>' + angka(r.sisaAkhir, 0) + " kWh</b></div>" +
      (r.tokenTertunda > 0
        ? '<div class="token-baris"><span class="muted kecil">Termasuk token baru</span><b class="muted kecil">+' +
          angka(r.tokenTertunda, 0) + " kWh</b></div>"
        : "") +
      '<div class="token-baris"><span>Nilai saldo</span><b>' + fmtRp(r.saldoRp) + "</b></div>" +
      '<div class="token-baris"><span>Perkiraan habis</span><b>' +
        (r.estimasiHari !== null ? "±" + r.estimasiHari + " hari" : "—") + "</b></div>" +
      '<div class="token-baris"><span>Rata-rata 14 hari</span><b>' + angka(r.rata14, 2) + " kWh/hari</b></div>" +
      '<div class="token-baris"><span>Harga beli</span><b>' + fmtRp(s.hargaKwh) + "/kWh</b></div>";
    if (Math.abs(hargaEfektif - s.hargaKwh) > 0.5) {
      html += '<div class="token-baris"><span>Tarif dasar + PPJ</span><b>' + fmtRp(hargaEfektif) + "/kWh</b></div>";
    }
    if (r.pembelian.length) {
      html += '<div class="pembelian"><div class="pembelian-judul">Pengisian token tercatat</div>' +
        r.pembelian.slice(-4).map(function (b) {
          var ket = b.posisi === "sebelum" ? "sebelum catat"
            : b.posisi === "sesudah" ? "setelah catat" : "";
          return '<div class="token-baris"><span>' + Core.labelTanggal(b.tanggal, false) +
            (ket ? ' <span class="muted kecil">(' + ket + ")</span>" : "") + "</span><b>" +
            angka(b.kwh, 0) + " kWh (" + fmtRp(b.rp) + ")</b></div>";
        }).join("") + "</div>";
    }
    $("tokenInfo").innerHTML = html;
  }

  /* ================= render: tabel ================= */
  function isiPilihanBulan(h) {
    var sel = $("pilihBulan");
    var daftar = h.bulanan.slice().reverse(); // terbaru dulu
    var kunciAktif = h.bulanAktif;
    var opsi = daftar.map(function (b) {
      return '<option value="' + b.key + '">' + b.label + (b.hari > 0 ? " (" + angka(b.kwh, 1) + " kWh)" : " (belum terhitung)") + "</option>";
    });
    // Bulan kalender saat ini selalu bisa dipilih, walau belum ada catatan di bulan itu
    if (kunciAktif && !daftar.some(function (b) { return b.key === kunciAktif; })) {
      opsi.unshift('<option value="' + kunciAktif + '">' + Core.labelBulan(kunciAktif) + " (belum ada catatan)</option>");
      daftar = [{ key: kunciAktif }].concat(daftar);
    }
    sel.innerHTML = opsi.length ? opsi.join("") : '<option value="">—</option>';
    if (bulanPilih && daftar.some(function (b) { return b.key === bulanPilih; })) sel.value = bulanPilih;
    else sel.value = kunciAktif || (daftar[0] ? daftar[0].key : "");
    bulanPilih = sel.value || null;
  }

  function renderTabelHarian(h) {
    var key = bulanPilih || h.bulanAktif;
    var daftar = key ? catatanBulan(h, key) : h.catatan.slice();
    var tbody = $("tbodyHarian");
    var infoBulan = key ? bulanDariCatatan(h, key) : null;
    $("infoHarian").textContent = key
      ? daftar.length + " catatan" + (infoBulan && infoBulan.hari > 0
          ? " • " + fmtKwh(infoBulan.kwh) + " • " + fmtRp(infoBulan.biaya)
          : " • belum ada pemakaian terhitung")
      : "";

    if (!daftar.length) {
      tbody.innerHTML = "";
      $("kosongHarian").innerHTML = "Belum ada catatan pada <b>" + (key ? Core.labelBulan(key) : "bulan ini") + "</b>. " +
        "Catat sisa kWh pagi ini, lalu besok catat lagi — pemakaian hari ini akan terhitung otomatis.";
      $("kosongHarian").classList.remove("hidden");
      return;
    }
    $("kosongHarian").classList.add("hidden");

    // subtotal pekan dihitung dari baris yang tampil pada bulan ini
    var minggu = [];
    daftar.forEach(function (r) {
      var k = Core.seninDari(r.tanggal);
      var akhir = minggu[minggu.length - 1];
      if (!akhir || akhir.key !== k) {
        akhir = { key: k, label: Core.labelMinggu(k), kwh: 0, biaya: 0, hari: 0 };
        minggu.push(akhir);
      }
      if (r.pemakaian !== null) {
        akhir.kwh += r.pemakaian;
        akhir.biaya += r.biaya;
        akhir.hari += 1;
      }
    });
    function subtotalPekan(k) {
      for (var i = 0; i < minggu.length; i++) {
        if (minggu[i].key === k) return minggu[i];
      }
      return null;
    }

    var baris = [];
    var totalKwh = 0, totalRp = 0;

    daftar.forEach(function (r, i) {
      var k = Core.seninDari(r.tanggal);
      var pemakaian = r.pemakaian === null
        ? '<span class="muted">—</span>'
        : fmtKwh(r.pemakaian);
      var biaya = r.biaya === null ? '<span class="muted">—</span>' : fmtRp(r.biaya);
      if (r.pemakaian !== null) { totalKwh += r.pemakaian; totalRp += r.biaya; }
      var tanda = "";
      if (r.anomali === "negatif") tanda = '<span class="badge bahaya">angka mundur</span>';
      else if (r.pemakaian !== null && r.pemakaian >= h.ringkasan.rataHarian + h.ringkasan.stdev && r.pemakaian > 0) {
        tanda = '<span class="badge">tinggi</span>';
      }
      var masukTeks = r.masuk > 0
        ? '<span class="masuk">+' + angka(r.masuk, 0) + "</span>" +
          (r.masukSebelum === false
            ? '<div class="muted kecil" title="Token diisi setelah angka sisa ini dibaca; dihitung pada interval sesudahnya.">setelah catat</div>'
            : r.masukSebelum === true
              ? '<div class="muted kecil" title="Token sudah masuk sebelum angka sisa ini dibaca.">sebelum catat</div>'
              : "")
        : '<span class="muted">—</span>';

      baris.push("<tr" + (r.anomali === "negatif" ? ' class="baris-anomali"' : "") + ">" +
        "<td><b>" + Core.labelTanggal(r.tanggal, false) + "</b><div class=\"muted kecil\">" + r.hari + "</div></td>" +
        '<td class="num">' + angka(r.sisa, 0) + "</td>" +
        '<td class="num">' + masukTeks + "</td>" +
        '<td class="num">' + pemakaian + " " + tanda + "</td>" +
        '<td class="num"><b>' + biaya + "</b></td>" +
        '<td class="catatan">' + esc(r.catatan || "") + "</td>" +
        '<td class="aksi">' +
          '<button class="ikon" data-ubah="' + esc(r.id) + '" title="Ubah catatan" aria-label="Ubah catatan">' + ikon("pensil") + "</button>" +
          '<button class="ikon" data-hapus="' + esc(r.id) + '" title="Hapus catatan" aria-label="Hapus catatan">' + ikon("hapus") + "</button>" +
        "</td></tr>");

      var berikut = daftar[i + 1];
      if (!berikut || Core.seninDari(berikut.tanggal) !== k) {
        var m = subtotalPekan(k);
        if (m && m.hari > 0) {
          baris.push('<tr class="baris-subtotal"><td colspan="4">Subtotal pekan ' + esc(m.label) + " (" + m.hari + " hari)</td>" +
            '<td class="num">' + fmtKwh(m.kwh) + '</td><td class="num">' + fmtRp(m.biaya) + '</td><td colspan="2"></td></tr>');
        }
      }
    });

    baris.push('<tr class="baris-total"><td colspan="4">Total ' + Core.labelBulan(key) + "</td>" +
      '<td class="num">' + fmtKwh(totalKwh) + '</td><td class="num">' + fmtRp(totalRp) + '</td><td colspan="2"></td></tr>');

    tbody.innerHTML = baris.join("");
  }

  function renderTabelBulanan(h) {
    var tbody = $("tbodyBulanan");
    var barisSemua = h.bulanan.slice().reverse(); // terbaru dulu
    // bulan kalender saat ini selalu ditampilkan (walau belum ada catatan)
    if (h.bulanAktif && !h.bulanan.some(function (b) { return b.key === h.bulanAktif; })) {
      barisSemua.unshift({
        key: h.bulanAktif,
        label: Core.labelBulan(h.bulanAktif),
        kwh: 0, biaya: 0, hari: 0, rataHarian: 0, masukKwh: 0,
        sisaAwal: null, sisaAkhir: null
      });
    }
    if (!barisSemua.length) {
      tbody.innerHTML = "";
      $("kosongBulanan").classList.remove("hidden");
      return;
    }
    $("kosongBulanan").classList.add("hidden");
    var totalKwh = 0, totalRp = 0, totalHari = 0;
    var baris = barisSemua.map(function (b) {
      totalKwh += b.kwh; totalRp += b.biaya; totalHari += b.hari;
      var kosong = b.hari === 0;
      var sisa = (b.sisaAwal === null || b.sisaAwal === undefined)
        ? '<span class="muted">—</span>'
        : angka(b.sisaAwal, 0) + " → " + angka(b.sisaEfektif !== undefined ? b.sisaEfektif : b.sisaAkhir, 0);
      return "<tr>" +
        "<td><b>" + b.label + "</b></td>" +
        '<td class="num">' + (kosong ? '<span class="muted">—</span>' : fmtKwh(b.kwh)) + "</td>" +
        '<td class="num"><b>' + (kosong ? '<span class="muted">—</span>' : fmtRp(b.biaya)) + "</b></td>" +
        '<td class="num">' + (kosong ? '<span class="muted">—</span>' : b.hari + " hari") + "</td>" +
        '<td class="num">' + (kosong ? '<span class="muted">—</span>' : angka(b.rataHarian, 2)) + "</td>" +
        '<td class="num">' + (b.masukKwh ? angka(b.masukKwh, 0) + " kWh" : '<span class="muted">—</span>') + "</td>" +
        '<td class="num">' + sisa + "</td>" +
        "</tr>";
    });
    tbody.innerHTML = baris.join("") +
      '<tr class="baris-total"><td>Total</td><td class="num">' + fmtKwh(totalKwh) + '</td><td class="num">' + fmtRp(totalRp) +
      '</td><td class="num">' + totalHari + " hari</td><td colspan=\"4\"></td></tr>";
  }

  /* ================= render utama ================= */
  function render() {
    var h = Core.hitung(state);
    var bulanAda = h.bulanan.some(function (b) { return b.key === bulanPilih; });
    if (!bulanPilih || (!bulanAda && bulanPilih !== h.bulanAktif)) bulanPilih = h.bulanAktif;
    renderHeader(h);
    kartuStatistik(h);
    isiPilihanBulan(h);
    gambarGrafik(h);
    renderInsight(h);
    renderPolaHari(h);
    renderToken(h);
    renderTabelHarian(h);
    renderTabelBulanan(h);
    renderPratinjau();
    return h;
  }

  /* ================= formulir ================= */
  function resetForm() {
    editId = null;
    $("editId").value = "";
    var hariIni = Core.tanggalSekarang();
    $("tanggal").value = hariIni;
    $("sisa").value = "";
    $("masuk").value = "";
    $("urutanToken").value = "auto";
    $("barisUrutanToken").classList.add("hidden");
    $("catatan").value = "";
    $("formTitle").textContent = "Catat Sisa Token";
    $("btnSimpan").textContent = "Simpan catatan";
    $("btnBatal").classList.add("hidden");
    var sudah = state.catatan.some(function (r) { return r.tanggal === hariIni; });
    $("hintTanggal").textContent = sudah
      ? "Catatan hari ini sudah ada — simpan angka baru untuk mengganti, atau ubah tanggalnya."
      : "Biasanya dicatat pagi di jam yang sama setiap hari.";
    renderPratinjau();
  }

  function ambilCatatanTetangga(tanggal, idAbaikan) {
    var daftar = state.catatan.filter(function (r) { return r.id !== idAbaikan; });
    var prev = null, next = null;
    daftar.forEach(function (r) {
      if (r.tanggal < tanggal && (!prev || r.tanggal > prev.tanggal)) prev = r;
      if (r.tanggal > tanggal && (!next || r.tanggal < next.tanggal)) next = r;
    });
    return { prev: prev, next: next };
  }

  function perbaruiHintTanggal() {
    var t = Core.normalTanggal($("tanggal").value);
    var sudah = !!(t && state.catatan.some(function (r) { return r.tanggal === t && r.id !== editId; }));
    $("hintTanggal").textContent = sudah
      ? "Tanggal ini sudah tercatat — menyimpan akan mengganti angka lama."
      : "Biasanya dicatat pagi di jam yang sama setiap hari.";
  }

  /** Posisi token untuk catatan yang sudah tersimpan (mendukung 'auto'). */
  function posisiTokenCatatan(rec) {
    if (!(rec.masuk > 0)) return false;
    if (rec.urutanToken === "sebelum") return true;
    if (rec.urutanToken === "sesudah") return false;
    var prev = null;
    state.catatan.forEach(function (r) {
      if (r.id === rec.id) return;
      if (r.tanggal < rec.tanggal && (!prev || r.tanggal > prev.tanggal)) prev = r;
    });
    return prev ? (rec.sisa >= prev.sisa) : false;
  }

  function renderPratinjau() {
    perbaruiHintTanggal();
    var box = $("pratinjau");
    var tanggal = $("tanggal").value;
    var sisa = Core.parseAngka($("sisa").value);
    var masuk = Core.parseAngka($("masuk").value) || 0;
    var mode = $("urutanToken").value;

    // Pilihan urutan token hanya relevan bila ada token yang diisi.
    $("barisUrutanToken").classList.toggle("hidden", !(masuk > 0));

    if (!tanggal || sisa === null || $("sisa").value === "") {
      box.className = "pratinjau";
      box.innerHTML = "Isi <b>sisa kWh</b> untuk melihat perhitungan sebelum disimpan.";
      return;
    }

    var tb = ambilCatatanTetangga(tanggal, editId);
    var harga = state.settings.hargaKwh;
    var potongan = [];

    // Tentukan urutan token (sebelum/sesudah pembacaan angka sisa)
    var posisi;
    if (mode === "sebelum") posisi = true;
    else if (mode === "sesudah") posisi = false;
    else posisi = tb.prev ? (sisa >= tb.prev.sisa) : false;

    if (masuk > 0) {
      var alasan = mode === "auto"
        ? (tb.prev
            ? (posisi
                ? "saldo naik: " + angka(sisa, 0) + " ≥ " + angka(tb.prev.sisa, 0)
                : "saldo turun: " + angka(sisa, 0) + " < " + angka(tb.prev.sisa, 0))
            : "catatan pertama")
        : "diatur manual";
      potongan.push("Token <b>+" + angka(masuk, 0) + " kWh</b> → dianggap <b>" +
        (posisi ? "SUDAH masuk sebelum angka ini dibaca" : "diisi SETELAH angka ini dibaca") +
        "</b> (" + alasan + ")" +
        (posisi ? " — ikut dipakai pada interval sebelum tanggal ini."
                : " — dihitung pada interval sesudah tanggal ini."));
    }

    if (tb.prev) {
      var tambahanPrev = ((tb.prev.masuk > 0 && !posisiTokenCatatan(tb.prev)) ? tb.prev.masuk : 0) +
        ((masuk > 0 && posisi) ? masuk : 0);
      var p = tb.prev.sisa + tambahanPrev - sisa;
      potongan.push("Pemakaian <b>" + Core.labelTanggal(tb.prev.tanggal, false) + "</b> = " +
        angka(tb.prev.sisa, 0) + (tambahanPrev ? " + " + angka(tambahanPrev, 0) : "") + " − " + angka(sisa, 0) +
        " = <b>" + fmtKwh(Math.abs(p)) + "</b> (" + fmtRp(Math.abs(p) * harga) + ")" +
        (p < 0 ? ' <span class="badge bahaya">negatif — cek angka/urutan token</span>' : ""));
    }
    if (tb.next) {
      var posisiNext;
      if (tb.next.urutanToken === "sebelum") posisiNext = true;
      else if (tb.next.urutanToken === "sesudah") posisiNext = false;
      else posisiNext = tb.next.sisa >= sisa;
      var tambahanCur = ((masuk > 0 && !posisi) ? masuk : 0) +
        ((tb.next.masuk > 0 && posisiNext) ? tb.next.masuk : 0);
      var q = sisa + tambahanCur - tb.next.sisa;
      potongan.push("Pemakaian <b>" + Core.labelTanggal(tanggal, false) + "</b> = " + angka(sisa, 0) +
        (tambahanCur ? " + " + angka(tambahanCur, 0) : "") + " − " + angka(tb.next.sisa, 0) +
        " = <b>" + fmtKwh(Math.abs(q)) + "</b> (" + fmtRp(Math.abs(q) * harga) + ")" +
        (q < 0 ? ' <span class="badge bahaya">negatif — cek angka/urutan token</span>' : ""));
    }
    if (!tb.prev && !tb.next) {
      potongan.push("Catatan pertama. Pemakaian mulai terhitung setelah ada catatan berikutnya.");
    }
    box.className = "pratinjau" + (potongan.join("").indexOf("negatif") > -1 ? " peringatan" : "");
    box.innerHTML = potongan.join("<br>");
  }

  function kirimForm(e) {
    e.preventDefault();
    var tanggal = Core.normalTanggal($("tanggal").value);
    var sisa = Core.parseAngka($("sisa").value);
    var masuk = Core.parseAngka($("masuk").value) || 0;
    var catatan = $("catatan").value.trim().slice(0, 120);
    var modeToken = $("urutanToken").value;
    var urutanToken = (masuk > 0 && (modeToken === "sebelum" || modeToken === "sesudah")) ? modeToken : "auto";

    if (!tanggal) { tampilToast("Tanggal belum diisi dengan benar.", "error"); $("tanggal").focus(); return; }
    if (sisa === null || sisa < 0) { tampilToast("Sisa kWh harus berupa angka ≥ 0.", "error"); $("sisa").focus(); return; }
    if (masuk < 0) { tampilToast("Token masuk tidak boleh negatif.", "error"); $("masuk").focus(); return; }

    var kembar = state.catatan.filter(function (r) { return r.tanggal === tanggal && r.id !== editId; })[0];

    if (editId) {
      var rec = state.catatan.filter(function (r) { return r.id === editId; })[0];
      if (!rec) { tampilToast("Catatan tidak ditemukan.", "error"); return; }
      if (kembar) {
        state.catatan = state.catatan.filter(function (r) { return r.id !== kembar.id && r.id !== editId; });
      }
      rec.tanggal = tanggal;
      rec.sisa = sisa;
      rec.masuk = masuk;
      rec.urutanToken = urutanToken;
      rec.catatan = catatan;
      state = Core.normalise(state);
      simpan();
      resetForm();
      bulanPilih = tanggal.slice(0, 7);
      render();
      tampilToast("Catatan diperbarui.", "ok");
      return;
    }

    if (kembar) {
      if (!confirm("Tanggal " + Core.labelTanggal(tanggal) + " sudah tercatat (" + angka(kembar.sisa, 0) + " kWh). Ganti dengan angka baru?")) {
        return;
      }
      kembar.sisa = sisa;
      kembar.masuk = masuk;
      kembar.urutanToken = urutanToken;
      kembar.catatan = catatan;
      state = Core.normalise(state);
      simpan();
      resetForm();
      bulanPilih = tanggal.slice(0, 7);
      render();
      tampilToast("Catatan tanggal itu diganti.", "ok");
      return;
    }

    state.catatan.push({
      id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      tanggal: tanggal, sisa: sisa, masuk: masuk, urutanToken: urutanToken, catatan: catatan
    });
    state = Core.normalise(state);
    simpan();
    resetForm();
    bulanPilih = tanggal.slice(0, 7);
    render();
    tampilToast("Catatan tersimpan: " + Core.labelTanggal(tanggal, false) + " • " + angka(sisa, 0) + " kWh.", "ok");
  }

  function ubahCatatan(id) {
    var rec = state.catatan.filter(function (r) { return r.id === id; })[0];
    if (!rec) return;
    editId = rec.id;
    $("editId").value = rec.id;
    $("tanggal").value = rec.tanggal;
    $("sisa").value = String(rec.sisa).replace(".", ",");
    $("masuk").value = rec.masuk ? String(rec.masuk).replace(".", ",") : "";
    $("urutanToken").value = (rec.urutanToken === "sebelum" || rec.urutanToken === "sesudah") ? rec.urutanToken : "auto";
    $("catatan").value = rec.catatan || "";
    $("formTitle").textContent = "Ubah Catatan";
    $("btnSimpan").textContent = "Simpan perubahan";
    $("btnBatal").classList.remove("hidden");
    renderPratinjau();
    $("sisa").focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function hapusCatatan(id) {
    var rec = state.catatan.filter(function (r) { return r.id === id; })[0];
    if (!rec) return;
    if (!confirm("Hapus catatan " + Core.labelTanggal(rec.tanggal) + " (" + angka(rec.sisa, 0) + " kWh)?")) return;
    state.catatan = state.catatan.filter(function (r) { return r.id !== id; });
    state = Core.normalise(state);
    if (editId === id) resetForm();
    simpan();
    render();
    undoHapus = rec;
    tampilToast("Catatan dihapus.", "ok", {
      label: "Urungkan",
      jalankan: function () {
        if (!undoHapus) return;
        state.catatan.push(undoHapus);
        state = Core.normalise(state);
        simpan();
        render();
        tampilToast("Catatan dikembalikan.", "ok");
      }
    });
  }

  /* ================= pengaturan ================= */
  function bukaPengaturan() {
    var s = state.settings;
    $("setNama").value = s.nama || "";
    $("setHarga").value = s.hargaKwh;
    $("setTarif").value = s.tarifDasar;
    $("setPpj").value = s.ppj;
    $("setJam").value = s.jamCatat || "09:00";
    hitungHargaEfektif();
    bukaModal("modalPengaturan");
  }
  function hitungHargaEfektif() {
    var tarif = Core.parseAngka($("setTarif").value) || 0;
    var ppj = Core.parseAngka($("setPpj").value) || 0;
    var hasil = tarif * (1 + ppj / 100);
    $("hargaEfektif").textContent = hasil > 0 ? fmtRp(hasil) + "/kWh" : "—";
    return hasil;
  }
  function pakaiHargaEfektif() {
    var v = hitungHargaEfektif();
    if (v > 0) { $("setHarga").value = Math.round(v * 100) / 100; tampilToast("Harga per kWh diisi dari tarif dasar + PPJ.", "ok"); }
  }
  function simpanPengaturan() {
    var nama = $("setNama").value.trim() || "Rumah";
    var harga = Core.parseAngka($("setHarga").value);
    var tarif = Core.parseAngka($("setTarif").value) || 0;
    var ppj = Core.parseAngka($("setPpj").value) || 0;
    if (harga === null || harga <= 0) { tampilToast("Harga per kWh harus lebih dari 0.", "error"); return; }
    if (ppj < 0 || ppj > 30) { tampilToast("PPJ harus 0–30%.", "error"); return; }
    state.settings = {
      nama: nama, hargaKwh: harga, tarifDasar: tarif, ppj: ppj,
      jamCatat: $("setJam").value || "09:00"
    };
    state = Core.normalise(state);
    simpan();
    tutupModal("modalPengaturan");
    render();
    tampilToast("Pengaturan disimpan.", "ok");
  }
  function hapusSemua() {
    if (!state.catatan.length) { tampilToast("Data sudah kosong."); return; }
    if (!confirm("Hapus SEMUA catatan (" + state.catatan.length + " baris)? Sebaiknya ekspor JSON dulu sebagai cadangan.")) return;
    state.catatan = [];
    state = Core.normalise(state);
    simpan();
    resetForm();
    tutupModal("modalPengaturan");
    render();
    tampilToast("Semua catatan dihapus.");
  }
  function muatDataBawaan() {
    if (!window.DATA_OKTOBER_2026) { tampilToast("Data bawaan tidak tersedia.", "error"); return; }
    if (!confirm("Muat ulang data Oktober 2026 (31 catatan)? Catatan dengan tanggal yang sama akan diganti.")) return;
    var baru = Core.normalise(window.DATA_OKTOBER_2026);
    baru.catatan.forEach(function (r) { r.id = "bawaan-" + r.tanggal; });
    var peta = {};
    state.catatan.forEach(function (r) { peta[r.tanggal] = r; });
    baru.catatan.forEach(function (r) { peta[r.tanggal] = r; });
    state.catatan = Object.keys(peta).map(function (k) { return peta[k]; });
    state = Core.normalise(state);
    simpan();
    tutupModal("modalPengaturan");
    render();
    tampilToast("Data Oktober 2026 dimuat.", "ok");
  }

  /* ================= modal ================= */
  function bukaModal(id) { $(id).classList.remove("hidden"); }
  function tutupModal(id) { $(id).classList.add("hidden"); }
  function tutupSemuaModal() {
    ["modalPengaturan", "modalImpor", "modalEkspor"].forEach(function (id) { $(id).classList.add("hidden"); });
  }

  /* ================= impor ================= */
  function bukaImpor() {
    barisImpor = [];
    fileImpor = null;
    $("fileImpor").value = "";
    $("pratinjauImpor").className = "pratinjau";
    $("pratinjauImpor").textContent = "Belum ada berkas dipilih.";
    $("btnImporJalankan").disabled = true;
    bukaModal("modalImpor");
  }
  function bacaBerkas(file) {
    var pembaca = new FileReader();
    pembaca.onload = function () {
      var teks = String(pembaca.result || "");
      barisImpor = [];
      try {
        if (/\.json$/i.test(file.name)) {
          var obj = JSON.parse(teks);
          var arr = Array.isArray(obj) ? obj : (obj && obj.catatan) || [];
          barisImpor = Core.normalise({ settings: (obj && obj.settings) || state.settings, catatan: arr }).catatan;
          if (obj && obj.settings) {
            state.settings = Core.normalise({ settings: obj.settings }).settings;
          }
        } else {
          barisImpor = Core.parseCsv(teks);
        }
      } catch (err) {
        barisImpor = [];
      }
      var box = $("pratinjauImpor");
      if (!barisImpor.length) {
        box.className = "pratinjau peringatan";
        box.innerHTML = "Tidak ada baris valid. Format yang benar: <code>tanggal,sisa,masuk,catatan</code><br>" +
          "Contoh: <code>2026-11-02,1200,0,pagi</code>";
        $("btnImporJalankan").disabled = true;
        return;
      }
      box.className = "pratinjau";
      box.innerHTML = "Terbaca <b>" + barisImpor.length + " baris</b>: " +
        barisImpor.slice(0, 3).map(function (r) {
          return Core.labelTanggal(r.tanggal) + " → " + angka(r.sisa, 0) + " kWh";
        }).join(" • ") + (barisImpor.length > 3 ? " • …" : "");
      $("btnImporJalankan").disabled = false;
    };
    pembaca.onerror = function () { tampilToast("Gagal membaca berkas.", "error"); };
    pembaca.readAsText(file, "UTF-8");
  }
  function jalankanImpor() {
    if (!barisImpor.length) return;
    var timpa = $("imporTimpa").checked;
    var peta = {};
    state.catatan.forEach(function (r) { peta[r.tanggal] = r; });
    var masuk = 0, lewat = 0;
    barisImpor.forEach(function (r) {
      if (peta[r.tanggal]) {
        if (!timpa) { lewat++; return; }
        peta[r.tanggal].sisa = r.sisa;
        peta[r.tanggal].masuk = r.masuk;
        peta[r.tanggal].urutanToken = r.urutanToken || "auto";
        if (r.catatan) peta[r.tanggal].catatan = r.catatan;
        masuk++;
      } else {
        peta[r.tanggal] = {
          id: "impor-" + r.tanggal + "-" + Math.random().toString(36).slice(2, 5),
          tanggal: r.tanggal, sisa: r.sisa, masuk: r.masuk,
          urutanToken: r.urutanToken || "auto", catatan: r.catatan || ""
        };
        masuk++;
      }
    });
    state.catatan = Object.keys(peta).map(function (k) { return peta[k]; });
    state = Core.normalise(state);
    simpan();
    tutupModal("modalImpor");
    render();
    tampilToast(masuk + " catatan diimpor" + (lewat ? ", " + lewat + " dilewati (tanggal sudah ada)" : "") + ".", "ok");
  }

  /* ================= ekspor ================= */
  function eksporCsv() {
    var csv = Core.toCsv(state.catatan);
    unduh("catatan-listrik-" + stempel() + ".csv", "text/csv", "\uFEFF" + csv);
    tutupModal("modalEkspor");
    tampilToast("CSV diunduh.", "ok");
  }
  function eksporJson() {
    unduh("backup-listrik-" + stempel() + ".json", "application/json", JSON.stringify(state, null, 2));
    tutupModal("modalEkspor");
    tampilToast("Backup JSON diunduh.", "ok");
  }

  /* ================= laporan cetak ================= */
  function buatLaporan() {
    var h = Core.hitung(state);
    var key = bulanPilih || h.bulanAktif;
    if (!key) { tampilToast("Belum ada data untuk dilaporkan."); return false; }
    var bulan = bulanDariCatatan(h, key);
    var daftar = catatanBulan(h, key);
    var r = h.ringkasan;
    if (!daftar.length || !bulan) {
      tampilToast("Belum ada catatan pada " + Core.labelBulan(key) + " untuk dilaporkan.", "info");
      return false;
    }

    var mingguLaporan = [];
    daftar.forEach(function (rec) {
      var k = Core.seninDari(rec.tanggal);
      var blok = mingguLaporan[mingguLaporan.length - 1];
      if (!blok || blok.key !== k) {
        blok = { key: k, label: Core.labelMinggu(k), kwh: 0, biaya: 0, hari: 0 };
        mingguLaporan.push(blok);
      }
      if (rec.pemakaian !== null) { blok.kwh += rec.pemakaian; blok.biaya += rec.biaya; blok.hari += 1; }
    });

    var baris = "";
    daftar.forEach(function (rec, i) {
      var k = Core.seninDari(rec.tanggal);
      baris += "<tr><td>" + Core.labelTanggal(rec.tanggal, false) + "</td><td>" + rec.hari + "</td><td>" + angka(rec.sisa, 0) +
        "</td><td>" + (rec.masuk ? "+" + angka(rec.masuk, 0) : "—") + "</td><td>" + (rec.pemakaian === null ? "—" : angka(rec.pemakaian, 1)) +
        "</td><td>" + (rec.biaya === null ? "—" : fmtRp(rec.biaya)) + "</td></tr>";

      var berikut = daftar[i + 1];
      if (!berikut || Core.seninDari(berikut.tanggal) !== k) {
        var blok = mingguLaporan.filter(function (b) { return b.key === k; })[0];
        if (blok && blok.hari > 0) {
          baris += '<tr class="subtotal"><td colspan="4">Subtotal pekan ' + esc(blok.label) + " (" + blok.hari + " hari)</td><td>" +
            angka(blok.kwh, 1) + "</td><td>" + fmtRp(blok.biaya) + "</td></tr>";
        }
      }
    });

    var perHari = Core.NAMA_HARI.map(function (n) {
      var p = r.perHari[n];
      return "<tr><td>" + n + "</td><td>" + p.hari + " hari</td><td>" + (p.hari ? angka(p.rata, 2) : "—") +
        "</td><td>" + (p.hari ? angka(p.kwh, 1) : "—") + "</td></tr>";
    }).join("");

    var cap = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

    $("laporanCetak").innerHTML =
      '<div class="lap">' +
        '<div class="lap-kepala"><div><div class="lap-judul">Laporan Pemakaian Listrik</div>' +
        '<div class="lap-sub">' + esc(h.settings.nama) + " • " + Core.labelBulan(key) + "</div></div>" +
        '<div class="lap-tanggal">Dicetak ' + cap + "<br>Tarif " + fmtRp(h.settings.hargaKwh) + "/kWh</div></div>" +
        '<div class="lap-kartu">' +
          '<div><span>Pemakaian bulan ini</span><b>' + angka(bulan.kwh, 1) + " kWh</b></div>" +
          '<div><span>Total biaya</span><b>' + fmtRp(bulan.biaya) + "</b></div>" +
          '<div><span>Rata-rata harian</span><b>' + angka(bulan.rataHarian, 2) + " kWh</b></div>" +
          '<div><span>Sisa token</span><b>' + angka(r.sisaAkhir, 0) + " kWh</b></div>" +
        "</div>" +
        '<h3>Catatan harian ' + Core.labelBulan(key) + "</h3>" +
        '<table class="lap-tabel"><thead><tr><th>Tanggal</th><th>Hari</th><th>Sisa kWh</th><th>Token masuk</th><th>Pemakaian kWh</th><th>Biaya</th></tr></thead>' +
        "<tbody>" + baris +
        '<tr class="total"><td colspan="4">TOTAL</td><td>' + angka(bulan.kwh, 1) + "</td><td>" + fmtRp(bulan.biaya) + "</td></tr>" +
        "</tbody></table>" +
        '<h3>Rata-rata per hari</h3>' +
        '<table class="lap-tabel"><thead><tr><th>Hari</th><th>Jumlah hari</th><th>Rata-rata kWh</th><th>Total kWh</th></tr></thead>' +
        "<tbody>" + perHari + "</tbody></table>" +
        '<h3>Catatan otomatis</h3><ul class="lap-insight">' +
        h.insight.map(function (i) { return "<li>" + esc(i.teks) + "</li>"; }).join("") +
        "</ul>" +
        '<div class="lap-kaki">Metode hitung: pemakaian hari ini = sisa kWh hari ini + token masuk − sisa kWh pembacaan berikutnya. ' +
        "Pembacaan dilakukan harian pada jam " + esc(h.settings.jamCatat || "09:00") + ".</div>" +
      "</div>";
    return true;
  }
  function cetakLaporan() {
    if (!buatLaporan()) return;
    tutupModal("modalEkspor");
    setTimeout(function () { window.print(); }, 150);
  }

  /* ================= kalkulator token ================= */
  /** Format angka ribuan gaya Indonesia: 200000 -> "200.000". */
  function formatRibuan(nilai) {
    var angka = String(nilai === null || nilai === undefined ? "" : nilai).replace(/\D/g, "");
    if (!angka) return "";
    angka = angka.replace(/^0+(?=\d)/, ""); // buang nol di depan berlebih
    return angka.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  /** Tulis ulang isi kolom kalkulator dengan titik ribuan, sambil menjaga posisi kursor. */
  function formatKalkulatorToken() {
    var el = $("kalkToken");
    var sebelum = el.value;
    var posisiLama = typeof el.selectionStart === "number" ? el.selectionStart : sebelum.length;
    var digitSebelum = sebelum.slice(0, posisiLama).replace(/\D/g, "").length;
    var baru = formatRibuan(sebelum);
    if (baru !== sebelum) {
      el.value = baru;
      var digit = 0;
      var posBaru = 0;
      for (var i = 0; i < baru.length; i++) {
        if (/\d/.test(baru[i])) digit++;
        posBaru = i + 1;
        if (digit === digitSebelum) break;
      }
      if (digitSebelum === 0) posBaru = 0;
      try { el.setSelectionRange(posBaru, posBaru); } catch (e) { /* abaikan */ }
    }
    hitungKalkulatorToken();
  }

  function hitungKalkulatorToken() {
    var rp = Core.parseAngka($("kalkToken").value);
    var harga = state.settings.hargaKwh || 1;
    if (rp === null || rp <= 0) { $("kalkHasil").textContent = "—"; return; }
    var kWh = rp / harga;
    var hari = state.catatan.length > 1 ? kWh / (Core.hitung(state).ringkasan.rata14 || 1) : null;
    $("kalkHasil").innerHTML = angka(kWh, 1) + " kWh" + (hari ? " ≈ " + angka(hari, 0) + " hari" : "");
  }

  /* ================= event ================= */
  function pasangEvent() {
    $("form").addEventListener("submit", kirimForm);
    ["tanggal", "sisa", "masuk"].forEach(function (id) {
      $(id).addEventListener("input", renderPratinjau);
      $(id).addEventListener("change", renderPratinjau);
    });
    $("urutanToken").addEventListener("change", renderPratinjau);
    $("btnBatal").addEventListener("click", function () { resetForm(); });

    $("tbodyHarian").addEventListener("click", function (e) {
      var t = e.target.closest("button");
      if (!t) return;
      if (t.dataset.ubah) ubahCatatan(t.dataset.ubah);
      else if (t.dataset.hapus) hapusCatatan(t.dataset.hapus);
    });

    $("pilihBulan").addEventListener("change", function () {
      bulanPilih = this.value;
      render();
    });

    $("segMode").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      modeGrafik = b.dataset.mode;
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle("on", x === b); });
      gambarGrafik(Core.hitung(state));
    });
    $("segMetrik").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      metrikGrafik = b.dataset.metrik;
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle("on", x === b); });
      gambarGrafik(Core.hitung(state));
    });

    $("tabs").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      tabAktif = b.dataset.tab;
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle("on", x === b); });
      $("tab-harian").classList.toggle("hidden", tabAktif !== "harian");
      $("tab-bulanan").classList.toggle("hidden", tabAktif !== "bulanan");
    });

    $("btnTema").addEventListener("click", function () {
      pasangTema(document.documentElement.getAttribute("data-tema") === "gelap" ? "terang" : "gelap");
      gambarGrafik(Core.hitung(state));
    });
    $("btnPengaturan").addEventListener("click", bukaPengaturan);
    $("btnSimpanPengaturan").addEventListener("click", simpanPengaturan);
    $("btnHapusSemua").addEventListener("click", hapusSemua);
    $("btnMuatBawaan").addEventListener("click", muatDataBawaan);
    $("btnPakaiHarga").addEventListener("click", pakaiHargaEfektif);
    $("setTarif").addEventListener("input", hitungHargaEfektif);
    $("setPpj").addEventListener("input", hitungHargaEfektif);

    $("btnImpor").addEventListener("click", bukaImpor);
    $("fileImpor").addEventListener("change", function () {
      if (this.files && this.files[0]) { fileImpor = this.files[0]; bacaBerkas(this.files[0]); }
    });
    $("btnImporJalankan").addEventListener("click", jalankanImpor);

    $("btnEkspor").addEventListener("click", function () { bukaModal("modalEkspor"); });
    $("btnCsv").addEventListener("click", eksporCsv);
    $("btnJson").addEventListener("click", eksporJson);
    $("btnCetak").addEventListener("click", cetakLaporan);

    $("kalkToken").addEventListener("input", formatKalkulatorToken);

    document.querySelectorAll("[data-tutup]").forEach(function (b) {
      b.addEventListener("click", function () { tutupModal(b.dataset.tutup); });
    });
    document.querySelectorAll(".backdrop").forEach(function (b) {
      b.addEventListener("click", function (e) { if (e.target === b) b.classList.add("hidden"); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") tutupSemuaModal();
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        var f = $("form");
        if (f) f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });

    var tundaUkur = null;
    window.addEventListener("resize", function () {
      clearTimeout(tundaUkur);
      tundaUkur = setTimeout(function () { gambarGrafik(Core.hitung(state)); }, 160);
    });
  }

  /* ================= mulai ================= */
  function mulai() {
    muatTema();
    muatData();
    pasangEvent();
    resetForm();
    render();
    hitungKalkulatorToken();
    infoPenyimpanan();
    if (!adaPenyimpanan) {
      $("banner").classList.remove("hidden");
      $("banner").innerHTML = "<b>Penyimpanan browser tidak aktif.</b> Catatan tetap bisa dipakai, tapi tidak tersimpan otomatis. " +
        "Gunakan <b>Ekspor → JSON backup</b> secara berkala.";
    }
  }

  /* ================= kait untuk halaman Backup & Restore ================= */
  window.AplikasiListrik = {
    ambilState: function () { return JSON.parse(JSON.stringify(state)); },
    terapkanState: function (data) {
      state = Core.normalise(data);
      simpan();
      resetForm();
      render();
    },
    segarkan: function () { render(); },
    toast: function (teks, jenis) { tampilToast(teks, jenis); }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mulai);
  else mulai();
})();
