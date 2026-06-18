#!/usr/bin/env bash
# detect-bypass.sh — scan recent commits for explicit gate-bypass evidence.
#
# Honest about limits: a past `git commit --no-verify` leaves no durable trace, so this flags only what
# IS detectable post-hoc — bypass markers in commit messages, and signed->unsigned regressions when the
# range established signing. It intentionally does NOT flag plain merges or unsigned commits in repos
# that never sign (avoids false positives).
#
# Usage:
#   detect-bypass.sh                # last 20 commits on current branch
#   detect-bypass.sh --range A..B   # arbitrary range (e.g. main..HEAD)
#
# Output: <severity>\t<sha>\t<rule>\t<evidence>  (one per line). EMPTY output == clean.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

range=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --range) range="${2:?--range needs A..B}"; shift 2 ;;
    *) echo "detect-bypass: unknown arg: $1" >&2; exit 2 ;;
  esac
done

# NOTE: macOS ships Bash 3.2 (no `mapfile`/`readarray`) — use a portable while-read loop.
commits=()
if [[ -n "$range" ]]; then
  while IFS= read -r line; do commits+=("$line"); done < <(git log --format='%H' "$range" 2>/dev/null)
else
  while IFS= read -r line; do commits+=("$line"); done < <(git log --format='%H' -n 20 2>/dev/null)
fi

# Establish whether signing is in use across the range (any good/expired sig => baseline=signed).
baseline_signed=0
for sha in "${commits[@]}"; do
  [[ -z "$sha" ]] && continue
  case "$(git show -s --format='%G?' "$sha" 2>/dev/null)" in G|U|X|E) baseline_signed=1; break ;; esac
done

for sha in "${commits[@]}"; do
  [[ -z "$sha" ]] && continue
  subj="$(git show -s --format='%s' "$sha" 2>/dev/null)"
  sig="$(git show -s --format='%G?' "$sha" 2>/dev/null)"
  short="${sha:0:9}"

  if grep -qiE '\-\-no-verify|\[skip ci\]|skip-ci|no-?gpg-sign' <<<"$subj"; then
    printf 'high\t%s\tbypass-marker\t%s\n' "$short" "$subj"
  fi
  if [[ "$baseline_signed" -eq 1 && "$sig" == "N" ]]; then
    printf 'medium\t%s\tsigning-regression\t%s\n' "$short" "$subj"
  fi
done
