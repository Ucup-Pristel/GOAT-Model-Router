# Task 3 — Prompt biasa sebagai pintu masuk GOAT

**Verdict: PASS pada profil percakapan teks lokal, OpenCode 2.3.2.** Pengguna mengirim prompt biasa ke **Build**, agent utama bawaan OpenCode. Pengguna tidak perlu menyusun paket bukti, mengetik nama tool, memilih Worker, atau memanggil RPC dispatch. `/goat on` tetap tidak mengaktifkan eksekusi di instalasi produksi.

## Cara mengaktifkan

**Prasyarat host (sekali, oleh operator):** gunakan proyek sementara dengan plugin GOAT dan provider mock OpenAI-compatible `fixture` dari [fixture host](../tests/milestone/host-fixture.mjs). Selain `GOAT_TEXT_PROJECT` (direktori absolut proyek), `GOAT_TEXT_PROVIDER` (`http://127.0.0.1:PORT/v1` milik mock), dan `GOAT_TEXT_CAPABILITY` (token acak privat host), berikan **`GOAT_TEXT_CONVERSATION=1`** kepada proses server. Tanpa opsi terakhir, profil RPC yang telah diterima tetap berlaku. Konfigurasi agent pada proyek uji:

```json
{
  "agents": {
    "build": {
      "steps": 2,
      "permissions": [
        { "action": "*", "resource": "*", "effect": "deny" },
        { "action": "goat_verify_text", "resource": "*", "effect": "allow" }
      ]
    },
    "goat-local-text": {
      "steps": 1,
      "permissions": [{ "action": "*", "resource": "*", "effect": "deny" }]
    }
  }
}
```

**Di percakapan pengguna:**

1. Pada proyek uji tersebut, buka sesi utama **Build** dengan model sesi `fixture/mock`. Jika Build sudah aktif, tidak perlu berpindah agent. Jangan tambahkan aturan deny pada sesi yang menimpa izin tool Manager.
2. Gunakan `/goat router` untuk menyimpan assignment. Contoh yang menghasilkan urutan pada bukti di bawah: Manager `fixture/senior`, L1 `fixture/middle`, Auditor `fixture/auditor`; untuk model lain di menu, pilih mapping L2/L3 yang tersedia. Opsi **Inherit current session model** juga didukung. Worker dan Auditor harus berbeda.
3. Jalankan `/goat on`. Kirim **`Convert the word melon to uppercase.`** sebagai pesan biasa. Hasil tool GOAT di sesi yang sama berisi `{"status":"completed","reason":"accepted","output":"MELON"}`; balasan akhir yang teramati adalah `MELON`.
4. `/goat off` mengembalikan prompt berikutnya ke jalur asli OpenCode. Tidak ada tool GOAT yang ditawarkan pada primary turn tersebut, maupun request Worker/Auditor.

## Implementasi dan batas kepercayaan

[`conversation.ts`](../packages/opencode/src/conversation.ts) mendaftarkan satu tool langsung (`ctx.tool.transform`) hanya untuk host percakapan yang diprovisikan. Hook `context` membatasi tool pada request Manager, `experimental.model.resolve` memilih model Manager tanpa mengganti model yang tersimpan di sesi, dan `http.request` menetapkan `tool_choice` pada request pertama ke mock loopback. **Host tidak memalsukan panggilan tool:** provider harus mengembalikannya. Pada lanjutan setelah hasil tool, model Manager tidak mendapat tool. Tool mengambil teks dari pesan pengguna yang telah disimpan host dan memeriksa ID sesi/pesan sebelum memakai dispatcher. Model tidak dapat memasok instruksi pengganti, capability, tier, atau target melalui argumen tool.

Manager melakukan dua **request model**: meminta tool dan menyampaikan hasilnya. Pada verifikasi keduanya dijawab **mock deterministik**, bukan LLM live. `decideTask` masih memilih capability tier dan mengompilasi instruksi secara deterministik. [`text-runtime.ts`](../packages/opencode/src/text-runtime.ts) dan [`execution.ts`](../packages/core/src/execution.ts) tetap menjalankan lifecycle yang sama untuk RPC dan percakapan. Bukti sukses diperiksa sebelum hasil tool dikirim ke Manager. Status eksekusi tool *OpenCode* berarti pemanggilan tool selesai; **status tugas GOAT ada di dalam hasil tool**, dan dapat bernilai `failed`.

SDK mendukung primary agent terpilih, registrasi tool, hook konteks, serta child subagent native dengan notifikasi otomatis ke parent. Integrasi ini memakai **sesi asli pengguna sebagai Manager**, dengan **dua sesi root native terpisah** untuk Worker dan Auditor. Tidak ada tool `subagent` atau child notification yang melewati pemeriksaan bukti. Rujukan: [agent](https://opencode.ai/docs/agents), [server plugin dan hooks](https://opencode.ai/docs/build/plugins/server), serta deklarasi `promise/{agent,session,tool}.d.ts` pada SDK yang dipasang.

## Verifikasi

[Pengujian percakapan](../tests/milestone/plugin.test.mjs) memakai host dan provider fixture yang sama dengan baseline, mengirim keenam prompt melalui `session.prompt` ke **satu sesi Build**, lalu memeriksa transcript, model pada batas HTTP, tool yang ditawarkan, dan inventaris sesi. Konfigurasi ditulis melalui `setConfig`, handler yang juga dipakai menu TUI. Pengujian mencakup backend percakapan OpenCode; tidak menyimulasikan penekanan tombol TUI.

| Skenario | Request lokal menurut urutan | Hasil di sesi asal |
|---|---|---|
| OFF awal | `mock` | `ordinary native reply`; tanpa sesi baru |
| Sukses | `senior → middle → auditor → senior` | `MELON` |
| Auditor memberi PASS untuk jawaban salah | `senior → middle → auditor → senior` | `failed: insufficient-evidence`; tanpa output terverifikasi |
| Satu rework berhasil, Manager diwarisi | `mock → middle → auditor → middle → auditor → mock` | `MELON` |
| Audit kedua juga gagal | `senior → middle → auditor → middle → auditor → senior` | `failed: rejected`; tidak ada percobaan ketiga |
| Kembali OFF | `mock` | `ordinary native reply`; tanpa sesi baru |

**22 request** untuk verifikasi percakapan: 8 Manager, 6 Worker, 6 Auditor dan 2 balasan native saat OFF. Worker menerima prompt kompilasi dengan OriginalIntent dan instruksi tier L1. Masing-masing dari empat turn ON menghasilkan satu receipt di sesi asal dan tepat dua sesi `deny-all`; pada kedua kasus gagal, receipt tidak memuat `output`.

Node 22.23.5 dan OpenCode 2.3.2: `npm run check` lulus; `npm test` **72/72**; `npm run audit:milestone` **119 lulus, 0 gagal, 10 skip**. Total satu run gabungan **79 request lokal** (22 percakapan, 22 RPC, 23 baseline sintetis, 12 kontrol native). Untuk mereproduksi hanya verifikasi baru dengan binary 2.3.2:

```sh
OPENCODE_BIN=/path/to/opencode-2.3.2 node --import tsx --test \
  --test-name-pattern='ordinary conversation' tests/milestone/plugin.test.mjs
```

Profil tetap terbatas pada tugas teks dengan pemeriksa yang tersedia (konversi huruf dan jawaban literal persis). Tidak ada verifikasi untuk lampiran, tugas proyek nyata, atau provider berbayar. Prosa Manager bukan bukti; model yang mengabaikan kontrak tool tidak menghasilkan receipt GOAT yang valid. Opt-in host mengizinkan sesi Build lokal memakai dispatcher tanpa memberikan token kepada model; ini bukan autentikasi Project Owner. Tidak ada Task 4 atau aktivasi produksi.
