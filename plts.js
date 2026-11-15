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
    $("pltsWaktu").textContent = "";
  }

  function renderGalat(pesan) {
    $("pltsStatus").innerHTML = '<div class="plts-galat"><b>Tidak bisa mengambil data SolaxCloud.</b><p>' +
      esc(pesan || "kesalahan tidak diketahui") + "</p></div>";
    $("pltsWaktu").textContent = "";
  }

  function renderStatus(d) {
    var tone = d.offGrid ? "bahaya" : d.socRendah ? "waspada" : "normal";
    var soc = d.socPct;
    var socTeks = soc === null || soc === undefined ? "—" : angka(soc, 0) + "%";
    var lebar = soc === null || soc === undefined ? 0 : Math.max(0, Math.min(100, soc));
    var gridNilai = d.feedinpowerW === null || d.feedinpowerW === undefined ? "—" : kw(Math.abs(d.feedinpowerW));
    var gridSub = d.feedinpowerW === null || d.feedinpowerW === undefined ? "tidak tersedia"
      : d.feedinpowerW > 0 ? "Ekspor ke PLN" : d.feedinpowerW < 0 ? "Impor dari PLN" : "idle";
    var bateraiNilai = d.batPowerW === null || d.batPowerW === undefined ? "—" : kw(Math.abs(d.batPowerW));
    var bateraiSub = d.batPowerW === null || d.batPowerW === undefined ? "tidak tersedia"
      : d.batPowerW > 0 ? "mengosongkan" : d.batPowerW < 0 ? "mengisi" : "idle";
    var bebanNilai = d.bebanW === null || d.bebanW === undefined ? "—" : kw(d.bebanW);
    var pvNilai = d.pvW === null || d.pvW === undefined ? "—" : kw(d.pvW);
    var hasil = d.yieldTodayKwh === null || d.yieldTodayKwh === undefined ? "—" : angka(d.yieldTodayKwh, 2) + " kWh";
    var ac = d.acpowerW === null || d.acpowerW === undefined ? "—" : watt(d.acpowerW);

    var html = '<div class="plts-status ' + tone + '">' +
      '<div class="plts-status-kepala"><span class="plts-titik"></span><b>' + esc(d.statusTeks) + "</b>" +
        '<span class="plts-live">realtime</span></div>' +
      (d.peringatan ? '<div class="plts-peringatan">' + esc(d.peringatan) + "</div>" : "") +

      '<div class="plts-flow">' +
        '<svg class="plts-flow-svg" viewBox="0 0 760 420" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
          '<defs>' +
            '<linearGradient id="pltsSky" x1="0" y1="0" x2="0" y2="1">' +
              '<stop offset="0" stop-color="#e8f5ff"/><stop offset="1" stop-color="#f7fbff"/>' +
            '</linearGradient>' +
            '<marker id="pltsArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
              '<path d="M0,0 L10,5 L0,10 z" fill="var(--aksen)"/></marker>' +
          '</defs>' +
          '<rect x="0" y="0" width="760" height="420" rx="18" fill="url(#pltsSky)"/>' +
          '<circle cx="655" cy="70" r="34" fill="#fde68a" opacity=".85"/>' +
          '<circle cx="655" cy="70" r="46" fill="#fde68a" opacity=".18"/>' +
          '<path d="M0 350 H760" stroke="var(--garis)" stroke-width="2"/>' +
          /* rumah */
          '<rect x="322" y="205" width="188" height="140" rx="6" fill="#ffffff" stroke="var(--garis)" stroke-width="2"/>' +
          '<polygon points="304,207 416,128 528,207" fill="#e2e8f0" stroke="var(--garis)" stroke-width="2"/>' +
          '<rect x="396" y="270" width="40" height="75" rx="3" fill="#94a3b8"/>' +
          '<rect x="348" y="235" width="34" height="30" rx="3" fill="#bfdbfe"/>' +
          '<rect x="454" y="235" width="34" height="30" rx="3" fill="#bfdbfe"/>' +
          /* panel PV di atap */
          '<g transform="translate(340,158) skewX(-24)">' +
            '<rect x="0" y="0" width="118" height="47" rx="4" fill="#60a5fa" stroke="#1d4ed8" stroke-width="2"/>' +
            '<path d="M0 16 H118 M0 32 H118 M40 0 V47 M80 0 V47" stroke="#1e40af" stroke-width="1.4" opacity=".8"/>' +
          '</g>' +
          /* baterai */
          '<g>' +
            '<rect x="76" y="252" width="68" height="104" rx="10" fill="#f8fafc" stroke="var(--garis)" stroke-width="2"/>' +
            '<rect x="98" y="244" width="24" height="10" rx="3" fill="var(--garis)"/>' +
            '<rect x="86" y="278" width="48" height="10" rx="3" fill="#a7f3d0"/>' +
            '<rect x="86" y="296" width="48" height="10" rx="3" fill="#a7f3d0"/>' +
            '<rect x="86" y="314" width="48" height="10" rx="3" fill="#e2e8f0"/>' +
          '</g>' +
          /* pylon */
          '<g>' +
            '<path d="M138 350 L166 270 L194 350 M152 318 H180 M146 334 H186" fill="none" stroke="var(--garis)" stroke-width="3" stroke-linejoin="round"/>' +
          '</g>' +
          /* aliran energi */
          '<path class="flow-line" d="M420 172 C390 190 360 196 330 215" stroke="#f59e0b" fill="none" stroke-width="4" marker-end="url(#pltsArrow)"/>' +
          '<path class="flow-line" d="M146 270 C200 270 250 250 322 250" stroke="#10b981" fill="none" stroke-width="4" marker-end="url(#pltsArrow)"/>' +
          '<path class="flow-line" d="M180 300 C240 300 270 292 322 292" stroke="#94a3b8" fill="none" stroke-width="4" marker-end="url(#pltsArrow)"/>' +
          '<path d="M510 250 C560 250 590 280 620 300" stroke="#ef4444" fill="none" stroke-width="4" opacity=".5"/>' +
        '</svg>' +

        '<div class="flow-node flow-pv"><span>PV</span><b>' + esc(pvNilai) + "</b><small>produksi</small></div>" +
        '<div class="flow-node flow-bat"><span>Baterai</span><b>' + esc(bateraiNilai) + "</b><small>" + esc(bateraiSub) + "</small>" +
          '<div class="plts-bar flow-bar"><i style="width:' + lebar + '%"></i></div><em>' + esc(socTeks) + "</em></div>" +
        '<div class="flow-node flow-grid"><span>Grid</span><b>' + esc(gridNilai) + "</b><small>" + esc(gridSub) + "</small></div>" +
        '<div class="flow-node flow-load"><span>Beban rumah</span><b>' + esc(bebanNilai) + "</b><small>load</small></div>" +
        '<div class="flow-yield"><span>Hasil hari ini</span><b>' + esc(hasil) + "</b></div>" +
        '<div class="flow-center">Rumah</div>' +
      '</div>' +

      '<div class="plts-mini-stats">' +
        '<div><span>AC output</span><b>' + esc(ac) + "</b></div>" +
        '<div><span>SOC baterai</span><b>' + esc(socTeks) + "</b></div>" +
        '<div><span>Status inverter</span><b>' + esc(d.inverterStatusTeks || "—") + "</b></div>" +
        '<div><span>Data inverter</span><b>' + esc(d.uploadTime || "—") + "</b></div>" +
      "</div>" +

      '<div class="plts-meta">Sumber: ' + (d.mode === "oauth" ? "Developer Portal (OAuth)" : "API TokenId") +
      (d.plantName ? " • " + esc(d.plantName) : "") +
      (d.wifiSn ? " • SN " + esc(d.wifiSn) : "") + "</div>" +
      (d.batPowerW !== null && d.batPowerW !== undefined
        ? '<div class="plts-meta">Daya baterai (batPower) ditampilkan apa adanya dari inverter: tanda positif/negatif menunjukkan arah pengisian/pengosongan.</div>'
        : "") +
      "</div>";

    $("pltsStatus").innerHTML = html;
    $("pltsWaktu").textContent = "Diperbarui: " + new Date().toLocaleTimeString("id-ID");
  }

  /** W dalam kW dengan 2 desimal; <1 kW tetap ditampilkan kW agar seragam. */
  function kw(nilai) {
    if (nilai === null || nilai === undefined) return "—";
    var w = Number(nilai);
    if (!isFinite(w)) return "—";
    return angka(w / 1000, 2) + " kW";
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

  /* ---------------- muat data ---------------- */
  function muat() {
    renderKorelasi();
    return panggil("/api/solax/status", { batasDetik: 40 }).then(function (jawab) {
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
    $("pltsPerbarui").addEventListener("click", muat);
    $("pltsCobaLagi").addEventListener("click", muat);
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
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mulai);
  else mulai();
})();
