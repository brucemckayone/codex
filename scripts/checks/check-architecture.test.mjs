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
  const cli = (...args) =>
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
      {
        encoding: 'utf8',
      }
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

const FIRES = {
  A1: {
    'packages/purchase/src/services/x.ts':
      'await this.stripe.transfers.create({ amount });\n',
  },
  LAYERS: {
    'packages/constants/package.json': pkg('@codex/constants', {
      '@codex/payments': 'workspace:*',
    }),
  },
  SIZE: {
    'packages/payments/src/new-module.ts': 'x\n'.repeat(801),
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
      assert.ok(
        newProblems(rule, FIRES[rule.id]).length > 0,
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
});
