/**
 * Tests for the load-failure Retry gate (Codex-if444).
 *
 * node:test rather than vitest, as for check-dialog-structure: the thing
 * under test is a plain `.mjs` CLI. Wired via `pnpm --filter web run
 * check:load-retry:test` and a self-test step in static_analysis.yml.
 *
 * Each case writes a throwaway `src/` tree and points `collectViolations` at
 * it. The real tree is never touched. Every rule is shown to fire on a
 * minimal bad sample and to stay quiet on the good one beside it.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ALLOWLIST,
  blankComments,
  collectViolations,
  failureLines,
  OWNER,
} from './check-load-retry.mjs';

const GATE = fileURLToPath(new URL('./check-load-retry.mjs', import.meta.url));

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'load-retry-gate-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeFixture(relPath, content) {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function scan(allowlist = []) {
  return collectViolations({
    srcRoot: join(root, 'src'),
    cwd: root,
    allowlist,
  });
}

/** `file:line rule` for each violation, the shape the assertions compare. */
function summary(result) {
  return result.violations.map((v) => `${v.file}:${v.line} ${v.rule}`);
}

/** The 1-based line of the first `needle` in `text`. */
function lineOf(text, needle) {
  const at = text.indexOf(needle);
  assert.notEqual(at, -1, `fixture has no ${needle}`);
  return text.slice(0, at).split('\n').length;
}

/**
 * A page that derives a remote read and retries it from its failed state.
 * `retry` is the handler's body; `script` adds bindings; `markup` replaces
 * the failed branch.
 */
function page({
  retry,
  script = '',
  imports = "import { getThing } from '$lib/remote/thing.remote';",
  query = 'const thingQuery = $derived(getThing());',
  markup = '{#if thingFailed}<button onclick={retry}>Try again</button>{/if}',
}) {
  return `<script lang="ts">
  ${imports}
  ${query}
  const thingFailed = $derived(thingQuery.error != null);
  let outcome = $state<string | null>(null);
  let busy = $state(false);
  ${script}
  async function retry() {
    ${retry}
  }
</script>
${markup}
`;
}

// --- derived-refresh: fires ------------------------------------------------

test('derived-refresh FIRES on a Retry that awaits a $derived query, then reads what it built', () => {
  const src = page({
    retry:
      'await thingQuery.refresh();\n    outcome = thingFailed ? "failed" : "ok";',
  });
  writeFixture('src/routes/bad/+page.svelte', src);
  const result = scan();
  assert.deepEqual(summary(result), [
    `src/routes/bad/+page.svelte:${lineOf(src, 'await')} derived-refresh`,
  ]);
  assert.match(result.violations[0].detail, /refresh of `thingQuery`/);
  assert.match(result.violations[0].detail, /then reads `thingFailed`/);
  assert.match(result.violations[0].detail, /LoadFailedAlert/);
});

test('derived-refresh FIRES on each shape of the awaited refresh and of what follows it', () => {
  const cases = {
    // Reads nothing: the busy flag tracks the stray read.
    finally:
      'try {\n      await thingQuery.refresh();\n    } finally {\n      busy = false;\n    }',
    alias:
      'const query = thingQuery;\n    await query.refresh();\n    outcome = query.error ? "failed" : "ok";',
    chained:
      'await thingQuery?.refresh().catch(() => {});\n    document.querySelector("h2")?.focus();',
    all: 'await Promise.all([thingQuery.refresh()]);\n    busy = false;',
  };
  for (const [name, retry] of Object.entries(cases)) {
    writeFixture(`src/routes/${name}/+page.svelte`, page({ retry }));
  }
  assert.deepEqual(
    scan()
      .violations.map((v) => `${v.file} ${v.rule}`)
      .sort(),
    Object.keys(cases)
      .map((name) => `src/routes/${name}/+page.svelte derived-refresh`)
      .sort()
  );
});

test('derived-refresh FIRES through a same-file helper that refreshes the query', () => {
  const src = page({
    script:
      'async function reread() {\n    await Promise.all([thingQuery.refresh()]);\n  }',
    retry:
      'try {\n      await reread();\n    } catch {\n      outcome = "failed";\n    }',
  });
  writeFixture('src/routes/helper/+page.svelte', src);
  const result = scan();
  // The Retry, not the helper: the helper is not pressed from a failure.
  assert.deepEqual(summary(result), [
    `src/routes/helper/+page.svelte:${lineOf(src, 'await reread')} derived-refresh`,
  ]);
  assert.match(result.violations[0].detail, /through `reread\(\)`/);
});

test('derived-refresh FIRES on a handler written inline in the failed branch', () => {
  const src = page({
    retry: 'busy = false;',
    markup:
      '{#if thingFailed}<button onclick={async () => {\n  await thingQuery.refresh();\n  busy = false;\n}}>Try again</button>{/if}',
  });
  writeFixture('src/routes/inline/+page.svelte', src);
  assert.deepEqual(summary(scan()), [
    `src/routes/inline/+page.svelte:${lineOf(src, 'await thingQuery')} derived-refresh`,
  ]);
});

test('derived-refresh FIRES from every failed branch: {:else} of a loaded test, {:else if}, {:catch}, a prop', () => {
  const branches = {
    else: '{#if !thingFailed}<p>ok</p>{:else}<button onclick={retry}>Try again</button>{/if}',
    elseif:
      "{#if thingQuery.current}<p>ok</p>{:else if problem === 'failed'}<button onclick={retry}>Try again</button>{/if}",
    catch:
      '{#await Promise.resolve()}<p>…</p>{:then}<p>ok</p>{:catch}<button onclick={retry}>Try again</button>{/await}',
    prop: '{#if thingFailed}<Note failed onTryAgain={() => retry()} />{/if}',
  };
  for (const [name, markup] of Object.entries(branches)) {
    writeFixture(
      `src/routes/${name}/+page.svelte`,
      page({
        script: "const problem = $derived(thingFailed ? 'failed' : null);",
        retry: 'await thingQuery.refresh();\n    busy = false;',
        markup,
      })
    );
  }
  assert.deepEqual(
    scan()
      .violations.map((v) => v.file)
      .sort(),
    Object.keys(branches)
      .map((name) => `src/routes/${name}/+page.svelte`)
      .sort()
  );
});

test('derived-refresh FIRES on a load read, and on awaiting invalidate() then reading `data`', () => {
  const loadRead = page({
    imports:
      "import { loadRead } from '$lib/components/studio/alert-read';\n  import { invalidate } from '$app/navigation';",
    query:
      "const thingQuery = $derived(loadRead({ current: undefined, error: 'x', refresh: () => invalidate('k') }));",
    retry: 'await thingQuery.refresh();\n    busy = false;',
  });
  writeFixture('src/routes/load-read/+page.svelte', loadRead);

  const invalidated = `<script lang="ts">
  import { invalidate } from '$app/navigation';
  let { data } = $props();
  let outcome = $state<string | null>(null);
  async function retryLoad() {
    await invalidate('account:things');
    outcome = data.loadFailed ? 'failed' : 'ok';
  }
</script>
{#if data.loadFailed}<button onclick={retryLoad}>Try again</button>{/if}
`;
  writeFixture('src/routes/invalidated/+page.svelte', invalidated);

  const result = scan();
  assert.deepEqual(summary(result), [
    `src/routes/invalidated/+page.svelte:${lineOf(invalidated, 'await')} derived-refresh`,
    `src/routes/load-read/+page.svelte:${lineOf(loadRead, 'await')} derived-refresh`,
  ]);
  assert.match(
    result.violations[0].detail,
    /`invalidate\(\)`, then reads `data`/
  );
});

test('derived-refresh FIRES in a .svelte.ts module on a function named for a Retry', () => {
  const src = `/**
 * A doc comment with an example that closes a script tag:
 *   </script>
 */
import { getThing } from '$lib/remote/thing.remote';

export function createThing() {
  const thing = $derived(getThing());
  let retrying = $state(false);
  return {
    async retry() {
      await thing.refresh();
      retrying = false;
    },
  };
}
`;
  writeFixture('src/lib/thing.svelte.ts', src);
  assert.deepEqual(summary(scan()), [
    `src/lib/thing.svelte.ts:${lineOf(src, 'await')} derived-refresh`,
  ]);
});

// --- derived-refresh: quiet ------------------------------------------------

test('derived-refresh is QUIET on LoadFailedAlert, the shape it asks for', () => {
  writeFixture(
    'src/routes/ok/+page.svelte',
    `<script lang="ts">
  import LoadFailedAlert from '$lib/components/studio/LoadFailedAlert.svelte';
  import { getThing } from '$lib/remote/thing.remote';
  const thingQuery = $derived(getThing());
  let retrying = $state(false);
</script>
<LoadFailedAlert query={thingQuery} bind:retrying message="a" againMessage="b" loadedMessage="c" />
`
  );
  assert.deepEqual(summary(scan()), []);
});

test('derived-refresh is QUIET where the read is right or no Retry judges it', () => {
  const quiet = {
    // Held outside a $derived: kit never swaps it.
    captured: page({
      query: 'const thingQuery = getThing();',
      retry: 'await thingQuery.refresh();\n    busy = false;',
    }),
    // A refresh after a mutation: the query has loaded, and re-reads in place.
    mutation: page({
      imports:
        "import { getThing, saveThing } from '$lib/remote/thing.remote';",
      retry:
        'await saveThing();\n    await thingQuery.refresh();\n    busy = false;',
    }),
    // Not awaited: nothing waits on the stray read.
    'fire-and-forget': page({
      retry: 'void thingQuery.refresh().catch(() => {});\n    busy = false;',
    }),
    // In a callback the function hands on: not its own await.
    callback: page({
      script:
        'async function readThing(run: () => Promise<unknown>) { return run(); }',
      retry: 'await readThing(() => thingQuery.refresh());\n    busy = false;',
    }),
    // Nothing runs after it.
    'nothing-after': page({ retry: 'await thingQuery.refresh();' }),
    // Not pressed from a failure: a Review of a loaded read.
    loaded: page({
      retry:
        'await thingQuery.refresh();\n    outcome = thingQuery.current ? "ok" : null;',
      markup:
        '{#if thingQuery.current}<button onclick={retry}>Review</button>{/if}',
    }),
    // Not a remote read.
    'not-remote': page({
      imports: "import { getThing } from '$lib/utils/thing';",
      retry: 'await thingQuery.refresh();\n    busy = false;',
    }),
  };
  for (const [name, src] of Object.entries(quiet)) {
    writeFixture(`src/routes/${name}/+page.svelte`, src);
  }
  writeFixture(
    'src/lib/session.svelte.ts',
    `import { getThing } from '$lib/remote/thing.remote';
export function createSession() {
  const draft = $derived(getThing());
  // Not named for a Retry: a re-read of a draft that has loaded.
  async function adoptLostSave() {
    await draft.refresh();
    return draft.current;
  }
  return { adoptLostSave };
}
`
  );
  writeFixture(
    'src/routes/invalidate-ok/+page.svelte',
    `<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { saveThing } from '$lib/remote/thing.remote';
  let { data } = $props();
  let busy = $state(false);
  async function retrySave() {
    await saveThing();
    await invalidate('k');
    busy = data.loadFailed;
  }
  async function retryLoad() {
    await invalidate('k');
    busy = false;
  }
</script>
{#if data.loadFailed}<button onclick={retrySave}>a</button><button onclick={retryLoad}>b</button>{/if}
`
  );
  assert.deepEqual(summary(scan()), []);
});

/**
 * E3's drafts menu (Codex-a6ofh.3), in its exact shape: the query is made
 * on demand inside `$derived.by`, and Try again judges only the promise of
 * the query it refreshed. With `untrack`, the derivation does not track the
 * query, kit's refresh can't swap it, and that promise IS the answer.
 */
function draftsMenu({ untracked }) {
  const made =
    "listContent({ organizationId: org, status: 'draft', limit: 5 })";
  return `<script lang="ts">
  ${untracked ? "import { untrack } from 'svelte';" : ''}
  import { listContent } from '$lib/remote/content.remote';
  let { organizationId } = $props();
  let asked = $state(false);
  let outcome = $state<'loaded' | 'still-failed' | null>(null);
  const draftsQuery = $derived.by(() => {
    if (!asked) return null;
    const org = organizationId;
    return ${untracked ? `untrack(() => ${made})` : made};
  });
  async function retry() {
    const query = draftsQuery;
    if (!query) return;
    try {
      await query.refresh();
      outcome = 'loaded';
    } catch {
      outcome = 'still-failed';
    }
  }
</script>
{#if draftsQuery?.error}<p>Couldn't load drafts.</p><button onclick={retry}>Try again</button>{/if}
`;
}

test('derived-refresh is QUIET on a query made inside untrack(), and FIRES on its tracked twin', () => {
  const tracked = draftsMenu({ untracked: false });
  writeFixture('src/lib/menu/Tracked.svelte', tracked);
  writeFixture(
    'src/lib/menu/Untracked.svelte',
    draftsMenu({ untracked: true })
  );
  assert.deepEqual(summary(scan()), [
    `src/lib/menu/Tracked.svelte:${lineOf(tracked, 'await')} derived-refresh`,
  ]);
});

test("untrack() is exempt only as Svelte's: a local function of that name is not", () => {
  const src = draftsMenu({ untracked: true }).replace(
    "import { untrack } from 'svelte';",
    "import { untrack } from '$lib/utils/untrack';"
  );
  writeFixture('src/lib/menu/LocalUntrack.svelte', src);
  assert.deepEqual(summary(scan()), [
    `src/lib/menu/LocalUntrack.svelte:${lineOf(src, 'await')} derived-refresh`,
  ]);
});

// --- retry-label -----------------------------------------------------------

test("retry-label FIRES on LoadFailedAlert's Retry label anywhere else", () => {
  const svelte = `<script lang="ts">
  import * as m from '$paraglide/messages';
  let busy = $state(false);
</script>
<button>{busy ? m.money_setup_load_failed_retrying() : m.money_setup_load_failed_retry()}</button>
`;
  writeFixture('src/routes/label/+page.svelte', svelte);
  const ts = `import * as m from '$paraglide/messages';
export const label = () => 'https://example.test/' + m.money_setup_load_failed_retry();
`;
  writeFixture('src/lib/label.ts', ts);
  assert.deepEqual(summary(scan()), [
    'src/lib/label.ts:2 retry-label',
    `src/routes/label/+page.svelte:${lineOf(svelte, '<button>')} retry-label`,
    `src/routes/label/+page.svelte:${lineOf(svelte, '<button>')} retry-label`,
  ]);
});

test('retry-label is QUIET in LoadFailedAlert itself, tests, fixtures, comments and other keys', () => {
  const uses =
    'm.money_setup_load_failed_retry(); m.money_setup_load_failed_retrying();';
  writeFixture(`src/${OWNER}`, `<script lang="ts">\n  ${uses}\n</script>\n`);
  writeFixture('src/lib/a.svelte.test.ts', uses);
  writeFixture('src/lib/__tests__/b.ts', uses);
  writeFixture('src/lib/__fixtures__/c.svelte.ts', uses);
  writeFixture('src/tests/d.ts', uses);
  writeFixture(
    'src/lib/e.svelte',
    `<!-- the label is m.money_setup_load_failed_retry() -->
<script lang="ts">
  // money_setup_load_failed_retrying, in a comment
  /* money_setup_load_failed_retry */
  const ok = m.money_setup_load_retry_ok();
</script>
`
  );
  writeFixture('src/paraglide/messages/en.js', uses);
  assert.deepEqual(summary(scan()), []);
});

test('blankComments keeps offsets and newlines, and skips strings', () => {
  const src = "a // x\nb /* y\n */ c 'http://z' <!-- w -->";
  const out = blankComments(src);
  assert.equal(out.length, src.length);
  assert.deepEqual(
    out.split('\n').map((l) => l.trim()),
    ['a', 'b', "c 'http://z'"]
  );
});

// --- parse -----------------------------------------------------------------

test('a file that does not parse FAILS as parse, never passes unchecked', () => {
  writeFixture(
    'src/routes/broken/+page.svelte',
    '<script lang="ts">\n  const x = ;\n</script>\n'
  );
  assert.deepEqual(
    scan().violations.map((v) => `${v.file} ${v.rule}`),
    ['src/routes/broken/+page.svelte parse']
  );
});

// --- ALLOWLIST -------------------------------------------------------------

test('an ALLOWLIST entry waives exactly its `expect` count; one that matches nothing is stale', () => {
  writeFixture(
    'src/routes/bad/+page.svelte',
    page({ retry: 'await thingQuery.refresh();\n    busy = false;' })
  );
  const entry = {
    file: 'src/routes/bad/+page.svelte',
    rule: 'derived-refresh',
    expect: 1,
    bead: 'Codex-test.1',
    reason: 'test',
  };
  const exact = scan([entry]);
  assert.deepEqual(summary(exact), []);
  assert.equal(exact.allowlisted, 1);
  assert.deepEqual(exact.stale, []);
  assert.deepEqual(exact.miscounted, []);
  assert.deepEqual(failureLines(exact), []);

  const miscounted = scan([{ ...entry, expect: 2 }]);
  assert.equal(miscounted.miscounted.length, 1);
  assert.equal(miscounted.miscounted[0].found, 1);
  assert.equal(failureLines(miscounted).length, 1);

  const otherRule = scan([{ ...entry, rule: 'retry-label' }]);
  assert.equal(otherRule.violations.length, 1);
  assert.equal(otherRule.stale.length, 1);
});

test('a STALE entry is an error: once its file is fixed the gate fails and names the bead', () => {
  const entry = {
    file: 'src/routes/fixed/+page.svelte',
    rule: 'derived-refresh',
    expect: 1,
    bead: 'Codex-test.2',
    reason: 'test',
  };
  // The copy as it was: the entry waives it, and the gate passes.
  writeFixture(
    entry.file,
    page({ retry: 'await thingQuery.refresh();\n    busy = false;' })
  );
  assert.deepEqual(failureLines(scan([entry])), []);

  // The bead fixes the file but leaves its line: the gate now fails on it.
  writeFixture(entry.file, page({ retry: 'busy = false;' }));
  const result = scan([entry]);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(failureLines(result), [
    `${entry.file} derived-refresh: allowlisted (Codex-test.2) but no longer violates. Delete its ALLOWLIST entry.`,
  ]);
});

test('every real ALLOWLIST entry names its bead, is pinned to a count and gives a one-line reason', () => {
  for (const a of ALLOWLIST) {
    assert.match(
      a.bead ?? '',
      /^Codex-[a-z0-9]+(?:\.\d+)*$/,
      `${a.file}: bead`
    );
    assert.ok(Number.isInteger(a.expect) && a.expect > 0, `${a.file}: expect`);
    assert.ok(a.reason && !a.reason.includes('\n'), `${a.file}: reason`);
    assert.ok(
      ['retry-label', 'derived-refresh'].includes(a.rule),
      `${a.file}: rule`
    );
  }
});

// --- CLI -------------------------------------------------------------------

const runGate = (...args) =>
  spawnSync(process.execPath, args, { encoding: 'utf8' });

test('the CLI exits 1 on a violation, 0 on a clean tree, 2 on a bad flag (--root)', () => {
  writeFixture(
    'src/routes/bad/+page.svelte',
    page({ retry: 'await thingQuery.refresh();\n    busy = false;' })
  );
  const bad = runGate(GATE, '--root', root);
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(
    bad.stderr,
    /src\/routes\/bad\/\+page\.svelte:\d+ derived-refresh: /
  );

  rmSync(join(root, 'src/routes/bad'), { recursive: true });
  writeFixture('src/routes/good/+page.svelte', '<p>ok</p>\n');
  const good = runGate(GATE, `--root=${root}`);
  assert.equal(good.status, 0, good.stderr);
  assert.match(
    good.stdout,
    /^OK: no hand-written load-failure Retry in 1 file/
  );

  // A mistyped flag must not fall back to scanning the real tree.
  assert.equal(runGate(GATE, '--rot', root).status, 2);
  assert.equal(runGate(GATE, '--root').status, 2);
});

test('the CLI fails closed when it scans no files', () => {
  mkdirSync(join(root, 'src'), { recursive: true });
  const empty = runGate(GATE, '--root', root);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /scanned 0 files/);
});
