#!/usr/bin/env bash
# retro-scan.sh — surface prior lessons relevant to a change-set BEFORE implement (stage 1) and
# before review (stage 6). Reads recent epic retros AND queries the bd-remember lessons substrate.
#
# Usage:   retro-scan.sh [module-or-keyword ...]
# Output:  TSV  <source>\t<ref>\t<line>     (source ∈ retro|memory).  Empty == nothing to probe.
#
# Bash 3.2-safe (macOS). No `mapfile`.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
RETROS="docs/epics/retros"

# 1) Most-recent 3 retros — always surface their lesson headings.
if [[ -d "$RETROS" ]]; then
  ls -t "$RETROS"/*.md 2>/dev/null | head -3 | while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    rid="$(basename "$f" .md)"
    grep -nE '^(#{2,3} |- )' "$f" 2>/dev/null | grep -iE "didn'?t|harden|pattern|gotcha|lesson|watch" | head -5 \
      | while IFS= read -r line; do printf 'retro\t%s\t%s\n' "$rid" "$line"; done
  done
fi

# 2) Per-module: retros mentioning the module + the bd-remember substrate.
for mod in "$@"; do
  [[ -z "$mod" ]] && continue
  if [[ -d "$RETROS" ]]; then
    grep -rilE "$mod" "$RETROS" 2>/dev/null | while IFS= read -r f; do
      printf 'retro\t%s\tmentions: %s\n' "$(basename "$f" .md)" "$mod"
    done
  fi
  # The canonical lessons live in `bd remember`; surface any keyed to this module/keyword.
  bd memories "$mod" 2>/dev/null | grep -aE '\S' | head -6 \
    | while IFS= read -r line; do printf 'memory\t%s\t%s\n' "$mod" "$line"; done
done
