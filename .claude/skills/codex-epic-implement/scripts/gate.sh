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
#   gate.sh --wp <wp-id>          # emit the SHIP (stage-9) bd-audit record for this WP on PASS
#                                 #   (also reads $WP_ID, then the feat/<wp-id>-… branch name)
#
# bd-audit emission (Codex-3l73h): on a PASS we write the stage-9 SHIP audit record so the trail the
# retro reads is never empty (codex-epic-implement R2 / conventions §3). It is best-effort — wrapped
# in `|| true` and emitted BEFORE the terminal marker — and can NEVER change the gate's pass/fail
# result or the `✓ ALL GATES PASSED` / `✗ FAILED GATES` markers the cycle trusts.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PKG=""; SKIP_TESTS=0; SKIP_BUILD=0; WP="${WP_ID:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pkg) PKG="${2:?--pkg needs a turbo filter}"; shift 2 ;;
    --wp)  WP="${2:?--wp needs a wp id}"; shift 2 ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    *) echo "gate: unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Last resort: derive the WP id from a feat/<wp-id>-<slug> branch name (e.g. feat/Codex-69t7c.9-hub).
# WP ids look like Codex-<base>[.<n>]; the slug follows the next hyphen. (POSIX ERE — no `+?`, which
# bash 3.2 / macOS rejects: feedback_ci bootstrap-dev-env bash-3.2-compat.)
if [[ -z "$WP" ]]; then
  branch="$(git branch --show-current 2>/dev/null || true)"
  [[ "$branch" =~ ^feat/([A-Za-z]+-[A-Za-z0-9]+(\.[0-9]+)?)- ]] && WP="${BASH_REMATCH[1]}"
fi

# emit_ship_audit — write the stage-9 SHIP bd-audit record. Best-effort ONLY: never affects the gate.
emit_ship_audit() {
  if [[ -z "$WP" ]]; then
    echo "note: no WP id (pass --wp <id>, set \$WP_ID, or run on a feat/<wp>-… branch) — skipping SHIP bd-audit emission" >&2
    return 0
  fi
  if ! command -v bd >/dev/null 2>&1; then
    echo "note: bd not on PATH — skipping SHIP bd-audit emission for $WP" >&2
    return 0
  fi
  bd audit record --kind=tool_call --issue-id="$WP" --tool-name=codex-epic-implement \
    --prompt="stage-9 SHIP complete" >/dev/null 2>&1 \
    || echo "note: bd audit record failed (non-fatal) — emit stage-9 SHIP for $WP manually" >&2
  return 0
}

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
  emit_ship_audit || true   # best-effort, BEFORE the marker — must never flip a PASS to a fail
  echo "✓ ALL GATES PASSED"; exit 0
else
  echo "✗ FAILED GATES (${#failed[@]}):" >&2
  for f in "${failed[@]}"; do echo "  - $f" >&2; done
  exit 1
fi
