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
    var html = '<div class="plts-onboarding">' +
      "<b>Belum tersambung ke SolaxCloud.</b>" +
      "<p>Isi <b>TokenId</b> dan <b>WiFi SN</b> di panel Konfigurasi, lalu tekan <b>Simpan &amp; uji</b>. " +
      "Setelah tersambung, halaman ini menampilkan SOC baterai, daya PV, daya baterai, dan status off-grid.</p>" +
      '<ul class="plts-tips">' +
      "<li>TokenId: SolaxCloud → menu <b>Service</b> → <b>API</b>.</li>" +
      "<li>WiFi SN: nomor seri dongle Wi-Fi / Registration Number inverter.</li>" +
      "<li>Data diperbarui tiap ±60 detik (bisa dimatikan).</li>" +
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
    var gridTeks = d.feedinpowerW === null || d.feedinpowerW === undefined ? "—"
      : (d.feedinpowerW > 0 ? "Ekspor " + watt(d.feedinpowerW)
        : d.feedinpowerW < 0 ? "Impor " + watt(Math.abs(d.feedinpowerW))
          : watt(0));

    var kartu = [
      { label: "SOC baterai", nilai: socTeks, cat: "bar", lebar: lebar },
      { label: "Produksi PV", nilai: watt(d.pvW) },
      { label: "Daya baterai", nilai: watt(d.batPowerW) },
      { label: "Grid", nilai: gridTeks },
      { label: "Hasil hari ini", nilai: d.yieldTodayKwh === null || d.yieldTodayKwh === undefined ? "—" : angka(d.yieldTodayKwh, 2) + " kWh" },
      { label: "AC output", nilai: watt(d.acpowerW) }
    ];

    var html = '<div class="plts-status ' + tone + '">' +
      '<div class="plts-status-kepala"><span class="plts-titik"></span><b>' + esc(d.statusTeks) + "</b></div>" +
      (d.peringatan ? '<div class="plts-peringatan">' + esc(d.peringatan) + "</div>" : "") +
      '<div class="plts-stats">' +
      kartu.map(function (k) {
        return '<div class="plts-stat"><span class="plts-label">' + esc(k.label) + "</span>" +
          '<b class="plts-nilai">' + esc(k.nilai) + "</b>" +
          (k.cat === "bar" ? '<div class="plts-bar"><i style="width:' + k.lebar + '%"></i></div>' : "") +
          "</div>";
      }).join("") +
      "</div>" +
      '<div class="plts-meta">Status inverter: ' + esc(d.inverterStatusTeks || "—") +
      (d.inverterStatusKode !== null && d.inverterStatusKode !== undefined ? " (kode " + esc(d.inverterStatusKode) + ")" : "") +
      (d.uploadTime ? " • data inverter: " + esc(d.uploadTime) : "") +
      (d.wifiSn ? " • SN " + esc(d.wifiSn) : "") + "</div>" +
      (d.batPowerW !== null && d.batPowerW !== undefined
        ? '<div class="plts-meta">Daya baterai (batPower) ditampilkan apa adanya dari inverter: tanda positif/negatif menunjukkan arah pengisian/pengosongan.</div>'
        : "") +
      "</div>";

    $("pltsStatus").innerHTML = html;
    $("pltsWaktu").textContent = "Diperbarui: " + new Date().toLocaleTimeString("id-ID");
    renderTombolTag(d);
  }

  function renderTombolTag(d) {
    var app = window.AplikasiListrik;
    if (!app || !window.KwhCore) return;
    var hariIni = window.KwhCore.tanggalSekarang();
    var s = app.ambilState();
    var rec = s.catatan.filter(function (r) { return r.tanggal === hariIni; })[0];
    var box = $("pltsTagBox");
    if (!box) {
      var div = document.createElement("div");
      div.id = "pltsTagBox";
      div.className = "plts-tag";
      $("pltsStatus").appendChild(div);
      box = div;
    }
    if (!rec) {
      box.innerHTML = '<span class="muted kecil">Catat sisa kWh hari ini dulu agar hari PLTS off-grid bisa ditandai.</span>';
      return;
    }
    if (rec.pltsOff) {
      box.innerHTML = '<span class="chip naik">Hari ini ditandai PLTS off-grid</span> ' +
        '<button type="button" class="ghost kecil" id="pltsHapusTag">Hapus tanda</button>';
    } else {
      box.innerHTML = '<button type="button" class="ghost kecil" id="pltsTagHariIni">Tandai hari ini PLTS off-grid</button>';
    }
    var tag = $("pltsTagHariIni");
    var hapus = $("pltsHapusTag");
    if (tag) tag.addEventListener("click", function () { setTagHariIni(true); });
    if (hapus) hapus.addEventListener("click", function () { setTagHariIni(false); });
  }

  function setTagHariIni(nilai) {
    var app = window.AplikasiListrik;
    var hariIni = window.KwhCore.tanggalSekarang();
    var s = app.ambilState();
    var rec = s.catatan.filter(function (r) { return r.tanggal === hariIni; })[0];
    if (!rec) { app.toast("Catat sisa kWh hari ini dulu.", "error"); return; }
    rec.pltsOff = !!nilai;
    app.terapkanState(s);
    app.toast(nilai ? "Hari ini ditandai PLTS off-grid." : "Tanda PLTS off-grid dihapus.", "ok");
    if (keadaan.data) renderStatus(keadaan.data);
    renderKorelasi();
  }

  /* ---------------- konfigurasi ---------------- */
  function isiKonfigurasi(k) {
    if (!k) return;
    $("pltsSn").value = k.wifiSn || "";
    $("pltsUrl").value = k.url || "https://www.solaxcloud.com";
    $("pltsAmbang").value = k.ambangSoc === undefined || k.ambangSoc === null ? 20 : k.ambangSoc;
    $("pltsToken").placeholder = k.tokenTerisi ? "•••••• (tersimpan — kosongkan bila tidak diubah)" : "tempel TokenId dari menu Service → API";
  }

  function pesan(teks, jenis) {
    var el = $("pltsPesan");
    el.textContent = teks || "";
    el.className = "hint " + (jenis || "");
  }

  function simpanKonfigurasi() {
    var body = {
      tokenId: $("pltsToken").value.trim(),
      wifiSn: $("pltsSn").value.trim(),
      url: $("pltsUrl").value.trim(),
      ambangSoc: Number($("pltsAmbang").value)
    };
    if (!body.wifiSn) { pesan("WiFi SN wajib diisi.", "bahaya"); return; }
    if (!body.tokenId && !keadaan.data) { pesan("TokenId wajib diisi pada penyiapan pertama.", "bahaya"); return; }
    $("pltsSimpan").disabled = true;
    pesan("Menyimpan…");
    panggil("/api/solax/konfigurasi", { metode: "POST", body: body, batasDetik: 20 }).then(function (jawab) {
      $("pltsSimpan").disabled = false;
      if (!jawab || !jawab.ok) { pesan((jawab && jawab.galat) || "Gagal menyimpan konfigurasi.", "bahaya"); return; }
      pesan("Konfigurasi disimpan. Mengambil data…", "ok");
      $("pltsToken").value = "";
      isiKonfigurasi(jawab.konfigurasi);
      muat();
    });
  }

  /* ---------------- korelasi PLTS ↔ PLN ---------------- */
  function renderKorelasi() {
    var app = window.AplikasiListrik;
    var Core = window.KwhCore;
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
      html += '<p class="muted">Belum ada hari yang ditandai <b>PLTS off-grid</b>. Tandai di form catatan harian ' +
        '(centang “Hari ini PLTS off-grid”) atau lewat tombol di status PLTS, supaya bisa dibandingkan dengan hari normal.</p>';
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
    $("pltsPerbarui").addEventListener("click", muat);
    $("pltsCobaLagi").addEventListener("click", muat);
    $("pltsSimpan").addEventListener("click", simpanKonfigurasi);
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
