#!/usr/bin/env bash
# adjacent-work-scan.sh — surface EXISTING beads near a feature area before scoping a new epic.
# Prevents duplicate epics (feedback_bd_search_before_filing). bd 1.0.4 uses --json (NOT --no-color).
#
# Usage:   adjacent-work-scan.sh <keyword-or-label> [more...]
# Output:  TSV  <id>\t<status>\t<title>   — open/in_progress matches by label AND text search, deduped.
#          Empty == no adjacent work found.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
[[ $# -ge 1 ]] || { echo "usage: adjacent-work-scan.sh <keyword> [more...]" >&2; exit 2; }

PARSE='import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
rows=d if isinstance(d,list) else d.get("issues",[])
for i in rows:
    if i.get("status") in ("open","in_progress"):
        print((i.get("id","?"))+"\t"+(i.get("status","?"))+"\t"+(i.get("title","")))'

tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
for kw in "$@"; do
  [[ -z "$kw" ]] && continue
  bd list --label "$kw" --status open,in_progress --json 2>/dev/null | python3 -c "$PARSE" >> "$tmp" 2>/dev/null || true
  bd search "$kw" --json 2>/dev/null              | python3 -c "$PARSE" >> "$tmp" 2>/dev/null || true
done
sort -u "$tmp"
