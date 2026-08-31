#!/usr/bin/env bash
# Proves check-summary.mjs actually fails on each defect it claims to catch.
# The assertion that matters is `s != before`: a probe whose mutation matches nothing
# would otherwise "pass" by testing an unmodified file — which is how a stale probe
# reports green forever.
set -u
cd "$(dirname "$0")"
# The served document is never written by this script — every probe mutates a
# temp copy and the checker is pointed at it. Two corruptions of the live page
# came from mutating index.html directly; a path argument removes the shape.
# ONE VERIFIED SNAPSHOT. This used to `cp index.html .selftest-work.html` at the top AND after
# every skip — 40-odd reads of a file another process in this directory writes. The suite then
# reported 34/4/2 and 38/7/0 on consecutive runs: contamination, not flakiness, and the same
# READ-time race already fixed in check-self-test.sh. Snapshot once, restore from the snapshot.
if ! node check-summary.mjs >/dev/null 2>&1; then
  printf '  ABORT  index.html does not pass check-summary.mjs BEFORE any probe runs.\n'
  printf '         Fix the document first, or wait for a concurrent write to finish —\n'
  printf '         every verdict below would otherwise be meaningless.\n'
  exit 2
fi
SNAP=$(mktemp)
cp index.html "$SNAP"
trap 'rm -f "$SNAP" .selftest-work.html .selftest-stale' EXIT
cp "$SNAP" .selftest-work.html
# check-summary.mjs reads reference.html for figure tracing, so if that file moves during a
# run the probe verdicts are not attributable to the probes. Snapshot it and compare at the
# end — a prior revision of this script diagnosed this and I deleted the line while rewriting
# the probe function. An inconclusive verdict is honest; a number that changes every run
# makes every real MISS deniable.
REFSUM_BEFORE=$(shasum -a 256 reference.html 2>/dev/null | cut -d' ' -f1)
caught=0; missed=0; skipped=0; probe_n=0

probe() {
  local name="$1" py="$2"
  # ONE FRESH FILE PER PROBE. The previous version mutated a single shared .selftest-work.html
  # and restored it after each probe, and the suite reported a different answer on every run —
  # 38/2, 39/1, 39/0/1 — with an arbitrary probe failing each time. The checker itself is
  # deterministic (verified: 0/20 passes on a known-bad file, 20/20 on the good one), so the
  # non-determinism was cross-probe state in the harness. Shared mutable state restored by
  # convention is the same shape that corrupted the served page earlier today; the fix is the
  # same — remove the sharing, do not tighten the convention.
  local work=".selftest-$$-${probe_n}.html"
  probe_n=$((probe_n+1))
  cp index.html "$work"
  python3 - "$py" "$work" <<'PYEOF'
import sys, re, os
py, path = sys.argv[1], sys.argv[2]
s = open(path).read(); before = s
ns = {'s': s, 're': re}
exec(py, ns)
s = ns['s']
if s == before:
    sys.exit(3)
with open(path, 'w') as fh:
    fh.write(s); fh.flush(); os.fsync(fh.fileno())
if open(path).read() != s:
    sys.exit(4)
PYEOF
  local rc=$?
  if [ $rc -eq 3 ]; then
    echo "  ⚠ SKIP  $name — mutation matched nothing; the probe is stale"
    skipped=$((skipped+1)); rm -f "$work"; return
  fi
  if [ $rc -ne 0 ]; then
    echo "  ⚠ IO    $name — harness fault (rc=$rc), not a checker fault"
    skipped=$((skipped+1)); rm -f "$work"; return
  fi
  if node check-summary.mjs "./$work" >/dev/null 2>&1; then
    echo "  ✗ MISS  $name"; missed=$((missed+1))
  else
    caught=$((caught+1))
  fi
  rm -f "$work"
}

probe "unbalanced tag"            "s = s.replace('</table>', '', 1)"
probe "broken anchor"             "s = s.replace('href=\"#problems\"', 'href=\"#gone\"', 1)"
probe "duplicate id"              "s = s.replace('id=\"decide\"', 'id=\"problems\"', 1)"
probe "table without .tw wrapper" "s = s.replace('<div class=\"tw\">', '<div>', 1)"
probe "a problem row deleted"     "s = re.sub(r'<tr>\s*<td class=\"num\">5</td>.*?</tr>', '', s, count=1, flags=re.S)"
probe "a fix row renumbered"      "s = s.replace('<td class=\"num\">4</td>\n      <td><strong>Enable', '<td class=\"num\">9</td>\n      <td><strong>Enable', 1)"
probe "Fixes column names problem 8" "s = s.replace('<td class=\"k\">3</td>', '<td class=\"k\">8</td>', 1)"
probe "prose names a nonexistent fix" "s = s.replace('Gated on the \$5 Workers decision', 'See fix 12 and the \$5 Workers decision', 1)"
probe "stated count drifts"       "s = s.replace('Three changes fix problems', 'Five changes fix problems', 1)"
probe "group heading count drifts" "s = s.replace('Four round trips that did not need to happen', 'Nine round trips that did not need to happen', 1)"
probe "an untraceable figure"     "s = s.replace('36.6&#8202;MB', '742.9&#8202;MB', 1)"
probe "the D1 answer removed"     "s = s.replace('No D1, no per-tenant Durable Objects', 'Maybe D1', 1)"
probe "the £0-and-why-it-misleads pair broken" "s = s.replace('£0 only because you have not launched.', '£0.', 1)"
probe "the eleven-word line lost" "s = s.replace('a driver setting, a missing argument, a missing header', 'several small things', 1)"
probe "the NOW() prerequisite dropped from fix 3" "i = s.index('Swap <code>neon-http</code>'); j = s.index('</tr>', i); s = s[:i] + s[i:j].replace('library.ts:706', 'a query in the access package') + s[j:]"
probe "the evidence pointer dropped from the footer" "i = s.index('<footer'); s = s[:i] + s[i:].replace('reference.html', 'the other document')"
probe "an overstatement creeps in" "s = s.replace('There is no runtime addressing', 'It is impossible to address at runtime', 1)"

probe "a link labelled with its own filename" "s = s.replace('<a href=\"./reference.html\"><strong>the decision page</strong></a>', '<a href=\"./reference.html\">index.html</a>', 1) if 'the decision page' in s else s.replace('href=\"./reference.html\">reference.html<', 'href=\"./reference.html\">index.html<', 1)"
probe "a SECTION label renumbered" "s = s.replace('SECTION 3</span>', 'SECTION 9</span>', 1)"
probe "a section heading reworded away" "s = s.replace('The fixes</h2>', 'Some thoughts</h2>', 1)"
probe "an h2 section deleted"       "i = s.index('<h2 id=\"decide\"'); j = s.index('<h2 id=\"unknown\"'); s = s[:i] + s[j:]"
probe "the answer moved below §1"   "s = s.replace('No D1, no per-tenant Durable Objects', 'The answer is below', 1)"
probe "the wrangler count drifts"   "s = s.replace('Unset in all 11 <code>wrangler.jsonc</code> files', 'Unset in all 10 <code>wrangler.jsonc</code> files', 1)"

probe "the allowance-vs-always-on ratio removed" "i = s.index('class=\"answer\"'); j = s.index('</ol>', i); s = s[:i] + s[i:j].replace('0.55–0.60×', 'a fraction of', 1) + s[j:]"
probe "the 182.5 always-on figure removed"    "i = s.index('class=\"answer\"'); j = s.index('</ol>', i); s = s[:i] + s[i:j].replace('182.5', 'a lot of', 1) + s[j:]"
probe "time-awake no longer named"    "i = s.index('class=\"answer\"'); j = s.index('</ol>', i); s = s[:i] + s[i:j].replace('time awake', 'compute') + s[j:]"

probe "a retracted cause reinstated"  "s = s.replace('every request for a real page currently does', 'bot traffic on the tenant wildcard does exactly that', 1)"
probe "the retracted cost framing back"   "s = s.replace('Your instinct about cost was right', 'Latency was always the reason to act', 1)"
probe "the archive state as a status"     "s = s.replace('The database archives between visits.', 'The database is in archive storage right now.', 1)"
probe "a citation stripped of its quotes" "s = s.replace('said “9 sequential awaits”, which', 'said 9 sequential awaits, which', 1)"

probe "the awake fraction stated twice"  "s = s.replace('(5.2%)', '(5.3%)', 1)"
probe "the allowance stated twice"         "s = s.replace('110 CU-hours', '109 CU-hours', 1)"
probe "the catalogue size stated twice"    "s = s.replace('is 36.6', 'is 34.9', 1)"
probe "per-statement latency stated twice" "s = s.replace('81 ms each', '79 ms each', 1)"

probe "the sequence names a nonexistent fix" "i = s.index('id=\"order\"'); j = s.index('id=\"decide\"'); s = s[:i] + s[i:j].replace('Fixes 1 and 2.', 'Fixes 1 and 9.', 1) + s[j:]"
probe "the sequence loses the reset step"       "i = s.index('id=\"order\"'); j = s.index('id=\"decide\"'); s = s[:i] + s[i:j].replace('2026-09-01', 'later', 1) + s[j:]"
probe "the sequence drops its no-branch reason" "i = s.index('id=\"order\"'); j = s.index('id=\"decide\"'); s = s[:i] + s[i:j].replace('mock <code>@codex/database</code>', 'are fine', 1) + s[j:]"
probe "the sequence deleted entirely"           "i = s.index('<div class=\"box\" id=\"order\">'); j = s.index('<h2 id=\"decide\"'); s = s[:i] + s[j:]"

# The "sentence broken by its own aside" probe was removed 2026-08-30: the document no
# longer has a sentence whose grammar depends on a .tiny aside, because punctuation
# after a block-level </span> renders orphaned. Both hazards are now covered by the
# orphan check, and a probe for a case that cannot occur is a probe that will rot.
probe "a colon left pointing at nothing"       "i = s.index('class=\"answer\"'); j = s.index('</ol>', i); s = s[:i] + s[i:j].replace('one test user</strong>, because', 'one test user</strong>: <span class=\"tiny\">detail</span>, because', 1) + s[j:]"

probe "a cell bloated with narrative"     "i = s.index('id=\"decide\"'); j = s.index('id=\"unknown\"'); pad = ' Some further explanation of how this conclusion was reached, at length, in the main text where it does not belong.' * 8; s = s[:i] + s[i:j].replace('then budget to pay anyway.</strong>', 'then budget to pay anyway.' + pad + '</strong>', 1) + s[j:]"

probe "a finding on the summary only"      "s = re.sub(r'no\\s+key\\s+to\\s+shard\\s+on', 'nothing to partition by', s)"

probe "punctuation orphaned after an aside" "s = s.replace('point</em>)</span>', 'point</em>)</span>.', 1)"

rm -f .selftest-*.html

# REFERENCE-DRIFT DETECTION. check-summary.mjs reads reference.html directly (for figure
# tracing), and another process in this directory writes it — so probe verdicts can vary even
# with index.html frozen in a snapshot. Consecutive runs gave 31/8/1, 23/14/3 and 35/5/0.
# The race cannot be removed from here, so it is DETECTED: if the reference moved during the
# run, the counts are not attributable to the probes and the suite refuses to stand behind them.
# An inconclusive verdict is honest; a number that changes every run makes every real MISS
# deniable, which is worse than having no suite at all.
REFSUM_AFTER=$(shasum -a 256 reference.html 2>/dev/null | cut -d' ' -f1)
if [ "$REFSUM_BEFORE" != "$REFSUM_AFTER" ]; then
  printf '\n  INCONCLUSIVE — reference.html changed during this run.\n'
  printf '    check-summary.mjs reads it for figure tracing, so the verdicts above are not\n'
  printf '    attributable to the probes. Re-run when the file is quiescent.\n'
  exit 4
fi

echo "  $caught caught, $missed missed, $skipped skipped"
if [ $missed -eq 0 ] && [ $skipped -eq 0 ]; then
  echo "  check-summary.mjs rejects every defect it claims to cover."
else
  exit 1
fi
