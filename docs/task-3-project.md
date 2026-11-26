# Task 3 — Uji akhir Owner: satu proyek, beberapa file

**Profil ini berjalan pada Linux dengan snapshot terotorisasi dan suite `unittest` milik Owner.** Host utama tetap OFF. Uji live OpenAI pada `c19ce45` membuktikan profil satu file. Bukti multi-file di bawah menggunakan binary OpenCode nyata dan model mock lokal.

## Jalankan sekali dengan akun OpenAI yang sudah berhasil

Gunakan terminal lokal, Node ≥22.19, `/usr/bin/python3`, `libseccomp.so.2`, OpenSSL dan OpenCode 2.4.2. Proses penguji memerlukan Linux x86-64 atau arm64 dengan Landlock ABI ≥3, seccomp filter dan `/proc/self/fd`. Linux x86-64 telah diuji. Launcher keluar bila probe kernel gagal. Gunakan konfigurasi provider dan variabel kredensial **yang sama dengan uji satu file**; tidak perlu gateway atau login baru.

1. Dari root repo, pastikan binary dan buat pasangan kunci Ed25519 privat di luar repo. Blok ini membuat direktori baru setiap kali; tidak menimpa kunci yang ada. Kunci ini untuk persetujuan tugas lokal, bukan kredensial OpenAI.

   ```sh
   export OPENCODE_BIN=/tmp/opencode/goat-host-242/node_modules/@opencode/cli-linux-x64/bin/opencode
   "$OPENCODE_BIN" --version       # opencode v2.4.2; sesuaikan path pada mesin lain
   umask 077
   KEYDIR=$(mktemp -d "$HOME/goat-approval.XXXXXX")
   export GOAT_OWNER_SIGNING_KEY="$KEYDIR/owner.pem"
   export GOAT_OWNER_VERIFY_KEY="$KEYDIR/owner.pub"
   openssl genpkey -algorithm ED25519 -out "$GOAT_OWNER_SIGNING_KEY"
   openssl pkey -in "$GOAT_OWNER_SIGNING_KEY" -pubout -out "$GOAT_OWNER_VERIFY_KEY"
   ```

2. Tinjau [`labels.py`](../tests/milestone/example-project/labels.py) dan [`test_labels.py`](../tests/milestone/example-project/test_labels.py). Jalankan launcher berikut **saat siap memakai kuota OpenAI**. Jika nama file konfigurasi provider berbeda, sesuaikan argumen pertama.

   ```sh
   node tests/milestone/owner-live.mjs "$HOME/goat-provider.private.json" \
     --project tests/milestone/example-project \
     --edit labels.py --edit normalize.py --test test_labels.py \
     --step 'Create a whitespace normalization helper in normalize.py.' \
     --step 'Use the helper from labels.py to produce the label.' \
     --instruction 'Normalize label whitespace with a shared helper and use it when producing labels.'
   ```

   Perintah ini menyetujui satu percobaan orkestrasi termasuk paling banyak satu rework. `labels.py` dapat diubah, `normalize.py` dapat dibuat, `test_labels.py` hanya dapat dibaca. `--read` dapat diulang untuk sumber tambahan. Hanya file yang dipilih yang disalin. Kunci penandatangan tidak diteruskan ke proses OpenCode; launcher memasok kunci publik untuk memeriksa tanda tangan pada saat dispatch.

3. Di **TUI privat**, pilih **Build**, model sesi OpenAI `gpt-6.1-sol`. Di `/goat router`: pilih **Inherit current session model**; pasang `gpt-5.6-terra` untuk L1/L2/L3; pasang `gpt-6-luna` sebagai Auditor. Jalankan `/goat mode standard`, periksa `/goat status`, lalu `/goat on`. Kirim persis:

   ```text
   Normalize label whitespace with a shared helper and use it when producing labels.
   ```

4. Buka hasil tool `goat_verify_text` pada percakapan asal. Kriteria penerimaan contoh: `status: "completed"`, `checksPassed: true`, `suites` menunjukkan `test_labels`, **2 tes lulus**, dan `files` memuat **kedua file**. Pada profil proyek, `file` adalah **direktori** snapshot; `sha256` tingkat atas mengikat kumpulan perubahan. Verifikasi hash *per file* dan tinjau sumber:

   ```sh
   RESULT='/ganti/dengan/direktori/dari/receipt'
   sha256sum "$RESULT/labels.py" "$RESULT/normalize.py"
   diff -u tests/milestone/example-project/labels.py "$RESULT/labels.py"
   cat "$RESULT/normalize.py"
   ```

   `diff` mengembalikan kode 1 bila ada perubahan. Pastikan `labels.py` benar-benar memakai helper. Jika Manager tidak memanggil tool atau tidak ada receipt sukses, lihat `/goat status`; jangan menerima prosa sebagai pengganti bukti. Selesai: `/goat off`, keluar TUI. Hasil tetap di direktori privat untuk pemeriksaan; checkout asal tidak diubah. Untuk percobaan baru, mulai launcher baru dan setujui snapshot baru.

## Kontrak dan batas

| Aspek | Yang dijalankan |
|---|---|
| Otorisasi | Tanda tangan Ed25519 mengikat instruksi, sumber awal, role/path, langkah Owner, lokasi host privat dan waktu kedaluwarsa (1 jam). Penanda eksklusif di luar workspace mencegah penggunaan ulang grant. `/goat on`, persetujuan OpenCode `always`, dan teks dari model tidak memberi otorisasi itu. Identitas Owner berasal dari kunci yang dipilih operator tepercaya di launcher, bukan dari akun OpenCode. |
| Manager | Standard mempertahankan langkah yang diberikan. Resink dapat menerima dekomposisi model Manager; tanpa langkah dari model, planner yang ada tetap berlaku. Maksimum 4 tugas berurutan, dengan satu OriginalIntent. Worker dan Auditor proyek menggunakan `session.create(parentID)` native; profil satu file tetap memakai sesi root. |
| Worker & Auditor | Satu Worker aktif. Izin sesi dipersempit ke broker file; schema dan pemeriksaan eksekusi membatasi akses. Auditor memiliki model berbeda dan hanya dapat membaca file dalam grant. Rework dibatasi satu tugas yang gagal, dengan bukti hash dan kegagalan suite yang terulang; tier dapat dinaikkan satu tingkat ke model yang tersedia tanpa tambahan izin. |
| Pemeriksaan | Satu proses Python baru per suite; baseline, sumber sebelum/sesudah, hash, hasil dan temuan risiko diteruskan ke Auditor. Kategori: cacat dalam scope, regresi, utang lama, penghalang rilis. Temuan tanpa bukti reproduksi tidak memicu rework. File uji terlindungi. Suite kosong/dilewati atau kegagalan proses tidak menghasilkan PASS. |
| Isolasi | Broker mengakses snapshot baru, terpisah dari host privat yang memuat kredensial provider. Python berjalan tanpa environment/kredensial dan descriptor tambahan. Landlock mengizinkan pembacaan snapshot dan pustaka sistem Python, seccomp membatasi syscall, tanpa izin menulis workspace, membuat koneksi, membuat proses atau menjalankan program lain. CPU, ruang alamat, waktu dan output proses dibatasi. Tidak ada instalasi paket atau shell umum. |
| Anggaran | Maksimum 20 path (16 KiB per file; payload otorisasi juga dibatasi), 48 request HTTP Worker/Auditor bersama, 2 request utama Manager, deadline dispatch 5 menit. Penggunaan token role diperiksa di batas request/tool dan sesudah giliran; stop bila *teramati* melebihi 128.000. Bukan batas tagihan atau jaminan pembatalan di sisi provider. |
| Bukti | Trace JSONL di luar workspace, berantai SHA-256, dengan penambat `trace.head` pada receipt. Transcript native tetap mutable. `/goat status` menyimpan ringkasan terminal; teks sukses berasal dari tes host, bukan pernyataan Worker. |

**Lingkup kepercayaan:** launcher, operator, plugin yang terpasang, instalasi Python, provider yang dipilih dan klien yang diberi akses ke host privat harus tepercaya. Ini bukan isolasi antarpengguna pada server bersama. Hash chain tidak melindungi dari administrator yang juga dapat mengganti penambat. Mutasi izin/model/steps diperiksa pada batas operasi; ini bukan penguncian konfigurasi oleh kernel. Suite menjalankan kode proyek dan tes dalam interpreter yang sama: hasil tes merupakan bukti engineering, bukan attestation terhadap kode yang sengaja memalsukan hasil dalam proses. Jaminan isolasi kernel mengenai akses isi file dan operasi, bukan penyembunyian seluruh metadata OS.

**Belum didukung:** menjalankan build/npm/pytest arbitrer, dependensi proyek tak terpilih, akses repo penuh, salin-balik otomatis, atau otorisasi multi-tenant. Provider yang tidak melewati hook HTTP yang didukung tidak dicakup. Jangan memakai profil ini sebagai runner produksi umum.

## Bukti penerimaan

`npm run check` lulus dengan SDK baseline dan `npm test` lulus 72/72. `npm run audit:milestone` pada binary 2.4.2, 2.4.1 dan 2.3.2 masing-masing menghasilkan **131 lulus, 0 gagal, 0 skip**. Sepuluh skenario lama sekarang mempunyai assertion di `tests/milestone/plugin.test.mjs` pada jalur dispatch yang ditandatangani:

| Kontrak | Bukti pada host privat |
|---|---|
| T2/T3/T16 | Klien benar-benar menyimpan `always`. Capability palsu atau payload dengan tanda tangan tidak cocok tetap ditolak; jumlah request model nol dan tidak ada child. Penolakan masuk trace. |
| T4/T14 | Model aktual dan `parentID` child diperiksa untuk L1/L2/L3. Assignment hilang tidak menghasilkan fallback. Percobaan `subagent` dan dispatch ulang dari child tidak membuat cucu. |
| T9/T15 | Mock melaporkan 150.007 token; run berhenti setelah Worker tanpa Auditor. Pada uji terpisah, PATCH izin saat request Worker sedang berlangsung terdeteksi dan run gagal. |
| T10 | Rantai hash dihitung ulang di luar plugin dan dicocokkan ke receipt; urutan dispatch, pemeriksaan, rework, operasi file dan akhir run diperiksa. Saat GOAT OFF di tengah run lain, Worker terinterupsi dan tidak ada request lanjutan. |
| T11/T17 | Auditor berhasil membaca file tes yang diizinkan; percobaan menulis lewat broker ditolak dan izin baca luar, write/edit/shell native ditolak. Percobaan Worker membaca canary luar workspace gagal tanpa mengembalikan isinya. |

**Pemeriksaan akhir dari luar runtime:** launcher asli dibuka di TUI 2.4.2 dengan provider loopback. Enam request teramati (Manager, Worker ×3, Auditor, Manager); layar menampilkan hasil terverifikasi. Pemeriksa membaca dua file dari disk, menghitung ulang rantai 12 event sampai hash receipt, dan melihat dua tes lulus. TUI kembali OFF dan keluar dengan kode 0. Secara terpisah dalam pemeriksaan yang sama, `strace` pada runner melihat kernel menolak pembacaan canary di luar workspace, pembuatan file di dalam workspace, dan pembuatan socket. Ini bukti independen dari prosa model dan laporan Worker, bukan sertifikasi keamanan pihak ketiga.

**Status:** fungsi orkestrasi dan kontrak uji Task 3 pada profil terbatas telah diimplementasikan. Penerimaan final oleh Owner dan uji live multi-file dengan OpenAI belum dilakukan. Tidak ada aktivasi produksi, penggunaan kuota provider dalam verifikasi, atau perubahan pada konfigurasi global.
