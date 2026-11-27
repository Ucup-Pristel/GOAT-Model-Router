# Task 6 — batas core dan host

`decideTask` menyusun rencana dari `OriginalIntent`, kebijakan Standard/Resink dan inventaris model. [`executePlan`](../packages/core/src/execution.ts) menjalankan rencana yang siap melalui satu `ExecutionHost` terikat pada tugas yang sudah diizinkan. Kesiapan rencana bukan izin eksekusi.

| Core (`packages/core`) | Adapter OpenCode (`packages/opencode`) |
|---|---|
| Validasi graf dan konflik scope, antrian Worker siap, batas konkurensi, snapshot teks dan integrasi perubahan di memori. | Discovery native, izin per operasi/path, binding parent/child/model/tool, baca snapshot checkout dan materialisasi ke staging. |
| Pemilihan tier, `RoleBudget` bersama, transisi lifecycle, pencocokan verdict dengan bukti, reproduksi defect, invalidasi turunan dan satu rework dengan eskalasi terbatas. | Inventaris dan OAuth native, pemanggilan model, observasi HTTP/WebSocket/token sesi, interupsi dan drain child, serta karantina jika host tidak responsif. |
| Kontrak Worker, Auditor, pemeriksa bukti dan hasil terminal. | Suite Python terlindungi, pemeriksaan konflik, izin `goat_apply`, penulisan Linux, receipt, jurnal hash, RPC, TUI dan storage. |

`runWorker` menerima model, tier, prompt, percobaan dan scope. Ia selesai **setelah** perubahan diintegrasikan, sehingga penerus membaca hasil yang benar. `audit` menerima paket bukti dan model terpisah; adapter wajib membatasi aksesnya menjadi hanya-baca. `reserve()` mengonsumsi satu unit anggaran secara sinkron sebelum operasi terukur. Pada jalur workspace/project, semua request peran termasuk lanjutan tool berbagi anggaran yang sama. Profil privat satu tugas mempertahankan penghitungan per giliran beserta limit request native per giliran. Batas token project berdasarkan penggunaan yang **sudah teramati**.

Host menyediakan operasi yang benar-benar dapat dijaminnya. Jika eksekusi berizin, pembatasan tool, pengukuran anggaran atau pembatalan tidak tersedia, berikan host `null` (`unsupported_execution`). Inventaris tanpa model atau kemampuan tool yang diperlukan juga menghentikan dispatch. Pemeriksa yang tidak tersedia dinyatakan dengan `verification: null` (`unsupported_verification` untuk tugas yang membutuhkan bukti). Profil teks hanya memakai pembanding deterministik yang ditetapkan sebelum dispatch. Pada workspace OpenCode, staging tanpa suite yang didukung tetap dapat dilaporkan seperti Task 5, tetapi tidak diterapkan ke checkout.

[`portability.test.ts`](../packages/core/test/portability.test.ts) memakai `decideTask`, `executePlan`, `RoleBudget` dan snapshot yang sama, tanpa memuat plugin atau memulai OpenCode. Adapter uji hanya menerapkan operasi di memori. Jalankan sendiri dengan `node --import tsx --test packages/core/test/portability.test.ts`. Bukti ini berlaku untuk core TypeScript/Node; OpenCode adalah satu-satunya adapter produksi.

## Uji live Owner: satu prompt kalkulator

Gunakan Linux yang mendukung pemeriksa Task 5, OpenCode **2.4.2**, dan akun OAuth native Owner. Dari root branch Task 6, siapkan workspace baru dengan salinan plugin dan core **dari working tree** menggunakan helper fixture yang sudah ada. Ini tidak mengubah kalkulator lama atau mengaktifkan GOAT di sesi pengembangan.

```sh
work=$(mktemp -d)
node --input-type=module -e 'import { installPrivatePlugin } from "./tests/milestone/private-plugin.mjs"; await installPrivatePlugin(process.argv[1])' "$work"
cd "$work"
mkdir src
printf '%s\n' '{"plugins":["./.opencode/plugins/goat"]}' > opencode.json
printf '%s\n' 'def answer(): return 0' > src/calc.py
cat > test_calc.py <<'PY'
import unittest
from src.calc import answer

class Calculator(unittest.TestCase):
    def test_answer(self):
        self.assertEqual(answer(), 42)
PY
test_hash=$(mktemp)
sha256sum test_calc.py > "$test_hash"
opencode
```

1. Di **sesi uji** pilih Build dan model OAuth native. Di `/goat router`, pilih Manager mewarisi model sesi, isi L1/L2/L3 dengan model yang mendukung tool, dan pilih Auditor berbeda dari semua Worker. Pilih **Standard** di `/goat mode`, lalu `/goat on`.
2. Kirim **satu prompt biasa**: “Perbaiki nilai jawaban kalkulator agar sesuai dengan pengujian yang sudah ada. Jangan ubah pengujiannya.”
3. Periksa izin native yang muncul: target tulis hanya `src/calc.py`; `test_calc.py` adalah suite terlindungi. Pilih **Once** untuk scope yang sesuai, termasuk penerapan perubahan terverifikasi.
4. Periksa **hasil tool `goat_verify_text`**: `workers` berisi `task-1` dengan tier, model dan ID child; `auditor` berbeda; `suites` memuat `test_calc` dengan `count: 1` dan `passed: true`. Harapkan `reason: verified_applied`, `checksPassed: true`, `application.applied: ["src/calc.py"]`, dan `conflicts`, `uncertain`, `unapplied` kosong. Akhiri dengan `/goat off` lalu keluar.
5. Di shell yang sama, jalankan `sha256sum -c "$test_hash"` dan `python3 -B -m unittest test_calc`. Hasil yang diharapkan: `test_calc.py: OK` dan satu tes lulus pada **checkout**, bukan hanya staging.
