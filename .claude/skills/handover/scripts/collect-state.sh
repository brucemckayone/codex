#!/usr/bin/env bash
# collect-state.sh — emit ONE JSON snapshot of session state for /handover. READ-ONLY.
#
# Deliberately slims everything: bd descriptions in this repo run to KILOBYTES each
# (Codex-kgrdp.23's description alone is ~4KB), so raw `bd list --json` would blow the
# caller's context. Only id/status/priority/title survive, titles truncated.
#
# Usage:  collect-state.sh [--ports] [--workflow <file.yml>]
#   --ports              also probe the known dev-stack ports (slower: ~1s)
#   --workflow FILE      CI workflow to read conclusions from (default testing.yml)
#
# Output: one JSON object on stdout. Never exits non-zero for a missing tool — every
# field degrades to "" / [] / null so the caller always gets a parseable blob.
set -uo pipefail

WANT_PORTS=false
WORKFLOW="testing.yml"
while [ $# -gt 0 ]; do
  case "$1" in
    --ports)    WANT_PORTS=true ;;
    --workflow) shift; WORKFLOW="${1:-testing.yml}" ;;
    *)          : ;;
  esac
  shift
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 0

# ---------------------------------------------------------------------------
# The handover folder is resolved against the SHARED git dir, not the current
# working tree, so every worktree reads and writes the SAME folder. From a
# worktree `--git-common-dir` returns the main checkout's .git path.
# ---------------------------------------------------------------------------
COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null || echo '')"
if [ -n "$COMMON_DIR" ]; then
  COMMON_ABS="$(cd "$COMMON_DIR" 2>/dev/null && pwd)"
  MAIN_ROOT="$(dirname "${COMMON_ABS:-$ROOT}")"
else
  MAIN_ROOT="$ROOT"
fi
export CR_MAIN_ROOT="$MAIN_ROOT"
export CR_HANDOVER_DIR="$MAIN_ROOT/docs/handover"
export CR_ROOT="$ROOT"
export CR_IS_WORKTREE="$([ "$ROOT" != "$MAIN_ROOT" ] && echo true || echo false)"

# --- git ------------------------------------------------------------------
export CR_BRANCH="$(git branch --show-current 2>/dev/null || echo '')"
export CR_SHA="$(git log -1 --format=%h 2>/dev/null || echo '')"
export CR_SUBJ="$(git log -1 --format=%s 2>/dev/null || echo '')"
export CR_DIRTY_COUNT="$(git status --porcelain 2>/dev/null | grep -c . )"
export CR_DIRTY_FILES="$(git status --porcelain 2>/dev/null | head -25 || echo '')"
export CR_RECENT="$(git log --oneline -12 2>/dev/null || echo '')"
export CR_WORKTREES="$(git worktree list 2>/dev/null || echo '')"

# Ahead/behind the two integration branches. `git rev-list --count A..B` is
# cheap and needs no fetch; the caller is told the data may be stale.
ab() { git rev-list --left-right --count "$1...HEAD" 2>/dev/null || echo ""; }
export CR_VS_DEV="$(ab origin/dev)"
export CR_VS_MAIN="$(ab origin/main)"
export CR_FETCH_AGE="$( [ -f "$COMMON_ABS/FETCH_HEAD" ] && echo $(( $(date +%s) - $(stat -f %m "$COMMON_ABS/FETCH_HEAD" 2>/dev/null || date +%s) )) || echo -1 )"

# --- GitHub: PRs + CI conclusions ----------------------------------------
# NOTE: match on CONCLUSION, never status. A `completed/*` glob matches
# `cancelled`, and every push here spawns a push run AND a pull_request run
# where one is deliberately cancelled.
export CR_PRS='[]'
export CR_RUNS='[]'
if command -v gh >/dev/null 2>&1; then
  CR_PRS="$(gh pr list --author '@me' --state open \
      --json number,title,baseRefName,headRefName,isDraft,url 2>/dev/null || echo '[]')"
  if [ -n "$CR_BRANCH" ]; then
    CR_RUNS="$(gh run list --branch "$CR_BRANCH" --workflow "$WORKFLOW" --limit 6 \
        --json databaseId,event,status,conclusion,headSha,createdAt 2>/dev/null || echo '[]')"
  fi
fi
export CR_PRS CR_RUNS CR_WORKFLOW="$WORKFLOW"

# --- beads ----------------------------------------------------------------
export CR_INPROG="$(bd list --status in_progress --json 2>/dev/null || echo '[]')"
export CR_READY="$(bd ready --json 2>/dev/null || echo '[]')"
export CR_BLOCKED="$(bd list --status blocked --json 2>/dev/null || echo '[]')"

# --- dev stack ports (opt-in) --------------------------------------------
# `lsof -ti:PORT` is NOT a listener check — it matches CLOSED client sockets and
# reports phantom occupancy. Use -sTCP:LISTEN, and count PORTS not rows (IPv4 +
# IPv6 on the same port yields two rows).
export CR_PORTS=""
if [ "$WANT_PORTS" = true ] && command -v lsof >/dev/null 2>&1; then
  for p in 3000 4001 4002 4100 5173 6006 42069 42071 42072 42073 42074 42075; do
    if lsof -nP -iTCP:"$p" -sTCP:LISTEN -t >/dev/null 2>&1; then
      CR_PORTS="${CR_PORTS}${p} "
    fi
  done
fi

# --- existing handovers ---------------------------------------------------
# Exclude README.md/INDEX.md — they are folder furniture, not handovers, and
# listing them makes the snapshot look like there are more sessions than there are.
# Newest-first by FILENAME (the <date>-<time>-<slug> convention makes that exact),
# never by mtime — editing an old handover must not make it look like the newest.
export CR_EXISTING="$(ls -1 "$CR_HANDOVER_DIR"/*.md 2>/dev/null | sort -r | xargs -I{} basename {} 2>/dev/null \
  | grep -vxE 'README\.md|INDEX\.md' | head -8 || echo '')"

python3 -c '
import os, json, re

def lines(v, cap=None):
    out = [l for l in (os.environ.get(v, "") or "").splitlines() if l.strip()]
    return out[:cap] if cap else out

def beads(var, cap=12):
    """id/status/priority/title only. Descriptions here reach kilobytes each."""
    try:
        d = json.loads(os.environ.get(var) or "[]")
    except Exception:
        return []
    rows = d if isinstance(d, list) else d.get("issues", [])
    slim = []
    for i in rows[:cap]:
        t = (i.get("title") or "")
        slim.append({
            "id": i.get("id"),
            "status": i.get("status"),
            "priority": i.get("priority"),
            "title": t if len(t) <= 110 else t[:107] + "...",
        })
    return slim

def as_int(var, default=0):
    """Tolerate anything the shell emits: "", "0\n0", "12 ". Take the first token."""
    raw = (os.environ.get(var) or "").split()
    try:
        return int(raw[0]) if raw else default
    except Exception:
        return default

def js(var, default):
    try:
        return json.loads(os.environ.get(var) or default)
    except Exception:
        return json.loads(default)

def ahead_behind(var):
    raw = (os.environ.get(var) or "").split()
    if len(raw) != 2:
        return None
    return {"behind": int(raw[0]), "ahead": int(raw[1])}

worktrees = []
for l in lines("CR_WORKTREES"):
    m = re.match(r"^(\S+)\s+(\S+)\s+\[(.+?)\]", l)
    if m:
        worktrees.append({"path": m.group(1), "sha": m.group(2), "branch": m.group(3)})
    else:
        worktrees.append({"path": l.split()[0], "sha": "", "branch": ""})

runs = js("CR_RUNS", "[]")
# Surface conclusion explicitly so the caller cannot accidentally read status.
runs = [{
    "id": r.get("databaseId"), "event": r.get("event"),
    "status": r.get("status"), "conclusion": r.get("conclusion") or None,
    "sha": (r.get("headSha") or "")[:8], "created": r.get("createdAt"),
} for r in runs]

fetch_age = as_int("CR_FETCH_AGE", -1)

print(json.dumps({
  "repo_root": os.environ.get("CR_ROOT", ""),
  "main_checkout": os.environ.get("CR_MAIN_ROOT", ""),
  "is_worktree": os.environ.get("CR_IS_WORKTREE") == "true",
  "handover_dir": os.environ.get("CR_HANDOVER_DIR", ""),
  "existing_handovers": lines("CR_EXISTING"),
  "git": {
    "branch": os.environ.get("CR_BRANCH", ""),
    "last_sha": os.environ.get("CR_SHA", ""),
    "last_subject": os.environ.get("CR_SUBJ", ""),
    "dirty_count": as_int("CR_DIRTY_COUNT"),
    "dirty_files": lines("CR_DIRTY_FILES", 25),
    "recent_commits": lines("CR_RECENT", 12),
    "vs_origin_dev": ahead_behind("CR_VS_DEV"),
    "vs_origin_main": ahead_behind("CR_VS_MAIN"),
    "last_fetch_seconds_ago": fetch_age,
    "fetch_is_stale": fetch_age < 0 or fetch_age > 900,
  },
  "worktrees": worktrees,
  "worktree_count": len(worktrees),
  "open_prs": js("CR_PRS", "[]"),
  "ci": {"workflow": os.environ.get("CR_WORKFLOW", ""), "runs": runs},
  "beads": {
    "in_progress": beads("CR_INPROG"),
    "ready": beads("CR_READY", 8),
    "blocked": beads("CR_BLOCKED", 8),
  },
  "listening_ports": (os.environ.get("CR_PORTS") or "").split(),
}, indent=2))
'
