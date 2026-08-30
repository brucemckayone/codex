/**
 * Self-test for the data-access contract drift gate (Codex-ea1hd, WP9).
 *
 * "A check that has never failed has proven nothing" is the bead's acceptance
 * criterion, so every rule here is asserted in BOTH directions: a fixture that
 * must be caught, and the near-miss shape that must NOT be. Rule 5 carries one
 * extra obligation the other two do not: its defect was invisible to the
 * obvious audit command, so one of its cases runs that command alongside the
 * gate and asserts they DISAGREE — a rule that inherits the bug's blind spot
 * certifies the drift instead of catching it. The near-misses are
 * the load-bearing half — a gate that flags `Strict-Transport-Security` or a
 * JSDoc block that documents the presets gets switched off within a week, and a
 * gate switched off is a convention again.
 *
 * Run with node's built-in runner (`node --test`) rather than vitest: the thing
 * under test is a plain `.mjs` CLI with no dependencies, and this suite must
 * stay runnable in the static-analysis CI job, which has no database.
 *
 * Each case builds a throwaway fixture tree and points the exported collectors
 * at it. The real repo tree is never written, and is READ by exactly one case —
 * "the derived preset menu matches the REAL vocabulary" — which is marked as
 * such. That one has to touch the real file: its whole subject is whether the
 * failure message and `packages/constants/src/limits.ts` still agree, and a
 * fixture cannot answer that. It is also the only case that can catch
 * `readCachePresets()` silently falling into its fail-soft `[]` branch because
 * the real file's shape moved.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import {
  classifySearchFieldValue,
  collectCacheControlViolations,
  collectFloatingKvWriteViolations,
  collectSearchBuilderViolations,
  formatPresetMenu,
  formatSearchBuilderGuidance,
  isCacheControlValue,
  isKvReceiver,
  readCachePresets,
  searchValueHead,
  tokenize,
} from './check-data-access-contract.mjs';

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dac-gate-'));
  mkdirSync(join(root, 'workers/content-api/src'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeFixture(relPath, content) {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const WORKER_SRC = 'workers/content-api/src';

function scanCache(extraRoots = []) {
  return collectCacheControlViolations({
    roots: [join(root, WORKER_SRC), ...extraRoots.map((r) => join(root, r))],
    cwd: root,
  });
}

function scanKv() {
  return collectFloatingKvWriteViolations({
    roots: [join(root, WORKER_SRC)],
    cwd: root,
  });
}

function scanSearch() {
  return collectSearchBuilderViolations({
    roots: [join(root, WORKER_SRC)],
    cwd: root,
  });
}

// ===========================================================================
// RULE 3 — CAUGHT
// ===========================================================================

test('RULE 3 CATCHES a hand-written shared-window Cache-Control', () => {
  writeFixture(
    `${WORKER_SRC}/routes/leaky.ts`,
    "export const h = { 'Cache-Control': 'public, max-age=0, s-maxage=300' };\n"
  );
  const { violations } = scanCache();
  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, `${WORKER_SRC}/routes/leaky.ts`);
  assert.equal(violations[0].line, 1);
  assert.equal(violations[0].severity, 'shared-window');
});

test('RULE 3 CATCHES the exact 2026-05-28 leak string reintroduced', () => {
  writeFixture(
    `${WORKER_SRC}/routes/regression.ts`,
    [
      'export const DYNAMIC_PUBLIC_REVALIDATE = {',
      "  'Cache-Control':",
      "    'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',",
      '};',
    ].join('\n')
  );
  const { violations } = scanCache();
  assert.equal(violations.length, 1);
  assert.equal(violations[0].severity, 'shared-window');
  assert.equal(violations[0].line, 3);
});

test('RULE 3 CATCHES an off-vocabulary value with no shared window', () => {
  writeFixture(
    `${WORKER_SRC}/routes/off.ts`,
    "export const H = { 'Cache-Control': 'private, no-store' };\n"
  );
  const { violations } = scanCache();
  assert.equal(violations.length, 1);
  assert.equal(violations[0].severity, 'off-vocabulary');
});

test('RULE 3 CATCHES headers.set(\'cache-control\', ...) — the R2-metadata discriminator must not over-waive', () => {
  // The quoted HTTP header name is textually distinct from the camelCase R2
  // PutOptions field, and that distinction is the whole discriminator. If it
  // ever starts matching, this response header goes unchecked.
  writeFixture(
    `${WORKER_SRC}/proxy.ts`,
    "headers.set('cache-control', 'public, max-age=3600, s-maxage=86400');\n"
  );
  const { violations } = scanCache();
  assert.equal(violations.length, 1);
  assert.equal(violations[0].severity, 'shared-window');
});

// ===========================================================================
// RULE 3 — NEAR-MISSES THAT MUST PASS
// ===========================================================================

test('RULE 3 PASSES a preset reference', () => {
  writeFixture(
    `${WORKER_SRC}/routes/ok.ts`,
    [
      "import { CACHE_PRESETS } from '@codex/constants';",
      "export const H = { 'Cache-Control': CACHE_PRESETS.public };",
    ].join('\n')
  );
  assert.deepEqual(scanCache().violations, []);
});

test('RULE 3 PASSES a JSDoc block that DOCUMENTS the presets', () => {
  // ~20 comment blocks in the repo quote these values, including the table at
  // the top of apps/web/src/lib/server/cache.ts. A line grep flags all of them.
  writeFixture(
    `${WORKER_SRC}/routes/documented.ts`,
    [
      '/**',
      " * | `public`     | `public, max-age=60, s-maxage=60` |",
      " * | `per-viewer` | `public, max-age=0, no-cache`     |",
      ' *',
      " * The old value was 'public, max-age=0, s-maxage=300' and it leaked.",
      ' */',
      "// Also inline: 'public, max-age=3600, s-maxage=3600'",
      'export const X = 1;',
    ].join('\n')
  );
  assert.deepEqual(scanCache().violations, []);
});

test('RULE 3 PASSES a Strict-Transport-Security value', () => {
  writeFixture(
    `${WORKER_SRC}/headers.ts`,
    [
      "h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');",
      "h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');",
    ].join('\n')
  );
  assert.deepEqual(scanCache().violations, []);
});

test('RULE 3 PASSES a Set-Cookie attribute string', () => {
  writeFixture(
    `${WORKER_SRC}/theme.ts`,
    'document.cookie = `theme=${t};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;\n'
  );
  assert.deepEqual(scanCache().violations, []);
});

test('RULE 3 PASSES an R2 cacheControl PUT option, inline and via a ternary', () => {
  writeFixture(
    `${WORKER_SRC}/upload.ts`,
    [
      'const OPTS = {',
      "  contentType: 'image/webp',",
      "  cacheControl: 'public, max-age=31536000, immutable',",
      '};',
      'const cacheControl =',
      "  mime === 'image/svg+xml'",
      "    ? 'public, max-age=3600'",
      "    : 'public, max-age=31536000';",
      'export { OPTS, cacheControl };',
    ].join('\n')
  );
  assert.deepEqual(scanCache().violations, []);
});

test('RULE 3 PASSES the presets file itself, and only it', () => {
  writeFixture(
    'packages/constants/src/limits.ts',
    [
      'export const CACHE_PRESETS = {',
      "  public: 'public, max-age=60, s-maxage=60',",
      "  'per-viewer': 'public, max-age=0, no-cache',",
      '} as const;',
    ].join('\n')
  );
  writeFixture(
    'packages/other/src/copy.ts',
    "export const C = { 'Cache-Control': 'public, max-age=60, s-maxage=60' };\n"
  );
  const { violations } = scanCache([
    'packages/constants/src',
    'packages/other/src',
  ]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, 'packages/other/src/copy.ts');
});

test('RULE 3 skips test files and __tests__ directories', () => {
  writeFixture(
    `${WORKER_SRC}/routes/__tests__/cache.test.ts`,
    "expect(h).toBe('public, max-age=0, s-maxage=300');\n"
  );
  writeFixture(
    `${WORKER_SRC}/routes/other.spec.ts`,
    "expect(h).toBe('public, max-age=0, s-maxage=300');\n"
  );
  writeFixture(
    `${WORKER_SRC}/routes/rule.type-check.ts`,
    "policy: { cache: 'public, max-age=60' };\n"
  );
  assert.deepEqual(scanCache().violations, []);
});

// ===========================================================================
// RULE 4 — CAUGHT
// ===========================================================================

test('RULE 4 CATCHES the exact defect WP4 fixed: kv.put(...).catch(() => {})', () => {
  writeFixture(
    `${WORKER_SRC}/org-helpers.ts`,
    'if (kv) {\n  kv.put(cacheKey, org.id).catch(() => {});\n}\n'
  );
  const { violations } = scanKv();
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 2);
  assert.equal(violations[0].text, 'kv.put(...)');
});

test('RULE 4 CATCHES a floating write on a named KV binding', () => {
  writeFixture(
    `${WORKER_SRC}/auth.ts`,
    "env.AUTH_SESSION_KV.put(`verification:${email}`, token);\n"
  );
  const { violations } = scanKv();
  assert.equal(violations.length, 1);
  assert.equal(violations[0].text, 'env.AUTH_SESSION_KV.put(...)');
});

test('RULE 4 CATCHES a floating write whose named promise is never handed off', () => {
  writeFixture(
    `${WORKER_SRC}/orphan.ts`,
    'const write = kv.put(k, v).catch(() => {});\nreturn org.id;\n'
  );
  assert.equal(scanKv().violations.length, 1);
});

// ===========================================================================
// RULE 4 — LEGAL SHAPES THAT MUST PASS
// ===========================================================================

test('RULE 4 PASSES an awaited write', () => {
  writeFixture(
    `${WORKER_SRC}/revocation.ts`,
    'await this.kv.put(this.key(u, o), JSON.stringify(v), { expirationTtl: 900 });\n'
  );
  assert.deepEqual(scanKv().violations, []);
});

test('RULE 4 PASSES a returned write', () => {
  writeFixture(`${WORKER_SRC}/ret.ts`, 'return kv.put(k, v);\n');
  assert.deepEqual(scanKv().violations, []);
});

test('RULE 4 PASSES a write handed straight to an ownership call', () => {
  writeFixture(
    `${WORKER_SRC}/direct.ts`,
    [
      'ctx.cacheWrite(kv.put(k, v));',
      'c.executionCtx.waitUntil(env.CACHE_KV.put(k, v));',
      'ctx.background(kv.put(k, v));',
    ].join('\n')
  );
  assert.deepEqual(scanKv().violations, []);
});

test('RULE 4 PASSES the named-promise hand-off, including the optional-call form', () => {
  writeFixture(
    `${WORKER_SRC}/handoff.ts`,
    'const write = kv.put(cacheKey, org.id).catch(() => {});\ncacheWrite?.(write);\n'
  );
  assert.deepEqual(scanKv().violations, []);
});

test('RULE 4 PASSES the VersionedCache shape: multi-line chain, hand-off 19 lines later', () => {
  // The real writeCacheSlot puts a guard and a 7-line comment between the
  // declaration and this.waitUntil(write). A tight look-ahead window would
  // false-flag correct cache-layer code — which is why the scope is the
  // promise's lifetime and not a path allowlist.
  const filler = Array.from(
    { length: 15 },
    (_, i) => `  // filler line ${i}`
  ).join('\n');
  writeFixture(
    `${WORKER_SRC}/versioned-cache.ts`,
    [
      'private writeCacheSlot(cacheKey: string, data: unknown): void {',
      '  const write = this.kv',
      '    .put(cacheKey, JSON.stringify(data), { expirationTtl: 60 })',
      '    .catch(() => {});',
      '',
      '  if (!this.waitUntil) return;',
      filler,
      '  try {',
      '    this.waitUntil(write);',
      '  } catch {}',
      '}',
    ].join('\n')
  );
  assert.deepEqual(scanKv().violations, []);
});

test('RULE 4 PASSES a floating put on a non-KV receiver', () => {
  // R2 and Durable Object storage have their own semantics; this rule is about
  // KV cache writes only, and says so.
  writeFixture(
    `${WORKER_SRC}/r2.ts`,
    'bucket.put(key, body);\nstorage.put(key, body);\nmap.put(k, v);\n'
  );
  assert.deepEqual(scanKv().violations, []);
});

test('RULE 4 PASSES a commented-out floating write', () => {
  writeFixture(
    `${WORKER_SRC}/commented.ts`,
    [
      '// kv.put(cacheKey, org.id).catch(() => {});',
      '/* kv.put(a, b); */',
      'await kv.put(cacheKey, org.id);',
    ].join('\n')
  );
  assert.deepEqual(scanKv().violations, []);
});

// ===========================================================================
// Fail-closed and unit-level behaviour
// ===========================================================================

test('an empty scan reports 0 files, which the CLI treats as a misconfiguration', () => {
  const { filesScanned } = collectCacheControlViolations({
    roots: [join(root, 'does/not/exist')],
    cwd: root,
  });
  assert.equal(filesScanned, 0);
});

test('tokenize blanks comments without shifting line numbers', () => {
  const src = "const a = 1; // 'public, max-age=60'\nconst b = 'x';\n";
  const { code, strings } = tokenize(src);
  assert.equal(code.split('\n').length, src.split('\n').length);
  assert.deepEqual(
    strings.map((s) => s.value),
    ['x']
  );
});

test('isCacheControlValue separates the header from its look-alikes', () => {
  assert.equal(isCacheControlValue('public, max-age=60, s-maxage=60'), true);
  assert.equal(isCacheControlValue('private, no-store'), true);
  assert.equal(isCacheControlValue('public, max-age=0, no-cache'), true);
  assert.equal(
    isCacheControlValue('max-age=31536000; includeSubDomains; preload'),
    false
  );
  assert.equal(isCacheControlValue('application/xml; charset=utf-8'), false);
  assert.equal(isCacheControlValue('public'), false);
});

test('isKvReceiver matches the repo\'s KV binding names and nothing else', () => {
  assert.equal(isKvReceiver('kv'), true);
  assert.equal(isKvReceiver('this.kv'), true);
  assert.equal(isKvReceiver('env.CACHE_KV'), true);
  assert.equal(isKvReceiver('platform.env.AUTH_SESSION_KV'), true);
  assert.equal(isKvReceiver('bucket'), false);
  assert.equal(isKvReceiver('this.r2'), false);
  assert.equal(isKvReceiver('storage'), false);
});


// ===========================================================================
// The failure message's preset menu — derived, so it cannot go stale
// ===========================================================================
//
// WHY THESE EXIST. The menu was four hand-typed lines and `CACHE_PRESETS` grew
// to six, so the gate would have told an author with a legitimate sitemap or
// R2-proxy response that no preset fits — pushing them toward a waiver request
// or a hand-written header, i.e. toward the exact drift rule 3 exists to stop.
// A stale menu is a WRONG INSTRUCTION, which is worse than a missing one.

test('readCachePresets parses names and values, and derives the shared-window split from the VALUE', () => {
  writeFixture(
    'presets/limits.ts',
    [
      '/**',
      " * Docs that mention 'decoy, max-age=1, s-maxage=1' and a name: fake.",
      ' */',
      'export const CACHE_PRESETS = {',
      "  public: 'public, max-age=60, s-maxage=60',",
      "  static: 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',",
      "  'per-viewer': 'public, max-age=0, no-cache',",
      "  fresh: 'private, no-store',",
      '} as const;',
      '',
    ].join('\n')
  );
  const presets = readCachePresets(join(root, 'presets/limits.ts'));
  assert.deepEqual(
    presets.map((x) => x.name),
    ['public', 'static', 'per-viewer', 'fresh'],
    'quoted and bare keys both parse, in declaration order, and the JSDoc decoy above the object contributes nothing'
  );
  // The classification is a function of the value, never of a second list.
  assert.deepEqual(
    presets.map((x) => x.sharedWindow),
    [true, true, false, false]
  );
});

test('readCachePresets FAILS SOFT on a file it cannot read or parse, and the menu says where to look', () => {
  assert.deepEqual(readCachePresets(join(root, 'nope/limits.ts')), []);
  writeFixture('empty/limits.ts', 'export const SOMETHING_ELSE = 1;\n');
  assert.deepEqual(readCachePresets(join(root, 'empty/limits.ts')), []);
  const menu = formatPresetMenu([]);
  assert.match(menu, /packages\/constants\/src\/limits\.ts/);
  // Fail-soft must not become fail-open: the message still refuses a waiver.
  assert.doesNotMatch(menu, /'public'/);
});

test('formatPresetMenu lists EVERY preset it is given, on both sides of the split', () => {
  const menu = formatPresetMenu([
    { name: 'alpha', value: 'public, max-age=1, s-maxage=1', sharedWindow: true },
    { name: 'beta', value: 'private, no-store', sharedWindow: false },
  ]);
  assert.match(menu, /'alpha'\s+public, max-age=1, s-maxage=1/);
  assert.match(menu, /'beta'\s+private, no-store/);
  assert.match(menu, /IDENTICAL FOR EVERY VIEWER[\s\S]*'alpha'/);
  assert.match(menu, /MAY DIFFER PER VIEWER[\s\S]*'beta'/);
  // The invariant an author is meant to apply, not a window-length heuristic.
  assert.match(menu, /would two different viewers get the same bytes/);
  assert.match(menu, /it has none by design/);
});

test('the derived preset menu matches the REAL vocabulary (this case reads packages/constants/src/limits.ts)', () => {
  const real = readCachePresets();
  assert.ok(
    real.length > 0,
    'readCachePresets() fell into its fail-soft branch against the real limits.ts — the parse no longer matches that file, so every rule-3 failure would print a menu-less message. Fix readCachePresets, do not delete this test.'
  );
  const menu = formatPresetMenu(real);
  for (const { name, value } of real) {
    assert.ok(
      menu.includes(`'${name}'`),
      `preset '${name}' exists in CACHE_PRESETS but is missing from the failure message`
    );
    assert.ok(
      menu.includes(value),
      `preset '${name}' is listed without its value in the failure message`
    );
  }
});

// ===========================================================================
// RULE 5 — CAUGHT
// ===========================================================================
//
// WHY EVERY SPELLING GETS ITS OWN CASE. The original defect survived because
// its two "fixed" sites were written `z.string().trim().min(1)`, so the obvious
// audit command — a literal grep for `z.string().min` — matched NONE of the
// twelve declarations and reported the tree clean. A rule with the same blind
// spot as the bug is worse than no rule, because it certifies the drift. So the
// bare spelling and the `.trim().min(1)` spelling are asserted separately, and
// one case runs the naive grep alongside the gate to show they disagree.

test('RULE 5 CATCHES a bare search: z.string()', () => {
  writeFixture(
    `${WORKER_SRC}/schemas.ts`,
    'export const q = z.object({\n  search: z.string(),\n});\n'
  );
  const { violations, declarationsFound } = scanSearch();
  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, `${WORKER_SRC}/schemas.ts`);
  assert.equal(violations[0].line, 2);
  assert.equal(violations[0].field, 'search');
  assert.equal(violations[0].kind, 'raw-zod');
  assert.equal(violations[0].head, 'z.string()');
  assert.equal(declarationsFound, 1);
});

test('RULE 5 CATCHES the z.string().trim().min(1) spelling that a literal `z.string().min` grep MISSES', () => {
  const source = 'export const q = z.object({\n  search: z.string().trim().min(1),\n});\n';
  writeFixture(`${WORKER_SRC}/trimmed.ts`, source);

  // The blind spot, demonstrated on the same bytes: this is the audit command
  // the bead records as returning 0 across both trees, and it still does.
  assert.equal(
    source.split('\n').filter((l) => /^\s*search:\s*z\.string\(\)\.min/.test(l))
      .length,
    0,
    'the naive grep is supposed to miss this — if it now matches, this case has stopped testing the blind spot and needs rewriting'
  );

  const { violations } = scanSearch();
  assert.equal(violations.length, 1, 'the gate must NOT share the naive grep blind spot');
  assert.equal(violations[0].head, 'z.string().trim().min(1)');
  assert.equal(violations[0].kind, 'raw-zod');
});

test('RULE 5 CATCHES every other Zod spelling, invented or not', () => {
  writeFixture(
    `${WORKER_SRC}/spellings.ts`,
    [
      'export const a = z.object({ search: z.string().optional() });',
      'export const b = z.object({ search: z.coerce.string() });',
      'export const c = z.object({ search: z.string().trim().max(255) });',
      'export const d = z.object({ search: zod.string() });',
    ].join('\n')
  );
  const { violations } = scanSearch();
  assert.deepEqual(
    violations.map((v) => v.head),
    [
      'z.string().optional()',
      'z.coerce.string()',
      'z.string().trim().max(255)',
      'zod.string()',
    ],
    'the rule looks for the ABSENCE of the builder, so a spelling nobody has invented yet fails too'
  );
});

test('RULE 5 CATCHES a search field built from a hand-rolled named schema', () => {
  // The indirection dodge: move `z.string()` one line up and the field no
  // longer reads as Zod. An identifier ending `Schema` is still a schema.
  writeFixture(
    `${WORKER_SRC}/indirect.ts`,
    [
      'const localSearchSchema = z.string().trim().min(1);',
      'export const q = z.object({ search: localSearchSchema });',
    ].join('\n')
  );
  const { violations } = scanSearch();
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, 'foreign-schema');
  assert.equal(violations[0].head, 'localSearchSchema');
});

test('RULE 5 CATCHES the un-invoked builder — createSearchQuerySchema without its call', () => {
  // `search: createSearchQuerySchema` assigns the FUNCTION, not a schema. It
  // must not pass just because the right identifier appears: the conforming
  // test is `createSearchQuerySchema(`, with the paren.
  writeFixture(
    `${WORKER_SRC}/uninvoked.ts`,
    'export const q = z.object({ search: createSearchQuerySchema });\n'
  );
  const { violations } = scanSearch();
  assert.equal(violations.length, 1);
  assert.equal(violations[0].head, 'createSearchQuerySchema');
});

test('RULE 5 CATCHES every name in the stated family, including the ?q= spelling', () => {
  writeFixture(
    `${WORKER_SRC}/family.ts`,
    [
      'export const a = z.object({ q: z.string() });',
      'export const b = z.object({ searchQuery: z.string() });',
      'export const c = z.object({ searchTerm: z.string() });',
      'export const d = z.object({ searchText: z.string() });',
      'export const e = z.object({ searchString: z.string() });',
    ].join('\n')
  );
  const { violations } = scanSearch();
  assert.deepEqual(
    violations.map((v) => v.field),
    ['q', 'searchQuery', 'searchTerm', 'searchText', 'searchString'],
    'each longer name must be captured WHOLE — `searchQuery` reported as `search` would mean the key regex stopped at the shorter alternative'
  );
});

test('RULE 5 CATCHES a declaration whose value sits on the next line', () => {
  writeFixture(
    `${WORKER_SRC}/wrapped.ts`,
    ['export const q = z.object({', '  search:', '    z.string(),', '});'].join('\n')
  );
  const { violations } = scanSearch();
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 2, 'reported at the KEY, which is where the fix goes');
  assert.equal(violations[0].head, 'z.string()');
});

test('RULE 5 CATCHES a declaration inside a .svelte module script', () => {
  writeFixture(
    `${WORKER_SRC}/Widget.svelte`,
    [
      '<script lang="ts">',
      "  const argsSchema = z.object({ search: z.string() });",
      '</script>',
      '<input />',
    ].join('\n')
  );
  const { violations } = scanSearch();
  assert.equal(violations.length, 1);
  assert.equal(violations[0].head, 'z.string()');
});

// ===========================================================================
// RULE 5 — NEAR-MISSES THAT MUST PASS
// ===========================================================================
//
// This half is the load-bearing half. The repo has far more `search:`-keyed
// DATA than `search:` declarations — spread objects, URL params, props
// interfaces, an icon map, even a CSS selector — and a rule that flags any of
// them fails the build on conforming code and gets switched off.

test('RULE 5 PASSES the builder, and the one composed form the tree needs', () => {
  // listUserLibrarySchema must land `search` as '' rather than undefined
  // (packages/validation/src/schemas/access.test.ts asserts that defaults
  // object), so the composed form is legal. A check that accepted only a bare
  // call would flag the one site that cannot be written any other way.
  writeFixture(
    `${WORKER_SRC}/conforming.ts`,
    [
      'export const a = z.object({ search: createSearchQuerySchema(255) });',
      "export const b = z.object({ search: createSearchQuerySchema(200).default('') });",
      'export const c = z.object({ search: createSearchQuerySchema() });',
      'export const d = z.object({',
      '  search: createSearchQuerySchema(',
      '    120',
      '  ),',
      '});',
    ].join('\n')
  );
  const { violations, declarationsFound } = scanSearch();
  assert.deepEqual(violations, []);
  assert.equal(declarationsFound, 4, 'conforming declarations still COUNT — that count is what proves the rule has a subject');
});

test('RULE 5 PASSES search-keyed DATA: spreads, URL params, props types, an icon map', () => {
  writeFixture(
    `${WORKER_SRC}/data.ts`,
    [
      'onFilterChange({ ...filters, search: value });',
      "onFilterChange({ ...filters, search: '' });",
      'const args = { ...(urlSearch && { search: urlSearch }) };',
      "const p = new URLSearchParams({ search: q, limit: String(limit) });",
      "const s = { search: page.url.searchParams.get('search') ?? '' };",
      'export const RAIL_ICONS = { search: SearchIcon };',
      'export interface Filters { search: string; contentType: string }',
      'const forwarded = { search: input.search };',
      'const fromCtx = { search: ctx.input.query.search };',
    ].join('\n')
  );
  assert.deepEqual(scanSearch().violations, []);
  assert.equal(scanSearch().declarationsFound, 0, 'none of these is a declaration');
});

test('RULE 5 PASSES a z.infer / z.input / z.output TYPE position', () => {
  writeFixture(
    `${WORKER_SRC}/types.ts`,
    [
      'type A = { search: z.infer<typeof searchField> };',
      'type B = { search: z.input<typeof searchField> };',
      'type C = { search: z.output<typeof searchField> };',
    ].join('\n')
  );
  assert.deepEqual(scanSearch().violations, []);
});

test('RULE 5 PASSES a CSS selector containing --search: in a .svelte file', () => {
  // MobileBottomNav.svelte really contains `.bottom-nav__tab--search:active`.
  // NOTE WHAT THIS CASE DOES AND DOES NOT PROVE: it passes because `active {
  // opacity: 0.6; }` is not a schema head, so it would still pass with the
  // lookbehind removed. It documents the real-tree shape; the lookbehind itself
  // is falsified by the `content_search:` / `'org-search':` cases above.
  writeFixture(
    `${WORKER_SRC}/Nav.svelte`,
    [
      '<nav></nav>',
      '<style>',
      '  .bottom-nav__tab--search:active { opacity: 0.6; }',
      '  .bottom-nav__tab--search:active .circle { transform: scale(0.94); }',
      '</style>',
    ].join('\n')
  );
  assert.deepEqual(scanSearch().violations, []);
  assert.equal(scanSearch().declarationsFound, 0);
});

test("RULE 5 PASSES procedure()'s `query:` input slot — the deliberate narrowing, pinned", () => {
  // `query` is NOT in SEARCH_FIELD_NAMES and must not be added. It is
  // procedure()'s input-slot name and sits in this position 79 times across
  // workers/*/src; including it would turn the gate red on essentially every
  // route in the repo, which is not a stricter gate but a deleted one. The cost
  // — a genuine search facet NAMED `query` is invisible — is stated in the
  // header. If someone adds `query` to the family, this case goes red and says
  // why.
  writeFixture(
    `${WORKER_SRC}/routes/content.ts`,
    [
      'procedure({ input: { query: contentQuerySchema } });',
      'procedure({ input: { params: idParamSchema, query: orgScopeQuerySchema } });',
    ].join('\n')
  );
  assert.deepEqual(scanSearch().violations, []);
});

test('RULE 5 PASSES a commented-out violation, and prose that quotes one', () => {
  writeFixture(
    `${WORKER_SRC}/commented.ts`,
    [
      '// search: z.string(),',
      '/* There were twelve `search: z.string()` declarations. */',
      '/**',
      ' * @example',
      ' *   search: z.string().trim().min(1),',
      ' */',
      'export const q = z.object({ search: createSearchQuerySchema(255) });',
    ].join('\n')
  );
  const { violations, declarationsFound } = scanSearch();
  assert.deepEqual(violations, []);
  assert.equal(
    declarationsFound,
    1,
    'search-schema.ts documents the bad spellings in its own module comment; if prose counted, the builder file would fail its own rule'
  );
});

test('RULE 5 skips test files and __tests__ directories', () => {
  writeFixture(
    `${WORKER_SRC}/__tests__/search.test.ts`,
    'const bad = z.object({ search: z.string() });\n'
  );
  writeFixture(
    `${WORKER_SRC}/other.spec.ts`,
    'const bad = z.object({ search: z.string() });\n'
  );
  assert.deepEqual(scanSearch().violations, []);
});

test('RULE 5 does not read a longer identifier as the field name — this is what the lookbehind is for', () => {
  // These are the cases that FALSIFY the lookbehind: every one of them ends in
  // a family name and every one of them has a Zod value, so dropping
  // `(?<![\\w$.-])` from SEARCH_FIELD_KEY_RE turns all five into violations.
  // (The CSS-selector case below cannot falsify it — `active { ... }` is not a
  // schema head, so that fixture passes for the wrong reason without these.)
  writeFixture(
    `${WORKER_SRC}/lookalikes.ts`,
    [
      'export const a = z.object({ mySearch: z.string() });',
      'export const b = z.object({ content_search: z.string() });',
      "export const c = z.object({ 'org-search': z.string() });",
      'export const d = z.object({ faq: z.string() });',
      'export const e = z.object({ researchNotes: z.string() });',
    ].join('\n')
  );
  assert.deepEqual(
    scanSearch().violations,
    [],
    'a field whose name merely ENDS in a family name is a different field'
  );
  assert.equal(scanSearch().declarationsFound, 0);
});

// ===========================================================================
// RULE 5 — the fail-closed subject, and the unit-level predicates
// ===========================================================================

test('RULE 5 reports declarationsFound === 0 for a tree with no search facet — the state main() fails closed on', () => {
  // A rule can read green two ways: nothing is broken, or nothing is checked.
  // Renaming every `search` field away, or moving the declarations out of the
  // scanned roots, produces the second. main() exits 1 on this.
  writeFixture(
    `${WORKER_SRC}/nothing.ts`,
    "export const q = z.object({ page: z.number(), sort: z.enum(['asc']) });\n"
  );
  const { violations, filesScanned, declarationsFound } = scanSearch();
  assert.deepEqual(violations, []);
  assert.ok(filesScanned > 0, 'files were scanned...');
  assert.equal(declarationsFound, 0, '...but nothing in them was a subject');
});

test('classifySearchFieldValue judges both original spellings, the composed form, and the non-declarations', () => {
  const kind = (v) => classifySearchFieldValue(v)?.kind ?? null;

  // The two spellings the twelve declarations were actually written in.
  assert.equal(kind('z.string()'), 'raw-zod');
  assert.equal(kind('z.string().trim().min(1)'), 'raw-zod');

  // Conforming, including the one composed form the tree needs.
  assert.equal(kind('createSearchQuerySchema(255)'), 'conforming');
  assert.equal(kind("createSearchQuerySchema(200).default('')"), 'conforming');
  assert.equal(kind('createSearchQuerySchema()'), 'conforming');
  assert.equal(kind('\n    createSearchQuerySchema(120)'), 'conforming');

  // A named schema that is not the builder, and the un-invoked builder.
  assert.equal(kind('localSearchSchema'), 'foreign-schema');
  assert.equal(kind('createSearchQuerySchema'), 'foreign-schema');

  // Not declarations at all.
  assert.equal(kind('value'), null);
  assert.equal(kind("''"), null);
  assert.equal(kind('string;'), null);
  assert.equal(kind('SearchIcon'), null);
  assert.equal(kind('z.infer<typeof f>'), null);
  assert.equal(kind('active { opacity: 0.6; }'), null);
  assert.equal(kind(''), null);
});

test('searchValueHead quotes the expression and stops where it ends', () => {
  // A closer that belongs to the enclosing object is dropped; a closer that
  // belongs to the expression is kept, so the printed value stays recognisable
  // on sight rather than being mangled.
  assert.equal(searchValueHead('z.string().optional() });'), 'z.string().optional()');
  assert.equal(searchValueHead('z.string().max(5) });'), 'z.string().max(5)');
  assert.equal(searchValueHead('z.string(),\n  page: z.number(),'), 'z.string()');
  assert.equal(searchValueHead('localSearchSchema });'), 'localSearchSchema');
  assert.equal(searchValueHead('z.string()'), 'z.string()');
});

test('the rule-5 guidance names the right repair and refuses a waiver', () => {
  // A gate that forbids a shape without saying what to write instead gets
  // satisfied by whatever silences it — and here the intuitive silencer,
  // `.min(3)` on the server, is itself the regression. Same obligation as
  // rule 3's preset menu: the message has to carry the decision.
  const g = formatSearchBuilderGuidance();
  assert.match(g, /createSearchQuerySchema\(255\)/);
  assert.match(g, /createSearchQuerySchema\(200\)\.default\(''\)/);
  assert.match(g, /do NOT[\s\S]*\.min\(3\)/);
  assert.match(g, /CLIENT gate/);
  assert.match(g, /gateSearchQuery/);
  assert.match(g, /trigram/);
  assert.match(g, /packages\/validation\/src\/shared\/search-schema\.ts/);
  assert.match(g, /no waiver list by design/);
});

test('RULE 5 against the REAL tree: every declared search input uses the builder, and there are some (this case reads packages/ workers/ apps/)', () => {
  // The fixture cases prove the matcher. This one proves the matcher is still
  // POINTED AT SOMETHING — the failure mode a gate cannot detect about itself.
  // If SEARCH_FIELD_NAMES goes stale or a root moves, the fixtures stay green
  // and only this case notices.
  const { violations, declarationsFound } = collectSearchBuilderViolations();
  assert.deepEqual(
    violations.map((v) => `${v.file}:${v.line} ${v.field}: ${v.head}`),
    [],
    'a declared search input in the real tree is not built by createSearchQuerySchema()'
  );
  assert.ok(
    declarationsFound > 0,
    'rule 5 found ZERO search declarations in the real tree, so it is checking nothing — fix SEARCH_FIELD_NAMES or the scan roots, do not delete this test'
  );
});
