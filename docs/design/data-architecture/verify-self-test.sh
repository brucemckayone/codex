#!/usr/bin/env bash
# Self-test for verify-actions.mjs.
#
# check.mjs has 24 probes; this script had none — and it is the one that verifies the
# architecture answer, not merely the document's internal consistency. The asymmetry was
# backwards. Each probe below asserts a property that failed for real at least once.
set -uo pipefail
cd "$(dirname "$0")"
SELF_DIR=$(pwd)
SCRIPT=verify-actions.mjs
pass=0; fail=0

check() {  # check <name> <expected-substring> <actual>
  if grep -qF "$2" <<<"$3"; then
    printf '  ok    %s\n' "$1"; pass=$((pass+1))
  else
    printf '  FAIL  %s\n         expected to find: %s\n' "$1" "$2"; fail=$((fail+1))
  fi
}

echo "=== verify-actions.mjs self-test ==="

# 1 · CWD INDEPENDENCE. `git grep -- <pathspec>` resolves relative to the caller's directory
# while `git show origin/dev:<path>` uses repo-root paths, so this script once reported VOID
# and FAILS on the two code-checkable structural proofs purely because of where it was run.
here=$(node "$SCRIPT" 2>&1)
root=$(cd "$(git rev-parse --show-toplevel)" && node "docs/design/data-architecture/$SCRIPT" 2>&1)
verdicts() { grep -oE '(HOLDS|FAILS|VOID|N/A) +[0-9]' <<<"$1" | tr '\n' ' '; }
v_here=$(verdicts "$here"); v_root=$(verdicts "$root")

if [[ "$v_here" == "$v_root" && -n "$v_here" ]]; then
  printf '  ok    identical verdicts from the doc dir and the repo root — [%s]\n' "${v_here% }"; pass=$((pass+1))
else
  printf '  FAIL  verdicts differ by directory\n         doc dir: %s\n         repo:    %s\n' \
    "$v_here" "$v_root"; fail=$((fail+1))
fi

# Outside a repository it must REFUSE, not answer. The first version of this probe expected
# identical verdicts from /tmp and reported a failure — the script was right and the probe was
# wrong. Refusing is the correct behaviour, so that is what gets asserted.
outside=$(cd /tmp && node "$SELF_DIR/$SCRIPT" 2>&1); outside_rc=$?
if [[ $outside_rc -ne 0 ]] && grep -qF 'not inside a git repository' <<<"$outside"; then
  printf '  ok    refuses to run outside a git repository (exit %d)\n' "$outside_rc"; pass=$((pass+1))
else
  printf '  FAIL  outside a repo it should exit non-zero with a clear message; got rc=%d: %s\n' \
    "$outside_rc" "${outside:0:80}"; fail=$((fail+1))
fi

# 2 · THE PROOFS CURRENTLY HOLD. If either flips, the architecture answer needs re-reading —
# that is the point of the script, so a self-test that tolerated a flip would be pointless.
check "proof 2 holds (organizationId nullable)" "HOLDS  2" "$here"
check "proof 3 holds (many-to-many twice)"      "HOLDS  3" "$here"
check "proof 5 holds (100 bound parameters)"    "HOLDS  5" "$here"
check "proof 6 holds (50-byte LIKE cap)"        "HOLDS  6" "$here"

# Both new proofs must fail SAFE, like proof 2 and 3: an unreadable file or an empty grep
# has to read as "I could not look", never as "the argument is false".
check "proof 5 has a void branch"     "check the path, not the code" "$(cat $SCRIPT)"
check "proof 6 has a void branch"     "check the pathspec" "$(cat $SCRIPT)"

# 3 · CONTROLS PRESENT. Proof 2's two controls turned a total lookup failure into "void, read
# by hand" rather than a confident wrong answer; proof 3 lacked them and said FAILS.
check "proof 2 reports its controls"  "controls: creatorId notNull" "$here"
check "proof 3 has a void branch"     "the verdict is void, not negative" "$(cat $SCRIPT)"

# 4 · SCOPE IS STATED. An earlier revision of the document quoted "six live actions" — a
# figure that came from this script's subset rather than from the action list.
check "scope line names both denominators" "of the 7 structural arguments" "$here"
check "omissions are named"              "3 PLAN" "$here"

# 5 · NO VERDICT IS EVER PRINTED AS 'DONE'. The script says DONE? deliberately: a passing
# grep is a prompt to read the code, never a conclusion.
if grep -qE "'DONE '|\"DONE \"" <<<"$(cat $SCRIPT)"; then
  printf '  FAIL  the script can print a bare "DONE" — only "DONE?" is honest\n'; fail=$((fail+1))
else
  printf '  ok    never prints a bare DONE (only DONE?)\n'; pass=$((pass+1))
fi

# 7 · THE TWO 2026-08-30 FINDINGS ARE CHECKED, NOT ASSERTED.
#
#     NEGATIVE TEST ACTUALLY RUN (2026-08-30), because a probe that cannot fail is worthless:
#       · replacing the pattern NOW()|CURRENT_TIMESTAMP|CURRENT_DATE with a string matching
#         nothing → both STABLE probes FAILED and the script printed
#         "VOID Hyperdrive/STABLE — could not read the tree; no claim either way."
#         That is the designed behaviour: an unreadable tree must never read as "zero sites".
#       · replacing "VOID   placement" → the void-branch probe FAILED.
#     A FIRST attempt was invalid and worth recording: I tried breaking the literal
#     "library.ts:706" — which appears NOWHERE in the script, because the site is DERIVED from
#     git grep -n. The sed matched nothing, the probe stayed green, and that looked like a
#     vacuous probe when it was actually the strongest possible one. Break the MECHANISM
#     (the pattern, the command), never a value the tool computes.
#
#     Both findings were made by reading
# Hyperdrive's docs; both are greppable, so the script must prove them rather than repeat them.
check "names the STABLE-function site"    "library.ts:706" "$here"
check "counts the STABLE sites"           "will not cache 1 application query" "$here"
check "checks placement"                  "placement is unset in all" "$here"
check "placement names the region form"   'aws:eu-west-2' "$here"

# 8 · THE PLACEMENT CHECK COUNTS FILES RATHER THAN QUOTING A NUMBER. The document said "ten"
# for three revisions; the real total is 11. A tool that counts cannot inherit that error.
if grep -qE "unset in all \$\{?configs" "$SCRIPT" || grep -q 'unset in all ${configs}' "$SCRIPT"; then
  printf '  ok    placement count is derived from git, not hard-coded\n'; pass=$((pass+1))
else
  printf '  FAIL  the placement file count is not derived — it can drift like the document did\n'; fail=$((fail+1))
fi

# 9 · BOTH NEW CHECKS HAVE VOID BRANCHES. An unreadable tree must read as "I could not look",
# never as "the relation is absent" — the same rule as proofs 5 and 6.
for probe in 'VOID   Hyperdrive/STABLE' 'VOID   placement'; do
  if grep -qF "$probe" "$SCRIPT"; then
    printf '  ok    void branch present: %s\n' "${probe#VOID   }"; pass=$((pass+1))
  else
    printf '  FAIL  no void branch for %s — an unreadable tree would read as a finding\n' "${probe#VOID   }"; fail=$((fail+1))
  fi
done

# 19 · FIX 4's MIGRATION CONSTRAINT IS CHECKED, NOT REMEMBERED. The document calls it "a
# constraint that grows teeth": the runner sends each file as ONE client.query(), PostgreSQL
# wraps that in an implicit transaction, and CREATE INDEX CONCURRENTLY cannot run in one — so
# it is impossible here, not merely slow. Also reports whether anything uses it yet.
check "checks the migration runner"    "ONE client.query()" "$here"
check "names what is and isn't allowed" "CONCURRENTLY is impossible" "$here"
check "reports current CONCURRENTLY use" "in packages/database today" "$here"
check "runner check has a void branch"  "VOID   migration runner" "$(cat "$SCRIPT")"

# 18 · ACTION 8 STATES BOTH SURFACES. 45 of the 85 VersionedCache constructions are in tests
# (three cache suites hold 31 between them), so 85/34 is what you EDIT and 40/24 is what SHIPS.
# Neither alone is the size of the job — the same distinction the driver check makes.
check "action 8 names the production surface" "production files" "$here"
check "action 8 names the test surface"       "counting tests" "$here"

# 17 · THE TWO SEARCH COUNTS CROSS-REFERENCE EACH OTHER. Proof 6 reports 8 (validation only,
# with a .max) and TRGM reports 12 (validation + apps/web remote). Both are right, and two bare
# numbers from one tool read as a contradiction — the same defect flagged for the driver list.
check "proof 6 names its scope"     "in packages/validation/src" "$here"
check "proof 6 points at the 12"    "TRGM line's 12" "$here"
check "TRGM names its scope"        "across validation + apps/web remote" "$here"
check "TRGM points at the 8"        "validation-only subset" "$here"

# 16 · THE PUBLIC-ENDPOINT RATIO IS DERIVED AND LOCATED. The endpoint total moved 186 -> 190
# -> 199 during this investigation, so a stated ratio here would already be stale twice over.
check "derives the public ratio"      "public read endpoints of" "$here"
check "locates the public routes"     "organization-api/src/routes/organizations.ts" "$here"
check "public ratio has a void branch" "VOID   public-endpoint ratio" "$(cat "$SCRIPT")"

# 15 · THE SEARCH-MINIMUM COUNT IS CHAIN-TOLERANT AND REPORTS THE USEFUL THRESHOLD. A literal
# grep for "search: z.string().min" reported ZERO because the two real minimums are written
# `z.string().trim().min(1)`. Both documents inherited that zero. And .min(1) rejects only the
# empty string, while pg_trgm needs THREE characters to use a trigram index — so presence of a
# call is the wrong thing to count.
check "counts minimums chain-tolerantly" "with any minimum" "$here"
check "names the trigram threshold"      "a trigram index needs" "$here"

# 14 · THE DRIVER LIST IS CLASSIFIED, AND ITS COINCIDENCE IS FLAGGED. The check derives nine
# files; the documents also say "nine files change". They are different sets of equal size, and
# an unflagged coincidence becomes a false corroboration on the next read.
check "driver list classifies files"   "THE CONSTRUCTION SITE" "$here"
check "driver list flags stale comments" "comment only" "$here"
check "driver list includes json"      "dependency declaration" "$here"
check "the different nine is flagged"  "DIFFERENT nine" "$here"

# 12 · THE LADDER COUNT REPORTS ITS SCOPES. A lone "9" here was carried into the documents and
# read as the whole ladder; it is what /^\s+(if \()?await / matches, and it excludes
# `return (await helper())` — the same call in different syntactic dress. Three scopes, always.
check "ladder names the semantic scope" "awaited checks in the ladders" "$here"
check "ladder names the bare if-form"   "in bare if-form" "$here"
check "ladder names the file total"     "awaits in the file" "$here"

# 13 · FIX 1 PRINTS THE VALUE TO COPY. It is the one item writable while CI is red, so the tool
# names the header rather than sending the reader to another worker to find it.
check "prints the Cache-Control value" "max-age=60, s-maxage=60" "$here"
check "header value has a void branch" "could not read content-api" "$(cat "$SCRIPT")"

# 11 · FIX 3's CONTAINMENT IS DERIVED, AND CODE IS DISTINGUISHED FROM COMMENTS. The first
# version of this check misread `git grep -n <rev>` output — THREE colon fields precede the
# body, not two — so the body began with a line number and both comments were reported as
# CODE, i.e. "fix 3 is wider than two expressions". A classification bug that inverts the
# conclusion is worse than no classification, so both branches are probed.
check "derives importer scopes"        "importers by scope" "$here"
check "clears the code path"           "none names a driver in CODE" "$here"
check "flags the stale comments"       "will go stale with fix 3" "$here"
check "names a comment's file:line"    "course-journey-service.ts:2937" "$here"
check "splits fields, not colons"      "slice(3).join" "$(cat "$SCRIPT")"

# 10 · THE TABLE COUNT IS DERIVED. "All 48 domain tables stay in Neon" is what the decision's
# "no schema changes" answer rests on, so it must be computed from the schema, never quoted.
check "derives the domain-table count" "domain tables (" "$here"
check "subtracts the fixture by name"  "less 1 fixture" "$here"
check "table count has a void branch"  "VOID   table count" "$(cat "$SCRIPT")"

# 6 · BASELINE IS ANNOUNCED. Every claim is relative to origin/dev; reading a stale branch is
# the failure that started this whole exercise.
check "announces its baseline" "baseline: origin/dev" "$here"

echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]] || exit 1
echo "  verify-actions.mjs is cwd-independent, controlled, and states its own scope."
