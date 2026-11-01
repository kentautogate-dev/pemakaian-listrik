/*
 * backup.js — halaman "Backup & Restore" (helper lokal L:\ dan GitHub).
 * Memakai server-backup.js di http://127.0.0.1:8787 (bisa diganti lewat localStorage
 * "kwh-backup-url" untuk pengujian).
 */
(function () {
  "use strict";

  var URL_HELPER = (function () {
    try {
      return localStorage.getItem("kwh-backup-url") || "http://127.0.0.1:8787";
    } catch (e) {
      return "http://127.0.0.1:8787";
    }
  })();

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var jam = function (iso) {
    var d = iso ? new Date(iso) : new Date();
    return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  var tanggalJam = function (iso) {
    var d = iso ? new Date(iso) : new Date();
    return d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  var keadaaan = {
    helperAktif: false,
    status: null,
    konfigurasi: null,
    sibuk: false,
    jobId: null,
    timerPoll: null,
    logTerakhir: 0,
    konteksJob: null,
    halamanBackup: false,
    terakhirCek: 0
  };

  /* ---------------- panggil API ---------------- */
  function panggil(jalur, opsi) {
    opsi = opsi || {};
    var url = URL_HELPER + jalur;
    var kontrol = typeof AbortController !== "undefined" ? new AbortController() : null;
    var batas = opsi.batasDetik || 12;
    var timer = setTimeout(function () { if (kontrol) kontrol.abort(); }, batas * 1000);
    var opsiFetch = { method: opsi.metode || "GET", headers: {}, signal: kontrol ? kontrol.signal : undefined };
    if (opsi.body !== undefined) {
      opsiFetch.headers["Content-Type"] = "application/json";
      opsiFetch.body = JSON.stringify(opsi.body);
    }
    return fetch(url, opsiFetch)
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

  /* ---------------- tampilkan halaman ---------------- */
  function tampilkanLaman(nama) {
    var tombolNav = document.querySelectorAll("#navLaman button");
    Array.prototype.forEach.call(tombolNav, function (b) {
      b.classList.toggle("on", b.dataset.laman === nama);
    });
    var pencatatan = $("halaman-pencatatan");
    var backup = $("halaman-backup");
    var keBackup = nama === "backup";
    pencatatan.classList.toggle("hidden", keBackup);
    backup.classList.toggle("hidden", !keBackup);
    keadaaan.halamanBackup = keBackup;
    if (keBackup) {
      muatStatus();
      isiFormKonfigurasi();
      if (typeof window.scrollTo === "function") window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (typeof window.scrollTo === "function") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    try {
      history.replaceState(null, "", keBackup ? "#backup" : "#catatan");
    } catch (e) { /* file:// kadang membatasi history */ }
  }

  /* ---------------- status ---------------- */
  function muatStatus() {
    var sebelumnyaAktif = keadaaan.helperAktif;
    $("bk-status").innerHTML = "<li class='muted'>Memeriksa helper backup…</li>";
    return panggil("/api/status", { batasDetik: 6 }).then(function (jawab) {
      if (!jawab || !jawab.ok) {
        keadaaan.helperAktif = false;
        keadaaan.status = null;
        tampilkanOffline(jawab && jawab.offline ? "Helper belum dijalankan." : (jawab && jawab.galat) || "Gagal memeriksa helper.");
        return;
      }
      keadaaan.helperAktif = true;
      keadaaan.status = jawab;
      keadaaan.cobaanOffline = 0;
      if (keadaaan.timerCobaLagi) { clearTimeout(keadaaan.timerCobaLagi); keadaaan.timerCobaLagi = null; }
      $("bk-offline").classList.add("hidden");
      tampilkanStatus(jawab);
      setSibuk(!!keadaaan.jobId);
      if (!sebelumnyaAktif) {
        // baru saja tersambung (mis. helper baru dinyalakan) — isi form & daftar
        isiFormKonfigurasi();
        muatDaftar();
      }
      if (jawab.jobAktif && !keadaaan.jobId) {
        // ada proses yang berjalan saat halaman dimuat/di-refresh
        pantauJob(jawab.jobAktif, null);
      }
    });
  }

  function tampilkanOffline(pesan) {
    keadaaan.helperAktif = false;
    var box = $("bk-offline");
    box.classList.remove("hidden");
    isiBantuanOffline(pesan);
    $("bk-status").innerHTML =
      "<li><span class='status-tanda mati'></span><b>Helper backup</b><span class='status-nilai'>tidak aktif</span></li>" +
      "<li><span class='status-tanda mati'></span><b>Drive L:\\</b><span class='status-nilai'>belum dicek</span></li>" +
      "<li><span class='status-tanda mati'></span><b>GitHub</b><span class='status-nilai'>belum dicek</span></li>";
    setSibuk(true);
    jadwalkanCobaLagi();
  }

  /* ---------------- panduan menyalakan helper ---------------- */
  function folderAplikasi() {
    try {
      if (window.location.protocol !== "file:") return null;
      var jalur = decodeURIComponent(window.location.pathname || "").replace(/^\/+/, "");
      var bagian = jalur.split("/");
      bagian.pop(); // buang index.html
      var folder = bagian.join("\\");
      return folder || null;
    } catch (e) {
      return null;
    }
  }

  function isiBantuanOffline(pesan) {
    var folder = keadaaan.folderAplikasi || folderAplikasi();
    keadaaan.folderAplikasi = folder;
    var kotak = $("bk-offlineIsi");
    if (!kotak) return;

    var html = "";
    if (folder) {
      var urlFolder = "file:///" + folder.replace(/\\/g, "/");
      html += "<ol class='langkah'>" +
        "<li>Buka folder aplikasi:<br><code>" + esc(folder) + "</code> " +
        '<a class="tautan" href="' + esc(urlFolder) + '" target="_blank" rel="noopener">buka folder</a></li>' +
        "<li>Klik dua kali <code>mulai-backup.cmd</code>. Jendela hitam <b>Helper Backup Listrik</b> akan terbuka, dan aplikasi ikut terbuka di tab baru.</li>" +
        "<li>Kembali ke halaman ini — status akan hijau otomatis (halaman ini mencoba tiap 3 detik), atau tekan <b>Coba lagi</b>.</li>" +
        "</ol>";
    } else {
      html += "<ol class='langkah'><li>Jalankan <code>node server-backup.js</code> di folder aplikasi.</li>" +
        "<li>Tekan <b>Coba lagi</b>.</li></ol>";
    }
    kotak.innerHTML = html +
      '<p class="perintah-manual">Perintah manual (bila perlu): <code id="bk-perintah">' + esc(perintahManual()) + "</code></p>";

    var tombolSalin = $("bk-salinPerintah");
    if (tombolSalin) tombolSalin.disabled = !folder;
    $("bk-offlineInfo").textContent =
      (pesan ? pesan + " " : "") + "Alamat helper: " + URL_HELPER;
  }

  function perintahManual() {
    var folder = keadaaan.folderAplikasi || folderAplikasi();
    if (folder) return 'cd /d "' + folder + '" && node server-backup.js';
    return "node server-backup.js";
  }

  function salinPerintah() {
    var teks = perintahManual();
    var berhasil = function () {
      window.AplikasiListrik.toast("Perintah disalin — tempel di Command Prompt lalu Enter.", "ok");
    };
    var gagal = function () {
      window.AplikasiListrik.toast("Salin manual: " + teks, "info");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(teks).then(berhasil, function () { salinCaraLama(teks, berhasil, gagal); });
    } else {
      salinCaraLama(teks, berhasil, gagal);
    }
  }

  function salinCaraLama(teks, berhasil, gagal) {
    var ta = document.createElement("textarea");
    ta.value = teks;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    try {
      var ok = document.execCommand("copy");
      if (ok) berhasil(); else gagal();
    } catch (e) {
      gagal();
    }
    ta.remove();
  }

  function jadwalkanCobaLagi() {
    if (keadaaan.timerCobaLagi) return;
    keadaaan.cobaanOffline = (keadaaan.cobaanOffline || 0) + 1;
    if (keadaaan.cobaanOffline > 20) return; // berhenti setelah ±1 menit
    keadaaan.timerCobaLagi = setTimeout(function () {
      keadaaan.timerCobaLagi = null;
      if (!keadaaan.helperAktif) muatStatus();
    }, 3000);
  }

  function tampilkanStatus(s) {
    var github = s.github || {};
    var folder = s.folderBackup || {};
    var repoAda = !!github.repo;
    var baris = [];

    baris.push(
      "<li><span class='status-tanda hidup'></span><b>Helper backup</b>" +
      "<span class='status-nilai'>aktif • " + esc(URL_HELPER.replace(/^https?:\/\//, "")) + " • v" + esc(s.versi || "") + "</span></li>"
    );

    baris.push(
      "<li><span class='status-tanda " + (folder.ada ? "hidup" : "mati") + "'></span><b>Drive L:\\</b>" +
      "<span class='status-nilai'>" +
      (folder.ada
        ? esc(folder.path || "") + " • bebas " + Number(folder.bebasMB || 0).toLocaleString("id-ID") + " MB"
        : "folder backup belum ada (dibuat otomatis saat backup pertama)") +
      "</span></li>"
    );

    if (repoAda) {
      baris.push(
        "<li><span class='status-tanda hidup'></span><b>GitHub</b>" +
        "<span class='status-nilai'>" + (github.remote ? "remote: " + esc(github.remote) : "repo lokal siap") +
        " • cabang " + esc(github.cabang || "-") +
        (github.commit ? " • commit " + esc(github.commit) : "") +
        (github.kotor ? " • ada perubahan belum di-commit" : "") +
        "</span></li>"
      );
    } else {
      baris.push(
        "<li><span class='status-tanda nunggu'></span><b>GitHub</b>" +
        "<span class='status-nilai'>" +
        (keadaaan.konfigurasi && keadaaan.konfigurasi.repoGithub
          ? "repo belum dibuat — akan otomatis dibuat saat backup pertama"
          : "URL repo belum diisi di pengaturan") +
        "</span></li>"
      );
    }

    baris.push(
      "<li><span class='status-tanda " + (Number(s.snapshots) > 0 ? "hidup" : "nunggu") + "'></span><b>Snapshot L:\\</b>" +
      "<span class='status-nilai'>" + Number(s.snapshots || 0) + " backup tersimpan</span></li>"
    );
    baris.push(
      "<li><span class='status-tanda " + (s.project && s.project.jumlahBerkas ? "hidup" : "nunggu") + "'></span><b>File project</b>" +
      "<span class='status-nilai'>" + (s.project ? Number(s.project.jumlahBerkas || 0) + " berkas di " + esc(s.project.folder || "") : "-") + "</span></li>"
    );

    $("bk-status").innerHTML = baris.join("");
    keadaaan.terakhirCek = Date.now();
  }

  function isiFormKonfigurasi() {
    if (keadaaan.konfigurasi) {
      $("bk-folder").value = keadaaan.konfigurasi.folderBackup || "";
      $("bk-repo").value = keadaaan.konfigurasi.repoGithub || "";
      $("bk-cabang").value = keadaaan.konfigurasi.cabang || "main";
      return;
    }
    panggil("/api/konfigurasi").then(function (jawab) {
      if (jawab && jawab.ok && jawab.konfigurasi) {
        keadaaan.konfigurasi = jawab.konfigurasi;
        $("bk-folder").value = jawab.konfigurasi.folderBackup || "";
        $("bk-repo").value = jawab.konfigurasi.repoGithub || "";
        $("bk-cabang").value = jawab.konfigurasi.cabang || "main";
      }
    });
  }

  function simpanKonfigurasi() {
    var body = {
      folderBackup: $("bk-folder").value.trim(),
      repoGithub: $("bk-repo").value.trim(),
      cabang: $("bk-cabang").value.trim() || "main"
    };
    if (!body.folderBackup) {
      window.AplikasiListrik.toast("Folder backup di L:\\ belum diisi.", "error");
      return;
    }
    setSibuk(true);
    panggil("/api/konfigurasi", { metode: "POST", body: body }).then(function (jawab) {
      setSibuk(false);
      if (!jawab || !jawab.ok) {
        window.AplikasiListrik.toast((jawab && jawab.galat) || "Gagal menyimpan pengaturan.", "error");
        return;
      }
      keadaaan.konfigurasi = jawab.konfigurasi;
      window.AplikasiListrik.toast("Pengaturan backup disimpan.", "ok");
      muatStatus();
      muatDaftar();
      cekRepo();
    });
  }

  /* ---------------- cek URL repo GitHub ---------------- */
  function cekRepo() {
    var url = $("bk-repo").value.trim();
    var box = $("bk-hasilCekRepo");
    var tombol = $("bk-cekRepo");
    if (!url) {
      window.AplikasiListrik.toast("Isi URL repo GitHub dulu.", "error");
      $("bk-repo").focus();
      return;
    }
    box.classList.remove("hidden", "ok", "gagal");
    box.innerHTML = "Memeriksa repo…";
    if (tombol) tombol.disabled = true;
    panggil("/api/cek-github", { metode: "POST", body: { url: url }, batasDetik: 45 }).then(function (jawab) {
      if (tombol) tombol.disabled = false;
      if (!jawab || !jawab.ok) {
        box.classList.add("gagal");
        box.innerHTML = "<b>Tidak bisa memeriksa repo:</b> " + esc((jawab && jawab.galat) || "galat");
        return;
      }
      box.classList.add(jawab.akses ? "ok" : "gagal");
      var html = "<b>" + (jawab.akses ? "✓ " : "! ") + esc(jawab.pesan) + "</b>";
      html += '<div class="hint" style="margin-top:6px">Akun <code>' + esc(jawab.owner) + "</code>: " +
        (jawab.akunAda === true ? "ada" : jawab.akunAda === false ? "TIDAK ada" : "tidak diketahui") +
        " • Repo publik: " + (jawab.repoPublikAda === true ? "ada" : jawab.repoPublikAda === false ? "tidak terlihat" : "tidak diketahui") +
        " • Git: " + (jawab.akses ? "bisa diakses" : "tidak bisa diakses") + "</div>";
      if (jawab.langkah && jawab.langkah.length) {
        html += "<ol>" + jawab.langkah.map(function (l) { return "<li>" + l + "</li>"; }).join("") + "</ol>";
      }
      html += '<div class="hint" style="margin-top:6px">URL: <code>' + esc(jawab.url) + "</code></div>";
      box.innerHTML = html;
      window.AplikasiListrik.toast(
        jawab.akses ? "Repo bisa diakses — siap backup." : "Repo belum siap — lihat saran di bawah kolom URL.",
        jawab.akses ? "ok" : "info"
      );
      if (jawab.akses) setSibuk(keadaaan.sibuk);
    });
  }

  /* ---------------- progress & log ---------------- */
  function setSibuk(sibuk) {
    keadaaan.sibuk = !!sibuk;
    var tombol = ["bk-mulaiBackup", "bk-mulaiRestore", "bk-muatDaftar", "bk-simpanPengaturan", "bk-cekStatus"];
    tombol.forEach(function (id) {
      var b = $(id);
      if (b) b.disabled = !!sibuk || !keadaaan.helperAktif;
    });
  }

  function mulaiProses(label) {
    $("bk-proses").classList.remove("hidden");
    $("bk-labelProses").textContent = label;
    perbaruiProses(0, "menyiapkan…");
    $("bk-log").innerHTML = "";
    keadaaan.logTerakhir = 0;
    $("bk-reload").classList.add("hidden");
    $("bk-saranGalat").classList.add("hidden");
    $("bk-saranGalat").innerHTML = "";
  }

  function perbaruiProses(persen, tahap) {
    var p = Math.max(0, Math.min(100, Math.round(persen || 0)));
    $("bk-persen").textContent = p + "%";
    $("bk-bar").style.width = p + "%";
    $("bk-barWrap").setAttribute("aria-valuenow", String(p));
    if (tahap) $("bk-tahap").textContent = tahap;
  }

  function tambahLog(waktu, persen, pesan, jenis) {
    var li = document.createElement("li");
    if (jenis) li.className = jenis;
    li.innerHTML = "<span class='log-waktu'>" + esc(waktu ? jam(waktu) : jam()) + "</span>" +
      "<span class='log-persen'>" + (persen === null || persen === undefined ? "" : Math.round(persen) + "%") + "</span>" +
      "<span class='log-pesan'>" + esc(pesan) + "</span>";
    var log = $("bk-log");
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
  }

  /* ---------------- mulai backup / restore ---------------- */
  function mulaiBackup() {
    if (!keadaaan.helperAktif) { window.AplikasiListrik.toast("Helper backup belum aktif.", "error"); return; }
    var sumber = $("bk-sumber").value;
    var sertakanProject = $("bk-project").checked;
    var pesan = $("bk-pesan").value.trim();

    if ((sumber === "github" || sumber === "keduanya") && !$("bk-repo").value.trim()) {
      window.AplikasiListrik.toast("Isi URL repo GitHub dulu di Pengaturan backup.", "error");
      $("bk-repo").focus();
      return;
    }
    if (sumber === "github" || sumber === "keduanya") {
      var yakin = window.confirm(
        "Backup ke GitHub akan meng-commit dan meng-push file project + data ke repo:\n" +
        ($("bk-repo").value.trim() || "(belum diisi)") +
        "\n\nLanjutkan?"
      );
      if (!yakin) return;
    }

    setSibuk(true);
    mulaiProses("Backup ke " + (sumber === "lokal" ? "L:\\" : sumber === "github" ? "GitHub" : "L:\\ + GitHub"));
    var data = window.AplikasiListrik.ambilState();
    panggil("/api/backup", {
      metode: "POST",
      batasDetik: 20,
      body: { sumber: sumber, project: sertakanProject, data: data, pesan: pesan }
    }).then(function (jawab) {
      if (!jawab || !jawab.ok) {
        akhiriDenganGalat((jawab && jawab.galat) || "Gagal memulai backup.");
        setSibuk(false);
        return;
      }
      pantauJob(jawab.jobId, "backup");
    });
  }

  function mulaiRestore() {
    if (!keadaaan.helperAktif) { window.AplikasiListrik.toast("Helper backup belum aktif.", "error"); return; }
    var sumber = $("bk-restoreSumber").value;
    var bagian = $("bk-bagian").value;
    var pilihan = $("bk-snapshot").value;
    if (!pilihan) {
      window.AplikasiListrik.toast("Pilih snapshot / versi yang mau dipulihkan (tekan Muat daftar).", "error");
      return;
    }
    var pesanYakin;
    if (bagian === "data") {
      pesanYakin = "Data catatan di browser ini akan DIGANTI dengan data backup " + pilihan + ".\n\nLanjutkan?";
    } else if (bagian === "project") {
      pesanYakin = "File project (kode aplikasi, laporan) akan DITIMPA dengan versi backup " + pilihan +
        ".\nCadangan keamanan otomatis dibuat dulu, dan halaman perlu dimuat ulang.\n\nLanjutkan?";
    } else {
      pesanYakin = "Data catatan di browser DIGANTI dan file project DITIMPA dengan versi backup " + pilihan +
        ".\nCadangan keamanan otomatis dibuat dulu.\n\nLanjutkan?";
    }
    if (!window.confirm(pesanYakin)) return;

    var body = { sumber: sumber, bagian: bagian };
    if (sumber === "lokal") body.snapshot = pilihan;
    else body.commit = pilihan;

    setSibuk(true);
    mulaiProses("Restore dari " + (sumber === "lokal" ? "L:\\" : "GitHub"));
    panggil("/api/restore", { metode: "POST", batasDetik: 20, body: body }).then(function (jawab) {
      if (!jawab || !jawab.ok) {
        akhiriDenganGalat((jawab && jawab.galat) || "Gagal memulai restore.");
        setSibuk(false);
        return;
      }
      pantauJob(jawab.jobId, "restore", { bagian: bagian });
    });
  }

  function akhiriDenganGalat(pesan) {
    tambahLog(null, null, pesan, "galat");
    perbaruiProses(0, "gagal");
    $("bk-persen").textContent = "—";
    tampilkanSaranGalat(pesan);
    window.AplikasiListrik.toast(pesan, "error");
  }

  /* ---------------- saran perbaikan dari galat ---------------- */
  function tampilkanSaranGalat(pesan) {
    var box = $("bk-saranGalat");
    if (!box) return;
    var teks = String(pesan || "");
    var langkah = [];
    if (/repo github tidak ditemukan|repository not found|tidak bisa diakses|404/i.test(teks)) {
      langkah = [
        "Buka <a href='https://github.com/new' target='_blank' rel='noopener' class='tautan'>github.com/new</a> lalu buat repo <b>kosong</b> (jangan centang README/.gitignore), nama misal <b>pemakaian-listrik</b>.",
        "Pastikan <b>username GitHub</b> di URL benar: <code>https://github.com/&lt;username&gt;/pemakaian-listrik.git</code>. Username berbeda dengan email/nama tampilan — lihat di halaman profil GitHub Anda.",
        "Bila repo dibuat <b>private</b>, login dulu: klik dua kali <code>login-github.cmd</code>.",
        "Tempel URL yang benar di <b>Pengaturan backup</b> → <b>Simpan pengaturan</b>, lalu ulangi backup."
      ];
    } else if (/menolak login|authentication|login|credential|username/i.test(teks)) {
      langkah = [
        "Klik dua kali <code>login-github.cmd</code> di folder aplikasi untuk login GitHub.",
        "Ikuti jendela login sampai muncul <i>[OK] Login &amp; push berhasil</i>.",
        "Kembali ke halaman ini lalu ulangi backup."
      ];
    } else if (/non-fast-forward|fetch first|rejected|commit yang tidak ada/i.test(teks)) {
      langkah = [
        "Repo GitHub sudah memiliki commit yang tidak ada di komputer ini.",
        "Pulihkan dulu lewat <b>Restore → GitHub</b>, atau buat repo GitHub baru yang kosong lalu ganti URL-nya."
      ];
    } else if (/jaringan|network|resolve host|timeout|ssl/i.test(teks)) {
      langkah = ["Periksa koneksi internet (dan proxy/VPN), lalu ulangi backup."];
    }
    if (!langkah.length) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    box.classList.remove("hidden");
    box.innerHTML = "<b>Saran perbaikan:</b><ol class='langkah'>" +
      langkah.map(function (l) { return "<li>" + l + "</li>"; }).join("") + "</ol>";
  }

  /* ---------------- polling job ---------------- */
  function pantauJob(jobId, konteks, info) {
    if (keadaaan.timerPoll) clearTimeout(keadaaan.timerPoll);
    keadaaan.jobId = jobId;
    keadaaan.konteksJob = konteks;
    keadaaan.infoJob = info || {};
    if (!konteks) {
      mulaiProses("Memantau proses yang berjalan");
    } else {
      mulaiProses(konteks === "backup" ? "Backup berjalan" : "Restore berjalan");
    }
    setSibuk(true);

    var langkah = function () {
      panggil("/api/job/" + encodeURIComponent(jobId), { batasDetik: 10 }).then(function (jawab) {
        if (!jawab || !jawab.ok || !jawab.job) {
          akhiriDenganGalat((jawab && jawab.galat) || "Job tidak ditemukan.");
          keadaaan.jobId = null;
          setSibuk(false);
          return;
        }
        var job = jawab.job;
        perbaruiProses(job.persen, job.tahap);
        var log = job.log || [];
        for (var i = keadaaan.logTerakhir; i < log.length; i++) {
          tambahLog(log[i].waktu, log[i].persen, log[i].pesan, log[i].jenis);
        }
        keadaaan.logTerakhir = log.length;

        if (!job.selesai) {
          keadaaan.timerPoll = setTimeout(langkah, 250);
          return;
        }

        keadaaan.jobId = null;
        setSibuk(false);
        if (job.galat) {
          perbaruiProses(job.persen, "gagal");
          tambahLog(null, null, job.galat, "galat");
          tampilkanSaranGalat(job.galat);
          window.AplikasiListrik.toast(job.galat, "error");
          muatStatus();
          return;
        }
        perbaruiProses(100, "selesai");
        selesaikanJob(job, keadaaan.konteksJob, keadaaan.infoJob);
        muatStatus();
        muatDaftar();
      });
    };
    langkah();
  }

  function selesaikanJob(job, konteks, info) {
    var hasil = job.hasil || {};
    info = info || {};
    if (konteks === "backup") {
      if (hasil.snapshot) {
        tambahLog(null, 100, "Snapshot L:\\ dibuat: " + hasil.snapshot +
          (hasil.jumlahBerkas ? " (" + hasil.jumlahBerkas + " berkas project)" : ""));
      }
      if (hasil.commit) {
        tambahLog(null, 100, "GitHub: commit " + hasil.commit + " dikirim ke " + (hasil.remote || "remote") +
          " (cabang " + (hasil.cabang || "-") + ").");
      }
      window.AplikasiListrik.toast("Backup selesai.", "ok");
      return;
    }

    // restore
    if (info.bagian === "data" || info.bagian === "keduanya") {
      if (hasil.data && typeof hasil.data === "object") {
        var jumlah = hasil.data.catatan && hasil.data.catatan.length ? hasil.data.catatan.length : 0;
        window.AplikasiListrik.terapkanState(hasil.data);
        tambahLog(null, 100, "Data catatan dipulihkan dari backup (" + jumlah + " catatan).");
        window.AplikasiListrik.toast("Data catatan berhasil dipulihkan (" + jumlah + " catatan).", "ok");
      } else {
        tambahLog(null, 100, "Backup tidak berisi data catatan — data browser tidak diubah.", "galat");
        window.AplikasiListrik.toast("Backup ini tidak berisi file data.", "error");
      }
    }
    if (info.bagian === "project" || info.bagian === "keduanya") {
      tambahLog(null, 100, "File project dipulihkan (" + (hasil.projectFiles || 0) + " berkas).");
      if (hasil.cadangan) tambahLog(null, 100, "Cadangan sebelum restore: " + hasil.cadangan);
      window.AplikasiListrik.toast("File project dipulihkan. Muat ulang halaman untuk memakainya.", "ok");
      $("bk-reload").classList.remove("hidden");
    }
  }

  /* ---------------- daftar snapshot / commit ---------------- */
  function muatDaftar() {
    var sumber = $("bk-restoreSumber").value;
    var sel = $("bk-snapshot");
    sel.innerHTML = "<option value=''>memuat…</option>";
    var jalur = sumber === "lokal" ? "/api/snapshots" : "/api/github/log";
    panggil(jalur, { batasDetik: 25 }).then(function (jawab) {
      if (!jawab || !jawab.ok) {
        sel.innerHTML = "<option value=''>— gagal memuat daftar —</option>";
        var pesan = (jawab && jawab.galat) || "gagal memuat daftar";
        $("bk-hintSnapshot").textContent = pesan;
        tambahLog(null, null, "Gagal memuat daftar " + (sumber === "lokal" ? "snapshot L:\\" : "commit GitHub") + ": " + pesan, "galat");
        return;
      }
      if (sumber === "lokal") {
        var daftar = jawab.snapshots || [];
        if (!daftar.length) {
          sel.innerHTML = "<option value=''>— belum ada backup di L:\\ —</option>";
          $("bk-hintSnapshot").textContent = "Belum ada snapshot. Jalankan backup dulu.";
          return;
        }
        sel.innerHTML = daftar.map(function (s) {
          var isi = [];
          if (s.adaData) isi.push("data");
          if (s.adaProject) isi.push("project");
          return "<option value='" + esc(s.id) + "'>" + esc(s.id) + " • " +
            (s.ukuranMB ? s.ukuranMB + " MB" : "?") + " • " + (isi.length ? isi.join("+") : "kosong") + "</option>";
        }).join("");
        $("bk-hintSnapshot").textContent = daftar.length + " snapshot • terbaru: " + daftar[0].id;
      } else {
        var komit = jawab.commits || [];
        if (!komit.length) {
          sel.innerHTML = "<option value=''>— belum ada commit di GitHub —</option>";
          $("bk-hintSnapshot").textContent = jawab.peringatan || "Belum ada commit yang bisa dipulihkan.";
          return;
        }
        sel.innerHTML = komit.map(function (c) {
          return "<option value='" + esc(c.singkat || c.hash) + "'>" + esc(c.singkat || c.hash) + " • " +
            esc((c.tanggal || "").slice(0, 10)) + " • " + esc(c.judul || "") +
            (c.dataTersedia ? "" : " (tanpa data)") + "</option>";
        }).join("");
        $("bk-hintSnapshot").textContent = komit.length + " commit" +
          (jawab.peringatan ? " • " + jawab.peringatan : " • pilih commit yang ada datanya");
      }
    });
  }

  function saatGantiSumberRestore() {
    var sumber = $("bk-restoreSumber").value;
    $("bk-snapshot").innerHTML = "<option value=''>— tekan Muat daftar —</option>";
    $("bk-hintSnapshot").textContent = sumber === "lokal"
      ? "Snapshot L:\\ = subfolder bertanggal."
      : "GitHub = commit yang berisi data.";
    muatDaftar();
  }

  /* ---------------- event ---------------- */
  function pasangEvent() {
    document.querySelectorAll("#navLaman button").forEach(function (b) {
      b.addEventListener("click", function () { tampilkanLaman(b.dataset.laman); });
    });
    $("bk-cobaLagi").addEventListener("click", function () {
      keadaaan.cobaanOffline = 0;
      muatStatus();
    });
    $("bk-salinPerintah").addEventListener("click", salinPerintah);
    $("bk-cekStatus").addEventListener("click", function () { isiFormKonfigurasi(); muatStatus(); muatDaftar(); });
    $("bk-simpanPengaturan").addEventListener("click", simpanKonfigurasi);
    $("bk-cekRepo").addEventListener("click", cekRepo);
    $("bk-mulaiBackup").addEventListener("click", mulaiBackup);
    $("bk-mulaiRestore").addEventListener("click", mulaiRestore);
    $("bk-muatDaftar").addEventListener("click", muatDaftar);
    $("bk-restoreSumber").addEventListener("change", saatGantiSumberRestore);
    $("bk-reload").addEventListener("click", function () { window.location.reload(); });
    $("bk-sumber").addEventListener("change", function () {
      var perluGithub = this.value !== "lokal";
      if (perluGithub && !$("bk-repo").value.trim()) {
        window.AplikasiListrik.toast("Isi URL repo GitHub dulu di pengaturan backup.", "info");
      }
    });

    // saat tab kembali aktif, ambil ulang pengaturan terbaru dari helper
    // (kecuali pengguna sedang mengetik di kolom URL)
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && keadaaan.halamanBackup && keadaaan.helperAktif && document.activeElement !== $("bk-repo")) {
        isiFormKonfigurasi();
      }
    });
  }

  function mulai() {
    pasangEvent();
    setSibuk(true); // sampai helper terdeteksi
    var hashAwal = (window.location.hash || "").replace("#", "");
    if (hashAwal === "backup") tampilkanLaman("backup");
    else tampilkanLaman("pencatatan");
    // cek ringan di latar supaya tombol langsung siap saat pindah halaman
    muatStatus().then(function () {
      if (keadaaan.helperAktif) {
        isiFormKonfigurasi();
        muatDaftar();
      }
    });
  }

  window.BackupListrik = {
    tampilkan: tampilkanLaman,
    muatStatus: muatStatus,
    urlHelper: URL_HELPER
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mulai);
  else mulai();
})();
