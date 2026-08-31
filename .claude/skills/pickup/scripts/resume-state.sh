#!/usr/bin/env bash
# resume-state.sh — locate a handover, snapshot CURRENT state, and re-verify the
# handover's volatile claims. READ-ONLY.
#
# A handover is a timestamped snapshot, not a standing truth: branches move, PRs
# merge, beads close, runs finish, line numbers drift. This script extracts every
# checkable entity mentioned in the doc (bead ids, branch names, CI run ids,
# file:line anchors) and reports what is TRUE NOW, so the caller can diff the doc
# against reality instead of trusting it.
#
# Usage:
#   resume-state.sh                 # newest handover
#   resume-state.sh --list          # list handovers, newest first, with state words
#   resume-state.sh --file <path>   # a specific handover
#
# Output: one JSON object on stdout. Degrades gracefully — a missing tool yields
# null/[] rather than an error, so the caller always gets a parseable blob.
set -uo pipefail

MODE="resume"
WANT_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --list) MODE="list" ;;
    --file) shift; WANT_FILE="${1:-}" ;;
    *)      : ;;
  esac
  shift
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 0

# Shared handover dir: resolved against the SHARED git dir so every worktree
# agrees on one folder (from a worktree, --git-common-dir is the main .git).
COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null || echo '')"
if [ -n "$COMMON_DIR" ]; then
  COMMON_ABS="$(cd "$COMMON_DIR" 2>/dev/null && pwd)"
  MAIN_ROOT="$(dirname "${COMMON_ABS:-$ROOT}")"
else
  MAIN_ROOT="$ROOT"
fi
HD="$MAIN_ROOT/docs/handover"

# Newest-first by FILENAME, never by mtime. The naming convention
# <YYYY-MM-DD>-<HHMM>-<slug>.md makes a reverse name sort exact chronology, and
# mtime lies: touching an old handover (marking it DONE, fixing a typo) would
# otherwise make it outrank a genuinely newer one.
handovers_newest_first() {
  ls -1 "$HD"/*.md 2>/dev/null | sort -r | while read -r f; do
    case "$(basename "$f")" in README.md|INDEX.md) continue ;; esac
    printf '%s\n' "$f"
  done
}

state_of() {
  grep -m1 -oE 'State: \*\*(LIVE|PARKED|DONE)\*\*' "$1" 2>/dev/null \
    | grep -oE 'LIVE|PARKED|DONE' || echo '-'
}

# --- list mode ------------------------------------------------------------
if [ "$MODE" = "list" ]; then
  if [ ! -d "$HD" ]; then
    echo "No handover folder yet: $HD"
    exit 0
  fi
  printf '%-50s %-7s %s\n' "FILE" "STATE" "HEADLINE"
  handovers_newest_first | while read -r f; do
    head1="$(grep -m1 '^# ' "$f" 2>/dev/null | sed 's/^# Handover: //; s/^# //' | cut -c1-64)"
    printf '%-50s %-7s %s\n' "$(basename "$f")" "$(state_of "$f")" "$head1"
  done
  exit 0
fi

# --- pick the handover ----------------------------------------------------
DOC=""
if [ -n "$WANT_FILE" ]; then
  [ -f "$WANT_FILE" ] && DOC="$WANT_FILE" || DOC="$HD/$WANT_FILE"
else
  # A DONE handover is closed out — usually superseded by a newer one — so skip it
  # when auto-selecting. Still reachable explicitly via --file.
  NEWEST=""
  while read -r f; do
    [ -z "$NEWEST" ] && NEWEST="$f"
    if [ "$(state_of "$f")" != "DONE" ]; then DOC="$f"; break; fi
  done <<EOF
$(handovers_newest_first)
EOF
  [ -z "$DOC" ] && DOC="$NEWEST"
fi

export CR_HD="$HD" CR_DOC="${DOC:-}" CR_MAIN_ROOT="$MAIN_ROOT" CR_ROOT="$ROOT"
export CR_DOC_EXISTS="$([ -n "${DOC:-}" ] && [ -f "${DOC:-/nonexistent}" ] && echo true || echo false)"
export CR_DOC_AGE=-1
if [ "$CR_DOC_EXISTS" = true ]; then
  export CR_DOC_AGE="$(( ( $(date +%s) - $(stat -f %m "$DOC" 2>/dev/null || date +%s) ) / 60 ))"
  export CR_DOC_STATE="$(grep -m1 -oE 'State: \*\*(LIVE|PARKED|DONE)\*\*' "$DOC" 2>/dev/null | grep -oE 'LIVE|PARKED|DONE' || echo '')"
else
  export CR_DOC_STATE=""
fi

# --- current git / gh / bd state -----------------------------------------
export CR_BRANCH="$(git branch --show-current 2>/dev/null || echo '')"
export CR_SHA="$(git log -1 --format=%h 2>/dev/null || echo '')"
export CR_SUBJ="$(git log -1 --format=%s 2>/dev/null || echo '')"
export CR_DIRTY_COUNT="$(git status --porcelain 2>/dev/null | grep -c . )"
export CR_MAIN_TIP="$(git log -1 --format='%h %s' origin/main 2>/dev/null || echo '')"
export CR_DEV_TIP="$(git log -1 --format='%h %s' origin/dev 2>/dev/null || echo '')"
export CR_WORKTREES="$(git worktree list 2>/dev/null || echo '')"
export CR_FETCH_AGE="$( [ -f "$COMMON_ABS/FETCH_HEAD" ] && echo $(( $(date +%s) - $(stat -f %m "$COMMON_ABS/FETCH_HEAD" 2>/dev/null || date +%s) )) || echo -1 )"

export CR_PRS='[]'
command -v gh >/dev/null 2>&1 && CR_PRS="$(gh pr list --author '@me' --state open \
    --json number,title,baseRefName,headRefName,isDraft,url 2>/dev/null || echo '[]')"
export CR_PRS

# ---------------------------------------------------------------------------
# Re-verify the entities the doc names.
#
# Extraction is done in PYTHON, not grep -oE, because the naive regexes
# over-match badly: `Codex-neon` is a fragment of the path `Codex-neon-fix`,
# and `Id-scoped` / `Warm-build` are ordinary capitalised prose that look
# exactly like a bead id. Python gives lookaheads (unavailable in portable
# grep -E) and lets the VALID BEAD PREFIX SET be discovered from bd itself
# rather than hardcoded.
# ---------------------------------------------------------------------------
export CR_BEAD_NOW="[]" CR_BRANCH_NOW="[]" CR_RUN_NOW="[]" CR_FILE_NOW="[]"

if [ "$CR_DOC_EXISTS" = true ]; then
  # Small, cheap lists — used both to discover the id prefix and as output context.
  export CR_READY="$(bd ready --json 2>/dev/null || echo '[]')"
  export CR_INPROG="$(bd list --status in_progress --json 2>/dev/null || echo '[]')"

  ENT="$(python3 -c '
import os, re, json, sys

doc = open(os.environ["CR_DOC"], encoding="utf-8", errors="replace").read()

# Every extractor below runs over `scan`, i.e. the doc MINUS §5 (Provenance) and
# §6 (Traps). Those two sections are retrospective by design: they quote entities
# as EXAMPLES of past mistakes -- "`Codex-neon` is a fragment of the path",
# "testing.yml:99999 was past EOF" -- which are not things to go and verify.
# Scanning them yields phantom drift ("bead unresolved", "file missing"), exactly
# the false alarm this script exists to prevent. A well-formed handover names
# every live entity in §0-§4, so nothing checkable is lost.
def _cut_retrospective(text):
    h5 = re.search(r"^##\s*\S?5\s", text, re.M)
    h7 = re.search(r"^##\s*\S?7\s", text, re.M)
    if h5 and h7 and h7.start() > h5.start():
        return text[:h5.start()] + text[h7.start():]
    return text[:h5.start()] if h5 else text

scan = _cut_retrospective(doc)

# --- valid bead prefixes, discovered from bd output (e.g. {"Codex"}) ---
prefixes = set()
for var in ("CR_READY", "CR_INPROG"):
    try:
        rows = json.loads(os.environ.get(var) or "[]")
        rows = rows if isinstance(rows, list) else rows.get("issues", [])
        for r in rows:
            i = r.get("id") or ""
            if "-" in i:
                prefixes.add(i.split("-", 1)[0])
    except Exception:
        pass

# --- bead ids: right prefix, and NOT a fragment of a longer hyphenated token ---
beads = []
if prefixes:
    pat = re.compile(r"\b(" + "|".join(map(re.escape, sorted(prefixes))) +
                     r")-([a-z0-9]{4,6}(?:\.[0-9]+)*)(?![-\w])")
    beads = sorted({m.group(0) for m in pat.finditer(scan)})

# --- branch names. `docs` is deliberately NOT a prefix here: docs/ is a real
#     directory in this repo and swamps the results. Path-like matches (a dotted
#     final segment, or a trailing slash) are dropped.
bpat = re.compile(r"\b(?:fix|feat|chore|epic|probe|refactor|hotfix)/[A-Za-z0-9._/-]+")
branches = set()
for m in bpat.finditer(scan):
    b = m.group(0).rstrip("`.,)*_ ")
    if b.endswith("/"):
        continue
    if re.search(r"\.[A-Za-z]{2,5}$", b.split("/")[-1]):   # looks like a filename
        continue
    branches.add(b)

# --- CI run ids (11 digits here) ---
runs = sorted({m.group(0) for m in re.finditer(r"\b3[0-9]{10}\b", scan)})

# --- file:line anchors. This is the MACHINE-CHECKABLE form the handover
#     template mandates; prose like "line 535" cannot be verified.
# Lookbehind, not \b: a leading `.` (as in `.github/...`) is not a word char, so
# \b would refuse to match there and the anchor would arrive with its dot shorn
# off — reporting a perfectly good file as missing.
apat = re.compile(r"(?<![\w./-])[.A-Za-z0-9_][A-Za-z0-9_./-]*"
                  r"\.(?:ts|tsx|js|mjs|svelte|yml|yaml|json|jsonc|sh|md|css|sql):[0-9]+")
anchors = sorted({m.group(0) for m in apat.finditer(scan)})

def emit(tag, items, cap):
    for x in items[:cap]:
        print(f"{tag}\t{x}")

emit("BEAD", beads, 14)
emit("BRANCH", sorted(branches), 10)
emit("RUN", runs, 8)
emit("ANCHOR", anchors, 14)
')"

  pick() { printf '%s\n' "$ENT" | awk -F'\t' -v t="$1" '$1==t {print $2}'; }

  # --- beads: bd returns {"error": ...} for an unknown id, i.e. a dict with no
  #     "id" key — so classify on the presence of an id, never on exit status.
  out="["; first=1
  for id in $(pick BEAD); do
    row="$(bd show "$id" --json 2>/dev/null | BD_ID="$id" python3 -c '
import sys, os, json
raw = sys.stdin.read()
out = {"id": os.environ["BD_ID"], "status_now": None, "note": "unresolved in bd"}
try:
    d = json.loads(raw)
    rows = d if isinstance(d, list) else [d]
    if rows and rows[0].get("id"):
        i = rows[0]
        t = i.get("title") or ""
        out = {"id": i.get("id"), "status_now": i.get("status"),
               "priority": i.get("priority"),
               "title": t if len(t) <= 100 else t[:97] + "..."}
except Exception:
    pass
print(json.dumps(out))
' 2>/dev/null)"
    [ -z "$row" ] && row="{\"id\":\"$id\",\"status_now\":null,\"note\":\"bd unavailable\"}"
    [ $first -eq 0 ] && out="$out,"; first=0
    out="$out$row"
  done
  export CR_BEAD_NOW="$out]"

  # --- branches ---
  out="["; first=1
  for b in $(pick BRANCH); do
    loc=false; rem=false; merged=null
    git rev-parse --verify --quiet "refs/heads/$b" >/dev/null 2>&1 && loc=true
    if git rev-parse --verify --quiet "refs/remotes/origin/$b" >/dev/null 2>&1; then
      rem=true
      if git merge-base --is-ancestor "origin/$b" origin/main 2>/dev/null; then merged=true; else merged=false; fi
    elif [ "$loc" = true ]; then
      if git merge-base --is-ancestor "$b" origin/main 2>/dev/null; then merged=true; else merged=false; fi
    fi
    [ $first -eq 0 ] && out="$out,"; first=0
    out="$out{\"branch\":\"$b\",\"exists_local\":$loc,\"exists_remote\":$rem,\"merged_into_main\":$merged}"
  done
  export CR_BRANCH_NOW="$out]"

  # --- CI runs. Report CONCLUSION; a `completed/*` glob matches `cancelled`.
  out="["; first=1
  if command -v gh >/dev/null 2>&1; then
    for r in $(pick RUN); do
      row="$(gh run view "$r" --json databaseId,event,status,conclusion,headSha 2>/dev/null | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    print(json.dumps({"id": d.get("databaseId"), "event": d.get("event"),
                      "status": d.get("status"),
                      "conclusion": d.get("conclusion") or None,
                      "sha": (d.get("headSha") or "")[:8]}))
except Exception:
    pass
' 2>/dev/null)"
      [ -z "$row" ] && row="{\"id\":$r,\"conclusion\":null,\"note\":\"not retrievable\"}"
      [ $first -eq 0 ] && out="$out,"; first=0
      out="$out$row"
    done
  fi
  export CR_RUN_NOW="$out]"

  # --- file:line anchors. Two ways an anchor lies, and a line count only
  #     catches one of them:
  #       (a) the number is past EOF          -> classic stale pointer.
  #       (b) the number is comfortably in    -> but the file being measured is
  #           range                              not the file the handover meant.
  #     (b) is the dangerous one: a handover about work merged to main, read
  #     from an unrelated branch, gets its anchors validated against bytes that
  #     never contained the anchored code. That reports a PASS meaning nothing.
  #     So check the working copy AND origin/main, and flag divergence: if the
  #     two disagree on length, every line number in that file is ref-dependent
  #     and the worktree verdict must not be trusted on its own.
  #     (origin/main, not dev: main is what shipped. Work merged to dev but not
  #     yet main shows up as divergent, which is the correct warning either way.)
  out="["; first=1
  for a in $(pick ANCHOR); do
    f="${a%:*}"; ln="${a##*:}"
    ex=false; total=0; beyond=null
    for cand in "$ROOT/$f" "$MAIN_ROOT/$f"; do
      if [ -f "$cand" ]; then
        ex=true; total="$(wc -l < "$cand" | tr -d ' ')"
        if [ "$ln" -gt "$total" ] 2>/dev/null; then beyond=true; else beyond=false; fi
        break
      fi
    done
    # The same anchor as origin/main sees it. git cat-file -e for existence so a
    # missing path is distinguished from an empty file.
    m_ex=false; m_total=0; m_beyond=null
    if git cat-file -e "origin/main:$f" 2>/dev/null; then
      m_ex=true
      m_total="$(git show "origin/main:$f" 2>/dev/null | wc -l | tr -d ' ')"
      if [ "$ln" -gt "$m_total" ] 2>/dev/null; then m_beyond=true; else m_beyond=false; fi
    fi
    div=false
    if [ "$ex" = true ] && [ "$m_ex" = true ] && [ "$total" != "$m_total" ]; then div=true; fi
    [ $first -eq 0 ] && out="$out,"; first=0
    out="$out{\"anchor\":\"$a\",\"file_exists\":$ex,\"file_lines\":$total,\"line_beyond_eof\":$beyond"
    out="$out,\"on_main\":{\"file_exists\":$m_ex,\"file_lines\":$m_total,\"line_beyond_eof\":$m_beyond}"
    out="$out,\"worktree_diverges_from_main\":$div}"
  done
  export CR_FILE_NOW="$out]"
fi

python3 -c '
import os, json, re

def js(var, default="[]"):
    try:
        return json.loads(os.environ.get(var) or default)
    except Exception:
        return json.loads(default)

def as_int(var, default=0):
    raw = (os.environ.get(var) or "").split()
    try:
        return int(raw[0]) if raw else default
    except Exception:
        return default

wts = []
for l in (os.environ.get("CR_WORKTREES") or "").splitlines():
    if not l.strip():
        continue
    m = re.match(r"^(\S+)\s+(\S+)\s+\[(.+?)\]", l)
    wts.append({"path": m.group(1), "branch": m.group(3)} if m
                else {"path": l.split()[0], "branch": ""})

fetch_age = as_int("CR_FETCH_AGE", -1)
doc = os.environ.get("CR_DOC") or None
age = as_int("CR_DOC_AGE", -1)

print(json.dumps({
  "handover": {
    "found": os.environ.get("CR_DOC_EXISTS") == "true",
    "path": doc,
    "name": os.path.basename(doc) if doc else None,
    "age_minutes": age,
    "age_human": (f"{age//60}h {age%60}m" if age >= 60 else f"{age}m") if age >= 0 else None,
    "state_word": os.environ.get("CR_DOC_STATE") or None,
    "folder": os.environ.get("CR_HD"),
  },
  "now": {
    "repo_root": os.environ.get("CR_ROOT"),
    "main_checkout": os.environ.get("CR_MAIN_ROOT"),
    "is_worktree": os.environ.get("CR_ROOT") != os.environ.get("CR_MAIN_ROOT"),
    "branch": os.environ.get("CR_BRANCH"),
    "last_sha": os.environ.get("CR_SHA"),
    "last_subject": os.environ.get("CR_SUBJ"),
    "dirty_count": as_int("CR_DIRTY_COUNT"),
    "origin_main_tip": os.environ.get("CR_MAIN_TIP"),
    "origin_dev_tip": os.environ.get("CR_DEV_TIP"),
    "last_fetch_seconds_ago": fetch_age,
    "fetch_is_stale": fetch_age < 0 or fetch_age > 900,
    "worktrees": wts,
    "open_prs": js("CR_PRS"),
  },
  "reverified": {
    "_meaning": "What is TRUE NOW for entities the handover names. Diff these against the doc.",
    "beads": js("CR_BEAD_NOW"),
    "branches": js("CR_BRANCH_NOW"),
    "ci_runs": js("CR_RUN_NOW"),
    "file_anchors": js("CR_FILE_NOW"),
  },
}, indent=2))
'
