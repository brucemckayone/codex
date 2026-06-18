#!/usr/bin/env bash
# detect-state.sh — emit ONE JSON blob of in-flight epic state for codex-epic-handoff. READ-ONLY.
# Replaces a handful of inline git/bd reads with a single deterministic snapshot.
#
# Usage:  detect-state.sh
# Output: JSON on stdout: { branch, last_sha, last_subject, worktree_dirty, worktree_count,
#                           in_progress[], ready[], in_review[] }
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

export CR_BRANCH="$(git branch --show-current 2>/dev/null || echo '')"
export CR_SHA="$(git log -1 --format=%h 2>/dev/null || echo '')"
export CR_SUBJ="$(git log -1 --format=%s 2>/dev/null || echo '')"
export CR_DIRTY="$([[ -n "$(git status --porcelain 2>/dev/null)" ]] && echo true || echo false)"
export CR_WT="$(git worktree list 2>/dev/null | grep -c . || echo 0)"
# bd JSON passed via env vars (NOT heredoc) so quotes/newlines in titles can't break parsing.
export CR_INPROG="$(bd list --status in_progress --json 2>/dev/null || echo '[]')"
export CR_READY="$(bd ready --json 2>/dev/null || echo '[]')"
export CR_INREVIEW="$(bd list --label in-review --json 2>/dev/null || echo '[]')"

python3 -c '
import os, json
def slim(raw):
    try: d = json.loads(raw or "[]")
    except Exception: return []
    rows = d if isinstance(d, list) else d.get("issues", [])
    return [{"id": i.get("id"), "status": i.get("status"), "title": i.get("title")} for i in rows]
print(json.dumps({
  "branch": os.environ.get("CR_BRANCH",""),
  "last_sha": os.environ.get("CR_SHA",""),
  "last_subject": os.environ.get("CR_SUBJ",""),
  "worktree_dirty": os.environ.get("CR_DIRTY") == "true",
  "worktree_count": int(os.environ.get("CR_WT") or 0),
  "in_progress": slim(os.environ.get("CR_INPROG"))[:10],
  "ready": slim(os.environ.get("CR_READY"))[:5],
  "in_review": slim(os.environ.get("CR_INREVIEW"))[:10],
}, indent=2))
'
