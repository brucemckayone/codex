#!/usr/bin/env bash
# scope-changeset.sh — emit the reviewable file set for codex-review.
#
# Usage:
#   scope-changeset.sh                 # working tree: uncommitted changes + untracked (default)
#   scope-changeset.sh --range A..B    # committed range (e.g. main..HEAD for a feature branch)
#   scope-changeset.sh --pr <PR#>      # files in a GitHub PR (gh pr diff)
#   scope-changeset.sh --full          # whole repo (the codebase-audit / --full sweep)
#   scope-changeset.sh --files <p>...  # explicit paths (caller expands globs)
#
# Output: one repo-relative path per line, filtered to reviewable types, dist/build excluded, sorted-unique.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

mode="worktree"; pr=""; range=""; files=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --range) mode="range"; range="${2:?--range needs A..B}"; shift 2 ;;
    --pr)    mode="pr";    pr="${2:?--pr needs a number}";   shift 2 ;;
    --full)  mode="full";  shift ;;
    --files) mode="files"; shift; while [[ $# -gt 0 && "$1" != --* ]]; do files+=("$1"); shift; done ;;
    *) echo "scope-changeset: unknown arg: $1" >&2; exit 2 ;;
  esac
done

emit_raw() {
  case "$mode" in
    worktree) git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null ;;
    range)    git diff --name-only "$range" 2>/dev/null ;;
    pr)       gh pr diff "$pr" --name-only 2>/dev/null ;;
    full)     git ls-files 2>/dev/null ;;
    files)    [[ ${#files[@]} -gt 0 ]] && printf '%s\n' "${files[@]}" ;;
  esac
}

emit_raw \
  | grep -vE '(^|/)(dist|build|node_modules|\.beads|\.dolt|\.svelte-kit|coverage)/' \
  | grep -E '\.(ts|svelte|css|sql)$|/messages/.*\.(js|json)$|\.config\.(ts|js|json)$' \
  | sort -u
