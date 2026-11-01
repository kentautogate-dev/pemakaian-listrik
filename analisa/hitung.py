import json
import os
import statistics as st
from datetime import date, timedelta

OUT = r"C:\Users\filatelis\Documents\deepseek-harness\default-workspace\pemakaian-listrik-rumah\analisa"
os.makedirs(OUT, exist_ok=True)

HARGA = 1835

# sisa kWh pagi (dari catatan meteran/token) + token masuk kWh
raw = [
    ("2026-10-01", 1286, 0, "MENDUNG"),
    ("2026-10-02", 1279, 0, "MEDUNG"),
    ("2026-10-03", 1266, 0, ""),
    ("2026-10-04", 1256, 0, ""),
    ("2026-10-05", 1247, 0, ""),
    ("2026-10-06", 1244, 0, "MEDUNG"),
    ("2026-10-07", 1231, 0, ""),
    ("2026-10-08", 1227, 0, ""),
    ("2026-10-09", 1218, 0, ""),
    ("2026-10-10", 1214, 0, ""),
    ("2026-10-11", 1205, 0, ""),
    ("2026-10-12", 1309, 109, "MANTAP / tambah token 109 kWh"),
    ("2026-10-13", 1309, 0, "ASAP"),
    ("2026-10-14", 1306, 0, "ASAP"),
    ("2026-10-15", 1299, 0, "HUJAN"),
    ("2026-10-16", 1293, 0, "ASAP"),
    ("2026-10-17", 1290, 0, "ASAP"),
    ("2026-10-18", 1281, 0, "CERAH"),
    ("2026-10-19", 1278, 0, ""),
    ("2026-10-20", 1272, 0, ""),
    ("2026-10-21", 1261, 0, ""),
    ("2026-10-22", 1255, 0, ""),
    ("2026-10-23", 1249, 0, ""),
    ("2026-10-24", 1238, 0, "MANTAP"),
    ("2026-10-25", 1238, 0, ""),
    ("2026-10-26", 1232, 0, ""),
    ("2026-10-27", 1229, 0, ""),
    ("2026-10-28", 1226, 0, ""),
    ("2026-10-29", 1221, 0, ""),
    ("2026-10-30", 1216, 0, ""),
    ("2026-10-31", 1215, 0, "MANTAP"),
    ("2026-11-01", 1215, 0, ""),
]

# Pemakaian diatribusikan ke hari saat pembacaan dilakukan (selisih ke pembacaan berikutnya),
# sama seperti logika sheet: sisa(hari ini) + token masuk - sisa(hari berikutnya).
rows = []
for i, (tgl, sisa, masuk, note) in enumerate(raw):
    usage = None
    rp = None
    if i < len(raw) - 1:
        nxt_sisa = raw[i + 1][1]
        nxt_masuk = raw[i + 1][2]
        usage = sisa + nxt_masuk - nxt_sisa
        rp = usage * HARGA
    rows.append({"tanggal": tgl, "sisa": sisa, "masuk": masuk, "catatan": note,
                 "pemakaian": usage, "biaya": rp})

oktober = [r for r in rows if r["tanggal"].startswith("2026-10")]
pakai = [r["pemakaian"] for r in oktober if r["pemakaian"] is not None]

# buang catatan 1 November (hanya pembanding)
akhir = rows[-1]
total_kwh = sum(pakai)
total_rp = total_kwh * HARGA
beli_kwh = sum(r["masuk"] for r in oktober)
beli_rp = beli_kwh * HARGA
sisa_akhir = akhir["sisa"]
sisa_awal = raw[0][1]
saldo_cek = sisa_awal + beli_kwh - sisa_akhir

# mingguan: Senin-Minggu (Minggu sebagai akhir minggu, seperti sheet)
minggu = {}
for r in oktober:
    if r["pemakaian"] is None:
        continue
    d = date.fromisoformat(r["tanggal"])
    senin = d - timedelta(days=d.weekday())
    key = senin.isoformat()
    m = minggu.setdefault(key, {"mulai": key, "kwh": 0, "rp": 0, "hari": 0})
    m["kwh"] += r["pemakaian"]
    m["rp"] += r["biaya"]
    m["hari"] += 1

hari_nama = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
per_hari = {n: [] for n in hari_nama}
for r in oktober:
    if r["pemakaian"] is None:
        continue
    n = hari_nama[date.fromisoformat(r["tanggal"]).weekday()]
    per_hari[n].append(r["pemakaian"])

hari_stats = {n: {"jumlah": sum(v), "hari": len(v), "rata": (sum(v) / len(v)) if v else 0}
              for n, v in per_hari.items()}

mean = st.mean(pakai)
median = st.median(pakai)
sd = st.pstdev(pakai)
spikes = [r for r in oktober if r["pemakaian"] is not None and r["pemakaian"] >= mean + 1.0 * sd]
zeros = [r for r in oktober if r["pemakaian"] == 0]
maks = max(oktober, key=lambda r: r["pemakaian"] or -1)

hasil = {
    "harga_per_kwh": HARGA,
    "jumlah_catatan": len(oktober),
    "total_kwh": total_kwh,
    "total_rp": total_rp,
    "beli_kwh": beli_kwh,
    "beli_rp": beli_rp,
    "sisa_awal": sisa_awal,
    "sisa_akhir": sisa_akhir,
    "saldo_cek": saldo_cek,
    "rata_harian": mean,
    "median_harian": median,
    "stdev_harian": sd,
    "rata_bulanan_30": mean * 30,
    "perkiraan_bulanan_rp": mean * 30 * HARGA,
    "perkiraan_tahunan_kwh": mean * 365,
    "perkiraan_tahunan_rp": mean * 365 * HARGA,
    "mingguan": list(minggu.values()),
    "per_hari": hari_stats,
    "spikes": [{"tanggal": r["tanggal"], "kwh": r["pemakaian"], "rp": r["biaya"]} for r in spikes],
    "hari_nol": [r["tanggal"] for r in zeros],
    "maks": {"tanggal": maks["tanggal"], "kwh": maks["pemakaian"], "rp": maks["biaya"]},
}

with open(os.path.join(OUT, "hitung-oktober.json"), "w", encoding="utf-8") as f:
    json.dump({"rows": rows, "ringkasan": hasil}, f, ensure_ascii=False, indent=2)

with open(os.path.join(OUT, "dataset-oktober-2026.csv"), "w", encoding="utf-8", newline="") as f:
    f.write("tanggal,sisa,masuk,catatan\n")
    for r in raw:
        f.write(f"{r[0]},{r[1]},{r[2]},\"{r[3]}\"\n")

print(json.dumps(hasil, ensure_ascii=False, indent=2))
