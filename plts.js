/*
 * plts.js — halaman "PLTS (Solar)".
 * Menampilkan data realtime SolaxCloud (SOC baterai, daya PV, baterai, grid, status off-grid)
 * lewat helper lokal, plus korelasi hari "PLTS off-grid" dengan pemakaian PLN.
 */
(function () {
  "use strict";

  var URL_HELPER = (function () {
    try { return localStorage.getItem("kwh-backup-url") || "http://127.0.0.1:8787"; }
    catch (e) { return "http://127.0.0.1:8787"; }
  })();

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var angka = function (n, d) { return window.KwhCore ? window.KwhCore.angka(n, d) : String(n); };
  var rp = function (n) { return window.KwhCore ? window.KwhCore.rp(n) : "Rp " + n; };
  var kwh = function (n) { return window.KwhCore ? window.KwhCore.kwh(n) : n + " kWh"; };

  var keadaan = { halaman: false, timer: null, data: null, terkonfigurasi: null };

  function panggil(jalur, opsi) {
    opsi = opsi || {};
    var kontrol = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (kontrol) kontrol.abort(); }, (opsi.batasDetik || 30) * 1000);
    var opsiFetch = { method: opsi.metode || "GET", headers: {}, signal: kontrol ? kontrol.signal : undefined };
    if (opsi.body !== undefined) {
      opsiFetch.headers["Content-Type"] = "application/json";
      opsiFetch.body = JSON.stringify(opsi.body);
    }
    return fetch(URL_HELPER + jalur, opsiFetch)
      .then(function (r) {
        clearTimeout(timer);
        return r.text().then(function (teks) {
          var data = null;
          try { data = teks ? JSON.parse(teks) : null; } catch (e) { data = { ok: false, galat: "Jawaban helper tidak valid" }; }
          if (!r.ok && data && !data.galat) data.galat = "HTTP " + r.status;
          return data;
        });
      })
      .catch(function (e) {
        clearTimeout(timer);
        if (e && e.name === "AbortError") return { ok: false, galat: "Helper tidak merespons (timeout)" };
        return { ok: false, galat: "Tidak bisa menghubungi helper backup", offline: true };
      });
  }

  function tampilkanOffline(tampil) {
    $("pltsOffline").classList.toggle("hidden", !tampil);
  }

  function mulaiAuto() {
    hentikanAuto();
    if (!keadaan.halaman) return;
    if (!$("pltsAuto").checked) return;
    keadaan.timer = setInterval(function () {
      if (keadaan.halaman && $("pltsAuto").checked) muat();
    }, 60000);
  }
  function hentikanAuto() {
    if (keadaan.timer) { clearInterval(keadaan.timer); keadaan.timer = null; }
  }

  /* ---------------- status ---------------- */
  function watt(nilai) {
    if (nilai === null || nilai === undefined) return "—";
    var w = Number(nilai);
    if (!isFinite(w)) return "—";
    if (Math.abs(w) >= 1000) return angka(w / 1000, 2) + " kW";
    return angka(w, 0) + " W";
  }

  function renderBelum(konfig) {
    var oauth = konfig && konfig.mode === "oauth";
    var html = '<div class="plts-onboarding">' +
      "<b>Belum tersambung ke SolaxCloud.</b>" +
      "<p>Pilih <b>Cara koneksi</b> di panel Konfigurasi:</p>" +
      '<ul class="plts-tips">' +
      "<li><b>TokenId</b> — akun installer/distributor: token dari menu Service → API, plus WiFi SN inverter.</li>" +
      "<li><b>Developer Portal</b> — akun SolaxCloud biasa: buat aplikasi di developer.solaxcloud.com, lalu isi Client ID + Client Secret." +
      (oauth ? " Mode Developer Portal sedang dipilih." : "") + "</li>" +
      "<li>Setelah tersambung, halaman ini menampilkan SOC baterai, daya PV, daya baterai, dan status off-grid.</li>" +
      "<li>Kalau belum ada akses API: pakai penanda manual “PLTS off-grid” di catatan harian.</li>" +
      "</ul></div>";
    $("pltsStatus").innerHTML = html;
    if (window.EnergyFlowRender && $("pltsStatusEnergyFlow")) window.EnergyFlowRender($("pltsStatusEnergyFlow"), null);
    $("pltsWaktu").textContent = "";
  }

  function renderGalat(pesan) {
    $("pltsStatus").innerHTML = '<div class="plts-galat"><b>Tidak bisa mengambil data SolaxCloud.</b><p>' +
      esc(pesan || "kesalahan tidak diketahui") + "</p></div>";
    if (window.EnergyFlowRender && $("pltsStatusEnergyFlow")) window.EnergyFlowRender($("pltsStatusEnergyFlow"), null);
    $("pltsWaktu").textContent = "";
  }

  /** Ikon garis untuk diagram aliran energi (tanpa gambar eksternal). */
  function ikonFlow(nama) {
    var ikon = {
      pv: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="35" cy="13" r="4"/><path d="M35 4v3M35 19v3M26 13h3M41 13h3"/>' +
        '<rect x="5" y="24" width="29" height="15" rx="2"/><path d="M5 31h29M20 24v15M6 39l-3 4M33 39l3 4"/></svg>',
      baterai: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="6" y="10" width="30" height="28" rx="5"/><path d="M16 6h7v4h-7z"/>' +
        '<path d="M12 20h16M12 26h16M12 32h10"/></svg>',
      grid: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M9 41 L24 7 L39 41 M16 28h16 M12 35h24 M24 7V3 M18 9h12"/></svg>',
      beban: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M5 25 L24 8 L43 25"/><path d="M10 23v18h28V23"/><rect x="19" y="31" width="10" height="10"/></svg>',
      inverter: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="7" y="7" width="34" height="34" rx="7"/><circle cx="24" cy="24" r="6"/>' +
        '<path d="M24 11v4M24 33v4M12 24h4M32 24h4"/></svg>'
    };
    return ikon[nama] || "";
  }

  /** Waktu data inverter: dari "2026-11-15 15:12:14" menjadi "15-11-2026 15:12:14". */
  function formatWaktuUpload(teks) {
    if (!teks) return "—";
    var s = String(teks).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})([ T](\d{2}:\d{2}(?::\d{2})?))?/.exec(s);
    if (m) return m[3] + "-" + m[2] + "-" + m[1] + (m[5] ? " " + m[5] : "");
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      var dua = function (n) { return (n < 10 ? "0" : "") + n; };
      return dua(d.getDate()) + "-" + dua(d.getMonth() + 1) + "-" + d.getFullYear() +
        " " + dua(d.getHours()) + ":" + dua(d.getMinutes()) + ":" + dua(d.getSeconds());
    }
    return s;
  }

  function renderStatus(d) {
    var tone = d.offGrid ? "bahaya" : d.socRendah ? "waspada" : "normal";
    var soc = d.socPct;
    var socTeks = soc === null || soc === undefined ? "—" : angka(soc, 0) + "%";
    var lebar = soc === null || soc === undefined ? 0 : Math.max(0, Math.min(100, soc));
    var gridNilai = d.feedinpowerW === null || d.feedinpowerW === undefined ? "—" : wattTeks(Math.abs(d.feedinpowerW));
    var gridSub = d.feedinpowerW === null || d.feedinpowerW === undefined ? "tidak tersedia"
      : d.feedinpowerW > 0 ? "Ekspor ke PLN" : d.feedinpowerW < 0 ? "Impor dari PLN" : "idle";
    var bateraiNilai = d.batPowerW === null || d.batPowerW === undefined ? "—" : wattTeks(Math.abs(d.batPowerW));
    var bateraiSub = d.batPowerW === null || d.batPowerW === undefined ? "tidak tersedia"
      : d.batPowerW > 0 ? "mengisi" : d.batPowerW < 0 ? "mengosongkan" : "idle";
    var bebanNilai = d.bebanW === null || d.bebanW === undefined ? "—" : wattTeks(d.bebanW);
    var pvNilai = d.pvW === null || d.pvW === undefined ? "—" : wattTeks(d.pvW);
    var gridVoltTeks = d.gridVoltageV !== null && d.gridVoltageV !== undefined ? angka(d.gridVoltageV, 1) + " V" : gridNilai;
    var gridTeks = d.gridFrequencyHz !== null && d.gridFrequencyHz !== undefined
      ? angka(d.gridFrequencyHz, 0) + " Hz" : gridVoltTeks;
    var suhuTeks = d.temperatureC !== null && d.temperatureC !== undefined ? angka(d.temperatureC, 0) + "°C" : "—°C";
    var gridDayaTeks = d.feedinpowerW === null || d.feedinpowerW === undefined ? "—" : wattTeks(Math.abs(d.feedinpowerW));
    // Sistem ini memang off-grid secara normal.
    var modeLabel = "Normal Off-grid";
    var statusUtama = "PLTS Normal Off-grid";
    var hasil = d.yieldTodayKwh === null || d.yieldTodayKwh === undefined ? "—" : angka(d.yieldTodayKwh, 2) + " kWh";
    var ac = d.acpowerW === null || d.acpowerW === undefined ? "—" : wattTeks(d.acpowerW);
    var statusInvTeks = d.inverterStatusTeks || "Normal";
    var socDetailTeks = soc === null || soc === undefined ? "—" : angka(soc, 1) + "%";
    var kwhRingkas = function (v) { return v === null || v === undefined ? "—" : angka(v, 2) + " kWh"; };
    var chargedTeks = kwhRingkas(d.dailyChargedKwh);
    var dischargedTeks = kwhRingkas(d.dailyDischargedKwh);
    var remainingTeks = kwhRingkas(d.batteryRemainingKwh);
    var statusBateraiInggris = d.batPowerW === null || d.batPowerW === undefined ? "—"
      : d.batPowerW > 0 ? "Charging" : d.batPowerW < 0 ? "Discharging" : "Idle";
    var estHariTeks = "—";
    try {
      if (d.batteryRemainingKwh !== null && d.batteryRemainingKwh !== undefined &&
          window.AplikasiListrik && window.KwhCore) {
        var ringkas = window.KwhCore.hitung(window.AplikasiListrik.ambilState());
        var rataHarian = ringkas && ringkas.ringkasan ? ringkas.ringkasan.rata14 : null;
        if ((!rataHarian || rataHarian <= 0) && d.dailyDischargedKwh) rataHarian = d.dailyDischargedKwh;
        if (rataHarian > 0) estHariTeks = angka(d.batteryRemainingKwh / rataHarian, 2) + " hari";
      }
    } catch (e) { estHariTeks = "—"; }

    var html = '<div class="plts-status ' + tone + '">' +
      '<div class="plts-status-kepala"><span class="plts-titik"></span><b>' + esc(statusUtama) + "</b>" +
        '<span class="plts-live">realtime</span></div>' +
      (d.peringatan ? '<div class="plts-peringatan">' + esc(d.peringatan) + "</div>" : "") +
      '<div class="plts-hasil-card"><span>Hasil hari ini</span><b>' + esc(hasil) + "</b></div>" +

      '<div id="pltsStatusEnergyFlow" class="plts-status-eflow" data-ikon-solar="assets/solar-panel-baru-trim.webp"></div>' +
      '<div class="plts-mini-stats">' +
        '<div><span>AC output</span><b>' + esc(ac) + "</b></div>" +
        '<div><span>SOC baterai</span><b>' + esc(socTeks) + "</b></div>" +
        '<div><span>Status inverter</span><b>' + esc(statusInvTeks) + "</b></div>" +
        '<div><span>Data inverter</span><b>' + esc(formatWaktuUpload(d.uploadTime)) + "</b></div>" +
      "</div>" +

      '<div class="plts-bat-detail">' +
        '<div class="plts-bat-soc">' +
          '<div class="plts-bat-ikon">' + ikonFlow("baterai") + '</div>' +
          '<div class="plts-bat-soc-teks"><span>Battery SOC</span><b>' + esc(socDetailTeks) + '</b>' +
            '<small class="' + (d.batPowerW > 0 ? "isi" : d.batPowerW < 0 ? "keluar" : "") + '">' +
              esc(statusBateraiInggris) + (d.batPowerW !== null && d.batPowerW !== undefined ? " • " + esc(wattTeks(Math.abs(d.batPowerW))) : "") +
            '</small></div>' +
        '</div>' +
        '<div class="plts-bat-stats">' +
          '<div><span>Charged Today</span><b>' + esc(chargedTeks) + '</b></div>' +
          '<div><span>Discharged Today</span><b>' + esc(dischargedTeks) + '</b></div>' +
          '<div><span>Remaining energy</span><b>' + esc(remainingTeks) + '</b></div>' +
          '<div><span>Estimated remaining</span><b>' + esc(estHariTeks) + '</b></div>' +
        '</div>' +
      '</div>' +

      '<div class="plts-meta">Sumber: ' + (d.mode === "oauth" ? "Developer Portal (OAuth)" : "API TokenId") +
      (d.plantName ? " • " + esc(d.plantName) : "") +
      (d.wifiSn ? " • SN " + esc(d.wifiSn) : "") + "</div>" +
      (d.batPowerW !== null && d.batPowerW !== undefined
        ? '<div class="plts-meta">Daya baterai (batPower): positif = mengisi baterai, negatif = mengosongkan. Beban rumah dihitung dari PV + impor grid − daya baterai.</div>'
        : "") +
      "</div>";

    $("pltsStatus").innerHTML = html;
    if (window.EnergyFlowRender && $("pltsStatusEnergyFlow")) window.EnergyFlowRender($("pltsStatusEnergyFlow"), d);
    $("pltsWaktu").textContent = "Diperbarui: " + new Date().toLocaleTimeString("id-ID");
  }

  /** W dalam kW dengan 2 desimal; <1 kW tetap ditampilkan kW agar seragam. */
  function kw(nilai) {
    if (nilai === null || nilai === undefined) return "—";
    var w = Number(nilai);
    if (!isFinite(w)) return "—";
    return angka(w / 1000, 2) + " kW";
  }

  /** Daya selalu dalam Watt; ribuan memakai titik (mis. 1.220 W). */
  function wattTeks(nilai) {
    if (nilai === null || nilai === undefined) return "—";
    var w = Number(nilai);
    if (!isFinite(w)) return "—";
    return angka(Math.round(w), 0) + " W";
  }

  /**
   * Tombol penanda manual (tanpa API): hari ini dan kemarin.
   * "Kemarin" penting karena biasanya baru sadar baterai habis keesokan paginya.
   */
  function renderTombolTag() {
    var app = window.AplikasiListrik;
    var Core = window.KwhCore;
    var box = $("pltsTagBox");
    if (!box || !app || !Core) return;

    var hariIni = Core.tanggalSekarang();
    var kemarin = Core.tambahHari(hariIni, -1);
    var s = app.ambilState();
    var peta = {};
    s.catatan.forEach(function (r) { peta[r.tanggal] = r; });

    var bagian = [];
    [hariIni, kemarin].forEach(function (tgl) {
      var rec = peta[tgl];
      var label = Core.labelTanggal(tgl, false);
      if (!rec) {
        bagian.push('<span class="muted kecil">' +
          (tgl === hariIni ? "Catat sisa kWh hari ini dulu untuk menandai hari ini."
            : "Catatan kemarin tidak ada.") + "</span>");
      } else if (rec.pltsOff) {
        bagian.push('<span class="chip naik">' + esc(label) + " ditandai PLTS off-grid</span>" +
          '<button type="button" class="ghost kecil" data-tag-tanggal="' + esc(tgl) + '" data-tag-nilai="0">Hapus tanda</button>');
      } else {
        bagian.push('<button type="button" class="ghost kecil" data-tag-tanggal="' + esc(tgl) + '" data-tag-nilai="1">' +
          (tgl === hariIni ? "Tandai hari ini (" + esc(label) + ") PLTS off-grid"
            : "Tandai kemarin (" + esc(label) + ") PLTS off-grid") + "</button>");
      }
    });

    box.innerHTML = bagian.join("");
    Array.prototype.forEach.call(box.querySelectorAll("button[data-tag-tanggal]"), function (b) {
      b.addEventListener("click", function () {
        setTagTanggal(b.getAttribute("data-tag-tanggal"), b.getAttribute("data-tag-nilai") === "1");
      });
    });
  }

  function setTagTanggal(tanggal, nilai) {
    var app = window.AplikasiListrik;
    var Core = window.KwhCore;
    var s = app.ambilState();
    var rec = s.catatan.filter(function (r) { return r.tanggal === tanggal; })[0];
    if (!rec) { app.toast("Catatan untuk tanggal itu tidak ada.", "error"); return; }
    rec.pltsOff = !!nilai;
    app.terapkanState(s);
    app.toast(Core.labelTanggal(tanggal, false) + (nilai ? " ditandai PLTS off-grid." : " — tanda PLTS off-grid dihapus."), "ok");
    renderTombolTag();
    renderKorelasi();
  }

  /* ---------------- konfigurasi ---------------- */
  function aturModeTampil() {
    var oauth = $("pltsMode").value === "oauth";
    $("pltsModeToken").classList.toggle("hidden", oauth);
    $("pltsModeOauth").classList.toggle("hidden", !oauth);
  }

  function isiKonfigurasi(k) {
    if (!k) return;
    var mode = k.mode === "oauth" ? "oauth" : "token";
    $("pltsMode").value = mode;
    aturModeTampil();
    $("pltsSn").value = k.wifiSn || "";
    $("pltsUrl").value = k.url || "https://www.solaxcloud.com";
    $("pltsAmbang").value = k.ambangSoc === undefined || k.ambangSoc === null ? 20 : k.ambangSoc;
    $("pltsToken").placeholder = k.tokenTerisi ? "•••••• (tersimpan — kosongkan bila tidak diubah)" : "tempel TokenId dari menu Service → API";
    $("pltsClientId").value = k.clientId || "";
    $("pltsRegion").value = k.region || "eu";
    $("pltsPlantId").value = k.plantId || "";
    $("pltsClientSecret").placeholder = k.clientSecretTerisi ? "•••••• (tersimpan — kosongkan bila tidak diubah)" : "Client Secret dari Developer Portal";
  }

  function pesan(teks, jenis) {
    var el = $("pltsPesan");
    el.textContent = teks || "";
    el.className = "hint " + (jenis || "");
  }

  function simpanKonfigurasi() {
    var mode = $("pltsMode").value === "oauth" ? "oauth" : "token";
    var body = { mode: mode, ambangSoc: Number($("pltsAmbang").value) };
    if (mode === "oauth") {
      body.clientId = $("pltsClientId").value.trim();
      body.clientSecret = $("pltsClientSecret").value.trim();
      body.region = $("pltsRegion").value;
      body.plantId = $("pltsPlantId").value.trim();
      if (!body.clientId) { pesan("Client ID wajib diisi.", "bahaya"); return; }
      if (!body.clientSecret && !keadaan.data) { pesan("Client Secret wajib diisi pada penyiapan pertama.", "bahaya"); return; }
    } else {
      body.tokenId = $("pltsToken").value.trim();
      body.wifiSn = $("pltsSn").value.trim();
      body.url = $("pltsUrl").value.trim();
      if (!body.wifiSn) { pesan("WiFi SN wajib diisi.", "bahaya"); return; }
      if (!body.tokenId && !keadaan.data) { pesan("TokenId wajib diisi pada penyiapan pertama.", "bahaya"); return; }
    }
    $("pltsSimpan").disabled = true;
    pesan("Menyimpan…");
    panggil("/api/solax/konfigurasi", { metode: "POST", body: body, batasDetik: 20 }).then(function (jawab) {
      $("pltsSimpan").disabled = false;
      if (!jawab || !jawab.ok) { pesan((jawab && jawab.galat) || "Gagal menyimpan konfigurasi.", "bahaya"); return; }
      pesan("Konfigurasi disimpan. Mengambil data…", "ok");
      $("pltsToken").value = "";
      $("pltsClientSecret").value = "";
      isiKonfigurasi(jawab.konfigurasi);
      muat();
    });
  }

  /* ---------------- korelasi PLTS ↔ PLN ---------------- */
  function renderKorelasi() {
    var app = window.AplikasiListrik;
    var Core = window.KwhCore;
    renderTombolTag();
    if (!app || !Core) { $("pltsKorelasi").innerHTML = '<div class="muted">Belum ada data.</div>'; return; }

    var s = app.ambilState();
    var h = Core.hitung(s, { sekarang: Core.tanggalSekarang() });
    var key = h.bulanAktif;
    var bulan = null;
    h.bulanan.forEach(function (b) { if (b.key === key) bulan = b; });

    if (!bulan) {
      $("pltsKorelasi").innerHTML = '<div class="muted">Belum ada catatan pemakaian untuk bulan ini.</div>';
      return;
    }

    var catatanBulan = h.catatan.filter(function (r) {
      return Core.bulanKey(r.tanggal) === key && r.pltsOff && r.pemakaian !== null;
    });

    var html = '<div class="plts-korelasi-kepala"><b>' + esc(bulan.label) + "</b>" +
      '<span class="muted kecil">Pemakaian ' + angka(bulan.kwh, 1) + " kWh • " + rp(bulan.biaya) + "</span></div>";

    if (!bulan.pltsOffHari) {
      html += '<p class="muted">Belum ada hari yang ditandai <b>PLTS off-grid</b>. Tandai lewat tombol di atas, ' +
        'atau centang “PLTS off-grid (baterai habis) hari ini” saat mencatat, supaya bisa dibandingkan dengan hari normal.</p>';
    } else {
      html += '<div class="plts-korelasi-angka">' +
        '<div><span class="plts-label">Hari PLTS off-grid</span><b>' + bulan.pltsOffHari + " hari</b></div>" +
        '<div><span class="plts-label">Rata-rata saat off-grid</span><b>' + angka(bulan.pltsOffRata, 1) + " kWh/hari</b></div>" +
        '<div><span class="plts-label">Rata-rata hari normal</span><b>' +
        (bulan.normalHari ? angka(bulan.normalRata, 1) + " kWh/hari" : "—") + "</b></div>" +
        '<div><span class="plts-label">Selisih</span><b>' +
        (bulan.normalHari && bulan.normalRata > 0
          ? (bulan.pltsOffRata >= bulan.normalRata ? "+" : "") +
            angka((bulan.pltsOffRata - bulan.normalRata) / bulan.normalRata * 100, 0) + "%"
          : "—") + "</b></div>" +
        "</div>";
      html += '<div class="plts-daftar">' + catatanBulan.map(function (r) {
        return '<span class="plts-pill">' + Core.labelTanggal(r.tanggal, false) + " • " +
          kwh(r.pemakaian, 1) + " • " + rp(r.biaya) + "</span>";
      }).join("") + "</div>";
    }

    html += '<p class="hint">Hari PLTS off-grid (baterai habis) biasanya menaikkan pemakaian PLN. ' +
      "Tandai hari-harinya agar analisa bisa memisahkan pemakaian saat PLTS aktif vs off-grid.</p>";
    $("pltsKorelasi").innerHTML = html;
  }

  /* ---------------- grafik harian Solar & SOC ---------------- */
  function renderGrafikKosong(pesan) {
    var box = $("pltsGrafik");
    if (box) box.innerHTML = '<div class="plts-grafik-kosong">' + esc(pesan || "Grafik belum tersedia.") + "</div>";
    var info = $("pltsGrafikInfo");
    if (info) info.textContent = pesan || "";
  }

  function muatGrafik() {
    if (!$("pltsGrafik")) return;
    return panggil("/api/solax/grafik", { batasDetik: 15 }).then(function (jawab) {
      if (!jawab || !jawab.ok) {
        renderGrafikKosong((jawab && jawab.galat) || "Grafik belum tersedia.");
        return;
      }
      renderGrafik(jawab);
    }).catch(function () {
      renderGrafikKosong("Grafik belum tersedia.");
    });
  }

  function renderGrafik(j) {
    var sampel = (j && Array.isArray(j.sampel) ? j.sampel : []).filter(function (s) {
      return s && /^\d{2}:\d{2}$/.test(String(s.waktu));
    });
    if (!sampel.length) {
      renderGrafikKosong("Grafik mulai terisi otomatis tiap 60 detik saat helper berjalan.");
      return;
    }
    var W = 1000, H = 340, L = 64, R = 56, T = 18, B = 50;
    var pw = W - L - R, ph = H - T - B;
    var menit = function (w) { var a = w.split(":"); return Number(a[0]) * 60 + Number(a[1]); };
    var angkaAman = function (v) { var n = Number(v); return isFinite(n) ? n : 0; };
    var pv = sampel.map(function (s) { return Math.max(0, angkaAman(s.pvW)); });
    var soc = sampel.map(function (s) { return Math.max(0, Math.min(100, angkaAman(s.socPct))); });
    var maxPv = Math.max.apply(null, pv);
    var skala = Math.max(1000, Math.ceil(maxPv / 1000) * 1000);
    var x = function (m) { return L + (m / 1440) * pw; };
    var yW = function (v) { return T + ph - (v / skala) * ph; };
    var yS = function (v) { return T + ph - (v / 100) * ph; };
    var fmtW = function (v) { return window.KwhCore ? window.KwhCore.angka(v, 0) : String(v); };

    var grid = "";
    for (var i = 0; i <= 4; i++) {
      var y = T + (ph * i) / 4;
      var nilai = skala * (1 - i / 4);
      grid += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '" stroke="var(--garis)" stroke-width="1"/>';
      grid += '<text x="' + (L - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="12" fill="var(--teks-lembut)">' + fmtW(nilai) + " W</text>";
      grid += '<text x="' + (W - R + 8) + '" y="' + (y + 4) + '" font-size="12" fill="var(--teks-lembut)">' + (100 - i * 25) + "%</text>";
    }
    for (var h = 0; h <= 24; h += 3) {
      var xx = x(h * 60);
      grid += '<line x1="' + xx + '" y1="' + T + '" x2="' + xx + '" y2="' + (T + ph) + '" stroke="var(--garis)" stroke-width="0.7" opacity=".6"/>';
      grid += '<text x="' + xx + '" y="' + (H - 22) + '" text-anchor="middle" font-size="12" fill="var(--teks-lembut)">' + (h < 10 ? "0" : "") + h + ":00</text>";
    }

    var titikPv = pv.map(function (v, idx) { return x(menit(sampel[idx].waktu)) + "," + yW(v); });
    var titikSoc = soc.map(function (v, idx) { return x(menit(sampel[idx].waktu)) + "," + yS(v); });
    var awalX = x(menit(sampel[0].waktu)), akhirX = x(menit(sampel[sampel.length - 1].waktu));
    var dasar = T + ph;
    var areaPv = "M" + titikPv.join(" L") + " L" + akhirX + "," + dasar + " L" + awalX + "," + dasar + " Z";
    var areaSoc = "M" + titikSoc.join(" L") + " L" + akhirX + "," + dasar + " L" + awalX + "," + dasar + " Z";

    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Grafik Solar dan Battery SOC hari ini" preserveAspectRatio="xMidYMid meet">' +
      grid +
      '<path d="' + areaSoc + '" fill="#06b6d4" fill-opacity=".10"/>' +
      '<path d="' + areaPv + '" fill="#f59e0b" fill-opacity=".14"/>' +
      '<polyline points="' + titikSoc.join(" ") + '" fill="none" stroke="#06b6d4" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<polyline points="' + titikPv.join(" ") + '" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<circle cx="' + akhirX + '" cy="' + yW(pv[pv.length - 1]) + '" r="3.5" fill="#f59e0b"/>' +
      '<circle cx="' + akhirX + '" cy="' + yS(soc[soc.length - 1]) + '" r="3.5" fill="#06b6d4"/>' +
      '<text x="' + L + '" y="' + (T - 2) + '" font-size="11" fill="var(--teks-lembut)">W</text>' +
      '</svg>';

    var box = $("pltsGrafik");
    if (box) box.innerHTML = svg;
    var info = $("pltsGrafikInfo");
    if (info) {
      var tanggal = String(j.tanggal || "").replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3-$2-$1");
      info.textContent = "Tanggal " + tanggal + " • " + sampel.length + " sampel • terakhir " + sampel[sampel.length - 1].waktu;
    }
  }

  /* ---------------- muat data ---------------- */
  function muat(paksa) {
    renderKorelasi();
    muatGrafik();
    return panggil("/api/solax/status" + (paksa ? "?paksa=1" : ""), { batasDetik: 40 }).then(function (jawab) {
      if (!jawab || (jawab.ok === false && jawab.offline)) {
        tampilkanOffline(true);
        renderGalat((jawab && jawab.galat) || "Helper backup belum aktif.");
        return;
      }
      tampilkanOffline(false);
      if (!jawab.ok) {
        renderGalat(jawab.galat);
        return;
      }
      keadaan.terkonfigurasi = !!jawab.terkonfigurasi;
      if (!jawab.terkonfigurasi) {
        keadaan.data = null;
        renderBelum(jawab.konfigurasi);
        isiKonfigurasi(jawab.konfigurasi);
        return;
      }
      keadaan.data = jawab.data;
      renderStatus(jawab.data);
      isiKonfigurasi(jawab.konfigurasi);
    });
  }

  function setAktif(aktif) {
    keadaan.halaman = !!aktif;
    if (aktif) { muat(); mulaiAuto(); }
    else { hentikanAuto(); }
  }

  function pasangEvent() {
    // Ingat posisi buka/tutup kartu konfigurasi.
    var detailKonfig = $("pltsConfigDetails");
    if (detailKonfig) {
      try {
        if (localStorage.getItem("plts-config-terbuka") === "0") detailKonfig.open = false;
      } catch (e) { }
      detailKonfig.addEventListener("toggle", function () {
        try { localStorage.setItem("plts-config-terbuka", detailKonfig.open ? "1" : "0"); } catch (e) { }
      });
    }
    var detailKorelasi = $("pltsKorelasiDetails");
    if (detailKorelasi) {
      try {
        if (localStorage.getItem("plts-korelasi-terbuka") === "0") detailKorelasi.open = false;
      } catch (e) { }
      detailKorelasi.addEventListener("toggle", function () {
        try { localStorage.setItem("plts-korelasi-terbuka", detailKorelasi.open ? "1" : "0"); } catch (e) { }
      });
    }
    $("pltsPerbarui").addEventListener("click", function () { muat(true); });
    $("pltsCobaLagi").addEventListener("click", function () { muat(true); });
    $("pltsSimpan").addEventListener("click", simpanKonfigurasi);
    $("pltsMode").addEventListener("change", function () {
      aturModeTampil();
      pesan("");
    });
    $("pltsUji").addEventListener("click", function () {
      pesan("Mengambil data dari konfigurasi tersimpan…");
      muat().then(function () { mulaiAuto(); });
    });
    $("pltsAuto").addEventListener("change", function () { if (this.checked) mulaiAuto(); else hentikanAuto(); });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) hentikanAuto();
      else if (keadaan.halaman && $("pltsAuto").checked) { muat(); mulaiAuto(); }
    });
  }

  window.PltsListrik = { muat: muat, setAktif: setAktif, urlHelper: URL_HELPER };

  function mulai() {
    pasangEvent();
    renderKorelasi();
    var halaman = $("halaman-plts");
    if (halaman && (!halaman.classList.contains("hidden") ||
        (window.location.hash || "").replace("#", "") === "plts")) {
      setAktif(true);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mulai);
  else mulai();
})();
