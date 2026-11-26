# Task 3: bukti satu alur sintetis

**Ruang lingkup:** `tests/milestone/synthetic.test.mjs` menjalankan `decideTask` dari `@goat/core` dan dua peran pada host OpenCode privat 2.3.2. Transport, sesi dan pesan OpenCode nyata; kedua model adalah respons deterministik dari provider mock lokal. `host-fixture.mjs` menyediakan model Auditor kedua dan mencatat setiap request ketika tiba. `native.test.mjs` melaporkan total kontrol host secara terpisah. Tidak ada perubahan pada dispatcher atau konfigurasi plugin produksi.

## Satu keberhasilan yang teramati

Untuk `Convert the word apricot to uppercase.`, Manager Standard menghasilkan `planned` / `ready`, `task-1`, tier **L1**, model **`fixture/mock`**. Manager dipanggil sekali per skenario, termasuk ketika ada rework. Harness memakai `RoutingDecision.model`, `WorkerPrompt.text`, dan `VerificationRequirements` dari keputusan tersebut. Ia hanya menerima satu kriteria sintetis yang memang dapat diperiksa secara deterministik.

| Peran | Sesi pada contoh run | Bukti dari konteks native |
|---|---|---|
| Worker | `ses_df2ad8ab3ffeH7l5jq7lp92EWT` | Model `fixture/mock`, teks `APRICOT`. |
| Auditor | `ses_df2ad8a52ffeNHSTsLc9728jQp` | Model `fixture/auditor`, `taskId: task-1`, `attempt: 1`, kriteria asli, `outcome: PASS`, `quote: APRICOT`. |

Worker dan Auditor menerima model dan izin `deny-all` saat `session.create`, memakai `prompt` lalu `wait`, dan merupakan sesi root bernama dengan ID berbeda. Tidak ada sesi Manager yang dibangunkan oleh `parentID`. Auditor menerima instruksi asli, kriteria dan teks Worker sebagai data JSON tidak tepercaya. Respons normal mock Auditor dihitung dari paket yang diterima. Pemeriksa di harness mencocokkan tugas, percobaan, kriteria, kutipan persis, serta jawaban deterministik; bahkan `PASS` Auditor tidak cukup bila jawabannya salah.

Urutan positif: `queued → classifying → delegated → auditing → completed`. Pemeriksaan mencocokkan prompt dengan request di provider, model respons, jumlah sesi dan request, aturan izin dan hasil sesi. Tidak ada tool yang ditawarkan/dijalankan dalam alur sintetis. Inbox kosong; tidak ada pesan sintetis dari anak sesi. Sesudah terminal, daftar sesi dan penghitung request tidak berubah selama jendela observasi 100 ms. Ini bukan jaminan proses atau billing di provider eksternal.

## Semua cabang dan biaya request

| Skenario | Hasil yang diuji | Request |
|---|---|---:|
| OFF; `needs_review`; Worker tidak tersedia; Auditor tidak tersedia (4 skenario) | Berhenti sebelum sesi pertama. | 0 |
| Bukti dan verdict valid | `completed` | 2 |
| Worker mengaku `PASS` dan menyuruh Auditor mengabaikan verifikasi | Auditor mengutip keluaran tersebut dan memberi `FAIL`; terminal `failed`. | 2 |
| Auditor memberi `PASS` untuk keluaran yang keliru | Pemeriksa bukti menolak: `insufficient-evidence`. | 2 |
| JSON cacat; verdict `MAYBE`; kutipan tidak cocok (3 skenario) | Masing-masing `failed: invalid-verdict`, meskipun Worker benar. | 6 |
| Rework berhasil | Bukti pertama ditolak, Worker memperbaiki menjadi `APRICOT`, audit kedua lulus. Sesi tiap peran dipakai kembali. | 4 |
| Dua audit menolak | Terminal `failed` setelah satu rework, meskipun anggaran masih tersisa. | 4 |
| Sisa anggaran hanya satu request | Tidak memulai rework yang hasilnya tidak akan bisa diaudit. | 2 |
| Deadline Worker saat stream masih aktif | `interrupt` mengembalikan `true`, `wait` berakhir, koneksi mock ditutup dan hasil sesi `interrupted`; terminal `cancelled`, tanpa sesi Auditor. | 1 |
| **Total 14 skenario sintetis** | **12 request Worker, 11 Auditor, 0 model Manager** | **23** |

Penghitung berasal dari batas HTTP mock, bukan dari perkalian jumlah sesi dengan langkah. Dalam satu run `audit:milestone`, suite kontrol native lama memakai **12 request tambahan** pada server mock terpisah, termasuk request tambahan host dari sesi tanpa judul: **35 request lokal** keseluruhan.

## Verifikasi dan batas

Node 22.23.5 dan host yang dipatok di atas: `npm run check` lulus, `npm test` **72/72**, `npm run audit:milestone` **105 lulus / 0 gagal / 14 skip** (sebelumnya 90/0/14). Reproduksi dengan perintah dan `OPENCODE_BIN` pada [baseline](../../docs/manager-and-host-reaudit.md); baris diagnostik menampilkan ID sesi, hasil tiap giliran, transisi, dan jumlah request pada run tersebut.

**Audit independen: PASS untuk milestone sintetis.** Reviewer terpisah memeriksa implementasi dan TAP, lalu menjalankan ulang tes sintetis pada host 2.3.2: 14/14 skenario lulus, 23 request. Tidak ada temuan yang memblokir milestone ini.

Semua skip baseline dipertahankan. T1–T4 menyangkut dispatcher plugin, otoritas dan routing saat dispatch; T9–T10 anggaran pipeline dan trace terlindungi; T11–T14 integrasi Auditor, verdict, rework, dan batas kedalaman pada GOAT; T15–T17 mutasi izin, saved approval dan worktree; T20 alur lengkap plugin. Alur di atas menguji sebagian kontrak itu **di harness**, bukan menyediakan fitur runtime tersebut.

Sebelum produksi masih diperlukan otoritas di batas eksekusi, pembatasan izin dan akses file yang tahan perubahan, trace terlindungi, dan kontrol sumber daya yang tidak bergantung pada provider mock. Sesi Auditor terpisah membuktikan pemisahan konteks dan pemetaan model, bukan identitas teratestasi atau mutu penalaran model nyata.
