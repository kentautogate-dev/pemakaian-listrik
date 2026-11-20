/*
 * dashboard.js — halaman Dashboard baru (terpisah dari desain lama).
 * Mengambil data aplikasi (catatan kWh) + data realtime Solax dari helper lokal.
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var angka = function (n, d) { return window.KwhCore ? window.KwhCore.angka(n, d) : String(n); };
  var rp = function (n) { return window.KwhCore ? window.KwhCore.rp(n) : "Rp " + n; };
  var URL_HELPER = (function () {
    try { return localStorage.getItem("kwh-backup-url") || "http://127.0.0.1:8787"; }
    catch (e) { return "http://127.0.0.1:8787"; }
  })();

  var keadaan = { aktif: false, timer: null, app: null, live: null, grafik: null, eaMode: "harian", eaBulan: null, eaTerpasang: false };
  var ikon = {
    bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.2 1.8 3.6 13.4a.6.6 0 0 0 .46.98H9l-1.2 7.2a.6.6 0 0 0 1.06.5l9.6-11.6a.6.6 0 0 0-.46-.98H13l1.2-7.2a.6.6 0 0 0-1-.5Z"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/></svg>',
    battery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="16" height="10" rx="2.5"/><path d="M21 10v4M7 10v4M11 10v4"/></svg>',
    solar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="17" cy="6" r="2.2"/><path d="M17 2.5V1M17 11v-1.5M21.5 6H20M14 6h-1.5"/><rect x="3" y="12" width="14" height="8" rx="1.5"/><path d="M3 16h14M10 12v8M4 20l-1.5 2M16 20l1.5 2"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21 12 3l8 18M7 14h10M5.5 18h13M12 3V1M9 5h6"/></svg>',
    activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>',
    inverter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3"/><path d="M12 7v1.5M12 15.5V17M7 12h1.5M15.5 12H17"/></svg>'
  };

  function panggil(jalur) {
    var kontrol = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (kontrol) kontrol.abort(); }, 20000);
    return fetch(URL_HELPER + jalur, { headers: { Accept: "application/json" }, signal: kontrol ? kontrol.signal : undefined })
      .then(function (r) {
        clearTimeout(timer);
        return r.text().then(function (t) {
          var d = null;
          try { d = t ? JSON.parse(t) : null; } catch (e) { d = null; }
          if (!r.ok && d && !d.galat) d.galat = "HTTP " + r.status;
          return d;
        });
      })
      .catch(function (e) {
        clearTimeout(timer);
        return { ok: false, galat: e && e.name === "AbortError" ? "Helper timeout" : "Helper tidak aktif" };
      });
  }

  function hariIni() {
    var d = new Date();
    var label = d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function sapaan() {
    var jam = new Date().getHours();
    if (jam < 11) return "Selamat pagi.";
    if (jam < 15) return "Selamat siang.";
    if (jam < 19) return "Selamat sore.";
    return "Selamat malam.";
  }

  function bacaApp() {
    try {
      if (!window.AplikasiListrik || !window.KwhCore) return null;
      return window.KwhCore.hitung(window.AplikasiListrik.ambilState());
    } catch (e) {
      return null;
    }
  }

  function bulanKpi(h) {
    if (!h || !h.ringkasan) return { bulan: null, fallback: false, delta: null };
    var r = h.ringkasan;
    var bulan = r.bulanTerakhir || null;
    var fallback = false;
    if (bulan && !bulan.kwh && !bulan.hari) {
      var ada = (h.bulanan || []).filter(function (b) { return b.kwh > 0; });
      if (ada.length) {
        bulan = ada[ada.length - 1];
        fallback = true;
      }
    }
    var idx = bulan ? (h.bulanan || []).indexOf(bulan) : -1;
    var prev = idx > 0 ? h.bulanan[idx - 1] : null;
    var delta = bulan && prev && prev.kwh > 0 ? (bulan.kwh - prev.kwh) / prev.kwh * 100 : null;
    return { bulan: bulan, fallback: fallback, delta: delta };
  }

  function renderHero(h) {
    if ($("dashTanggal")) $("dashTanggal").textContent = hariIni();
    if ($("dashSapaan")) $("dashSapaan").innerHTML = esc(sapaan()) + " <span>Energi Anda terkendali.</span>";
    var sub = "Ringkasan pemakaian listrik rumah dan performa PLTS dalam satu tampilan.";
    var bk = bulanKpi(h);
    if (bk.bulan) {
      sub = "Pemakaian " + bk.bulan.label + " " + angka(bk.bulan.kwh, 1) +
        " kWh. Pantau energi dan baterai secara real-time.";
    }
    if (keadaan.live) {
      sub = "PV " + watt(keadaan.live.pvW) + " • Beban " + watt(keadaan.live.bebanW) +
        " • Baterai " + (keadaan.live.socPct == null ? "—" : angka(keadaan.live.socPct, 0) + "%") + ".";
    }
    if ($("dashSub")) $("dashSub").textContent = sub;
  }

  function watt(n) {
    if (n === null || n === undefined) return "—";
    var v = Number(n);
    if (!isFinite(v)) return "—";
    return angka(Math.round(v), 0) + " W";
  }

  function renderKpis(h) {
    var box = $("dashKpis");
    if (!box) return;
    var r = h && h.ringkasan ? h.ringkasan : null;
    var bk = bulanKpi(h);
    var bulan = bk.bulan;
    var live = keadaan.live || {};
    var delta = bk.delta;
    var deltaTeks = delta === null || delta === undefined ? (bk.fallback ? "bulan terakhir dengan catatan" : "bulan berjalan") :
      (delta >= 0 ? "+" : "") + angka(delta, 1) + "% vs bulan sebelumnya";
    var kpi = [
      {
        ikon: "bolt", kelas: "",
        label: bk.fallback ? "Pemakaian bulan lalu" : "Pemakaian bulan ini",
        nilai: bulan ? angka(bulan.kwh, 1) + " kWh" : "—",
        sub: bulan ? bulan.label : "belum ada catatan",
        hijau: false
      },
      {
        ikon: "wallet", kelas: "amber",
        label: bk.fallback ? "Biaya bulan lalu" : "Biaya bulan ini",
        nilai: bulan ? rp(bulan.biaya) : "—",
        sub: deltaTeks,
        hijau: delta !== null && delta !== undefined && delta < 0
      },
      {
        ikon: "battery", kelas: "green",
        label: "Sisa token",
        nilai: r ? angka(r.sisaAkhir, 0) + " kWh" : "—",
        sub: r ? "≈ " + rp(r.saldoRp) : "belum tercatat",
        hijau: false
      },
      {
        ikon: "solar", kelas: "cyan",
        label: "Hasil PLTS hari ini",
        nilai: live.yieldTodayKwh == null ? "—" : angka(live.yieldTodayKwh, 2) + " kWh",
        sub: live.pvW == null ? "menunggu data inverter" : "PV " + watt(live.pvW) + " saat ini",
        hijau: false
      }
    ];
    box.innerHTML = kpi.map(function (k) {
      return '<div class="dash-kpi">' +
        '<div class="dash-kpi-ikon ' + k.kelas + '">' + ikon[k.ikon] + "</div>" +
        '<div class="dash-kpi-teks"><span>' + esc(k.label) + "</span>" +
          "<b>" + esc(k.nilai) + "</b>" +
          '<small' + (k.hijau ? ' class="naik"' : "") + ">" + esc(k.sub) + "</small>" +
        "</div></div>";
    }).join("");
  }

  function renderLive(h) {
    var box = $("dashLive");
    if (!box) return;
    var live = keadaan.live;
    if (!live) {
      box.innerHTML = "<span><i></i>Data Solax belum tersedia — periksa helper.</span>";
    } else {
      var grid = live.feedinpowerW == null ? "—" :
        (live.feedinpowerW === 0 ? "0 W" : live.feedinpowerW > 0 ? "Ekspor " + watt(live.feedinpowerW) : "Impor " + watt(Math.abs(live.feedinpowerW)));
      box.innerHTML = "<span><i></i>PV <b>" + esc(watt(live.pvW)) + "</b></span>" +
        "<span><i></i>Beban <b>" + esc(watt(live.bebanW)) + "</b></span>" +
        "<span><i></i>Baterai <b>" + (live.socPct == null ? "—" : angka(live.socPct, 0) + "%") + "</b></span>" +
        "<span><i></i>Grid <b>" + esc(grid) + "</b></span>" +
        "<span><i></i>Hasil hari ini <b>" + (live.yieldTodayKwh == null ? "—" : angka(live.yieldTodayKwh, 2) + " kWh") + "</b></span>";
    }
    if ($("dashStatus")) {
      $("dashStatus").textContent = live ? "● Normal Off-grid" : "● Data realtime terputus";
    }
    if ($("dashTemp")) {
      $("dashTemp").textContent = live && live.temperatureC != null ? angka(live.temperatureC, 0) + "°C" : "—°C";
    }
    if ($("dashChartTotal")) {
      $("dashChartTotal").innerHTML = esc(live && live.yieldTodayKwh != null ? angka(live.yieldTodayKwh, 2) : "—") + " <small>kWh</small>";
    }
  }

  function renderChart(j) {
    var box = $("dashChart");
    if (!box) return;
    var sampel = (j && Array.isArray(j.sampel) ? j.sampel : []).filter(function (s) {
      return s && /^\d{2}:\d{2}$/.test(String(s.waktu));
    });
    if (!sampel.length) {
      box.innerHTML = '<div class="dash-chart-empty">Grafik akan terisi otomatis.<br>Helper menyimpan sampel Solar &amp; SOC setiap 60 detik.</div>';
      return;
    }
    var sempit = window.innerWidth < 640;
    var W = sempit ? 520 : 900, H = sempit ? 260 : 250;
    var L = sempit ? 36 : 46, R = sempit ? 30 : 44, T = 14, B = sempit ? 30 : 34;
    var pw = W - L - R, ph = H - T - B;
    var menit = function (w) { var a = w.split(":"); return Number(a[0]) * 60 + Number(a[1]); };
    var num = function (v) { var n = Number(v); return isFinite(n) ? n : 0; };
    var pv = sampel.map(function (s) { return Math.max(0, num(s.pvW)); });
    var soc = sampel.map(function (s) { return Math.max(0, Math.min(100, num(s.socPct))); });
    var maxPv = Math.max.apply(null, pv);
    var skala = Math.max(1000, Math.ceil(maxPv / 1000) * 1000);
    var x = function (m) { return L + (m / 1440) * pw; };
    var yPv = function (v) { return T + ph - (v / skala) * ph; };
    var ySoc = function (v) { return T + ph - (v / 100) * ph; };
    var grid = "";
    for (var i = 0; i <= 4; i++) {
      var y = T + (ph * i) / 4;
      grid += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '" stroke="#edf3fa" stroke-width="1"/>';
      grid += '<text x="' + (L - 7) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="10.5" fill="#8ba0b8">' + angka(skala * (1 - i / 4), 0) + '</text>';
      grid += '<text x="' + (W - R + 7) + '" y="' + (y + 3.5) + '" font-size="10.5" fill="#8ba0b8">' + (100 - i * 25) + '%</text>';
    }
    for (var h = 0; h <= 24; h += (sempit ? 6 : 4)) {
      var xx = x(h * 60);
      grid += '<line x1="' + xx + '" y1="' + T + '" x2="' + xx + '" y2="' + (T + ph) + '" stroke="#f1f6fc" stroke-width="1"/>';
      grid += '<text x="' + xx + '" y="' + (H - 12) + '" text-anchor="middle" font-size="10.5" fill="#8ba0b8">' + (h < 10 ? "0" : "") + h + ":00" + "</text>";
    }
    var pvPts = pv.map(function (v, idx) { return x(menit(sampel[idx].waktu)) + "," + yPv(v); });
    var socPts = soc.map(function (v, idx) { return x(menit(sampel[idx].waktu)) + "," + ySoc(v); });
    var x0 = x(menit(sampel[0].waktu)), x1 = x(menit(sampel[sampel.length - 1].waktu));
    var dasar = T + ph;
    var area = "M" + pvPts.join(" L") + " L" + x1 + "," + dasar + " L" + x0 + "," + dasar + " Z";
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Grafik Solar dan Battery SOC hari ini">' +
      '<defs><linearGradient id="dashSolarArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f8df4" stop-opacity=".38"/><stop offset="1" stop-color="#2f8df4" stop-opacity=".03"/></linearGradient></defs>' +
      grid +
      '<path d="' + area + '" fill="url(#dashSolarArea)"/>' +
      '<polyline points="' + pvPts.join(" ") + '" fill="none" stroke="#075dc5" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<polyline points="' + socPts.join(" ") + '" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="' + x1 + '" cy="' + yPv(pv[pv.length - 1]) + '" r="3.2" fill="#fff" stroke="#075dc5" stroke-width="2"/>' +
      '<circle cx="' + x1 + '" cy="' + ySoc(soc[soc.length - 1]) + '" r="3.2" fill="#fff" stroke="#38bdf8" stroke-width="2"/>' +
      '<text x="8" y="12" font-size="10" fill="#8ba0b8">W</text>' +
      "</svg>";
    box.innerHTML = svg;
  }

  function renderEnergyFlow(box, live) {
    if (!box) return;
    var pv = live ? watt(live.pvW) : "—";
    var beban = live ? watt(live.bebanW) : "—";
    var soc = live && live.socPct != null ? angka(live.socPct, 0) + "%" : "—";
    var gridLabel = "Grid Import";
    var gridValue = "—";
    if (live) {
      if (live.feedinpowerW > 0) { gridLabel = "Grid Export"; gridValue = watt(live.feedinpowerW); }
      else if (live.feedinpowerW < 0) { gridLabel = "Grid Import"; gridValue = watt(Math.abs(live.feedinpowerW)); }
      else { gridLabel = "Grid"; gridValue = "0 W"; }
    }
    var batSub = live && live.batPowerW != null
      ? (live.batPowerW > 0 ? "mengisi " : live.batPowerW < 0 ? "mengosongkan " : "") + watt(Math.abs(live.batPowerW))
      : "—";
    var gambarRumah = box.getAttribute("data-rumah") || "assets/rumah-energi.webp";
    var ikonSolar = box.getAttribute("data-ikon-solar") || "assets/ikon-solar-trim.webp";

    box.innerHTML =
      '<div class="dash-eflow">' +
        '<svg class="ef-lines" viewBox="0 0 760 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
          '<path d="M155 115 C225 125 270 145 310 165" stroke="#9cc4ea" stroke-width="2" fill="none" stroke-dasharray="4 5" class="ef-line"/>' +
          '<path d="M605 115 C535 125 490 145 450 165" stroke="#9cc4ea" stroke-width="2" fill="none" stroke-dasharray="4 5" class="ef-line"/>' +
          '<path d="M160 310 C225 295 270 280 305 268" stroke="#9cc4ea" stroke-width="2" fill="none" stroke-dasharray="4 5" class="ef-line ef-line-reverse"/>' +
          '<path d="M600 310 C535 295 490 280 455 268" stroke="#9cc4ea" stroke-width="2" fill="none" stroke-dasharray="4 5" class="ef-line ef-line-reverse"/>' +
          '<circle cx="310" cy="165" r="4" fill="#4c9ae0"/><circle cx="450" cy="165" r="4" fill="#4c9ae0"/>' +
          '<circle cx="305" cy="268" r="4" fill="#4c9ae0"/><circle cx="455" cy="268" r="4" fill="#4c9ae0"/>' +
        '</svg>' +
        '<img class="ef-rumah" src="' + esc(gambarRumah) + '" alt="Rumah dengan panel surya">' +
        '<div class="ef-label ef-solar"><span class="ef-ikon"><img src="' + esc(ikonSolar) + '" alt=""></span><span><small>Solar Generation</small><b>' + esc(pv) + '</b></span></div>' +
        '<div class="ef-label ef-grid"><span class="ef-ikon"><img src="assets/ikon-grid-trim.webp" alt=""></span><span><small>' + esc(gridLabel) + '</small><b>' + esc(gridValue) + '</b></span></div>' +
        '<div class="ef-label ef-battery"><span class="ef-ikon"><img src="assets/ikon-baterai-trim.webp" alt=""></span><span><small>Battery Storage</small><b>' + esc(soc) + '</b><em>' + esc(batSub) + '</em></span></div>' +
        '<div class="ef-label ef-load"><span class="ef-ikon"><img src="assets/ikon-konsumsi-trim.webp" alt=""></span><span><small>Consumption</small><b>' + esc(beban) + '</b></span></div>' +
      '</div>' +
      '<div class="dash-flow-foot"><span>Status <b>' + esc(live ? (live.inverterStatusTeks || "Normal") : "—") + '</b></span><span>Baterai <b>' + esc(soc) + '</b></span><span>Grid <b>' + esc(gridValue) + '</b></span></div>';
  }

  function renderFlow() {
    renderEnergyFlow($("dashFlow"), keadaan.live);
  }

  /* ---------------- Energy Analysis: PV Yield vs pemakaian meter ---------------- */
  var BULAN_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

  function dataEnergi(h) {
    var solax = (window.SOLAX_HARIAN_2026 || []).slice();
    var pvByDate = {}, consByDate = {}, importByDate = {};
    var usageByDate = {}, usageByMonth = {}, usageByYear = {};
    var appHarian = h && Array.isArray(h.harian) ? h.harian : [];
    appHarian.forEach(function (r) {
      if (r.pemakaian === null || r.pemakaian === undefined) return;
      var t = String(r.tanggal || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return;
      var v = Number(r.pemakaian) || 0;
      usageByDate[t] = v;
      usageByMonth[t.slice(0, 7)] = (usageByMonth[t.slice(0, 7)] || 0) + v;
      usageByYear[t.slice(0, 4)] = (usageByYear[t.slice(0, 4)] || 0) + v;
    });
    var months = {}, years = {};
    solax.forEach(function (r) {
      var t = String(r.tanggal || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return;
      var pv = Number(r.pvYield) || 0, cons = Number(r.consumptionKwh) || 0, imp = Number(r.importKwh) || 0;
      pvByDate[t] = pv; consByDate[t] = cons; importByDate[t] = imp;
      var mk = t.slice(0, 7), yk = t.slice(0, 4);
      if (!months[mk]) months[mk] = { key: mk, pv: 0, cons: 0, import: 0 };
      if (!years[yk]) years[yk] = { key: yk, pv: 0, cons: 0, import: 0 };
      months[mk].pv += pv; months[mk].cons += cons; months[mk].import += imp;
      years[yk].pv += pv; years[yk].cons += cons; years[yk].import += imp;
    });
    return {
      solax: solax, pvByDate: pvByDate, consByDate: consByDate, importByDate: importByDate,
      usageByDate: usageByDate, usageByMonth: usageByMonth, usageByYear: usageByYear,
      months: Object.keys(months).sort().map(function (k) { return months[k]; }),
      years: Object.keys(years).sort().map(function (k) { return years[k]; })
    };
  }

  function labelBulan(key) {
    var p = key.split("-");
    return BULAN_ID[Number(p[1]) - 1] + " " + p[0];
  }

  function renderEnergyAnalysis(h) {
    var box = $("dashEaChart");
    if (!box) return;
    if (!window.SOLAX_HARIAN_2026) {
      box.innerHTML = '<div class="dash-chart-empty">Data historis PV belum tersedia.</div>';
      return;
    }
    var data = dataEnergi(h);
    if (!data.months.length) {
      box.innerHTML = '<div class="dash-chart-empty">Belum ada data PV historis.</div>';
      return;
    }
    var sel = $("dashEaBulan");
    if (sel && !sel.options.length) {
      sel.innerHTML = data.months.map(function (m) {
        return '<option value="' + m.key + '">' + labelBulan(m.key) + "</option>";
      }).join("");
      keadaan.eaBulan = data.months[data.months.length - 1].key;
      sel.value = keadaan.eaBulan;
    }
    if (!keadaan.eaBulan || !data.months.some(function (m) { return m.key === keadaan.eaBulan; })) {
      keadaan.eaBulan = data.months[data.months.length - 1].key;
      if (sel) sel.value = keadaan.eaBulan;
    }
    if (sel) sel.classList.toggle("hidden", keadaan.eaMode !== "harian");

    var labels = [], pv = [], total = [], dariPv = [], meter = [], mode = keadaan.eaMode || "harian";
    if (mode === "harian") {
      var key = keadaan.eaBulan;
      var bagian = key.split("-"), th = Number(bagian[0]), bl = Number(bagian[1]);
      var jmlHari = new Date(th, bl, 0).getDate();
      for (var d = 1; d <= jmlHari; d++) {
        var tgl = key + "-" + (d < 10 ? "0" : "") + d;
        var c = data.consByDate[tgl] ?? null, imp = data.importByDate[tgl] ?? null;
        labels.push(String(d));
        pv.push(data.pvByDate[tgl] ?? null);
        total.push(c);
        dariPv.push(c == null ? null : Math.max(0, c - (imp || 0)));
        meter.push(data.usageByDate[tgl] ?? null);
      }
    } else if (mode === "bulanan") {
      data.months.forEach(function (m) {
        labels.push(labelBulan(m.key));
        pv.push(m.pv); total.push(m.cons);
        dariPv.push(Math.max(0, m.cons - m.import));
        meter.push(data.usageByMonth[m.key] ?? null);
      });
    } else {
      data.years.forEach(function (y) {
        labels.push(y.key);
        pv.push(y.pv); total.push(y.cons);
        dariPv.push(Math.max(0, y.cons - y.import));
        meter.push(data.usageByYear[y.key] ?? null);
      });
    }

    var pvTotal = 0, totalCons = 0, pvHome = 0, meterTotal = 0, meterCount = 0, totalGabungan = 0;
    pv.forEach(function (v) { if (v != null) pvTotal += v; });
    total.forEach(function (v) { if (v != null) totalCons += v; });
    dariPv.forEach(function (v) { if (v != null) pvHome += v; });
    meter.forEach(function (v) { if (v != null) { meterTotal += v; meterCount++; } });
    labels.forEach(function (_, i) {
      var pv = dariPv[i] || 0, mt = meter[i] || 0;
      if (dariPv[i] != null || meter[i] != null) totalGabungan += pv + mt;
    });

    renderEaSummary(pvTotal, totalCons, pvHome, meterTotal, meterCount, totalGabungan, mode);
    renderEaChart(labels, dariPv, meter);
  }

  function renderEaSummary(pv, cons, pvHome, meter, meterCount, totalGabungan, mode) {
    var box = $("dashEaSummary");
    if (!box) return;
    var periode = mode === "harian" ? "bulan ini" : mode === "bulanan" ? "Mei–November 2026" : "tahun 2026";
    var satuan = mode === "harian" ? "hari tercatat" : mode === "bulanan" ? "bulan tercatat" : "tahun tercatat";
    var porsiPv = cons > 0 ? pvHome / cons * 100 : null;
    var harga = keadaan.app && keadaan.app.settings ? Number(keadaan.app.settings.hargaKwh) || 1835 : 1835;
    function kartu(label, nilai, sub, warna, kwh) {
      var kali = kwh === null || kwh === undefined ? "—" :
        angka(kwh, 2) + " kWh × " + rp(harga) + " = " + rp(Math.round(kwh * harga));
      return '<div class="dash-ea-stat ' + (warna || "") + '"><span>' + esc(label) + "</span><b>" + esc(nilai) + "</b><small>" + esc(sub) + '</small><em class="dash-ea-kali">' + esc(kali) + "</em></div>";
    }
    box.innerHTML =
      kartu("PV Yield", angka(pv, 2) + " kWh", "produksi surya", "pv", pv) +
      kartu("Konsumsi rumah", angka(cons, 2) + " kWh", periode, "cons", cons) +
      kartu("Konsumsi Baterai", angka(pvHome, 2) + " kWh", porsiPv == null ? "porsi —" : "porsi " + angka(porsiPv, 0) + "%", "pvhome", pvHome) +
      kartu("Pemakaian token/meter", meter ? angka(meter, 2) + " kWh" : "—", meterCount + " " + satuan, "token", meter || null) +
      kartu("Total pemakaian", angka(totalGabungan, 2) + " kWh", "Konsumsi Baterai + token", "total", totalGabungan);
  }

  function renderEaChart(labels, dariPv, meter) {
    var box = $("dashEaChart");
    if (!box) return;
    var all = [];
    labels.forEach(function (_, i) {
      if (dariPv[i] != null || meter[i] != null) all.push((dariPv[i] || 0) + (meter[i] || 0));
    });
    if (!labels.length || !all.length) {
      box.innerHTML = '<div class="dash-chart-empty">Belum ada data untuk periode ini.</div>';
      return;
    }
    var W = 1000, H = 300, L = 54, R = 22, T = 18, B = 42;
    var pw = W - L - R, ph = H - T - B;
    var maks = Math.max.apply(null, all);
    var skala = Math.max(10, Math.ceil(maks / 10) * 10);
    var grup = pw / labels.length;
    var barW = Math.min(24, Math.max(4, grup * 0.28));
    var x = function (i) { return L + grup * i + grup / 2; };
    var y = function (v) { return T + ph - (v / skala) * ph; };
    var grid = "";
    for (var g = 0; g <= 4; g++) {
      var yy = T + ph * g / 4, val = skala * (1 - g / 4);
      grid += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '" stroke="#eaf2fb" stroke-width="1"/>';
      grid += '<text x="' + (L - 8) + '" y="' + (yy + 3.5) + '" text-anchor="end" font-size="10.5" fill="#8ba0b8">' + angka(val, 0) + "</text>";
    }
    var langkah = Math.max(1, Math.ceil(labels.length / 12));
    var bars = "";
    labels.forEach(function (lab, i) {
      var cx = x(i), bawah = T + ph;
      var pv = dariPv[i] || 0, mt = meter[i] || 0;
      var total = pv + mt;
      if (pv > 0) {
        var hPv = (pv / skala) * ph;
        bars += '<rect x="' + (cx - barW / 2) + '" y="' + (bawah - hPv) + '" width="' + barW + '" height="' + hPv + '" rx="3" fill="#075dc5"><title>' + esc(lab + ": Konsumsi Baterai " + angka(pv, 2) + " kWh • total " + angka(total, 2) + " kWh") + "</title></rect>";
      }
      if (mt > 0) {
        var hMt = (mt / skala) * ph;
        var yMt = bawah - ((pv + mt) / skala) * ph;
        bars += '<rect x="' + (cx - barW / 2) + '" y="' + yMt + '" width="' + barW + '" height="' + hMt + '" rx="3" fill="#93c5fd"><title>' + esc(lab + ": token/meter " + angka(mt, 2) + " kWh • total " + angka(total, 2) + " kWh") + "</title></rect>";
      }
      if (i % langkah === 0 || i === labels.length - 1) {
        grid += '<text x="' + cx + '" y="' + (H - 15) + '" text-anchor="middle" font-size="10.5" fill="#8ba0b8">' + esc(lab) + "</text>";
      }
    });
    box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Grafik Konsumsi Baterai dan pemakaian token">' +
      grid + bars + '<text x="8" y="12" font-size="10" fill="#8ba0b8">kWh</text></svg>';
  }

  function renderEaLive() {
    var box = $("dashEaLive");
    if (!box) return;
    var live = keadaan.live;
    if (!live) {
      box.innerHTML = "<span>Data live belum tersedia</span>";
      return;
    }
    var grid = live.feedinpowerW == null ? "—" : live.feedinpowerW === 0 ? "0 W" : live.feedinpowerW > 0 ? "Ekspor " + watt(live.feedinpowerW) : "Impor " + watt(Math.abs(live.feedinpowerW));
    box.innerHTML = "<span>PV sekarang <b>" + esc(watt(live.pvW)) + "</b></span>" +
      "<span>Beban sekarang <b>" + esc(watt(live.bebanW)) + "</b></span>" +
      "<span>Grid <b>" + esc(grid) + "</b></span>" +
      "<span>Baterai <b>" + (live.socPct == null ? "—" : angka(live.socPct, 0) + "%") + "</b></span>" +
      "<span>PV hari ini <b>" + (live.yieldTodayKwh == null ? "—" : angka(live.yieldTodayKwh, 2) + " kWh") + "</b></span>";
  }

  function renderUsage(h) {
    var box = $("dashUsage");
    if (!box) return;
    var bulanan = h && Array.isArray(h.bulanan) ? h.bulanan.slice(-6) : [];
    if (!bulanan.length) {
      box.innerHTML = '<div class="dash-chart-empty">Belum ada catatan bulanan.</div>';
      if ($("dashUsageTotal")) $("dashUsageTotal").textContent = "—";
      return;
    }
    var maks = Math.max.apply(null, bulanan.map(function (b) { return b.kwh || 0; })) || 1;
    var aktif = h.bulanAktif;
    box.innerHTML = '<div class="dash-bars">' + bulanan.map(function (b) {
      var persen = Math.max(3, Math.round((b.kwh || 0) / maks * 100));
      var nama = String(b.label || b.key).split(" ")[0].slice(0, 3);
      return '<div class="dash-bar-item' + (b.key === aktif ? " now" : "") + '">' +
        '<div class="dash-bar-track"><div class="dash-bar" style="height:' + persen + '%"></div></div>' +
        "<b>" + angka(b.kwh || 0, 1) + "</b><small>" + esc(nama) + "</small></div>";
    }).join("") + "</div>" +
      '<div class="dash-bars-note">Total 6 bulan: ' + angka(bulanan.reduce(function (s, b) { return s + (b.kwh || 0); }, 0), 1) + " kWh</div>";
    if ($("dashUsageTotal")) {
      var terpilih = bulanan.filter(function (b) { return b.key === aktif; })[0] || bulanan[bulanan.length - 1];
      $("dashUsageTotal").textContent = angka(terpilih.kwh || 0, 1) + " kWh";
    }
  }

  function renderHealth() {
    var box = $("dashHealth");
    if (!box) return;
    var live = keadaan.live;
    var soc = live && live.socPct != null ? Math.max(0, Math.min(100, Number(live.socPct))) : 0;
    var r = 54, c = 2 * Math.PI * r;
    var panjang = c * soc / 100;
    var soh = live && live.batterySohPct != null ? live.batterySohPct : null;
    box.innerHTML = '<div class="dash-health">' +
      '<div class="dash-ring">' +
        '<svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="' + r + '" fill="none" stroke="#eaf2fb" stroke-width="10"/>' +
        '<circle cx="66" cy="66" r="' + r + '" fill="none" stroke="#075dc5" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + panjang + " " + (c - panjang) + '"/></svg>' +
        '<div class="dash-ring-teks"><b>' + (live && live.socPct != null ? angka(live.socPct, 0) : "—") + '%</b><span>Battery SOC</span></div>' +
      "</div>" +
      '<div class="dash-health-list">' +
        '<div class="dash-health-row"><span>Status sistem</span><b class="ok">Normal Off-grid</b></div>' +
        '<div class="dash-health-row"><span>Kesehatan baterai (SOH)</span><b class="' + (soh != null && soh >= 80 ? "ok" : soh != null ? "warn" : "") + '">' + (soh == null ? "—" : angka(soh, 0) + "%") + "</b></div>" +
        '<div class="dash-health-row"><span>Suhu inverter</span><b>' + (live && live.temperatureC != null ? angka(live.temperatureC, 0) + "°C" : "—") + "</b></div>" +
        '<div class="dash-health-row"><span>Data inverter</span><b>' + (live && live.uploadTime ? esc(formatWaktu(live.uploadTime)) : "—") + "</b></div>" +
      "</div></div>";
  }

  function formatWaktu(teks) {
    var s = String(teks || "");
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(s);
    if (m) return m[3] + "-" + m[2] + "-" + m[1] + " " + m[4];
    return s;
  }

  function renderTable(h) {
    var box = $("dashTable");
    if (!box) return;
    var data = h && Array.isArray(h.harian) ? h.harian.slice(-6).reverse() : [];
    if (!data.length) {
      box.innerHTML = '<div class="dash-chart-empty">Belum ada catatan pemakaian.</div>';
      return;
    }
    box.innerHTML = '<table class="dash-table"><thead><tr><th>Tanggal</th><th class="num">Sisa</th><th class="num">Pemakaian</th><th class="num">Biaya</th><th>Catatan</th></tr></thead><tbody>' +
      data.map(function (r, idx) {
        var label = window.KwhCore ? window.KwhCore.labelTanggal(r.tanggal, false) : r.tanggal;
        return "<tr" + (idx === 0 ? ' class="dash-row-latest"' : "") + "><td class=\"tanggal\">" + esc(label) + "<small>" + esc(r.hari || "") + "</small></td>" +
          '<td class="num">' + (r.sisa == null ? "—" : angka(r.sisa, 0)) + "</td>" +
          '<td class="num">' + (r.pemakaian == null ? "—" : angka(r.pemakaian, 1) + " kWh") + "</td>" +
          '<td class="num">' + (r.biaya == null ? "—" : rp(r.biaya)) + "</td>" +
          "<td>" + (r.catatan ? '<span class="note">' + esc(r.catatan) + "</span>"
            : r.pltsOff ? '<span class="dash-badge off">PLTS off</span>' : '<span class="dash-badge">Normal</span>') + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  function renderSummary(h) {
    var box = $("dashSummary");
    if (!box) return;
    var r = h && h.ringkasan;
    if (!r) {
      box.innerHTML = '<div class="dash-chart-empty">Data belum tersedia.</div>';
      return;
    }
    var baris = [
      ["Rata-rata harian", angka(r.rataHarian, 2) + " kWh"],
      ["Rata-rata 14 hari", angka(r.rata14, 2) + " kWh"],
      ["Proyeksi 30 hari", rp(r.proyeksi30Rp)],
      ["Estimasi token habis", r.estimasiHari == null ? "—" : r.estimasiHari + " hari"],
      ["Jumlah catatan", angka(r.jumlahCatatan, 0) + " catatan"]
    ];
    box.innerHTML = '<div class="dash-summary-list">' + baris.map(function (b) {
      return '<div class="dash-summary-row"><span>' + esc(b[0]) + "</span><b>" + esc(b[1]) + "</b></div>";
    }).join("") + "</div>";
  }

  function muatApp() {
    var h = bacaApp();
    keadaan.app = h;
    renderHero(h);
    renderKpis(h);
    renderUsage(h);
    renderTable(h);
    renderSummary(h);
    renderEnergyAnalysis(h);
  }

  function muatLive() {
    return panggil("/api/solax/status").then(function (jawab) {
      if (jawab && jawab.ok && jawab.terkonfigurasi && jawab.data) {
        keadaan.live = jawab.data;
      } else {
        keadaan.live = null;
      }
      renderHero(keadaan.app);
      renderKpis(keadaan.app);
      renderLive(keadaan.app);
      renderFlow();
      renderHealth();
      renderEaLive();
    });
  }

  function muatGrafik() {
    return panggil("/api/solax/grafik").then(function (jawab) {
      renderChart(jawab && jawab.ok ? jawab : null);
    });
  }

  function muat() {
    muatApp();
    muatLive();
    if ($("dashChart")) muatGrafik();
  }

  function mulaiTimer() {
    hentikanTimer();
    keadaan.timer = setInterval(function () {
      if (keadaan.aktif && !document.hidden) muat();
    }, 30000);
  }

  function hentikanTimer() {
    if (keadaan.timer) { clearInterval(keadaan.timer); keadaan.timer = null; }
  }

  function setAktif(aktif) {
    aktif = !!aktif;
    if (keadaan.aktif === aktif) return;
    keadaan.aktif = aktif;
    if (aktif) {
      muat();
      mulaiTimer();
    } else {
      hentikanTimer();
    }
  }

  window.DashboardListrik = { muat: muat, setAktif: setAktif };
  window.EnergyFlowRender = renderEnergyFlow;

  function mulai() {
    var el = $("halaman-dashboard");
    if (!el) return;
    var tabs = $("dashEaTabs");
    if (tabs) tabs.addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-ea]");
      if (!b) return;
      keadaan.eaMode = b.getAttribute("data-ea");
      Array.prototype.forEach.call(tabs.querySelectorAll("button"), function (x) { x.classList.toggle("on", x === b); });
      renderEnergyAnalysis(keadaan.app);
    });
    var selBulan = $("dashEaBulan");
    if (selBulan) selBulan.addEventListener("change", function () {
      keadaan.eaBulan = selBulan.value;
      renderEnergyAnalysis(keadaan.app);
    });
    if (!el.classList.contains("hidden")) setAktif(true);
    else if ((window.location.hash || "").replace("#", "") === "dashboard") setAktif(true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mulai);
  else mulai();
})();
