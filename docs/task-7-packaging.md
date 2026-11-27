# Task 7 — kandidat distribusi OpenCode

**Hasil:** GOAT `0.1.0` dapat dipasang dari dua arsip npm tanpa checkout pengembangan. Target penerimaan adalah OpenCode **2.4.2**, Linux x86-64. Branch `dev/task-7-packaging`, baseline `d0cca31404dcad5f354402b259342cfb7904789d`. Belum ada publikasi, rilis, atau persetujuan lisensi.

## Mengapa `/goat` hilang di VSCodium?

Log yang relevan milik **server Flatpak**, bukan log terminal native: `~/.var/app/com.vscodium.codium/data/opencode/log/opencode.log`. Pada `2026-11-27T18:30:25.715Z`, run `b70decfc` merekam:

```text
ref=err_1df7753b
SyntaxError: Export named 'digest' not found in module '…/packages/core/src/index.ts'.
```

Host menemukan `@goat/core` melalui symlink npm workspace. Sebelum ekstraksi Task 6, entri itu memang tidak mengekspor `digest`. Baseline yang diterima mengekspornya melalui `snapshot.js`. Proses VSCodium yang sama telah memuat entri lama sebelum ekstraksi dan berulang kali melaporkan ekspor yang hilang. Host 2.4.2 baru, dengan HOME kosong, berhasil memanggil RPC `health` dari **checkout baseline yang sama**, bahkan sebelum perbaikan. Mengganti hanya entri adaptor dengan JavaScript juga mereproduksi kegagalan di proses lama: log masih menunjuk ke `core/src/index.ts`.

Penyebab yang terkonfirmasi adalah **resolusi ke modul workspace lama yang tertahan pada loader proses tersebut**. Tidak ada bukti paket hilang, masalah OAuth, atau verifikasi Task 6 gagal. Memperbarui pasangan modul sebagai satu instalasi paket menghilangkan ketergantungan pada symlink lama. Pada server Flatpak yang sama, sumber berubah menjadi `dist/node_modules/@goat/opencode`, status plugin `active`, fitur `server`, `tui`, `rpc`, dan `getConfig` melaporkan `enabled: false`. Tidak ada penghapusan cache, restart paksa, atau pengaktifan GOAT di sesi utama.

## Isi dan cara membangun

Pada Linux, gunakan Node ≥22.19 dan npm ≥10. Dari root:

```sh
npm ci                  # prepare juga membangun dan memasang pasangan lokal untuk pengembangan
npm run pack:candidate  # ulangi setelah mengubah source
```

| Arsip di `dist/` | Isi | SHA-256 kandidat yang diuji |
|---|---|---|
| `goat-core-0.1.0.tgz` | 36 berkas, 28.067 byte: manifest, README, 17 modul ESM dan 17 deklarasi tipe; tanpa dependensi paket | `e551681eeb943b01e5b838754d872667e59de5fd9fa7f1b54631379f5086f66b` |
| `goat-opencode-0.1.0.tgz` | 13 berkas, 32.083 byte: manifest, README, 9 modul ESM, `dist/check-python.py` dan `dist/apply-file.py` | `3957f1eaf2474a499d567ad7b152d62990449822c898cc4acec7d24389bda7a2` |

OpenCode mendukung entri TypeScript maupun JavaScript. Di sini `tsc` yang sudah ada menghasilkan ESM dengan impor `.js` yang nyata. Ekspor core menunjuk `dist/index.js`; ekspor adaptor `.`, `./tui`, dan `./rpc` menunjuk modul terpisah. Helper Python berada di samping modul yang membukanya melalui `import.meta.url`. Dependensi produksi adaptor hanya `@goat/core` dengan **versi persis sama**. API `@opencode/plugin` disediakan host dan dideklarasikan sebagai optional peer; versi SDK untuk pengembangan tetap dipatok di root. Tarball tidak berisi `node_modules`, TypeScript compiler, test runner, source checkout, atau fixture. Tidak ada bundler atau skrip instalasi konsumen.

Registry npm publik mengembalikan **HTTP 404** untuk metadata `@goat/core` dan `@goat/opencode` pada 28 November 2026. Ini berarti nama paket tidak terlihat sebagai paket publik saat diperiksa; bukan bukti bahwa scope `@goat` dapat dipakai Owner. Pastikan hak atas scope sebelum menyetujui nama. Tidak ada nama yang dipesan.

## Bukti instalasi dan regresi

- [`packaging.test.mjs`](../tests/milestone/packaging.test.mjs) menyajikan arsip melalui registry sementara di loopback. CLI `opencode plugin add`, `update` dan `remove` memakai HOME/config/data/cache/state sementara. Versi `0.0.0` dibuat khusus untuk membuktikan perpindahan ke arsip kandidat `0.1.0`; bukan versi rilis. Dua repositori Git terpisah menerima plugin global. Setelah dihapus secara global dan dipasang melalui entri project-local, hanya satu repositori memuatnya.
- Penyimpanan kosong mulai OFF. Pilihan model, Resink dan ON yang disimpan di A terlihat di B; update mempertahankannya. Setelah OFF dan uninstall, konfigurasi non-GOAT, entri plugin lain, provider, izin, MCP dan sentinel kredensial tetap utuh. Pemasangan kembali melihat pilihan lama dan OFF. Uji kontrol tidak mengirim permintaan model.
- Uji PTY terpisah menjalankan TUI 2.4.2 asli dengan kedua tarball terpasang offline, di luar monorepo. `/goat status` menampilkan `Enabled: false`; `/goat router` membuka pemilih Manager; `/goat mode` menampilkan Standard; `/goat on` dan `/goat off` menampilkan konfirmasi masing-masing.
- [Uji workspace](../tests/milestone/plugin.test.mjs) memasang dua tarball di prefix terpisah dalam HOME kosong; proses host tidak mewarisi `NODE_PATH` atau konfigurasi global asli. Pada satu prompt biasa, Manager menemukan file, Worker mengubah staging, Auditor memeriksa bukti. Penolakan `goat_apply` membiarkan checkout semula. Dengan izin yang sesuai, receipt `verified_applied`, `checksPassed: true`, `test_calc` lulus satu tes, `application.applied: ["src/calc.py"]`, dan **checkout** mengembalikan `42`. Kasus TS tanpa suite yang didukung dan edit pengguna yang bersamaan tidak ditimpa. Permintaan model hanya ke provider mock loopback.
- Dari salinan bersih, `npm ci` menghasilkan pasangan instalabel. Tiga perintah yang diminta dijalankan satu kali: `npm run check` lulus, `npm test` **89/89**, `npm run audit:milestone` **170/170**, tanpa skip. Setelah penajaman teks receipt, gerbang paket dan write-back serta kelima dialog diuji lagi secara terarah pada arsip di atas.

Seluruh operasi install/update/remove uji diarahkan ke konfigurasi sementara. Selama sesi ini timestamp konfigurasi global asli native dan Flatpak juga berubah (01:51:56 waktu lokal); penyebab penulisan itu tidak ditentukan. Pemeriksaan baca-saja tidak menemukan entri GOAT kandidat atau sentinel pengujian di sana. Tidak dilakukan pemulihan yang berisiko menimpa perubahan Owner.

## Satu uji live oleh Owner

Gunakan **terminal Linux native** dengan OpenCode 2.4.2 dan akun yang sudah terhubung saat uji Task 6. Gunakan database native yang **berbeda** dari sesi pengembangan VSCodium; `--standalone` sendiri hanya memisahkan proses. Pilihan router yang disimpan selama uji berlaku pada profil native tersebut. Jangan jalankan pekerjaan GOAT lain pada profil itu selama uji.

1. Dari root branch ini, jalankan perintah berikut. Jika menerima arsip di komputer lain, cukup bawa dua `.tgz` dan skrip uji, lalu sesuaikan path. Skrip tidak mengimpor kode repositori.

   ```sh
   sh tests/milestone/owner-packaged.sh \
     dist/goat-core-0.1.0.tgz dist/goat-opencode-0.1.0.tgz
   ```

   Skrip menyiapkan kalkulator baru, menyimpan hash tes di luar checkout, memasang **kedua arsip** dengan npm offline dan memuat direktori instalasinya melalui `plugins` pada konfigurasi **proyek sementara**. Ini jalur direktori paket native untuk kandidat yang belum dipublikasikan; `plugin add` berdasarkan nama sudah diuji terpisah via registry mock. Tidak perlu membuat fixture, menyalin token, mengubah konfigurasi global, atau menyiapkan kunci.
2. Di sesi tersebut pilih **Build** dan model OAuth yang sudah ada. `/goat status`; gunakan `/goat router` untuk Manager **inherit**, Worker yang mendukung tool, dan Auditor yang berbeda dari semua Worker. Pilih **Standard** di `/goat mode`, lalu `/goat on`.
3. Kirim **satu prompt**: **“Perbaiki kalkulator agar lulus pengujian yang ada. Jangan ubah tes.”** Tinjau izin native yang muncul. Target edit hanya `src/calc.py`; `test_calc.py` hanya-baca. Pilih **Once** untuk scope dan perubahan terverifikasi yang sesuai.
4. Buka hasil tool `goat_verify_text`: harapkan `reason: verified_applied`, `checksPassed: true`, satu tes lulus, Worker dan Auditor berbeda, `application.applied: ["src/calc.py"]`, serta `conflicts`, `uncertain`, `unapplied` kosong. Ringkasan Manager saja tidak cukup.
5. Jalankan `/goat off`, pastikan OFF dengan `/goat status`, lalu keluar. Skrip memeriksa hash (`test_calc.py: OK`) dan menampilkan implementasi aktual; pastikan hasilnya `42`. Direktori sementara yang dicetak tetap tersedia untuk diperiksa. Simpan receipt dan hasil shell sebagai bukti penerimaan.

## Lisensi dan batas rilis

Rekomendasi untuk **persetujuan Owner: MIT**. Lisensi ini mengizinkan penggunaan dan perubahan plugin dengan kewajiban mempertahankan pemberitahuan hak cipta dan lisensi. Rekomendasi ini belum diterapkan: tidak ada `LICENSE` proyek atau metadata yang menyatakan bahwa GOAT sudah berlisensi MIT.

Pemeriksaan manifest, lockfile dan daftar isi tarball: SDK OpenCode yang dipakai saat pengembangan berlisensi MIT dan tidak disalin ke tarball. Graf tool/SDK mencakup MIT, ISC, Apache-2.0, BSD, BlueOak-1.0.0, 0BSD, `json-schema` berlisensi ganda AFL/BSD, serta data SPDX (`spdx-exceptions`: CC-BY-3.0; `spdx-license-ids`: CC0). TypeScript dipakai untuk membangun; compiler tidak dikirim. Python sistem dan libseccomp dipakai di mesin host, tidak disertakan. Jika kelak mendistribusikan ulang dependensi, pertahankan lisensi, atribusi dan pemberitahuan yang berlaku, termasuk NOTICE Apache bila ada dan atribusi data CC-BY. Sebelum publikasi, Owner perlu mengonfirmasi hak atas sumber/helper dan scope npm, memilih lisensi, serta menyertakan teks lisensi yang disetujui di **kedua** paket.

Verifikasi workspace tetap terbatas pada profil Linux/Python yang dijelaskan di [README](../README.md#support-and-trust-boundaries). Tidak ada klaim dukungan semua bahasa, platform lain, atau penghematan biaya. [Arsitektur core/adaptor](task-6-portable-core.md) dan laporan milestone historis tetap menjadi rujukan. Uji provider live kandidat menunggu Owner; Task 8 belum dimulai.
