#!/usr/bin/env bash
# gate.sh — codex-epic-implement SHIP-stage local gate. Runs the SAME checks as CI.
#
# Deliberately NOT `set -e`: run every gate, collect failures, print a TERMINAL MARKER.
# Never trust a piped exit code (nmemo lesson: gate-exit-code-masked-by-pipe) — grep for
# "✓ ALL GATES PASSED" / "✗ FAILED GATES".
#
# Usage:
#   gate.sh                       # full: typecheck + biome + test + build (whole monorepo)
#   gate.sh --pkg @codex/foo      # scope test/build/typecheck to one turbo package
#   gate.sh --skip-build          # skip the build gate
#   gate.sh --skip-tests          # skip the test gate (build/typecheck only — NOT a real gate)
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PKG=""; SKIP_TESTS=0; SKIP_BUILD=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pkg) PKG="${2:?--pkg needs a turbo filter}"; shift 2 ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    *) echo "gate: unknown arg: $1" >&2; exit 2 ;;
  esac
done

failed=()
run() { local label="$1"; shift; echo ""; echo "=== $label ==="; if ! "$@"; then failed+=("$label"); echo "FAIL: $label" >&2; fi; }

# typecheck (turbo-cached). biome check:ci is the CI static-analysis gate (read-only, no --write).
if [[ -n "$PKG" ]]; then run "typecheck ($PKG)" pnpm turbo run typecheck --filter="$PKG"
else run "typecheck" pnpm typecheck; fi

run "biome (check:ci)" pnpm check:ci

if [[ $SKIP_TESTS -eq 0 ]]; then
  # --concurrency=1 is mandatory (shared Neon branch); the root `test` script already sets it.
  if [[ -n "$PKG" ]]; then run "test ($PKG)" pnpm turbo run test --filter="$PKG" --concurrency=1
  else run "test" pnpm test; fi
fi

if [[ $SKIP_BUILD -eq 0 ]]; then
  if [[ -n "$PKG" ]]; then run "build ($PKG)" pnpm turbo run build --filter="$PKG"
  else run "build" pnpm build; fi
fi

echo ""
if [[ ${#failed[@]} -eq 0 ]]; then
  echo "✓ ALL GATES PASSED"; exit 0
else
  echo "✗ FAILED GATES (${#failed[@]}):" >&2
  for f in "${failed[@]}"; do echo "  - $f" >&2; done
  exit 1
fi
