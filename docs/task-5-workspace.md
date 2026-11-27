# Task 5 — Standard pada host OpenCode aktif

Build menggunakan model sesi (atau Manager dari `/goat router`). OpenCode menangani pemanggilan model, autentikasi, dan transport untuk Manager maupun child. GOAT tidak memulai server kedua, membaca token OAuth, meneruskan header, atau meminta `baseURL` Chat Completions. Worker dan Auditor muncul sebagai child dari sesi Build asli. Profil privat bertanda tangan Task 3/4 tetap memiliki jalur masuk tersendiri.

### Dari prompt ke hasil

1. Pengguna mengirim prompt biasa di sesi Build induk. GOAT mengikat teks dan ID pesan asli. Manager dapat memakai `glob` dan `read` native untuk menemukan implementasi dan tes; tidak perlu menyebut nama berkas. Discovery dibatasi enam operasi, dengan batas byte untuk konten dan izin `goat_discover` serta aturan host untuk masing-masing tool.
2. Manager mengusulkan path relatif, operasi, dan tes. Default Standard adalah satu tugas. Untuk beberapa objektif yang benar-benar disebut pengguna, urutan sumber dipertahankan; tanpa alasan independensi dari instruksi pengguna, tugas berikutnya menunggu pendahulunya. GOAT memvalidasi graf dan menolak konflik baca/tulis. Maksimum empat **tugas**, tiga Worker aktif, tanpa batas numerik khusus untuk jumlah berkas. Snapshot teks dibatasi 16 KiB per berkas dan 256 KiB total.
3. Sebelum dispatch, GOAT memeriksa izin host untuk masukan, target edit/write dan suite, serta meminta `goat_workspace` untuk scope yang diusulkan. Periksa jadwal, tujuan model, path, dan hash awal di permintaan. Host dapat meminta jawaban baru atau memakai aturan yang sudah berlaku. Receipt tidak mengklaim persetujuan manusia baru. Manager dan Worker tidak dapat memperbesar scope yang telah diterima.
4. Worker mengubah snapshot melalui tool terbatas. Dispatcher Task 4 mengatur dependensi, anggaran request bersama, pembatalan, satu putaran rework dan eskalasi terbatas. Auditor independen hanya dapat membaca.
5. Setelah tes terlindungi dan Auditor lulus, `goat_apply` meminta izin native untuk path dan hash keluaran. GOAT membandingkan staging dengan bukti verifikasi, memeriksa ulang izin dan snapshot checkout, lalu menulis hanya target yang berubah. Penolakan host menghentikan penerapan. Tidak ada rollback yang dapat menimpa edit baru pengguna.

**Membaca receipt:** `checksPassed` melaporkan verifikasi staging. Untuk hasil checkout, lihat `application.status`. `written` mencatat penulisan yang dikonfirmasi, `applied` berisi path yang dikonfirmasi dan tidak terdeteksi berubah kembali, `conflicts` berisi input yang berubah atau sedang dipakai, dan `unapplied` berisi perubahan yang belum diterapkan atau tidak lagi cocok. Jika penulisan terputus dan hasilnya tidak diketahui, periksa `uncertain` serta `detail` sebelum mencoba lagi. `createdDirectories` mencatat direktori baru yang dilaporkan saat menulis.

**Batas penerapan:** operasi multi-berkas bukan transaksi atomik. Di Linux, GOAT memakai *write lease* dan membandingkan byte sebelum mengubah berkas lama; berkas baru dipublikasikan hanya jika nama target masih kosong. Jika filesystem tidak mendukung operasi tersebut, GOAT berhenti. Pembatalan menghentikan berkas berikutnya; penulisan satu berkas yang sudah berjalan bisa selesai. Pemeriksaan akhir menggambarkan keadaan pada saat diperiksa, bukan jaminan terhadap perubahan sesudahnya.

**Verifikasi:** suite yang saat ini dapat dijalankan secara terlindungi adalah Python `unittest` di Linux dengan `/usr/bin/python3`, Landlock dan seccomp. JS/TS atau teks lain tetap dapat dikerjakan. Tanpa suite yang didukung, receipt menampilkan `verification: unsupported` dan checkout tidak ditulis. Tool discovery native `glob` memerlukan ripgrep pada instalasi OpenCode.

## Uji live oleh Owner

Di workspace kalkulator yang sudah dipakai Owner, mulai dari `src/calc.py` yang masih mengembalikan `0` dan tes asli yang mengharapkan `42`. Jangan reset berkas. Dari root workspace tersebut, simpan hash tes di luar checkout dan jalankan OpenCode dengan versi plugin ini:

```sh
cat src/calc.py
test_hash=$(mktemp)
sha256sum test_calc.py > "$test_hash"
opencode
```

1. Pilih **Build** dan model OpenAI yang sudah terautentikasi. Atur tier Worker dan Auditor yang berbeda dari Worker melalui `/goat router`. Pilih Standard melalui `/goat mode`, lalu `/goat on` di sesi uji.
2. Kirim satu prompt: **“Perbaiki nilai jawaban kalkulator agar sesuai dengan pengujian yang sudah ada. Jangan ubah pengujiannya.”**
3. Tinjau permintaan izin native jika muncul. Untuk contoh ini target edit seharusnya `src/calc.py`, dan `test_calc.py` menjadi suite terlindungi. Gunakan **Once** untuk izin sekali pakai.
4. Periksa receipt `goat_verify_text`: `reason: verified_applied`, `checksPassed: true`, satu tes lulus, `application.applied: ["src/calc.py"]`, serta `conflicts`, `uncertain` dan `unapplied` kosong. Akhiri dengan `/goat off` dan keluar dari OpenCode.
5. Di shell yang sama, periksa **checkout**: `cat src/calc.py` harus menunjukkan `return 42`, `sha256sum -c "$test_hash"` harus menampilkan `test_calc.py: OK`, dan `python3 -B -m unittest test_calc` harus lulus.

Uji otomatis memakai host OpenCode nyata dengan provider mock lokal. Uji live Owner di atas yang mengonfirmasi jalur OAuth akun sebenarnya.
