# Task 3 — Uji coding pertama dengan model pilihan Owner

**MVP satu file diterima Owner di checkpoint `c19ce45`.** Pada OpenCode 2.4.2 dengan OpenAI langsung, Manager `gpt-6.1-sol`, Worker `gpt-5.6-terra`, dan Auditor `gpt-6-luna` menghasilkan `completed`, `checksPassed: true` dalam 20,4 detik. Owner memeriksa file dan mencocokkan SHA-256. Untuk profil proyek, gunakan [instruksi multi-file](task-3-project.md).

## Cara menjalankan

1. Gunakan Linux dengan `/usr/bin/python3`, `libseccomp.so.2`, Node 22.19+ dan binary OpenCode **2.4.2** (rekomendasi), **2.4.1** atau **2.3.2** (baseline). Lihat [matriks kompatibilitas host](task-3-opencode-compat.md). Dari root checkout setelah `npm ci`, pilih binary:

   ```sh
   export OPENCODE_BIN=/path/absolut/ke/opencode
   "$OPENCODE_BIN" --version
   ```

2. Di **luar repo**, buat file JSON privat (misalnya `$HOME/goat-provider.private.json`, mode `0600`) berisi **hanya** `model` dan `providers` dari konfigurasi OpenCode yang telah berhasil dipakai Owner. Sertakan model Manager, Worker, dan Auditor. Contoh struktur untuk endpoint yang memang kompatibel dengan OpenAI Chat Completions; ganti URL dan ID dengan milik Owner:

   ```json
   {
     "model": "my-provider/manager-id",
     "providers": {
       "my-provider": {
         "package": "@opencode/ai/providers/openai-compatible",
         "settings": { "baseURL": "https://YOUR-ENDPOINT/v1", "apiKey": "{env:GOAT_PROVIDER_KEY}" },
         "models": { "manager-id": {}, "worker-id": {}, "auditor-id": {} }
       }
     }
   }
   ```

   Sediakan `GOAT_PROVIDER_KEY` di environment **sebelum** memulai. Launcher meneruskan variabel kredensial yang direferensikan dengan `{env:…}` dan berakhiran `KEY`, `TOKEN`, atau `PASSWORD`. Launcher tidak menyalin database login, plugin global, atau HOME pengguna. Untuk adapter lain, gunakan konfigurasi asli adapter itu; contoh di atas bukan syarat memakai gateway tertentu.

3. Mulai host privat **hanya ketika siap menggunakan kuota provider**:

   ```sh
   node tests/milestone/owner-live.mjs "$HOME/goat-provider.private.json"
   ```

   Launcher mencetak direktori sementara dan instruksi asli, menjalankan pemeriksaan seccomp, lalu membuka TUI `--standalone` dengan HOME/XDG terpisah dan plugin dari checkout ini. Default GOAT tetap OFF. Gunakan direktori temp lokal tepercaya, bukan di bawah checkout lain. Bila pemeriksaan gagal, jangan melonggarkan izin; gunakan mesin Linux yang mendukung filter tersebut.

4. Pada host privat, pilih **Build** dan model sesi dari provider Manager. Di `/goat router`, pilih **Inherit current session model** atau Manager eksplisit dari provider sesi itu. Untuk uji ini isi L1/L2/L3 dengan model Worker yang mendukung tool; petakan Auditor ke model berbeda. Jalankan `/goat mode standard`, lalu `/goat on`. Kirim tepat pesan yang dicetak:

   ```text
   Fix slugify in slug.py to lowercase words, remove leading and trailing whitespace, and collapse whitespace runs into one hyphen.
   ```

5. Periksa hasil **tool** `goat_verify_text` di percakapan asal. Untuk sukses wajib ada `status: "completed"`, `checksPassed: true`, `file`, `sha256`, dan referensi model. Bandingkan `sha256sum /path/dari/field/file` dan baca perubahan sebelum mengambilnya. File berada di workspace disposable, bukan di repo asal. Bila Manager melewatkan tool, lihat `/goat status`: `failed` / `manager_did_not_invoke_tool`; tidak ada receipt sukses. Gangguan sebelum terminal dapat meninggalkan `unverified`. Jangan memakai prosa Manager sebagai verdict.
6. Selesai: `/goat off`, keluar TUI. Simpan hasil yang telah ditinjau bila diperlukan, lalu hapus **hanya direktori sementara yang dicetak launcher** beserta data sesi/kredensial privat di dalamnya. Tidak ada copy-back, commit atau push otomatis.

Untuk tugas lain dalam profil yang sama, berikan argumen kedua berupa manifest JSON tepercaya milik Owner. Format dan contoh: [`live-task.json`](../tests/milestone/live-task.json). Isinya instruksi asli, satu nama file `.py`, sumber awal, nama fungsi, dan 1–12 kasus argumen/hasil JSON. Sumber dapat berasal dari salinan file proyek. Input harus sama dengan instruksi dalam manifest. Profil menolak baseline yang sudah hijau. Belum mendukung instalasi dependensi atau perintah tes bebas.

## Eksekusi dan isolasi

- **Manager:** dua giliran Build pada alur sukses biasa: meminta tool dan melaporkan hasilnya. Jalur live tidak menyisipkan `tool_choice` dan tidak memalsukan tool call. GOAT memeriksa panggilan dari sesi/pesan Manager; plugin mengambil instruksi dari pesan pengguna yang disimpan host. Model tidak dapat memasok path, capability atau prompt pengganti. `decideTask` tetap menentukan tier dan menyusun prompt secara deterministik (L2 untuk contoh ini). Standard/Resink tidak berubah; eksekusi awal terbatas pada satu task ready.
- **Worker:** izin `deny *` diikuti `allow goat_task_file` ditetapkan saat sesi dibuat dan diperiksa sebelum prompt. Tool hanya menerima `read` atau `replace` untuk **satu file tugas**; batasnya sama untuk L1/L2/L3. Broker tepercaya membuat direktori baru `0700` dan inode baru `0600` secara eksklusif, lalu memakai file descriptor itu tanpa membuka path dari model. Grant hanya berlaku untuk ID Worker, selama giliran berjalan. Maksimal dua operasi file dan tiga request model per percobaan. Setelah operasi kedua, tool juga dihapus dari daftar tool untuk giliran ringkasan.
- **Kode yang ditulis model:** hanya dijalankan di proses Python baru per kasus, bukan di proses plugin. Helper tepercaya menggunakan isolated mode, environment kosong, menutup FD tambahan, dan memasang filter seccomp *default deny* sebelum mengompilasi kode. Tidak ada izin membuka file, membuat socket/proses, atau menjalankan program lain. Proses mendapat sumber dan argumen melalui stdin, bukan descriptor file tugas atau nilai harapan. Output, waktu CPU, waktu tunggu dan ruang alamat dibatasi. Probe membuka `/dev/null` dan membuat socket harus ditolak. Runtime menguji isolasi serta baseline **sebelum membuat Worker**. Di host pengembangan `unshare` menghasilkan `Operation not permitted`; implementasi tidak mengandalkan namespace, worktree atau label environment sebagai sandbox.
- **Auditor:** sesi root native lain, model berbeda, `deny-all`; hanya membaca paket bukti teks. Host mengambil isi file yang nyata, menghitung SHA-256 dan membandingkan hasil per kasus dengan nilai harapan di luar proses kode. Auditor menerima sumber sebelum/sesudah dan hasil kasus; verdict harus cocok dengan task, percobaan, kriteria, kutipan Worker dan hash file. `PASS` tidak mengalahkan tes merah atau file yang tidak berubah. `FAIL` yang valid dapat memicu **satu** rework dengan hasil kasus sebelumnya. Tidak ada rework kedua.
- **Batas kepercayaan:** OS membatasi **kode hasil edit**; sesi OpenCode sendiri bukan VM/container. Pembatasan Worker bergantung pada host, broker, SDK, manifest dan plugin tepercaya. Tidak ada perlindungan terhadap administrator atau plugin jahat dalam proses host. Host memerlukan akses jaringan untuk provider. Tes hanya membuktikan kasus yang dijalankan; PASS tidak membuktikan semua input benar.

## Kompatibilitas provider dan bukti

Di profil live, kandidat model diambil dari inventory aktif OpenCode. Tidak ada filter `fixture`, pemaksaan format Chat Completions, atau dependensi 9Router. Manager dan Worker harus mendukung tool; Auditor harus memberi JSON yang sesuai kontrak. Batas SDK `experimental.model.resolve`: Manager eksplisit hanya dapat mengganti model **dalam provider sesi yang sama**. Worker dan Auditor dapat memakai provider berbeda melalui `session.create(model)`. Profil awal mengandalkan hook HTTP sesi; transport WebSocket tidak didukung. Adapter yang tidak memperlihatkan request Worker/Auditor pada hook tersebut tidak menghasilkan sukses terverifikasi.

Receipt membedakan model yang dilaporkan sesi dan field JSON `model` yang benar-benar terlihat pada request keluar (`managerRequestModel`, `requests.worker`, `requests.auditor`). Nilai `null` berarti protokol tidak memperlihatkan ID pada field itu. Ini tidak membuktikan backend fisik, identitas, biaya, atau model akhir di balik alias/router. Profil mock historis tetap memakai kebijakannya sendiri; hasilnya bukan klaim kepatuhan model live.

**Verifikasi terfokus** memakai fixture yang sama dengan dua provider bernama `owner-lab` dan `review-lab`, keduanya menuju mock loopback. Manager diwariskan `manager`; Worker yang dipilih `implementer`; Auditor `reviewer`. Tidak ada forced tool choice pada ketiga skenario:

| Skenario | Request HTTP | Bukti |
|---|---:|---|
| Manager melewatkan tool dan menulis seolah selesai | 1 | Tanpa Worker, Auditor atau receipt; `/goat status` melaporkan kegagalan protokol |
| Worker menulis fungsi yang mencoba membaca file host, Auditor memberi PASS | 6 | Keempat kasus merah di sandbox; `failed: insufficient-evidence` |
| Edit pertama gagal, Auditor meminta rework, edit kedua benar | 10 | 4/4 kasus hijau; isi file dan digest pada receipt cocok; `completed` |

**Jumlah: 17 request lokal, nol provider eksternal.** `npm run check` lulus, `npm test` **72/72**, `npm run audit:milestone` **120 lulus, 0 gagal, 10 skip**. Satu suite gabungan memakai 96 request lokal (79 baseline + 17 baru). Koreksi terfokus: host masih dapat menawarkan tool pada langkah ketiga; profil kini mencabutnya saat dua operasi habis.

Sepuluh skip produksi tetap T2–T4, T9–T11, T14–T17: otoritas Owner, dispatch **child** per tier, anggaran penggunaan/trace terlindungi, pembacaan file oleh Auditor, kedalaman, mutasi izin, saved approval dan isolasi worktree produksi. Profil ini memakai root sessions dan broker satu file. Tidak ada bukti provider live sampai Owner menjalankan uji di atas, dan tidak ada aktivasi produksi.
