# Task 3 — Kompatibilitas OpenCode untuk uji coding Owner

**Rekomendasi: gunakan 2.4.2 untuk uji live pertama.** Versi Owner saat ini, 2.4.1, juga lulus; hasilnya setara dengan baseline 2.3.2. Bukti ini berlaku untuk profil Linux satu file dengan provider HTTP mock. Belum ada panggilan ke model live.

| Binary host Linux x64 | `audit:milestone` (lulus / gagal / skip) | Coding: kasus hijau setelah satu rework | Launcher → TUI nyata → keluar |
|---|---:|---:|---|
| 2.3.2 (baseline) | 120 / 0 / 10 | 4/4 | Lulus, 0 request model |
| 2.4.1 | 120 / 0 / 10 | 4/4 | Lulus, 0 request model |
| 2.4.2 | 120 / 0 / 10 | 4/4 | Lulus, 0 request model |

`npm run check` lulus dengan SDK repo yang tetap dipatok ke 2.3.2. `npm test` lulus 72/72; unit test ini tidak bergantung pada binary dan juga menjadi bagian dari setiap run milestone. Sepuluh skip sama dengan baseline.

**Bukti per versi:**

- Harness yang sama memuat plugin di server privat, memanggil RPC, memeriksa assignment model dan mengirim prompt Build biasa. Saat GOAT OFF, prompt tetap mengikuti jalur biasa. Sesi development utama tetap OFF.
- Pada profil coding, mock menerima 17 request: 1 saat Manager melewatkan tool, 6 saat Auditor memberi PASS untuk kode yang gagal mengakses file host, dan 10 saat satu rework berhasil. Hanya skenario terakhir menghasilkan `completed`; isi file dan SHA-256 diverifikasi. Worker hanya mendapat tool file tugas, Auditor terpisah tanpa tool.
- Launcher `tests/milestone/owner-live.mjs` dijalankan di terminal semu dengan binary asli dan endpoint mock. `/goat status` menunjukkan OFF dan Standard; `/goat router` menyimpan Manager warisan, tiga tier Worker dan Auditor; `/goat mode resink` dan `/goat on` terbaca kembali lewat status; `/goat off` mengembalikan OFF. Ketiga launcher keluar dengan kode 0. Uji launcher menguji kontrol TUI tanpa mengirim prompt berbayar; uji coding di atas menggunakan harness percakapan.

**Defek dan perbaikan:** harness dan launcher sebelumnya menolak binary selain 2.3.2. Keduanya sekarang menerima tiga versi persis; harness tetap meminta versi aktual cocok dengan versi yang ditargetkan dan default ke 2.3.2. Selain itu, server dapat menerima RPC sebelum inventaris model siap. Pada 2.4.x, probe stateless `experimental/generate/text` mendapat `404 Model not found: fixture/mock` meskipun model tersedia di proyek. Fixture kini menunggu inventaris proyek siap dan, untuk probe stateless, menyediakan serta memeriksa inventaris mock di lokasi dasar server **privat**. Assertion lama tetap berlaku: satu request, tanpa tool, tanpa sesi baru.

**SDK:** perbandingan deklarasi paket menunjukkan 2.4.1 memperluas tipe tool untuk Code Mode, menambah varian `video` pada request sesi, serta menambah akses job pada konteks TUI. Antara 2.4.1 dan 2.4.2 tidak ada perubahan deklarasi pada API server/TUI yang dipakai GOAT. Tidak diperlukan cabang versi pada plugin atau perubahan pada izin, routing, dan kontrak Auditor.

Untuk mereproduksi satu baris matriks dari root repo, gunakan Node 22.19+ dan binary terisolasi yang sesuai, misalnya:

```sh
GOAT_TEST_VERSION=2.4.2 \
OPENCODE_BIN=/tmp/opencode/goat-host-242/node_modules/@opencode/cli-linux-x64/bin/opencode \
npm run audit:milestone
```

Untuk uji pertama dengan kuota Owner, ikuti [langkah launcher, konfigurasi provider, instruksi `slugify`, dan cara memeriksa receipt](task-3-live-coding.md#cara-menjalankan).
