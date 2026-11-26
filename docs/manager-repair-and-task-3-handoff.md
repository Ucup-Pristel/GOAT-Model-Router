# Perbaikan Manager dan batas milestone Task 3

Baseline: [audit ulang pada `1b69bce`](manager-and-host-reaudit.md). Laporan itu dan verdict historisnya tetap berlaku untuk revisi yang diuji saat itu.

## Hasil perbaikan

- **B1:** analisis risiko tugas hanya melihat objektif hasil perencanaan. Pemindaian instruksi asli sekarang melaporkan sinyal risiko sendiri (`high-risk-instruction`, `severity: review`, bukti klausa, tanpa `taskId`). Temuan masuk ke alasan review dan konteks prompt melalui jalur yang sudah dipakai Standard maupun Resink. Tier, objektif tugas dan `OriginalIntent` tidak ditulis ulang.
- **B2:** verba seperti *add*, *implement* atau *write* sebelumnya langsung dianggap pekerjaan perencanaan. Pemindaian kini membedakan objek yang diubah: mengubah *the release* memerlukan review, sedangkan menulis *release notes* atau *notes for the release* adalah pekerjaan dokumentasi. Klasifikasi bahasa alami tetap heuristik, bukan izin eksekusi.
- **Verifikasi akhir**, Node 22.23.5 dan host privat OpenCode 2.3.2: `npm run check` lulus; `npm test` 72/72 (71 tes lama + satu regresi audit); `npm run audit:milestone` dari 83 lulus / 6 gagal / 14 skip menjadi 90 lulus / 0 gagal / 14 skip. Delapan probe native termasuk dalam angka tersebut. Harness, klasifikasi skip, dan proses dispatch tidak diubah.

Audit independen awal atas patch mendeteksi empat regresi di luar contoh baseline meskipun harness sudah hijau: *cut the release following the approved checklist*, *create a release containing the updated documentation*, *fix the typo in the release notes*, dan *read the production deployment guide*. Satu koreksi memisahkan objek verba dari keterangan dan membedakan *release notes* dari *release containing ... documentation*. Keempat reproduksi tercakup dalam satu tes penerimaan tambahan di `packages/core/test/manager.test.ts`.

**Verdict akhir Auditor independen: PASS untuk B1/B2 saja.** Seluruh 16 replay (empat instruksi × tiga bentuk penyamaran + tanpa penyamaran) kembali sesuai perilaku sebelum regresi. B1 21/21 dan B2 24/24 menghasilkan temuan spesifik pada instruksi asli dengan bukti, alasan review dan advisory di prompt, termasuk ketika diuji ulang dengan tier L1 eksplisit dan reasoner berisiko rendah. Seluruh 24 kontrol jinak Auditor serta pemeriksaan imutabilitas intent lulus. Utang lama: tanpa penyamaran, contoh membaca panduan deployment masih dapat ditandai `high-risk-task` oleh heuristik objektif tugas. PASS ini bukan penerimaan Task 3 atau pernyataan siap produksi.

## Milestone minimum berikutnya: satu tugas sintetis sampai verdict

1. **Di harness saja**, panggil `decideTask` satu kali. Saat OFF, model hilang, atau `needs_review`, akhiri sebelum membuat sesi. Pada kasus positif ambil model dari `RoutingDecision`, teks dari `WorkerPrompt`, dan kriteria dari `VerificationRequirements`; jangan hitung ulang tier atau membuat planner kedua.
2. Jalankan satu Worker bernama dengan `session.create` / `prompt` / `wait` ke provider mock lokal yang sudah ada. Untuk tugas teks sintetis tetapkan izin **deny-all** saat pembuatan sesi. Ambil respons dari konteks sesi. Gunakan sesi terpisah dari sesi aktif pengguna; jangan membangunkan Manager model secara implisit lewat `parentID`.
3. Jalankan Auditor pada sesi baru dengan model Auditor yang dikonfigurasi, tanpa tool atau hak tulis. Berikan instruksi asli, kriteria dan hasil Worker sebagai data. Fixture positif harus memenuhi kriteria deterministik **dan** mendapat verdict Auditor yang valid. Fixture negatif sengaja menghasilkan bukti yang tidak memenuhi kriteria: `PASS` dari Worker, verdict yang tidak valid, atau `PASS` Auditor tanpa bukti tidak boleh menyelesaikan tugas.
4. Uji satu rework dan satu audit ulang bila pemeriksaan gagal dan anggaran masih tersedia. Setelah batas tercapai, akhiri gagal. Hitung semua permintaan di sisi mock, termasuk permintaan tambahan host; awasi waktu dengan `interrupt` lalu `wait`. Periksa jumlah sesi, permintaan, dan ketiadaan tool setelah terminal. Ini membuktikan alur pada fixture, **bukan** batas biaya atau pembatalan provider produksi.

Lokasi perubahan yang diusulkan: perluasan terarah atas fixture dan tes integrasi di `tests/milestone/`, menggunakan `@goat/core` dan host yang sudah dipakai. Tidak diperlukan engine lain, RPC dispatch publik, perubahan lima perintah `/goat`, atau mekanisme otorisasi baru. Persetujuan untuk memperbaiki Manager bukan bukti otorisasi saat runtime. Dispatch dengan tool nyata tetap diblokir.

## Skenario yang masih di-skip

| ID | Fungsi GOAT yang belum bisa diuji end-to-end |
|---|---|
| T1–T4 | Dispatcher yang berhenti saat OFF; penolakan tanpa otoritas beserta jejaknya; penolakan approval palsu; pemilihan model tier saat benar-benar membuat Worker. |
| T9–T10 | Penghentian pipeline setelah anggaran terlampaui; jejak eksekusi yang terlindungi. |
| T11–T14 | Auditor read-only yang terintegrasi; validasi bukti/verdict; koordinator rework terbatas; penegakan kedalaman oleh dispatcher. |
| T15–T17 | Deteksi perubahan izin saat run; pemeriksaan otoritas meski ada saved `allow`; pembatasan akses Worker ke worktree tugas. |
| T20 | Alur Worker → Auditor → hasil terminal dengan pemeriksaan independen. |

Probe native yang lulus untuk sebagian mekanisme tersebut tidak menggantikan tes integrasi GOAT. Jangan menghapus skip sampai perilaku pada ID terkait benar-benar diimplementasikan dan diverifikasi.
