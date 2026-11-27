# Task 4 — profil proyek paralel

Profil ini menambah jadwal **yang ditandatangani Owner** pada launcher proyek Task 3. Standard menjalankan objektif persis seperti plan. `dependsOn: []` adalah pernyataan Owner bahwa tugas tidak memerlukan hasil tugas lain. `dependsOn: ["task-1"]` mengacu pada nomor tugas (mulai dari satu) di array `tasks`. Tanpa `--schedule`, `--step` tetap berurutan. Resink hanya dapat menggunakan scope yang dijadwalkan jika hasil perencanaannya cocok satu per satu; ketidakcocokan tidak memperluas grant.

Contoh lengkap: [`schedule.json`](../tests/milestone/parallel-project/schedule.json). `read` dan `write` adalah subset path grant; `criteria` masuk ke prompt Worker dan audit. `suites` mengikat temuan rework ke suite terlindungi, **tidak** memberi Worker izin membaca tes. `tier` opsional; model diambil dari konfigurasi `/goat router`. Di tingkat atas, `concurrency` opsional (1–4, default 3) dan `maxRequests` opsional (1–48, default 48) ikut ditandatangani. Profil terbatas ini menerima sampai empat objektif coding dengan setidaknya satu perubahan per tugas pada putaran awal.

Setiap child bekerja pada salinan dalam memori dari file yang ditugaskan. Setelah transcript, model dan operasi broker valid, host mengintegrasikan perubahan sebelum melepas penerus. Satu path hanya boleh punya satu penulis; pembaca path milik Worker lain harus bergantung pada penulisnya. State gabungan dimaterialisasi dalam urutan path manifest ke direktori privat untuk menjalankan suite Python Task 3. Hasil tidak disalin otomatis ke checkout. Satu putaran rework dapat memperbaiki beberapa tugas, termasuk memeriksa ulang penerus yang inputnya berubah. PASS membutuhkan hasil gabungan dan verdict Auditor independen.

## Uji live sekali oleh Owner

1. Gunakan Linux, Node ≥22.19, OpenCode 2.4.2, provider privat dan kunci persetujuan Task 3. Jalankan dari root repo. Jika kunci belum tersedia, buat dengan [langkah 1 Task 3](task-3-project.md#jalankan-sekali-dengan-akun-openai-yang-sudah-berhasil). Pastikan `GOAT_OWNER_SIGNING_KEY`, `GOAT_OWNER_VERIFY_KEY` dan variabel kredensial yang dirujuk konfigurasi provider sudah diekspor.

   ```sh
   export OPENCODE_BIN="$(command -v opencode)"
   "$OPENCODE_BIN" --version   # opencode v2.4.2
   cat tests/milestone/parallel-project/{schedule.json,test_palette.py}
   node tests/milestone/owner-live.mjs "$HOME/goat-provider.private.json" \
     --project tests/milestone/parallel-project \
     --schedule tests/milestone/parallel-project/schedule.json \
     --edit red.py --edit green.py --edit blue.py --edit palette.py \
     --test test_palette.py \
     --instruction 'Implement the three independent color channels and combine them in rgb().'
   ```

2. **Hanya di TUI privat launcher**: pilih Build dan model Manager yang telah dikonfigurasi. Pada `/goat router`, pilih *Inherit current session model* atau Manager eksplisit; pilih model aktual untuk L1/L2/L3 dan model Auditor berbeda dari semua model Worker. Gunakan model yang telah lulus uji Task 3. Jalankan `/goat mode standard`, `/goat status`, `/goat on`. Kirim persis:

   ```text
   Implement the three independent color channels and combine them in rgb().
   ```

3. Periksa child native dan `/goat status`. Tiga Worker pertama membuat kanal tanpa saling membaca; Worker keempat mendapat ketiga keluaran untuk membuat `palette.py`. Buka receipt native `goat_verify_text`: wajib `status: completed`, `reason: accepted`, `checksPassed: true`, `test_palette` **4 tes lulus**, dan empat file berubah. `workers` mengaitkan task, attempt, tier, model, session ID, input dan hash perubahan.

4. Dari terminal di root repo, ganti ketiga nilai di bawah dengan **`trace.path`, `trace.head`, dan `file` dari receipt**:

   ```sh
   node tests/milestone/verify-parallel-live.mjs 'TRACE_PATH' 'TRACE_HEAD' 'RESULT_DIR'
   ```

   Pemeriksa membaca trace sampai anchor receipt, menghitung ulang hash chain dan file hasil, membandingkan tes terlindungi, memeriksa urutan integrasi dan menghitung request Worker yang saling tumpang tindih antara hook HTTP keluar dan respons masuk. `peakWorkerHttp >= 2` membuktikan overlap yang teramati dalam run live ini; `3` menunjukkan ketiga Worker. Jika provider menjawab terlalu cepat sehingga tidak ada overlap teramati, bukti paralelisme live **belum lulus**, meskipun tes Python lulus. Akhiri dengan `/goat off` di TUI privat, lalu keluar. Grant hanya untuk satu run.

## Reproduksi lokal

`npm run check`, `npm test`, lalu `npm run audit:milestone` (default host 2.4.2). Untuk 2.4.1 atau 2.3.2, set `OPENCODE_BIN` ke binary yang tepat dan `GOAT_TEST_VERSION` ke versi tersebut. Benchmark `Task 4 project: sequential` dan `parallel` menjalankan workload yang sama dengan limit 1 dan 3. Log TAP mencetak interval dan puncak request di server mock, jumlah request, rework dan verdict. Ini bukan estimasi latensi atau penghematan biaya provider nyata. Penghitungan token teramati, batas langkah, dan pembatalan lokal bukan plafon tagihan.

| Skenario penerimaan | Bukti otomatis |
|---|---|
| 1–4: tier, batas pool, dependensi | `parallel`, `mixed`, `rolling`: barrier di server provider, interval request dan identitas sesi. Pada `rolling`, request keempat harus tiba sebelum dua request yang tidak dibutuhkannya dilepas. |
| 5–7: urutan, DAG, konflik | Plan `--step` Task 3 tetap serial. `cycle`, `reference`, `write/write` (dua pembuat file yang sama), `read/write` ditolak sebelum request pertama. |
| 8–11: anggaran dan otoritas | `budget` membatasi tiga Worker menjadi tepat tiga request; `unauthorized` menolak pembacaan file Worker lain tanpa melepas penerus. Skenario child native Task 3 menguji rekursi, model, mutasi izin dan akses Auditor. |
| 12–14: verifikasi dan rework | `conversation`, `invalid verdict`, `rework`, `transitive`: empat file dan empat tes gabungan, penolakan verdict cacat, eskalasi dan revalidasi transitif tanpa mengulang cabang independen. |
| 15–17: lifecycle dan regresi | `off` membatalkan saat tiga request tertahan; `sequential` membatasi puncak ke satu; milestone menjalankan suite Task 3 yang sama. |

Audit independen Task 4 menghasilkan satu putaran koreksi. Penerus transitif sekarang selalu divalidasi ulang pada cabang rework. Penulisan integrasi memeriksa signal dan masa berlaku sebelum memulai tiap operasi. Kegagalan Worker menginterupsi dan menunggu Worker saudara; kegagalan cleanup mempertahankan karantina. Prompt Resink dan scheduler menggunakan dependensi bertanda tangan yang sama. Pemeriksaan pascakoreksi mencakup kasus intermediate Worker dengan hasil tidak berubah, pembatalan saat validasi disk, serta dua Worker yang mengalami pembatalan dan kegagalan cleanup secara bersamaan.

**Pengukuran lokal pascakoreksi, OpenCode 2.4.2** (elapsed dispatch sampai receipt, tidak termasuk startup host):

| Workload | Elapsed | Puncak Worker di provider | Request Worker / Auditor | Putaran rework | Integrasi / verdict |
|---|---:|---:|---:|---:|---|
| RGB, limit 1 | 1.053 ms | 1 | 8 / 1 | 0 | 4 tes lulus / accepted |
| RGB, limit 3 | 613 ms | 3 | 8 / 1 | 0 | 4 tes lulus / accepted |
| RGB, tier campuran | 615 ms | 3 | 8 / 1 | 0 | 4 tes lulus / accepted |
| RGB, cacat kanal pertama | 1.155 ms | 3 | 12 / 2 | 1 | 4 tes lulus / accepted |

Pada limit 3, tiga interval request pertama relatif ke dispatch adalah `[149,304]`, `[172,304]`, `[184,305]` ms. Provider baru membuka barrier setelah ketiganya tiba. Untuk limit 1: `[230,351]`, `[494,615]`, `[712,833]` ms. Pengukuran ini berasal dari satu run mock; angka elapsed akan bervariasi.

Pada host utama 2.4.2, `npm run check` lulus, `npm test` **75/75**, dan `npm run audit:milestone` **151/151** (0 gagal, 0 skip). Cakupan awal ketiga versi sudah lulus **147/147** sebelum koreksi audit. Setelah koreksi, seluruh `plugin.test.mjs` juga lulus **43/43** pada masing-masing host 2.4.1 dan 2.3.2 (0 gagal, 0 skip). Uji live model aktual disediakan untuk Owner dan belum dijalankan sebagai bagian dari verifikasi otomatis.
