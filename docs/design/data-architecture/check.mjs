#!/usr/bin/env node
// Consistency checker for reference.html. Run: node check.mjs
// Catches the four failure classes that actually occurred while writing it.
import { readFileSync } from 'node:fs';

// Optional path argument so the self-test can point this at a temp copy instead of
// sed-rewriting the file. Same reason as check-summary.mjs: a verification tool must
// never be able to write the served document.
const target = process.argv[2] ?? './reference.html';
const h = readFileSync(new URL(target, import.meta.url), 'utf8');

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
if (TORN('reference.html', h)) process.exit(3);
const fail = [];
const note = (c, m) => fail.push(`[${c}] ${m}`);

// 1 · STRUCTURE — balanced tags, div depth, correct nesting, unique ids, live anchors
for (const t of ['div','table','tbody','thead','tr','td','th','p','li','ul','ol','pre',
                 'code','strong','em','span','h1','h2','h3','h4','a','svg','text','s']) {
  const o = (h.match(new RegExp(`<${t}[ >]`, 'g')) || []).length;
  const c = (h.match(new RegExp(`</${t}>`, 'g')) || []).length;
  if (o !== c) note('structure', `<${t}> ${o} open / ${c} close`);
}
{ // div depth must never go negative and must end at 0
  let d = 0;
  for (const m of h.matchAll(/<(\/?)div\b[^>]*>/g)) {
    d += m[1] ? -1 : 1;
    if (d < 0) { note('structure', `div depth negative at line ${h.slice(0, m.index).split('\n').length}`); break; }
  }
  if (d !== 0) note('structure', `div depth ends at ${d}, expected 0`);
}
{ // block elements must not open inside a <p>, and boxes must not sit inside a <td>
  const stack = [];
  for (const m of h.matchAll(/<(\/?)(div|p|table|td|ul|ol|h2|h3|pre)\b[^>]*>/g)) {
    const [, close, tag] = m;
    if (close) { const i = stack.lastIndexOf(tag); if (i > -1) stack.length = i; continue; }
    if (stack.includes('p') && ['div','table','p','ul','ol','h2','h3','pre'].includes(tag))
      note('nesting', `<${tag}> inside an open <p> at line ${h.slice(0, m.index).split('\n').length}`);
    stack.push(tag);
  }
}
{ const ids = [...h.matchAll(/\sid="([\w-]+)"/g)].map(m => m[1]);
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dupes.length) note('anchors', `duplicate ids: ${[...new Set(dupes)].join(', ')}`);
  for (const a of new Set([...h.matchAll(/href="#([\w-]+)"/g)].map(m => m[1])))
    if (!ids.includes(a)) note('anchors', `dead anchor #${a}`);
}

// 1b · SVG TEXT OVERFLOW — <text> does not wrap, so a lengthened label runs off the
// canvas. Valid markup, invisible to tag counting, and it happened twice: appending a
// dated correction to a diagram label pushed it 356 units past an 880 viewBox.
// Width model: monospace advance is 0.6 x font-size, verified against rendered
// measurements for every class in this document (12px -> 7.21, 10px -> 6.01, 9px -> 5.40).
for (const m of h.matchAll(/<svg[^>]*viewBox="0 0 (\d+) (\d+)"[^>]*>([\s\S]*?)<\/svg>/g)) {
  const [vbW, vbH, body] = [+m[1], +m[2], m[3]];
  const title = (body.match(/<title[^>]*>([^<]{0,40})/) || [, 'svg'])[1];

  // class -> font-size, from the SVG's own <style> block
  const size = {};
  const st = (body.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
  for (const r of st.matchAll(/\.(\w+)\s*\{[^}]*?(\d+(?:\.\d+)?)px/g)) size[r[1]] = +r[2];

  for (const t of body.matchAll(/<text\s+x="(\d+)"\s+y="(\d+)"([^>]*)>([^<]+)<\/text>/g)) {
    const [x, y, attrs, text] = [+t[1], +t[2], t[3], t[4]];
    const cls = (attrs.match(/class="(\w+)"/) || [, ''])[1];
    const fs = size[cls] ?? 10;                       // default to the commonest size
    const w = text.length * 0.6 * fs;
    const endAnchored = /text-anchor="end"/.test(attrs);
    const right = endAnchored ? x : x + w;
    const left  = endAnchored ? x - w : x;
    if (right > vbW + 4)
      note('svg', `"${title}": .${cls} at x=${x} overflows right by ${Math.round(right - vbW)} ` +
                  `(viewBox ${vbW}) — "${text.slice(0, 34)}…"`);
    if (left < -4)
      note('svg', `"${title}": .${cls} at x=${x} overflows left by ${Math.round(-left)} — "${text.slice(0, 34)}…"`);
    if (y > vbH)
      note('svg', `"${title}": .${cls} at y=${y} is below viewBox height ${vbH} — "${text.slice(0, 34)}…"`);
  }
}

// 1c · NESTED / DOUBLED BOX — a .box opening immediately inside another .box with no
// content between them is always an accidental doubled wrapper. This mattered: v140
// nested a box in an identical box, which BALANCED a stray </div> left by a later move.
// Counts stayed 138/138 and depth ended at 0, so every other check passed. Two errors of
// opposite sign are invisible to arithmetic — this one looks at shape instead.
{
  const stack = [];
  for (const m of h.matchAll(/<(\/?)div\b([^>]*)>/g)) {
    if (m[1]) { stack.pop(); continue; }
    const isBox = /class="[^"]*\bbox\b/.test(m[2]);
    const parent = stack[stack.length - 1];
    if (isBox && parent?.isBox) {
      const between = h.slice(parent.end, m.index).replace(/\s+/g, '');
      if (between === '')
        note('nesting', `doubled box wrapper at line ${h.slice(0, m.index).split('\n').length} ` +
                        `— a .box opens immediately inside another .box with nothing between`);
    }
    stack.push({ isBox, end: m.index + m[0].length });
  }
}

// 1d · SUBSECTION LABEL vs LOCATION — every <h3 id="sNN-x">NN.x must live inside the <h2>
// numbered NN. This is a CORRESPONDENCE property: each part can be individually valid while
// the relationship is wrong. A6's subsections were labelled A2.1-A2.5 and A7's A3.1-A3.3
// (stale from an earlier appendix numbering), so 10 prose references to §A6.3/§A7.2 pointed
// at labels that did not exist, and the TOC filed those sub-links under the wrong sections.
// Anchors resolved, ids were unique, tags balanced — nothing else could see it.
{
  const h2s = [...h.matchAll(/<h2 id="([\w-]+)"[^>]*>(?:<span class="num">([\w]+)<\/span>)?/g)]
    .map(m => ({ pos: m.index, id: m[1], num: m[2] || '' }));
  const parentOf = (pos) => {
    let cur = null;
    for (const s of h2s) { if (s.pos <= pos) cur = s; else break; }
    return cur;
  };
  for (const m of h.matchAll(/<h3 id="s([\w-]+?)-[\w]+">([\w]+)\./g)) {
    const label = m[2];
    const parent = parentOf(m.index);
    if (parent && parent.num && label !== parent.num)
      note('labels', `subsection labelled ${label}.x sits inside section ${parent.num} ` +
                     `(<h2 id="${parent.id}">) — label and location disagree`);
    if (m[1] !== label)
      note('labels', `subsection id "s${m[1]}-…" does not match its own label "${label}.x"`);
  }
}

// 2 · ACTION IDENTITY — the key table is the single source of truth
const KEYS = ['COUNTERS','RATELIMIT','PLAN','WAITUNTIL','READPATH','DRIVER','LADDERS','TYPESPLIT','TRGM'];
for (const k of KEYS) if (!h.includes(`<code>${k}</code>`)) note('actions', `key ${k} missing`);
// The presence check above is the WEAKER relation: it proves each key exists somewhere, not
// that key N is bound to number N. A swapped pair (3 -> WAITUNTIL, 4 -> PLAN) satisfies it,
// and that binding is the entire point of the stable-key scheme — "a retired item keeps its
// key, so no reference breaks". So parse the key table and check the pairing itself.
{
  // Anchored on the table's own id — a prose anchor here would match the contents page.
    const ki = h.indexOf('<table id="tbl-actionkey"');
  if (ki < 0) note('actions', 'the action key table was not found — this check did not run');
  else {
    const body = h.slice(h.indexOf('<table', ki), h.indexOf('</table>', ki));
    const pairs = [...body.matchAll(/<tr>\s*<td[^>]*>(\d)<\/td>\s*<td[^>]*>\s*<code>(\w+)<\/code>/g)]
      .map(m => [m[1], m[2]]);
    if (pairs.length !== KEYS.length)
      note('actions', `the key table yielded ${pairs.length} number-key pairs, expected ${KEYS.length}`);
    for (const [n, k] of pairs) {
      const expected = KEYS[Number(n) - 1];
      if (k !== expected)
        note('actions', `key table binds ${n} -> ${k}, but the canonical order has ${n} -> ${expected}`);
    }
  }
}
{ const one = h.slice(h.indexOf('<table id="tbl-onepager"'));
  const rows = [...one.slice(0, one.indexOf('</table>')).matchAll(/<td class="num">(\d)<\/td>/g)].map(m => m[1]);
  if (rows.join() !== '1,2,3,4,5,6,7,8,9') note('actions', `one-pager rows are ${rows.join()}, expected 1..9`);
}

// 2b · STATED COUNTS vs THE TABLE — the one-pager is the source of truth for how many
// actions are live. A revision claimed "six live actions" when eight remained: six was the
// verify-actions.mjs figure ("6 of 7 still open"), which counts only the script-CHECKABLE
// subset. A script's output is scoped to what the script can see, and that scope is never
// the whole claim.
{
  const one = h.slice(h.indexOf('<table id="tbl-onepager"'));
  const table = one.slice(0, one.indexOf('</table>'));
  // match the whole ROW — action cells run to 500+ chars with nested tags, so any
  // fixed-length cell pattern silently under-counts (it found 2 of 9 on the first attempt).
  const rows = [...table.matchAll(/<tr><td class="num">(\d)<\/td>([\s\S]*?)<\/tr>/g)];
  const total = rows.length;
  const landed = rows.filter(r => /LANDED/.test(r[2])).length;
  const live = total - landed;
  const WORD = { 5:'five', 6:'six', 7:'seven', 8:'eight', 9:'nine', 10:'ten' };
  // Strip curly-quoted spans before testing: the document CITES its own past wrong count
  // (“six live actions”) in the record of that correction. A citation is not an assertion,
  // and a checker that cannot tell them apart makes documenting a fix impossible.
  const txt = h.replace(/<[^>]+>/g, ' ').replace(/[“][^”]{0,200}[”]/g, ' ');
  for (const [w, n] of Object.entries(WORD).map(([n, w]) => [w, +n])) {
    const re = new RegExp(`\\b${w}\\s+live\\s+actions?\\b`, 'i');
    if (re.test(txt) && n !== live)
      note('counts', `"${w} live actions" but the one-pager has ${total} rows minus ${landed} LANDED = ${live} live`);
  }
  // and the total must be stated correctly too
  for (const [w, n] of Object.entries(WORD).map(([n, w]) => [w, +n])) {
    const re = new RegExp(`\\b${w}\\s+actions\\b(?!\\s+this)`, 'i');
    if (re.test(txt) && n !== total && n !== live)
      note('counts', `"${w} actions" matches neither the ${total} rows nor the ${live} live`);
  }
}

// 2c · LANDED ACTIONS vs THEIR ACCEPTANCE CRITERIA — a criterion is the last thing
// updated and the first thing an implementer trusts. Five times a criterion lagged its
// own action's spec; the mechanical part is this: if the one-pager marks action N as
// LANDED, criterion N must not still read as a target.
{
  const one = h.slice(h.indexOf('<table id="tbl-onepager"'));
  const oneTable = one.slice(0, one.indexOf('</table>'));
  const landed = new Set([...oneTable.matchAll(/<tr><td class="num">(\d)<\/td>([\s\S]*?)<\/tr>/g)]
    .filter(m => /LANDED/.test(m[2])).map(m => m[1]));

  const ai = h.indexOf('05.2 · Acceptance criteria');
  if (ai < 0) note('criteria', 'acceptance-criteria table not found — this check did not run');
  else {
    const accTable = h.slice(ai, h.indexOf('</table>', ai));
    for (const m of accTable.matchAll(/<tr><td class="num">(\d)<\/td><td>([\s\S]*?)<\/td>/g)) {
      const [, n, body] = m;
      const marked = /already satisfiable|LANDED|✓/.test(body);
      if (landed.has(n) && !marked)
        note('criteria', `action ${n} is marked LANDED in the one-pager but criterion ${n} still reads as a target`);
      if (!landed.has(n) && /already satisfiable/.test(body))
        note('criteria', `criterion ${n} says "already satisfiable" but action ${n} is not marked LANDED`);
    }
  }
}

// 2d · RETRACTION COUNT, DERIVED — not enumerated. Counts lagged seven times, each
// time in a phrasing the checker did not know ("N live actions", "N earlier
// recommendations", "N things this document recommended"). Enumerating phrasings will
// always trail the ones a writer invents, so derive the truth from the retraction TABLE
// and check every number-word that sits near retraction language.
{
  const ri = h.search(/items retracted, and why they were wrong/);
  if (ri < 0) note('retractions', 'retraction box not found — the derived count check did not run');
  else {
    const table = h.slice(ri, h.indexOf('</table>', ri));
    const rows = (table.match(/<tr><td><strong>/g) || []).length;
    const WORD = { two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };
    const txt = h.replace(/<[^>]+>/g, ' ').replace(/[“][^”]{0,240}[”]/g, ' ');  // ignore citations
    // any "<word> <something> retracted / already done / recommendations"
    // (?<![\w-]) excludes "Ninety-five"; the negative lookahead excludes "seven remaining
    // actions", which counts open actions rather than retractions.
    const NEAR = /(?<![\w-])(two|three|four|five|six|seven|eight|nine|ten)\b(?![^.]{0,40}remaining)[^.]{0,60}?\b(retract\w*|already done|already implemented|recommendations were)/gi;
    for (const m of txt.matchAll(NEAR)) {
      const n = WORD[m[1].toLowerCase()];
      // A number near "retract" is not always a claim about the TOTAL. Skip subset
      // phrasings ("four of these six retractions") and explicitly historical ones
      // ("five was the count at the time") — flagging those would make it impossible
      // to describe a subset or to record what an earlier revision said.
      // Test a WINDOW, not just the matched span: the span starts at the number, so a
      // qualifier that precedes it ("coalescing, whose two items were retracted") is
      // invisible to a check that only looks forward.
      const ctx = txt.slice(Math.max(0, m.index - 70), m.index + m[0].length + 20);
      // The number may quantify something OTHER than retractions in a sentence that also
       // mentions them ("seven stale instances — the six-retraction update"). Exempt when
       // the word immediately after it names a different unit. This check cannot be made
       // exact; it is deliberately biased toward flagging, with narrow explicit exemptions.
      const quantifiesSomethingElse =
        /\b(two|three|four|five|six|seven|eight|nine|ten)\s+(stale\s+)?(instances?|times|places?|revisions?|rounds?|attempts?|passes|files?|call sites?)\b/i
          .test(ctx);
      const isSubsetOrHistorical =
        /\bof (these|the|those|which|them)\b/i.test(ctx) ||
        /\bwas the count|at the time|earlier revision|earlier wording|originally\b/i.test(ctx) ||
        /\b(whose|its|their)\s+\w*\s*$/i.test(txt.slice(Math.max(0, m.index - 24), m.index));
      if (n !== rows && !isSubsetOrHistorical && !quantifiesSomethingElse)
        note('retractions', `"${m[0].trim().slice(0, 64)}" — the retraction table has ${rows} rows, not ${n}`);
    }
  }
}

// 2e · SUPERLATIVES IN THE ARGUMENT TABLE — §03's seven arguments were overstated three
// times ("four separate impossibilities", "breaks public search outright", "DOs bill
// duration so cost scales with tenant count"). Each rewrite made the claim weaker in
// wording and stronger in force, because an impossibility invites one counterexample
// while a priced workaround has nowhere to fail. Superlatives are legitimate elsewhere in
// the document; inside this table they mark a claim that has not been tested against its
// own workaround. The reframing to "fails here" once survived in NINE other places,
// including the section heading — a prose lesson changed nothing, a scan changed all nine.
{
  const ti = h.indexOf('<table id="tbl-arguments"');
  if (ti < 0) note('claims', 'the §03 argument table was not found — this check did not run');
  else {
    const table = h.slice(ti, h.indexOf('</table>', ti));
    // strip curly-quoted citations: the table legitimately quotes superseded wording
    const cells = [...table.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(m => m[1].replace(/[“][^”]{0,300}[”]/g, ' '));
    const SUPER = /\b(impossible|impossibility|outright|never|always|no way|guaranteed)\b/i;
    for (const c of cells) {
      // Negated forms are the GOAL, not the defect: "not an impossibility", "rather than
      // impossible". Only an affirmative superlative marks an untested claim.
      const plainForTest = c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const m = SUPER.exec(plainForTest);
      const negated = m && /\b(not|never|rather than|nor)\s+(an?\s+|be\s+)?$/i
        .test(plainForTest.slice(Math.max(0, m.index - 22), m.index));
      if (m && !negated) {
        const plain = c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        note('claims', `"${m[1]}" in a §03 argument cell — state the workaround and its cost instead: ` +
                       `"…${plain.slice(0, 60)}…"`);
      }
    }
  }
}

// 2f · STATED COUNT vs TABLE ROWS, for every table that claims completeness. §A2 claimed
// "all 49 tables" over rows summing to 48 — which looked like an arithmetic slip and was
// actually a fact (the 49th is `testTable`, a fixture). These eight all matched when first
// checked; they are guarded because the counts drift every time a row is added.
{
  // Anchor on a heading ID where one exists. A free-text marker matches the TABLE OF
  // CONTENTS first — the tooltips repeat section titles ~150KB earlier — so indexOf finds
  // the TOC and measures whatever table follows it. This is the same defect the retraction
  // check documents below; it recurred the moment a new section was given a TOC entry.
  const CLAIMS = [
    // Every entry addresses a table by ID. No free-text lookup survives in this check:
    // a marker phrase is repeated by the TOC tooltips, so indexOf finds the contents page.
    ['§07.0b non-findings',      { table: 'tbl-nonfindings' }, 10],
    ['retraction box',           { table: 'tbl-retractions' },  6],
    ['§03 arguments',            { table: 'tbl-arguments' },     7],
    ['§06 options',              { table: 'tbl-options' },      9],
    ['§05.1a stress-test',       { id: 's05-1a' },               8],
    ['§05.0 recommended order',  { id: 's05-0' },                8],  // 7 → 8 when step 0a (the Neon
                                                                  // plan, distinct from action 3) was
                                                                  // added; §05.0 states no count.
    ['§A9.0 per-action tests',   { id: 'sA9-0' },                7],  // 6 → 7 when action 6 gained a row;
                                                                  // §A9's prose states no count, so only
                                                                  // this expectation needed updating.
    ['converse sweep',           { table: 'tbl-converse' },      7],
  ];
  for (const [label, where, expected] of CLAIMS) {
    const i = where.table ? h.indexOf(`<table id="${where.table}"`)
            : where.id    ? h.search(new RegExp(`<h[23][^>]*\\sid="${where.id}"`))
            :               h.indexOf(where.text);
    const marker = where.table ? `table#${where.table}` : where.id ? `#${where.id}` : where.text;
    if (i < 0) { note('tables', `${label}: anchor "${marker.slice(0, 28)}…" not found — heading may have been renamed`); continue; }
    const ts = h.indexOf('<table', i), te = h.indexOf('</table>', ts);
    if (ts < 0 || te < 0) { note('tables', `${label}: no table follows its marker`); continue; }
    const body = h.slice(ts, te);
    const rows = (body.match(/<tr>/g) || []).length - (body.includes('<thead>') ? 1 : 0);
    if (rows !== expected)
      note('tables', `${label}: ${rows} rows but the text claims ${expected}`);
  }
}

// 2g · EVERY TABLE NEEDS A .tw SCROLL WRAPPER. A wide table outside one makes the whole
// page scroll horizontally on a narrow viewport — a defect only a browser shows, and the
// browser pass is the expensive check. All 49 were wrapped when this was added; it exists
// because tables get added often and the omission is invisible on a wide screen.
{
  const tables = [...h.matchAll(/<table\b/g)];
  for (const m of tables) {
    const before = h.slice(Math.max(0, m.index - 260), m.index);
    if (!before.includes('class="tw"')) {
      const heads = [...h.slice(0, m.index).matchAll(/<h[23][^>]*\sid="([\w-]+)"/g)];
      const sec = heads.length ? heads[heads.length - 1][1] : 'front matter';
      note('layout', `a <table> in #${sec} is not inside a <div class="tw"> — it will scroll the page`);
    }
  }
}

// 2h · TOC SUBENTRIES MUST MATCH THEIR HEADINGS, IN ORDER. Coverage was being checked as a
// set, so a section inserted in the wrong place passed: §07.0c landed before §07.0b and the
// contents page listed "0c" ahead of "0b". §07.0b also had no entry at all, from whenever it
// was written — a set check on a list that was already incomplete finds nothing.
{
  const toc = [...h.matchAll(/href="#(s\d+-[\w]+)" class="tsub"/g)].map(m => m[1]);
  const heads = [...h.matchAll(/<h3[^>]*\sid="(s\d+-[\w]+)"/g)].map(m => m[1]);
  const prefixes = [...new Set(heads.map(x => x.split('-')[0]))];
  for (const pre of prefixes) {
    const t = toc.filter(x => x.startsWith(pre + '-'));
    const hd = heads.filter(x => x.startsWith(pre + '-'));
    const missing = hd.filter(x => !t.includes(x));
    const extra = t.filter(x => !hd.includes(x));
    if (missing.length) note('toc', `§${pre.slice(1)}: heading(s) with no contents entry — ${missing.join(', ')}`);
    if (extra.length) note('toc', `§${pre.slice(1)}: contents entr(ies) with no heading — ${extra.join(', ')}`);
    if (!missing.length && !extra.length && t.join() !== hd.join())
      note('toc', `§${pre.slice(1)}: contents order ${t.join(',')} does not match document order ${hd.join(',')}`);
  }
}

// 2i · THE DOCUMENT MUST NOT HARD-CODE A PROBE COUNT. It said check-self-test.sh "injects 13
// real defects" when it injected 24 — the ninth count here to lag what it counts. Deriving the
// number turned out to be ambiguous at the source (25 `probe` lines yield 24 caught; the other
// script mixes `check` calls with inline assertions), and both scripts already print their own
// totals on every run. So the invariant is not "the stated number is right" but "no number is
// stated" — the cheapest of the three fixes for count drift, and the one reached for last.
{
  const bad = [
    /(\d+) real defects one at a time/,
    /<strong>(\d+) probes<\/strong>/,
    /injects <strong>(\d+)/,
    /(\d+) probes, 0 missed/,
  ];
  for (const re of bad) {
    const m = h.match(re);
    if (m) note('counts', `the document hard-codes a probe count ("${m[0].slice(0, 42)}") — ` +
                          `the scripts report their own totals; state no number`);
  }
}

// 2j · CLASSES MUST BE DEFINED AND USED, BOTH DIRECTIONS. A class used but never defined
// renders unstyled — invisible to every other check here and visible only in a browser, which
// is the pass that keeps being unavailable. A class defined but never used is dead weight and
// usually the fossil of something removed: .p-d1 and .p-edge outlived the read-plane diagram
// by two hundred revisions.
//
// The first version of this check read only the FIRST <style> block and reported ten undefined
// classes — the SVGs carry their own. Same weaker-relation error as the TOC set check: the
// property was "defined somewhere", and it was tested against one place.
{
  const blocks = [...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  const defined = new Set(blocks.flatMap(b => [...b.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1])));
  const used = new Set([...h.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)).filter(Boolean));
  for (const c of [...used].sort()) if (!defined.has(c)) note('css', `class "${c}" is used but never defined — it renders unstyled`);
  for (const c of [...defined].sort()) if (!used.has(c)) note('css', `class "${c}" is defined but never used — dead rule, probably a fossil`);

  // Same property, custom-property namespace. Checked in both directions for the same reasons:
  // an undefined var() silently falls back to nothing (an invalid value, so the declaration is
  // dropped), and an unused one is a fossil. Both were balanced at 23 when this was written —
  // including --d1-soft and --edge-soft, which survive because the appendix still diagrams the
  // design that was rejected. Removing dead rules is what prompted the check: three had
  // outlived what they styled.
  const varsDefined = new Set(blocks.flatMap(b => [...b.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1])));
  const varsUsed = new Set([...h.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]));
  for (const v of [...varsUsed].sort()) if (!varsDefined.has(v)) note('css', `${v} is referenced by var() but never defined — the declaration will be dropped`);
  for (const v of [...varsDefined].sort()) if (!varsUsed.has(v)) note('css', `${v} is defined but never referenced — dead custom property`);
}

// 2k · ACTION 6 MUST NEVER BE DESCRIBED WITHOUT ITS GATE. Free-plan Hyperdrive fails past
// 100,000 queries/day, so the driver swap depends on action 3 — the most consequential
// dependency in the plan, and one that went missing once: a misplaced box was extracted from
// the one-pager's row 6 and took the qualifier with it, leaving the row reading as
// unambiguously good news. Structure and numbering were repaired and every check passed,
// because the defect was in what the row no longer said. Hazard class 10 in the editing.
{
  // Every table row that names the swap as work must also name the gate. Prose that merely
  // mentions Hyperdrive is exempt; a ROW is what a reader acts on.
  const rows = [...h.matchAll(/<tr>[\s\S]{0,3000}?<\/tr>/g)].map(m => m[0]);
  for (const r of rows) {
    const plain = r.replace(/<[^>]+>/g, ' ');
    const namesSwap = /neon-http.{0,40}(→|->).{0,40}Hyperdrive|Swap\s+neon-http/i.test(plain);
    if (!namesSwap) continue;
    const namesGate = /100,000|action 3|Workers Paid/i.test(plain);
    if (!namesGate)
      note('gate', 'a row describes the neon-http → Hyperdrive swap without its gate ' +
                   '(free-plan Hyperdrive fails past 100,000 queries/day — see §05.4)');
  }
}

// 2l · <pre> MUST SCROLL ITSELF, NOT THE PAGE. The longest code line here is 109 characters —
// about 785px at 12px monospace — against roughly 343px of usable width on a 375px viewport.
// Without `overflow-x:auto` on `pre` that scrolls the WHOLE PAGE sideways, which is the same
// defect the .tw wrapper prevents for tables and which went unnoticed the entire time,
// because every check in this file reads markup and this one is a stylesheet omission.
{
  const style = [...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const m = style.match(/(^|\})\s*pre\s*\{([^}]*)\}/);
  if (!m) note('layout', 'no `pre` rule found in any <style> block — long code lines will scroll the page');
  else if (!/overflow-x\s*:\s*auto/.test(m[2]))
    note('layout', '`pre` has no overflow-x:auto — a long code line scrolls the page, not the block');

  // And report the worst line, so the number in the comment above cannot drift silently.
  let worst = 0;
  for (const b of h.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)) {
    const text = b[1].replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
    for (const line of text.split('\n')) worst = Math.max(worst, line.trimEnd().length);
  }
  if (worst > 140)
    note('layout', `a <pre> line is ${worst} characters — long enough that even an in-block scrollbar ` +
                   `will hide most of it; consider wrapping the source`);
}

// 2m · ONE QUANTITY, ONE NUMBER. The round-trips-per-landing-render figure went 16–17 → 24
// → 31 as the measurement improved, and four of seventeen mentions were left on 24 —
// including line 3 of the five-line summary, while the Hyperdrive arithmetic downstream used
// 31. Two live numbers for one quantity, and the existing superseded-figure guard missed it
// because that guard only catches figures explicitly REGISTERED as retired: 24 was an
// intermediate correction I made and then superseded without registering. A guard that needs
// registration catches only what you remembered to register — the same limit as a convention.
//
// This one needs no registration: for each quantity below, collect every number attached to
// it anywhere in the document and require they agree.
{
  // Strip curly-quoted spans first: the document QUOTES superseded wording deliberately
  // ("the criterion asked for 'calls per landing render drops from ~24'"), and a citation of a
  // retired figure must not read as a live claim. Same exemption the retraction check uses.
  const hq = h.replace(/[\u201c][^\u201d]{0,400}[\u201d]/g, ' ');
  const QUANTITIES = [
    // The unit word must follow the number directly — an earlier version allowed 40 chars of
    // slack and matched the "4" in "§05.4) — at the measured ~31 statements per render".
    // Two accepted forms, because the document uses both: a tilde-prefixed bare number
    // ("~31 per landing render", where the unit was named earlier in the sentence) or a number
    // followed directly by its unit ("~31 statements per render"). Requiring the unit suffix
    // alone stopped matching line 3 entirely; allowing 40 chars of slack matched the "4" in
    // "§05.4)". Both directions were tested against a reintroduced 24 before this was kept.
    // Only the STATEMENTS figure is checked for agreement. 'Neon round trips' is a
    // different scope (the subrequest fan-out) and legitimately carries a different number.
    ['statements per landing render',
     /~?(\d+(?:[–-]\d+)?)\s*statements? (?:[^.;<]{0,18}?)per (?:landing )?render/gi],
    ['statements per visit',
     /~?(\d+(?:[–-]\d+)?)\s*statements? ?[×x] ?81/gi],
    ['ms per round trip',
     /(\d+)\s*ms (?:each|per (?:round trip|statement))/gi],
  ];
  for (const [label, re_] of QUANTITIES) {
    const seen = new Map();
    for (const m of hq.matchAll(re_)) {
      const v = m[1] ?? m[2];
      seen.set(v, (seen.get(v) || 0) + 1);
    }
    if (seen.size > 1) {
      const parts = [...seen.entries()].map(([v, n]) => `${v} (${n}×)`).join(', ');
      note('figures', `"${label}" appears with more than one value — ${parts}. ` +
                      `One quantity, one number: pick the measured figure and unify.`);
    }
  }
}

// 2n · REPEATED CONSTANTS, SCOPE-AWARE. A sweep of every repeated constant found one real
// clash — the autoscaling floor stated as both `min CU × 730` and `2 × 24 × 30`, a 1.4%
// difference from assuming a 30-day month. Nine other flags were false positives, and each was
// two quantities legitimately sharing a unit. So the quantities below are listed with their
// ALLOWED value sets rather than a single value: a check that demanded one number per unit
// would fire constantly and be switched off, which is worse than no check.
{
  const hq = h.replace(/<style[\s\S]*?<\/style>/g, ' ')
              .replace(/<[^>]+>/g, ' ')
              .replace(/[\u201c][^\u201d]{0,400}[\u201d]/g, ' ')   // deliberate citations
              .replace(/\s+/g, ' ');
  const CONSTANTS = [
    // label,                     matcher,                                     allowed values + why
    ['CU-hours in a month',       /min CU\s*[×x]\s*(\d+)/g,                    { '730': 'average hours/month, 8760/12' }],
    ['Hyperdrive daily cap',      /([\d,]+)\s*(?:database )?quer(?:y|ies)\/?\s*(?:per )?day/gi, { '100,000': 'free plan' }],
    ['LIKE pattern bytes',        /(\d+)[- ]byte\s*LIKE/gi,                     { '50': 'SQLite limit' }],
    ['504 rate',                  /([\d.]+)\s*%\s*(?:of requests\s*)?504/gi,   { '17': 'measured 2026-08-26' }],
    ['KV writes/day',             /(~?[\d,]+)\s*(?:KV )?writes?\/day/gi,
      { '1,800': 'measured', '1,000': 'free-tier cap' }],
    // Decimals must be part of the match: `36.6 MB` was matching as "6" and flagging.
    ['megabyte figures',          /(\d+(?:\.\d+)?)\s*MB\b/g,
      { '500': 'D1 free-plan database size',
        '128': 'Durable Object memory, in the GB-s arithmetic',
        '512': 'Neon branch logical-size limit on this project (read 2026-08-30)',
        '36.6': 'actual size of the production branch (read 2026-08-30)' }],
  ];
  for (const [label, re_, allowed] of CONSTANTS) {
    for (const m of hq.matchAll(re_)) {
      const v = m[1].replace(/^~/, '');
      if (!(v in allowed))
        note('constants', `"${label}" appears as ${v}, which is not an allowed value ` +
                          `(${Object.entries(allowed).map(([k, why]) => `${k} = ${why}`).join('; ')})`);
    }
  }
}

// 2o · TOC TOOLTIP vs ITS HEADING. The contents entries carry title= tooltips, and one of
// them described the WRONG section for several revisions: #s05-1a's tooltip read "The three
// actions worth specifying in full", which is §05.1b. Tooltips are naming text — they get
// written once and are never the thing being revised when a section's argument changes
// (§07.0d). All 23 agreed when this was added; it exists because the next renamed heading
// will not update its tooltip on its own.
{
  const strip = (x) => x.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  for (const m of h.matchAll(/href="#([\w-]+)"[^>]*title="([^"]*)"/g)) {
    const [, id, tip] = m;
    const hm = h.match(new RegExp(`<h[23][^>]*\\sid="${id}"[^>]*>([\\s\\S]{0,220}?)</h[23]>`));
    if (!hm) { note('toc', `contents entry #${id} has a tooltip but no matching heading`); continue; }
    const head = strip(hm[1]).replace(/^[\d.A-Z]+\s*·?\s*/, '');
    const t = tip.toLowerCase(), hd = head.toLowerCase();
    // Agree if either contains a decent prefix of the other — a tooltip may abbreviate a long
    // heading, but it must not describe a different section.
    if (!(hd.includes(t.slice(0, 26)) || t.includes(hd.slice(0, 26))))
      note('toc', `#${id}: tooltip "${tip.slice(0, 46)}…" does not match its heading "${head.slice(0, 46)}…"`);
  }
}

// 2p · A HEADING OR BOX TITLE STATING A COUNT MUST MATCH THE LIST IT HEADS. §02.3's heading
// read "Six hazard classes" over a list of ten, and its tooltip matched the heading exactly —
// so check 2o (tooltip vs heading) PASSED on both being stale. Naming text drifts as a group:
// you write a heading and its tooltip in one edit and revise neither afterwards, so comparing
// two pieces of naming text to each other cannot catch the common case. Compare to the CONTENT.
{
  const WORDS = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
                  eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16,
                  seventeen:17, eighteen:18, nineteen:19, twenty:20 };
  const named = Object.keys(WORDS).join('|');
  const re_ = new RegExp(`<(h[23]|p)[^>]*>((?:(?!</\\1>).)*?\\b(${named}|\\d{1,2})\\b(?:(?!</\\1>).)*?)</\\1>`, 'gi');
  for (const m of h.matchAll(re_)) {
    const text = m[2].replace(/<[^>]+>/g, ' ');
    // only headings/titles that count LIST ITEMS — "N classes", "N arguments", "N steps"
    const cm = text.match(new RegExp(`\\b(${named}|\\d{1,2})\\s+(hazard classes|classes|arguments|failure classes|steps|readings|proofs)\\b`, 'i'));
    if (!cm) continue;
    const stated = WORDS[cm[1].toLowerCase()] ?? Number(cm[1]);
    // count top-level <li> in the first list that follows
    const after = h.slice(m.index + m[0].length, m.index + m[0].length + 30000);
    const ls = after.search(/<(ul|ol)\b/);
    if (ls < 0) continue;
    let depth = 0, items = 0;
    for (const t of after.slice(ls).matchAll(/<(\/?)(ul|ol|li)\b[^>]*>/g)) {
      const tag = t[2], closing = Boolean(t[1]);
      if (tag === 'ul' || tag === 'ol') { depth += closing ? -1 : 1; if (depth === 0) break; }
      else if (tag === 'li' && !closing && depth === 1) items++;
    }
    if (items && stated !== items)
      note('counts', `"${cm[0]}" heads a list of ${items} items — state the list, not the number ` +
                     `(§07.1: forbidding the count is the free remedy)`);
  }
}

// 2q · THE HAZARD-CLASS LIST MUST BE REACHABLE BY ID, AND ITS ITEMS COUNTED. Three separate
// checks this session anchored on prose and measured the wrong list — the free-text-anchor
// hazard that check 2f already documents. The box now carries id="hazard-classes"; anything
// that needs to count these classes anchors there, and this check fails loudly if the id
// disappears rather than silently counting something else.
{
  const i = h.indexOf('id="hazard-classes"');
  if (i < 0) note('structure', 'the hazard-class box has lost its id="hazard-classes" — any check that ' +
                               'counts those classes will silently measure a different list');
  else {
    const start = h.indexOf('<ol', i);
    let depth = 0, items = 0;
    for (const m of h.slice(start).matchAll(/<(\/?)(ol|ul|li)\b[^>]*>/g)) {
      const tag = m[2], closing = Boolean(m[1]);
      if (tag === 'ol' || tag === 'ul') { depth += closing ? -1 : 1; if (depth === 0) break; }
      else if (tag === 'li' && !closing && depth === 1) items++;
    }
    // No expected total: the count is deliberately unstated in the prose (§07.1's free remedy).
    // What is asserted is that the list is non-trivial and reachable — a zero here means the
    // structure moved and every downstream count is measuring nothing.
    if (items < 5) note('structure', `the hazard-class list under #hazard-classes has ${items} top-level ` +
                                     `items — the structure has probably moved`);
  }
}

// 3 · RETRACTIONS — nothing retracted may be asserted before the corrections section
// Split at the §07.1 HEADING, not the first textual mention — the table of contents
// references it ~150KB earlier, which silently truncated this check's scope to the
// first 37KB of a 288KB document and made it almost entirely vacuous.
const cutM = h.match(/<h3[^>]*id="s07-1"[^>]*>/) || h.match(/<h3[^>]*>07\.1 · Corrections/);
if (!cutM) note('retractions', 'could not locate the §07.1 heading — retraction check did not run');
const cut = cutM ? cutM.index : h.length;
const live = h.slice(0, cut).replace(/<[^>]+>/g, ' ');
for (const [what, re] of Object.entries({
  'session double probe': /guaranteed miss on every session|reverse the probe order/i,
  'the version poll':     /5-minute setInterval|48 KV reads\/hour/i,
  'course-journey N+1':   /course-journey-service\.ts:894|3 trips per row/i,
  'org-info 3 queries':   /org-info'?s 3 queries/i,
  'the 1→2→3 gate':       /must precede action 3/i,
})) if (re.test(live)) note('retractions', `"${what}" is still asserted as live`);

// 4 · SUPERSEDED FIGURES — an old value may appear ONLY in the record of its correction
for (const [stale, live_, allowed] of [
  ['32 sites', '85 construction sites', 1],
  ['4 files', '9 files', 1],          // only the hazard record; "4 driver files" does not match
  ['5 declarations', '12 declarations', 1],
  // The endpoint count went 186 → 190 → ~199 and keeps growing, so the document now states it
  // as “roughly two hundred” (§07.1's fourth remedy: the durable form outlives the precise one).
  // Allowance 2: the hazard record, plus the sentence explaining why the figure is approximate.
  // This entry said ['186','190',1] until that change — the THIRD time this guard has itself been
  // stale, which is the argument for deriving a count rather than registering one where possible.
  ['186', '~200', 2],
  // The document must not state a wrangler.jsonc FILE COUNT: every claim about them is
  // universal ("not enabled in any", "unset in every"), so a number is decoration that can
  // only drift — and it did, from "ten" to the actual 11. verify-actions.mjs counts them live.
  ['all ten <code>wrangler.jsonc</code>', 'every wrangler.jsonc (the claim is universal)', 0],
  ['ten <code>wrangler.jsonc</code> files', 'every wrangler.jsonc (the claim is universal)', 0],
  ['8 subrequests', '13 subrequests', 1],   // the hazard record
  // The chain is 16–17 → 24 → 31. Both intermediates are now superseded, and the live value
  // is ~31. This entry read ['16–17', '~24', 1] until the drift was found — the GUARD was
  // itself stale, naming a retired figure as current, which is the failure it exists to catch.
  ['16–17', '~31', 2],   // 2: the hazard record, plus the class description that cites the chain
  // NOT superseded after all: ~24 is the fan-out contribution (13 subrequests, DEFECT 3)
  // and ~31 is the total per render. Same unit, different scopes — registering 24 as retired
  // was itself the error, and briefly unified two real figures into one wrong one.
  ['seven fixes', null, 0],
]) {
  const esc = stale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \b before a digit is not enough — "34 files" contains "4 files"
  // Exclude a preceding digit/dot ("34 files" contains "4 files") AND a preceding "v"
  // — the document's own revision marker (v186) collided with the superseded endpoint
  // count 186. A version number can shadow a tracked figure.
  const n = (h.match(new RegExp(`(?<![\\d.v])${esc}`, 'g')) || []).length;
  if (n > allowed) note('figures', `"${stale}" appears ${n}× (allowed ${allowed}${live_ ? `; current value is ${live_}` : ''})`);
}

// NOT CHECKED HERE, DELIBERATELY: "a sentence must survive the removal of its own
// parenthetical". check-summary.mjs enforces that on the decision page, and it is the right
// check there — that document is built to be skimmed, so a sentence whose grammar lives inside
// a .tiny aside breaks for half its readers. Ported here on 2026-08-30, it found one genuine
// instance ("85 construction sites across 34 files" + an aside + ", optional parameter") among
// four false positives from this file's own notation: bead shorthand (".6's idle poll") and CSS
// class names in prose (".p-d1 and .p-edge"), each of which reads as a full stop plus text.
//
// The judgement, recorded rather than left silent: this document is a 511 KB audit trail, and
// its readers are the ones who WANT the asides. Sweeping every parenthetical here is a large
// job with a small payoff, and a checker that fires four false positives per real one trains
// its owner to ignore it. If this file ever becomes something people skim, port the check.

if (fail.length) { console.error(`✗ ${fail.length} problem(s):\n` + fail.map(f => '  ' + f).join('\n')); process.exit(1); }
console.log(`✓ ${target.replace('./','')} consistent — structure, action identity, retractions, superseded figures`);
