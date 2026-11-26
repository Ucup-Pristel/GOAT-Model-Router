# Task 3 — Integrasi runtime plugin OpenCode 2.3.2

**Hasil implementasi: RPC plugin menjalankan tugas teks yang dapat diperiksa di host privat. Prompt biasa tidak otomatis diambil alih.** Tidak ada perubahan konfigurasi global, penggunaan kredensial provider nyata, atau aktivasi produksi.

## Cara tugas masuk

Plugin server yang sesungguhnya dimuat dari salinan `packages/opencode` di proyek sementara. Test memanggil `health` pada lokasi tersebut, menyimpan assignment melalui `setConfig`, lalu memanggil `dispatchText` melalui transport RPC OpenCode. Caller memberikan `sessionID` sumber, instruksi asli, kapabilitas sementara milik host uji, dan opsional tier. Contoh pemanggilan dari client yang sudah terhubung ke host privat:

```ts
const result = await client.rpc(Goat).dispatchText({
  sessionID, capability, instruction: "Convert the word plum to uppercase.",
}, { location: { directory: project } })
```

`/goat on` mengizinkan pemeriksaan konfigurasi untuk dispatch; perintah itu tidak menyediakan kapabilitas. Host uji menyediakan sendiri direktori, endpoint loopback dan kapabilitas acak lewat environment proses. Server memeriksa lokasi dan kapabilitas sebelum perencanaan. Kapabilitas ini **bukan identitas Project Owner**. Tidak ada perintah `/goat` keenam.

Pada uji pembanding, instruksi yang sama dikirim sebagai **prompt biasa** sesudah GOAT ON: tepat satu request model sesi asal, tanpa sesi Worker/Auditor. Dalam kontrak plugin `2.3.2`, `SessionHooks.prompt` memberi akses ke prompt, metadata dan delivery; callback bertipe `void | Promise<void>`. Tidak ada `handled`, pembatalan dengan pengganti hasil, atau `result` untuk menyelesaikan primary turn. `context` dapat mengubah konteks model; `result` pada hook `title` dan `compaction` hanya untuk permintaan bantu. Menjalankan RPC sebagai efek samping hook tidak menggantikan jawaban host. Sumber: [`@opencode/plugin` server](https://opencode.ai/docs/build/plugins/server), deklarasi terpasang `dist/promise/session.d.ts` dan `registration.d.ts`, serta [test pembanding](../tests/milestone/plugin.test.mjs).

## Apa yang dieksekusi

- [`text-runtime.ts`](../packages/opencode/src/text-runtime.ts) memakai `decideTask` dari `@goat/core`, OriginalIntent, keputusan tier, prompt Worker dan kriteria verifikasi dari satu hasil Manager. Worker dan Auditor menggunakan assignment yang tersedia pada provider fixture yang dipatok ke endpoint lokal. Manager deterministik: model diwarisi dari sesi asal atau diambil dari konfigurasi eksplisit; **nol inferensi Manager**.
- Satu task yang `ready` dan memiliki pemeriksa deterministik dapat dijalankan. Profil mendukung `Convert the word … to uppercase/lowercase.` dan `Reply with exactly "…".`; permintaan umum tanpa pemeriksa serta task yang memerlukan review berhenti sebelum Worker. Ini tidak mengklaim verifikasi jawaban bebas atau eksekusi rencana multi-task.
- Worker dan Auditor adalah **dua sesi root native** dengan model berbeda, judul tetap, `steps: 1` dan `deny-all`. Keduanya memakai `session.create/prompt/wait`; tidak ada `parentID`, tool subagent, atau notifikasi yang membangunkan sesi asal. Auditor hanya menerima prompt verifikasi dan paket bukti teks. Sesi per peran digunakan kembali hanya untuk satu rework/re-audit dari run yang sama.
- [`verified-text.ts`](../packages/opencode/src/verified-text.ts) memuat alur terminal yang juga dipakai baseline sintetis. Verdict wajib cocok dengan task, percobaan, kriteria, dan kutipan seluruh output; `PASS` juga memerlukan jawaban yang benar menurut pemeriksa. Hanya `FAIL` valid dapat memicu rework. `invalid-verdict` dan `insufficient-evidence` langsung terminal.
- Batas per instance plugin: satu dispatch aktif, maksimal empat giliran model dan tenggat delapan detik. Agent satu langkah, kontrol request HTTP untuk sesi terkelola dan penghentian retry host membatasi profil lokal. Pada timeout saat menunggu, runtime meminta interrupt lalu menunggu sesi idle. Berakhirnya koneksi lokal bukan bukti penghentian tagihan provider eksternal.

## Bukti eksekusi dan jumlah request

Contoh dari satu run: `intent-8b4bd871e6ab`, `task-1`; Manager memilih L1 `fixture/mock`. Worker `ses_de8777e69ffeymKbvuDsjJVnOD` menjawab `PLUM`. Auditor `fixture/auditor` di `ses_de8777e4cffe7ds7CwIU3OO2kY` memberi PASS yang terikat pada `PLUM`, kriteria dan percobaan 1. Status: `queued → classifying → delegated → auditing → completed`. ID ini bukti satu run, bukan fixture tetap.

| Uji pada plugin aktual | Request pada provider |
|---|---:|
| OFF, kapabilitas salah, risiko/review, assignment tidak lengkap | 0 |
| Prompt biasa, GOAT ON (kontrol, di luar dispatch) | 1 |
| Teks literal dengan jawaban persis | 2 |
| Worker lambat + dispatch konkuren: `busy`, kemudian `cancelled`; koneksi putus tanpa Auditor | 1 |
| Tiga sukses: L1 otomatis, L2/L3 eksplisit; termasuk Resink dan Manager eksplisit | 6 |
| Worker mengirim instruksi untuk menyetujui dan Auditor berbohong; verdict JSON cacat | 4 |
| Rework berhasil; rework habis | 8 |
| **Total per run integrasi** | **22** |

Semua hitungan diambil di batas HTTP mock, termasuk request di luar dispatch. Dari 22 request: **11 Worker, 10 Auditor, 1 kontrol**, tanpa tool yang ditawarkan. Pada pengujian tiga tier, model Worker di sesi dan pada HTTP adalah `mock`, `middle`, `senior`. Auditor tetap `auditor`. Ketika L2 diuji dalam mode Resink, Manager eksplisit `fixture/senior` tidak mengganti model Worker.

Node `22.23.5`, OpenCode `2.3.2`. Reproduksi pada checkout yang sudah memasang dependensi:

```sh
export OPENCODE_BIN=/path/to/opencode-2.3.2
npm run check
npm test
npm run audit:milestone
```

`check` lulus; `npm test`: **72/72**. Milestone: **118 lulus, 0 gagal, 10 skip**. Total satu run suite gabungan: **57 request lokal** (22 plugin, 23 baseline sintetis, 12 kontrol native). Test historis ikut dijalankan oleh perintah regresi yang diminta; bukan audit baru atas milestone yang telah diterima.

## Audit independen

**PASS terbatas untuk integrasi RPC teks lokal.** Reviewer independen memeriksa kode plugin dan menjalankan ulang hanya suite integrasi: **12 subtes lulus** (13/13 termasuk induk), tepat **22 request**. Reviewer mengonfirmasi bukti routing dan pewarisan Manager, penolakan konkuren, interrupt tanpa Auditor, validasi bukti, dan penghentian setelah satu rework. Tidak ada defect dalam lingkup yang terkonfirmasi; tidak diperlukan siklus koreksi hasil audit.

## Batas produksi

T1 (OFF), T12 (bukti), T13 (rework) dan T20 (alur sukses dengan pemeriksaan deterministik serta Auditor) telah memiliki uji pada dispatcher teks aktual. T4 versi *child session* dan T11 versi akses baca file terbatas tetap dibedakan dari bukti sesi root/teks. Skip lain: T2–T3 (otorisasi owner dan jejak penolakan), T9–T10 (anggaran penggunaan dan trace terlindungi), T14–T17 (kedalaman delegasi, mutasi izin, saved approval dan isolasi worktree). Transcript dan metadata yang dikembalikan RPC adalah bukti pengujian, bukan catatan tahan manipulasi. Host uji dan konfigurasi mock dianggap tepercaya; akses tool pada proyek nyata tetap diblokir.
