// Consistency checker for index.html — the decision page. Run: node check-summary.mjs
//
// Its one important job: every figure on the decision page must also appear in
// reference.html. The summary was written FROM the reference, so a number here that is
// absent there is either a typo or a figure I invented while compressing — and a wrong
// number in the short document is worse than a wrong number in the long one, because the
// short one is the document people act on.
import { readFileSync } from 'node:fs';

// The document to check. Defaults to the served index.html, but the self-test passes a
// TEMP COPY: it mutates the file 25 times to prove each probe bites, and doing that to the
// served document is a shape where a mid-run read — or a failed restore — publishes a
// corrupted page. It has happened twice. The fix is not more care, it is never touching
// the real file.
const target = process.argv[2] ?? './index.html';
const dec = readFileSync(new URL(target, import.meta.url), 'utf8');
const ref = readFileSync(new URL('./reference.html', import.meta.url), 'utf8');

// ── 0. TORN-READ GUARD ────────────────────────────────────────────────────────────
// Another process in this directory writes these files. Three times today a checker read one
// mid-write and reported a real-looking defect ("<em> 887 open / 886 close", "the sequence no
// longer says why it needs no database") that was clean on the next run. A spurious failure
// that looks exactly like a genuine one is worse than a missing check: it costs a diagnosis
// each time, and it teaches the reader to re-run rather than to believe the tool.
//
// Both documents end with </html>. A file caught mid-write almost never does. So distinguish
// "this document is inconsistent" from "I read it while it was being written", and say which.
const TORN = (name, text) => {
  if (/<\/html>\s*$/.test(text)) return false;
  console.error(`⚠ TORN READ — ${name} does not end with </html>.`);
  console.error('  Another process is probably writing it. This is NOT a verdict on the document;');
  console.error('  re-run in a moment. (If it persists, the file really is truncated.)');
  return true;
};
if (TORN('index.html', dec) || TORN('reference.html', ref)) process.exit(3);
const problems = [];
const fail = (kind, msg) => problems.push(`[${kind}] ${msg}`);

const strip = (h) => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&#8202;/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&gt;/g, '>')
  .replace(/&lt;/g, '<').replace(/\s+/g, ' ');
const decText = strip(dec);
const refText = strip(ref);

// ── 1. structure ────────────────────────────────────────────────────────────────
for (const tag of ['div', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'p', 'li', 'ul', 'ol',
  'pre', 'code', 'strong', 'em', 'span', 'h1', 'h2', 'h3', 'h4', 'a', 'nav', 'header', 'footer', 'b']) {
  const o = (dec.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;
  const c = (dec.match(new RegExp(`</${tag}>`, 'g')) || []).length;
  if (o !== c) fail('structure', `<${tag}> ${o} open / ${c} close`);
}
const ids = [...dec.matchAll(/\sid="([\w-]+)"/g)].map((m) => m[1]);
for (const a of [...dec.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]))
  if (!ids.includes(a)) fail('anchor', `#${a} has no target`);
for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) fail('anchor', `duplicate id ${id}`);
// Every table must scroll rather than push the page sideways on a phone.
for (const m of dec.matchAll(/<table\b/g))
  if (!dec.slice(Math.max(0, m.index - 240), m.index).includes('class="tw"'))
    fail('layout', `a <table> near offset ${m.index} has no .tw scroll wrapper`);

// ── 2. the problem/fix numbering is a contract, not decoration ───────────────────
const sec = (id, next) => dec.slice(dec.indexOf(`id="${id}"`), dec.indexOf(`id="${next}"`));
const nums = (s) => [...s.matchAll(/<td class="num">(\d+)<\/td>/g)].map((m) => m[1]);
// A contiguous set from 1, each number once — NOT a hardcoded '1,2,3,4,5,6'. The earlier
// version had to be edited every time a row was added, which is a guard that fights the author.
const contiguous = (ns, what) => {
  const sorted = [...ns].map(Number).sort((a, b) => a - b);
  const want = sorted.map((_, k) => k + 1);
  if (sorted.join() !== want.join())
    fail('numbering', `${what} are ${ns.join(',')} — expected each of 1..${sorted.length} exactly once`);
  return ns;
};
const pNums = contiguous(nums(sec('problems', 'whynot')), '§1 problems');
const fNums = contiguous(nums(sec('fixes', 'decide')), '§3 fixes');

// A fix that claims to fix problem N must name a problem that exists. The "Fixes" column is
// the only thing tying the two lists together, so a stale number there silently breaks the map.
const fixSec = sec('fixes', 'decide');
for (const m of fixSec.matchAll(/<td class="k">([\d,\s]+)<\/td>/g))
  for (const n of m[1].split(',').map((x) => x.trim()).filter(Boolean))
    if (!pNums.includes(n)) fail('numbering', `a fix claims to fix problem ${n}, which §1 does not list`);

// Cross-references to fixes and problems in prose must point at rows that exist.
for (const m of decText.matchAll(/\bfix (\d+)\b/gi))
  if (!fNums.includes(m[1])) fail('reference', `prose names "fix ${m[1]}" — no such row`);
for (const m of decText.matchAll(/\bproblems? (\d+)\b/gi))
  if (!pNums.includes(m[1])) fail('reference', `prose names "problem ${m[1]}" — no such row`);

// ── 3. counts stated in prose must match what they count ────────────────────────
const claims = [
  [/Three changes fix problems/, () => dec.slice(dec.indexOf('Do these three'), dec.indexOf('Then this one')),
    3, 'the "do these three" group'],
  [/(Two|Three|Four) reasons settle it/,
    () => dec.slice(dec.search(/(Two|Three|Four) reasons settle it/), dec.search(/(Two|Three|Four|Five|Six) more, if you want/)),
    { word: /(Two|Three|Four) reasons settle it/ }, 'the decisive-reasons table'],
  [/(Two|Three|Four|Five|Six) more, if you want them/,
    () => dec.slice(dec.search(/(Two|Three|Four|Five|Six) more, if you want/), dec.indexOf('budget question')),
    { word: /(Two|Three|Four|Five|Six) more, if you want/ }, 'the corroborating-reasons table'],
  // SELF-DEFEATING GUARD, fixed. This was keyed on the literal /Four round trips/, so changing
  // the count word to "Nine" made the guard stop MATCHING rather than stop PASSING — it skipped
  // silently and the self-test reported MISS. A count guard you can switch off by editing the
  // count is worthless. Derived from the heading's own number word, like the ceilings guard
  // below, whose comment already said why.
  [/(Two|Three|Four|Five|Six|Seven|Eight|Nine) round trips that did not need to happen/,
    () => dec.slice(dec.search(/(Two|Three|Four|Five|Six|Seven|Eight|Nine) round trips that did not/),
                    dec.indexOf('Why grouping them')),
    { word: /(Two|Three|Four|Five|Six|Seven|Eight|Nine) round trips that did not/ }, 'the round-trip group'],
  // Derive the expected count from the heading's own number word rather than hardcoding it,
  // so adding a ceiling cannot leave the guard asserting a stale figure.
  [/(Two|Three|Four|Five) ceilings you are pressed against/,
    () => dec.slice(dec.search(/(Two|Three|Four|Five) ceilings/), dec.indexOf('id="whynot"')),
    { word: /(Two|Three|Four|Five) ceilings/ }, 'the ceilings group'],
];
const WORDS = { Two: 2, Three: 3, Four: 4, Five: 5 };
for (const [claim, getSeg, want, what] of claims) {
  if (!claim.test(decText)) { fail('count', `the phrase for ${what} is gone — the guard below is now vacuous`); continue; }
  const expected = typeof want === 'number' ? want : WORDS[(decText.match(want.word) || [])[1]];
  if (expected === undefined) { fail('count', `cannot read the stated number for ${what}`); continue; }
  const rows = (getSeg().match(/<tr>\s*<td/g) || []).length;
  if (rows !== expected) fail('count', `${what} says ${expected} but holds ${rows} rows`);
}

// ── 4. THE POINT OF THIS FILE: no figure here that is absent from the reference ──
// Skipped deliberately: single digits (row numbers, "one line"), years, and the revision
// date. Everything else is a claim about the platform or the codebase and must be traceable.
const SKIP = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '2026', '08', '30', '0']);
const figures = new Set();
for (const m of decText.matchAll(/\b(\d[\d,.]*)\s*(s\b|ms\b|MB\b|GB\b|%|\/day|CU\b|files?\b|lines?\b|routes?\b|tables?\b|orgs?\b|configs?\b|characters?\b|declarations?\b|queries\b|statements?\b|renders?\b|parameters?\b|bindings?\b|connections?\b|writes\b|reads\b)/g)) {
  const n = m[1].replace(/[.,]$/, '');
  if (!SKIP.has(n.replace(/,/g, '')) && n.replace(/[^\d]/g, '').length > 1) figures.add(n);
}
const missing = [...figures].filter((n) => {
  const bare = n.replace(/,/g, '');
  const alt = bare.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // A plain substring test is too weak for DECIMALS, and it let a real inconsistency through:
  // the decision said "5.3%" awake where the reference says "5.2%" (the arithmetic gives
  // 5.229%), and the check passed because "5.3" occurs inside "§05.3" — a SECTION NUMBER
  // satisfied a check for a measurement. So a decimal must be found with a boundary before it
  // and, where the decision writes a unit, that unit must follow in the reference too.
  const hit = (hay, needle) => {
    if (!/\./.test(needle)) return hay.includes(needle);
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\d.§])${esc}(?![\\d])`).test(hay);
  };
  return !hit(refText, n) && !hit(refText, bare) && !hit(refText, alt);
});
if (missing.length) fail('untraceable', `figure(s) on the decision page absent from reference.html: ${missing.join(', ')}`);

// ── 5. things that must not silently disappear ──────────────────────────────────
// Each of these is SCOPED to the region it has to appear in. An unscoped presence check
// is near-worthless here: three of these strings appear in two or three places, so a
// self-test that deleted one instance passed a global check while the load-bearing copy
// was gone. Scope names WHERE the claim must live, which is the claim actually worth making.
const region = (from, to) => {
  const a = dec.indexOf(from);
  if (a < 0) return null;
  const b = to ? dec.indexOf(to, a) : dec.length;
  return b < 0 ? null : dec.slice(a, b);
};
const ANSWER = region('class="answer"', '</ol>');
const FIXES = region('id="fixes"', 'id="decide"');
const FOOT = region('<footer', '</footer>');
const PROBLEMS = region('id="problems"', 'id="whynot"');
// Fix 3's own row — narrower than §3, because "read the behaviours section later" is exactly
// the failure this guards against: the NOW() rebind must be listed as part of the change.
const FIX3 = (() => {
  const seg = FIXES ?? '';
  const a = seg.indexOf('Swap <code>neon-http</code>');
  if (a < 0) return null;
  const b = seg.indexOf('</tr>', a);
  return b < 0 ? null : seg.slice(a, b);
})();
const MUST = [
  ['the D1 answer, in the opening', ANSWER, /No D1, no per-tenant Durable Objects/],
  ['the two decisive facts, in the opening', ANSWER, /bindings are static/],
  // These two used to guard "£0" and the quota reset date. The argument changed on 2026-08-30
  // when the owner pointed out that limits are being hit with ONE test user — so £0 alone is
  // misleading and the reset date is beside the point. A check that guards a superseded claim
  // is worse than no check: it makes the old framing feel load-bearing. Guard the new one.
  ['the £0 figure AND why it misleads, in the opening', ANSWER, /£0[\s\S]{0,80}(not launched|one test user|have not)/],
  ['the structural constraint, in the opening', ANSWER, /0\.5\d–0\.\d\d×[\s\S]{0,200}182\.5/],
  ['time-awake named as the billed quantity', ANSWER, /bills <em>time awake<\/em>|time awake/],
  ['the eleven-word summary, in the opening', ANSWER, /a driver\s+setting, a missing argument, a missing header/],
  ['the 10 GB question answered, in the opening', ANSWER, /36\.6/],
  ['the round-trip framing, in §1', PROBLEMS, /round trips that did not need to happen/],
  ['the today-actionable item, in §3', FIXES, /verify today, while CI is red/],
  ['the NOW() prerequisite, inside fix 3 itself', FIX3, /library\.ts:706/],
  ['the pointer to the evidence, in the footer', FOOT, /reference\.html/],
  ['the self-check command', dec, /verify-actions\.mjs/],
];
for (const [what, scope, re] of MUST) {
  if (scope === null) { fail('missing', `cannot locate the region for: ${what}`); continue; }
  if (!re.test(scope)) fail('missing', `${what} — gone`);
}

// ── the derived sequence must not drift from its sources ────────────────────────
// "The order, in one place" is assembled from fix 3's gate, §4's plan rows and §5's
// readings. It says so — but a disclaimer is not a guard. If §3 later changes which fixes
// need no database branch, the sequence would keep telling the reader to start with the
// wrong two, and nothing else in this file would notice.
{
  const order = region('id="order"', 'id="decide"');
  if (order === null) fail('order', 'the assembled sequence is gone — §4 now has no single ordered plan');
  else {
    const oText = strip(order);
    // Every fix the sequence names must exist in §3.
    for (const m of oText.matchAll(/\bfix(?:es)?\s+(\d)(?:\s+and\s+(\d))?/gi))
      for (const n of [m[1], m[2]].filter(Boolean))
        if (!fNums.includes(n)) fail('order', `the sequence names fix ${n}, which §3 does not list`);

    // The "now" row's claim — that these need no Neon branch — must still hold in §3.
    const now = (oText.match(/now[\s\S]{0,400}?(?=2026-09-01)/) || [''])[0];
    const claimed = [...now.matchAll(/\b(\d)\b/g)].map((m) => m[1]).filter((n) => fNums.includes(n));
    const fixesText = strip(FIXES ?? '');
    for (const n of new Set(claimed)) {
      // §3 must still say that fix's test needs no branch, in whatever wording.
      const row = fixesText.split(/(?=\bAdd |\bPass |\bSwap |\bEnable |\bSet |\bParallelise )/)
        .find((r) => /^(Add|Pass|Swap|Enable|Set|Parallelise)/.test(r) && /mocks?\s+@codex/.test(r));
      if (!row && !/mocks?\s+@codex\/database/.test(fixesText))
        fail('order', `the sequence says fix ${n} needs no database branch, but §3 no longer says so`);
    }
    // 'mock' not 'mocks' — the sequence says "test files mock @codex/database". A regex that
    // wants the plural passes only by accident of phrasing, which is how a guard goes vacuous.
    if (!/no Neon branch|needs no branch|mocks?\s+@codex/.test(oText))
      fail('order', 'the sequence claims work can start now but no longer says why it needs no database');
    if (!/2026-09-01/.test(oText)) fail('order', 'the sequence has lost the quota-reset step');
  }
}

// ── main text per cell must stay in proportion ───────────────────────────────────
// This document has two layers: main text, and .tiny asides a skimmer skips. A cell whose
// MAIN text runs far longer than its neighbours' is almost always narrative that belongs in
// the second layer — the "Pay Neon?" cell reached 1,317 characters of main text against a
// ~250 median, and its bulk was an account of my own corrections rather than the decision.
//
// No fixed cap: a hard limit would be arbitrary and would fight a genuinely dense table.
// The test is RELATIVE — an outlier against its own table's median — so it self-calibrates
// and only fires when one cell is out of step with the others around it.
{
  for (const t of dec.match(/<table[\s\S]*?<\/table>/g) || []) {
    const lens = [...t.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map((m) => strip(m[1].replace(/<span class="tiny">[\s\S]*?<\/span>/g, '')).trim().length)
      .filter((n) => n > 40);
    if (lens.length < 4) continue;
    const sorted = [...lens].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const worst = sorted[sorted.length - 1];
    // 4x the median AND over 700 characters: either alone produces false positives on a
    // table of short cells with one legitimately detailed row.
    if (worst > median * 4 && worst > 700) {
      const cell = [...t.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
        .map((m) => strip(m[1].replace(/<span class="tiny">[\s\S]*?<\/span>/g, '')).trim())
        .find((c) => c.length === worst);
      fail('proportion', `a cell has ${worst} chars of MAIN text against a median of ${median} in its own table — ` +
        `move what explains how you got there into a .tiny aside: "${(cell || '').slice(0, 70)}…"`);
    }
  }
}

// ── punctuation must not be orphaned after a BLOCK aside ────────────────────────
// `.tiny` is display:block, so every aside forces a line break. Punctuation placed AFTER
// </span> therefore lands alone on the next line — a stranded "." was visible in the very
// first browser screenshot taken of this page, in the second of its three opening lines.
//
// Note the conflict this sits in: the parenthetical check above wants a sentence to survive
// the aside's REMOVAL, which argues for punctuation outside; this one wants it not ORPHANED,
// which argues for inside. Both are satisfied only by ending the sentence BEFORE the aside,
// so the aside is a standalone parenthetical block and the next sentence starts fresh.
for (const m of dec.matchAll(/<\/span>\s*([.,;:)])/g)) {
  const before = strip(dec.slice(Math.max(0, m.index - 90), m.index)).trim();
  fail('orphan', `"${m[1]}" follows a closing </span> — .tiny is display:block, so it will render alone ` +
    `on the next line. End the sentence before the aside instead: "…${before.slice(-60)}"`);
}

// ── a sentence must survive the removal of its own parenthetical ─────────────────
// This document has two reading levels: the main text, and .tiny asides a skimmer skips.
// A sentence whose grammar depends on its aside breaks for half its readers — found by
// reading with .tiny stripped: "it is a one-time grant, not a monthly budget: , because …"
// left a colon pointing at nothing. Cheap to check, invisible otherwise.
{
  // Remove tags with EMPTY replacement, not a space: strip() substitutes ' ' for every tag,
  // which turns "matter</strong>," into "matter ," and fabricates the very gap this looks for.
  // Removing a whole .tiny span still leaves the space that preceded it, so real breaks survive.
  const skimmed = dec
    .replace(/<style[\s\S]*?<\/style>/g, '')
    // <pre> blocks are code and comments with their own line discipline — a '#' opening a
    // comment line reads as punctuation-after-whitespace once newlines collapse. Prose only.
    .replace(/<pre>[\s\S]*?<\/pre>/g, '')
    .replace(/<span class="tiny">[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#8202;/g, '').replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ');
  const breaks = [
    [/:\s*[,.;)]/, 'a colon followed immediately by punctuation — its explanation was inside a .tiny aside'],
    [/\s+[,.;]/, 'whitespace before punctuation — a removed aside left a gap'],
    [/[,;]\s*[.]/, 'a comma or semicolon running straight into a full stop'],
    [/—\s*[.,]/, 'a dash followed immediately by punctuation'],
    [/\b(and|but|or|because|which|that)\s+[.]/, 'a sentence ending on a conjunction'],
  ];
  for (const [re_, why] of breaks) {
    const m = skimmed.match(re_);
    if (m) fail('parenthetical', `with .tiny asides removed: "${skimmed.slice(Math.max(0, m.index - 55), m.index + 25).trim()}" — ${why}`);
  }
}

// ── one quantity, one number ─────────────────────────────────────────────────────
// check.mjs has this for the reference document and this file did not. A quantity stated
// two ways is the cheapest kind of contradiction to introduce and the hardest to notice,
// because both numbers are individually right — 38.3/730 rounds to 5.2% or 5.3% depending
// on the arithmetic you happen to do. The reader cannot tell which is a typo.
const QUANTITIES = [
  ['the awake fraction', /\b(5\.\d)\s*%/g],
  ['hours awake per month', /\b(\d{2}\.\d)\s*h(?:ours)?\s*awake/g],
  // Two figures, two claims, and the CONFLICT between them is a finding — so they must not be
  // collapsed. 110 CU-hours is the quota this project was measured against (396,000 s, per the
  // CI failure); 100 CU-hours is Neon's published monthly free allowance. A bare /\d{3} CU-hours/
  // flagged them as one drifting quantity and would have forced the document to hide the conflict.
  ['the quota CI cited, where stated alone', /quota CI cited[^.]{0,40}?\b(\d{3})\s*CU-hours/g],
  ["Neon's published monthly free allowance", /\b(\d{3})\s*CU-hours per project per\s*<?e?m?>?\s*month/g],

  ['an always-awake instance in CU-hours', /\b(18\d(?:\.\d)?)\b/g],
  ['the catalogue size', /\b(3\d\.\d)\s*(?:&#8202;)?MB\b/g],
  ['statements per render', /~?\b(\d{2})\s*statements\b/g],  // NOT a bare /\d{2} ms/ — that matched BOTH the 81 ms per statement and the ~5-10 ms
  // same-region RTT, which are different quantities and the whole point of §3's argument.
  // Pin each to the phrasing that identifies which quantity it is.
  ['per-statement latency', /(\d{2})\s*ms(?:\s+each|\s+per statement|\s+is not distance|\s+—)/g],
  ['same-region round-trip time', /round-trip\s+time is ~(\d)–(\d{2})\s*ms/g],
];
for (const [what, re_] of QUANTITIES) {
  const seen = new Set([...decText.matchAll(re_)].map((m) => m[1]));
  if (seen.size > 1) fail('one-quantity', `${what} is stated as ${[...seen].join(' and ')} — pick one`);
}

// ── findings must exist in BOTH documents ────────────────────────────────────────
// The figure-traceability check above verifies that every NUMBER on the decision page also
// appears in reference.html. It does not catch a FINDING that lives only in the summary —
// and four did, because they were discovered while writing it. That made the document billed
// as the audit trail the thinner of the two on its own subject.
//
// So: load-bearing findings are listed here with a pattern for each document. The patterns
// differ deliberately — the two files use different wording and different conventions, and
// requiring identical prose would force one to copy the other rather than to agree with it.
const SHARED_FINDINGS = [
  ['no key to shard on', /no key to shard on/i, /no key to shard on/i],
  ['written_data_bytes is 0 for the period', /written_data_bytes/i, /written_data_bytes/i],
  ['the eight-second CI-share decomposition', /eight seconds/i, /eight seconds/i],
  ["Neon publishes the allowance as monthly", /100 CU-hours per project per/i, /100 CU-hours per project per/i],
  ['Hyperdrive wants the UNPOOLED string', /uncheck|unpooled|without[^.]{0,20}-pooler/i, /uncheck|unpooled|without[^.]{0,20}-pooler/i],
  ['the 5-of-13 mount hazard', /5 public routes|five public/i, /5 public routes|five public/i],
];
for (const [what, dRe, rRe] of SHARED_FINDINGS) {
  const inDec = dRe.test(decText);
  const inRef = rRe.test(refText);
  if (inDec && !inRef)
    fail('one-sided', `"${what}" is on the decision page but not in reference.html — evidence should flow INTO the audit trail, not only out of it`);
  if (!inDec && inRef)
    fail('one-sided', `"${what}" is in reference.html but has dropped off the decision page`);
}

// ── superseded claims ────────────────────────────────────────────────────────────
// Four times in one day I corrected an argument in a section and left the OPENING
// asserting the cause I had just disproved. A prose reminder ("revise naming text first")
// did not stop instance four. So: register each retracted claim here. The cost is one line
// per correction and it makes the failure impossible rather than remembered.
//
// A claim goes in this list only when the document elsewhere states the corrected version —
// otherwise the registry becomes a way to ban words rather than to prevent contradictions.
const SUPERSEDED = [
  [/bot traffic on the\s+tenant wildcard does exactly that/i,
   'bot probes of NONEXISTENT subdomains are already defended by the isolate-local negative cache; the live cause is a real page render resolving its slug (problem 4)'],
  [/latency was always the reason to act/i,
   'the owner corrected this on 2026-08-30 — cost IS the reason: the free allowance is 0.60x an always-awake instance and was spent at one test user'],
  [/cost never was/i, 'same correction — do not restate the £0 invoice as evidence that cost is not the problem'],
  [/archive storage right now/i,
   'the archive state flips on a single read; state it as a cycle (archived 05:46, ready 10:52), never as a current status'],
  [/9 sequential awaits/i,
   'matches no scope in access-decision.ts; the figures are 21 awaits total, 13 individual checks plus one Promise.all'],
];
// A document that records its own corrections must be able to QUOTE the retracted wording.
// So a match wrapped in curly quotes is a citation, not a restatement — the same exemption
// check.mjs uses for its superseded-figures registry. Straight quotes are not exempt: the
// distinction has to be visible in the source, or the exemption swallows real regressions.
const isCitation = (text, at, len) => {
  const before = text.slice(Math.max(0, at - 3), at);
  const after = text.slice(at + len, at + len + 3);
  return /[“]\s*$/.test(before) && /^\s*[”]/.test(after);
};
for (const [re_, why] of SUPERSEDED) {
  const g = new RegExp(re_.source, re_.flags.includes('g') ? re_.flags : re_.flags + 'g');
  for (const m of decText.matchAll(g)) {
    if (isCitation(decText, m.index, m[0].length)) continue;
    fail('superseded', `"${m[0]}" was retracted — ${why}`);
  }
}

// A superlative in the decision page is a liability: this document exists to be acted on,
// and "impossible" invites one counterexample where a priced constraint has nowhere to fail.
for (const m of decText.matchAll(/\b(impossible|never possible|cannot ever|no way to)\b/gi))
  fail('overstatement', `"${m[1]}" — state the workaround and its cost instead`);

// ── 6. merged from check-decision.mjs (2026-08-30) ─────────────────────────────
// Two checkers for one file is the hazard, not the safety: each took its own backup, and a
// self-test probe's mutation survived into the served document because the other pair's
// backup was stale. One checker, one self-test, one backup. These blocks are that file's
// unique checks, kept verbatim in intent — including the comments, which record real defects.

// NO SELF-REFERENCE. A link labelled with its own filename. Checked on the LABEL, not the
// href — the href was correct and the label was not.
for (const [, label] of dec.matchAll(/href="\.\/reference\.html">([^<]+)</g))
  if (/index\.html/.test(label)) fail('pointer', `a link to reference.html is labelled "${label}" — it names this file`);
if (/>index\.html</.test(dec)) fail('pointer', 'the document names itself as somewhere to look');

// THE REFERENCE IS THE ONE THIS WAS WRITTEN AGAINST. A decision document whose evidence file
// has moved on is "naming text lags arguing text" one level up.
if (!/id="s05-000"/.test(ref)) fail('sync', 'reference.html has no §05.000 — is it the right file?');
if (!/class="rev">v\d+/.test(ref)) fail('sync', 'reference.html carries no revision tag');

// THE FIVE SECTIONS, PRESENT AND IN ORDER. The claim to being a decision rather than a summary
// is that it ends at "what you decide" and "what is unknown".
{
  const want = ['The problems', 'Why not D1', 'The fixes', 'What you', 'still unknown'];
  const heads = [...dec.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)]
    .map((m) => strip(m[1]).replace(/\s+/g, ' ').trim());
  if (heads.length !== 5) fail('sections', `expected 5 <h2> sections, found ${heads.length}`);
  // The "SECTION n" label lives in its own <span class="n"> and was NOT covered by the text
  // match below — changing "SECTION 1" to "SECTION 9" passed every check. A numbered label is
  // naming text, and naming text is what lags: check the sequence itself.
  const labels = [...dec.matchAll(/<span class="n">SECTION\s*(\d+)<\/span>/g)].map((m) => m[1]);
  if (labels.join(',') !== '1,2,3,4,5')
    fail('sections', `SECTION labels read ${labels.join(',') || '(none)'} — expected 1,2,3,4,5`);
  want.forEach((w, i) => {
    if (!heads[i] || !heads[i].includes(w))
      fail('sections', `section ${i + 1} should mention "${w}" — found "${heads[i] ?? 'nothing'}"`);
  });
}

// THE ANSWER BEFORE ANY EVIDENCE. A decision document that makes the reader hunt for the
// conclusion has failed at the only thing it is for.
{
  const firstH2 = dec.indexOf('<h2');
  const head = decText.slice(0, firstH2 > 0 ? firstH2 : 2000);
  if (!/No D1/.test(head)) fail('lede', 'the answer "No D1" does not appear before the first section');
  if (!/£0|invoice/.test(head)) fail('lede', 'the £0 invoice — which reframes the premise — is not in the lede');
}

// NO wrangler.jsonc COUNT DRIFT. I wrote "all ten" when the real total is 11.
// NOTE the \s+ and the /g. The first version used a single literal space and matched NOTHING:
// stripping <code> tags leaves TWO spaces where the tag was, so "all 11 <code>wrangler" becomes
// "all 11  wrangler". The check passed for its whole life without ever firing. Strip-then-match
// must always be whitespace-tolerant — and every site must be checked, not just the first.
{
  let found = 0;
  // Case-INSENSITIVE: there are two sites, one starting a sentence ('Unset in all 11 …') and
  // one mid-sentence. A case-sensitive regex read only one of them, so a self-test probe that
  // mutated the other reported MISS while the check was passing on an untouched site.
  for (const [, n] of decText.matchAll(/unset in all\s+(\d+)\s+(?:wrangler|configs)/gi)) {
    found++;
    if (n !== '11') fail('drift', `placement is described as unset in ${n} configs; the real total is 11`);
  }
  if (found === 0 && /placement/.test(decText))
    fail('drift', 'the decision discusses placement but states no config count this check can verify');
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ ${target.replace('./','')} consistent — structure, numbering, counts, sections, pointers, lede`);
console.log(`  ${figures.size} figures checked against reference.html, all traceable`);
