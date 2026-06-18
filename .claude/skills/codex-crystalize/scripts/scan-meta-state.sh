#!/usr/bin/env bash
# scan-meta-state.sh — JSON snapshot of the codex-* loop's meta-state for codex-crystalize. READ-ONLY.
#
# Usage:  scan-meta-state.sh
# Output: JSON { skills[], retros[], adrs[], crystalizations[], rolling_inventory_exists, bd_memories_approx }
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

export CR_SKILLS="$(ls -d .claude/skills/codex-* 2>/dev/null | sed 's#.*/##' | tr '\n' ',')"
# rough count of keyed memories (lines that look like "  <key>/<slug>" under `bd memories`)
export CR_MEM="$(bd memories 2>/dev/null | grep -cE '^[[:space:]]+[A-Za-z0-9_-]+/' || echo 0)"

python3 -c '
import os, json, glob
def md(pat):
    skip={"README.md","ROLLING-INVENTORY.md"}
    return sorted(os.path.basename(x) for x in glob.glob(pat) if os.path.basename(x) not in skip)
print(json.dumps({
  "skills":[s for s in os.environ.get("CR_SKILLS","").split(",") if s],
  "retros": md("docs/epics/retros/*.md"),
  "adrs": md("docs/adr/*.md"),
  "crystalizations": md("docs/crystalizations/*.md"),
  "rolling_inventory_exists": os.path.exists("docs/crystalizations/ROLLING-INVENTORY.md"),
  "bd_memories_approx": int(os.environ.get("CR_MEM") or 0),
}, indent=2))
'
