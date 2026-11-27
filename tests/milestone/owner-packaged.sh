#!/bin/sh
# Run interactively from the Owner's authenticated native Linux terminal.
set -eu
if [ "$#" -ne 2 ]; then
  echo "Usage: sh owner-packaged.sh /path/goat-core-VERSION.tgz /path/goat-opencode-VERSION.tgz" >&2
  exit 2
fi
database=$(realpath -m "${OPENCODE_DB:-${XDG_DATA_HOME:-$HOME/.local/share}/opencode/opencode.db}")
if [ "$database" = "$(realpath -m "$HOME/.var/app/com.vscodium.codium/data/opencode/opencode.db")" ]; then
  echo "Use the native Linux terminal with its own authenticated database, separate from the VSCodium development session." >&2
  exit 1
fi
if [ "$(opencode --version)" != "opencode v2.4.2" ]; then
  echo "This acceptance test targets OpenCode 2.4.2." >&2
  exit 1
fi
core=$(realpath "$1")
adapter=$(realpath "$2")
work=$(mktemp -d)
mkdir -p "$work/calculator/src"
cd "$work/calculator"
npm install --prefix "$work/install" --offline --ignore-scripts --no-audit "$core" "$adapter"
cat > opencode.json <<'JSON'
{"plugins":["../install/node_modules/@goat/opencode"]}
JSON
echo 'def answer(): return 0' > src/calc.py
cat > test_calc.py <<'PY'
import unittest
from src.calc import answer

class Calculator(unittest.TestCase):
    def test_answer(self):
        self.assertEqual(answer(), 42)
PY
sha256sum test_calc.py > "$work/protected.sha256"
echo "Workspace uji: $PWD"
echo "Build → /goat router → /goat mode (Standard) → /goat on."
echo "Prompt: Perbaiki kalkulator agar lulus pengujian yang ada. Jangan ubah tes."
echo "Periksa receipt verified_applied, jalankan /goat off, lalu keluar."
opencode --standalone
sha256sum -c "$work/protected.sha256"
cat src/calc.py
if grep -Fxq 'def answer(): return 0' src/calc.py; then
  echo "Checkout belum diperbaiki. Periksa receipt dan izin goat_apply." >&2
  exit 1
fi
