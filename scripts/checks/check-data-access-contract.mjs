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
 * THE SIX CHECKS, AND WHERE EACH ONE LIVES
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
 *  5. Every search input uses the shared Zod builder.  <-- IMPLEMENTED HERE (rule 5)
 *     Landed with WP6, which created the builder this rule requires. Rule 5 sees
 *     DECLARATIONS only; the sibling limit is stated in its own section below.
 *  6. No non-deterministic time function inside a `sql` template.  <-- IMPLEMENTED HERE (rule 6)
 *     Deferred from this gate's own WP9 design note until the thing it polices
 *     existed — Hyperdrive is wired by the inert driver swap it lands with
 *     (Codex-s1i7h, WP5). Enforcing a pattern before its shape is settled
 *     freezes a draft; the rule arrives with the swap, satisfiable from day one.
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
 *   - `void kv.put(...)`                       A BUG anywhere — `void` discards
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
 * — that WAS the declaration, and it is why a caller could omit argument 4/5, get
 * the dead write, and have this rule report the file clean. The parameter is now
 * REQUIRED, so the omission is a compile error and `?.` is dead syntax (rejected
 * below). Two callers did omit it
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
 * one-expression change, and IT IS NOW APPLIED. It was deferred while the premise
 * was false — `org-helpers.ts` declared `cacheWrite?:`, so rejecting `?.` would
 * have failed the build on the then-correct spelling. The parameter was made
 * required (see `DeclaredCache`'s sibling note in worker-utils), the `?.` form
 * disappeared from every non-comment call site, and the tightening landed in that
 * order — which is the order it has to happen in, or the gate goes red on
 * conforming code.
 *
 * ============================================================================
 * RULE 5 — EVERY SEARCH INPUT COMES FROM THE SHARED BUILDER
 * ============================================================================
 *
 * `createSearchQuerySchema()` in
 * `packages/validation/src/shared/search-schema.ts` is the whole vocabulary for
 * a free-text search facet, exactly as `CACHE_PRESETS` is for a cache window. A
 * search field built any other way is drift, because the reasoning that sets
 * the trim, the length cap and — above all — the THREE-CHARACTER FLOOR lives
 * next to the builder and not next to the copy.
 *
 * WHY A GATE AND NOT A CONVENTION. There were twelve independent
 * `search: z.string()` declarations across `@codex/validation` and
 * `apps/web/src/lib/remote`. Ten set no minimum at all; TWO were written
 * `z.string().trim().min(1)`, which rejects only the empty string. Note what
 * that second spelling did to the tree's own observability: a literal search
 * for `z.string().min` matched NONE of the twelve, so "are they consistent?"
 * could not be answered by the obvious command, and the answer everybody
 * assumed — they are — was wrong for all twelve. A one-character query reached
 * a `LIKE '%a%'` and scanned the table.
 *
 * SO THIS RULE DOES NOT GREP FOR THE BAD SPELLINGS. IT GREPS FOR THE ABSENCE OF
 * THE GOOD ONE. The subject is a search-named field whose value is a SCHEMA,
 * and the only conforming value is one that ORIGINATES in
 * `createSearchQuerySchema(`. `z.string()`, `z.string().trim().min(1)`,
 * `z.string().optional()`, `z.coerce.string()` and a hand-rolled
 * `localSearchSchema` all fail identically — and so does a spelling nobody has
 * invented yet. There is no list of bad forms to keep up to date, which is the
 * only version of this rule that cannot acquire the very blind spot that hid
 * the original defect.
 *
 * CHAINING ONTO THE BUILDER IS LEGAL, and one site needs it:
 * `createSearchQuerySchema(200).default('')` in
 * `packages/validation/src/schemas/access.ts`, because `listUserLibrarySchema`
 * must land `search` as `''` rather than `undefined` and
 * `schemas/access.test.ts` asserts that defaults object. So this rule checks
 * PROVENANCE — the builder is the origin — and NOT that nothing is chained on
 * afterwards.
 *
 * THEREFORE A CHAINED `.min(3)` WOULD PASS THIS RULE, AND THAT MUST NOT BE
 * CLAIMED OTHERWISE. Re-imposing a server-side minimum is a real regression: it
 * turns a legal short search into a 400 for every caller that has not heard
 * about the floor (a curl, a bookmarked `?search=Bo`, a stale client build). It
 * is pinned where it can be pinned properly — by the witness test in
 * `packages/validation/src/shared/search-schema.test.ts`, which asserts the
 * server still parses a 1-2 character query and goes red the instant a
 * `.min(3)` appears. A textual rule cannot tell "`.default('')` is fine" from
 * "`.min(3)` is not" without knowing what each means; a parse test can, so that
 * half lives there and not here.
 *
 * ---------------------------------------------------------------------------
 * SCOPE, STATED — WHICH FIELDS, WHICH FILES, AND WHAT THIS CANNOT SEE
 * ---------------------------------------------------------------------------
 *
 * FILES AND EXTENSIONS: identical to rules 3 and 4 — every non-test
 * `.ts` / `.tsx` / `.js` / `.mjs` / `.svelte` module under `packages/*&#47;src`,
 * `workers/*&#47;src` and `apps/*&#47;src`, with comments blanked (and
 * `<!-- -->` stripped in `.svelte`) so prose quoting `search: z.string()` —
 * including the paragraph above and the module comment of `search-schema.ts`
 * itself — cannot register as a declaration. `search-schema.ts` is NOT
 * special-cased and needs no exemption: it declares the builder, never a
 * `search:` field.
 *
 * FIELD NAMES: a STATED family — `search`, `searchQuery`, `searchTerm`,
 * `searchText`, `searchString`, `q`. That family is the rule's SUBJECT, not a
 * waiver list; there are no per-file exemptions anywhere in this script.
 *
 * `query` IS DELIBERATELY NOT IN THE FAMILY, and this is the one place the rule
 * is knowingly narrower than its intent. `query` is `procedure()`'s INPUT SLOT
 * name — `input: { query: contentQuerySchema }` — so it sits in this exact
 * position on essentially EVERY list route in `workers/*&#47;src`, each time
 * holding an identifier ending `Schema` that this rule would score as a foreign
 * schema. (Measured at 79 such sites on 2026-08-30; the argument does not
 * depend on the figure, only on the shape being the norm rather than the
 * exception, which is why the rule does not compute or assert it.) Adding
 * `query` would turn the gate red on almost every route in the repo, which is
 * not a stricter gate, it is a gate that gets deleted. The cost is stated
 * rather than hidden: a genuine search facet NAMED `query` is invisible to
 * rule 5.
 *
 * WHAT COUNTS AS A "SCHEMA" VALUE. The rule fires only when the head of the
 * value expression says schema:
 *
 *   `createSearchQuerySchema(`            -> CONFORMING
 *   `z.` / `zod.`                         -> a Zod expression: VIOLATION
 *   an identifier ending `Schema`         -> a named schema that is not the
 *                                            builder: VIOLATION
 *   `z.infer<` / `z.input<` / `z.output<` -> a TYPE position, not a schema:
 *                                            skipped
 *   anything else                          -> not a declaration: skipped
 *
 * THAT LAST LINE IS LOAD-BEARING, and it is where the precision is bought. The
 * repo is full of `search:`-keyed values that are DATA and not schemas, and
 * flagging any of them would be a false positive on conforming code:
 * `{ ...filters, search: value }`, `search: urlSearch`,
 * `search: page.url.searchParams.get('search') ?? ''`, `search: SearchIcon`, a
 * TypeScript `search: string;` in a props interface, `search: input.search` in
 * a service, and even the CSS selector `.bottom-nav__tab--search:active` inside
 * a `.svelte` file. The price of not flagging those is that a search field
 * built through an indirection this rule cannot name — `search: buildIt()`, or
 * an imported schema whose identifier does not end in `Schema` — is invisible.
 *
 * AND THE WHOLE RULE IS DECLARATION-SHAPED, WHICH IS ITS LARGEST LIMIT. WP6
 * found a THIRTEENTH search surface that declares no Zod schema at all: the
 * Cmd-K command palette (`apps/web/src/lib/components/search/`
 * `CommandPaletteSearch.svelte`) hand-builds a `URLSearchParams` and fetches
 * `/api/search`, which fans out to an org lookup plus a content search plus a
 * creators search — once per 300ms of typing, for a one-character term. NO
 * declaration-shaped check would ever have seen it. It is gated now, and the
 * counter-measure for that SHAPE is not here and cannot be: it is the `?q=`
 * navigation sweep and the `/api/search` fetch sweep in
 * `apps/web/src/lib/remote/search-floor-sweep.test.ts`. A clean run of rule 5
 * means EVERY DECLARED SEARCH INPUT USES THE BUILDER. It does not mean every
 * search surface is gated, and it must not be reported as though it did.
 *
 * FAILS CLOSED ON ZERO DECLARATIONS. `main()` fails the build if the whole tree
 * yields no search declaration at all, for the same reason it fails closed on
 * zero files scanned: no subject is indistinguishable from a stale field-name
 * family or a moved root, and that is exactly the blind spot where a gate
 * quietly stops having anything to check and reads green forever.
 *
 * ============================================================================
 * RULE 6 — NO NON-DETERMINISTIC TIME FUNCTION INSIDE A `sql` TEMPLATE
 * ============================================================================
 *
 * Hyperdrive decides whether a query may be cached by TEXT-MATCHING it for
 * non-deterministic function names. It does not parse SQL to do so, and
 * Cloudflare's changelog notes that even a MENTION inside a SQL COMMENT marks
 * the whole query uncacheable. So a predicate like
 * `AND currentPeriodEnd > NOW()` costs more than a clock discrepancy: it
 * silently opts the query out of the cache Hyperdrive exists to provide, and
 * nothing on the wire says so — the query runs, returns, and is never cached,
 * with no failure signal anywhere. `packages/access/src/services/
 * content-access/library.ts` — the library read path, the query that most
 * wants caching — carried exactly that predicate, and was the ONLY site in the
 * scanned roots that did. Its repair (binding `const asOf = new Date()` and
 * interpolating it) is the pattern this rule now requires; the rule exists so
 * the predicate cannot quietly come back.
 *
 * THE FORBIDDEN FAMILY, exactly as Hyperdrive names it: `NOW(` — with the
 * paren, because bare `now` is an English word and this rule does not police
 * prose — plus the bare tokens `CURRENT_TIMESTAMP`, `CURRENT_DATE` and
 * `LOCALTIMESTAMP`. Postgres folds unquoted identifiers to lowercase, so
 * `now()` IS `NOW()` and the matcher is case-insensitive for that reason, not
 * for convenience. `LOCALTIME` — the same clock family — is deliberately NOT
 * in the set: the rule forbids exactly the four names the docs give, and
 * widening it is a one-token edit plus its test case, not a redesign.
 *
 * WHAT IS INSIDE THE TEMPLATE AND WHAT IS NOT. This is the whole precision of
 * the rule, and each side is pinned by a fixture in the self-test:
 *
 *   - The STATIC text between the backticks is the subject — including SQL
 *     comments. `-- NOW()` and `*&#47; NOW() *&#47;` are bytes of the query
 *     Cloudflare text-matches like any other, so a mention there fails the
 *     build even though it is "only a comment". That is not pedantry: the
 *     comment spelling is the one an author is most sure is harmless.
 *   - A `${...}` interpolation body is JAVASCRIPT. It is compiled away before
 *     the query exists — `${asOf}` becomes a bind parameter — so interpolation
 *     bodies are skipped: the bound Date this rule demands, and even a TS
 *     comment inside the interpolation, never reach SQL. A NESTED `sql`
 *     template inside an interpolation (`sql`t NOT IN (${sql.join(...)})`` is
 *     a real shape in library.ts) is judged by its own tag, so skipping the
 *     enclosing body loses nothing.
 *   - TypeScript `//` and `*&#47; ... *&#47;` comments OUTSIDE the template are
 *     blanked by the tokenizer before this rule runs. Two real files carry
 *     `now()` in exactly that position (admin's analytics-service.ts documents
 *     `effectiveUntil IS NULL OR > now()`; purchase-service.ts documents
 *     `disputedAt = now()`), and both must pass: prose that documents the
 *     function may never be a violation of the rule against it, or the gate
 *     documents itself out of force.
 *
 * AND `.defaultNow()` IS NOT A SUBJECT, THOUGH IT LOOKS LIKE ONE. The Drizzle
 * schema files call `timestamp(...).defaultNow()` on most timestamped tables.
 * That is a column DEFAULT declared in DDL and applied server-side at INSERT:
 * the statement text Drizzle sends contains no function name at all, no `sql`
 * template is involved, and nothing opts out of anything. It is stated here
 * because it is the first thing a reader greps for and the grep looks alarming.
 *
 * FAILS CLOSED ON ZERO TEMPLATES, for the same reason rule 5 fails closed on
 * zero declarations: if `SQL_TAG_RE` goes stale — the `sql` import renamed, the
 * predicates moved out of the scanned roots — a rule with no subject reads
 * green forever. `main()` exits 1 when `templatesFound` is 0, and the self-test
 * pins the same state.
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
 * The four collectors are exported so the accompanying `node --test` suite can
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

// THE OPTIONAL-CALL FORM IS NO LONGER ACCEPTED. `\\??` is gone from this pattern,
// so `cacheWrite?.(promise)` no longer counts as a hand-off. The header above
// recorded this tightening as deferred because the premise was false in the tree:
// `org-helpers.ts` declared `cacheWrite?:`, and rejecting `?.` would have failed
// the build on the two call sites that were then the correct spelling. That
// parameter is now REQUIRED, so `?.` is dead syntax — an optional call on a
// non-optional value — and accepting it only preserved the hole it came from: a
// caller that passed nothing got `undefined`, `?.(` called nothing, and the
// promise was cancelled while this rule reported the file clean.
const OWNERSHIP_CALL_RE = new RegExp(
  `\\b(?:${OWNERSHIP_CALLS.join('|')})\\s*\\.\\s*\\(\\s*$|\\b(?:${OWNERSHIP_CALLS.join('|')})\\s*\\(\\s*$`
);

/** `await` / `return` / `yield` immediately before the receiver. */
// `void` is DELIBERATELY ABSENT. It was here, and it was backwards: `void p`
// explicitly DISCARDS the promise — the exact opposite of taking ownership of it —
// so `void kv.put(...)` is cancelled at response return in precisely the way
// `kv.put(...).catch(() => {})` is, and the gate waved it through. It was never in
// the legal-forms list at the top of this file, and the self-test had no case for
// it, so the acceptance was both undocumented and unasserted. It also happens to be
// the spelling a floating-promise linter suggests, which made it the likeliest next
// instance of the defect this rule exists to prevent.
const AWAITED_RE = /\b(?:await|return|yield)\s*$/;

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
// RULE 5 — every search input comes from the shared builder
// ---------------------------------------------------------------------------

/**
 * The ONE conforming origin for a search field's schema. Named once so the
 * matcher, the failure message and this file's docs cannot drift apart — the
 * same property `readCachePresets()` gives rule 3's menu.
 */
const SEARCH_BUILDER = 'createSearchQuerySchema';

/** Where the builder and its reasoning live, for the failure message. */
const SEARCH_BUILDER_MODULE = 'packages/validation/src/shared/search-schema.ts';

/**
 * The field names this rule judges. See SCOPE, STATED in the header: this is
 * the rule's SUBJECT, and `query` is deliberately absent because it is
 * `procedure()`'s input-slot name, not a search facet.
 */
const SEARCH_FIELD_NAMES = [
  'search',
  'searchQuery',
  'searchTerm',
  'searchText',
  'searchString',
  'q',
];

/** How far past the `:` to read the value expression. */
const SEARCH_VALUE_LOOKAHEAD = 200;

/**
 * A search-named property KEY.
 *
 * The lookbehind IS load-bearing, and the shapes that prove it are real:
 * without it, `content_search: z.string()` and `'org-search': z.string()` — two
 * different fields — are both read as a field named `search`, and the CSS
 * selector `.bottom-nav__tab--search:active` in MobileBottomNav.svelte is read
 * as a field named `search` whose value is `active`.
 *
 * The alternation order is NOT load-bearing, and this comment used to claim it
 * was ("longest name first so `searchQuery:` is captured whole"). It is not:
 * the `\s*:` suffix forces the engine to backtrack out of the `search` branch
 * when the next character is `Q`, so `searchQuery` is captured whole in any
 * order. The sort has been removed rather than left in with a false reason —
 * mutating it changed no test result, which is how the overclaim was found.
 */
const SEARCH_FIELD_KEY_RE = new RegExp(
  `(?<![\\w$.-])(${SEARCH_FIELD_NAMES.join('|')})\\s*:`,
  'g'
);

/**
 * `z.infer<T>` / `z.input<T>` / `z.output<T>` / `z.TypeOf<T>` — these appear in
 * TYPE positions (`type Args = { search: z.infer<typeof s> }`), where there is
 * no schema to build with the builder. Skipped rather than flagged, because a
 * gate that fails on a type annotation is a gate that gets a waiver added.
 */
const ZOD_TYPE_HELPER_RE = /^(?:z|zod)\s*\.\s*(?:infer|input|output|TypeOf)\b/;

/**
 * The offending value expression, as it will be printed in the failure.
 *
 * A gate's report has to be recognisable on sight — rule 3 prints its literal
 * verbatim for the same reason — so this quotes the source rather than
 * paraphrasing it, and stops where the expression does.
 *
 * @param {string} expr source from the start of the value expression
 * @returns {string}
 */
export function searchValueHead(expr) {
  const line = expr.split('\n')[0].slice(0, 120);
  // Truncate where a closer belongs to the ENCLOSING object, so
  // `z.string().optional() });` prints as `z.string().optional()` while
  // `z.string().max(5)` — whose closers are its own — survives intact.
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth < 0) return line.slice(0, i).trim().replace(/[,;]+$/, '');
    } else if (depth === 0 && (ch === ',' || ch === ';')) {
      return line.slice(0, i).trim();
    }
  }
  return line.trim().replace(/[,;]+$/, '');
}

/**
 * Decide what the expression after a search-named `:` is.
 *
 * Exported so the self-test can assert BOTH original spellings — the bare
 * `z.string()` and the `z.string().trim().min(1)` that a literal
 * `z.string().min` grep misses — at the unit level as well as through a
 * fixture tree.
 *
 * @param {string} value source immediately following the `:`
 * @returns {{kind:'conforming'}|{kind:'raw-zod'|'foreign-schema',head:string}|null}
 *   `null` means "not a schema declaration at all" — data, a type, an icon, a
 *   CSS value — and is the answer for the overwhelming majority of `search:`
 *   keys in this repo.
 */
export function classifySearchFieldValue(value) {
  const expr = value.replace(/^\s+/, '');
  if (expr.length === 0) return null;

  /** What to print in the failure: the offending value expression, verbatim. */
  const head = searchValueHead(expr);

  // Checked FIRST, because `createSearchQuerySchema` itself ends in `Schema`
  // and would otherwise be scored a foreign schema by the branch below. The
  // un-invoked form (`search: createSearchQuerySchema` with no `(`) falls
  // through to that branch on purpose — it is a genuine bug, not a hand-off.
  if (new RegExp(`^${SEARCH_BUILDER}\\s*\\(`).test(expr)) {
    return { kind: 'conforming' };
  }
  if (ZOD_TYPE_HELPER_RE.test(expr)) return null;
  if (/^(?:z|zod)\s*\./.test(expr)) return { kind: 'raw-zod', head };
  if (/^[A-Za-z_$][\w$]*Schema\b/.test(expr)) {
    return { kind: 'foreign-schema', head };
  }
  return null;
}

/**
 * @returns {{ violations: {file:string,line:number,field:string,head:string,kind:'raw-zod'|'foreign-schema'}[], filesScanned: number, declarationsFound: number }}
 *   `declarationsFound` counts CONFORMING and violating declarations alike. It
 *   is the rule's proof that it still has a subject; `main()` fails closed when
 *   it is 0. See FAILS CLOSED ON ZERO DECLARATIONS in the header.
 */
export function collectSearchBuilderViolations({
  roots = defaultRoots(),
  cwd = REPO_ROOT,
} = {}) {
  const violations = [];
  let filesScanned = 0;
  let declarationsFound = 0;

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const file of walk(root)) {
      filesScanned += 1;
      const source = readFileSync(file, 'utf8');
      const { code } = tokenize(source, {
        stripHtmlComments: file.endsWith('.svelte'),
      });

      for (const match of code.matchAll(SEARCH_FIELD_KEY_RE)) {
        const valueStart = match.index + match[0].length;
        const verdict = classifySearchFieldValue(
          code.slice(valueStart, valueStart + SEARCH_VALUE_LOOKAHEAD)
        );
        if (verdict === null) continue;

        declarationsFound += 1;
        if (verdict.kind === 'conforming') continue;

        violations.push({
          file: toPosix(relative(cwd, file)),
          line: lineAt(source, match.index),
          field: match[1],
          head: verdict.head,
          kind: verdict.kind,
        });
      }
    }
  }

  return { violations, filesScanned, declarationsFound };
}

/**
 * The instruction an author reads out of a rule-5 failure.
 *
 * Deliberately states the FLOOR'S MECHANISM and not just the rule, because the
 * one wrong repair — adding `.min(3)` on the server — is the intuitive one, and
 * a gate that forbids a shape without saying what to write instead gets
 * satisfied by whatever silences it.
 */
export function formatSearchBuilderGuidance() {
  return [
    `  ${SEARCH_BUILDER}() is the whole vocabulary for a free-text search facet. Use it:`,
    '',
    `    import { ${SEARCH_BUILDER} } from '@codex/validation';`,
    `    search: ${SEARCH_BUILDER}(255),   // 255 = max length AFTER trimming`,
    '',
    '  It trims, caps and optionalises. Chaining onto it is fine — listUserLibrarySchema',
    `  uses ${SEARCH_BUILDER}(200).default('') so the field lands as '' — but do NOT`,
    '  add `.min(3)`: the 3-character floor is a CLIENT gate (gateSearchQuery /',
    '  isSearchQueryBelowFloor), because a server minimum turns a legal short search into',
    '  a 400 for any caller that has not heard about the floor. Below three characters',
    '  pg_trgm has no extractable trigram to probe its GIN index with, so the planner',
    '  falls back to a sequential scan — that is the cost the floor exists to avoid.',
    `  The reasoning is written out in ${SEARCH_BUILDER_MODULE}.`,
    '',
    '  If a field this rule judged is genuinely NOT a free-text search, that is a finding',
    '  to raise — rename the field, or widen the builder — not a case to exempt. This gate',
    '  has no waiver list by design.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// RULE 6 — no non-deterministic time function inside a `sql` template
// ---------------------------------------------------------------------------

/**
 * The non-deterministic time family Hyperdrive text-matches a query for.
 *
 * `NOW` requires its paren so the English word in prose is not a function
 * call; the other three are valid SQL bare, so they need no paren and get a
 * trailing boundary so a longer identifier containing them is not half-matched.
 * Case-insensitive because Postgres folds unquoted identifiers — `now()` and
 * `NOW()` are the same function, and Hyperdrive text-matches whatever spelling
 * reaches it. There is deliberately NO trailing boundary after `NOW\s*\(`:
 * `(` is a non-word character, so a boundary after it exists only when the
 * next character is a word character — `NOW(x)` — and would fail to match the
 * ordinary `NOW()` and `NOW( )`.
 */
export const NON_DETERMINISTIC_TIME_RE =
  /\b(?:NOW\s*\(|CURRENT_TIMESTAMP\b|CURRENT_DATE\b|LOCALTIMESTAMP\b)/i;

/**
 * A `sql` identifier (bare, `db.sql`, `this.sql` — any member chain ending in
 * `sql`) immediately tagging a backtick template, with an optional type
 * argument (`sql<number>`...``) — the spelling most of this repo's predicates
 * are tagged with. A matcher that demands the backtick right after `sql`
 * judges that spelling not at all: the probe `sql<Date>`x > NOW()`` scanned
 * as ZERO templates and ZERO violations, certifying the exact banned
 * predicate clean. The type-argument body excludes `>` (single-level generics
 * only — every generic tag in the tree is one level) and the backtick (so it
 * cannot bridge into a template). This is the ONLY thing rule 6 judges: every
 * other template literal in the tree — KV keys, log lines, i18n messages — is
 * not SQL and is never scanned. Known limit: an IMPORT ALIAS renames the
 * identifier and escapes the matcher entirely (`sql as sqlOperator`, in
 * test-utils today); no aliased template in the scanned roots carries a time
 * token, so the limit is latent — and invisible to the zero-template tripwire,
 * which plain `sql` tags keep above zero.
 */
const SQL_TAG_RE = /\bsql(?:\s*<[^`>]*>)?\s*(?=`)/g;

/**
 * The STATIC chunks of the template that opens at `backtick`, plus the index
 * of its closing backtick — or null if the template never closes.
 *
 * Static means: text that reaches Postgres verbatim. `${...}` bodies are
 * JavaScript — compiled away, `${asOf}` becomes a bind parameter — so they are
 * skipped; see the header for why that is the rule's precision and not a hole.
 * Nested templates inside an interpolation are consumed here so their
 * backticks cannot end the OUTER template early, and each is judged on its own
 * by its own `SQL_TAG_RE` match.
 *
 * A small lexer rather than an indexOf for the closing backtick, because the
 * real tree nests: `sql`t NOT IN (${sql.join(ids.map((id) => sql`${id}`),
 * sql`, `)})`` (library.ts) is three templates deep inside one predicate.
 *
 * @param {string} code comment-blanked source (string/template bodies intact)
 * @param {number} backtick index of the opening backtick
 * @returns {{ chunks: {text: string, index: number}[], end: number } | null}
 */
export function sqlTemplateChunks(code, backtick) {
  const chunks = [];
  let chunkStart = backtick + 1;
  let i = backtick + 1;
  let depth = 0; // > 0 = inside a ${...} interpolation

  while (i < code.length) {
    const ch = code[i];

    if (depth === 0) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        chunks.push({ text: code.slice(chunkStart, i), index: chunkStart });
        return { chunks, end: i };
      }
      if (ch === '$' && code[i + 1] === '{') {
        chunks.push({ text: code.slice(chunkStart, i), index: chunkStart });
        depth = 1;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    // Inside an interpolation: JavaScript. Track only what can end the
    // interpolation early or swallow one of its braces — nested braces,
    // string literals, and nested templates.
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) chunkStart = i + 1;
    } else if (ch === '`') {
      const nested = sqlTemplateChunks(code, i);
      if (!nested) return null;
      i = nested.end;
    } else if (ch === "'" || ch === '"') {
      const quote = ch;
      i += 1;
      while (i < code.length && code[i] !== quote && code[i] !== '\n') {
        if (code[i] === '\\') i += 1;
        i += 1;
      }
      if (code[i] !== quote) return null; // unterminated string: do not guess
    }
    i += 1;
  }
  return null; // unterminated template
}

/**
 * @returns {{ violations: {file:string,line:number,token:string,text:string}[], filesScanned: number, templatesFound: number }}
 *   `templatesFound` counts every `sql` template the rule judged, nested ones
 *   included. It is the rule's proof that it still has a subject; `main()`
 *   fails closed when it is 0, for the same reason rule 5 fails closed on zero
 *   declarations.
 */
export function collectNonDeterministicSqlViolations({
  roots = defaultRoots(),
  cwd = REPO_ROOT,
} = {}) {
  const violations = [];
  let filesScanned = 0;
  let templatesFound = 0;

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const file of walk(root)) {
      filesScanned += 1;
      const source = readFileSync(file, 'utf8');
      const { code } = tokenize(source, {
        stripHtmlComments: file.endsWith('.svelte'),
      });

      for (const tag of code.matchAll(SQL_TAG_RE)) {
        const template = sqlTemplateChunks(code, tag.index + tag[0].length);
        if (!template) continue;
        templatesFound += 1;

        for (const chunk of template.chunks) {
          const hit = NON_DETERMINISTIC_TIME_RE.exec(chunk.text);
          if (!hit) continue;
          // The source line the token sits on, quoted verbatim so a report is
          // recognisable on sight — the same obligation rule 3's printed value
          // carries.
          const lineStart = chunk.text.lastIndexOf('\n', hit.index - 1) + 1;
          const lineEnd = chunk.text.indexOf('\n', hit.index);
          violations.push({
            file: toPosix(relative(cwd, file)),
            line: lineAt(source, chunk.index + hit.index),
            token: hit[0],
            text: chunk.text
              .slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
              .trim(),
          });
          break; // one report per template: the first hit names the defect
        }
      }
    }
  }

  return { violations, filesScanned, templatesFound };
}

/**
 * The repair an author reads out of a rule-6 failure.
 *
 * States the MECHANISM (text-match, SQL comments included) because the
 * tempting non-repair — "it is only a comment" — is exactly the spelling that
 * keeps the query uncacheable. States the semantic trade of the correct repair
 * (worker clock, once per request, vs the database clock per statement)
 * because a future predicate where that trade is NOT immaterial must be raised
 * as a finding, not copied from this message. Same obligation as rule 3's
 * preset menu and rule 5's guidance: the message carries the decision.
 */
export function formatNonDeterministicSqlGuidance() {
  return [
    '  Bind the instant as a parameter and let the driver interpolate it, so the',
    '  query text is identical on every request and Hyperdrive can cache it:',
    '',
    '    const asOf = new Date();',
    '    sql`... AND ${table.periodEnd} > ${asOf}`',
    '',
    '  WHY A PARAMETER AND NOT NOW(): Hyperdrive decides cacheability by TEXT-MATCHING',
    '  the query for non-deterministic function names. It does not parse SQL, so a',
    "  mention inside a SQL COMMENT ('-- NOW()') marks the whole query uncacheable",
    '  too — delete the comment along with the call. The trade you are making:',
    '  Postgres evaluates NOW() per statement from the database clock; the parameter',
    "  is evaluated once per request from the worker's. Immaterial for period and",
    '  window predicates (they run in days). If a future predicate genuinely needs the',
    '  statement clock or sub-second agreement, that is a finding to raise — not a',
    '  case to exempt. This gate has no waiver list by design.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const roots = defaultRoots();
  const cache = collectCacheControlViolations({ roots });
  const kv = collectFloatingKvWriteViolations({ roots });
  const search = collectSearchBuilderViolations({ roots });
  const clock = collectNonDeterministicSqlViolations({ roots });

  // Fail closed on an empty scan. A broken root path would otherwise read as
  // green with 0 files — the exact blind spot that lets a newly added gate
  // never run. See apps/web/scripts/check-brand-editor-boundary.mjs, which
  // fails closed for the same reason.
  if (
    cache.filesScanned === 0 ||
    kv.filesScanned === 0 ||
    search.filesScanned === 0 ||
    clock.filesScanned === 0
  ) {
    console.error(
      'Data-access contract gate scanned 0 files — scan roots are misconfigured. Failing closed.'
    );
    process.exit(1);
  }

  // Rule 5 has a second way to read green without checking anything: the files
  // are there, but nothing in them is a search declaration any more. That is
  // indistinguishable from SEARCH_FIELD_NAMES having gone stale (the field was
  // renamed) or the declarations having moved out of the scanned roots, so it
  // fails closed too rather than reporting a clean sweep of an empty subject.
  if (search.declarationsFound === 0) {
    console.error(
      '\nRULE 5 — the gate found ZERO search declarations in the whole tree, so it checked\n' +
        'nothing. Twelve existed when it was written. Either every search facet is gone, or\n' +
        "the rule's field-name family no longer matches what they are called, or the scan\n" +
        'roots moved. Failing closed: fix SEARCH_FIELD_NAMES in\n' +
        'scripts/checks/check-data-access-contract.mjs, do not delete the rule.\n'
    );
    process.exit(1);
  }

  // Rule 6's version of the same blind spot: the files are there, but no `sql`
  // template is recognised in any of them. Every database predicate in this
  // repo is written with one, so zero means SQL_TAG_RE has gone stale and the
  // rule is reading green while checking nothing.
  if (clock.templatesFound === 0) {
    console.error(
      '\nRULE 6 — the gate found ZERO `sql` tagged templates in the whole tree, so it\n' +
        'checked nothing. Every database predicate in this repo is written with one.\n' +
        'Either the `sql` import was renamed, or the predicates moved out of the\n' +
        'scanned roots. Failing closed: fix SQL_TAG_RE in\n' +
        'scripts/checks/check-data-access-contract.mjs, do not delete the rule.\n'
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

  if (search.violations.length > 0) {
    failed = true;
    console.error(
      `\nRULE 5 — a search input not built by ${SEARCH_BUILDER}():\n`
    );
    for (const v of search.violations) {
      console.error(`  ${v.file}:${v.line}: ${v.field}: ${v.head}`);
    }
    console.error(
      '\n  Ten of the twelve original declarations set no minimum and two were written\n' +
        "  `z.string().trim().min(1)` — so a grep for `z.string().min` matched NONE of them\n" +
        '  and the drift was invisible. This rule does not look for the bad spellings; it\n' +
        '  looks for the absence of the good one.\n' +
        formatSearchBuilderGuidance()
    );
  }

  if (clock.violations.length > 0) {
    failed = true;
    console.error(
      '\nRULE 6 — a non-deterministic time function inside a `sql` template:\n'
    );
    for (const v of clock.violations) {
      console.error(`  ${v.file}:${v.line}: ${v.token}  |  ${v.text}`);
    }
    console.error('\n' + formatNonDeterministicSqlGuidance());
  }

  if (failed) {
    const total =
      shared.length +
      offVocab.length +
      kv.violations.length +
      search.violations.length +
      clock.violations.length;
    console.error(
      `\n${total} data-access contract violation(s). See scripts/checks/check-data-access-contract.mjs for the rules.\n`
    );
    process.exit(1);
  }

  console.log(
    `OK: no hand-written Cache-Control, no floating KV write, all ` +
      `${search.declarationsFound} declared search input(s) built by ${SEARCH_BUILDER}(), ` +
      `and no non-deterministic time function in ${clock.templatesFound} \`sql\` ` +
      `template(s), in ${cache.filesScanned} source file(s) across ${roots.length} ` +
      `package/worker/app src root(s).`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
