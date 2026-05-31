#!/usr/bin/env bash
# audit-tally.sh — measure cycle discipline: tally codex-epic-implement stage entries +
# codex-review swarm entries per WP in an epic, from .beads/interactions.jsonl (kind=tool_call).
#
# A WP showing < 10/10 stages or no swarm-start/end is a DRIFT signal the retro must explain.
#
# Usage:   audit-tally.sh <epic-id>          # all WPs (epic-id and epic-id.*)
#          audit-tally.sh --task <wp-id>      # a single WP
# Output:  TSV  <wp-id>\t<n>/10 stages\tstart:<k>\tend:<k>\t<complete|partial|missing>
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

EPIC="$target" MODE="$mode" python3 -c '
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
ids=sorted(set(list(stages)+list(ss)+list(se)))
if not ids:
    print("(no codex audit entries for %s — cycle not run, or audit discipline skipped)"%epic)
for iid in ids:
    n=len(stages[iid])
    marker = "complete" if (n>=10 and ss[iid]>=1 and se[iid]>=1) else ("missing" if n==0 else "partial")
    print(f"{iid}\t{n}/10 stages\tstart:{ss[iid]}\tend:{se[iid]}\t{marker}")
'
