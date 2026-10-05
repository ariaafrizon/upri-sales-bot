# Upri Sales Bot — Panduan Nyalain (±10 menit)

Bot ini ngecek penjualan **Upriworld** & **UpriMutant** di Stargaze (Cosmos Hub) tiap ±5 menit,
lalu kirim notif (gambar NFT, harga ATOM + USD, buyer/seller, link tx) ke Discord.
Jalan di **GitHub Actions** (server gratis GitHub) — **PC kamu boleh mati**.

Notif dikirim ke:
| Server | Channel | Isi |
|---|---|---|
| Upriworld | #💰・nft-sales | Upriworld + UpriMutant |
| UPRIVERSE | #💰┃upriworld-sales (UPRIWORLD'S FAM) | Upriworld saja |
| UPRIVERSE | #💰┃uprimutant-sales (UPRIMUTANT'S FAM) | UpriMutant saja |

---

## Langkah 1 — Login / daftar GitHub
Buka https://github.com → login (atau **Sign up** kalau belum punya, gratis).

## Langkah 2 — Bikin repository
1. Klik **+** (kanan atas) → **New repository**.
2. Repository name: `upri-sales-bot`
3. Pilih **Public** (wajib: GitHub Actions gratis tanpa batas cuma untuk repo public.
   Aman — URL webhook disimpan di *Secrets*, tidak ikut kelihatan).
4. **Jangan** centang "Add a README". Klik **Create repository**.

## Langkah 3 — Upload file bot
1. Di halaman repo baru, klik link **uploading an existing file**.
2. Buka folder `Documents\upri-sales-bot` di File Explorer.
3. Pilih & drag ke browser file-file ini:
   `index.mjs`, `config.json`, `package.json`, `state.json`, `PANDUAN.md`, `.gitignore`
   **dan folder `.github`** (drag foldernya langsung).
   ⚠️ **JANGAN upload file `.env`** — isinya rahasia (URL webhook).
4. Klik **Commit changes**.
5. Cek di halaman repo ada folder `.github/workflows/sales.yml`. Kalau tidak ada, ulangi drag folder `.github`.

## Langkah 4 — Masukin webhook ke Secrets
1. Buka file `Documents\upri-sales-bot\.env` pakai **Notepad**. Isinya 3 baris `NAMA=https://discord.com/api/webhooks/...`
2. Di repo GitHub: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
3. Bikin 3 secret (Name = bagian sebelum `=`, Secret = URL setelah `=`):
   - `WEBHOOK_UPRIWORLD_SERVER_SALES`
   - `WEBHOOK_UPRIVERSE_UPRIWORLD_SALES`
   - `WEBHOOK_UPRIVERSE_UPRIMUTANT_SALES`

## Langkah 5 — Nyalain
1. Tab **Actions** → kalau ada tombol hijau "I understand my workflows, go ahead and enable them", klik.
2. Klik **Upri Sales Bot** (kiri) → **Run workflow** → mode `normal` → **Run workflow**.
3. Tunggu ±1 menit, harus ✅ hijau. Selesai — sejak itu bot jalan otomatis tiap ±5 menit.

> Mode `test` = kirim penjualan terakhir sebagai **[TEST]** ke **semua** channel (termasuk Upriworld yang ramai).
> Pakai hanya kalau perlu.

---

## Catatan
- Notif bisa telat 5–15 menit (jadwal GitHub kadang molor). Normal.
- Penjualan lama tidak akan diposting ulang (dicatat di `state.json`, di-update otomatis oleh bot).
- Mau tambah koleksi / channel baru → edit `config.json` (bagian `collections` dan `routes`).
- Kalau Actions merah ❌: buka run-nya, lihat log. Biasanya karena secret salah ketik.
- Kalau URL webhook bocor: hapus webhook di Discord (Edit Channel → Integrations → Webhooks), bikin baru, update secret-nya.
