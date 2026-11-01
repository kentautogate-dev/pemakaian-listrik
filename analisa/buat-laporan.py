#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
buat-laporan.py
Membangun LAPORAN ANALISA PEMAKAIAN LISTRIK RUMAH - OKTOBER 2026
sebagai HTML mandiri siap cetak A4 + ringkasan Markdown.

Sumber data:
  - dataset-oktober-2026.csv  (tanggal, sisa, masuk, catatan)
  - hitung-oktober.json       (hasil hitung yang sudah terverifikasi)

Output:
  - laporan-analisa-oktober-2026.html
  - laporan-analisa-oktober-2026.md

Tanpa dependensi eksternal / CDN; grafik digambar sebagai SVG inline.
Jalankan:  python buat-laporan.py
"""
import csv
import json
import os
import statistics as st
import sys
from datetime import date, timedelta

BASE = os.path.dirname(os.path.abspath(__file__))
SRC_CSV = os.path.join(BASE, "dataset-oktober-2026.csv")
SRC_JSON = os.path.join(BASE, "hitung-oktober.json")
OUT_HTML = os.path.join(BASE, "laporan-analisa-oktober-2026.html")
OUT_MD = os.path.join(BASE, "laporan-analisa-oktober-2026.md")

HARGA = 1835
HARI = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli",
         "Agustus", "September", "Oktober", "November", "Desember"]
BULAN_SINGKAT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul",
                 "Agu", "Sep", "Okt", "Nov", "Des"]


# --------------------------------------------------------------------------
# Format angka Indonesia & tanggal
# --------------------------------------------------------------------------
def fnum(x, dec=0):
    """1234567 -> '1.234.567'; 5.806451 -> '5,81' (pemisah Indonesia)."""
    if x is None:
        return "—"
    if dec == 0:
        s = f"{int(round(x)):,}"
    else:
        s = f"{x:,.{dec}f}"
    return s.replace(",", "§").replace(".", ",").replace("§", ".")


def frp(x):
    return "Rp " + fnum(x, 0)


def fpct(x, dec=1):
    return fnum(x, dec) + "%"


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def tgl_pendek(dt):
    return f"{dt.day} {BULAN_SINGKAT[dt.month - 1]}"


def rentang(a, b):
    if (a.month, a.year) == (b.month, b.year):
        return f"{a.day}–{b.day} {BULAN_SINGKAT[a.month - 1]}"
    return (f"{a.day} {BULAN_SINGKAT[a.month - 1]}–"
            f"{b.day} {BULAN_SINGKAT[b.month - 1]}")


def kondisi_cuaca(note):
    n = note.upper()
    if "MANTAP" in n:
        return "Penanda token (MANTAP)"
    if "MENDUNG" in n or "MEDUNG" in n:
        return "Mendung"
    if "ASAP" in n:
        return "Asap"
    if "HUJAN" in n:
        return "Hujan"
    if "CERAH" in n:
        return "Cerah"
    return "Tanpa catatan"


CATATAN_TAMPIL = {
    "MENDUNG": "Mendung", "MEDUNG": "Mendung", "ASAP": "Asap",
    "HUJAN": "Hujan", "CERAH": "Cerah", "MANTAP": "MANTAP",
    "MANTAP / tambah token 109 kWh": "Token +109 kWh",
}


# --------------------------------------------------------------------------
# Muat & hitung data
# --------------------------------------------------------------------------
def baca_csv():
    with open(SRC_CSV, newline="", encoding="utf-8") as f:
        out = []
        for r in csv.DictReader(f):
            out.append((r["tanggal"].strip(), int(r["sisa"]),
                        int(r["masuk"] or 0), (r["catatan"] or "").strip()))
    return out


def muat_data():
    raw = baca_csv()
    rows = []
    for i, (tgl, sisa, masuk, catatan) in enumerate(raw):
        dt = date.fromisoformat(tgl)
        pakai = biaya = None
        if i < len(raw) - 1:
            nxt = raw[i + 1]
            # pemakaian = sisa hari ini + token masuk pembacaan berikutnya
            #              - sisa pembacaan berikutnya
            pakai = sisa + nxt[2] - nxt[1]
            biaya = pakai * HARGA
        rows.append({
            "tanggal": tgl, "date": dt, "hari": HARI[dt.weekday()],
            "sisa": sisa, "masuk": masuk, "catatan": catatan,
            "pemakaian": pakai, "biaya": biaya,
        })

    oct_rows = [r for r in rows if r["date"].year == 2026 and r["date"].month == 10]
    cmp_row = next(r for r in rows if r["tanggal"] == "2026-11-01")

    # --- agregat mingguan (Senin-Minggu) ----------------------------------
    minggu = []
    for r in oct_rows:
        senin = r["date"] - timedelta(days=r["date"].weekday())
        key = senin.isoformat()
        if not minggu or minggu[-1]["key"] != key:
            minggu.append({"key": key, "senin": senin, "rows": []})
        minggu[-1]["rows"].append(r)
    for i, m in enumerate(minggu):
        m["nomor"] = i + 1
        m["a"], m["b"] = m["rows"][0]["date"], m["rows"][-1]["date"]
        m["kwh"] = sum(x["pemakaian"] for x in m["rows"])
        m["rp"] = sum(x["biaya"] for x in m["rows"])
        m["hari"] = len(m["rows"])
        m["avg"] = m["kwh"] / m["hari"]
        m["rentang"] = rentang(m["a"], m["b"])

    # --- agregat per hari dalam seminggu ----------------------------------
    per_hari = {n: {"kwh": 0, "hari": 0} for n in HARI}
    for r in oct_rows:
        per_hari[r["hari"]]["kwh"] += r["pemakaian"]
        per_hari[r["hari"]]["hari"] += 1
    for v in per_hari.values():
        v["avg"] = v["kwh"] / v["hari"]

    # --- agregat kondisi cuaca -------------------------------------------
    cuaca = {}
    for r in oct_rows:
        k = kondisi_cuaca(r["catatan"])
        c = cuaca.setdefault(k, {"kwh": 0, "hari": 0, "rp": 0})
        c["kwh"] += r["pemakaian"]
        c["rp"] += r["biaya"]
        c["hari"] += 1
    for v in cuaca.values():
        v["avg"] = v["kwh"] / v["hari"]

    # --- statistik utama --------------------------------------------------
    pakai = [r["pemakaian"] for r in oct_rows]
    total = sum(pakai)
    rata = st.mean(pakai)
    median = st.median(pakai)
    sd = st.pstdev(pakai)
    beli = sum(r["masuk"] for r in oct_rows)
    sisa_awal = rows[0]["sisa"]
    sisa_akhir = cmp_row["sisa"]
    saldo_rp = sisa_akhir * HARGA

    top5 = sorted(oct_rows, key=lambda r: r["pemakaian"], reverse=True)[:5]
    spikes = [r for r in oct_rows if r["pemakaian"] >= rata + sd]
    zeros = [r for r in oct_rows if r["pemakaian"] == 0]
    low = [r for r in oct_rows if r["pemakaian"] <= 3]
    weekday = [r for r in oct_rows if r["date"].weekday() <= 4]
    weekend = [r for r in oct_rows if r["date"].weekday() >= 5]

    d = {
        "rows": rows, "oct_rows": oct_rows, "cmp_row": cmp_row,
        "minggu": minggu, "per_hari": per_hari, "cuaca": cuaca,
        "total_kwh": total, "total_rp": total * HARGA,
        "rata": rata, "median": median, "sd": sd,
        "beli_kwh": beli, "beli_rp": beli * HARGA,
        "sisa_awal": sisa_awal, "sisa_akhir": sisa_akhir,
        "saldo_rp": saldo_rp, "saldo_hari": sisa_akhir / rata,
        "bulan30_kwh": rata * 30, "bulan30_rp": rata * 30 * HARGA,
        "tahun_kwh": rata * 365, "tahun_rp": rata * 365 * HARGA,
        "top5": top5, "top5_kwh": sum(r["pemakaian"] for r in top5),
        "spikes": spikes, "zeros": zeros, "low": low,
        "weekday": weekday, "weekend": weekend,
        "weekday_kwh": sum(r["pemakaian"] for r in weekday),
        "weekday_hari": len(weekday),
        "weekend_kwh": sum(r["pemakaian"] for r in weekend),
        "weekend_hari": len(weekend),
        "biaya_hari": (total * HARGA) / len(oct_rows),
        "maks": max(oct_rows, key=lambda r: r["pemakaian"]),
    }
    d["weekday_avg"] = d["weekday_kwh"] / d["weekday_hari"]
    d["weekend_avg"] = d["weekend_kwh"] / d["weekend_hari"]
    d["di_bawah_median"] = [r for r in oct_rows if r["pemakaian"] <= median]
    d["di_atas_median"] = [r for r in oct_rows if r["pemakaian"] > median]
    d["kwh_bawah_median"] = sum(r["pemakaian"] for r in d["di_bawah_median"])
    d["kwh_atas_median"] = sum(r["pemakaian"] for r in d["di_atas_median"])
    return d


# --------------------------------------------------------------------------
# Grafik SVG
# --------------------------------------------------------------------------
def svg_harian(oct_rows, rata):
    W, H = 780, 286
    L, R, T, B = 44, 16, 34, 44
    n = len(oct_rows)
    slot = (W - L - R) / n
    bw = 13
    ymax = 14
    plot_h = H - T - B

    def y(v):
        return T + plot_h * (1 - v / ymax)

    base = y(0)
    p = [f'<svg class="chart" viewBox="0 0 {W} {H}" role="img" '
         f'aria-label="Grafik batang pemakaian harian Oktober 2026">']
    for v in range(0, 15, 2):
        yy = y(v)
        p.append(f'<line x1="{L}" y1="{yy:.1f}" x2="{W - R}" y2="{yy:.1f}" '
                 f'stroke="#e5e7eb" stroke-width="1"/>')
        p.append(f'<text x="{L - 8}" y="{yy + 3.5:.1f}" text-anchor="end" '
                 f'font-size="9" fill="#64748b">{v}</text>')
    p.append(f'<text x="6" y="18" font-size="9" fill="#64748b">kWh/hari</text>')

    maks = max(r["pemakaian"] for r in oct_rows)
    for i, r in enumerate(oct_rows):
        v = r["pemakaian"]
        cx = L + slot * (i + 0.5)
        if v == 0:
            p.append(f'<rect x="{cx - bw / 2:.1f}" y="{base - 2:.1f}" width="{bw}" '
                     f'height="2" rx="1" fill="#cbd5e1"/>')
        else:
            fill = "#ea580c" if v == maks else "#0d9488"
            p.append(f'<rect x="{cx - bw / 2:.1f}" y="{y(v):.1f}" width="{bw}" '
                     f'height="{base - y(v):.1f}" rx="2" fill="{fill}">'
                     f'<title>{tgl_pendek(r["date"])}: {v} kWh</title></rect>')
            p.append(f'<text x="{cx:.1f}" y="{y(v) - 4:.1f}" text-anchor="middle" '
                     f'font-size="8.4" fill="#334155">{v}</text>')

    ya = y(rata)
    p.append(f'<line x1="{L}" y1="{ya:.1f}" x2="{W - R}" y2="{ya:.1f}" '
             f'stroke="#b45309" stroke-width="1.6" stroke-dasharray="6 4"/>')
    p.append(f'<text x="{W - R}" y="{ya - 6:.1f}" text-anchor="end" font-size="9" '
             f'fill="#b45309" font-weight="600">rata-rata {fnum(rata, 2)} kWh/hari</text>')

    for i, r in enumerate(oct_rows):
        p.append(f'<text x="{L + slot * (i + 0.5):.1f}" y="{base + 14:.1f}" '
                 f'text-anchor="middle" font-size="7.6" fill="#64748b">'
                 f'{r["date"].day}</text>')
    p.append(f'<text x="{(L + W - R) / 2:.0f}" y="{base + 31:.1f}" text-anchor="middle" '
             f'font-size="8.6" fill="#64748b">Tanggal (Oktober 2026)</text>')
    p.append('</svg>')
    return "".join(p)


def svg_mingguan(minggu):
    W, H = 780, 238
    L, R, T, B = 48, 16, 30, 58
    n = len(minggu)
    slot = (W - L - R) / n
    bw = 66
    ymax = 50
    plot_h = H - T - B

    def y(v):
        return T + plot_h * (1 - v / ymax)

    base = y(0)
    maks = max(m["kwh"] for m in minggu)
    p = [f'<svg class="chart" viewBox="0 0 {W} {H}" role="img" '
         f'aria-label="Grafik pemakaian mingguan Oktober 2026">']
    for v in range(0, 51, 10):
        yy = y(v)
        p.append(f'<line x1="{L}" y1="{yy:.1f}" x2="{W - R}" y2="{yy:.1f}" '
                 f'stroke="#e5e7eb" stroke-width="1"/>')
        p.append(f'<text x="{L - 8}" y="{yy + 3.5:.1f}" text-anchor="end" '
                 f'font-size="9" fill="#64748b">{v}</text>')
    p.append(f'<text x="6" y="18" font-size="9" fill="#64748b">kWh</text>')

    for i, m in enumerate(minggu):
        cx = L + slot * (i + 0.5)
        fill = "#ea580c" if m["kwh"] == maks else "#0d9488"
        p.append(f'<rect x="{cx - bw / 2:.1f}" y="{y(m["kwh"]):.1f}" width="{bw}" '
                 f'height="{base - y(m["kwh"]):.1f}" rx="3" fill="{fill}">'
                 f'<title>Minggu {m["nomor"]}: {m["kwh"]} kWh</title></rect>')
        p.append(f'<text x="{cx:.1f}" y="{y(m["kwh"]) - 5:.1f}" text-anchor="middle" '
                 f'font-size="10" font-weight="600" fill="#334155">{m["kwh"]}</text>')
        p.append(f'<text x="{cx:.1f}" y="{base + 16:.1f}" text-anchor="middle" '
                 f'font-size="9.2" fill="#334155">Minggu {m["nomor"]}</text>')
        p.append(f'<text x="{cx:.1f}" y="{base + 29:.1f}" text-anchor="middle" '
                 f'font-size="8.2" fill="#64748b">{m["rentang"]}</text>')
        p.append(f'<text x="{cx:.1f}" y="{base + 42:.1f}" text-anchor="middle" '
                 f'font-size="7.6" fill="#94a3b8">{m["hari"]} hari</text>')
    p.append('</svg>')
    return "".join(p)


def svg_per_hari(per_hari):
    W, H = 780, 238
    L, R, T, B = 48, 16, 30, 44
    n = len(HARI)
    slot = (W - L - R) / n
    bw = 46
    ymax = 8
    plot_h = H - T - B

    def y(v):
        return T + plot_h * (1 - v / ymax)

    base = y(0)
    maks = max(per_hari[h]["avg"] for h in HARI)
    p = [f'<svg class="chart" viewBox="0 0 {W} {H}" role="img" '
         f'aria-label="Grafik rata-rata pemakaian per hari dalam seminggu">']
    for v in range(0, 9, 2):
        yy = y(v)
        p.append(f'<line x1="{L}" y1="{yy:.1f}" x2="{W - R}" y2="{yy:.1f}" '
                 f'stroke="#e5e7eb" stroke-width="1"/>')
        p.append(f'<text x="{L - 8}" y="{yy + 3.5:.1f}" text-anchor="end" '
                 f'font-size="9" fill="#64748b">{v}</text>')
    p.append(f'<text x="6" y="18" font-size="9" fill="#64748b">kWh/hari</text>')

    for i, h in enumerate(HARI):
        v = per_hari[h]["avg"]
        cx = L + slot * (i + 0.5)
        fill = "#ea580c" if v == maks else "#0d9488"
        p.append(f'<rect x="{cx - bw / 2:.1f}" y="{y(v):.1f}" width="{bw}" '
                 f'height="{base - y(v):.1f}" rx="3" fill="{fill}">'
                 f'<title>{h}: {fnum(v, 2)} kWh/hari</title></rect>')
        p.append(f'<text x="{cx:.1f}" y="{y(v) - 5:.1f}" text-anchor="middle" '
                 f'font-size="9.5" font-weight="600" fill="#334155">{fnum(v, 2)}</text>')
        p.append(f'<text x="{cx:.1f}" y="{base + 16:.1f}" text-anchor="middle" '
                 f'font-size="9" fill="#334155">{h}</text>')
    p.append('</svg>')
    return "".join(p)


# --------------------------------------------------------------------------
# Bagian-bagian HTML
# --------------------------------------------------------------------------
def bagian_kover(d):
    return f"""
  <header class="cover">
    <div class="badges">
      <span class="badge">Laporan Analisa</span>
      <span class="badge alt">Listrik Rumah Tangga</span>
    </div>
    <h1>Pemakaian Listrik Rumah<br><span>Oktober 2026</span></h1>
    <p class="sub">Analisa pemakaian kWh harian, biaya, pola penggunaan, dan rekomendasi
      penghematan berdasarkan {len(d['oct_rows'])} catatan meteran/token periode
      1–31 Oktober 2026.</p>
    <dl class="cover-meta">
      <div><dt>Periode</dt><dd>1–31 Oktober 2026</dd></div>
      <div><dt>Data</dt><dd>{len(d['oct_rows'])} catatan harian + 1 pembanding</dd></div>
      <div><dt>Tarif acuan</dt><dd>Rp 1.835/kWh</dd></div>
      <div><dt>Total pemakaian</dt><dd class="big">{fnum(d['total_kwh'])} kWh</dd></div>
      <div><dt>Total biaya</dt><dd class="big">{frp(d['total_rp'])}</dd></div>
      <div><dt>Disusun</dt><dd>1 November 2026</dd></div>
    </dl>
  </header>"""


def bagian_ringkasan(d):
    puncak = d["maks"]
    target_kwh = d["total_kwh"] * 0.10
    target_rp = target_kwh * HARGA
    return f"""
  <section class="section" id="ringkasan">
    <h2 class="section-title"><span class="num">1</span> Ringkasan Eksekutif</h2>
    <ol class="exec">
      <li><b>Total pemakaian {fnum(d['total_kwh'])} kWh dengan biaya
        {frp(d['total_rp'])}</b> selama 31 hari (tarif Rp 1.835/kWh) — rata-rata
        <b>{fnum(d['rata'], 2)} kWh</b> atau <b>{frp(d['biaya_hari'])}</b> per hari.</li>
      <li><b>Pemakaian tidak merata.</b> Dua hari tertinggi, 2 dan 6 Oktober,
        masing-masing {puncak['pemakaian']} kWh ({frp(puncak['biaya'])}); lima hari
        tertinggi (≥10 kWh) menyumbang {fnum(d['top5_kwh'])} kWh atau
        <b>{fpct(d['top5_kwh'] / d['total_kwh'] * 100)}</b> dari total bulan,
        padahal hanya {fpct(5 / 31 * 100)} dari jumlah hari.</li>
      <li><b>Selasa paling boros, Senin paling hemat:</b> rata-rata
        {fnum(d['per_hari']['Selasa']['avg'], 2)} kWh/hari berbanding
        {fnum(d['per_hari']['Senin']['avg'], 2)} kWh/hari. Selisih
        {fnum(d['per_hari']['Selasa']['avg'] - d['per_hari']['Senin']['avg'], 2)} kWh/hari
        setara {frp((d['per_hari']['Selasa']['avg'] - d['per_hari']['Senin']['avg']) * HARGA)}.</li>
      <li><b>Saldo token aman:</b> sisa akhir {fnum(d['sisa_akhir'])} kWh
        ({frp(d['saldo_rp'])}) atau setara <b>±{fnum(d['saldo_hari'], 0)} hari</b>
        pemakaian. Pengisian {fnum(d['beli_kwh'])} kWh ({frp(d['beli_rp'])}) pada
        12 Oktober diperlakukan sebagai token masuk, bukan pemakaian.</li>
      <li><b>Target hemat 10% realistis:</b> {fnum(target_kwh, 0)} kWh/bulan =
        {frp(target_rp)}/bulan = <b>{frp(target_rp * 12)}/tahun</b> — cukup dari
        menekan hari Selasa ke level rata-rata dan dua hari lonjakan.</li>
      <li><b>Dua kesalahan hitung di sheet asli sudah dikoreksi</b> (baris 13 Oktober
        dan baris 1 November); angka valid — diverifikasi ulang dari dataset — adalah
        <b>{fnum(d['total_kwh'])} kWh / {frp(d['total_rp'])}</b>.</li>
      <li><b>Hari nol 12, 24, dan 31 Oktober</b> merupakan artefak pencatatan
        (pengisian token/pembacaan ganda), bukan pemakaian nol sesungguhnya;
        perbaikan disiplin pencatatan akan membuat analisa bulan berikutnya lebih tajam.</li>
    </ol>
    <div class="callout">
      <span class="callout-label">Intinya</span>
      <p>Pemakaian {fnum(d['total_kwh'])} kWh / {frp(d['total_rp'])} per bulan,
      didominasi beberapa hari boros. Menekan hari-hari puncak dan menjaga jam
      pencatatan adalah dua langkah dengan hasil terbesar.</p>
    </div>
  </section>"""


def bagian_statistik(d):
    puncak = d["maks"]
    cards = [
        ("Total pemakaian", f"{fnum(d['total_kwh'])} kWh", "31 hari tercatat", ""),
        ("Total biaya", frp(d["total_rp"]), "tarif Rp 1.835/kWh", ""),
        ("Rata-rata harian", f"{fnum(d['rata'], 2)} kWh",
         f"{frp(d['biaya_hari'])}/hari", ""),
        ("Median harian", f"{fnum(d['median'])} kWh", "separuh hari ≤ 6 kWh", ""),
        ("Simpangan baku", f"{fnum(d['sd'], 2)} kWh", "variasi antar-hari", ""),
        ("Hari tertinggi", f"{puncak['pemakaian']} kWh",
         f"2 Okt & 6 Okt ({frp(puncak['biaya'])})", "warn"),
        ("Token masuk", f"{fnum(d['beli_kwh'])} kWh",
         f"{frp(d['beli_rp'])} · 12 Okt", "accent"),
        ("Sisa token akhir", f"{fnum(d['sisa_akhir'])} kWh",
         f"{frp(d['saldo_rp'])} · ±{fnum(d['saldo_hari'], 0)} hari", "accent"),
    ]
    out = ["""
  <section class="section" id="statistik">
    <h2 class="section-title"><span class="num">2</span> Statistik Utama</h2>
    <div class="stat-grid">"""]
    for label, value, sub, cls in cards:
        out.append(f"""
      <div class="stat-card {cls}">
        <div class="label">{label}</div>
        <div class="value">{value}</div>
        <div class="sub">{sub}</div>
      </div>""")
    out.append(f"""
    </div>
    <p class="note">Perkiraan 30 hari: {fnum(d['bulan30_kwh'], 2)} kWh /
      {frp(d['bulan30_rp'])} · Perkiraan setahun: {fnum(d['tahun_kwh'], 2)} kWh /
      {frp(d['tahun_rp'])} (rata-rata harian × 30 dan × 365 hari).</p>
    <nav class="toc" aria-label="Isi laporan">
      <h3>Isi laporan</h3>
      <ol>
        <li><span class="n">1</span>Ringkasan Eksekutif</li>
        <li><span class="n">2</span>Statistik Utama</li>
        <li><span class="n">3</span>Grafik Pemakaian</li>
        <li><span class="n">4</span>Catatan Harian &amp; Subtotal Mingguan</li>
        <li><span class="n">5</span>Rekap Mingguan &amp; Bulanan</li>
        <li><span class="n">6</span>Analisa Pola Pemakaian</li>
        <li><span class="n">7</span>Rekomendasi Penghematan</li>
        <li><span class="n">8</span>Catatan Kualitas Data</li>
        <li><span class="n">9</span>Metodologi</li>
      </ol>
    </nav>
  </section>""")
    return "".join(out)


def bagian_grafik(d):
    return f"""
  <section class="section newpage" id="grafik">
    <h2 class="section-title"><span class="num">3</span> Grafik Pemakaian</h2>

    <figure class="figure-card">
      <div class="fig-head"><h3>Gambar 1 — Pemakaian harian, 1–31 Oktober 2026</h3>
        <span class="fig-tag">kWh/hari</span></div>
      {svg_harian(d['oct_rows'], d['rata'])}
      <figcaption>Batang oranye = dua hari tertinggi (13 kWh). Garis putus-putus =
        rata-rata {fnum(d['rata'], 2)} kWh/hari. Batang abu-abu tipis menandai hari
        tanpa pemakaian tercatat (0 kWh).</figcaption>
    </figure>

    <figure class="figure-card">
      <div class="fig-head"><h3>Gambar 2 — Rekap mingguan (Senin–Minggu)</h3>
        <span class="fig-tag">kWh</span></div>
      {svg_mingguan(d['minggu'])}
      <figcaption>Minggu 2 (5–11 Okt) tertinggi: 47 kWh. Minggu 1 dan 5 parsial:
        data masing-masing 4 hari dan 6 hari karena periode laporan.</figcaption>
    </figure>

    <figure class="figure-card">
      <div class="fig-head"><h3>Gambar 3 — Rata-rata per hari dalam seminggu</h3>
        <span class="fig-tag">kWh/hari</span></div>
      {svg_per_hari(d['per_hari'])}
      <figcaption>Selasa paling tinggi ({fnum(d['per_hari']['Selasa']['avg'], 2)}),
        Senin paling rendah ({fnum(d['per_hari']['Senin']['avg'], 2)}). Rata-rata
        bulanan {fnum(d['rata'], 2)} kWh/hari.</figcaption>
    </figure>

    <div class="insight">
      <p><b>Bacaan cepat.</b> {len(d['di_atas_median'])} hari dengan pemakaian di
        atas median menyerap <b>{fnum(d['kwh_atas_median'])} kWh
        ({fpct(d['kwh_atas_median'] / d['total_kwh'] * 100)})</b>, sedangkan
        {len(d['di_bawah_median'])} hari sisanya hanya
        {fnum(d['kwh_bawah_median'])} kWh
        ({fpct(d['kwh_bawah_median'] / d['total_kwh'] * 100)}). Puncak 13 kWh terjadi
        pada 2 Okt (Jumat) dan 6 Okt (Selasa); garis rata-rata {fnum(d['rata'], 2)}
        kWh/hari dapat dipakai sebagai patokan — hari di atas 10 kWh layak
        dievaluasi peralatannya.</p>
    </div>
  </section>"""


def _baris_harian(r, no):
    cat = CATATAN_TAMPIL.get(r["catatan"], r["catatan"] or "—")
    kelas = " class=\"zero\"" if r["pemakaian"] == 0 else ""
    masuk = "—" if r["masuk"] == 0 else fnum(r["masuk"])
    return (f'<tr{kelas}><td class="num">{no}</td>'
            f'<td>{r["date"].day} Okt</td><td>{r["hari"]}</td>'
            f'<td class="num">{fnum(r["sisa"])}</td>'
            f'<td class="num">{masuk}</td>'
            f'<td class="num strong">{fnum(r["pemakaian"])}</td>'
            f'<td class="num">{frp(r["biaya"])}</td>'
            f'<td class="cat">{esc(cat)}</td></tr>')


def bagian_tabel_harian(d):
    out = ["""
  <section class="section newpage" id="harian">
    <h2 class="section-title"><span class="num">4</span> Catatan Harian &amp; Subtotal Mingguan</h2>
    <p class="lead">Pemakaian dihitung dari selisih pembacaan sisa kWh; token masuk
      diperhitungkan agar pengisian token tidak terbaca sebagai pemakaian.</p>
    <table class="daily">
      <colgroup>
        <col style="width:5%"><col style="width:12%"><col style="width:11%">
        <col style="width:11%"><col style="width:9%"><col style="width:12%">
        <col style="width:15%"><col style="width:25%">
      </colgroup>
      <thead><tr>
        <th class="num">No</th><th>Tanggal</th><th>Hari</th>
        <th class="num">Sisa (kWh)</th><th class="num">Token masuk</th>
        <th class="num">Pemakaian (kWh)</th><th class="num">Biaya</th><th>Catatan</th>
      </tr></thead>
      <tbody>"""]
    no = 0
    for m in d["minggu"]:
        for r in m["rows"]:
            no += 1
            out.append(_baris_harian(r, no))
        out.append(
            f'<tr class="subtotal"><td colspan="2">Subtotal Minggu {m["nomor"]}</td>'
            f'<td>{m["rentang"]}</td>'
            f'<td class="num">—</td><td class="num">—</td>'
            f'<td class="num">{fnum(m["kwh"])}</td>'
            f'<td class="num">{frp(m["rp"])}</td>'
            f'<td>{m["hari"]} hari</td></tr>')
    out.append(
        f'<tr class="total"><td colspan="3">TOTAL OKTOBER 2026 · 31 hari</td>'
        f'<td class="num">—</td>'
        f'<td class="num">{fnum(d["beli_kwh"])}</td>'
        f'<td class="num">{fnum(d["total_kwh"])}</td>'
        f'<td class="num">{frp(d["total_rp"])}</td>'
        f'<td>rata-rata {fnum(d["rata"], 2)} kWh/hari</td></tr>')
    out.append(
        f'<tr class="compare"><td class="num">–</td><td>1 Nov 2026</td><td>Minggu</td>'
        f'<td class="num">{fnum(d["cmp_row"]["sisa"])}</td>'
        f'<td class="num">–</td><td class="num">–</td><td class="num">–</td>'
        f'<td>Pembanding (batas pengamatan)</td></tr>')
    out.append("""
      </tbody>
    </table>
    <p class="note">Tabel 1 — Rincian pemakaian harian. Biaya = pemakaian ×
      Rp 1.835. Baris 1 November 2026 hanya pembanding untuk menghitung pemakaian
      31 Oktober, bukan bagian dari total bulan. Pada 12 Oktober tercatat token
      masuk 109 kWh; pemakaian 0 kWh pada 12, 24, dan 31 Oktober dibahas pada
      bagian Analisa Pola dan Catatan Kualitas Data.</p>
  </section>""")
    return "".join(out)


def bagian_rekap(d):
    rows = []
    for m in d["minggu"]:
        rows.append(f"""
        <tr>
          <td>Minggu {m['nomor']}</td>
          <td>{m['rentang']}</td>
          <td class="num">{m['hari']}</td>
          <td class="num">{fnum(m['kwh'])}</td>
          <td class="num">{frp(m['rp'])}</td>
          <td class="num">{fnum(m['avg'], 2)}</td>
          <td class="num">{fpct(m['kwh'] / d['total_kwh'] * 100)}</td>
        </tr>""")
    minggu_rows = "".join(rows)
    return f"""
  <section class="section" id="rekap">
    <h2 class="section-title"><span class="num">5</span> Rekap Mingguan &amp; Bulanan</h2>

    <div class="table-card">
      <h3>Tabel 2 — Rekap mingguan (Senin–Minggu)</h3>
      <table>
        <thead><tr>
          <th>Minggu</th><th>Rentang</th><th class="num">Hari</th>
          <th class="num">Pemakaian (kWh)</th><th class="num">Biaya</th>
          <th class="num">Rata-rata (kWh/hari)</th><th class="num">Pangsa</th>
        </tr></thead>
        <tbody>{minggu_rows}
          <tr class="total">
            <td colspan="2">Total bulan</td><td class="num">31</td>
            <td class="num">{fnum(d['total_kwh'])}</td>
            <td class="num">{frp(d['total_rp'])}</td>
            <td class="num">{fnum(d['rata'], 2)}</td>
            <td class="num">100,0%</td>
          </tr>
        </tbody>
      </table>
      <p class="note">Minggu 1 hanya mencakup 1–4 Oktober (periode dimulai Kamis)
        dan Minggu 5 mencakup 26–31 Oktober (1 November menjadi pembanding), sehingga
        rata-ratanya tidak sebanding langsung dengan minggu penuh.</p>
    </div>

    <div class="table-card">
      <h3>Tabel 3 — Rekap bulanan dan perkiraan</h3>
      <table>
        <thead><tr>
          <th>Periode</th><th class="num">Hari</th>
          <th class="num">Pemakaian (kWh)</th><th class="num">Biaya</th>
          <th class="num">Rata-rata (kWh/hari)</th><th class="num">Biaya/hari</th>
        </tr></thead>
        <tbody>
          <tr>
            <td><b>Oktober 2026 (aktual)</b></td><td class="num">31</td>
            <td class="num">{fnum(d['total_kwh'])}</td>
            <td class="num">{frp(d['total_rp'])}</td>
            <td class="num">{fnum(d['rata'], 2)}</td>
            <td class="num">{frp(d['biaya_hari'])}</td>
          </tr>
          <tr>
            <td>Perkiraan 30 hari</td><td class="num">30</td>
            <td class="num">{fnum(d['bulan30_kwh'], 2)}</td>
            <td class="num">{frp(d['bulan30_rp'])}</td>
            <td class="num">{fnum(d['rata'], 2)}</td>
            <td class="num">{frp(d['biaya_hari'])}</td>
          </tr>
          <tr>
            <td>Perkiraan setahun</td><td class="num">365</td>
            <td class="num">{fnum(d['tahun_kwh'], 2)}</td>
            <td class="num">{frp(d['tahun_rp'])}</td>
            <td class="num">{fnum(d['rata'], 2)}</td>
            <td class="num">{frp(d['biaya_hari'])}</td>
          </tr>
        </tbody>
      </table>
      <p class="note">Perkiraan memakai rata-rata harian Oktober 2026
        ({fnum(d['rata'], 2)} kWh); bukan tagihan resmi dan dapat berbeda bila pola
        pemakaian berubah.</p>
    </div>
  </section>"""


def bagian_pola(d):
    ph = d["per_hari"]
    sel = ph["Selasa"]["avg"]
    sen = ph["Senin"]["avg"]
    top5 = d["top5"]
    top5_list = ", ".join(f"{r['date'].day} Okt ({r['pemakaian']} kWh)"
                          for r in top5)
    minggu_penuh = [m for m in d["minggu"] if m["hari"] == 7]
    m_tinggi = max(minggu_penuh, key=lambda m: m["kwh"])
    m_rendah = min(minggu_penuh, key=lambda m: m["kwh"])
    cuaca_rows = []
    urutan = ["Mendung", "Asap", "Hujan", "Cerah", "Penanda token (MANTAP)",
              "Tanpa catatan"]
    for k in urutan:
        if k not in d["cuaca"]:
            continue
        c = d["cuaca"][k]
        cuaca_rows.append(f"""
            <tr><td>{k.replace(' (MANTAP)', '')}</td>
              <td class="num">{c['hari']}</td>
              <td class="num">{fnum(c['kwh'])}</td>
              <td class="num">{fnum(c['avg'], 2)}</td>
              <td class="num">{frp(c['rp'])}</td></tr>""")
    return f"""
  <section class="section" id="pola">
    <h2 class="section-title"><span class="num">6</span> Analisa Pola Pemakaian</h2>

    <div class="pattern-grid">
      <div class="card pattern">
        <h3>Hari tersibuk: Selasa</h3>
        <p>Selasa rata-rata <b>{fnum(sel, 2)} kWh/hari</b>
          ({fnum(ph['Selasa']['kwh'])} kWh dalam {ph['Selasa']['hari']} hari) — sekitar
          <b>{fpct((sel - d['rata']) / d['rata'] * 100)}</b> di atas rata-rata
          bulanan. Empat Selasa: 6 Okt ({fnum(d['rows'][5]['pemakaian'])}),
          13 Okt ({fnum(d['rows'][12]['pemakaian'])}), 20 Okt ({fnum(d['rows'][19]['pemakaian'])}),
          27 Okt ({fnum(d['rows'][26]['pemakaian'])}).</p>
      </div>
      <div class="card pattern">
        <h3>Hari paling hemat: Senin</h3>
        <p>Senin rata-rata <b>{fnum(sen, 2)} kWh/hari</b> — sekitar
          <b>{fpct((sen - d['rata']) / d['rata'] * 100)}</b> dari rata-rata.
          Selisih Selasa–Senin {fnum(sel - sen, 2)} kWh/hari ≈
          {frp((sel - sen) * HARGA)}.</p>
      </div>
      <div class="card pattern">
        <h3>Lonjakan: 2 &amp; 6 Oktober</h3>
        <p>Dua hari itu masing-masing <b>{top5[0]['pemakaian']} kWh</b>
          ({frp(top5[0]['biaya'])}) — sekitar
          {fnum(top5[0]['pemakaian'] / d['rata'], 1)}× rata-rata. Lima hari
          tertinggi: {top5_list}; totalnya {fnum(d['top5_kwh'])} kWh
          ({fpct(d['top5_kwh'] / d['total_kwh'] * 100)}).</p>
      </div>
      <div class="card pattern">
        <h3>Hari nol: 12, 24, 31 Oktober</h3>
        <p>Ketiganya 0 kWh. 12 Okt bertepatan dengan pengisian token 109 kWh;
          24 dan 31 Okt pembacaan sisa sama dengan hari berikutnya — kemungkinan
          pencatatan ganda/tidak sempat membaca. Bukan berarti tidak memakai listrik.</p>
      </div>
    </div>

    <div class="card rhythm">
      <h3>Ritme mingguan &amp; profil beban</h3>
      <p>Minggu {m_tinggi['nomor']} ({m_tinggi['rentang']}) tertinggi
        <b>{fnum(m_tinggi['kwh'])} kWh</b> dan Minggu {m_rendah['nomor']}
        ({m_rendah['rentang']}) terendah <b>{fnum(m_rendah['kwh'])} kWh</b> di antara
        minggu penuh; empat hari pertama Oktober justru paling padat
        ({fnum(d['minggu'][0]['avg'], 2)} kWh/hari dalam 4 hari). Hari kerja
        (Sen–Jum) memakai <b>{fnum(d['weekday_kwh'])} kWh</b>
        ({fnum(d['weekday_avg'], 2)}/hari) dan akhir pekan (Sab–Min)
        <b>{fnum(d['weekend_kwh'])} kWh</b> ({fnum(d['weekend_avg'], 2)}/hari) —
        tidak ada perbedaan besar. Hari paling hemat 1 kWh (30 Okt) dan enam hari
        di 3 kWh menunjukkan beban dasar rumah relatif kecil; kenaikan besar
        bersifat sporadis, sesuai pola lonjakan di atas.</p>
    </div>

    <div class="insight">
      <p><b>Proyeksi ke depan.</b> Bila pola Oktober berlanjut, pemakaian setahun
        setara ±{fnum(d['tahun_kwh'], 2)} kWh / {frp(d['tahun_rp'])}. Target hemat
        10% menurunkannya ke ±{fnum(d['tahun_kwh'] * 0.9, 2)} kWh /
        {frp(d['tahun_rp'] * 0.9)} — perubahan kecil pada hari-hari puncak
        berdampak besar dalam setahun.</p>
    </div>

    <div class="table-card">
      <h3>Tabel 4 — Rekap menurut catatan cuaca (ringan)</h3>
      <table>
        <thead><tr>
          <th>Kondisi</th><th class="num">Hari</th>
          <th class="num">Pemakaian (kWh)</th>
          <th class="num">Rata-rata (kWh/hari)</th><th class="num">Biaya</th>
        </tr></thead>
        <tbody>{''.join(cuaca_rows)}
          <tr class="total"><td>Total</td><td class="num">31</td>
            <td class="num">{fnum(d['total_kwh'])}</td>
            <td class="num">{fnum(d['rata'], 2)}</td>
            <td class="num">{frp(d['total_rp'])}</td></tr>
        </tbody>
      </table>
      <p class="note">Catatan cuaca belum konsisten dan sampelnya kecil (1–19 hari
        per kondisi), jadi tabel ini bersifat indikatif. Menariknya, dua dari tiga
        hari "mendung" mencatat rekor 13 kWh, sementara hari "asap" justru di bawah
        rata-rata; hubungan sebab-akibat belum bisa disimpulkan dari satu bulan data.
        Catatan cuaca sebaiknya tetap dipertahankan agar bisa dianalisa setelah
        3–6 bulan.</p>
    </div>
  </section>"""


def bagian_rekomendasi(d):
    ph = d["per_hari"]
    lebih_selasa = (ph["Selasa"]["avg"] - d["rata"]) * ph["Selasa"]["hari"]
    return f"""
  <section class="section" id="rekomendasi">
    <h2 class="section-title"><span class="num">7</span> Rekomendasi Penghematan</h2>
    <p class="lead">Langkah berikut disusun dari angka Oktober 2026, diurutkan
      berdasarkan potensi penghematan dan kemudahan pelaksanaan.</p>

    <div class="reco-grid">
      <div class="reco">
        <div class="reco-num">1</div>
        <div><h3>Pasang target 10% — Rp 33.030/bulan</h3>
        <p>Target 18 kWh/bulan ({frp(33030)}/bulan atau {frp(396360)}/tahun).
          Cukup dari menekan Selasa ke level rata-rata (±{fnum(lebih_selasa, 2)} kWh
          ≈ {frp(lebih_selasa * HARGA)}) dan dua hari lonjakan ke 6 kWh
          (±10 kWh ≈ {frp(18350)}).</p></div>
      </div>
      <div class="reco">
        <div class="reco-num">2</div>
        <div><h3>Selidiki hari ≥11 kWh</h3>
        <p>2, 6, 20, dan 23 Oktober memakai 11–13 kWh. Catat peralatan besar yang
          berjalan (setrika, pompa air, mesin cuci, pemanas, AC). Menekan dua dari
          empat hari itu ke 6 kWh berarti hemat ±10 kWh ≈ {frp(18350)}/bulan.</p></div>
      </div>
      <div class="reco">
        <div class="reco-num">3</div>
        <div><h3>Perbaiki disiplin pencatatan</h3>
        <p>Catat pada jam yang sama (mis. 07.00) dan tulis pengisian token di
          kolom terpisah. Hari nol 12, 24, dan 31 Oktober membuat total bulan ini
          sedikit bias; pencatatan rapi membuat analisa 6–12 bulan ke depan jauh
          lebih tajam.</p></div>
      </div>
      <div class="reco">
        <div class="reco-num">4</div>
        <div><h3>Kelola saldo token</h3>
        <p>Saldo 1.215 kWh = {frp(d['saldo_rp'])} ≈ 209 hari (±7 bulan).
          Dana sebesar itu menganggur; pertimbangkan menjaga saldo 1–2 bulan
          (150–200 kWh ≈ {frp(275250)}–{frp(367000)}) dan membeli lebih kecil
          secara berkala. Bila arus kas longgar, saldo besar tidak masalah —
          yang penting biaya admin dicatat terpisah.</p></div>
      </div>
      <div class="reco">
        <div class="reco-num">5</div>
        <div><h3>Lampu LED &amp; matikan standby</h3>
        <p>Ganti lampu pijar/neon lama ke LED dan cabut charger/alat standby.
          Potensi 3–8% atau 5–14 kWh ≈ {frp(9175)}–{frp(25690)}/bulan.</p></div>
      </div>
      <div class="reco">
        <div class="reco-num">6</div>
        <div><h3>Jika memakai AC/pendingin</h3>
        <p>Naikkan setelan 1 °C atau kurangi 1 jam pemakaian. AC 1 PK ±0,7 kWh/jam;
          satu jam per hari ≈ 21 kWh/bulan ≈ {frp(38535)}.</p></div>
      </div>
    </div>

    <div class="table-card">
      <h3>Tabel 5 — Simulasi target penghematan</h3>
      <table>
        <thead><tr>
          <th>Target hemat</th><th class="num">kWh/bulan</th>
          <th class="num">Rp/bulan</th><th class="num">Rp/tahun</th>
          <th>Catatan</th>
        </tr></thead>
        <tbody>
          <tr><td>5%</td><td class="num">9</td><td class="num">{frp(16515)}</td>
            <td class="num">{frp(198180)}</td><td>Menekan satu hari lonjakan</td></tr>
          <tr class="highlight"><td><b>10% (disarankan)</b></td>
            <td class="num">18</td><td class="num">{frp(33030)}</td>
            <td class="num">{frp(396360)}</td><td>Selasa + dua hari lonjakan</td></tr>
          <tr><td>15%</td><td class="num">27</td><td class="num">{frp(49545)}</td>
            <td class="num">{frp(594540)}</td><td>Ditambah LED &amp; standby</td></tr>
          <tr><td>20%</td><td class="num">36</td><td class="num">{frp(66060)}</td>
            <td class="num">{frp(792720)}</td><td>Perlu audit peralatan</td></tr>
        </tbody>
      </table>
      <p class="note">Acuan: pemakaian {fnum(d['total_kwh'])} kWh /
        {frp(d['total_rp'])} per bulan. Angka tahunan = target bulanan × 12.</p>
    </div>

    <div class="card monitor">
      <h3>Patokan pemantauan bulanan</h3>
      <p>Gunakan rata-rata harian {fnum(d['rata'], 2)} kWh sebagai garis dasar;
        waspadai minggu penuh di atas <b>47 kWh</b> (rekor mingguan Oktober) atau
        hari di atas <b>10 kWh</b>. Bila dua minggu berturut-turut melewati patokan,
        evaluasi peralatan besar sebelum tagihan naik.</p>
    </div>
  </section>"""


def bagian_kualitas(d):
    return f"""
  <section class="section" id="kualitas">
    <h2 class="section-title"><span class="num">8</span> Catatan Kualitas Data</h2>
    <p class="lead">Data mentah berasal dari sheet catatan manual. Dua kesalahan
      hitung pada sheet sudah diidentifikasi dan dikoreksi dalam laporan ini;
      total yang dipakai adalah hasil hitung ulang dari angka mentah.</p>

    <div class="table-card">
      <h3>Tabel 6 — Kesalahan pada sheet asli dan koreksinya</h3>
      <table>
        <thead><tr>
          <th style="width:4%">No</th><th style="width:33%">Temuan</th>
          <th style="width:26%">Angka di sheet</th>
          <th style="width:37%">Koreksi yang dipakai</th>
        </tr></thead>
        <tbody>
          <tr>
            <td class="num">1</td>
            <td>Biaya baris <b>13 Oktober</b> tidak sesuai pemakaian</td>
            <td>Rp 22.020 untuk 3 kWh</td>
            <td>Rp 5.505 (3 kWh × Rp 1.835); selisih Rp 16.515</td>
          </tr>
          <tr>
            <td class="num">2</td>
            <td>Subtotal <b>Minggu 3</b> (12–18 Okt) mewarisi kesalahan di atas</td>
            <td>Rp 73.400</td>
            <td>Rp 56.885 (31 kWh) — selisih tepat Rp 16.515</td>
          </tr>
          <tr>
            <td class="num">3</td>
            <td>Baris <b>1 November</b> memasukkan sisa 1.215 kWh sebagai pemakaian</td>
            <td>Total Rp 2.576.340; "TOTAL PEMAKAIAN KWH" 2.260.720</td>
            <td>1 Nov hanya pembanding; total valid 180 kWh / Rp 330.300</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card quality-check">
      <h3>Rekonsiliasi saldo sebagai bukti angka valid</h3>
      <p>Angka valid dihitung ulang langsung dari dataset:
        <b>1.286 kWh</b> (sisa awal) <b>+ 109 kWh</b> (token masuk)
        <b>− 1.215 kWh</b> (sisa akhir) = <b>{fnum(d['total_kwh'])} kWh</b>.
        Hasilnya sama dengan penjumlahan pemakaian 31 hari, dan
        {fnum(d['total_kwh'])} × Rp 1.835 = <b>{frp(d['total_rp'])}</b>. Dua jalur
        perhitungan yang saling cocok ini menegaskan angka laporan.</p>
    </div>

    <div class="card quality-minor">
      <h3>Catatan kecil lain</h3>
      <ul>
        <li>Ejaan catatan tidak seragam: "<i>MEDUNG</i>" pada 2 dan 6 Oktober
          adalah "<i>MENDUNG</i>"; "<i>MANTAP</i>" dipakai sebagai penanda khusus
          (12, 24, 31 Okt) yang belum dijelaskan. Sebaiknya dibuat konvensi catatan
          baku (mis. MENDUNG/ASAP/HUJAN/CERAH/TOKEN).</li>
        <li>Pemakaian 0 kWh pada hari-hari berbendera "MANTAP" membuat rata-rata
          harian bulanan sedikit bias ke bawah; nilai pemakaian sebenarnya
          kemungkinan bergeser ke hari berikutnya.</li>
        <li>Tarif Rp 1.835/kWh adalah asumsi (lihat Metodologi), bukan angka resmi
          dari tagihan; bila tarif/PPJ berbeda, biaya rupiah menyesuaikan
          proporsional, sedangkan kWh tetap.</li>
      </ul>
    </div>
  </section>"""


def bagian_metodologi(d):
    return f"""
  <section class="section" id="metodologi">
    <h2 class="section-title"><span class="num">9</span> Metodologi</h2>

    <ol class="method">
      <li><b>Sumber &amp; cakupan data.</b> Dataset
        <code>dataset-oktober-2026.csv</code> berisi 31 catatan harian
        (1–31 Oktober 2026) ditambah 1 catatan 1 November 2026 sebagai pembanding
        untuk menghitung pemakaian 31 Oktober; hasil hitung tersimpan di
        <code>hitung-oktober.json</code>.</li>
      <li><b>Perhitungan pemakaian.</b> Pemakaian diatribusikan ke hari pembacaan
        (selisih ke pembacaan berikutnya), mengikuti logika sheet:
        <div class="formula">Pemakaian hari H = sisa kWh hari H + token masuk − sisa kWh hari H+1</div>
        Token masuk dihitung pada pembacaan berikutnya agar pengisian token tidak
        terbaca sebagai pemakaian. Contoh: 11 Oktober = 1.205 + 109 − 1.309 =
        5 kWh; 12 Oktober = 1.309 + 0 − 1.309 = 0 kWh.</li>
      <li><b>Biaya.</b> Setiap kWh dihargai Rp 1.835; biaya harian = kWh ×
        Rp 1.835, dibulatkan ke rupiah terdekat. Biaya bulanan = total kWh ×
        Rp 1.835.</li>
      <li><b>Rekonsiliasi.</b> Total pemakaian juga diuji lewat neraca saldo:
        sisa awal + token masuk − sisa akhir = 1.286 + 109 − 1.215 = 180 kWh.</li>
      <li><b>Statistik &amp; perkiraan.</b> Rata-rata aritmetika 31 hari, median,
        simpangan baku populasi; agregat mingguan Senin–Minggu (minggu pertama/
        terakhir parsial). Perkiraan bulanan = rata-rata harian × 30; perkiraan
        tahunan = rata-rata harian × 365 — bukan tagihan resmi.</li>
      <li><b>Asumsi tarif.</b> Rp 1.835/kWh konsisten dengan golongan R-2/TR
        3500–5500 VA: tarif Rp 1.699,53/kWh + PPJ ±8% (Rp 1.699,53 × 1,08 ≈
        Rp 1.835,5). Ini <b>dugaan</b>, bukan kepastian; sesuaikan dengan tagihan
        PLN bila berbeda.</li>
      <li><b>Keterbatasan &amp; verifikasi.</b> Satu bulan data, resolusi pembacaan
        1 kWh, catatan cuaca tidak lengkap, dan hari nol memengaruhi rata-rata
        mingguan. Seluruh angka di laporan dihitung ulang secara terprogram dari
        CSV (bukan menyalin sheet): hasil <b>{fnum(d['total_kwh'])} kWh</b> dan
        <b>{frp(d['total_rp'])}</b>, cocok dengan rekonsiliasi saldo dan dengan
        <code>hitung-oktober.json</code>.</li>
    </ol>
  </section>"""


def bagian_penutup(d):
    return """
  <footer class="doc-footer">
    <p><b>Laporan Analisa Pemakaian Listrik Rumah — Oktober 2026</b> ·
      Tarif acuan Rp 1.835/kWh · Bukan tagihan resmi PLN.</p>
  </footer>"""


# --------------------------------------------------------------------------
# CSS
# --------------------------------------------------------------------------
CSS = r"""
:root{
  --ink:#0f172a; --ink2:#1f2937; --muted:#6b7280; --line:#e5e7eb;
  --accent:#0f766e; --accent-dk:#115e59; --accent-soft:#ecfdf5;
  --warn:#c2410c; --warn-soft:#fff7ed; --bg:#eef2f7; --paper:#ffffff;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:var(--bg);color:var(--ink2);
  font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;
  font-size:10.2pt;line-height:1.5}
.page{max-width:960px;margin:26px auto;background:var(--paper);
  box-shadow:0 18px 44px rgba(15,23,42,.14);padding:38px 46px 40px}
h1,h2,h3{font-weight:700;color:var(--ink)}
h3{font-size:11.2pt;margin:0 0 6px}
p{margin:0 0 9px}
code{font-family:Consolas,"Cascadia Code",monospace;font-size:.9em;
  background:#f1f5f9;padding:1px 5px;border-radius:4px;color:#0f172a}

/* ---------- toolbar layar ---------- */
.toolbar{position:fixed;top:14px;right:16px;z-index:20;display:flex;gap:10px;
  align-items:center;background:rgba(15,23,42,.92);color:#e2e8f0;
  padding:8px 12px;border-radius:10px;font-size:8.6pt;box-shadow:0 8px 20px rgba(0,0,0,.25)}
.toolbar button{cursor:pointer;border:0;border-radius:7px;padding:6px 12px;
  background:#14b8a6;color:#04231f;font-weight:700;font-size:8.6pt}
.toolbar button:hover{background:#2dd4bf}

/* ---------- kover ---------- */
.cover{position:relative;overflow:hidden;border-radius:16px;padding:30px 34px 26px;
  color:#fff;background:linear-gradient(135deg,#042f2c 0%,#0f766e 58%,#134e4a 100%)}
.cover::before{content:"";position:absolute;inset:0;
  background:radial-gradient(520px 210px at 88% -18%,rgba(45,212,191,.38),transparent 62%);}
.cover>*{position:relative}
.badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:15px}
.badge{font-size:7.6pt;letter-spacing:.14em;text-transform:uppercase;font-weight:700;
  padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.16);
  border:1px solid rgba(255,255,255,.28)}
.badge.alt{background:#f59e0b;border-color:#f59e0b;color:#3b2100}
.cover h1{font-size:25pt;line-height:1.1;margin:0 0 9px;letter-spacing:-.01em;color:#fff}
.cover h1 span{color:#99f6e4;font-weight:650}
.cover .sub{max-width:660px;color:#d1fae5;font-size:10.2pt;margin:0 0 17px}
.cover-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:11px 20px;
  border-top:1px solid rgba(255,255,255,.2);padding-top:14px;margin:0}
.cover-meta dt{font-size:7.2pt;text-transform:uppercase;letter-spacing:.12em;
  color:#99f6e4;font-weight:600;margin-bottom:2px}
.cover-meta dd{margin:0;font-size:10.4pt;font-weight:600}
.cover-meta dd.big{font-size:12.4pt;color:#fff}

/* ---------- judul bagian ---------- */
.section{margin-top:26px}
.section-title{display:flex;align-items:center;gap:9px;font-size:15pt;margin:0 0 11px;
  padding-bottom:7px;border-bottom:2px solid #d1fae5;color:var(--ink)}
.section-title .num{display:inline-flex;flex:none;width:25px;height:25px;
  border-radius:8px;background:var(--accent);color:#fff;font-size:10.5pt;
  align-items:center;justify-content:center}
.lead{color:#374151;margin:0 0 12px}
.note{font-size:8.5pt;color:var(--muted);margin:8px 0 0;line-height:1.45}

/* ---------- ringkasan eksekutif ---------- */
.exec{margin:0;padding-left:22px;display:grid;gap:7px}
.exec li{padding-left:2px}
.exec li::marker{color:var(--accent);font-weight:800;font-size:1.05em}
.callout{display:flex;gap:12px;align-items:flex-start;margin-top:14px;
  background:var(--accent-soft);border:1px solid #99f6e4;border-left:4px solid var(--accent);
  border-radius:9px;padding:11px 14px}
.callout-label{flex:none;font-size:7.6pt;letter-spacing:.12em;text-transform:uppercase;
  font-weight:800;color:#0f766e;background:#ccfbf1;border-radius:6px;padding:4px 8px}
.callout p{margin:0;font-size:9.6pt}
.insight{margin-top:4px;background:#f0fdfa;border:1px solid #99f6e4;
  border-left:4px solid var(--accent);border-radius:9px;padding:10px 14px}
.insight p{margin:0;font-size:9.3pt}

/* ---------- kartu statistik ---------- */
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.stat-card{border:1px solid var(--line);border-top:3px solid var(--accent);
  border-radius:10px;padding:11px 13px;background:#fff}
.stat-card .label{font-size:7.8pt;text-transform:uppercase;letter-spacing:.07em;
  color:var(--muted);font-weight:700}
.stat-card .value{font-size:16.5pt;font-weight:800;color:var(--ink);
  line-height:1.18;margin:3px 0 2px;letter-spacing:-.01em}
.stat-card .sub{font-size:8pt;color:var(--muted);line-height:1.35}
.stat-card.accent{border-top-color:#0d9488}
.stat-card.warn{border-top-color:var(--warn)}
.stat-card.warn .value{color:#9a3412}

/* ---------- daftar isi ---------- */
.toc{margin-top:14px;border:1px solid var(--line);border-radius:10px;
  padding:11px 15px;background:#f8fafc}
.toc h3{font-size:8.4pt;text-transform:uppercase;letter-spacing:.1em;
  color:var(--muted);margin:0 0 7px}
.toc ol{margin:0;padding:0;list-style:none;display:grid;
  grid-template-columns:repeat(3,1fr);gap:4px 18px;font-size:8.9pt}
.toc li{display:flex;gap:6px;color:#334155}
.toc .n{color:#0f766e;font-weight:800;flex:none}

/* ---------- grafik ---------- */
.figure-card{border:1px solid var(--line);border-radius:10px;padding:12px 14px 9px;
  background:#fff;margin:0 0 13px}
.fig-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;
  margin-bottom:2px}
.fig-head h3{font-size:10.4pt;margin:0}
.fig-tag{font-size:7.6pt;color:#0f766e;background:#ccfbf1;border-radius:999px;
  padding:2px 9px;font-weight:700;flex:none}
.chart{display:block;width:100%;height:auto}
figure figcaption{font-size:8.3pt;color:var(--muted);margin-top:6px;line-height:1.45}
figure{margin:0 0 13px}

/* ---------- tabel ---------- */
table{width:100%;border-collapse:collapse;font-size:9pt}
thead th{background:#0f3b39;color:#fff;font-weight:600;padding:6px 7px;
  text-align:left;font-size:8.4pt;letter-spacing:.02em;vertical-align:bottom}
tbody td{padding:4px 7px;border-bottom:1px solid #eef2f7;vertical-align:top}
tbody tr:nth-child(even) td{background:#f8fafc}
tbody tr.highlight td{background:#fff7ed}
tr.subtotal td{background:#ecfdf5!important;font-weight:600;color:#064e3b;
  border-top:1px solid #99f6e4;border-bottom:1px solid #99f6e4}
tr.total td{background:#0f766e!important;color:#fff;font-weight:700;font-size:9.2pt}
tr.compare td{background:#fafafa!important;color:var(--muted);font-style:italic}
tr.zero td{color:#94a3b8}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;
  font-feature-settings:"tnum"}
td.strong{font-weight:700;color:var(--ink)}
td.cat{font-size:8.3pt;color:#475569}
.table-card{border:1px solid var(--line);border-radius:10px;padding:13px 15px 11px;
  margin:0 0 13px;background:#fff}
.table-card h3{font-size:10.4pt;margin:0 0 8px}

/* ---------- pola ---------- */
.pattern-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:12px}
.card{border:1px solid var(--line);border-radius:10px;padding:13px 15px;background:#fff}
.card p{margin:0;font-size:9.4pt}
.card h3{color:var(--ink)}
.pattern{border-left:3px solid #0d9488}
.rhythm,.monitor,.verified{margin-top:12px}
.weather{margin-top:12px}
.quality-check{border-left:3px solid #0ea5e9;margin-bottom:12px}
.quality-minor{border-left:3px solid #f59e0b}
.quality-minor ul{margin:0;padding-left:20px}
.quality-minor li{margin-bottom:5px;font-size:9.4pt}

/* ---------- rekomendasi ---------- */
.reco-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:13px}
.reco{display:grid;grid-template-columns:27px 1fr;gap:10px;align-items:start;
  border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:#fff}
.reco-num{width:26px;height:26px;border-radius:8px;background:var(--accent-soft);
  border:1px solid #99f6e4;color:#0f766e;font-weight:800;font-size:10.5pt;
  display:flex;align-items:center;justify-content:center}
.reco h3{font-size:10.2pt;margin:1px 0 5px}
.reco p{margin:0;font-size:9.2pt}

/* ---------- metodologi ---------- */
.method{margin:0 0 12px;padding-left:22px;display:grid;gap:7px;font-size:9.6pt}
.method li::marker{color:var(--accent);font-weight:800}
.formula{font-family:Consolas,"Cascadia Code",monospace;font-size:8.8pt;
  background:#f1f5f9;border-left:3px solid var(--accent);border-radius:6px;
  padding:9px 12px;margin:8px 0 0;color:#0f172a}
.verified{border-left:3px solid #0d9488}

/* ---------- penutup ---------- */
.doc-footer{margin-top:22px;padding-top:10px;border-top:1px solid var(--line);
  font-size:8.1pt;color:var(--muted)}
.doc-footer p{margin:0}

/* ---------- cetak ---------- */
@page{size:A4 portrait;margin:12mm 13mm 14mm 13mm}
@media print{
  html,body{background:#fff}
  body{font-size:9.4pt;line-height:1.42}
  .page{max-width:none;margin:0;padding:0;box-shadow:none}
  .no-print{display:none!important}
  .section{margin-top:16px}
  .section-title{font-size:13pt;margin:0 0 8px;padding-bottom:5px}
  .section-title .num{width:21px;height:21px;font-size:9pt;border-radius:6px}
  .cover{padding:18px 22px 16px;border-radius:10px}
  .cover h1{font-size:19.5pt;margin-bottom:6px}
  .cover .sub{font-size:9pt;margin-bottom:11px}
  .cover-meta{gap:8px 16px;padding-top:10px}
  .cover-meta dd{font-size:9.4pt}
  .cover-meta dd.big{font-size:11pt}
  .badge{font-size:6.8pt;padding:3px 8px}
  .exec{font-size:9.2pt;gap:5px}
  .callout{padding:8px 11px}
  .callout p{font-size:8.8pt}
  .callout ul{font-size:8.5pt}
  .method{gap:4px;font-size:8.8pt;margin-bottom:4px}
  .stat-grid{gap:7px}
  .stat-card{padding:8px 10px;border-radius:8px}
  .stat-card .value{font-size:14pt}
  .stat-card .sub{font-size:7.4pt}
  .toc{padding:8px 11px;margin-top:9px}
  .toc h3{margin-bottom:5px;font-size:7.6pt}
  .toc ol{font-size:8pt;gap:2px 14px}
  .figure-card{padding:9px 11px 7px;margin-bottom:10px;break-inside:avoid}
  figure figcaption{font-size:7.7pt;margin-top:4px}
  table{font-size:8.2pt}
  thead th{padding:4.5px 6px;font-size:7.8pt}
  tbody td{padding:2.6px 6px}
  tr.total td{font-size:8.6pt}
  .daily tbody td{padding:2.2px 6px}
  td.cat{font-size:7.6pt}
  .table-card{padding:10px 12px 8px;margin-bottom:10px;break-inside:avoid}
  .card{padding:10px 12px}
  .card p,.quality-minor li,.method{font-size:8.8pt}
  .reco-grid,.pattern-grid{gap:8px}
  .reco{padding:9px 11px}
  .reco p{font-size:8.6pt}
  .lead{font-size:9pt}
  .doc-footer{font-size:7.4pt;margin-top:4px;padding-top:3px}
  h2,h3{break-after:avoid;page-break-after:avoid}
  figure,table,.card,.stat-card,.reco,.callout,.formula,.figure-card,.table-card,.insight{
    break-inside:avoid;page-break-inside:avoid}
  thead{display:table-header-group}
  tr,li{break-inside:avoid;page-break-inside:avoid}
  .newpage{break-before:page;page-break-before:always}
}

/* ---------- layar kecil ---------- */
@media screen and (max-width:820px){
  .page{margin:0;padding:22px 18px;box-shadow:none;border-radius:0}
  .stat-grid{grid-template-columns:repeat(2,1fr)}
  .pattern-grid,.reco-grid{grid-template-columns:1fr}
  .cover{padding:22px 20px}
  .cover h1{font-size:20pt}
  .cover-meta{grid-template-columns:repeat(2,1fr)}
  .toolbar{display:none}
}
"""


# --------------------------------------------------------------------------
# Rakit HTML
# --------------------------------------------------------------------------
def build_html(d):
    return f"""<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Laporan analisa pemakaian listrik rumah Oktober 2026: {fnum(d['total_kwh'])} kWh, {frp(d['total_rp'])}.">
<title>Laporan Analisa Pemakaian Listrik Rumah — Oktober 2026</title>
<style>{CSS}</style>
</head>
<body>
<div class="toolbar no-print">
  <span>Dokumen siap cetak A4</span>
  <button type="button" onclick="window.print()">Cetak / Simpan PDF</button>
</div>
<main class="page">
{bagian_kover(d)}
{bagian_ringkasan(d)}
{bagian_statistik(d)}
{bagian_grafik(d)}
{bagian_tabel_harian(d)}
{bagian_rekap(d)}
{bagian_pola(d)}
{bagian_rekomendasi(d)}
{bagian_kualitas(d)}
{bagian_metodologi(d)}
{bagian_penutup(d)}
</main>
</body>
</html>
"""


# --------------------------------------------------------------------------
# Rakit Markdown
# --------------------------------------------------------------------------
def build_md(d):
    ph = d["per_hari"]
    minggu_rows = "\n".join(
        f"| Minggu {m['nomor']} | {m['rentang']} | {m['hari']} | {fnum(m['kwh'])} "
        f"| {frp(m['rp'])} | {fnum(m['avg'], 2)} | {fpct(m['kwh'] / d['total_kwh'] * 100)} |"
        for m in d["minggu"])
    hari_rows = "\n".join(
        f"| {h} | {fnum(ph[h]['kwh'])} | {ph[h]['hari']} | {fnum(ph[h]['avg'], 2)} "
        f"| {frp(ph[h]['kwh'] * HARGA)} |" for h in HARI)
    urutan = ["Mendung", "Asap", "Hujan", "Cerah", "Penanda token (MANTAP)",
              "Tanpa catatan"]
    cuaca_rows = "\n".join(
        f"| {k.replace(' (MANTAP)', '')} | {d['cuaca'][k]['hari']} "
        f"| {fnum(d['cuaca'][k]['kwh'])} | {fnum(d['cuaca'][k]['avg'], 2)} "
        f"| {frp(d['cuaca'][k]['rp'])} |"
        for k in urutan if k in d["cuaca"])
    top5_list = ", ".join(f"{r['date'].day} Okt ({r['pemakaian']} kWh)"
                          for r in d["top5"])
    return f"""# Laporan Analisa Pemakaian Listrik Rumah — Oktober 2026

**Periode:** 1–31 Oktober 2026 · **Data:** {len(d['oct_rows'])} catatan harian + 1 pembanding (1 Nov 2026) · **Tarif acuan:** Rp 1.835/kWh

## Ringkasan

- **Total pemakaian {fnum(d['total_kwh'])} kWh / {frp(d['total_rp'])}** — rata-rata **{fnum(d['rata'], 2)} kWh/hari** ({frp(d['biaya_hari'])}/hari).
- **Pemakaian tidak merata:** lima hari tertinggi (≥10 kWh) menyumbang **{fnum(d['top5_kwh'])} kWh ({fpct(d['top5_kwh'] / d['total_kwh'] * 100)})**; dua hari tertinggi 2 & 6 Okt masing-masing 13 kWh ({frp(23855)}).
- **Selasa paling boros ({fnum(ph['Selasa']['avg'], 2)} kWh/hari), Senin paling hemat ({fnum(ph['Senin']['avg'], 2)} kWh/hari)** — selisih {fnum(ph['Selasa']['avg'] - ph['Senin']['avg'], 2)} kWh/hari ≈ {frp((ph['Selasa']['avg'] - ph['Senin']['avg']) * HARGA)}.
- **Saldo token aman:** sisa akhir {fnum(d['sisa_akhir'])} kWh ({frp(d['saldo_rp'])}) ≈ **{fnum(d['saldo_hari'], 0)} hari** pemakaian; token masuk 109 kWh ({frp(200015)}) pada 12 Okt.
- **Target hemat 10% realistis:** 18 kWh/bulan = {frp(33030)}/bulan = **{frp(396360)}/tahun**.
- **Dua kesalahan hitung pada sheet asli** (13 Okt dan baris 1 Nov) sudah dikoreksi; angka valid **{fnum(d['total_kwh'])} kWh / {frp(d['total_rp'])}**.
- **Hari nol 12, 24, 31 Okt** adalah artefak pencatatan (token/pembacaan ganda), bukan pemakaian nol sesungguhnya.

## Statistik utama

| Metrik | Nilai |
|---|---|
| Total pemakaian | {fnum(d['total_kwh'])} kWh |
| Total biaya | {frp(d['total_rp'])} |
| Rata-rata harian | {fnum(d['rata'], 2)} kWh ({frp(d['biaya_hari'])}/hari) |
| Median harian | {fnum(d['median'])} kWh |
| Simpangan baku | {fnum(d['sd'], 2)} kWh |
| Hari tertinggi | 13 kWh — 2 Okt & 6 Okt ({frp(23855)}) |
| Hari nol | 12, 24, 31 Okt |
| Token masuk | 109 kWh ({frp(200015)}) — 12 Okt |
| Sisa awal → akhir | {fnum(d['sisa_awal'])} → {fnum(d['sisa_akhir'])} kWh |
| Saldo token | {frp(d['saldo_rp'])} (≈{fnum(d['saldo_hari'], 0)} hari) |
| Perkiraan 30 hari | {fnum(d['bulan30_kwh'], 2)} kWh / {frp(d['bulan30_rp'])} |
| Perkiraan setahun | {fnum(d['tahun_kwh'], 2)} kWh / {frp(d['tahun_rp'])} |

## Rekap mingguan (Senin–Minggu)

| Minggu | Rentang | Hari | kWh | Biaya | kWh/hari | Pangsa |
|---|---|---|---|---|---|---|
{minggu_rows}
| **Total** | **1–31 Okt** | **31** | **{fnum(d['total_kwh'])}** | **{frp(d['total_rp'])}** | **{fnum(d['rata'], 2)}** | **100,0%** |

Minggu 1 (1–4 Okt) dan Minggu 5 (26–31 Okt) parsial sesuai periode laporan.

## Rata-rata per hari dalam seminggu

| Hari | kWh | Jml hari | kWh/hari | Biaya |
|---|---|---|---|---|
{hari_rows}

## Rekap bulanan

| Periode | Hari | kWh | Biaya | kWh/hari |
|---|---|---|---|---|
| **Oktober 2026 (aktual)** | 31 | {fnum(d['total_kwh'])} | {frp(d['total_rp'])} | {fnum(d['rata'], 2)} |
| Perkiraan 30 hari | 30 | {fnum(d['bulan30_kwh'], 2)} | {frp(d['bulan30_rp'])} | {fnum(d['rata'], 2)} |
| Perkiraan setahun | 365 | {fnum(d['tahun_kwh'], 2)} | {frp(d['tahun_rp'])} | {fnum(d['rata'], 2)} |

## Analisa pola

- **Hari tersibuk — Selasa:** rata-rata {fnum(ph['Selasa']['avg'], 2)} kWh/hari ({fpct((ph['Selasa']['avg'] - d['rata']) / d['rata'] * 100)} di atas rata-rata bulanan).
- **Hari paling hemat — Senin:** rata-rata {fnum(ph['Senin']['avg'], 2)} kWh/hari ({fpct((ph['Senin']['avg'] - d['rata']) / d['rata'] * 100)} dari rata-rata).
- **Lonjakan:** 2 & 6 Okt mencapai 13 kWh ({frp(23855)}); lima hari tertinggi — {top5_list} — total {fnum(d['top5_kwh'])} kWh.
- **Hari nol:** 12, 24, 31 Okt (0 kWh) — 12 Okt bertepatan dengan pengisian token 109 kWh; 24 & 31 Okt pembacaan sisa sama dengan hari berikutnya.
- **Ritme mingguan:** Minggu 2 (5–11 Okt) tertinggi 47 kWh; Minggu 3 (12–18 Okt) terendah 31 kWh. Hari kerja (Sen–Jum) {fnum(d['weekday_kwh'])} kWh vs akhir pekan (Sab–Min) {fnum(d['weekend_kwh'])} kWh — tidak berbeda jauh.
- **Catatan cuaca (indikatif):** dua dari tiga hari "mendung" mencatat 13 kWh, tetapi hari "asap" justru di bawah rata-rata; sampel terlalu kecil untuk kesimpulan sebab-akibat.

### Rekap menurut catatan cuaca

| Kondisi | Hari | kWh | kWh/hari | Biaya |
|---|---|---|---|---|
{cuaca_rows}
| **Total** | **31** | **{fnum(d['total_kwh'])}** | **{fnum(d['rata'], 2)}** | **{frp(d['total_rp'])}** |

## Rekomendasi penghematan

1. **Target 10% = 18 kWh/bulan ({frp(33030)}/bulan, {frp(396360)}/tahun).** Cukup dari menekan Selasa ke level rata-rata (±{fnum((ph['Selasa']['avg'] - d['rata']) * ph['Selasa']['hari'], 2)} kWh ≈ {frp((ph['Selasa']['avg'] - d['rata']) * ph['Selasa']['hari'] * HARGA)}) dan dua hari lonjakan ke 6 kWh (±10 kWh ≈ {frp(18350)}).
2. **Selidiki hari ≥11 kWh** (2, 6, 20, 23 Okt): catat peralatan besar yang berjalan. Menekan dua dari empat hari ke 6 kWh ≈ hemat {frp(18350)}/bulan.
3. **Perbaiki disiplin pencatatan:** jam tetap (mis. 07.00), token dicatat terpisah; hindari hari nol palsu.
4. **Kelola saldo token:** {fnum(d['sisa_akhir'])} kWh ({frp(d['saldo_rp'])}) ≈ 209 hari (±7 bulan) — dana menganggur; pertimbangkan menjaga saldo 1–2 bulan (150–200 kWh ≈ {frp(275250)}–{frp(367000)}).
5. **Lampu LED & matikan standby:** potensi 3–8% = 5–14 kWh ≈ {frp(9175)}–{frp(25690)}/bulan.
6. **Jika ada AC/pendingin:** naikkan setelan 1 °C atau kurangi 1 jam/hari — AC 1 PK ±0,7 kWh/jam ≈ 21 kWh/bulan ({frp(38535)}).

### Simulasi target

| Target | kWh/bulan | Rp/bulan | Rp/tahun |
|---|---|---|---|
| 5% | 9 | {frp(16515)} | {frp(198180)} |
| **10% (disarankan)** | **18** | **{frp(33030)}** | **{frp(396360)}** |
| 15% | 27 | {frp(49545)} | {frp(594540)} |
| 20% | 36 | {frp(66060)} | {frp(792720)} |

## Catatan kualitas data

Sheet asli memuat dua kesalahan hitung yang sudah dikoreksi:

| No | Temuan | Angka di sheet | Koreksi |
|---|---|---|---|
| 1 | Biaya 13 Okt tidak sesuai pemakaian (3 kWh) | Rp 22.020 | Rp 5.505 (3 × Rp 1.835) — selisih Rp 16.515 |
| 2 | Subtotal Minggu 3 (12–18 Okt) mewarisi kesalahan itu | Rp 73.400 | Rp 56.885 (31 kWh) |
| 3 | Baris 1 Nov memasukkan sisa 1.215 kWh sebagai pemakaian | Total Rp 2.576.340; "TOTAL PEMAKAIAN KWH" 2.260.720 | 1 Nov hanya pembanding; total valid 180 kWh / Rp 330.300 |

Rekonsiliasi saldo: 1.286 (sisa awal) + 109 (token masuk) − 1.215 (sisa akhir) = **{fnum(d['total_kwh'])} kWh**, cocok dengan penjumlahan pemakaian harian; {fnum(d['total_kwh'])} × Rp 1.835 = **{frp(d['total_rp'])}**.

Catatan kecil: ejaan "MEDUNG" (2 & 6 Okt) adalah "MENDUNG"; penanda "MANTAP" (12, 24, 31 Okt) belum dijelaskan dan sebaiknya dibuat konvensi catatan baku.

## Metodologi

- **Sumber:** `dataset-oktober-2026.csv` (31 catatan harian 1–31 Okt + 1 pembanding 1 Nov); hasil hitung `hitung-oktober.json`.
- **Rumus pemakaian:** `Pemakaian hari H = sisa kWh hari H + token masuk − sisa kWh hari H+1`. Token masuk dihitung pada pembacaan berikutnya sehingga tidak terbaca sebagai pemakaian (contoh: 11 Okt = 1.205 + 109 − 1.309 = 5 kWh; 12 Okt = 1.309 + 0 − 1.309 = 0 kWh).
- **Biaya:** kWh × Rp 1.835, dibulatkan ke rupiah terdekat.
- **Rekonsiliasi:** sisa awal + token masuk − sisa akhir = 1.286 + 109 − 1.215 = {fnum(d['total_kwh'])} kWh.
- **Statistik:** rata-rata aritmetika 31 hari, median, simpangan baku populasi; minggu Senin–Minggu (minggu pertama/terakhir parsial).
- **Perkiraan:** rata-rata harian × 30 (bulanan) dan × 365 (tahunan); bukan tagihan resmi.
- **Asumsi tarif:** Rp 1.835/kWh konsisten dengan R-2/TR 3500–5500 VA (Rp 1.699,53/kWh + PPJ ±8% ≈ Rp 1.835,5) — dugaan, bukan kepastian; sesuaikan dengan tagihan PLN.
- **Keterbatasan:** 1 bulan data, resolusi 1 kWh, catatan cuaca tidak lengkap, hari nol memengaruhi rata-rata mingguan.

## Verifikasi

Semua angka dihitung ulang secara terprogram dari CSV: total **{fnum(d['total_kwh'])} kWh / {frp(d['total_rp'])}**, cocok dengan rekonsiliasi saldo dan `hitung-oktober.json`. Dokumen HTML siap cetak A4: `laporan-analisa-oktober-2026.html`.
"""


# --------------------------------------------------------------------------
# Verifikasi silang terhadap hitung-oktober.json
# --------------------------------------------------------------------------
def verifikasi(d, ring):
    checks = []

    def banding(nama, nilai, harap, tol=1e-6):
        if isinstance(nilai, (int, float)) and isinstance(harap, (int, float)):
            ok = abs(float(nilai) - float(harap)) <= tol * max(1.0, abs(float(harap)))
        else:
            ok = nilai == harap
        checks.append((nama, nilai, harap, ok))

    banding("jumlah catatan Oktober", len(d["oct_rows"]), ring["jumlah_catatan"])
    banding("total kWh", d["total_kwh"], ring["total_kwh"])
    banding("total biaya", d["total_rp"], ring["total_rp"])
    banding("token masuk kWh", d["beli_kwh"], ring["beli_kwh"])
    banding("sisa awal", d["sisa_awal"], ring["sisa_awal"])
    banding("sisa akhir", d["sisa_akhir"], ring["sisa_akhir"])
    banding("rata-rata harian", d["rata"], ring["rata_harian"], 1e-9)
    banding("median harian", d["median"], ring["median_harian"])
    banding("simpangan baku", d["sd"], ring["stdev_harian"], 1e-9)
    banding("perkiraan bulanan Rp", d["bulan30_rp"], ring["perkiraan_bulanan_rp"], 1e-9)
    banding("perkiraan tahunan Rp", d["tahun_rp"], ring["perkiraan_tahunan_rp"], 1e-9)
    banding("perkiraan tahunan kWh", d["tahun_kwh"], ring["perkiraan_tahunan_kwh"], 1e-9)
    banding("jumlah minggu", len(d["minggu"]), len(ring["mingguan"]))
    for a, b in zip(d["minggu"], ring["mingguan"]):
        banding(f"minggu {a['nomor']} kWh", a["kwh"], b["kwh"])
        banding(f"minggu {a['nomor']} Rp", a["rp"], b["rp"])
        banding(f"minggu {a['nomor']} hari", a["hari"], b["hari"])
    for h in HARI:
        banding(f"hari {h} kWh", d["per_hari"][h]["kwh"], ring["per_hari"][h]["jumlah"])
        banding(f"hari {h} jumlah hari", d["per_hari"][h]["hari"], ring["per_hari"][h]["hari"])
        banding(f"hari {h} rata-rata", d["per_hari"][h]["avg"], ring["per_hari"][h]["rata"], 1e-9)
    banding("hari tertinggi kWh", d["maks"]["pemakaian"], ring["maks"]["kwh"])
    banding("tanggal hari tertinggi", d["maks"]["tanggal"], ring["maks"]["tanggal"])
    banding("jumlah hari nol", len(d["zeros"]), len(ring["hari_nol"]))

    # konsistensi internal
    banding("jumlah kWh mingguan = total", sum(m["kwh"] for m in d["minggu"]), d["total_kwh"])
    banding("jumlah kWh per hari = total", sum(v["kwh"] for v in d["per_hari"].values()),
            d["total_kwh"])
    banding("jumlah kWh cuaca = total", sum(v["kwh"] for v in d["cuaca"].values()),
            d["total_kwh"])
    banding("rekonsiliasi saldo", d["sisa_awal"] + d["beli_kwh"] - d["sisa_akhir"],
            d["total_kwh"])
    banding("total biaya = kWh x tarif", d["total_rp"], d["total_kwh"] * HARGA)

    print("\n=== VERIFIKASI ANGKA (CSV vs hitung-oktober.json) ===")
    gagal = 0
    for nama, nilai, harap, ok in checks:
        if isinstance(nilai, float):
            n_txt, h_txt = fnum(nilai, 2), fnum(harap, 2)
        else:
            n_txt, h_txt = str(nilai), str(harap)
        if not ok:
            gagal += 1
        print(f"  [{'OK' if ok else 'GAGAL'}] {nama:34s} {n_txt:>10s}  (harap {h_txt})")
    print(f"=== {len(checks) - gagal}/{len(checks)} pemeriksaan lolos ===\n")
    if gagal:
        raise SystemExit(f"{gagal} pemeriksaan GAGAL — laporan tidak ditulis.")


def cek_html(html, d):
    """Pemeriksaan konten HTML hasil generate."""
    wajib = [
        f"{fnum(d['total_kwh'])} kWh", frp(d["total_rp"]),
        "Ringkasan Eksekutif", "Metodologi", "Catatan Kualitas Data",
        "Rekomendasi Penghematan", "@media print", "page-break-inside:avoid",
        "<svg", "Rp 1.835",
    ]
    gagal = [w for w in wajib if w not in html]
    if gagal:
        raise SystemExit(f"HTML tidak memuat elemen wajib: {gagal}")
    for s in ("None", "nan"):
        if f">{s}<" in html or f" {s} " in html:
            raise SystemExit(f"HTML mengandung nilai tidak sah: {s}")
    print(f"[OK] HTML memuat angka kunci & elemen wajib "
          f"({len(html):,} karakter, {html.count('<svg')} grafik SVG)")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    d = muat_data()
    with open(SRC_JSON, encoding="utf-8") as f:
        ring = json.load(f)["ringkasan"]
    verifikasi(d, ring)

    html = build_html(d)
    md = build_md(d)
    cek_html(html, d)

    with open(OUT_HTML, "w", encoding="utf-8") as f:
        f.write(html)
    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write(md)

    print("File ditulis:")
    print(f"  - {OUT_HTML}  ({os.path.getsize(OUT_HTML):,} byte)")
    print(f"  - {OUT_MD}  ({os.path.getsize(OUT_MD):,} byte)")
    print("\nAngka kunci dari verifikasi:")
    print(f"  Total pemakaian : {fnum(d['total_kwh'])} kWh")
    print(f"  Total biaya     : {frp(d['total_rp'])}")
    print(f"  Rata-rata harian: {fnum(d['rata'], 2)} kWh "
          f"({frp(d['biaya_hari'])}/hari)")
    print(f"  Saldo akhir     : {fnum(d['sisa_akhir'])} kWh "
          f"({frp(d['saldo_rp'])}) sekitar {fnum(d['saldo_hari'], 0)} hari")


if __name__ == "__main__":
    main()
