/**
 * Self-test for the architecture gate's runner (G0, Codex-xtcfl).
 *
 * "A check that has never failed has proven nothing" (the data-access gate's
 * self-test says why), so the ratchet is asserted in every direction: a new
 * violation, a grown count, a fixed count that wasn't banked, a vanished file,
 * an unknown rule, and the equal case that must pass. The commit-time mode is
 * asserted against a REAL throwaway git repository, because its whole claim is
 * that it reads the index rather than the working tree, and only git can show
 * that.
 *
 * Run with `node --test`: the runner is a dependency-free .mjs, and this suite
 * must run in the static-analysis job, which has no database.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { countLines, MATCHERS } from './architecture-matchers.mjs';
import {
  collect,
  compare,
  formatProblems,
  globToRegExp,
  initialBaseline,
  inScope,
  lowerBaseline,
  memorySource,
  missingCountersigns,
  raisedEntries,
  serializeBaseline,
  validateRules,
} from './check-architecture.mjs';

const RUNNER = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-architecture.mjs'
);

const CALL_RULE = {
  id: 'T1',
  title: 'No forbidden() call',
  why: 'fixture',
  fix: 'Call allowed() instead.',
  scope: { include: ['src/**/*.ts'], exclude: ['src/owner.ts'] },
  match: { kind: 'call', pattern: /\bforbidden\(/ },
};

const SIZE_RULE = {
  id: 'T-SIZE',
  title: 'Files stay small',
  why: 'fixture',
  fix: 'Extract a module.',
  scope: { include: ['src/**/*.ts'] },
  match: { kind: 'line-count', newFileMax: 3 },
};

const run = (rules, tree, baseline, commit) => {
  const source = memorySource(tree, commit);
  const results = collect(rules, source);
  return { results, problems: compare(rules, results, baseline, source) };
};

const types = (problems) =>
  problems.map((p) => `${p.type}:${p.ruleId}:${p.file ?? ''}`).sort();

describe('globs', () => {
  test('** spans directories, * stays in one segment, {a,b} alternates', () => {
    const re = globToRegExp('packages/*/src/**/*.ts');
    assert.ok(re.test('packages/a/src/x.ts'));
    assert.ok(re.test('packages/a/src/deep/er/x.ts'));
    assert.ok(!re.test('packages/a/b/src/x.ts'));
    assert.ok(!re.test('packages/a/src/x.tsx'));
    const alt = globToRegExp('packages/{payments,purchase}/src/*.ts');
    assert.ok(alt.test('packages/purchase/src/x.ts'));
    assert.ok(!alt.test('packages/content/src/x.ts'));
    assert.ok(
      globToRegExp('**/__tests__/**').test('packages/a/src/__tests__/x.ts')
    );
    assert.ok(
      globToRegExp('**/*.md').test('README.md'),
      '**/ matches zero directories'
    );
  });

  test('exclude wins over include', () => {
    assert.ok(inScope(CALL_RULE, 'src/a.ts'));
    assert.ok(!inScope(CALL_RULE, 'src/owner.ts'));
    assert.ok(!inScope(CALL_RULE, 'lib/a.ts'));
  });
});

describe('the call matcher', () => {
  test('counts code, not comments, and reports the line', () => {
    const text = [
      '// forbidden( in a line comment',
      '/** forbidden( in a JSDoc block */',
      'const x = 1;',
      'forbidden(x);',
    ].join('\n');
    const { found, hits } = MATCHERS.call.file(CALL_RULE, 'src/a.ts', text);
    assert.equal(found, 1);
    assert.deepEqual(hits, [{ line: 4, text: 'forbidden(x);' }]);
  });

  test('a near miss does not fire', () => {
    const { found } = MATCHERS.call.file(
      CALL_RULE,
      'src/a.ts',
      'notforbidden(x);\nforbiddenish(y);'
    );
    assert.equal(found, 0);
  });
});

describe('the ratchet', () => {
  test('equal counts pass', () => {
    const { problems } = run(
      [CALL_RULE],
      { 'src/a.ts': 'forbidden();\n' },
      { T1: { 'src/a.ts': 1 } }
    );
    assert.deepEqual(problems, []);
  });

  test('a violation in an unlisted file is new', () => {
    const { problems } = run([CALL_RULE], { 'src/a.ts': 'forbidden();\n' }, {});
    assert.deepEqual(types(problems), ['new:T1:src/a.ts']);
  });

  test('a grown count fails as more', () => {
    const { problems } = run(
      [CALL_RULE],
      { 'src/a.ts': 'forbidden();\nforbidden();\n' },
      { T1: { 'src/a.ts': 1 } }
    );
    assert.deepEqual(types(problems), ['more:T1:src/a.ts']);
  });

  test('a fixed count that was not banked fails, so its headroom cannot be re-spent', () => {
    const tree = { 'src/a.ts': 'forbidden();\n' };
    assert.deepEqual(
      types(run([CALL_RULE], tree, { T1: { 'src/a.ts': 2 } }).problems),
      ['fewer:T1:src/a.ts']
    );
    assert.deepEqual(
      types(
        run([CALL_RULE], { 'src/a.ts': 'ok();\n' }, { T1: { 'src/a.ts': 2 } })
          .problems
      ),
      ['remove:T1:src/a.ts']
    );
  });

  test('an entry for a deleted or out-of-scope file is stale', () => {
    const { problems } = run(
      [CALL_RULE],
      { 'src/b.ts': 'ok();\n', 'src/owner.ts': 'forbidden();\n' },
      {
        T1: { 'src/gone.ts': 1, 'src/owner.ts': 1 },
      }
    );
    assert.deepEqual(types(problems), [
      'stale:T1:src/gone.ts',
      'stale:T1:src/owner.ts',
    ]);
  });

  test('a baseline block for a rule the registry lacks fails', () => {
    const { problems } = run(
      [CALL_RULE],
      { 'src/a.ts': 'ok();\n' },
      { GONE: { 'src/a.ts': 1 } }
    );
    assert.deepEqual(types(problems), ['unknown-rule:GONE:']);
  });

  test('a measuring rule allows unpinned files up to its limit and pins the rest exactly', () => {
    const tree = {
      'src/small.ts': 'a\nb\nc\n',
      'src/big.ts': 'a\nb\nc\nd\ne\n',
    };
    assert.deepEqual(
      types(run([SIZE_RULE], tree, { 'T-SIZE': { 'src/big.ts': 5 } }).problems),
      []
    );
    assert.deepEqual(types(run([SIZE_RULE], tree, {}).problems), [
      'new:T-SIZE:src/big.ts',
    ]);
    const grown = { ...tree, 'src/big.ts': 'a\nb\nc\nd\ne\nf\n' };
    assert.deepEqual(
      types(
        run([SIZE_RULE], grown, { 'T-SIZE': { 'src/big.ts': 5 } }).problems
      ),
      ['more:T-SIZE:src/big.ts']
    );
    const shrunk = { ...tree, 'src/big.ts': 'a\nb\n' };
    assert.deepEqual(
      types(
        run([SIZE_RULE], shrunk, { 'T-SIZE': { 'src/big.ts': 5 } }).problems
      ),
      ['remove:T-SIZE:src/big.ts']
    );
  });

  test('countLines counts like wc -l, plus an unterminated last line', () => {
    assert.equal(countLines(''), 0);
    assert.equal(countLines('a\n'), 1);
    assert.equal(countLines('a\nb'), 2);
  });
});

describe('--lower and --init', () => {
  test('--lower only lowers or removes; it never raises or adds', () => {
    const tree = {
      'src/fixed.ts': 'forbidden();\n',
      'src/clean.ts': 'ok();\n',
      'src/worse.ts': 'forbidden();\nforbidden();\nforbidden();\n',
      'src/new.ts': 'forbidden();\n',
    };
    const baseline = {
      T1: {
        'src/fixed.ts': 3,
        'src/clean.ts': 1,
        'src/worse.ts': 1,
        'src/gone.ts': 4,
      },
    };
    const { results } = run([CALL_RULE], tree, baseline);
    assert.deepEqual(lowerBaseline([CALL_RULE], results, baseline), {
      T1: { 'src/fixed.ts': 1, 'src/worse.ts': 1 },
    });
  });

  test('--init pins every count above the default, sorted', () => {
    const tree = {
      'src/z.ts': 'forbidden();\n',
      'src/a.ts': 'forbidden();\nforbidden();\n',
      'src/ok.ts': 'ok();\n',
    };
    const { results } = run([CALL_RULE], tree, {});
    const baseline = initialBaseline([CALL_RULE], results);
    assert.equal(
      serializeBaseline(baseline),
      '{\n  "T1": {\n    "src/a.ts": 2,\n    "src/z.ts": 1\n  }\n}\n'
    );
  });
});

describe('the registry contract', () => {
  test('a malformed rule is an error, never a silently skipped rule', () => {
    assert.throws(
      () => validateRules([{ ...CALL_RULE, id: 'lower-case' }]),
      /id must look like/
    );
    assert.throws(() => validateRules([CALL_RULE, CALL_RULE]), /duplicate id/);
    assert.throws(
      () => validateRules([{ ...CALL_RULE, match: { kind: 'nope' } }]),
      /unknown match kind/
    );
    assert.throws(
      () => validateRules([{ ...CALL_RULE, why: '' }]),
      /missing "why"/
    );
    assert.throws(
      () =>
        validateRules([
          { ...CALL_RULE, match: { kind: 'call', pattern: 'x' } },
        ]),
      /must be a RegExp/
    );
    assert.throws(
      () => validateRules([{ ...SIZE_RULE, match: { kind: 'line-count' } }]),
      /newFileMax/
    );
  });
});

describe('the message', () => {
  test('names the rule, the line, the fix, the doc anchor and the allowance', () => {
    const { problems } = run(
      [CALL_RULE],
      { 'src/a.ts': 'ok();\nforbidden();\n' },
      {}
    );
    const text = formatProblems(problems);
    assert.match(text, /1 new violation/);
    assert.match(text, /\[T1\] No forbidden\(\) call/);
    assert.match(text, /src\/a\.ts:2\n {6}forbidden\(\);/);
    assert.match(text, /Fix: Call allowed\(\) instead\./);
    assert.match(
      text,
      /docs\/architecture\/rules\.md#t1 {2}· {2}allowed in this file: 0, found: 1/
    );
  });

  test('a fixed count tells you to bank it', () => {
    const { problems } = run(
      [CALL_RULE],
      { 'src/a.ts': 'forbidden();\n' },
      { T1: { 'src/a.ts': 3 } }
    );
    assert.match(
      formatProblems(problems),
      /allowed 3, found 1\. Bank the fix: pnpm check:arch --lower/
    );
  });
});

describe('the CLI against a real git repository', () => {
  let repo;
  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
    repo = undefined;
  });

  const sh = (args) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
      { cwd: repo, encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr);
  };
  const write = (file, text) => {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), text);
  };
  const cli = (...args) => cliWith({}, ...args);
  const cliWith = (env, ...args) =>
    spawnSync(
      process.execPath,
      [
        RUNNER,
        '--root',
        repo,
        '--rules',
        join(repo, 'rules.mjs'),
        '--baseline',
        'baseline.json',
        ...args,
      ],
      { encoding: 'utf8', env: { ...process.env, ...env } }
    );

  const setUp = () => {
    repo = mkdtempSync(join(tmpdir(), 'arch-gate-'));
    sh(['init', '-q']);
    write(
      'rules.mjs',
      `export const RULES = [{ id: 'T1', title: 'No forbidden() call', why: 'fixture', fix: 'Call allowed().', scope: { include: ['src/**/*.ts'] }, match: { kind: 'call', pattern: /\\bforbidden\\(/ } }];\n`
    );
    write('src/a.ts', 'ok();\n');
    write('src/pinned.ts', 'forbidden();\n');
    sh(['add', '.']);
    sh(['commit', '-qm', 'seed']);
  };
  // The baseline is committed in real use, and --staged reads it from the index.
  const initAndCommit = () => {
    assert.equal(cli('--init').status, 0);
    sh(['add', 'baseline.json']);
    sh(['commit', '-qm', 'baseline']);
  };

  test('--init writes the first baseline, then refuses to overwrite it', () => {
    setUp();
    const first = cli('--init');
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(
      JSON.parse(readFileSync(join(repo, 'baseline.json'), 'utf8')),
      { T1: { 'src/pinned.ts': 1 } }
    );
    const second = cli('--init');
    assert.equal(second.status, 2);
    assert.match(second.stderr, /already exists/);
  });

  test('a full run fails on a new violation and passes at baseline', () => {
    setUp();
    cli('--init');
    assert.equal(cli().status, 0);
    write('src/a.ts', 'forbidden();\n');
    sh(['add', 'src/a.ts']);
    const r = cli();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /src\/a\.ts:1/);
  });

  test('--staged judges the INDEX: a staged violation fails even when the tree is clean', () => {
    setUp();
    initAndCommit();
    write('src/a.ts', 'forbidden();\n');
    sh(['add', 'src/a.ts']);
    write('src/a.ts', 'ok();\n'); // the working tree no longer shows it
    const r = cli('--staged');
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /\[T1\]/);
  });

  test('--staged ignores an unstaged violation', () => {
    setUp();
    initAndCommit();
    write('src/b.ts', 'ok();\n');
    sh(['add', 'src/b.ts']);
    write('src/a.ts', 'forbidden();\n'); // edited but not staged
    const r = cli('--staged');
    assert.equal(r.status, 0, r.stderr);
  });

  test('--staged fails a commit that deletes a pinned file without lowering', () => {
    setUp();
    initAndCommit();
    sh(['rm', '-q', 'src/pinned.ts']);
    const r = cli('--staged');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /src\/pinned\.ts is gone or out of scope/);
  });

  test('--lower banks a fix, and the next run passes', () => {
    setUp();
    cli('--init');
    write('src/pinned.ts', 'ok();\n');
    sh(['add', 'src/pinned.ts']);
    assert.equal(cli().status, 1);
    assert.equal(cli('--lower').status, 0);
    assert.deepEqual(
      JSON.parse(readFileSync(join(repo, 'baseline.json'), 'utf8')),
      {}
    );
    assert.equal(cli().status, 0);
  });

  test('--raises compares with the base ref and reads the countersign from the PR body', () => {
    setUp();
    assert.equal(
      cliWith({ G0_PR_BODY: '' }, '--raises', 'HEAD').status,
      0,
      'no baseline at the base: the first one'
    );
    initAndCommit();
    writeFileSync(
      join(repo, 'baseline.json'),
      serializeBaseline({ T1: { 'src/pinned.ts': 2 } })
    );
    const unsigned = cliWith({ G0_PR_BODY: 'no lines' }, '--raises', 'HEAD');
    assert.equal(unsigned.status, 1);
    assert.match(
      unsigned.stderr,
      /G0-RAISE: T1 src\/pinned\.ts — <why> \(1 → 2\)/
    );
    const signed = cliWith(
      {
        G0_PR_BODY: 'G0-RAISE: T1 src/pinned.ts — hotfix first, extracted next',
      },
      '--raises',
      'HEAD'
    );
    assert.equal(signed.status, 0, signed.stderr);
    const env = { ...process.env };
    delete env.G0_PR_BODY;
    const noBody = spawnSync(
      process.execPath,
      [
        RUNNER,
        '--root',
        repo,
        '--rules',
        join(repo, 'rules.mjs'),
        '--baseline',
        'baseline.json',
        '--raises',
        'HEAD',
      ],
      { encoding: 'utf8', env }
    );
    assert.equal(
      noBody.status,
      2,
      'outside a PR job it is a usage error, not a pass'
    );
  });

  test('an unknown option is a usage error, not a pass', () => {
    setUp();
    const r = cli('--nope');
    assert.equal(r.status, 2);
  });
});

// ---------------------------------------------------------------------------
// The registry's real rules
// ---------------------------------------------------------------------------
//
// FIRES holds, for EVERY rule in the registry, a fixture tree that must make
// it fail. A rule with no entry fails the first test, so a rule can't ship
// without proof it can fire. The near-miss trees are the other half: a rule
// that fires on a comment or a devDependency gets switched off within a week.

const pkg = (name, deps = {}, extra = {}) =>
  JSON.stringify({ name, dependencies: deps, ...extra }, null, 2);

// Built from parts so this test file doesn't cite the folder itself.
const SESSION_NOTES = 'docs/' + 'handover/';

// Each fixture records the mistake it reproduces (`from`): pstack's "prove
// each check fails on a real past mistake". A fixture invented for the test
// proves the matcher works; one taken from history proves the rule catches the
// thing that actually happened.
const limitsTs = [
  'export const RATE_LIMIT_PRESETS = {',
  '  AUTH: {',
  "    store: 'durable-object',",
  '  },',
  '  STRICT: {',
  "    store: 'binding',",
  "    bindingName: 'RATE_LIMIT_STRICT',",
  '  },',
  '  API: {',
  "    store: 'binding',",
  "    bindingName: 'RATE_LIMIT_API',",
  '  },',
  '  WEB: {',
  "    store: 'binding',",
  "    bindingName: 'RATE_LIMIT_WEB',",
  '  },',
  '} as const;',
  '',
].join('\n');

const wrangler = (top, production = top) =>
  JSON.stringify({
    name: 'w',
    ratelimits: top.map((name) => ({ name, namespace_id: '1' })),
    env: {
      production: {
        ratelimits: production.map((name) => ({ name, namespace_id: '2' })),
      },
    },
  });

const FIRES = {
  A1: {
    from: 'the subscription drain calls transfers.create outside the ledger (subscription-service.ts:7893, dev 3632eaa80)',
    tree: {
      'packages/purchase/src/services/x.ts':
        'await this.stripe.transfers.create({ amount });\n',
    },
  },
  LAYERS: {
    from: 'packages/payments/CLAUDE.md forbids payments importing purchase or subscription; nothing checked it',
    tree: {
      'packages/constants/package.json': pkg('@codex/constants', {
        '@codex/payments': 'workspace:*',
      }),
    },
  },
  SIZE: {
    from: 'subscription-service.ts grew to 9,015 lines while the architecture doc said 5,097 (census 2026-11-15)',
    tree: { 'packages/payments/src/new-module.ts': 'x\n'.repeat(801) },
  },
  'DOC-LINK': {
    from: '.github/README.md links ./workflows/preview-deploy.yml, which no longer exists (dev 3632eaa80)',
    tree: { 'docs/a.md': '[gone](./missing.md)\n' },
  },
  'DOC-PATH': {
    from: '352 cited repo paths in live docs did not exist (census 2026-11-15)',
    tree: { 'docs/a.md': 'See packages/gone/src/x.ts for it.\n' },
  },
  'DOC-INDEX': {
    from: '85 of 147 docs were cited nowhere in the repo (census 2026-11-15)',
    tree: { 'docs/README.md': '# Index\n', 'docs/new.md': '# New\n' },
  },
  'DOC-SESSION': {
    from: 'MediaTile.svelte cites a mockup in the gitignored session notes (dev 3632eaa80)',
    tree: { 'packages/a/src/x.ts': `// see ${SESSION_NOTES}x.md\n` },
  },
  'DOC-BUDGET': {
    from: 'the root CLAUDE.md held 3,616 words against a 1,500 budget (census 2026-11-15)',
    tree: { 'packages/a/CLAUDE.md': 'word '.repeat(601) },
  },
  'RATE-LIMIT-BINDING': {
    from: 'a preset with no binding fails open in production (root CLAUDE.md, Security; rate_limit.fail_open)',
    tree: {
      'packages/constants/src/limits.ts': limitsTs,
      'workers/w/wrangler.jsonc': wrangler(['RATE_LIMIT_API']),
      'workers/w/src/routes.ts':
        "procedure({ policy: { auth: 'required', rateLimit: 'strict' } });\n",
    },
  },
};

describe('the registry rules', async () => {
  const { RULES } = await import('./architecture-rules.mjs');
  const byId = (id) => RULES.find((r) => r.id === id);
  const newProblems = (rule, tree) =>
    run([rule], tree, {}).problems.filter((p) => p.type === 'new');

  test('the registry is valid, and every rule has a fixture that fires', () => {
    validateRules(RULES);
    assert.deepEqual(Object.keys(FIRES).sort(), RULES.map((r) => r.id).sort());
    for (const rule of RULES) {
      const { from, tree } = FIRES[rule.id];
      assert.ok(
        from?.length > 20,
        `${rule.id}'s fixture must say which past mistake it reproduces`
      );
      assert.ok(
        newProblems(rule, tree).length > 0,
        `${rule.id} did not fire on its fixture`
      );
    }
  });

  test('A1 ignores the owner modules, tests and comments', () => {
    const a1 = byId('A1');
    const call = 'await deps.stripe.transfers.create({ amount });\n';
    assert.equal(
      newProblems(a1, { 'packages/payments/src/payout-ledger.ts': call })
        .length,
      0
    );
    assert.equal(
      newProblems(a1, { 'packages/purchase/src/__tests__/x.test.ts': call })
        .length,
      0
    );
    assert.equal(
      newProblems(a1, { 'packages/purchase/src/x.ts': `/** ${call} */\n` })
        .length,
      0
    );
    assert.equal(
      newProblems(a1, {
        'workers/ecom-api/src/x.ts': 'await stripe.refunds.create({});\n',
      }).length,
      1
    );
  });

  test('LAYERS: lower layers, listed edges and foundation order pass; the rest fail', () => {
    const layers = byId('LAYERS');
    const check = (file, json) => newProblems(layers, { [file]: json }).length;
    assert.equal(
      check(
        'packages/purchase/package.json',
        pkg('@codex/purchase', {
          '@codex/payments': '*',
          '@codex/database': '*',
        })
      ),
      0
    );
    assert.equal(
      check(
        'packages/subscription/package.json',
        pkg('@codex/subscription', { '@codex/purchase': '*' })
      ),
      0,
      'listed edge'
    );
    assert.equal(
      check(
        'packages/purchase/package.json',
        pkg('@codex/purchase', { '@codex/subscription': '*' })
      ),
      1,
      'unlisted same-layer edge'
    );
    assert.equal(
      check(
        'packages/database/package.json',
        pkg('@codex/database', { '@codex/observability': '*' })
      ),
      0,
      'earlier in foundation'
    );
    assert.equal(
      check(
        'packages/urls/package.json',
        pkg('@codex/urls', { '@codex/database': '*' })
      ),
      1,
      'later in foundation'
    );
    assert.equal(
      check(
        'packages/payments/package.json',
        pkg('@codex/payments', { '@codex/purchase': '*' })
      ),
      1,
      'payments never imports purchase'
    );
    assert.equal(
      check(
        'packages/payments/package.json',
        pkg(
          '@codex/payments',
          {},
          { devDependencies: { '@codex/purchase': '*' } }
        )
      ),
      0,
      'devDependencies are not edges'
    );
    assert.equal(
      check('packages/brand-new/package.json', pkg('@codex/brand-new', {})),
      1,
      'a new package must be placed'
    );
    assert.equal(
      check(
        'workers/ecom-api/package.json',
        pkg('ecom-api', { '@codex/worker-utils': '*' })
      ),
      0,
      'apps may use anything'
    );
    assert.equal(
      check(
        'packages/content/package.json',
        pkg('@codex/content', { '@codex/media-api': '*' })
      ),
      1,
      'nothing depends on an app'
    );
  });

  test('SIZE allows 800 lines in a new file and pins tests out of scope', () => {
    const size = byId('SIZE');
    assert.equal(
      newProblems(size, {
        'packages/payments/src/new-module.ts': 'x\n'.repeat(800),
      }).length,
      0
    );
    assert.equal(
      newProblems(size, {
        'packages/payments/src/__tests__/big.test.ts': 'x\n'.repeat(5000),
      }).length,
      0
    );
    assert.equal(
      newProblems(size, { 'packages/content/src/big.ts': 'x\n'.repeat(5000) })
        .length,
      0,
      'not a money package'
    );
  });
  test('DOC-LINK: resolved files and folders, URLs, anchors, code and placeholders pass', () => {
    const rule = byId('DOC-LINK');
    const tree = (body) => ({
      'docs/a/x.md': body,
      'docs/a/y.md': '',
      'docs/b/z.md': '',
    });
    const fires = (body) =>
      newProblems(rule, tree(body)).reduce((n, p) => n + p.found, 0);
    assert.equal(
      fires(
        '[y](./y.md) [z](../b/z.md#part) [folder](../b/) [root](/docs/b/z.md)\n'
      ),
      0
    );
    assert.equal(
      fires(
        '[web](https://x.dev) [mail](mailto:a@b) [here](#top) [tpl]({{report_url}})\n'
      ),
      0
    );
    assert.equal(
      fires('```sql\nON t(creator_id)\n```\nand `row[0](x)` inline\n'),
      0
    );
    assert.equal(
      fires('````markdown\n```typescript\n[a](inside.md)\n```\n````\n'),
      0,
      'a fence with an info string cannot close the block it sits in'
    );
    assert.equal(
      fires('```markdown\n```typescript\n```\n[a](./gone.md)\n'),
      1,
      'after the real close, links count again'
    );
    assert.equal(fires('[a](./gone.md) [b](../b/gone.md)\n'), 2);
  });

  test('DOC-PATH: existing, package-relative and placeholder paths pass', () => {
    const rule = byId('DOC-PATH');
    const tree = (body) => ({
      'packages/a/CLAUDE.md': body,
      'packages/a/src/x.ts': '',
      'packages/b/src/y.ts': '',
    });
    const fires = (body) => newProblems(rule, tree(body)).length;
    assert.equal(
      fires('See packages/b/src/y.ts and packages/a/src/x.ts:12.\n'),
      0
    );
    assert.equal(
      fires(
        'Placeholders: packages/[domain]/src/x.ts, packages/<pkg>/x.ts, docs/*.md, apps/web/src/paraglide/x.js\n'
      ),
      0
    );
    assert.equal(fires('Gone: packages/a/src/gone.ts\n'), 1);
  });

  test('DOC-INDEX: a link to the doc or to its folder lists it', () => {
    const rule = byId('DOC-INDEX');
    const fires = (readme, file = 'docs/payments/flow.md') =>
      newProblems(rule, { 'docs/README.md': readme, [file]: '' }).length;
    assert.equal(fires('- [Flow](payments/flow.md)\n'), 0);
    assert.equal(fires('- [Payments](payments/)\n'), 0);
    assert.equal(fires('- [Other](other.md)\n'), 1);
    assert.equal(
      fires('', 'docs/archive/old.md'),
      0,
      'the archive is out of scope'
    );
    const missing = newProblems(rule, { 'docs/x.md': '' });
    assert.match(missing[0].hits[0].text, /docs\/README\.md does not exist/);
  });

  test('DOC-SESSION: only a path into the folder fires, and not from inside it', () => {
    const rule = byId('DOC-SESSION');
    const fires = (file, body) => newProblems(rule, { [file]: body }).length;
    assert.equal(
      fires(
        'packages/a/CLAUDE.md',
        'Notes live in docs/handover, which is gitignored.\n'
      ),
      0
    );
    assert.equal(
      fires(`${SESSION_NOTES}README.md`, `See ${SESSION_NOTES}x.md\n`),
      0
    );
    assert.equal(fires('docs/archive/old.md', `See ${SESSION_NOTES}x.md\n`), 0);
    assert.equal(
      fires('apps/web/src/x.svelte', `<!-- ${SESSION_NOTES}y/index.html -->\n`),
      1
    );
  });

  test('DOC-BUDGET: the root CLAUDE.md gets 1,500 words, every other 600', () => {
    const rule = byId('DOC-BUDGET');
    const fires = (file, words) =>
      newProblems(rule, { [file]: 'w '.repeat(words) }).length;
    assert.equal(fires('CLAUDE.md', 1500), 0);
    assert.equal(fires('CLAUDE.md', 1501), 1);
    assert.equal(fires('packages/a/CLAUDE.md', 600), 0);
    assert.equal(fires('packages/a/AGENTS.md', 601), 1);
  });
  test('RATE-LIMIT-BINDING: the default preset, every env, and the exempt forms', () => {
    const rule = byId('RATE-LIMIT-BINDING');
    const both = ['RATE_LIMIT_API', 'RATE_LIMIT_STRICT'];
    const fires = (route, wranglerText = wrangler(both)) =>
      newProblems(rule, {
        'packages/constants/src/limits.ts': limitsTs,
        'workers/w/wrangler.jsonc': wranglerText,
        'workers/w/src/routes.ts': route,
      }).reduce((n, p) => n + p.found, 0);
    assert.equal(fires("procedure({ policy: { rateLimit: 'strict' } });\n"), 0);
    assert.equal(
      fires(
        "procedure({ policy: { auth: 'required' } });\n",
        wrangler(['RATE_LIMIT_STRICT'])
      ),
      2,
      'no rateLimit means api, in both envs'
    );
    assert.equal(
      fires(
        "procedure({ policy: { rateLimit: 'strict' } });\n",
        wrangler(both, ['RATE_LIMIT_API'])
      ),
      1,
      'production lacks it'
    );
    assert.equal(
      fires("procedure({ policy: { auth: 'worker' } });\n", wrangler([])),
      0,
      'worker routes are exempt'
    );
    assert.equal(
      fires('procedure({ policy: { rateLimit: pick() } });\n', wrangler([])),
      0,
      'a non-literal is skipped, not guessed'
    );
    assert.equal(
      fires("// procedure({ policy: { rateLimit: 'web' } })\n"),
      0,
      'a comment is not a route'
    );
    assert.equal(
      fires("procedure({ policy: { rateLimit: 'nope' } });\n"),
      2,
      'an unknown preset fires'
    );
    const r = run(
      [rule],
      { 'workers/w/wrangler.jsonc': wrangler(both), 'workers/w/src/a.ts': 'x' },
      {}
    );
    assert.equal(r.problems.length, 0, 'no routes, no needs');
  });
});

// ---------------------------------------------------------------------------
// Inline exceptions and countersigned raises (WP-7)
// ---------------------------------------------------------------------------

// Assembled from parts, so this file is never read as a directive itself.
const IGNORE = ['arch', 'ignore'].join('-');

describe('inline exceptions expire', () => {
  const ok = (until = '2099-01-01', rule = 'T1') =>
    `// ${IGNORE} ${rule} until=${until} by=bruce — the drain moves in WP5\n`;
  const today = '2026-11-17';
  const problemsOf = (tree, rules = [CALL_RULE, SIZE_RULE]) => {
    const source = memorySource(tree);
    return compare(rules, collect(rules, source), {}, source, { today });
  };

  test('a valid exception on the line above excuses that hit only', () => {
    assert.deepEqual(problemsOf({ 'src/a.ts': `${ok()}forbidden();\n` }), []);
    assert.deepEqual(
      types(problemsOf({ 'src/a.ts': `${ok()}forbidden();\nforbidden();\n` })),
      ['new:T1:src/a.ts']
    );
  });

  test('an expired, unused, malformed or unknown exception fails', () => {
    const why = (tree) => problemsOf(tree).map((p) => p.why ?? p.type);
    assert.match(
      why({ 'src/a.ts': `${ok('2026-11-16')}forbidden();\n` }).join(),
      /expired on 2026-11-16/
    );
    assert.match(
      why({ 'src/a.ts': `${ok()}fine();\n` }).join(),
      /excuses no T1 violation/
    );
    assert.match(
      why({
        'src/a.ts': `// ${IGNORE} T1 because I said so\nforbidden();\n`,
      }).join(),
      /malformed/
    );
    assert.match(
      why({ 'src/a.ts': `${ok('2099-01-01', 'NOPE')}forbidden();\n` }).join(),
      /doesn't define/
    );
    assert.match(
      why({ 'src/a.ts': `${ok('2099-01-01', 'T-SIZE')}x\n` }).join(),
      /measures a whole file/
    );
  });

  test('in markdown only an HTML comment outside code is a directive', () => {
    const rule = {
      ...CALL_RULE,
      id: 'T2',
      scope: { include: ['**/*.md'] },
      match: { kind: 'cite', text: 'BAD' },
    };
    const dir = `<!-- ${IGNORE} T2 until=2099-01-01 by=bruce — quoted on purpose -->`;
    assert.deepEqual(problemsOf({ 'd.md': `${dir}\nBAD\n` }, [rule]), []);
    const fenced = `\`\`\`\n// ${IGNORE} T2 until=2099-01-01 by=bruce — an example\n\`\`\`\nBAD\n`;
    assert.deepEqual(types(problemsOf({ 'd.md': fenced }, [rule])), [
      'new:T2:d.md',
    ]);
  });
});

describe('a raised baseline count needs a countersign', () => {
  const before = { T1: { 'src/a.ts': 2, 'src/b.ts': 1 } };

  test('raises and new entries are found; lowering is free', () => {
    const after = { T1: { 'src/a.ts': 3, 'src/b.ts': 0, 'src/c.ts': 1 } };
    assert.deepEqual(
      raisedEntries(before, after).map((r) => r.file),
      ['src/a.ts', 'src/c.ts']
    );
    assert.deepEqual(raisedEntries(before, { T1: { 'src/a.ts': 1 } }), []);
  });

  test('a countersign line with a reason covers its entry, and only its entry', () => {
    const after = { T1: { 'src/a.ts': 3, 'src/c.ts': 1 } };
    const body =
      'Summary\n\nG0-RAISE: T1 src/a.ts — the hotfix lands first; extracted in #1234\n';
    assert.deepEqual(
      missingCountersigns(before, after, body).map((r) => r.file),
      ['src/c.ts']
    );
    assert.equal(
      missingCountersigns(before, after, 'G0-RAISE: T1 src/c.ts\n').length,
      2,
      'a line without a reason does not count'
    );
  });
});
