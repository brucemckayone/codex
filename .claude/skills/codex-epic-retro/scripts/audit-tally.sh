#!/usr/bin/env bash
# audit-tally.sh — measure cycle discipline: tally codex-epic-implement stage entries +
# codex-review swarm entries per WP in an epic, from .beads/interactions.jsonl (kind=tool_call).
#
# A WP showing < 10/10 stages or no swarm-start/end is a DRIFT signal the retro must explain.
#
# PRIMARY source = the bd-audit trail (.beads/interactions.jsonl). When that trail is empty or partial
# for the epic, this script FALLS BACK to the git commit trail as a cross-check, so a future retro is
# NEVER blind even if per-stage emission was skipped (the Codex-69t7c lesson — bead Codex-3l73h).
# The git-trail is a CROSS-CHECK, not a substitute: it cannot prove the 10 gates ran, only that a WP
# shipped (a `feat/test/...: WP-N` commit), was review-fixed (a trailing `fix(...): WP-N … review`
# commit), and merged (a trailing `(#PR)` ref). The bd-audit columns stay authoritative.
#
# Usage:   audit-tally.sh <epic-id>          # all WPs (epic-id and epic-id.*)
#          audit-tally.sh --task <wp-id>      # a single WP
# Env:     GIT_TRAIL_RANGE=<git-range>        # scope the git-trail fallback explicitly
#                                             #   (e.g. origin/dev~13..origin/dev) — use for OLDER epics.
#                                             #   Default: the most recent contiguous run of WP commits.
#          GIT_TRAIL_GAP=<n>                  # non-WP commits that break the contiguous run (default 3)
#          GIT_TRAIL_SCAN=<n>                 # commits to scan when no range is given (default 400)
#          GIT_TRAIL=0                         # disable the git-trail fallback entirely
# Output:  TSV  <wp-id>\t<n>/10 stages\tstart:<k>\tend:<k>\t<complete|partial|missing>\tgit-trail:<c>c/<f>fix[/PRs]
#          The git-trail column is APPENDED; the first five fields are unchanged from before.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
[[ -f .beads/interactions.jsonl ]] || { echo "no .beads/interactions.jsonl" >&2; exit 1; }

mode="epic"; target=""
case "${1:-}" in
  --task) mode="task"; target="${2:?--task needs a wp id}" ;;
  "")     echo "usage: audit-tally.sh <epic-id> | --task <wp-id>" >&2; exit 2 ;;
  *)      target="$1" ;;
esac

# --- git-trail fallback: extract the WP commit topology -----------------------------------------
# Emits TSV  wp-num<TAB>commits<TAB>fixes<TAB>review-fixes<TAB>pr-refs  (one row per WP number).
# Commit subjects carry `WP-N`, not the bd epic id, so by default we take the most recent CONTIGUOUS
# block of WP-tagged commits (the epic that just shipped). Override precisely with GIT_TRAIL_RANGE.
GIT_TRAIL="${GIT_TRAIL:-1}"
git_trail() {
  [[ "$GIT_TRAIL" != "0" ]] || return 0
  command -v git >/dev/null 2>&1 || return 0
  local range="${GIT_TRAIL_RANGE:-}" log
  if [[ -n "$range" ]]; then
    log="$(git log --no-merges --format='%H%x09%s' "$range" 2>/dev/null)" || return 0
  else
    log="$(git log --no-merges --format='%H%x09%s' -"${GIT_TRAIL_SCAN:-400}" 2>/dev/null)" || return 0
  fi
  [[ -n "$log" ]] || return 0
  GIT_TRAIL_GAP="${GIT_TRAIL_GAP:-3}" GTR="$range" python3 -c '
import os, re, sys
gap_limit = int(os.environ.get("GIT_TRAIL_GAP", "3"))
explicit  = bool(os.environ.get("GTR", ""))
wp_re  = re.compile(r"\bWP[ ._-]?(\d+)", re.I)
pr_re  = re.compile(r"#(\d+)")
fix_re = re.compile(r"^fix\b", re.I)        # fix(...): … → a follow-up commit
rev_re = re.compile(r"review", re.I)        # … review … → driven by codex-review findings
rows = [l.split("\t", 1) for l in sys.stdin.read().splitlines() if "\t" in l]
# rows are newest-first (git log default). Skip leading non-WP commits (e.g. the retro/docs commit),
# then collect the first contiguous WP run; a gap of > gap_limit non-WP commits ends the block.
# With an explicit range, keep every WP commit in range (no contiguity trimming).
block, seen_wp, gap = [], False, 0
for _h, subj in rows:
    if wp_re.search(subj):
        seen_wp, gap = True, 0
        block.append(subj)
    else:
        if not seen_wp:
            continue
        if explicit:
            continue
        gap += 1
        if gap > gap_limit:
            break
agg = {}   # wp-num -> [commits, fixes, review_fixes, set(prs)]
for subj in block:
    m = wp_re.search(subj)
    if not m:
        continue
    n = m.group(1)
    a = agg.setdefault(n, [0, 0, 0, set()])
    a[0] += 1
    if fix_re.search(subj):
        a[1] += 1
        if rev_re.search(subj):
            a[2] += 1
    prs = pr_re.findall(subj)
    if prs:
        a[3].add(prs[-1])     # the TRAILING #NNN is the squash-merge ref
for n in sorted(agg, key=lambda x: int(x)):
    c, f, rf, prs = agg[n]
    pr = ",".join("#" + p for p in sorted(prs, key=int))
    sys.stdout.write("\t".join([n, str(c), str(f), str(rf), pr]) + "\n")
' <<<"$log"
}

GIT_TRAIL_TSV="$(git_trail)"

EPIC="$target" MODE="$mode" GIT_TRAIL_TSV="$GIT_TRAIL_TSV" python3 -c '
import os, json, re, collections
epic=os.environ["EPIC"]; mode=os.environ["MODE"]
def inscope(iid):
    if not iid: return False
    return iid==epic if mode=="task" else (iid==epic or iid.startswith(epic+"."))
stages=collections.defaultdict(set); ss=collections.defaultdict(int); se=collections.defaultdict(int)
for line in open(".beads/interactions.jsonl"):
    line=line.strip()
    if not line: continue
    try: o=json.loads(line)
    except Exception: continue
    if o.get("kind")!="tool_call" or not inscope(o.get("issue_id")): continue
    iid=o["issue_id"]; p=o.get("prompt","") or ""; t=o.get("tool_name","") or ""
    m=re.match(r"stage-(\d+)\b", p)
    if t=="codex-epic-implement" and m: stages[iid].add(int(m.group(1)))
    if t=="codex-review" and p.startswith("swarm-start"): ss[iid]+=1
    if t=="codex-review" and p.startswith("swarm-end"):   se[iid]+=1

# --- git-trail cross-check, keyed by WP number ---
git_rows={}
for line in (os.environ.get("GIT_TRAIL_TSV") or "").splitlines():
    parts=line.split("\t")
    if len(parts)<5: continue
    git_rows[parts[0]]={"c":parts[1],"f":parts[2],"rf":parts[3],"prs":parts[4]}
def git_col(num):
    g=git_rows.get(str(num))
    if not g: return "git-trail:-"
    s="git-trail:"+g["c"]+"c/"+g["rf"]+"fix"
    if g["prs"]: s+="/"+g["prs"]
    return s
def wp_num(iid):
    m=re.search(r"\.(\d+)$", iid or "")   # Codex-69t7c.9 -> "9"; bare epic id -> ""
    return m.group(1) if m else ""

ids=sorted(set(list(stages)+list(ss)+list(se)))
if not ids:
    if git_rows:
        # bd-audit empty → reconstruct the WP list FROM the git trail so the retro is not blind.
        print("(no bd-audit entries for %s — falling back to the git commit trail; "
              "columns are a CROSS-CHECK, NOT proof the 10 gates ran)" % epic)
        for num in sorted(git_rows, key=lambda x:int(x)):
            print("%s.%s\t0/10 stages\tstart:0\tend:0\tmissing\t%s" % (epic, num, git_col(num)))
    else:
        print("(no codex audit entries for %s — cycle not run, or audit discipline skipped; "
              "no WP commit trail found either)" % epic)
else:
    for iid in ids:
        n=len(stages[iid])
        marker = "complete" if (n>=10 and ss[iid]>=1 and se[iid]>=1) else ("missing" if n==0 else "partial")
        print("%s\t%d/10 stages\tstart:%d\tend:%d\t%s\t%s" % (iid, n, ss[iid], se[iid], marker, git_col(wp_num(iid))))
    # surface git-trail WPs that the bd-audit trail missed entirely (so they are never invisible).
    seen={wp_num(i) for i in ids}
    for num in sorted([n for n in git_rows if n not in seen], key=lambda x:int(x)):
        print("%s.%s\t0/10 stages\tstart:0\tend:0\tmissing\t%s" % (epic, num, git_col(num)))
'
