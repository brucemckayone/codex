#!/usr/bin/env node
/**
 * Data-access contract drift gate (Codex-ea1hd, WP9).
 *
 * WHY THIS FILE EXISTS. A contract that is not checked is a convention, and
 * this investigation found three conventions that did not survive contact with
 * the next file — one of them documented in the very file that then violated
 * it. An artefact stays true only if it sits in the path of the work that would
 * invalidate it. This script is that path: it runs in the static-analysis CI
 * job, needs no database, and fails the build on drift.
 *
 * ============================================================================
 * THE FIVE CHECKS, AND WHERE EACH ONE LIVES
 * ============================================================================
 *
 *  1. Every `procedure()` route resolves a cache policy.
 *     NOT HERE — enforced by the TYPE SYSTEM and a runtime default, which is
 *     strictly stronger than a grep. `policy.cache` is optional and
 *     `resolveCacheControl()` (packages/worker-utils/src/procedure/helpers.ts)
 *     falls back to `CACHE_PRESETS.private`, so "declares nothing" is not a
 *     hole — it is the safe preset. Pinned by
 *     `packages/worker-utils/src/procedure/__tests__/procedure-cache-control.test.ts`
 *     ("the undeclared default" describe block).
 *
 *  2. No authenticated route is publicly cacheable.
 *     NOT HERE — a TYPE ERROR. `CachePolicyRule` (procedure/types.ts) is
 *     intersected into every procedure config, so `auth: 'required' + cache:
 *     'public'` does not compile. Pinned in both directions by
 *     `procedure/__tests__/cache-policy-rule.type-check.ts`, whose
 *     `@ts-expect-error` directives fail the build (TS2578) if the rule ever
 *     stops rejecting. A grep could only approximate that.
 *
 *  3. No hand-written `Cache-Control`.  <-- IMPLEMENTED HERE (rule 3)
 *  4. No floating KV write in a request path.  <-- IMPLEMENTED HERE (rule 4)
 *
 *  5. Every search input uses the shared Zod search-input builder.
 *     DELIBERATELY NOT IMPLEMENTED, AND NOT AN OVERSIGHT. It depends on WP6's
 *     shared search-input builder, which the owner excluded from this PR
 *     because it needs a live database. CHECK 5 LANDS WITH WP6 — add it here,
 *     next to rules 3 and 4, when that builder exists.
 *
 * ============================================================================
 * RULE 3 — NO HAND-WRITTEN `Cache-Control`
 * ============================================================================
 *
 * `CACHE_PRESETS` (`packages/constants/src/limits.ts`) is the whole vocabulary.
 * A `Cache-Control` value written out anywhere else is drift, because the
 * reasoning that makes a window safe lives next to the preset and not next to
 * the copy.
 *
 * NO COUNT OF THE PRESETS IS STATED HERE, DELIBERATELY. This comment said "the
 * four presets" while `CACHE_PRESETS` held six — `static` and `asset` were
 * added when the sitemap routes and the two R2 proxies adopted the vocabulary,
 * and this file did not notice. A number stated from across a package boundary
 * about a list under active edit goes stale silently and cannot be checked from
 * here. The durable form is the invariant, which does not depend on how many
 * names exist: EVERY preset is a statement about who may STORE the body, and
 * NOTHING outside that file may state one. `CachePresetName` in limits.ts is
 * the authority on the names, and the failure messages below do NOT repeat it:
 * `readCachePresets()` parses that file, so the menu an author reads out of a
 * failure IS the vocabulary and cannot fall behind it.
 *
 * Two severities, BOTH fail the build. The split exists so a failure is
 * triaged for you, not so one of them is optional:
 *   - SHARED WINDOW: the literal carries `s-maxage` or `stale-while-revalidate`.
 *     This is the leak class. apps/web's `DYNAMIC_PUBLIC_REVALIDATE` was
 *     `public, max-age=0, s-maxage=300`: `max-age=0` fixes only the BROWSER
 *     half, while `s-maxage=300` still lets a shared cache hand one viewer's
 *     stored render to the next, because shared caches key on URL and NEVER on
 *     Cookie. CI caught it deterministically on 2026-05-28.
 *   - OFF-VOCABULARY: any other hand-written value. Not a leak on its own, but
 *     it is a value nobody can change centrally.
 *
 * WHAT COUNTS AS A `Cache-Control` VALUE — this is the check's SUBJECT, not an
 * exemption list. There are no per-file waivers and no allowlist anywhere in
 * this script; adding one would widen the gate permanently, and a check that
 * passes because it excludes the violations has proven nothing. What follows
 * are three things that are not this header at all:
 *
 *   a. STRICT-TRANSPORT-SECURITY. `max-age=31536000; includeSubDomains;
 *      preload` is HSTS — a different header with a different registry that
 *      happens to reuse the token `max-age`. Recognised by
 *      `includeSubDomains` / `preload`, and by carrying no cacheability
 *      directive at all. Live in packages/security/src/headers.ts and
 *      apps/web/src/hooks.server.ts.
 *   b. SET-COOKIE ATTRIBUTES. `...;path=/;max-age=31536000;SameSite=Lax` is a
 *      cookie attribute string. Recognised by `SameSite` / `path=` / `Secure`.
 *      Live in apps/web/src/lib/theme.svelte.ts.
 *   c. R2 STORED-OBJECT METADATA. `r2.put(key, body, {}, { cacheControl })`
 *      writes metadata onto an immutable, key-addressed blob at PUT time. It is
 *      not a per-request policy decision, and the presets — every one of which
 *      is about viewer-variance — cannot express it. Recognised by the R2
 *      field name `cacheControl` (camelCase identifier) as the literal's
 *      assignment target, which is textually distinct from the HTTP header name
 *      `Cache-Control` / `'cache-control'`. Live in
 *      packages/image-processing and packages/platform-settings.
 *
 * The vocabulary's own home, `packages/constants/src/limits.ts`, is where the
 * strings are ALLOWED to be written; that is what "outside the presets file"
 * means and it is the only path this rule treats specially.
 *
 * ============================================================================
 * RULE 4 — NO FLOATING KV WRITE
 * ============================================================================
 *
 * SCOPE, STATED: every non-test module under `packages/*&#47;src`,
 * `workers/*&#47;src` and `apps/web/src` — i.e. all request-reachable code.
 * Cache-layer internals and invalidation helpers are NOT excluded by path,
 * and they do not need to be, because the rule is about the promise's LIFETIME
 * and not about the caller's identity:
 *
 *   - `await kv.put(...)`                      legal anywhere — the response waits
 *   - `return kv.put(...)`                     legal anywhere
 *   - `ctx.cacheWrite(kv.put(...))`            legal anywhere — survives the response
 *   - `waitUntil(...)` / `ctx.background(...)` legal anywhere
 *   - `const w = kv.put(...); cacheWrite(w)`   legal anywhere — handed off
 *   - `const w = kv.put(...); cacheWrite?.(w)` ACCEPTED, BUT UNPROVEN — see below
 *   - `kv.put(...).catch(() => {})`            A BUG anywhere
 *
 * That last line is the defect WP4 fixed. A Workers response CANCELS every
 * promise still in flight that nothing is holding, so two write-through caches
 * in `procedure/org-helpers.ts` fired a bare `kv.put(...).catch(() => {})` and
 * the entry was never written: a cache built to remove a Neon round trip per
 * org-scoped request removed none, and it read as working because a
 * fire-and-forget write has no failure signal by construction. Silence is the
 * whole hazard — hence a gate rather than a code-review note.
 *
 * A path allowlist would have been strictly weaker: a floating `kv.put` inside
 * `VersionedCache` is the same bug with the same silence. Every KV-writing
 * module under the scanned roots passes this rule today — each `kv.put` either
 * is awaited/returned or is named and handed off — so it costs nothing and
 * forbids the recurrence. (No tally of those modules or forms is stated: the
 * previous wording said "six modules (five `await`, three hand off)", and a
 * measurement of the tree at the time of writing found five modules and nine
 * call sites. The rule is per-call-site, so a module count was never the thing
 * being asserted anyway; run the script for the current answer.)
 *
 * ---------------------------------------------------------------------------
 * WHAT RULE 4 PROVES, AND THE ONE THING IT DOES NOT
 * ---------------------------------------------------------------------------
 *
 * IT PROVES: no `kv.put` in the scanned modules is left with nothing holding
 * it SYNTACTICALLY. That is a backstop against a NEW bare
 * `kv.put(...).catch(() => {})` being written, and it is the whole of what a
 * grep can decide.
 *
 * IT DOES NOT PROVE THAT AN ACCEPTED HAND-OFF ACTUALLY HAPPENS AT RUNTIME, and
 * this is not a theoretical gap — it is a gap that already cost two live
 * defects. `OWNERSHIP_CALL_RE` accepts the optional-call form
 * `cacheWrite?.(write)`, because that is how both write-through caches in
 * `procedure/org-helpers.ts` hand their promise on. But `?.` on an `undefined`
 * target evaluates to `undefined` and CALLS NOTHING: the promise is then held
 * by no one and the response cancels it, exactly as if the `?.(` line were
 * absent. `org-helpers.ts` declares that parameter as `cacheWrite?: CacheWrite`
 * — OPTIONAL — so a caller that omits argument 4/5 gets the dead write and this
 * rule reports the file clean. Two callers did omit it
 * (`workers/identity-api/src/routes/membership.ts`,
 * `workers/content-api/src/routes/categories.ts`); both now thread
 * `ctx.cacheWrite`, and `content-api`'s local `membershipChecker` makes its own
 * parameter REQUIRED so a route added later cannot silently drop it.
 *
 * SO THE THREADING IS NOT CHECKED HERE, AND MUST NOT BE CLAIMED HERE. It is
 * checked by whatever makes the hand-off argument non-optional at the type
 * level, plus the tests that assert the promise is handed on
 * (`procedure/__tests__/org-cache-waituntil-wiring.test.ts`). Making the grep
 * smarter cannot close it: no textual rule can see whether a caller in another
 * file passed an argument.
 *
 * THE ONE CHEAP TIGHTENING, AND WHY IT IS NOT HERE YET. Once every parameter
 * these hand-offs target is declared REQUIRED, `cacheWrite?.(write)` becomes
 * dead syntax — an optional call on a value that cannot be nullish — and the
 * `?.` form could be rejected outright by dropping `\??` from
 * `OWNERSHIP_CALL_RE` and adding an explicit report for it. That is a
 * one-expression change. It is deliberately NOT made today because the premise
 * is false in this tree: `org-helpers.ts` still declares `cacheWrite?:`, so
 * rejecting `?.` would fail the build on the two call sites that are currently
 * the correct way to write it. Make the parameter required first, then tighten
 * this — in that order, or the gate goes red on conforming code.
 *
 * ============================================================================
 * TECHNIQUE
 * ============================================================================
 *
 * Grep-style with a comment-and-string tokenizer, matching this repo's other
 * script gate (`apps/web/scripts/check-brand-editor-boundary.mjs`) rather than
 * pulling in a TypeScript AST. The tokenizer is not optional: `max-age` appears
 * in many JSDoc blocks that DOCUMENT the presets (including the module comment
 * of `apps/web/src/lib/server/cache.ts`, which tabulates them), so a naive line
 * grep would flag the documentation and not the code. Neither the number of
 * such blocks nor the number of values they tabulate is stated: both are counts
 * of other people's files, and this file has already carried one of each
 * wrongly.
 *
 * KNOWN LIMITS, deliberate:
 *   - A `Cache-Control` value assembled at runtime (`'public, max-age=' + n`)
 *     is invisible to a literal scan. Concatenation is not a style this repo
 *     uses for headers.
 *   - `.svelte` files are scanned with the same tokenizer plus `<!-- -->`
 *     stripping. Server code lives in `.ts`, so this is belt-and-braces.
 *   - The tokenizer is not a JS parser. A regex literal containing an
 *     unbalanced quote (`.replace(/'/g, ...)`, which both sitemap routes use)
 *     or an escaped slash (`/https?:\\/\\//`, which reads as a line comment)
 *     mis-steps for the REST OF THAT LINE. The failure is asymmetric and safe
 *     in the direction that matters: a mis-step BLANKS code, so it can only
 *     hide a literal that shares a line with such a regex — it cannot invent
 *     one, because a literal has to be delimited by matching quotes. Verified
 *     against the real tree: the whole-repo scan reports exactly the sites that
 *     are genuinely hand-written, and every report prints the offending value
 *     verbatim so a false positive would be recognisable on sight. Single- and
 *     double-quoted literals are stopped at a newline for the same reason —
 *     an apostrophe in prose must not swallow the rest of the file.
 *   - Rule 4 identifies a KV binding by its NAME (a receiver whose last
 *     identifier ends in `kv`, case-insensitively: `kv`, `this.kv`,
 *     `env.CACHE_KV`, `env.AUTH_SESSION_KV`). A binding named something else
 *     entirely would be missed. Every KV binding in this repo is `*_KV` or
 *     `kv`, and `HonoEnv` is where that convention is declared.
 *
 * The two collectors are exported so the accompanying `node --test` suite can
 * point them at fixture trees; `main()` runs only as the CLI entrypoint.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.svelte']);

/** Build output, deps and generated code — never source. */
const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.svelte-kit',
  '.wrangler',
  '.turbo',
  'paraglide',
  '__tests__',
  '__mocks__',
  'e2e',
]);

/**
 * The vocabulary's home: the ONE file where a `Cache-Control` string may be
 * written out. Repo-relative, POSIX separators.
 */
const PRESETS_FILES = ['packages/constants/src/limits.ts'];

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Split `source` into code-with-comments-blanked plus the string literals it
 * contains.
 *
 * Comment characters are replaced with spaces rather than removed so every
 * byte offset — and therefore every reported line number — still matches the
 * original file. String literals are left intact in `code` (rule 4 needs to see
 * call syntax around them) AND returned separately (rule 3 needs their values).
 *
 * @param {string} source
 * @param {{ stripHtmlComments?: boolean }} [options]
 * @returns {{ code: string, strings: {value: string, index: number}[] }}
 */
export function tokenize(source, { stripHtmlComments = false } = {}) {
  const out = source.split('');
  const strings = [];
  let i = 0;

  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  while (i < source.length) {
    const two = source.slice(i, i + 2);

    if (two === '//') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (stripHtmlComments && source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      const stop = end === -1 ? source.length : end + 3;
      blank(i, stop);
      i = stop;
      continue;
    }

    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const start = i;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === ch) break;
        // An unterminated single/double quote is far more likely to be an
        // apostrophe in prose the tokenizer mis-stepped into than a real
        // multi-line literal, so stop at the newline rather than swallowing
        // the rest of the file.
        if (source[i] === '\n' && ch !== '`') break;
        i += 1;
      }
      if (source[i] === ch) {
        strings.push({ value: source.slice(start + 1, i), index: start });
        i += 1;
      } else {
        i = start + 1;
      }
      continue;
    }

    i += 1;
  }

  return { code: out.join(''), strings };
}

/** 1-indexed line number of a byte offset. */
function lineAt(source, index) {
  let line = 1;
  for (let k = 0; k < index && k < source.length; k++) {
    if (source[k] === '\n') line += 1;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Filesystem walk
// ---------------------------------------------------------------------------

function isTestFile(name) {
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(name) ||
    /\.type-check\.[cm]?tsx?$/.test(name) ||
    name.endsWith('.d.ts')
  );
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
      continue;
    }
    if (isTestFile(entry.name)) continue;
    const dot = entry.name.lastIndexOf('.');
    const ext = dot === -1 ? '' : entry.name.slice(dot);
    if (SCANNED_EXTENSIONS.has(ext)) files.push(full);
  }
  return files;
}

/**
 * The source roots both rules scan: `packages/*&#47;src`, `workers/*&#47;src`,
 * `apps/*&#47;src`. Enumerated from the filesystem rather than listed, so a new
 * package or worker is covered the day it is created — the "an artefact stays
 * true only if it sits in the path of the work" property applied to the gate
 * itself.
 */
export function defaultRoots(repoRoot = REPO_ROOT) {
  const roots = [];
  for (const group of ['packages', 'workers', 'apps']) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const src = join(groupDir, entry.name, 'src');
      if (existsSync(src) && statSync(src).isDirectory()) roots.push(src);
    }
  }
  return roots;
}

function toPosix(p) {
  return sep === '/' ? p : p.split(sep).join('/');
}

// ---------------------------------------------------------------------------
// RULE 3 — no hand-written Cache-Control
// ---------------------------------------------------------------------------

/** Directives that make a string a cacheability policy rather than prose. */
const CACHEABILITY_TOKENS = [
  'public',
  'private',
  'no-store',
  'no-cache',
  'immutable',
  's-maxage',
  'stale-while-revalidate',
  'must-revalidate',
  'proxy-revalidate',
];

const AGE_TOKENS = ['max-age', 'no-store', 'no-cache'];

/** Strict-Transport-Security, not Cache-Control. */
const HSTS_MARKERS = ['includesubdomains', 'preload'];

/** Set-Cookie attributes, not Cache-Control. */
const COOKIE_MARKERS = ['samesite', 'path=', 'httponly', 'secure', 'expires='];

/**
 * Does this literal express an HTTP cache policy?
 *
 * Requires BOTH a freshness/liveness token and a cacheability directive, which
 * is what separates `public, max-age=60` from HSTS's bare
 * `max-age=31536000; includeSubDomains`. The explicit HSTS and cookie markers
 * are belt-and-braces on top: they make the exclusion a stated decision rather
 * than a lucky consequence of the token test.
 */
export function isCacheControlValue(value) {
  const lower = value.toLowerCase();
  if (!AGE_TOKENS.some((t) => lower.includes(t))) return false;
  if (!CACHEABILITY_TOKENS.some((t) => lower.includes(t))) return false;
  if (HSTS_MARKERS.some((m) => lower.includes(m))) return false;
  if (COOKIE_MARKERS.some((m) => lower.includes(m))) return false;
  return true;
}

/** `s-maxage` / `stale-while-revalidate` — the shared-cache leak class. */
export function hasSharedWindow(value) {
  const lower = value.toLowerCase();
  return lower.includes('s-maxage') || lower.includes('stale-while-revalidate');
}

/**
 * Is this literal the value of an R2 `cacheControl` PUT option?
 *
 * Takes the COMMENT-STRIPPED source so prose cannot waive a violation.
 *
 * Looks back over the enclosing statement for the R2 field name as a property
 * key or assignment target, bounded TWICE so it cannot wander: at most 6 lines,
 * and no `;` may sit between the field name and the literal (a semicolon means
 * the assignment already finished, so a later literal is a different
 * statement). 6 lines covers the ternary in platform-settings'
 * `branding-settings-service.ts`, where `const cacheControl =` sits two lines
 * above the two literals it selects between.
 *
 * `'cache-control'` and `'Cache-Control'` — the HTTP header names, always
 * quoted — do not match `\bcacheControl\s*[:=]`, so `headers.set('cache-control',
 * '...')` stays in the subject. That textual difference is the whole
 * discriminator.
 */
function isR2ObjectMetadata(code, index) {
  const from = Math.max(0, index - 400);
  const lines = code.slice(from, index).split('\n').slice(-6).join('\n');
  return /\bcacheControl\s*(?::|=(?!=))[^;]*$/.test(lines);
}

/**
 * @returns {{ violations: {file:string,line:number,value:string,severity:'shared-window'|'off-vocabulary'}[], filesScanned: number }}
 */
export function collectCacheControlViolations({
  roots = defaultRoots(),
  cwd = REPO_ROOT,
  presetsFiles = PRESETS_FILES,
} = {}) {
  const violations = [];
  let filesScanned = 0;

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const file of walk(root)) {
      const rel = toPosix(relative(cwd, file));
      filesScanned += 1;
      if (presetsFiles.includes(rel)) continue;

      const source = readFileSync(file, 'utf8');
      const { code, strings } = tokenize(source, {
        stripHtmlComments: file.endsWith('.svelte'),
      });

      for (const literal of strings) {
        if (!isCacheControlValue(literal.value)) continue;
        // Comment-stripped, so prose mentioning `cacheControl` cannot waive a
        // real violation and a `;` inside a comment cannot break a real match.
        if (isR2ObjectMetadata(code, literal.index)) continue;
        violations.push({
          file: rel,
          line: lineAt(source, literal.index),
          value: literal.value,
          severity: hasSharedWindow(literal.value)
            ? 'shared-window'
            : 'off-vocabulary',
        });
      }
    }
  }

  return { violations, filesScanned };
}

/**
 * Read the preset vocabulary OUT OF `limits.ts` so the failure message cannot
 * disagree with it.
 *
 * WHY DERIVED AND NOT TYPED OUT. The menu below used to be four hand-written
 * lines. `static` and `asset` were added to `CACHE_PRESETS` and the message was
 * not updated, so the gate would have told an author with a legitimate sitemap
 * or R2-proxy response that no preset fits — sending them either to a waiver
 * request or to a hand-written header, which is the drift this rule exists to
 * stop. A menu that lists the vocabulary has to BE the vocabulary. Same
 * property the scan roots have (enumerated from the filesystem, not listed):
 * the artefact sits in the path of the work that would invalidate it.
 *
 * Not `import`ed from `@codex/constants`: that package resolves through
 * `dist/`, so importing it would make this gate depend on a build having run.
 * The gate must work from a bare checkout in the static-analysis job.
 *
 * Comments are blanked first, so the JSDoc blocks around the presets — each of
 * which quotes header values — cannot contribute a name.
 *
 * FAILS SOFT, ON PURPOSE. If the shape of `limits.ts` ever changes enough that
 * nothing parses, this returns `[]` and the caller prints a pointer to the file
 * instead of a menu. A gate must not crash on the way to reporting a real
 * violation, and it must never PASS because of this: the parse result is used
 * only to word a failure that has already been decided.
 *
 * @param {string} [presetsFile] absolute path to the presets module
 * @returns {{name: string, value: string, sharedWindow: boolean}[]}
 */
export function readCachePresets(
  presetsFile = join(REPO_ROOT, ...PRESETS_FILES[0].split('/'))
) {
  let source;
  try {
    source = readFileSync(presetsFile, 'utf8');
  } catch {
    return [];
  }
  const { code } = tokenize(source);
  const open = code.indexOf('CACHE_PRESETS');
  if (open === -1) return [];
  const brace = code.indexOf('{', open);
  if (brace === -1) return [];
  const end = code.indexOf('}', brace);
  if (end === -1) return [];
  const body = code.slice(brace + 1, end);

  const presets = [];
  for (const m of body.matchAll(
    /(?:^|\n)\s*'?([A-Za-z][\w-]*)'?\s*:\s*'([^'\n]+)'/g
  )) {
    const [, name, value] = m;
    if (!isCacheControlValue(value)) continue;
    presets.push({ name, value, sharedWindow: hasSharedWindow(value) });
  }
  return presets;
}

/**
 * The menu an author reads out of a failure, ordered so the decision they have
 * to make is the first thing they see: does the body vary by viewer?
 *
 * The split is DERIVED FROM THE VALUE, not from a second list that could
 * disagree with the first — a preset carrying `s-maxage` /
 * `stale-while-revalidate` is by definition one a shared cache may reuse, which
 * is only sound when the body cannot vary by viewer.
 */
export function formatPresetMenu(presets = readCachePresets()) {
  if (presets.length === 0) {
    return (
      '  The vocabulary is CACHE_PRESETS in packages/constants/src/limits.ts —\n' +
      '  read it there (this message could not parse it).'
    );
  }
  const width = Math.max(...presets.map((x) => x.name.length)) + 3;
  const line = (x) =>
    `    '${x.name}'${' '.repeat(width - x.name.length)}${x.value}`;
  const invariant = presets.filter((x) => x.sharedWindow);
  const variant = presets.filter((x) => !x.sharedWindow);
  const out = [
    '  Declare a preset from CACHE_PRESETS (@codex/constants) instead. The question is',
    '  NOT "is my window short?" but "would two different viewers get the same bytes?"',
    '  — a shared window on a body that can vary is the leak; a long shared window on',
    '  a body that cannot vary is not.',
  ];
  if (invariant.length > 0) {
    out.push(
      '',
      '  BODY IDENTICAL FOR EVERY VIEWER (a shared cache may store AND reuse it):'
    );
    for (const x of invariant) out.push(line(x));
  }
  if (variant.length > 0) {
    out.push(
      '',
      '  BODY MAY DIFFER PER VIEWER (no shared cache may reuse a stored copy):'
    );
    for (const x of variant) out.push(line(x));
  }
  out.push(
    '',
    '  In a worker: procedure({ policy: { cache: ... } }). In apps/web:',
    '  setHeaders(CACHE_HEADERS.*) from $lib/server/cache.',
    '  If genuinely NOTHING here fits, the vocabulary is incomplete: ADD a preset to',
    '  packages/constants/src/limits.ts with its reasoning. Do not add a waiver to',
    '  this gate; it has none by design.'
  );
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// RULE 4 — no floating KV write
// ---------------------------------------------------------------------------

/**
 * Calls that take ownership of a promise's lifetime. `?.` and a member prefix
 * are both allowed (`ctx.cacheWrite(...)`, `cacheWrite?.(...)`,
 * `c.executionCtx.waitUntil(...)`).
 */
const OWNERSHIP_CALLS = ['cacheWrite', 'waitUntil', 'background'];

const OWNERSHIP_CALL_RE = new RegExp(
  `\\b(?:${OWNERSHIP_CALLS.join('|')})\\s*\\??\\.?\\s*\\(\\s*$`
);

/** `await` / `return` / `void` / `yield` immediately before the receiver. */
const AWAITED_RE = /\b(?:await|return|void|yield)\s*$/;

/** `const write = ` / `let write = ` — a named promise that may be handed off. */
const ASSIGNMENT_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*$/;

/**
 * How far forward to look for the hand-off of a named promise. VersionedCache's
 * `writeCacheSlot` puts 19 lines of comment and a guard between
 * `const write = this.kv.put(...)` and `this.waitUntil(write)`, so a tight
 * window would false-flag correct code. The variable NAME must appear inside
 * the ownership call, which keeps a 40-line window from matching by accident.
 */
const HANDOFF_LOOKAHEAD_LINES = 40;

/**
 * Walk backwards from `.put(` to capture the receiver expression, tolerating a
 * newline before the dot (`this.kv\n  .put(`, which VersionedCache and
 * org-helpers both use).
 *
 * @returns {{ receiver: string, start: number } | null}
 */
function captureReceiver(code, dotIndex) {
  let i = dotIndex - 1;
  while (i >= 0 && /\s/.test(code[i])) i -= 1;
  const end = i + 1;
  // A member chain: identifiers, dots, `?.`, and `]` for env['KV'] is out of
  // scope on purpose (no call site uses it).
  while (i >= 0 && /[\w$.?]/.test(code[i])) i -= 1;
  const start = i + 1;
  if (start >= end) return null;
  return { receiver: code.slice(start, end), start };
}

/** Last identifier of a member chain: `env.CACHE_KV` -> `CACHE_KV`. */
function lastIdentifier(receiver) {
  const parts = receiver.replace(/\?/g, '').split('.');
  return parts[parts.length - 1] ?? '';
}

/**
 * Is `receiver` a KV namespace? Name-based; see KNOWN LIMITS in the header.
 * `this.kv`, `kv`, `env.CACHE_KV`, `platform.env.AUTH_SESSION_KV` all match.
 */
export function isKvReceiver(receiver) {
  const id = lastIdentifier(receiver);
  return id.length > 0 && /kv$/i.test(id);
}

/**
 * @returns {{ violations: {file:string,line:number,text:string}[], filesScanned: number }}
 */
export function collectFloatingKvWriteViolations({
  roots = defaultRoots(),
  cwd = REPO_ROOT,
} = {}) {
  const violations = [];
  let filesScanned = 0;

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const file of walk(root)) {
      filesScanned += 1;
      const source = readFileSync(file, 'utf8');
      const { code } = tokenize(source, {
        stripHtmlComments: file.endsWith('.svelte'),
      });

      for (const match of code.matchAll(/\.\s*put\s*\(/g)) {
        const captured = captureReceiver(code, match.index);
        if (!captured) continue;
        if (!isKvReceiver(captured.receiver)) continue;

        const prefix = code.slice(Math.max(0, captured.start - 200), captured.start);
        if (AWAITED_RE.test(prefix)) continue;
        if (OWNERSHIP_CALL_RE.test(prefix)) continue;

        const assigned = ASSIGNMENT_RE.exec(prefix);
        if (assigned) {
          const name = assigned[1];
          const after = code.slice(captured.start).split('\n')
            .slice(0, HANDOFF_LOOKAHEAD_LINES)
            .join('\n');
          const handoff = new RegExp(
            `\\b(?:${OWNERSHIP_CALLS.join('|')})\\s*\\??\\.?\\s*\\([^)]*\\b${name}\\b`
          );
          if (handoff.test(after)) continue;
        }

        violations.push({
          file: toPosix(relative(cwd, file)),
          line: lineAt(source, captured.start),
          text: `${captured.receiver}.put(...)`,
        });
      }
    }
  }

  return { violations, filesScanned };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const roots = defaultRoots();
  const cache = collectCacheControlViolations({ roots });
  const kv = collectFloatingKvWriteViolations({ roots });

  // Fail closed on an empty scan. A broken root path would otherwise read as
  // green with 0 files — the exact blind spot that lets a newly added gate
  // never run. See apps/web/scripts/check-brand-editor-boundary.mjs, which
  // fails closed for the same reason.
  if (cache.filesScanned === 0 || kv.filesScanned === 0) {
    console.error(
      'Data-access contract gate scanned 0 files — scan roots are misconfigured. Failing closed.'
    );
    process.exit(1);
  }

  let failed = false;

  // Parsed once, and only to word a failure that has already been decided —
  // never to decide one. See readCachePresets().
  const presetMenu = formatPresetMenu();

  const shared = cache.violations.filter((v) => v.severity === 'shared-window');
  const offVocab = cache.violations.filter(
    (v) => v.severity === 'off-vocabulary'
  );

  if (shared.length > 0) {
    failed = true;
    console.error(
      '\nRULE 3 (SHARED WINDOW) — a hand-written Cache-Control carrying s-maxage or stale-while-revalidate:\n'
    );
    for (const v of shared) console.error(`  ${v.file}:${v.line}: '${v.value}'`);
    console.error(
      '\n  A shared cache keys on URL and NEVER on Cookie, so a stored body is handed to the\n' +
        '  next viewer.\n' +
        presetMenu
    );
  }

  if (offVocab.length > 0) {
    failed = true;
    console.error(
      '\nRULE 3 (OFF-VOCABULARY) — a hand-written Cache-Control outside CACHE_PRESETS:\n'
    );
    for (const v of offVocab) console.error(`  ${v.file}:${v.line}: '${v.value}'`);
    console.error(
      '\n  The value cannot be changed centrally and its reasoning is not next to the preset.\n' +
        presetMenu
    );
  }

  if (kv.violations.length > 0) {
    failed = true;
    console.error('\nRULE 4 — a floating KV write:\n');
    for (const v of kv.violations) console.error(`  ${v.file}:${v.line}: ${v.text}`);
    console.error(
      '\n  A Workers response CANCELS an in-flight promise nothing is holding, so this write\n' +
        '  silently never happens — and a fire-and-forget write has no failure signal.\n' +
        '  Either await it, or hand it to ctx.cacheWrite(...) / waitUntil(...) /\n' +
        '  ctx.background(...) — including via a named promise:\n' +
        '    const write = kv.put(k, v).catch(() => {});\n' +
        '    ctx.cacheWrite(write);'
    );
  }

  if (failed) {
    const total =
      shared.length + offVocab.length + kv.violations.length;
    console.error(
      `\n${total} data-access contract violation(s). See scripts/checks/check-data-access-contract.mjs for the rules.\n`
    );
    process.exit(1);
  }

  console.log(
    `OK: no hand-written Cache-Control and no floating KV write in ${cache.filesScanned} source file(s) ` +
      `across ${roots.length} package/worker/app src root(s).`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
