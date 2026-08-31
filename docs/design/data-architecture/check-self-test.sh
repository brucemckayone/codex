#!/usr/bin/env bash
# Prove every check in check.mjs FAILS on the defect it was written for.
#
# WHY THIS EXISTS: check.mjs once passed on a label that overflowed its canvas by
# 356 units (wrong width constant), and its retraction check silently scanned only
# the first 37KB of a 288KB document (it split at a table-of-contents mention
# instead of the section heading). Both were green for many revisions.
# A check verified only in the passing direction is an assumption with a tick next to it.
set -uo pipefail
cd "$(dirname "$0")"
pass=0; fail=0; skip=0

# ONE SNAPSHOT, taken once and verified, instead of re-reading reference.html per probe.
#
# The previous version ran `cp reference.html .t.html` inside probe(), i.e. 36 reads of a file
# that another process in this directory writes. One run reported "33 caught, 3 missed" and was
# clean on every re-run: three probes had copied a partially-written file, so their mutations
# landed on inconsistent content. That is a READ-time race — this suite never writes the source,
# so the usual restore-ordering guard does not apply. A single verified snapshot removes it, and
# is 36x less I/O besides.
if ! node check.mjs >/dev/null 2>&1; then
  printf '  ABORT  reference.html does not pass check.mjs BEFORE any probe runs.\n'
  printf '         Fix the document first — every verdict below would be meaningless.\n'
  exit 2
fi
SNAP=$(mktemp)
cp reference.html "$SNAP"
trap 'rm -f "$SNAP" .t.html' EXIT

probe () {
  cp "$SNAP" .t.html
  # The mutation MUST change the file. A str.replace that matches nothing is a silent
  # no-op: the check then runs on a clean document, passes, and the harness reports a
  # MISS when the real problem is a stale probe. Assert the change.
  if ! python3 -c "
p='.t.html'; s=open(p).read()
before=s
$2
assert s != before, 'mutation matched nothing — probe is stale'
open(p,'w').write(s)" 2>/dev/null; then
    printf '  SKIP     %s  (mutation no longer applies — update the probe)\n' "$1"; skip=$((skip+1)); rm -f .t.html; return
  fi
  # check.mjs takes a path argument, so no sed-rewriting of the checker is needed.
  if node check.mjs ./.t.html >/dev/null 2>&1; then
    printf '  ✗ MISS   %s  — check PASSED on a known defect\n' "$1"; fail=$((fail+1))
  else
    printf '  ✓ caught %s\n' "$1"; pass=$((pass+1))
  fi
  rm -f .t.html
}

echo "self-test: each probe injects one real defect; the checker must reject it"
echo

# structure
probe "unclosed <div>"          "s=s.replace('<div class=\"box good\">','<div class=\"box good\"><div>',1)"
probe "dead anchor"             "s=s.replace('href=\"#seq\"','href=\"#no-such-section\"',1)"
probe "duplicate id"            "s=s.replace('<h2 id=\"alts\"','<h2 id=\"seq\"',1)"
# action identity
probe "action key removed"      "s=s.replace('<code>TYPESPLIT</code>','<code>TYPESPLIT_X</code>')"
probe "one-pager row dropped"   "import re; m=re.search(r'<tr><td class=\"num\">7</td>.*?</tr>', s, re.S); s=s[:m.start()]+s[m.end():]"
# retractions — must be detected ANYWHERE before §07.1, not just near the top
probe "retraction leaks (early)" "s=s.replace('<h2 id=\"cost\"','<p>course-journey-service.ts:894</p><h2 id=\"cost\"',1)"
probe "retraction leaks (late)"  "s=s.replace('<h2 id=\"alts\"','<p>course-journey-service.ts:894</p><h2 id=\"alts\"',1)"
# superseded figures
probe "stale '4 files'"          "s=s.replace('<h2 id=\"tenancy\"','<p>The swap touches 4 files.</p><h2 id=\"tenancy\"',1)"
probe "stale '32 sites'"         "s=s.replace('<h2 id=\"tenancy\"','<p>There are 32 sites.</p><h2 id=\"tenancy\"',1)"
probe "stale '8 subrequests'"    "s=s.replace('<h2 id=\"tenancy\"','<p>There are 8 subrequests.</p><h2 id=\"tenancy\"',1)"
probe "stale '186' endpoints"    "s=s.replace('<h2 id=\"tenancy\"','<p>All 186 endpoints.</p><h2 id=\"tenancy\"',1)"
# compensating errors — the case that fooled every arithmetic check.
# +1 open (a box nested in an identical box, v140) and +1 close (a stray </div> left by a
# move, v152) leaves divs 139/139 and depth 0. Only the SHAPE check can see it.
probe "compensating errors (counts stay balanced)" "s=s.replace('<div class=\"box bad\">\n  <p class=\"t\">Will this actually reduce the bill?','<div class=\"box bad\">\n  <div class=\"box bad\">\n  <p class=\"t\">Will this actually reduce the bill?',1); s=s.replace('<h2 id=\"alts\"','</div>\n<h2 id=\"alts\"',1)"

# stated counts vs the table — a revision claimed "six live actions" when eight remained.
probe "stated live-action count is wrong" "s=s.replace('<strong>Seven live actions, none architectural</strong>','<strong>Six live actions, none architectural</strong>',1)"

# subsection label vs location — a CORRESPONDENCE defect: each part valid, relationship wrong.
probe "subsection label ≠ its section" "import re
for i in range(1,6):
    s=s.replace(f'<h3 id=\"sA6-{i}\">A6.{i}', f'<h3 id=\"sA2-{i}\">A2.{i}')
    s=s.replace(f'href=\"#sA6-{i}\"', f'href=\"#sA2-{i}\"')"

# landed action vs its acceptance criterion — criteria lagged their specs five times.
probe "criterion lags a LANDED action" "import re
i=s.index('05.2 · Acceptance criteria'); j=s.index('</table>', i)
seg=s[i:j]
m=re.search(r'(<td class=\"num\">1</td><td>).*?(</td>)', seg, re.S)
seg=seg[:m.start()]+m.group(1)+'A forced KV write failure produces an operator-visible signal.'+m.group(2)+seg[m.end():]
s=s[:i]+seg+s[j:]"

# derived retraction count — counts lagged SEVEN times, each in a phrasing the checker
# did not know. This one derives the truth from the retraction table instead of a list.
probe "stale retraction total" "s=s.replace('<strong>Six</strong> earlier recommendations were already done','Five earlier recommendations were already done',1)"

# superlative in a §03 argument cell — the seven arguments were overstated three times.
probe "superlative reintroduced in an argument" "s=s.replace('<td><strong>D1 bindings are static.</strong>','<td><strong>D1 bindings are static, so per-org D1 is impossible.</strong>',1)"

# a table that no longer matches its stated count — §A2 surfaced this class.
probe "table row count vs stated total" "import re
i=s.index('Seven independent arguments'); ts=s.index('<table', i); te=s.index('</table>', ts)
body=s[ts:te]
m=re.search(r'<tr><td rowspan=\"4\"[\s\S]*?</tr>', body)
body=body[:m.start()]+body[m.end():]
s=s[:ts]+body+s[te:]"

# an unwrapped table — horizontal page scroll, invisible without a browser.
probe "table missing its .tw scroll wrapper" "i=s.index('<div class=\"tw\">')
s=s[:i]+s[i+len('<div class=\"tw\">'):]
j=s.index('</table>', i)
k=s.index('</div>', j)
s=s[:k]+s[k+len('</div>'):]"

# contents order diverging from document order — a set check misses this entirely.
probe "TOC order vs document order" "a='<a href=\"#s07-0b\" class=\"tsub\" title=\"Already correct — ten things this investigation checked and did not change\">0b</a> '
b='<a href=\"#s07-0c\" class=\"tsub\" title=\"The check that found the most — read the limits page of everything you recommend\">0c</a> '
s=s.replace(a+b, b+a, 1)"

# a heading with no contents entry at all.
probe "heading missing from the contents" "import re
s=re.sub(r'<a href=\"#s07-0b\" class=\"tsub\"[^>]*>0b</a> ', '', s, count=1)"

# a swapped number->key binding — the presence check alone cannot see this.
probe "action key bound to the wrong number" "i=s.index('Action key — resolve any')
ts=s.index('<table', i); te=s.index('</table>', ts)
b=s[ts:te]
b=b.replace('<code>PLAN</code>','<code>TMP</code>',1).replace('<code>WAITUNTIL</code>','<code>PLAN</code>',1).replace('<code>TMP</code>','<code>WAITUNTIL</code>',1)
s=s[:ts]+b+s[te:]"

# a hard-coded probe count in the document — the scripts report their own totals.
probe "probe count hard-coded in the prose" "s=s.replace('one real defect at a time','24 real defects one at a time',1)"

# a typo'd class name — renders unstyled, invisible to every other check.
probe "class used but never defined" "s=s.replace('class=\"lede\"','class=\"leed\"',1)"

# a dead CSS rule — usually the fossil of something removed.
probe "class defined but never used" "s=s.replace('.tny{', '.ghost{color:red}\n.tny{', 1)"

# a typo'd custom property — the declaration is silently dropped.
probe "var() referencing an undefined property" "s=s.replace('var(--accent)','var(--acccent)',1)"

# the action-6 gate stripped from a row — it went missing once for real.
probe "Hyperdrive swap described without its gate" "a='— <strong>but free-tier Hyperdrive caps database queries at 100,000/day and <em>fails</em> past it</strong>, about 3,200 renders at ~31 statements each, so this is gated on <strong>action 3</strong> (§05.4).'
s=s.replace(a,'.',1)"

# pre without overflow-x — a 109-char code line would scroll the whole page.
# Written after an ad-hoc version of this test passed silently because its mutation matched
# nothing: the rule ALREADY had overflow-x:auto, a truncated grep hid it, and the "fix" then
# corrupted the padding. The probe() harness asserts s != before, which is what caught it.
probe "pre missing overflow-x" "s=s.replace('padding:1rem 1.1rem; overflow-x:auto; max-width:100%;','padding:1rem 1.1rem;',1)"

# two live numbers for one quantity — the ~24 / ~31 drift, in each of the two forms the
# document uses. Both are probed because the check accepts a tilde-prefixed bare number and a
# number-plus-unit, and an earlier revision of it matched only one of them.
probe "one quantity, two numbers (summary line)" "s=s.replace('~31 statements per landing render at 81 ms each','~24 statements per landing render at 81 ms each',1)"
probe "one quantity, two numbers (unit form)" "s=s.replace('~31 statements per render','~24 statements per render',1)"

# a constant drifting to a value outside its allowed set (the 730 → 720 month-length slip).
probe "constant outside its allowed set" "s=s.replace('min CU × 730','min CU × 720',1)"

# a contents tooltip describing a different section — #s05-1a's did, for several revisions.
probe "TOC tooltip vs its heading" "s=s.replace('title=\"How to actually run the gate\"','title=\"Cost model assumptions\"',1)"

# a heading stating a count that no longer matches the list under it — §02.3 read
# "Six hazard classes" over a list of ten, and its TOOLTIP matched the heading, so the
# tooltip-vs-heading probe passed on both being stale.
probe "heading count vs the list it heads" "s=s.replace('02.3 · Hazard classes, abstracted','02.3 · Six hazard classes, abstracted',1)"

# the hazard-class box losing its stable id — three ad-hoc checks this session anchored on
# prose instead and silently measured a different list.
probe "hazard-class box id removed" "s=s.replace(' id=\"hazard-classes\"','',1)"

# svg overflow — the full string that actually shipped
probe "svg label overflow"       "s=s.replace('>Up to 13 subrequests per landing view — 4 in the org layout (getVersion ×3) + 7 in the page.</text>','>Up to 13 subrequests per landing view — 4 in the org layout (getVersion runs 3×) + 7 in the page. Verified on dev, 2026-08-30; an earlier revision said 8.</text>',1)"
probe "svg label below viewBox"  "s=s.replace('<text x=\"180\" y=\"522\"','<text x=\"180\" y=\"999\"',1)"

# TORN-READ GUARD. Another process writes reference.html; three times today a checker read it
# mid-write and printed a real-looking structural defect. The guard must fire on a truncated
# file (exit 3) and must NOT swallow a genuine defect (exit 1) — both directions are probed,
# because a guard that catches everything is indistinguishable from a broken checker.
cp "$SNAP" .t.html
python3 -c "s=open('.t.html').read(); open('.t.html','w').write(s[:len(s)//2])"
node check.mjs ./.t.html >/dev/null 2>&1; rc=$?
if [[ $rc -eq 3 ]]; then
  printf '  ✓ caught %s\n' 'a torn read reports TORN (exit 3), not a structural defect'; pass=$((pass+1))
else
  printf '  ✗ MISS   a truncated file exited %s, expected 3 — it will read as a real defect\n' "$rc"; fail=$((fail+1))
fi
cp "$SNAP" .t.html
python3 -c "
s=open('.t.html').read()
s=s.replace('</p>','',1)
open('.t.html','w').write(s)"
node check.mjs ./.t.html >/dev/null 2>&1; rc=$?
if [[ $rc -eq 1 ]]; then
  printf '  ✓ caught %s\n' 'a real defect still exits 1 — the torn guard does not mask it'; pass=$((pass+1))
else
  printf '  ✗ MISS   a real defect exited %s, expected 1 — the torn guard may be swallowing it\n' "$rc"; fail=$((fail+1))
fi
rm -f .t.html

echo
printf '  %d caught, %d missed, %d skipped\n' "$pass" "$fail" "$skip"
[ "$fail" -eq 0 ] || { echo "  A MISS means check.mjs cannot see that defect. Fix the check, not the probe."; exit 1; }
echo "  check.mjs rejects every defect it claims to cover."
