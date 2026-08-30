/**
 * Self-test for the data-access contract drift gate (Codex-ea1hd, WP9).
 *
 * "A check that has never failed has proven nothing" is the bead's acceptance
 * criterion, so every rule here is asserted in BOTH directions: a fixture that
 * must be caught, and the near-miss shape that must NOT be. The near-misses are
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
  collectCacheControlViolations,
  collectFloatingKvWriteViolations,
  formatPresetMenu,
  isCacheControlValue,
  isKvReceiver,
  readCachePresets,
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
