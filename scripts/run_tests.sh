#!/usr/bin/env bash
# Runs every TypeScript test (esbuild bundle -> node), tsc type-check, and Python server tests.
# Usage: npm test   (or)   bash scripts/run_tests.sh
set -u
cd "$(dirname "$0")/.."
NODE="${NODE:-$(command -v node || ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | tail -n 1)}"
export PATH="$(dirname "$NODE"):$PATH"
export PYTHONDONTWRITEBYTECODE=1
if [ -x ./node_modules/.bin/esbuild ]; then
  ESBUILD=./node_modules/.bin/esbuild
else
  ESBUILD=./node_modules/@esbuild/linux-x64/bin/esbuild
fi
OUT="${TMPDIR:-/tmp}/nra_tests"
mkdir -p "$OUT"
fail=0
for f in test/*.test.ts; do
  name=$(basename "$f" .test.ts)
  if "$ESBUILD" "$f" --bundle --platform=node --target=node20 --log-level=warning --outfile="$OUT/$name.cjs" \
     && "$NODE" "$OUT/$name.cjs"; then
    echo "[PASS] $name"
  else
    echo "[FAIL] $name"; fail=1
  fi
done
if "$NODE" node_modules/typescript/bin/tsc --noEmit; then echo "[PASS] tsc --noEmit"; else echo "[FAIL] tsc"; fail=1; fi
if py_out=$(python3 -m unittest discover tests 2>&1); then
  echo "$py_out" | tail -n 3; echo "[PASS] python unittest"
else
  echo "$py_out" | tail -n 40; echo "[FAIL] python unittest"; fail=1
fi
exit $fail
