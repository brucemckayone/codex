#!/usr/bin/env node
// Re-verify this document's six live actions against origin/dev.
// Run: node verify-actions.mjs        (from the repo, any directory)
//
// WHY THIS EXISTS: when this document was written, FIVE of nine recommended
// actions turned out to be already done — every stale one had been taken from a
// bead description rather than from the code. This script asks the code.
import { execSync } from 'node:child_process';

const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }); } catch { return ''; } };
// Run every git command from the REPO ROOT. `git grep -- <pathspec>` resolves pathspecs
// relative to the CURRENT directory, while `git show origin/dev:<path>` uses repo-root paths
// — so running this script from its own directory made schemaFile() return '' for every
// table, and the two code-checkable structural proofs reported VOID and FAILS. A tool whose
// answer changes with the caller's cwd is worse than one that refuses to run.
const ROOT = sh('git rev-parse --show-toplevel').trim();
if (!ROOT) { console.error('not inside a git repository'); process.exit(2); }
process.chdir(ROOT);

const show = (p) => sh(`git show origin/dev:${p}`);
const count = (s, re) => (s.match(re) || []).length;

const behind = sh('git rev-list --count HEAD..origin/dev').trim() || '?';
console.log(`baseline: origin/dev, HEAD is ${behind} commit(s) behind\n`);

const CHECKS = [
  { n: 1, key: 'COUNTERS', open: () => {
      // NOT about getStats() — that is already public. The question is whether the
      // existing, tested kv-budget module is WIRED. Its only callers were its own tests.
      const callers = sh(`git grep -ln "instrumentKvBindings\\|createKvBudgetMiddleware\\|withKvBudget" origin/dev -- '*.ts'`)
        .split('\n').filter(l => l && !l.includes('/dist/') && !l.includes('__tests__') && !l.includes('kv-budget.ts'));
      return [callers.length === 0,
              callers.length === 0
                ? 'kv-budget.ts exists and is tested but has NO non-test caller → still open (one call in createWorker)'
                : `wired in ${callers.length} place(s): ${callers.map(f => f.replace('origin/dev:', '')).join(', ')}`];
    }},
  { n: 4, key: 'WAITUNTIL', open: () => {
      const f = show('packages/worker-utils/src/procedure/org-helpers.ts');
      // Count distinct LINES, not pattern hits: the previous version summed
      // /kv\.put\(...\)\.catch/ and /^\s*kv\.put\(/, and line 195 matches both — so it
      // reported 3 where there are 2, inviting a reader to hunt for a third.
      const bare = f.split('\n').filter((l) => /^\s*kv\.put\(/.test(l)).length;
      const wu = count(f, /waitUntil/g);
      return [wu === 0, `bare kv.put write-throughs: ${bare} (org-helpers.ts:195, :280), waitUntil in file: ${wu}` +
                        (wu === 0 ? ' → still open' : ' → check whether both write-throughs are covered')];
    }},
  { n: 5, key: 'READPATH', open: () => {
      const f = show('workers/organization-api/src/routes/organizations.ts');
      const hdr = count(f, /CACHE_HEADERS|Cache-Control|s-maxage/g);
      const pub = count(f, /auth: 'none'/g);
      // Fix 1 is the one item that can be written and verified while CI is red, so the tool
      // prints the value to copy rather than making the reader open content-api to find it.
      const src = show('workers/content-api/src/routes/public.ts');
      const val = (src.match(/c\.header\('Cache-Control',\s*'([^']+)'\)/) || [])[1] ?? '';
      const out = [`${pub} public routes, ${hdr} cache-header references` +
                   (hdr === 0 ? ' → still open' : ' → headers present, re-read')];
      if (val) out.push(`           copy from content-api/src/routes/public.ts:69 — '${val}'`);
      else out.push('           VOID: could not read content-api\'s middleware to name the header value');
      return [hdr === 0, out.join('\n')];
    }},
  { n: 6, key: 'DRIVER', open: () => {
      // Classified, not just counted — and the pathspec now includes package.json, which the
      // *.ts-only version silently excluded (two of them declare the dependency).
      //
      // This exists because a bare count here read as a contradiction: DRIVER said "7 files
      // reference a neon driver" while the importer audit said "none names a driver in CODE".
      // Both were right for their own scope. Two true numbers that appear to disagree are worse
      // than one number with its scope attached, so this prints the actual work list for fix 3.
      const files = sh(`git grep -ln "drizzle-orm/neon-http\\|@neondatabase/serverless" origin/dev -- '*.ts' '*.json'`)
        .split('\n').filter(l => l && !l.includes('/dist/')).map(l => l.replace('origin/dev:', ''));
      const waitOn = /wait-on tcp:4444/.test(show('package.json'));
      if (!files.length) {
        return [false, 'no file references a neon driver → swapped (or the tree could not be read — check by hand)'];
      }
      // ONE grep for every file, grouped in JS — the first version spawned a `git grep` per
      // file, which took this script from under a second to 4.1s. A tool the documents describe
      // as "one command" should not cost nine subprocesses to classify nine files.
      const byFile = new Map();
      for (const line of sh(
        `git grep -nE "drizzle-orm/neon-http|@neondatabase/serverless" origin/dev -- '*.ts' '*.json'`
      ).split('\n')) {
        if (!line || line.includes('/dist/')) continue;
        const parts = line.split(':');
        const file = parts[1];
        const body = parts.slice(3).join(':');
        if (!byFile.has(file)) byFile.set(file, []);
        byFile.get(file).push(body);
      }
      const kind = (f) => {
        if (f.endsWith('.json')) return 'dependency declaration';
        if (f === 'packages/database/src/client.ts') return 'THE CONSTRUCTION SITE';
        const bodies = byFile.get(f) ?? [];
        if (!bodies.length) return 'could not read';
        return bodies.every((x) => /^\s*(\*|\/\/|\/\*)/.test(x)) ? 'comment only — will go stale' : 'code';
      };
      const out = [`${files.length} files reference a neon driver` +
                   (waitOn ? '; package.json still waits on tcp:4444 (the proxy)' : '') + ' → still open'];
      for (const f of files) out.push(`           ${kind(f).padEnd(28)} ${f}`);
      // COINCIDENCE, FLAGGED so it does not read as confirmation. This list happens to be nine
      // files, and the documents also say "nine files change" — but they are DIFFERENT NINES.
      // This set is "files naming the driver", and includes two package.json dependency
      // declarations. The documents' set is "files that change", and includes constants.ts's
      // PROXY_PORT and the root package.json's wait-on, neither of which names a driver.
      // Two true counts of different sets, equal by accident, is exactly the shape that turns
      // into a false corroboration on the next read.
      out.push('           ─── the documents also say “nine files”, and it is a DIFFERENT nine:');
      out.push('               this list = files NAMING the driver · theirs = files that CHANGE');
      out.push('               (theirs adds constants.ts PROXY_PORT and the root wait-on; §05.3)');
      return [true, out.join('\n')];
    }},
  { n: 7, key: 'LADDERS', open: () => {
      const f = show('packages/access/src/services/content-access/access-decision.ts');
      // Three scopes, because a lone number here was misread once already: the document said
      // "9 sequential awaits" for a while, which is exactly what /^\s+(if \()?await / finds and
      // silently excludes `return (await helper())` — the same call in different dress. Report
      // the narrow form, the semantic one, and the file total, so no reader has to guess which.
      const ifForm = count(f, /^\s+(if \()?await /gm);
      const inLadders = count(f, /^\s+(?:if \(|return \()?await /gm);
      const allAwaits = count(f, /await /g);
      const pall = count(f, /Promise\.all/g);
      return [pall <= 1,
        `${inLadders} awaited checks in the ladders (${ifForm} in bare if-form, ${allAwaits} awaits in the file), ${pall} Promise.all` +
        (pall <= 1 ? ' → ladder still sequential' : ' → parallelised')];
    }},
  { n: 8, key: 'TYPESPLIT', open: () => {
      // Production surface and touch surface, both stated — the same distinction the driver
      // check makes. More than half of these live in TESTS (the three cache suites hold 31
      // between them), and a type split has to update those too, so neither figure alone is
      // the size of the job: 85/34 is what you edit, 40/24 is what ships.
      const all = sh(`git grep -c "new VersionedCache" origin/dev -- '*.ts'`).split('\n')
        .filter(l => l && !l.includes('/dist/'));
      const isTest = (l) => /__tests__|\.test\.ts/.test(l);
      const sum = (ls) => ls.reduce((a, l) => a + (+l.split(':').pop() || 0), 0);
      const prod = all.filter((l) => !isTest(l));
      const total = sum(all);
      const split = /ReaderCache|InvalidatorCache|WriterCache/.test(show('packages/cache/src/versioned-cache.ts'));
      if (!all.length) return [true, 'VOID — could not read the tree; no claim either way.'];
      return [!split,
        `${sum(prod)} constructions across ${prod.length} production files ` +
        `(${total} across ${all.length} counting tests — a type split edits those too)` +
        (split ? ' → split exists' : ' → single type, still open')];
    }},
  { n: 9, key: 'TRGM', open: () => {
      const ext = sh('git grep -c "pg_trgm" origin/dev').trim();
      const decls = sh(`git grep -c "search: z.string()" origin/dev -- 'packages/validation/**' 'apps/web/src/lib/remote/**'`)
        .split('\n').filter(Boolean);
      const total = decls.reduce((a, l) => a + (+l.split(':').pop() || 0), 0);
      // CHAIN-TOLERANT. The literal "search: z.string().min" reported ZERO minimums, because the
      // two declarations that have one are written `z.string().trim().min(1)` — .trim() sits in
      // between. The documents inherited that zero and said "12 declarations have no minimum",
      // which was wrong for two of them.
      //
      // And the distinction that actually matters: .min(1) only rejects the empty string, so a
      // ONE-CHARACTER query still scans everything, and pg_trgm cannot use a trigram index below
      // THREE characters. So count the useful threshold, not the presence of a call.
      const declLines = sh(
        `git grep -nE "search: z\\.string\\(\\)" origin/dev -- 'packages/validation/**' 'apps/web/src/lib/remote/**'`
      ).split('\n').filter(Boolean);
      const mins = declLines.map((l) => {
        const m = l.match(/\.min\((\d+)\)/);
        return m ? Number(m[1]) : 0;
      });
      const withMin = mins.filter((n) => n > 0).length;
      const trigramSafe = mins.filter((n) => n >= 3).length;
      return [!ext, `pg_trgm refs: ${ext || 0}; ${total} search declarations across validation + apps/web remote ` +
                    `(proof 6's 8 is the validation-only subset), ${withMin} with any minimum (all .min(1)), ` +
                    `${trigramSafe} with the >=3 a trigram index needs` +
                    (!ext ? ' → still open' : ' → extension referenced')];
    }},
];

let open = 0;
for (const c of CHECKS) {
  const [isOpen, detail] = c.open();
  if (isOpen) open++;
  console.log(`  ${isOpen ? 'OPEN  ' : 'DONE? '} ${String(c.n).padEnd(2)} ${c.key.padEnd(10)} ${detail}`);
}
console.log(`\n  ${open} of ${CHECKS.length} still open.`);
console.log('  Action 3 (PLAN) is a billing decision and 2 (RATELIMIT) landed — neither is checkable here.');

// Fix 3's containment claim, derived rather than quoted. An earlier revision said "thirty-two
// files import those clients", which matches NO scope — the real figures depend entirely on
// which client you mean. The argument holds at every scope, so the tool prints the scopes and
// the documents state only the quantifier.
{
  const count = (pat, extra = '') =>
    Number(
      sh(`git grep -lE "${pat}" origin/dev -- 'packages/**/*.ts' 'workers/**/*.ts' 'apps/**/*.ts' 2>/dev/null | grep -v dist | grep -v "packages/database/src"${extra} | wc -l`).trim()
    );
  const httpOnly = count('dbHttp');
  const both = count('dbHttp|createDbClient');
  const all = count('dbHttp|createDbClient|createPerRequestDbClient|dbWs');
  // A driver named in APPLICATION code would widen fix 3 from two expressions to a sweep.
  const named = sh(
    `git grep -lE "neon-http|drizzle-orm/neon|drizzle-orm/node-postgres|new Pool\\(" origin/dev -- 'packages/**/*.ts' 'workers/**/*.ts' 'apps/**/*.ts' 2>/dev/null | grep -v dist | grep -v "packages/database/src"`
  ).trim();
  const namedFiles = named ? named.split('\n').map((f) => f.replace('origin/dev:', '')) : [];
  if (!all) {
    console.log('  VOID   importers — could not read the tree; no claim either way.');
  } else {
    console.log(`  HOLDS  importers by scope: ${httpOnly} (dbHttp) / ${both} (+createDbClient) / ${all} (+per-request, dbWs)`);
    // Each hit is checked for whether the reference is CODE or a COMMENT. Two comments describe
    // drizzle-orm/neon-http to explain the per-statement round trip; they do not widen the change
    // but they become wrong the moment it lands, and nothing about a driver swap leads you to
    // them, because neither file imports the driver.
    let code = 0;
    const comments = [];
    for (const f of namedFiles) {
      const hits = sh(`git grep -nE "neon-http|drizzle-orm/neon|drizzle-orm/node-postgres|new Pool\\(" origin/dev -- ${f}`)
        .split('\n')
        .filter(Boolean);
      for (const h of hits) {
        // `git grep -n <rev>` emits THREE colon-separated fields before the body:
        //   origin/dev:packages/.../file.ts:2937:   * `drizzle-orm/neon-http` makes one
        // Stripping only two left the body starting with the LINE NUMBER, so a digit — and
        // every comment was misclassified as code. Split and rejoin instead of counting colons,
        // because a body can legitimately contain them (URLs, times, TypeScript types).
        const body = h.split(':').slice(3).join(':');
        if (/^\s*(\*|\/\/|\/\*)/.test(body)) comments.push(h.replace('origin/dev:', ''));
        else code++;
      }
    }
    if (code === 0) {
      console.log(`         and none names a driver in CODE — the swap stays contained.`);
    } else {
      console.log(`         but ${code} site(s) name a driver in CODE — fix 3 is wider than two expressions. READ THEM.`);
    }
    for (const c of comments) {
      console.log(`  NOTE   a COMMENT names the driver and will go stale with fix 3:`);
      console.log(`           ${c.slice(0, 118)}`);
    }
  }
}

// Fix 4's migration is only safe because of how the runner executes SQL, and the document
// calls this "a constraint that grows teeth" — so it is checked rather than remembered.
// The runner sends each migration file as ONE client.query(), and PostgreSQL wraps a
// multi-statement simple query in an implicit transaction. CREATE EXTENSION and a plain
// CREATE INDEX are fine inside one; CREATE INDEX CONCURRENTLY cannot run in a transaction
// at all, so it is not merely slow here — it is impossible with this runner.
{
  const runner = show('packages/database/scripts/migrate-direct.ts');
  if (!runner) {
    console.log('  VOID   migration runner — could not read migrate-direct.ts; no claim either way.');
  } else {
    const whole = /await client\.query\(migration\.sql\)/.test(runner);
    const conc = Number(sh(`git grep -c "CONCURRENTLY" origin/dev -- 'packages/database/**' | wc -l`).trim());
    console.log(`  ${whole ? 'HOLDS ' : 'CHECK '} the runner sends each migration as ONE client.query() ` +
      `→ CREATE INDEX CONCURRENTLY is impossible, plain CREATE INDEX/EXTENSION are fine`);
    if (!whole) console.log('           migrate-direct.ts no longer matches — re-read before trusting fix 4\'s spec.');
    console.log(`           ${conc === 0 ? 'no' : conc} CONCURRENTLY use(s) in packages/database today` +
      (conc === 0 ? ' — the constraint has not bitten yet' : ' — one of them cannot work with this runner'));
  }
}

// §2's search argument and fix 1's scope both rest on "8 of ~200 endpoints are public and
// read-only". Derived here so the ratio stays live: the endpoint total has already moved
// 186 -> 190 -> 199 during this investigation, and 8-of-190 vs 8-of-199 is 4.2% vs 4.0% —
// a drift the argument does not rest on, which is exactly why the figures should be computed
// rather than restated.
{
  const pub = Number(sh(`git grep -o "auth: 'none'" origin/dev -- 'workers/**/*.ts' | grep -v test | wc -l`).trim());
  const all = Number(sh(`git grep -o "procedure({" origin/dev -- 'workers/**/*.ts' | grep -v test | wc -l`).trim());
  const where = sh(`git grep -c "auth: 'none'" origin/dev -- 'workers/**/*.ts' | grep -v test`)
    .split('\n').filter(Boolean).map((l) => l.replace('origin/dev:workers/', ''));
  if (!pub || !all) {
    console.log('  VOID   public-endpoint ratio — could not read the workers; no claim either way.');
  } else {
    console.log(`  HOLDS  ${pub} public read endpoints of ${all} procedure() sites (${(100 * pub / all).toFixed(1)}%)`);
    for (const w of where) console.log(`           ${w}`);
  }
}

// The single most consequential figure in the decision document: "all 48 domain tables stay in
// Neon" is what "no schema changes" rests on. DERIVED, not asserted — the fixture is subtracted
// by name so the total moves on its own when someone adds a table.
{
  const all = sh(`git grep -o "pgTable(" origin/dev -- packages/database/src/schema | wc -l`).trim();
  const fixture = sh(`git grep -o "pgTable(" origin/dev -- packages/database/src/schema/test.ts | wc -l`).trim();
  const outside = sh(`git grep -o "pgTable(" origin/dev -- packages/database/src | grep -v "src/schema/" | wc -l`).trim();
  const total = Number(all), fx = Number(fixture), out = Number(outside);
  if (!total) {
    console.log('  VOID   table count — could not read the schema; no claim either way.');
  } else {
    const domain = total - fx;
    const ok = domain === 48 && out === 0;
    // Counted by OCCURRENCE, not by line: `grep -c` counts lines, and two declarations on one
    // line would silently undercount. Both methods agree at 49 here, which is why it is stated.
    console.log(`  ${ok ? 'HOLDS ' : 'CHECK '} ${domain} domain tables (${total} pgTable() occurrences less ${fx} fixture, ${out} outside schema/)`);
    if (!ok) {
      console.log(`           The documents say 48 with 0 outside schema/. Re-read §04 before trusting them.`);
    }
  }
}

// RUNTIME PARTITION, added 2026-08-30. "Which units need a Hyperdrive binding?" is a question
// about where code RUNS, and an import graph cannot answer it. Compatibility shims can: nobody
// polyfills a WebSocket in a Cloudflare Worker, because workers ship one. So the presence of
// `neonConfig.webSocketConstructor` or a `node:` IMPORT marks Node-side code, and its absence
// across the API workers confirms they are worker-runtime. One test, both directions.
//
// Grep for `^import ... node:`, never the bare string "node:" — it matches comments and DOM
// code (apps/web/src/lib/page-builder/render/reveal.ts deals with element nodes). And exclude
// __fixtures__ as well as test, which `grep -v test` alone does not catch.
{
  const units = ['workers/auth', 'workers/content-api', 'workers/organization-api', 'workers/ecom-api',
    'workers/admin-api', 'workers/identity-api', 'workers/notifications-api', 'workers/media-api', 'apps/web'];
  const nodeSide = [];
  const workerSide = [];
  for (const u of units) {
    const shims = sh(`git grep -lE "^import[^\n]*node:|webSocketConstructor" origin/dev -- '${u}/**/*.ts' 2>/dev/null | grep -v __fixtures__ | grep -v test`).trim();
    (shims ? nodeSide : workerSide).push(u);
  }
  // The polyfill alone is the precise fingerprint. A combined pattern with `node:` imports
  // returns 13 files, because scripts legitimately import node builtins — it is the WebSocket
  // shim that proves a file runs OUTSIDE a worker. The trim happens in JS: a trailing
  // `sed 's|origin/dev:||'` inside a template literal returned zero matches while the same
  // command worked in a shell, so the fragile part was removed rather than debugged.
  const scripts = sh(`git grep -lE 'webSocketConstructor' origin/dev -- 'packages/database/scripts/**' 'packages/test-utils/src/**' 2>/dev/null`)
    .trim().split('\n').filter(Boolean).map((f) => f.replace('origin/dev:', ''));
  if (!units.length || (!workerSide.length && !nodeSide.length)) {
    console.log('  VOID   runtime partition — could not read the tree; no claim either way.');
  } else {
    console.log(`  ${workerSide.length === 9 ? 'HOLDS' : 'CHECK'} runtime partition: ${workerSide.length} of ${units.length} units are worker-runtime (no node: import, no WebSocket polyfill)`);
    if (nodeSide.length) console.log(`           Node-side among them: ${nodeSide.join(', ')} — these do NOT want a Hyperdrive binding.`);
    console.log(`           and the Node-side scripts the binding must skip: ${scripts.join(', ') || '(none found — suspect the grep)'}`);
    if (workerSide.length !== 9)
      console.log('           The documents say NINE need a hyperdrive block. Re-read §05.3 before trusting that figure.');
  }
}

// Two BOUNDED SWEEPS added 2026-08-30. These are the document's strongest claims — not
// "here are two defects" but "here are two defects and that is all of them" — so they must
// be re-runnable rather than trusted. A sweep that cannot be repeated decays into a boast.
{
  // 1. Public routes vs cache headers, across every worker.
  const workers = ['auth', 'content-api', 'organization-api', 'ecom-api', 'admin-api',
    'identity-api', 'notifications-api', 'media-api'];
  const rows = workers.map((w) => {
    const pub = sh(`git grep -h "auth: 'none'" origin/dev -- 'workers/${w}/src/**/*.ts' 2>/dev/null | grep -v test | wc -l`).trim();
    const cc = sh(`git grep -h "Cache-Control" origin/dev -- 'workers/${w}/src/**/*.ts' 2>/dev/null | grep -v test | wc -l`).trim();
    return { w, pub: Number(pub) || 0, cc: Number(cc) || 0 };
  });
  const withPublic = rows.filter((r) => r.pub > 0);
  const gaps = withPublic.filter((r) => r.cc === 0);
  if (!rows.some((r) => r.pub > 0)) {
    console.log('  VOID   cache-header sweep — no public routes found at all; the grep or the tree is wrong.');
  } else {
    console.log(`  SWEEP  public routes exist in ${withPublic.length} of ${workers.length} workers: ` +
      withPublic.map((r) => `${r.w} (${r.pub} public, ${r.cc} cache refs)`).join(', '));
    console.log(`         ${gaps.length === 1 ? 'HOLDS' : 'CHECK'} — the document says exactly one worker has public routes and no cache header` +
      (gaps.length ? `: ${gaps.map((r) => r.w).join(', ')}` : ' (none found)'));
  }

  // 2. Fire-and-forget writes vs waitUntil, across every file that does one.
  const files = sh(`git grep -l "\\.catch(() => {})" origin/dev -- 'packages/**/*.ts' 'workers/**/*.ts' 2>/dev/null | grep -v dist | grep -v test | sed 's|origin/dev:||'`)
    .trim().split('\n').filter(Boolean);
  if (!files.length) {
    console.log('  VOID   waitUntil sweep — no fire-and-forget writes found; the grep is wrong.');
  } else {
    const bare = files.filter((f) => Number(sh(`git show origin/dev:${f} | grep -c "waitUntil"`).trim()) === 0);
    console.log(`  SWEEP  ${files.length} file(s) use .catch(() => {}); ${files.length - bare.length} thread waitUntil.`);
    console.log(`         ${bare.length === 1 ? 'HOLDS' : 'CHECK'} — the document says exactly one has none` +
      (bare.length ? `: ${bare.join(', ')}` : ' (none found)'));
  }
}

// Two facts found on 2026-08-30 by reading Hyperdrive's docs rather than its feature page.
// Both are code-checkable, so they are checked here rather than asserted in prose.
{
  // 1. Hyperdrive refuses to cache queries containing PostgreSQL STABLE functions (since
  //    2026-02-23), detected by TEXT PATTERN MATCHING — so even the name in a comment counts.
  //    Counted over application query code only: migrations are writes and JS identifiers named
  //    INTERVAL are not SQL. An earlier draft's "59" answered a different question.
  const stable = sh(
    `git grep -oE 'NOW\\(\\)|CURRENT_TIMESTAMP|CURRENT_DATE' origin/dev -- 'packages/**/*.ts' 'workers/**/*.ts' 'apps/**/*.ts' 2>/dev/null | grep -v dist`
  ).trim();
  const sites = sh(
    `git grep -nE 'NOW\\(\\)|CURRENT_TIMESTAMP|CURRENT_DATE' origin/dev -- 'packages/**/*.ts' 'workers/**/*.ts' 'apps/**/*.ts' 2>/dev/null | grep -v dist | sed 's|^origin/dev:||' | cut -d: -f1,2`
  ).trim();
  const n = stable ? stable.split('\n').length : 0;
  if (!stable && !sites) {
    console.log('  VOID   Hyperdrive/STABLE — could not read the tree; no claim either way.');
  } else {
    console.log(`  ${n === 1 ? 'HOLDS ' : 'CHECK '} Hyperdrive will not cache ${n} application quer${n === 1 ? 'y' : 'ies'} (STABLE functions):`);
    for (const line of sites.split('\n').filter(Boolean)) console.log(`           ${line}`);
    if (n !== 1) console.log('           The document states ONE. Re-read §A9.0 before trusting its figure.');
  }

  // 2. Worker regional placement — the cheapest answer to cross-region read latency, and
  //    documented as paying off exactly when a Worker makes MANY queries per request.
  const placed = sh(`git grep -l '"placement"' origin/dev -- '**/wrangler.jsonc' 2>/dev/null`).trim();
  const configs = sh(`git ls-tree -r --name-only origin/dev | grep -c 'wrangler.jsonc$'`).trim();
  if (!configs || configs === '0') {
    console.log('  VOID   placement — could not list wrangler.jsonc files; no claim either way.');
  } else if (!placed) {
    console.log(`  OPEN   placement is unset in all ${configs} wrangler.jsonc files — one line each,`);
    console.log('           "placement": { "region": "aws:eu-west-2" }, and this codebase makes ~31');
    console.log('           statements per render, which is the case Cloudflare says it helps.');
  } else {
    console.log(`  DONE   placement is set in: ${placed.split('\n').map((f) => f.replace('origin/dev:', '')).join(', ')}`);
  }
}
// This line said "NOT checkable by any script: the Neon autoscaling minimum CU" for the whole
// life of this script. That was untested and wrong — neonctl was installed and authenticated,
// and the reading took one command. Kept as a command rather than a value because cpu_used_sec
// and active_time are cumulative counters: the numbers move, the command does not.
console.log('  Neon compute settings — READ 2026-08-30 (0.25 min CU, 2 max, scale-to-zero on,')
console.log('  5.2% awake, 0.258 avg CU while awake). Re-read with:')
console.log('    npx neonctl projects list --org-id <org> --output json')
console.log('    npx neonctl branches get production --project-id <id> --output json');
if (open < CHECKS.length) console.log('\n  A "DONE?" is a prompt to read the code, not a conclusion.')

// State the denominator. This script checks 7 of the document's 9 actions, and an earlier
// revision of the document quoted "six live actions" — a number that came from this script's
// subset rather than from the action list. A tool that reports a count without its scope
// invites exactly that error (hazard class 7: right number, wrong denominator).
console.log(`  Scope: ${CHECKS.length} of the document's 9 actions, and 4 of the 7 structural arguments.`)
console.log('  Not checked here: 3 PLAN — a billing decision, not visible in code;')
console.log('                    2 RATELIMIT — verified landed by reading rate-limit.ts (§05.1),')
console.log('                    whose own comment is past-tense: "The KV store this replaced did')
console.log('                    kv.get then kv.put on every request".');

// ─── THE FOUR STRUCTURAL PROOFS ────────────────────────────────────────────────
// These, not the actions, are the architecture answer. If any one fails, the
// recommendation ("no D1") needs re-examining. Proof 1 and 4 are platform facts
// and cannot be checked from the repo; 2 and 3 are schema facts and can.
console.log('\nstructural proofs (the answer itself):');

const schemaFile = (t) => sh(`git grep -ln "export const ${t} = pgTable" origin/dev -- 'packages/database/src/schema/*.ts'`)
  .split('\n')[0].replace('origin/dev:', '').trim();
const tableDef = (t) => {
  const f = schemaFile(t); if (!f) return '';
  const src = show(f); const i = src.indexOf(`export const ${t} = pgTable`);
  if (i < 0) return '';
  const rest = src.slice(i); const end = rest.search(/\n\}\)/);
  return end < 0 ? rest : rest.slice(0, end);   // scope to the DEFINITION, not the file
};

{ // proof 2 — content.organizationId must be nullable
  const def = tableDef('content');
  // Scope to ONE property: from its name to the next property at the same indent.
  // A fixed character window would eventually catch a later column's .notNull().
  const prop = (name) => {
    const i = def.indexOf(`${name}:`);
    if (i < 0) return null;
    const rest = def.slice(i);
    // Next sibling property = the next line at this indent that looks like `name:`.
    // Do NOT require a comma immediately before the newline: a trailing comment
    // (`organizationId: uuid(...), // NULL = personal profile`) breaks that adjacency
    // and the slice then runs on far enough to reach a LATER column's .notNull().
    const end = rest.slice(1).search(/\n\s{4}[A-Za-z_]\w*:\s/) + 1;
    return end < 0 ? rest : rest.slice(0, end);
  };
  const isNotNull = (name) => { const b = prop(name); return b === null ? null : /\.notNull\(\)/.test(b); };

  // POSITIVE CONTROL: the same check must detect creatorId as notNull. If it cannot
  // distinguish the two columns, it is not testing anything and its verdict is void.
  // Two controls, because a positive one alone cannot catch a slice that overruns
  // into a later column (creatorId's own body legitimately contains .notNull()).
  const control = isNotNull('creatorId');                 // positive: must be true
  const negControl = isNotNull('mediaItemId');            // negative: must be false
  const nullable = isNotNull('organizationId') === false;

  if (control !== true || negControl !== false) {
    console.log(`  VOID   2  controls failed (creatorId→${control}, expected true; ` +
                `mediaItemId→${negControl}, expected false). The property slice is mis-scoped, ` +
                `so the verdict is void. Read schema/content.ts by hand.`);
  } else {
    console.log(`  ${nullable ? 'HOLDS' : 'FAILS'}  2  content.organizationId is nullable ` +
                `(controls: creatorId notNull ✓, mediaItemId nullable ✓)` +
                (nullable ? '' : '\n         ← it now has .notNull(). A per-org partition becomes possible; re-read §03.'));
  }
}
{ // proof 3 — user↔org is many-to-many TWICE, via two separate tables
  // A control, for the same reason proof 2 has two: an empty definition must read as "I could
  // not look", never as "the relation is absent". Without it a mis-scoped grep reported FAILS
  // on a load-bearing proof — indistinguishable, in the output, from a real schema change.
  const NAMES = ['organizationMemberships', 'organizationFollowers'];
  const defs = NAMES.map(tableDef);
  if (defs.some((d) => !d)) {
    console.log(`  VOID   3  could not locate ${NAMES.filter((_, i) => !defs[i]).join(', ')} ` +
                `in packages/database/src/schema/ — the verdict is void, not negative. ` +
                `Check the pathspec, not the schema.`);
  } else {
  const both = defs.map((d) => /organizationId/.test(d) && /userId/.test(d));
  const holds = both.every(Boolean);
  console.log(`  ${holds ? 'HOLDS' : 'FAILS'}  3  user↔org is many-to-many twice ` +
              `(memberships: ${both[0] ? 'yes' : 'no'}, followers: ${both[1] ? 'yes' : 'no'})`);
  }
}
// Proofs 2 and 3 above print what this script actually VERIFIED in the schema, which is
// correct for a verifier. Proof 1 is a platform fact it cannot check, so its line is a
// summary — and a summary should carry the sharpened form, because the earlier wording
// ("bindings are static") invites the obvious rebuttal that you could just declare N of them.
{ // proof 5 — the 100-bound-parameter limit, against an unbounded inlined IN (…)
  // Code-checkable, and it was not being checked. The predicate binds ONE parameter per
  // org id, so the count is a property of the user's membership list, not of the query text.
  const lib = show('packages/access/src/services/content-access/library.ts');
  const hasJoin = /NOT IN \(\$\{sql\.join\(/.test(lib) || /sql\.join\(\s*managementOrgIds/.test(lib);
  const mapsIds = /managementOrgIds\.map\(/.test(lib);
  // Control: the file must be non-empty and must actually mention the array, or the verdict
  // is void rather than negative — the lesson proof 3 learned the hard way.
  if (!lib || !/managementOrgIds/.test(lib)) {
    console.log('  VOID   5  could not read library.ts or find managementOrgIds — check the path, not the code.');
  } else {
    console.log(`  ${hasJoin && mapsIds ? 'HOLDS' : 'FAILS'}  5  library.ts inlines one bound parameter per management org ` +
                `(sql.join: ${hasJoin ? 'yes' : 'no'}, .map over ids: ${mapsIds ? 'yes' : 'no'})` +
                (hasJoin && mapsIds ? '\n            → a user in 100+ orgs exceeds D1\'s 100-parameter cap. Unbounded by construction.'
                                    : '\n            ← the shape changed; re-read §03 before relying on this argument.'));
  }
}

{ // proof 6 — the 50-byte LIKE/GLOB pattern cap, against what the schema permits
  const maxes = [];
  for (const f of sh("git grep -l \"search: z.string()\" origin/dev -- 'packages/validation/src/**/*.ts'")
        .split('\n').filter(Boolean).map((x) => x.replace('origin/dev:', '').trim())) {
    for (const m of show(f).matchAll(/search:\s*z\.string\(\)[^;]*?\.max\((\d+)\)/g)) maxes.push(Number(m[1]));
  }
  if (!maxes.length) {
    console.log('  VOID   6  found no `search: z.string()` declarations to measure — check the pathspec.');
  } else {
    const worst = Math.max(...maxes);
    console.log(`  ${worst > 50 ? 'HOLDS' : 'FAILS'}  6  the search schema permits up to ${worst} characters ` +
                // Scope stated. This counts validation-package declarations carrying a .max(); the TRGM
      // check counts `search: z.string()` across validation AND apps/web/src/lib/remote, so it
      // reports 12. Both are right; two bare numbers from one tool read as a contradiction.
      `across ${maxes.length} declaration(s) in packages/validation/src (the TRGM line's 12 ` +
      `also counts apps/web/src/lib/remote), against D1's 50-BYTE LIKE/GLOB pattern cap` +
                (worst > 50 ? `\n            → over by ${(worst / 50).toFixed(1)}×. Rules out porting the query as written (not FTS5).`
                            : '\n            ← a minimum/maximum now keeps queries under 50 bytes; re-read §03.'));
  }
}

console.log('  N/A    1  D1 bindings are static — no runtime addressing (workerd #3564, one reply');
console.log('            since Feb 2025). The only variant that works is N DECLARED bindings: one');
console.log('            config entry per tenant plus a redeploy to onboard anyone, against a');
console.log('            ~5,000-binding ceiling. A fixed roster, not a dynamic-tenant architecture.');
// Proof 4 was restated in the document: hibernation means duration scales with request
// volume, not tenant count, so the cost argument is soft. The argument that survives is
// LOCALITY — a DO is a single instance and cannot be replicated. This line printed the
// superseded framing for several revisions after the document had moved on: the script is
// naming text, and naming text lags arguing text (§07.0d).
console.log('  N/A    4  A Durable Object is a SINGLE INSTANCE — cannot be replicated, so a per-tenant');
console.log('            read store reintroduces the 81 ms RTT this document exists to remove.');
console.log('            (Do not lead with duration billing: objects eligible for hibernation are not');
console.log('             billed for it, so that scales with request volume, not tenant count.)');
console.log('\n  NOTE: schema greps must be scoped to the DEFINITION, not the file.');
console.log('        organizationMemberships lives in schema/content.ts — a file-wide grep for');
console.log('        "organizationId" returns four tables and can falsify proof 2 by accident.');
