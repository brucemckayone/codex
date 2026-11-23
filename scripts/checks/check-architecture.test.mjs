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
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { countLines, MATCHERS } from './architecture-matchers.mjs';
import {
  callerPrint,
  ciBase,
  GATE_ENTRY_PATHS,
  gateDependencies,
  hashOf,
  parseCountersigns,
  raisedEntries,
  raiseItem,
  uncovered,
} from './architecture-raises.mjs';
import {
  collect,
  compare,
  formatProblems,
  globToRegExp,
  initialBaseline,
  inScope,
  judgeFixesAtBase,
  lowerBaseline,
  memorySource,
  serializeBaseline,
  spentAtBase,
  validateRules,
} from './check-architecture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, 'check-architecture.mjs');

/** The gate's own modules: what a fixture needs to run a real copy of it. */
const GATE_MODULES = [
  'check-architecture.mjs',
  'architecture-rules.mjs',
  'architecture-matchers.mjs',
  'architecture-lists.mjs',
  'architecture-ignores.mjs',
  'architecture-docs.mjs',
  'architecture-raises.mjs',
  'architecture-spec.mjs',
  'check-data-access-contract.mjs',
];

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

// Assembled from parts, so this file is never read as a directive itself.
const IGNORE = ['arch', 'ignore'].join('-');

// The key a call rule pins: the function it sits in, then the match.
const K = '(top level)>forbidden(';
const B = '(top level)>banned(';

const SWAP_RULE = {
  ...CALL_RULE,
  id: 'T3',
  match: { kind: 'call', pattern: /\b(?:forbidden|banned)\(/ },
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
  test('counts code, not comments, and reports the line and its key', () => {
    const text = [
      '// forbidden( in a line comment',
      '/** forbidden( in a JSDoc block */',
      'const x = 1;',
      'forbidden(x);',
    ].join('\n');
    const { found, hits } = MATCHERS.call.file(CALL_RULE, 'src/a.ts', text);
    assert.equal(found, 1);
    assert.deepEqual(hits, [{ line: 4, text: 'forbidden(x);', key: K }]);
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
  test('equal pins pass', () => {
    const { problems } = run(
      [CALL_RULE],
      { 'src/a.ts': 'forbidden();\n' },
      { T1: { 'src/a.ts': [K] } }
    );
    assert.deepEqual(problems, []);
  });

  test('a violation in an unlisted file is new', () => {
    const { problems } = run([CALL_RULE], { 'src/a.ts': 'forbidden();\n' }, {});
    assert.deepEqual(types(problems), ['new:T1:src/a.ts']);
  });

  test('one more of a pinned key fails as more', () => {
    const { problems } = run(
      [CALL_RULE],
      { 'src/a.ts': 'forbidden();\nforbidden();\n' },
      { T1: { 'src/a.ts': [K] } }
    );
    assert.deepEqual(types(problems), ['more:T1:src/a.ts']);
    assert.equal(problems[0].added, 1);
    assert.equal(
      problems[0].hits.length,
      2,
      'both hits share the key, so both are shown: only the diff knows which is new'
    );
  });

  test('a fix cannot pay for a new violation in the same file', () => {
    // review finding: with counts, fixing one call and adding another kept
    // the count at 1 and passed.
    const { problems } = run(
      [SWAP_RULE],
      { 'src/a.ts': 'forbidden();\n' },
      { T3: { 'src/a.ts': [B] } }
    );
    assert.deepEqual(types(problems), [
      'more:T3:src/a.ts',
      'remove:T3:src/a.ts',
    ]);
    assert.equal(problems.find((p) => p.type === 'more').blocking, true);
  });

  test('a fix that was not banked fails, so its headroom cannot be re-spent', () => {
    const tree = { 'src/a.ts': 'forbidden();\n' };
    const fewer = run([CALL_RULE], tree, { T1: { 'src/a.ts': [K, K] } });
    assert.deepEqual(types(fewer.problems), ['fewer:T1:src/a.ts']);
    assert.deepEqual(fewer.problems[0].fixed, [K]);
    assert.deepEqual(
      types(
        run(
          [CALL_RULE],
          { 'src/a.ts': 'ok();\n' },
          { T1: { 'src/a.ts': [K, K] } }
        ).problems
      ),
      ['remove:T1:src/a.ts']
    );
  });

  test('an unbanked fix blocks only where bankFails says; a new violation always blocks', () => {
    const tree = { 'src/a.ts': 'ok();\n', 'src/b.ts': 'forbidden();\n' };
    const source = memorySource(tree);
    const results = collect([CALL_RULE], source);
    const problems = compare(
      [CALL_RULE],
      results,
      { T1: { 'src/a.ts': [K] } },
      source,
      { bankFails: (file) => file === 'src/elsewhere.ts' }
    );
    assert.deepEqual(
      problems.map((p) => `${p.type}:${p.file}:${p.blocking}`).sort(),
      ['new:src/b.ts:true', 'remove:src/a.ts:false']
    );
  });

  test('an entry for a deleted or out-of-scope file is stale', () => {
    const { problems } = run(
      [CALL_RULE],
      { 'src/b.ts': 'ok();\n', 'src/owner.ts': 'forbidden();\n' },
      { T1: { 'src/gone.ts': [K], 'src/owner.ts': [K] } }
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
      { GONE: { 'src/a.ts': [K] } }
    );
    assert.deepEqual(types(problems), ['unknown-rule:GONE:']);
  });

  test('a pin of the wrong shape is a format problem, never a pass', () => {
    assert.deepEqual(
      types(
        run(
          [CALL_RULE],
          { 'src/a.ts': 'forbidden();\n' },
          { T1: { 'src/a.ts': 5 } }
        ).problems
      ),
      ['format:T1:src/a.ts']
    );
    assert.deepEqual(
      types(
        run(
          [SIZE_RULE],
          { 'src/a.ts': 'a\n' },
          { 'T-SIZE': { 'src/a.ts': ['a'] } }
        ).problems
      ),
      ['format:T-SIZE:src/a.ts']
    );
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
        'src/fixed.ts': [K, K, K],
        'src/clean.ts': [K],
        'src/worse.ts': [K],
        'src/gone.ts': [K],
      },
      KEPT: { 'src/x.ts': [K] },
    };
    const { results } = run([CALL_RULE], tree, baseline);
    assert.deepEqual(lowerBaseline([CALL_RULE], results, baseline), {
      KEPT: { 'src/x.ts': [K] },
      T1: { 'src/fixed.ts': [K], 'src/worse.ts': [K] },
    });
  });

  test('--lower turns an old count into at most that many keys', () => {
    const tree = {
      'src/a.ts': 'forbidden();\n',
      'src/b.ts': 'forbidden();\nforbidden();\nforbidden();\n',
    };
    const baseline = { T1: { 'src/a.ts': 2, 'src/b.ts': 1 } };
    const { results } = run([CALL_RULE], tree, baseline);
    assert.deepEqual(lowerBaseline([CALL_RULE], results, baseline), {
      T1: { 'src/a.ts': [K], 'src/b.ts': [K] },
    });
  });

  test('--init pins every key, or every size above the default, sorted', () => {
    const tree = {
      'src/z.ts': 'forbidden();\n',
      'src/a.ts': 'forbidden();\nforbidden();\n',
      'src/ok.ts': 'ok();\n',
      'src/big.ts': 'a\nb\nc\nd\n',
    };
    const { results } = run([CALL_RULE, SIZE_RULE], tree, {});
    assert.deepEqual(initialBaseline([CALL_RULE, SIZE_RULE], results), {
      T1: { 'src/a.ts': [K, K], 'src/z.ts': [K] },
      'T-SIZE': { 'src/big.ts': 4 },
    });
  });

  test('the serialised baseline is what biome would write', () => {
    // A key array JSON.stringify spreads over lines; biome must leave it be,
    // or --lower and a commit's lint-staged run fight over the format.
    const text = serializeBaseline({ T1: { 'src/a.ts': [K, K] } });
    assert.equal(
      text,
      `{\n  "T1": {\n    "src/a.ts": ["${K}", "${K}"]\n  }\n}\n`
    );
    // biome counts display width: 30 wide characters are 60 columns, not 30
    const wide = serializeBaseline({ T1: { 'a.md': ['界'.repeat(30), 'x'] } });
    assert.equal(wide.split('\n').length, 9, 'too wide for one line');
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
  test('names the rule, the line, the fix, the doc anchor and what is pinned', () => {
    const { problems } = run(
      [CALL_RULE],
      { 'src/a.ts': 'ok();\nforbidden();\n' },
      {}
    );
    const text = formatProblems(problems);
    assert.match(text, /\[T1\] No forbidden\(\) call/);
    assert.match(text, /src\/a\.ts:2\n {6}forbidden\(\);/);
    assert.match(text, /Fix: Call allowed\(\) instead\./);
    assert.match(
      text,
      /docs\/architecture\/rules\.md#t1 {2}· {2}the baseline pins 0 in this file; 1 found here isn't among them/
    );
  });

  test('a measuring rule shows the size against its allowance', () => {
    const { problems } = run(
      [SIZE_RULE],
      { 'src/a.ts': 'a\nb\nc\nd\ne\n' },
      {}
    );
    assert.match(
      formatProblems(problems),
      /allowed in this file: 3 lines, found: 5 lines/
    );
  });

  test('a fix tells you which key to bank', () => {
    const { problems } = run(
      [CALL_RULE],
      { 'src/a.ts': 'forbidden();\n' },
      { T1: { 'src/a.ts': [K, K] } }
    );
    assert.match(
      formatProblems(problems),
      /src\/a\.ts: fixed "\(top level\)>forbidden\(". Bank the fix: pnpm check:arch --lower/
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
    return r.stdout.trim();
  };
  const head = () => sh(['rev-parse', 'HEAD']);
  const commit = (message) => sh(['commit', '-qam', message]);
  const write = (file, text) => {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), text);
  };
  const readBaseline = () =>
    JSON.parse(readFileSync(join(repo, 'baseline.json'), 'utf8'));
  // Not in CI unless a test says so: the self-test itself runs in a CI job.
  // GITHUB_HEAD_REF too: in a release PR's CI it is 'dev', which would turn
  // every pull-request fixture here into a release.
  const LOCAL = {
    GITHUB_EVENT_NAME: '',
    GITHUB_EVENT_PATH: '',
    GITHUB_HEAD_REF: '',
    GITHUB_BASE_REF: '',
    GITHUB_REF: '',
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
      { encoding: 'utf8', env: { ...process.env, ...LOCAL, ...env } }
    );
  const T1 = `{ id: 'T1', title: 'No forbidden() call', why: 'fixture', fix: 'Call allowed().', scope: { include: ['src/**/*.ts'] }, match: { kind: 'call', pattern: /\\bforbidden\\(/ } }`;
  const T2 = `{ id: 'T2', title: 'No banned() call', why: 'fixture', fix: 'Call allowed().', scope: { include: ['src/**/*.ts'] }, match: { kind: 'call', pattern: /\\bbanned\\(/ } }`;
  const rulesModule = (...rules) =>
    `export const RULES = [${rules.join(', ')}];\n`;
  // checkLoosening looks for the gate at the base, so the fixture carries a
  // stand-in at the real path (and it is one of the gate's own files).
  const GATE_STAND_IN = 'scripts/checks/check-architecture.mjs';

  const setUp = ({ gate = true } = {}) => {
    repo = mkdtempSync(join(tmpdir(), 'arch-gate-'));
    sh(['init', '-q']);
    write('rules.mjs', rulesModule(T1));
    write('src/a.ts', 'ok();\n');
    write('src/pinned.ts', 'forbidden();\n');
    if (gate) write(GATE_STAND_IN, '// stand-in for the gate\n');
    sh(['add', '.']);
    sh(['commit', '-qm', 'seed']);
  };
  // The baseline is committed in real use, and --staged reads it from the index.
  const initAndCommit = () => {
    assert.equal(cli('--init').status, 0);
    sh(['add', 'baseline.json']);
    sh(['commit', '-qm', 'baseline']);
  };
  // A pull_request event as GitHub hands it to the job; kept inside .git so it
  // is never a tracked file.
  const prEnv = (baseSha) => {
    const path = join(repo, '.git', 'event.json');
    writeFileSync(
      path,
      JSON.stringify({ pull_request: { base: { sha: baseSha } } })
    );
    return { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: path };
  };
  // What the gate asks the owner to sign, `KEY@hash`, read from its output.
  const asked = (r) =>
    [
      ...`${r.stdout}${r.stderr}`.matchAll(
        /G0-RAISE: (\S+ \S+@[0-9a-f]{8}) — <why>/g
      ),
    ].map((m) => m[1]);
  const trailers = (keys, reason = 'the fixture accepts it') =>
    keys.map((k) => `G0-RAISE: ${k} — ${reason}`).join('\n');
  // The owner's countersign commit: no Co-Authored-By line.
  const ownerSigns = (...lines) =>
    sh([
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      `G0 countersign\n\n${lines.join('\n')}`,
    ]);

  test('--init writes the first baseline as keys, then refuses to overwrite it', () => {
    setUp();
    const first = cli('--init');
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(readBaseline(), { T1: { 'src/pinned.ts': [K] } });
    const second = cli('--init');
    assert.equal(second.status, 2);
    assert.match(second.stderr, /already exists/);
  });

  test('--init --rule seeds a new rule, once, and names its countersign', () => {
    setUp();
    initAndCommit();
    write('rules.mjs', rulesModule(T1, T2));
    write('src/b.ts', 'banned();\n');
    sh(['add', '.']);
    const r = cli('--init', '--rule', 'T2');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /G0-RAISE: T2 \*@[0-9a-f]{8} —/);
    assert.deepEqual(readBaseline(), {
      T1: { 'src/pinned.ts': [K] },
      T2: { 'src/b.ts': [B] },
    });
    assert.match(
      cli('--init', '--rule', 'T2').stderr,
      /already has a T2 block/
    );
    assert.equal(cli('--init', '--rule', 'NOPE').status, 2);
    assert.equal(cli('--rule', 'T2').status, 2, '--rule goes with --init');
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

  test('an unbanked fix is a notice in a full run, and blocks a commit that touches the file', () => {
    setUp();
    initAndCommit();
    write('src/pinned.ts', 'ok();\n');
    const full = cli();
    assert.equal(full.status, 0, full.stderr);
    assert.match(full.stdout, /1 fixed violation\(s\) not yet banked/);
    write('src/b.ts', 'ok();\n');
    sh(['add', 'src/b.ts']);
    assert.equal(cli('--staged').status, 0, 'this commit does not touch it');
    sh(['add', 'src/pinned.ts']);
    const touching = cli('--staged');
    assert.equal(touching.status, 1);
    assert.match(touching.stderr, /Bank the fix: pnpm check:arch --lower/);
  });

  test('--lower banks a fix, and the next run is quiet', () => {
    setUp();
    cli('--init');
    write('src/pinned.ts', 'ok();\n');
    sh(['add', 'src/pinned.ts']);
    assert.match(cli().stdout, /not yet banked/);
    assert.equal(cli('--lower').status, 0);
    assert.deepEqual(readBaseline(), {});
    const after = cli();
    assert.equal(after.status, 0);
    assert.doesNotMatch(after.stdout, /not yet banked/);
  });

  test('a raised pin needs a G0-RAISE trailer in a commit, with a real reason', () => {
    setUp();
    initAndCommit();
    const base = head();
    write(
      'baseline.json',
      serializeBaseline({ T1: { 'src/pinned.ts': [K, K] } })
    );
    commit('raise');
    const unsigned = cli('--raises', base);
    assert.equal(unsigned.status, 1);
    assert.match(
      unsigned.stderr,
      /\n {4}G0-RAISE: T1 src\/pinned\.ts@[0-9a-f]{8} — <why>\n/
    );
    const [key] = asked(unsigned);
    assert.match(
      unsigned.stderr,
      /\n {8}T1 src\/pinned\.ts: allows "\(top level\)>forbidden\(" more\n/
    );
    sh(['commit', '-q', '--amend', '-m', `raise\n\nG0-RAISE: ${key} — ok`]);
    assert.equal(
      cli('--raises', base).status,
      1,
      'a one-word reason says nothing'
    );
    sh([
      'commit',
      '-q',
      '--amend',
      '-m',
      'raise\n\nG0-RAISE: T1 src/pinned.ts — hotfix first, extracted next',
    ]);
    const hashless = cli('--raises', base);
    assert.equal(hashless.status, 1, 'a trailer with no @hash covers nothing');
    assert.match(hashless.stderr, /name no @hash, so they cover nothing/);
    sh([
      'commit',
      '-q',
      '--amend',
      '-m',
      `raise\n\nG0-RAISE: ${key} — hotfix first, extracted next`,
    ]);
    const signed = cli('--raises', base);
    assert.equal(signed.status, 0, signed.stderr);
  });

  test('a new exception and a change to the gate itself need one too', () => {
    setUp();
    initAndCommit();
    const base = head();
    write(
      'src/a.ts',
      `// ${IGNORE} T1 until=2026-12-01 by=bruce — the drain moves next\nforbidden();\n`
    );
    write(GATE_STAND_IN, '// stand-in for the gate, loosened\n');
    commit('loosen');
    const r = cli('--raises', base);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /G0-RAISE: T1 src\/a\.ts@[0-9a-f]{8} — <why>/);
    assert.match(
      r.stderr,
      /G0-RAISE: GATE scripts\/checks\/check-architecture\.mjs@[0-9a-f]{8} — <why>/
    );
    sh(['commit', '-q', '--amend', '-m', `loosen\n\n${trailers(asked(r))}`]);
    const signed = cli('--raises', base);
    assert.equal(signed.status, 0, signed.stderr);
  });

  test('--raises: a base with no gate has nothing to sign; a base that is not a commit is an error', () => {
    setUp({ gate: false });
    const r = cli('--raises', 'HEAD');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /has no architecture gate yet/);
    const bad = cli('--raises', 'no-such-ref');
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /not a commit this clone has/);
  });

  test('--ci in a pull request: an unbanked fix blocks only in a file the PR touches', () => {
    setUp();
    initAndCommit();
    const base = head();
    write('src/pinned.ts', 'ok();\n');
    commit('fix it');
    const touching = cliWith(prEnv(base), '--ci');
    assert.equal(touching.status, 1, touching.stdout);
    assert.match(touching.stderr, /Bank the fix/);

    const later = head(); // the unbanked fix is now in the base
    write('src/a.ts', 'ok(); // unrelated\n');
    commit('unrelated');
    const elsewhere = cliWith(prEnv(later), '--ci');
    assert.equal(elsewhere.status, 0, elsewhere.stderr);
    assert.match(elsewhere.stdout, /not yet banked/);
    assert.match(elsewhere.stdout, /is countersigned/);
  });

  test('--ci in a pull request fails an unsigned loosening; outside CI it says so', () => {
    setUp();
    initAndCommit();
    const base = head();
    write(
      'baseline.json',
      serializeBaseline({ T1: { 'src/pinned.ts': [K, K] } })
    );
    commit('raise');
    const r = cliWith(prEnv(base), '--ci');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /have no countersign from the owner/);
    // review finding: a local --ci skipped the check, so gate.sh passed what
    // CI failed. Locally it now compares with origin/dev, and says so when it
    // can't.
    const local = cli('--ci');
    assert.equal(local.status, 2, local.stdout);
    assert.match(
      local.stderr,
      /no merge base with origin\/dev \(git fetch origin dev\)/
    );
  });

  test('--gates runs each listed gate, honours --skip, and fails when one does', () => {
    setUp();
    write(
      'rules.mjs',
      `export const RULES = [];\nexport const GATES = [\n  { id: 'OK', title: 't', run: 'node -e "process.exit(0)"' },\n  { id: 'BAD', title: 't', selfTest: 'node -e "process.exit(3)"', run: 'node -e "process.exit(0)"', needs: 'a fixture' },\n];\n`
    );
    const r = cli('--gates');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /1 gate\(s\) failed: BAD/);
    assert.match(r.stderr, /BAD needs a fixture/);
    const skipped = cli('--gates', '--skip', 'BAD');
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.match(skipped.stdout, /BAD: skipped/);
    assert.match(
      skipped.stdout,
      /1 CI static gate\(s\) passed locally \(BAD skipped\)/
    );
    const none = cli('--gates', '--skip', 'OK,BAD');
    assert.equal(none.status, 2, 'a skipped gate is not counted as passed');
    assert.match(none.stderr, /no gate ran/);
    const typo = cli('--gates', '--skip', 'BIOME');
    assert.equal(typo.status, 2, 'a typo in --skip must not skip silently');
    assert.match(typo.stderr, /--skip names no gate: BIOME/);
    assert.equal(cli('--skip', 'OK').status, 2, '--skip goes with --gates');
  });

  test('a gate that cannot run exits 2, never 0 or 1', () => {
    setUp();
    assert.equal(cli('--nope').status, 2, 'an unknown option');
    assert.equal(cli('--lower', '--init').status, 2, 'two modes');

    write(
      'rules.mjs',
      rulesModule(T1.replace("'src/**/*.ts'", "'scr/**/*.ts'"))
    );
    const idle = cli();
    assert.equal(idle.status, 2);
    assert.match(
      idle.stderr,
      /match no tracked file, so they check nothing: T1 scr\/\*\*\/\*\.ts/
    );

    write('rules.mjs', rulesModule(T1));
    write('baseline.json', '{ not json');
    const broken = cli();
    assert.equal(broken.status, 2);
    assert.match(
      broken.stderr,
      /could not run: baseline\.json is not valid JSON/
    );
  });

  test('--staged refuses while the gate itself has unstaged edits, unless nothing is staged', () => {
    setUp();
    initAndCommit();
    write(GATE_STAND_IN, '// edited, not staged\n');
    const empty = cli('--staged');
    assert.equal(empty.status, 0, "the owner's empty countersign commit");
    assert.match(empty.stdout, /nothing staged/);
    write('src/a.ts', 'ok(); // more\n');
    sh(['add', 'src/a.ts']);
    const r = cli('--staged');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unstaged or untracked edits/);
  });

  // ---- round 2 review fixes -------------------------------------------

  test('a copied exception, or one moved onto another violation, needs a countersign', () => {
    setUp();
    initAndCommit();
    const dir = `// ${IGNORE} T1 until=2026-12-01 by=bruce — the drain moves next\n`;
    const start = head();
    write('src/a.ts', `${dir}forbidden(one);\n`);
    sh(['add', '.']);
    sh(['commit', '-qm', 'one']);
    ownerSigns(trailers(asked(cli('--raises', start))));
    const signedBase = head();
    assert.equal(cli('--raises', start).status, 0, 'the first one is signed');
    write('src/a.ts', `${dir}forbidden(one);\n${dir}forbidden(two);\n`);
    commit('copy it');
    const copied = cli('--raises', signedBase);
    assert.equal(
      copied.status,
      1,
      'review finding: a copy matched the original'
    );
    assert.match(copied.stderr, /G0-RAISE: T1 src\/a\.ts@[0-9a-f]{8} — <why>/);
    sh(['reset', '-q', '--hard', signedBase]);
    write('src/a.ts', `${dir}forbidden(somethingElse);\n`);
    commit('move it');
    assert.equal(
      cli('--raises', signedBase).status,
      1,
      'moved onto a different call'
    );
  });

  test("the gate's own pasted output, or an agent's trailer, is not a countersign", () => {
    setUp();
    initAndCommit();
    const base = head();
    write(
      'baseline.json',
      serializeBaseline({ T1: { 'src/pinned.ts': [K, K] } })
    );
    commit('raise');
    const out = cli('--raises', base).stderr;
    sh(['commit', '-q', '--allow-empty', '-m', 'fix ci', '-m', out]);
    const pasted = cli('--raises', base);
    assert.equal(
      pasted.status,
      1,
      'review finding: the printed template counted as signed'
    );
    sh([
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'sign it\n\nG0-RAISE: T1 src/pinned.ts — hotfix first, extracted next\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
    ]);
    const agent = cli('--raises', base);
    assert.equal(agent.status, 1, 'an agent cannot sign for itself');
    assert.match(
      agent.stderr,
      /Trailers in agent commits \([0-9a-f]{9}\) were not counted/
    );
    assert.match(
      agent.stderr,
      /! git commit --allow-empty -m 'G0 countersign' -m 'G0-RAISE: T1 src\/pinned\.ts@[0-9a-f]{8} — <why>'/
    );
    ownerSigns(trailers(asked(agent), 'hotfix first, extracted next'));
    assert.equal(cli('--raises', base).status, 0, 'the owner can');
  });

  test('a pnpm script a gate runs is part of the gate', () => {
    setUp();
    write(
      'rules.mjs',
      `${rulesModule(T1)}export const GATES = [{ id: 'G', title: 't', run: 'pnpm check:x' }];\n`
    );
    write(
      'package.json',
      JSON.stringify({
        scripts: { 'check:x': 'biome check --error-on-warnings .', dev: 'x' },
      })
    );
    sh(['add', '.']);
    sh(['commit', '-qm', 'gates']);
    initAndCommit();
    const base = head();
    write(
      'package.json',
      JSON.stringify({
        scripts: { 'check:x': 'biome check --error-on-warnings .', dev: 'y' },
      })
    );
    commit('bump an unrelated script');
    assert.equal(
      cli('--raises', base).status,
      0,
      'an unrelated script is free'
    );
    write(
      'package.json',
      JSON.stringify({ scripts: { 'check:x': 'biome check .', dev: 'y' } })
    );
    commit('quieter biome');
    const r = cli('--raises', base);
    assert.equal(r.status, 1);
    assert.match(
      r.stderr,
      /G0-RAISE: GATE package\.json#scripts\.check:x@[0-9a-f]{8} — <why>/
    );
  });

  test('--lower --staged banks what the index holds, keeps the rest, and stages the baseline', () => {
    setUp();
    write('src/g.ts', 'forbidden();\n');
    sh(['add', '.']);
    sh(['commit', '-qm', 'g']);
    initAndCommit();
    write('src/pinned.ts', 'ok();\n');
    sh(['add', 'src/pinned.ts']);
    write('src/g.ts', 'ok(); // work in progress, not staged\n');
    const before = cli('--staged');
    assert.equal(before.status, 1);
    assert.match(
      before.stderr,
      /Bank the fix: pnpm check:arch --lower --staged/
    );
    const lowered = cli('--lower', '--staged');
    assert.equal(lowered.status, 0, lowered.stderr);
    assert.deepEqual(
      readBaseline(),
      { T1: { 'src/g.ts': [K] } },
      'the unstaged fix is not banked'
    );
    assert.equal(cli('--staged').status, 0, 'the baseline was staged with it');
  });

  test('a rename carries its pin; --lower --staged moves it; no countersign is owed', () => {
    setUp();
    initAndCommit();
    const base = head();
    sh(['mv', 'src/pinned.ts', 'src/renamed.ts']);
    const r = cli('--staged');
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /src\/renamed\.ts: renamed from src\/pinned\.ts/);
    assert.doesNotMatch(
      r.stderr,
      /\[T1\][^\n]*\n {2}src\/renamed\.ts:1/,
      'not reported as a new violation'
    );
    assert.equal(cli('--lower', '--staged').status, 0);
    assert.deepEqual(readBaseline(), { T1: { 'src/renamed.ts': [K] } });
    assert.equal(cli('--staged').status, 0);
    sh(['commit', '-qm', 'rename']);
    assert.equal(
      cli('--raises', base).status,
      0,
      'moving a pin is not a raise'
    );
  });

  test('--ci in a PR: a fix this change made blocks wherever it is; one dev left behind is a notice', () => {
    setUp();
    const L1 = `{ id: 'L1', title: 'Links resolve', why: 'fixture', fix: 'Fix the link.', scope: { include: ['docs/**/*.md'] }, match: { kind: 'md-link' } }`;
    write('rules.mjs', rulesModule(T1, L1));
    write('docs/x.md', '[guide](./guide.md)\n');
    sh(['add', '.']);
    sh(['commit', '-qm', 'docs']);
    initAndCommit();
    const base = head();
    write('docs/guide.md', '# Guide\n');
    sh(['add', '.']);
    sh(['commit', '-qm', 'add the guide']);
    const made = cliWith(prEnv(base), '--ci');
    assert.equal(
      made.status,
      1,
      'review finding: a fix from another file never had to be banked'
    );
    assert.match(made.stderr, /docs\/x\.md: fixed "\.\/guide\.md"/);
    // The same fix, already on the base (left unbanked on dev), is someone else's.
    const later = head();
    write('docs/x.md', '[guide](./guide.md)\n\nMore words.\n');
    commit('edit the doc');
    const inherited = cliWith(prEnv(later), '--ci');
    assert.equal(inherited.status, 0, inherited.stderr);
    assert.match(inherited.stdout, /not yet banked/);
  });

  test('--staged refuses an untracked new gate module', () => {
    setUp();
    initAndCommit();
    write('scripts/checks/architecture-new.mjs', 'export const x = 1;\n');
    write('src/a.ts', 'ok(); // more\n');
    sh(['add', 'src/a.ts']);
    const r = cli('--staged');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /architecture-new\.mjs/);
  });

  test('every include glob must match a file, unless the registry marks it optional', () => {
    setUp();
    const twoGlobs = T1.replace(
      "['src/**/*.ts']",
      "['src/**/*.ts', 'lib/**/*.ts']"
    );
    write('rules.mjs', rulesModule(twoGlobs));
    const idle = cli();
    assert.equal(idle.status, 2, 'review finding: one dead glob of two passed');
    assert.match(idle.stderr, /T1 lib\/\*\*\/\*\.ts/);
    write(
      'rules.mjs',
      rulesModule(
        twoGlobs.replace('scope: {', "scope: { optional: ['lib/**/*.ts'],")
      )
    );
    cli('--init');
    assert.equal(cli().status, 0);
  });

  test('a broken gate module exits 2, not 1', () => {
    setUp();
    const here = dirname(RUNNER);
    for (const f of [
      'check-architecture.mjs',
      'architecture-rules.mjs',
      'architecture-matchers.mjs',
      'architecture-lists.mjs',
      'architecture-ignores.mjs',
      'architecture-docs.mjs',
      'architecture-raises.mjs',
      'check-data-access-contract.mjs',
    ]) {
      write(`copy/${f}`, readFileSync(join(here, f), 'utf8'));
    }
    write(
      'copy/architecture-rules.mjs',
      `${readFileSync(join(here, 'architecture-rules.mjs'), 'utf8')}\n}\n`
    );
    const r = spawnSync(
      process.execPath,
      [join(repo, 'copy/check-architecture.mjs'), '--root', repo],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /could not load the gate's modules/);
  });

  test('a symlink reads the same at commit time and in a full run', () => {
    setUp();
    const SZ = `{ id: 'SZ', title: 'Small docs', why: 'fixture', fix: 'Split it.', scope: { include: ['docs/**/*.md'] }, match: { kind: 'line-count', newFileMax: 2 } }`;
    write('rules.mjs', rulesModule(T1, SZ));
    write('docs/big.md', 'a\nb\nc\n');
    sh(['add', '.']);
    sh(['commit', '-qm', 'docs']);
    initAndCommit();
    symlinkSync('big.md', join(repo, 'docs/link.md'));
    sh(['add', 'docs/link.md']);
    const staged = cli('--staged');
    sh(['commit', '-qm', 'link']);
    const full = cli();
    assert.equal(
      staged.status,
      full.status,
      `${staged.stderr}\n${full.stderr}`
    );
    assert.equal(full.status, 0, 'a link has no text of its own');
  });

  // ---- round 3 review fixes -------------------------------------------

  test('a countersign covers what it signed: loosening the same item after it needs a new one', () => {
    setUp();
    initAndCommit();
    const base = head();
    write('src/pinned.ts', 'forbidden();\nforbidden();\n');
    write(
      'baseline.json',
      serializeBaseline({ T1: { 'src/pinned.ts': [K, K] } })
    );
    commit('raise');
    ownerSigns(trailers(asked(cli('--raises', base))));
    assert.equal(cli('--raises', base).status, 0);

    write('src/pinned.ts', 'forbidden();\nforbidden();\nforbidden();\n');
    write(
      'baseline.json',
      serializeBaseline({ T1: { 'src/pinned.ts': [K, K, K] } })
    );
    commit('raise again');
    const again = cli('--raises', base);
    assert.equal(again.status, 1, 'the owner signed for two, not three');
    assert.match(
      again.stderr,
      /G0-RAISE: T1 src\/pinned\.ts@[0-9a-f]{8} — <why>/
    );
    ownerSigns(trailers(asked(again), 'three until the drain moves'));
    assert.equal(cli('--raises', base).status, 0);

    write(GATE_STAND_IN, '// loosened\n');
    commit('gate');
    ownerSigns(trailers(asked(cli('--raises', base))));
    assert.equal(cli('--raises', base).status, 0);
    write(GATE_STAND_IN, '// loosened again\n');
    commit('gate again');
    assert.match(
      cli('--raises', base).stderr,
      /G0-RAISE: GATE scripts\/checks\/check-architecture\.mjs@[0-9a-f]{8} — <why>/
    );
  });

  test("when a change edits the gate, the base's copy of the gate judges it too", () => {
    setUp({ gate: false });
    for (const file of GATE_MODULES) {
      write(`scripts/checks/${file}`, readFileSync(join(HERE, file), 'utf8'));
    }
    sh(['add', '.']);
    sh(['commit', '-qm', 'the gate']);
    initAndCommit();
    const base = head();
    // This change's copy stops treating its own code as gate code.
    const raises = 'scripts/checks/architecture-raises.mjs';
    const text = readFileSync(join(repo, raises), 'utf8');
    const emptied = text.replace(
      'return file.startsWith(GATE_DIR) || GATE_CODE_ELSEWHERE.includes(file);',
      'return false;'
    );
    assert.notEqual(emptied, text, 'the fixture found isGateCode');
    write(raises, emptied);
    commit('refactor the gate');
    const own = (...args) =>
      spawnSync(
        process.execPath,
        [
          join(repo, 'scripts/checks/check-architecture.mjs'),
          '--root',
          repo,
          '--rules',
          join(repo, 'rules.mjs'),
          '--baseline',
          'baseline.json',
          ...args,
        ],
        { encoding: 'utf8', env: { ...process.env, ...LOCAL, ...prEnv(base) } }
      );
    assert.equal(
      own('--raises', base).status,
      0,
      'its own copy approves itself'
    );
    const judged = own('--ci');
    assert.equal(judged.status, 1, judged.stdout + judged.stderr);
    assert.match(
      judged.stdout,
      /its copy there \(scripts\/checks\/check-architecture\.mjs\) judges the countersigns too/
    );
    assert.match(
      judged.stderr,
      /G0-RAISE: GATE scripts\/checks\/architecture-raises\.mjs@[0-9a-f]{8} — <why>/
    );
    ownerSigns(trailers(asked(judged), 'the list moves to the registry'));
    const signed = own('--ci');
    assert.equal(signed.status, 0, signed.stdout + signed.stderr);
  });

  // Round 6 (owner, 23 Nov): a test for each finding. Each failed before its fix.
  test('the base copy judges growth into a stale pin, and a trunk push notes it', () => {
    setUp({ gate: false });
    for (const file of GATE_MODULES) {
      write(`scripts/checks/${file}`, readFileSync(join(HERE, file), 'utf8'));
    }
    sh(['add', '.']);
    sh(['commit', '-qm', 'the gate']);
    initAndCommit();
    write('src/pinned.ts', 'ok();\n');
    commit('fixed on dev, never banked');
    const base = head();
    write('src/pinned.ts', 'forbidden();\n');
    commit('re-add the call dev had fixed');
    // A push to dev never blocks, but says what grew (review round 6). It runs
    // before the gate changes, so no base copy can be the one that says it.
    const event = join(repo, '.git', 'push.json');
    writeFileSync(event, JSON.stringify({ before: base }));
    const push = cliWith(
      {
        GITHUB_EVENT_NAME: 'push',
        GITHUB_EVENT_PATH: event,
        GITHUB_REF: 'refs/heads/dev',
      },
      '--ci'
    );
    assert.equal(push.status, 0, push.stdout + push.stderr);
    assert.match(
      push.stdout,
      /grow into a pin above what the base measured/,
      'review finding: a trunk push said nothing of a re-grown stale pin'
    );
    // This change's copy stops looking for growth into a stale pin.
    const runner = 'scripts/checks/check-architecture.mjs';
    const text = readFileSync(join(repo, runner), 'utf8');
    const blind = text.replace(
      'const spent = spentAtBase(rules, results, baseline, atBase);',
      'const spent = [];'
    );
    assert.notEqual(blind, text, 'the fixture found the spend check');
    write(runner, blind);
    commit('refactor the gate');
    const own = (env, ...args) =>
      spawnSync(
        process.execPath,
        [
          join(repo, runner),
          '--root',
          repo,
          '--rules',
          join(repo, 'rules.mjs'),
          '--baseline',
          'baseline.json',
          ...args,
        ],
        { encoding: 'utf8', env: { ...process.env, ...LOCAL, ...env } }
      );
    const judged = own(prEnv(base), '--ci');
    assert.equal(judged.status, 1, judged.stdout + judged.stderr);
    const keys = asked(judged);
    const spend = keys.find((k) => k.startsWith('T1 src/pinned.ts@'));
    assert.ok(
      spend,
      `review finding: only the new copy looked for the spend, and it was dropped:\n${judged.stdout}${judged.stderr}`
    );
    ownerSigns(
      trailers(
        keys.filter((k) => k !== spend),
        'the gate refactor is reviewed'
      )
    );
    assert.equal(
      own(prEnv(base), '--ci').status,
      1,
      'the GATE sign alone does not cover the spend'
    );
    ownerSigns(trailers([spend], 'the call comes back on purpose'));
    const signed = own(prEnv(base), '--ci');
    assert.equal(signed.status, 0, signed.stdout + signed.stderr);
    assert.match(
      signed.stdout,
      /note: the owner's G0-RAISE: T1 src\/pinned\.ts@[0-9a-f]{8} covers src\/pinned\.ts/,
      'a signed pin lists the headroom it covers'
    );
  });

  test('the sign past a base copy covers the calling workflows and survives a dev move', () => {
    const CALLER = '.github/workflows/testing.yml';
    const callerYaml = (needs) =>
      `on:\n  pull_request:\njobs:\n  static-analysis:\n${needs}    uses: ./.github/workflows/static_analysis.yml\n`;
    repo = mkdtempSync(join(tmpdir(), 'arch-gate-'));
    sh(['init', '-q', '-b', 'dev']);
    write(
      'rules.mjs',
      `${rulesModule(T1)}export const CI_CALLERS = ['${CALLER}'];\n`
    );
    write(GATE_STAND_IN, 'process.exit(2);\n');
    write('src/a.ts', 'ok();\n');
    write(CALLER, callerYaml(''));
    sh(['add', '.']);
    sh(['commit', '-qm', 'a base gate that cannot run']);
    initAndCommit();
    const branchPoint = head();
    sh(['checkout', '-qb', 'feat/x']);
    write(GATE_STAND_IN, '// the new gate\n');
    commit('replace the gate');
    ownerSigns(
      trailers(asked(cli('--raises', branchPoint)), 'the new gate is reviewed')
    );
    const first = cliWith(prEnv(branchPoint), '--ci');
    assert.equal(first.status, 2, first.stdout + first.stderr);
    const override = /G0-RAISE: (GATE base-judge@[0-9a-f]{8})/.exec(
      first.stderr
    )?.[1];
    assert.ok(override, first.stderr);
    ownerSigns(trailers([override], 'the old gate cannot read the new flags'));
    assert.equal(cliWith(prEnv(branchPoint), '--ci').status, 0);
    // dev moves on and leaves the base's gate as it was: the sign holds.
    sh(['checkout', '-q', 'dev']);
    write('src/other.ts', 'ok();\n');
    sh(['add', 'src/other.ts']);
    commit('unrelated work on dev');
    const devTip = head();
    const tip = sh(['rev-parse', 'feat/x']);
    sh(['checkout', '-q', '--detach', devTip]);
    sh(['merge', '-q', '--no-ff', '-m', 'Merge feat/x into dev', tip]);
    const moved = cliWith(
      { ...prEnv(devTip), GITHUB_HEAD_REF: 'feat/x', GITHUB_BASE_REF: 'dev' },
      '--ci'
    );
    assert.equal(
      moved.status,
      0,
      `review finding: a dev move voided the owner's sign for the same gate code:\n${moved.stdout}${moved.stderr}`
    );
    // An edit to a caller's static-analysis job is gate code the sign never saw.
    sh(['checkout', '-q', 'feat/x']);
    write(CALLER, callerYaml('    needs: [build]\n'));
    commit('wait for the build first');
    ownerSigns(
      trailers(
        asked(cli('--raises', branchPoint)),
        'static analysis waits for build'
      )
    );
    const after = cliWith(prEnv(branchPoint), '--ci');
    assert.equal(
      after.status,
      2,
      `review finding: the override signed for earlier gate code still covered it:\n${after.stdout}`
    );
  });

  test('--ci in a PR: headroom a fix left unbanked on dev cannot be spent', () => {
    setUp();
    initAndCommit();
    write('src/pinned.ts', 'ok();\n');
    commit('fixed on dev, never banked');
    const base = head();
    write('src/other.ts', 'ok();\n');
    sh(['add', 'src/other.ts']);
    commit('an unrelated change');
    const alone = cliWith(prEnv(base), '--ci');
    assert.equal(alone.status, 0, 'the stale pin alone is a notice');
    assert.match(alone.stdout, /not yet banked/);
    write('src/pinned.ts', 'forbidden();\n');
    commit('re-add it');
    const r = cliWith(prEnv(base), '--ci');
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /fits the pin only because a fix was left unbanked/);
    assert.equal(
      cli().status,
      0,
      'a full run outside a PR has no base to cap at'
    );
    ownerSigns(trailers(asked(r), 'dev needs the call back'));
    assert.equal(
      cliWith(prEnv(base), '--ci').status,
      0,
      'the owner can sign it, as a raise'
    );
  });

  test('--ci in a release PR from dev: a fix dev made is a notice, not a failure', () => {
    setUp();
    initAndCommit();
    const base = head();
    write('src/pinned.ts', 'ok();\n');
    commit('fixed, not banked');
    const release = cliWith(
      { ...prEnv(base), GITHUB_HEAD_REF: 'dev', GITHUB_BASE_REF: 'main' },
      '--ci'
    );
    assert.equal(release.status, 0, release.stderr);
    assert.match(release.stdout, /not yet banked/);
    assert.equal(
      cliWith(prEnv(base), '--ci').status,
      1,
      'the same fix blocks the feature PR that made it'
    );
  });

  test('--lower --staged refuses to overwrite unstaged baseline edits', () => {
    setUp();
    initAndCommit();
    write('src/pinned.ts', 'ok();\n');
    sh(['add', 'src/pinned.ts']);
    write('baseline.json', '{}\n');
    const r = cli('--lower', '--staged');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /edits the index doesn't hold/);
    assert.equal(readFileSync(join(repo, 'baseline.json'), 'utf8'), '{}\n');
  });

  test('--lower --staged refuses a baseline that was never staged', () => {
    setUp();
    assert.equal(cli('--init').status, 0);
    const written = readFileSync(join(repo, 'baseline.json'), 'utf8');
    write('src/pinned.ts', 'ok();\n');
    sh(['add', 'src/pinned.ts']);
    const r = cli('--lower', '--staged');
    assert.equal(
      r.status,
      2,
      'review finding: it banked {} over the fresh baseline'
    );
    assert.equal(readFileSync(join(repo, 'baseline.json'), 'utf8'), written);
  });

  test("--lower moves a renamed file's pin, found since the baseline last changed", () => {
    setUp();
    initAndCommit();
    sh(['mv', 'src/pinned.ts', 'src/moved.ts']);
    commit('rename');
    const r = cli('--lower');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readBaseline(), { T1: { 'src/moved.ts': [K] } });
  });

  test('an exception moved into another function, onto the same text, needs a countersign', () => {
    setUp();
    const excepted = `  // ${IGNORE} T1 until=2026-12-01 by=bruce — the drain moves next\n  forbidden();\n`;
    write(
      'src/a.ts',
      `function pay() {\n${excepted}}\nfunction refund() {\n  ok();\n}\n`
    );
    sh(['add', '.']);
    sh(['commit', '-qm', 'an excepted call']);
    initAndCommit();
    const base = head();
    write(
      'src/a.ts',
      `function pay() {\n  ok();\n}\nfunction refund() {\n${excepted}}\n`
    );
    commit('move it');
    const r = cli('--raises', base);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /G0-RAISE: T1 src\/a\.ts@[0-9a-f]{8} — <why>/);
  });

  // ---- round 4 review fixes -------------------------------------------

  test('a hash binds the countersign: an amend, or a cherry-pick onto another change, is asked again', () => {
    setUp();
    initAndCommit();
    const base = head();
    write(
      'baseline.json',
      serializeBaseline({ T1: { 'src/pinned.ts': [K, K] } })
    );
    commit('raise');
    ownerSigns(trailers(asked(cli('--raises', base))));
    const signing = head();
    assert.equal(cli('--raises', base).status, 0);
    // An agent folds one more raise into the owner's commit, message unchanged.
    write(
      'baseline.json',
      serializeBaseline({ T1: { 'src/pinned.ts': [K, K, K] } })
    );
    sh(['commit', '-q', '-a', '--amend', '--no-edit']);
    assert.equal(
      cli('--raises', base).status,
      1,
      'review finding: an amend kept the signature'
    );
    // The signing commit, cherry-picked onto a different raise of the same pin.
    sh(['reset', '-q', '--hard', base]);
    write(
      'baseline.json',
      serializeBaseline({ T1: { 'src/pinned.ts': [K, B] } })
    );
    commit('another raise');
    sh(['cherry-pick', '--allow-empty', signing]);
    assert.equal(
      cli('--raises', base).status,
      1,
      'review finding: a cherry-picked countersign covered a different raise'
    );
  });

  test('a change merged in from the base asks again, and the hash it prints covers it', () => {
    setUp();
    write(GATE_STAND_IN, 'a\nb\nc\nd\ne\n');
    sh(['add', '.']);
    sh(['commit', '-qm', 'a five-line gate']);
    initAndCommit();
    const base = head();
    sh(['checkout', '-q', '-b', 'pr']);
    write(GATE_STAND_IN, 'A\nb\nc\nd\ne\n');
    commit('the PR loosens line 1');
    ownerSigns(trailers(asked(cli('--raises', base))));
    sh(['checkout', '-q', '-b', 'devline', base]);
    write(GATE_STAND_IN, 'a\nb\nc\nd\nE\n');
    commit('dev changes line 5');
    const devTip = head();
    sh(['checkout', '-q', 'pr']);
    sh(['merge', '-q', '--no-edit', 'devline']); // GitHub's merge ref
    const merged = cli('--raises', devTip);
    assert.equal(merged.status, 1, 'the owner never saw the merged file');
    ownerSigns(trailers(asked(merged)));
    const signed = cli('--raises', devTip);
    assert.equal(
      signed.status,
      0,
      `review finding: re-signing could never cover it\n${signed.stderr}`
    );
  });

  test('a push to dev, or a release PR, only notes an unsigned loosening', () => {
    setUp();
    initAndCommit();
    const base = head();
    write(
      'baseline.json',
      serializeBaseline({ T1: { 'src/pinned.ts': [K, K] } })
    );
    commit('unsigned raise');
    const event = join(repo, '.git', 'push.json');
    writeFileSync(event, JSON.stringify({ before: base }));
    const push = cliWith(
      {
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF: 'refs/heads/dev',
        GITHUB_EVENT_PATH: event,
      },
      '--ci'
    );
    assert.equal(push.status, 0, push.stderr);
    assert.match(push.stdout, /note: 1 loosening\(s\)/);
    const release = cliWith(
      { ...prEnv(base), GITHUB_HEAD_REF: 'dev', GITHUB_BASE_REF: 'main' },
      '--ci'
    );
    assert.equal(release.status, 0, release.stderr);
    assert.equal(
      cliWith(prEnv(base), '--ci').status,
      1,
      'a PR into dev is where it is judged'
    );
  });

  test('a release PR only notes growth into headroom main left unbanked', () => {
    setUp();
    initAndCommit();
    write('src/pinned.ts', 'ok();\n');
    commit('fixed, never banked');
    const base = head();
    write('src/pinned.ts', 'forbidden();\n');
    commit('re-added on dev');
    const r = cliWith(
      { ...prEnv(base), GITHUB_HEAD_REF: 'dev', GITHUB_BASE_REF: 'main' },
      '--ci'
    );
    assert.equal(
      r.status,
      0,
      `owner, 19 Nov: the PR into dev judged it\n${r.stderr}`
    );
    assert.match(r.stdout, /fits the pin only because a fix was left unbanked/);
  });

  test('a PR whose base is HEAD itself is an error, not a pass', () => {
    setUp();
    initAndCommit();
    const r = cliWith(prEnv(head()), '--ci');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /is HEAD itself/);
  });

  test("a base copy that can't run is an error the owner can sign past", () => {
    setUp();
    write(GATE_STAND_IN, 'process.exit(2);\n');
    sh(['add', '.']);
    sh(['commit', '-qm', 'a base gate that cannot run']);
    initAndCommit();
    const base = head();
    write(GATE_STAND_IN, '// the new gate\n');
    commit('replace the gate');
    ownerSigns(trailers(asked(cli('--raises', base))));
    const r = cliWith(prEnv(base), '--ci');
    assert.equal(r.status, 2, r.stdout + r.stderr);
    const override = /G0-RAISE: (GATE base-judge@[0-9a-f]{8})/.exec(r.stderr);
    assert.ok(override, r.stderr);
    ownerSigns(
      `G0-RAISE: ${override[1]} — the old gate cannot read the new flags`
    );
    const signed = cliWith(prEnv(base), '--ci');
    assert.equal(signed.status, 0, signed.stdout + signed.stderr);
    write(GATE_STAND_IN, '// the new gate, edited again\n');
    commit('edit the gate after the override');
    ownerSigns(trailers(asked(cli('--raises', base))));
    assert.equal(
      cliWith(prEnv(base), '--ci').status,
      2,
      'review finding: the override covered every later gate edit on the same base'
    );
  });

  test('a nested biome config, a new .gitignore line or a package turbo.json is part of the gate', () => {
    setUp();
    write(
      'rules.mjs',
      `${rulesModule(T1)}export const GATES = [{ id: 'BIOME', title: 't', run: 'node -e 0', filesMatching: ['**/biome.json', '**/.gitignore', '*/turbo.json'] }];\n`
    );
    write('.gitignore', 'node_modules\n');
    sh(['add', '.']);
    sh(['commit', '-qm', 'gates']);
    initAndCommit();
    const base = head();
    write('.gitignore', 'node_modules\n# a note\n');
    commit('a comment');
    assert.equal(cli('--raises', base).status, 0, 'a comment ignores nothing');
    write('.gitignore', '');
    commit('un-ignore');
    assert.equal(cli('--raises', base).status, 0, 'a removal only tightens');
    write('.gitignore', 'node_modules\nsrc/legacy/\n');
    write(
      'src/quiet/biome.json',
      '{ "root": false, "linter": { "enabled": false } }\n'
    );
    write('pkg/turbo.json', '{}\n');
    sh(['add', '.']);
    commit('quiet a folder');
    const r = cli('--raises', base);
    assert.equal(r.status, 1);
    for (const file of [
      '\\.gitignore',
      'src\\/quiet\\/biome\\.json',
      'pkg\\/turbo\\.json',
    ]) {
      assert.match(r.stderr, new RegExp(`G0-RAISE: GATE ${file}@[0-9a-f]{8}`));
    }
  });

  test('any file in the gate folder is gate code, and a gate part that is no file is a registry error', () => {
    setUp();
    initAndCommit();
    const base = head();
    write('scripts/checks/helper.mjs', 'export const h = 1;\n');
    sh(['add', '.']);
    commit('a helper split out of the gate');
    assert.match(
      cli('--raises', base).stderr,
      /G0-RAISE: GATE scripts\/checks\/helper\.mjs@[0-9a-f]{8}/,
      'review finding: a module missing from a hand-kept list was unsigned'
    );
    write(
      'rules.mjs',
      `${rulesModule(T1)}export const GATES = [{ id: 'G', title: 't', run: 'node ./scripts/gone.mjs', files: ['biom.json'] }];\n`
    );
    const r = cli();
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not tracked[^\n]*scripts\/gone\.mjs; biom\.json/);
  });

  test('a moved baseline is read at its old path at the base', () => {
    setUp();
    initAndCommit();
    const base = head();
    sh(['mv', 'baseline.json', 'moved.json']);
    commit('move the baseline');
    const r = spawnSync(
      process.execPath,
      [
        RUNNER,
        '--root',
        repo,
        '--rules',
        join(repo, 'rules.mjs'),
        '--baseline',
        'moved.json',
        '--raises',
        base,
      ],
      { encoding: 'utf8', env: { ...process.env, ...LOCAL } }
    );
    assert.equal(
      r.status,
      0,
      `review finding: every pin read as a raise\n${r.stderr}`
    );
  });

  // Round 5: each test below failed before its fix (owner, 19 Nov: a finding
  // is a failing test against a clause of architecture-spec.mjs).

  test('an ignore file loosens by a new rule, a lost negation, a new order or a move; a .ignore and a .biome.json count', async () => {
    const { GATES } = await import('./architecture-rules.mjs');
    const biome = GATES.find((g) => g.id === 'BIOME').filesMatching;
    for (const glob of ['**/.ignore', '**/.biome.json', '**/.biome.jsonc']) {
      assert.ok(
        biome.includes(glob),
        `review finding: Biome obeys ${glob} and the gate never saw it`
      );
    }
    setUp();
    write(
      'rules.mjs',
      `${rulesModule(T1)}export const GATES = [{ id: 'BIOME', title: 't', run: 'node -e 0', filesMatching: ${JSON.stringify(biome)} }];\n`
    );
    const ignore = 'node_modules\n*.gen.ts\n!keep.gen.ts\n';
    write('.gitignore', ignore);
    write('legacy/.gitignore', 'src/\n');
    write('src/.ignore', 'a.ts\nb.ts\n');
    mkdirSync(join(repo, 'src/money'), { recursive: true });
    sh(['add', '.']);
    sh(['commit', '-qm', 'gates']);
    initAndCommit();
    const base = head();
    const raises = () => cli('--raises', base);
    const asks = (pattern, why) => {
      const r = raises();
      assert.equal(r.status, 1, `${why}\n${r.stdout}${r.stderr}`);
      assert.match(r.stderr, pattern, why);
    };
    const back = () => sh(['reset', '-q', '--hard', base]);

    write('.gitignore', 'node_modules\n*.gen.ts\n');
    commit('drop the negation');
    asks(
      /G0-RAISE: GATE \.gitignore@/,
      'review finding: a lost negation re-ignores keep.gen.ts'
    );
    back();
    write('.gitignore', 'node_modules\n!keep.gen.ts\n*.gen.ts\n');
    commit('reorder');
    asks(
      /G0-RAISE: GATE \.gitignore@/,
      'review finding: a negation moved first un-ignores nothing'
    );
    back();
    write('.gitignore', '*.gen.ts\n!keep.gen.ts\n!other.gen.ts\n');
    commit('a plain line out, a negation in');
    assert.equal(
      raises().status,
      0,
      'deleting a plain line or adding a negation only un-ignores'
    );
    back();
    write('src/.ignore', 'a.ts\n');
    commit('stop ignoring b.ts');
    assert.equal(raises().status, 0, 'a .ignore follows the same rules');
    back();
    sh(['mv', 'legacy/.gitignore', 'src/money/.gitignore']);
    commit('move the legacy ignore');
    asks(
      /G0-RAISE: GATE src\/money\/\.gitignore@/,
      'review finding: a .gitignore moved into another folder ignores that folder'
    );
    back();
    sh(['rm', '-q', '.gitignore']);
    commit('drop the root ignore');
    asks(
      /G0-RAISE: GATE \.gitignore@/,
      'deleting an ignore file that held a negation re-ignores what it kept'
    );
    back();
    write('src/.ignore', 'bad.ts\n');
    write(
      'sub/.biome.jsonc',
      '{ "root": false, "linter": { "enabled": false } }\n'
    );
    sh(['add', '.']);
    commit('a ripgrep ignore and a hidden biome config');
    asks(/G0-RAISE: GATE src\/\.ignore@/, 'Biome obeys a nested .ignore');
    asks(/G0-RAISE: GATE sub\/\.biome\.jsonc@/, 'Biome 2.4 loads .biome.jsonc');
  });

  test('a deleted turbo-task script, a pre/post or lifecycle script, the root turbo.json and .npmrc are gate parts', () => {
    setUp();
    write(
      'rules.mjs',
      `${rulesModule(T1)}export const GATES = [{ id: 'TYPECHECK', title: 't', run: 'pnpm typecheck' }, { id: 'BIOME', title: 't', run: 'pnpm check:ci' }];\n`
    );
    const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
    write(
      'package.json',
      json({
        name: 'root',
        scripts: { typecheck: 'turbo run typecheck', 'check:ci': 'node -e 0' },
      })
    );
    write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    write(
      'turbo.json',
      json({ tasks: { typecheck: { dependsOn: ['^build'] }, build: {} } })
    );
    write(
      'packages/p/package.json',
      json({ name: '@x/p', scripts: { typecheck: 'tsc -p .', build: 'tsc' } })
    );
    sh(['add', '.']);
    sh(['commit', '-qm', 'a workspace']);
    initAndCommit();
    const base = head();
    assert.equal(cli().status, 0, 'every part is a tracked file');
    const edit = (file, change, message) => {
      const value = JSON.parse(readFileSync(join(repo, file), 'utf8'));
      change(value);
      write(file, json(value));
      sh(['add', file]);
      commit(message);
    };
    const asks = (pattern, why) => {
      const r = cli('--raises', base);
      assert.equal(r.status, 1, `${why}\n${r.stdout}${r.stderr}`);
      assert.match(r.stderr, pattern, why);
    };
    const back = () => sh(['reset', '-q', '--hard', base]);

    edit(
      'packages/p/package.json',
      (j) => {
        delete j.scripts.typecheck;
      },
      'drop the typecheck script, build runs tsc'
    );
    asks(
      /G0-RAISE: GATE packages\/p\/package\.json#scripts\.typecheck@/,
      "review finding: deleting a package's typecheck script switched TYPECHECK off unsigned"
    );
    back();
    edit(
      'package.json',
      (j) => {
        j.scripts['precheck:ci'] = 'biome check --write .';
      },
      'a pre script'
    );
    asks(
      /G0-RAISE: GATE package\.json#scripts\.precheck:ci@/,
      'review finding: pnpm runs pre<name> before the gate'
    );
    back();
    edit(
      'packages/p/package.json',
      (j) => {
        j.scripts.prepare = 'node rewrite.mjs';
      },
      'a lifecycle script'
    );
    asks(
      /G0-RAISE: GATE packages\/p\/package\.json#scripts\.prepare@/,
      'review finding: pnpm install runs it before every later gate'
    );
    back();
    edit(
      'turbo.json',
      (j) => {
        j.tasks['@x/p#typecheck'] = { inputs: ['package.json'] };
      },
      'narrow one package'
    );
    asks(
      /G0-RAISE: GATE turbo\.json@/,
      'review finding: a package task in the root turbo.json replays a cached pass'
    );
    back();
    write('.npmrc', 'script-shell=/usr/bin/true\n');
    sh(['add', '.npmrc']);
    commit('an npmrc');
    asks(
      /G0-RAISE: GATE \.npmrc@/,
      'review finding: script-shell skips every script'
    );
    back();
    write(
      'packages/p/turbo.json',
      json({ extends: ['//'], tasks: { test: { inputs: ['src/**'] } } })
    );
    sh(['add', '.']);
    commit('a test-only package turbo.json');
    assert.equal(
      cli('--raises', base).status,
      0,
      'a task the gate never runs loosens nothing (#650)'
    );
    edit(
      'packages/p/turbo.json',
      (j) => {
        j.tasks.build = { inputs: ['package.json'] };
      },
      'narrow the build typecheck depends on'
    );
    asks(
      /G0-RAISE: GATE packages\/p\/turbo\.json#tasks\.build@/,
      'typecheck dependsOn ^build, so a narrowed build replays stale types'
    );
    back();
    write(
      'pnpm-workspace.yaml',
      'packages:\n  - packages/*\npatchedDependencies:\n  x: patches/x.patch\n'
    );
    commit('patch a dependency');
    assert.equal(
      cli('--raises', base).status,
      0,
      'another key of pnpm-workspace.yaml is outside the list (#638)'
    );
    write('pnpm-workspace.yaml', 'packages:\n  - apps/*\n');
    commit('drop the packages from the workspace');
    asks(
      /G0-RAISE: GATE pnpm-workspace\.yaml#packages@/,
      'the packages list decides which scripts a task runs'
    );
  });

  test('growing into a stale pin is signed like a raise, and a release PR only notes it', () => {
    setUp();
    initAndCommit();
    write('src/pinned.ts', 'ok();\n');
    commit('fixed on dev, never banked');
    const base = head();
    write('src/pinned.ts', 'forbidden();\n');
    commit('re-add it on purpose');
    const r = cliWith(prEnv(base), '--ci');
    assert.equal(r.status, 1, r.stdout);
    const lines = asked(r);
    assert.deepEqual(
      lines.map((l) => l.split('@')[0]),
      ['T1 src/pinned.ts'],
      `review finding: no countersign could let it through\n${r.stderr}`
    );
    const unsigned = head();
    ownerSigns(trailers(lines, 'dev needs the call back'));
    const signed = cliWith(prEnv(base), '--ci');
    assert.equal(signed.status, 0, signed.stdout + signed.stderr);
    sh(['reset', '-q', '--hard', unsigned]);
    const release = cliWith(
      { ...prEnv(base), GITHUB_HEAD_REF: 'dev', GITHUB_BASE_REF: 'main' },
      '--ci'
    );
    assert.equal(
      release.status,
      0,
      `owner, 19 Nov: the PR into dev judges; a release PR notes\n${release.stderr}`
    );
    assert.match(
      release.stdout,
      /grow into a pin above what the base measured/
    );
    assert.match(release.stdout, /src\/pinned\.ts/);

    // A measuring rule: the base shrank the file but kept its pin, and the
    // owner signs a raise from what the base measured.
    rmSync(repo, { recursive: true, force: true });
    setUp();
    const SMALL = `{ id: 'TS', title: 'Files stay small', why: 'fixture', fix: 'Split it.', scope: { include: ['src/**/*.ts'] }, match: { kind: 'line-count', newFileMax: 3 } }`;
    write('rules.mjs', rulesModule(T1, SMALL));
    write('src/big.ts', 'ok();\n'.repeat(6));
    sh(['add', '.']);
    sh(['commit', '-qm', 'a big file']);
    initAndCommit();
    write('src/big.ts', 'ok();\n'.repeat(4));
    commit('shrunk on dev, never banked');
    const sizeBase = head();
    write('src/big.ts', 'ok();\n'.repeat(8));
    const pins = readBaseline();
    pins.TS['src/big.ts'] = 8;
    write('baseline.json', serializeBaseline(pins));
    commit('grow it, raising the pin');
    ownerSigns(
      trailers(asked(cli('--raises', sizeBase)), 'the split lands next week')
    );
    const grown = cliWith(prEnv(sizeBase), '--ci');
    assert.equal(
      grown.status,
      0,
      `review finding: a signed raise over a stale base pin still failed\n${grown.stderr}`
    );
  });

  test('a base that holds the gate where no entry path looks is an error; a baseline-only change runs no base copy', () => {
    assert.equal(
      GATE_ENTRY_PATHS[0],
      'scripts/checks/check-architecture.mjs',
      'the list only grows: a move ADDS its new path'
    );
    setUp({ gate: false });
    initAndCommit();
    const base = head();
    write('src/x.ts', 'ok();\n');
    sh(['add', '.']);
    commit('a change');
    const r = cli('--raises', base);
    assert.equal(
      r.status,
      2,
      `review finding: a runner moved off every entry path made the base look gate-free\n${r.stdout}`
    );
    assert.match(r.stderr, /GATE_ENTRY_PATHS/);

    rmSync(repo, { recursive: true, force: true });
    setUp();
    const inGate = 'scripts/checks/b.json';
    const gate = (env, ...args) =>
      spawnSync(
        process.execPath,
        [
          RUNNER,
          '--root',
          repo,
          '--rules',
          join(repo, 'rules.mjs'),
          '--baseline',
          inGate,
          ...args,
        ],
        { encoding: 'utf8', env: { ...process.env, ...LOCAL, ...env } }
      );
    assert.equal(gate({}, '--init').status, 0);
    sh(['add', inGate]);
    sh(['commit', '-qm', 'baseline']);
    const pinBase = head();
    write('src/pinned.ts', 'ok();\n');
    commit('fix it');
    assert.equal(gate({}, '--lower').status, 0);
    commit('bank it');
    const banked = gate(prEnv(pinBase), '--ci');
    assert.equal(banked.status, 0, banked.stdout + banked.stderr);
    assert.doesNotMatch(
      banked.stdout,
      /The gate's own code changed/,
      'review finding: banking a fix ran the base copy and offered a GATE sign'
    );
  });

  test('every exception a hash covers is listed under it', () => {
    setUp();
    initAndCommit();
    const base = head();
    const dir = `// ${IGNORE} T1 until=2026-12-01 by=bruce — the drain moves next\n`;
    write('src/a.ts', `${dir}forbidden(one);\nok();\n${dir}forbidden(two);\n`);
    sh(['add', '.']);
    commit('two exceptions');
    const r = cli('--raises', base);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /src\/a\.ts:1:/);
    assert.match(
      r.stderr,
      /src\/a\.ts:4:/,
      'review finding: the second exception the hash covers was never shown'
    );
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
  'RULES-DOC': {
    from: 'docs/payments/architecture.md said a money file was 5,097 lines long when it was 9,015 (census 2026-11-15)',
    tree: {
      'docs/architecture/rules.md': '# Architecture rules\n\nhand-edited\n',
    },
  },
  'CI-GATES': {
    from: "Codex-kxdz9: gate.sh skipped five of CI's static gates, and PR #705 went red in CI after passing it",
    tree: {
      '.github/workflows/static_analysis.yml':
        'jobs:\n  x:\n    steps:\n      - run: node scripts/checks/new-gate.mjs\n',
    },
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
    assert.equal(
      fires(
        '[ref]: ./gone.md\n<a href="../b/gone.md">b</a> [c](<./gone two.md>)\n'
      ),
      3,
      'reference definitions, href and angle links are links too'
    );
    assert.equal(
      fires('Text.[^n1]\n\n[^n1]: iter-007 picked a bead\n'),
      0,
      'a footnote definition is prose, not a link (docs/triage/master.md)'
    );
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
  test('CI-GATES fails both ways, and on a switched-off step, caller or missing script', async () => {
    const rule = byId('CI-GATES');
    const { GATES, CI_SETUP_STEPS, CI_CALLERS } = await import(
      './architecture-rules.mjs'
    );
    const { gateCommands } = await import('./architecture-lists.mjs');
    const commands = GATES.flatMap(gateCommands);
    const steps = [...CI_SETUP_STEPS, ...commands];
    const webScripts = commands
      .map((c) => /^pnpm --filter web run (\S+)$/.exec(c)?.[1])
      .filter(Boolean);
    const step = (l) => `      - run: ${l}\n`;
    const yml = (body) => `jobs:\n  x:\n    steps:\n${body}`;
    const caller = (extra = '') =>
      `on:\n  pull_request:\n  push:\njobs:\n  static:\n${extra}    uses: ./.github/workflows/static_analysis.yml\n`;
    const green = (over = {}) => ({
      '.github/workflows/static_analysis.yml': yml(steps.map(step).join('')),
      ...Object.fromEntries(CI_CALLERS.map((c) => [c, caller()])),
      'package.json': JSON.stringify({
        scripts: { 'check:ci': 'x', typecheck: 'x' },
      }),
      'apps/web/package.json': JSON.stringify({
        name: 'web',
        scripts: Object.fromEntries(webScripts.map((s) => [s, 'x'])),
      }),
      ...over,
    });
    const hits = (tree) =>
      newProblems(rule, tree).flatMap((p) => p.hits.map((h) => h.text));
    const withSteps = (body) =>
      green({ '.github/workflows/static_analysis.yml': yml(body) });
    assert.deepEqual(hits(green()), []);
    assert.equal(
      hits(
        withSteps(
          [...steps, 'node scripts/checks/new-gate.mjs'].map(step).join('')
        )
      ).length,
      1,
      'an unlisted CI step'
    );
    assert.match(
      hits(
        withSteps(
          steps
            .filter((c) => c !== 'pnpm check:ci')
            .map(step)
            .join('')
        )
      ).join(),
      /pnpm check:ci is missing from/,
      'a listed gate CI dropped'
    );
    assert.match(
      hits(
        withSteps(
          `${steps.map(step).join('')}      - run: |\n          pnpm x\n`
        )
      ).join(),
      /plain run: line/,
      'a block-scalar step can hide a gate'
    );
    const conditional = steps
      .map((c) =>
        c === 'pnpm check:ci'
          ? `      - name: biome\n        if: github.event_name == 'pull_request'\n        run: ${c}\n`
          : step(c)
      )
      .join('');
    assert.match(
      hits(withSteps(conditional)).join(),
      /switched off or changed by if:/,
      'a step that runs only sometimes is not a gate'
    );
    assert.match(
      hits(
        green({
          [CI_CALLERS[0]]: caller("    if: github.ref == 'refs/heads/main'\n"),
        })
      ).join(),
      /must always run/
    );
    const webless = green({
      'apps/web/package.json': JSON.stringify({ name: 'web', scripts: {} }),
    });
    assert.match(
      hits(webless).join(),
      /web has script check:load-retry is missing/,
      'pnpm --filter exits 0 for a missing script'
    );
  });

  test('RULES-DOC: the committed page must equal the render', async () => {
    const rule = byId('RULES-DOC');
    const { GATES } = await import('./architecture-rules.mjs');
    const { renderRulesDoc } = await import('./architecture-docs.mjs');
    const page = renderRulesDoc(RULES, GATES);
    assert.equal(
      newProblems(rule, { 'docs/architecture/rules.md': page }).length,
      0
    );
    const drift = newProblems(rule, {
      'docs/architecture/rules.md': page.replace('### A1', '### A1x'),
    });
    assert.match(drift[0].hits[0].text, /differs from the registry from here/);
    assert.equal(newProblems(rule, {}).length, 1, 'a missing page fails');
    for (const r of RULES)
      assert.ok(page.includes(`### ${r.id}\n`), `${r.id} has an anchor`);
  });

  test('RATE-LIMIT-BINDING: the default preset, every env, every limiter, and what it cannot read', () => {
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
      fires(
        "procedure({ policy: { auth: 'required' }, handler: async () => ({ auth: 'worker' }) });\n",
        wrangler([])
      ),
      2,
      'only the policy can exempt a route, never its handler'
    );
    // review finding: the first version read procedure() only, so these
    // routes were never checked.
    assert.equal(
      fires(
        "multipartProcedure({ policy: { rateLimit: 'strict' } });\nbinaryUploadProcedure({ policy: {} });\n",
        wrangler([])
      ),
      4,
      'multipart and binary uploads are routes too'
    );
    assert.equal(
      fires(
        "app.use(rateLimit({ preset: 'strict', binding: c.env.RATE_LIMIT_STRICT }));\n",
        wrangler([])
      ),
      2,
      'a direct rateLimit() middleware needs the binding it passes'
    );
    assert.equal(
      fires(
        "app.use(rateLimit({ preset: 'api', binding: c.env.RATE_LIMIT_STRICT }));\n"
      ),
      1,
      'review finding: a binding that differs from its preset fails, though both exist'
    );
    const durable = JSON.stringify({
      name: 'w',
      durable_objects: {
        bindings: [{ name: 'RATE_LIMIT_DO', class_name: 'L' }],
      },
      env: {
        production: {
          durable_objects: {
            bindings: [{ name: 'RATE_LIMIT_DO', class_name: 'L' }],
          },
        },
      },
    });
    assert.equal(
      fires("procedure({ policy: { rateLimit: 'auth' } });\n", durable),
      0,
      'the auth preset runs on a Durable Object binding'
    );
    assert.equal(
      fires("procedure({ policy: { rateLimit: 'auth' } });\n", wrangler(both)),
      2,
      'and fails without it'
    );
    for (const [route, why] of [
      [
        'procedure({ policy: { rateLimit: pick() } });\n',
        'a non-literal preset',
      ],
      ['procedure({ policy, handler });\n', 'a shorthand policy'],
      ["import { procedure as p } from '@codex/worker-utils';\n", 'an alias'],
      ['app.use(rateLimit({ limit: 3 }));\n', 'a rateLimit() with no preset'],
    ]) {
      assert.equal(
        fires(route, wrangler([])),
        1,
        `${why} fails, never guessed`
      );
    }
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
// Inline exceptions and countersigned loosening (WP-7)
// ---------------------------------------------------------------------------

describe('inline exceptions expire', () => {
  const today = '2026-11-17';
  const ok = (until = '2026-12-01', rule = 'T1') =>
    `// ${IGNORE} ${rule} until=${until} by=bruce — the drain moves in WP5\n`;
  const problemsOf = (tree, rules = [CALL_RULE, SIZE_RULE]) => {
    const source = memorySource(tree);
    return compare(rules, collect(rules, source), {}, source, { today });
  };
  const why = (tree, rules) =>
    problemsOf(tree, rules)
      .map((p) => p.why ?? p.type)
      .join();

  test('a valid exception on the line above excuses one hit only', () => {
    assert.deepEqual(problemsOf({ 'src/a.ts': `${ok()}forbidden();\n` }), []);
    assert.deepEqual(
      types(problemsOf({ 'src/a.ts': `${ok()}forbidden();\nforbidden();\n` })),
      ['new:T1:src/a.ts']
    );
    assert.deepEqual(
      types(problemsOf({ 'src/a.ts': `${ok()}forbidden(); forbidden();\n` })),
      ['new:T1:src/a.ts'],
      'two violations on one line need two exceptions'
    );
  });

  test('an expired, too-long, unused, malformed or unknown exception fails', () => {
    assert.match(
      why({ 'src/a.ts': `${ok('2026-11-16')}forbidden();\n` }),
      /expired on 2026-11-16/
    );
    assert.match(
      why({ 'src/a.ts': `${ok('2027-03-01')}forbidden();\n` }),
      /more than 90 days out \(the latest allowed today is 2027-02-15\)/
    );
    assert.match(
      why({ 'src/a.ts': `${ok()}fine();\n` }),
      /excuses no T1 violation/
    );
    assert.match(
      why({ 'src/a.ts': `// ${IGNORE} T1 because I said so\nforbidden();\n` }),
      /malformed/
    );
    assert.match(
      why({ 'src/a.ts': `${ok('2026-02-30')}forbidden();\n` }),
      /malformed/,
      'a date that does not exist'
    );
    assert.match(
      why({ 'src/a.ts': `${ok('2026-12-01', 'NOPE')}forbidden();\n` }),
      /doesn't define/
    );
    assert.match(
      why({ 'src/a.ts': `${ok('2026-12-01', 'T-SIZE')}x\n` }),
      /measures a whole file/
    );
    assert.match(
      why({ 'src/owner.ts': `${ok()}forbidden();\n` }),
      /doesn't apply to this file/
    );
  });

  test('a rule marked exceptions: false cannot be excepted', () => {
    const strict = { ...CALL_RULE, exceptions: false };
    assert.match(
      why({ 'src/a.ts': `${ok()}forbidden();\n` }, [strict]),
      /can't be excepted: fix the drift instead/
    );
  });

  test('in markdown only an HTML comment outside code is a directive', () => {
    const rule = {
      ...CALL_RULE,
      id: 'T2',
      scope: { include: ['**/*.md'] },
      match: { kind: 'cite', text: 'BAD' },
    };
    const dir = `<!-- ${IGNORE} T2 until=2026-12-01 by=bruce — quoted on purpose -->`;
    assert.deepEqual(problemsOf({ 'd.md': `${dir}\nBAD\n` }, [rule]), []);
    const fenced = `\`\`\`\n// ${IGNORE} T2 until=2026-12-01 by=bruce — an example\n\`\`\`\nBAD\n`;
    assert.deepEqual(types(problemsOf({ 'd.md': fenced }, [rule])), [
      'new:T2:d.md',
    ]);
  });
});

describe('loosening needs a countersign', () => {
  const rules = [CALL_RULE, SIZE_RULE];
  const before = {
    T1: { 'src/a.ts': [K, K], 'src/b.ts': [K] },
    'T-SIZE': { 'src/big.ts': 900 },
  };

  test('raised and added pins are found; lowering is free', () => {
    const after = {
      T1: { 'src/a.ts': [K, K, K], 'src/c.ts': [K] },
      'T-SIZE': { 'src/big.ts': 901 },
    };
    assert.deepEqual(
      raisedEntries(rules, before, after).map((r) => `${r.ruleId} ${r.file}`),
      ['T1 src/a.ts', 'T1 src/c.ts', 'T-SIZE src/big.ts']
    );
    assert.deepEqual(
      raisedEntries(rules, before, {
        T1: { 'src/a.ts': [K] },
        'T-SIZE': { 'src/big.ts': 800 },
      }),
      []
    );
  });

  test('swapping a pinned key for another is a raise, though the count holds', () => {
    assert.deepEqual(
      raisedEntries(rules, before, { T1: { 'src/b.ts': [B] } }).map(
        (r) => r.file
      ),
      ['src/b.ts']
    );
  });

  test('a pin changed to a shape the ratchet cannot compare is a raise', () => {
    assert.equal(
      raisedEntries(rules, before, { T1: { 'src/b.ts': 9 } }).length,
      1
    );
    assert.equal(
      raisedEntries(rules, before, { 'T-SIZE': { 'src/big.ts': '901' } })
        .length,
      1
    );
    assert.deepEqual(
      raisedEntries(
        rules,
        { T1: { 'src/a.ts': 2 } },
        { T1: { 'src/a.ts': [K, K] } }
      ),
      [],
      'the one-time count-to-keys conversion raises nothing'
    );
  });

  test('a new block for a new rule can be signed as a whole, at its hash', () => {
    const after = { T1: { 'src/a.ts': [K] } };
    const raised = raisedEntries(rules, {}, after);
    assert.equal(raised[0].newRule, true);
    const items = raised.map((r) => raiseItem(r, after));
    const sign = (hash) =>
      parseCountersigns(
        `G0-RAISE: T1 *@${hash} — the rule arrives with its debt\n`
      );
    assert.deepEqual(uncovered(items, sign(hashOf(after.T1))), []);
    assert.equal(
      uncovered(items, sign('00000000')).length,
      1,
      'a block the owner never saw'
    );
  });

  test('a countersign needs a three-word reason, and covers only its own entry', () => {
    assert.deepEqual(
      [
        ...parseCountersigns(
          [
            'Subject',
            '',
            'G0-RAISE: T1 src/a.ts — the hotfix lands first',
            'G0-RAISE: T1 src/b.ts — ok',
            'G0-RAISE: T1 src/c.ts — <why>',
            '  G0-RAISE: GATE scripts/x.mjs -- rule tightened, not loosened',
          ].join('\n')
        ),
      ],
      ['T1 src/a.ts', 'GATE scripts/x.mjs']
    );
    const after = { T1: { 'src/a.ts': [K, K, K], 'src/c.ts': [K] } };
    const items = [
      ...raisedEntries(rules, before, after).map((r) => raiseItem(r, after)),
      { key: 'T1 src/d.ts', state: 'aaaaaaaa', star: null, what: 'x' },
      {
        key: 'GATE scripts/checks/architecture-rules.mjs',
        state: 'bbbbbbbb',
        star: null,
        what: 'y',
      },
    ];
    const signedAt = (hash) =>
      parseCountersigns(
        `G0-RAISE: T1 src/a.ts@${hash} — the hotfix lands first\n`
      );
    assert.deepEqual(
      uncovered(items, signedAt(hashOf([K, K, K]))).map((m) => m.line),
      [
        `G0-RAISE: T1 src/c.ts@${hashOf([K])} — <why>`,
        'G0-RAISE: T1 src/d.ts@aaaaaaaa — <why>',
        'G0-RAISE: GATE scripts/checks/architecture-rules.mjs@bbbbbbbb — <why>',
      ]
    );
    assert.equal(
      uncovered(items, signedAt(hashOf([K, K]))).length,
      4,
      'a countersign for an earlier state of the pin covers nothing'
    );
  });
});

// ---------------------------------------------------------------------------
// Round 2 review fixes (G0, 2026-11-18)
// ---------------------------------------------------------------------------

describe('round 2: keys, commit time, renames and the base', () => {
  test('a call key names its function, so a fix in one cannot pay for a call in another', () => {
    // review finding: A1 pinned only "transfers.create(", so the pinned call
    // could move to the ledger while a new direct one appeared elsewhere.
    const pinned = 'payCreator>forbidden(';
    const before = 'function payCreator() {\n  forbidden();\n}\n';
    assert.deepEqual(
      types(
        run(
          [CALL_RULE],
          { 'src/a.ts': before },
          { T1: { 'src/a.ts': [pinned] } }
        ).problems
      ),
      []
    );
    const swapped =
      'function payCreator() {\n  ledger.pay();\n}\nfunction sneaky() {\n  forbidden();\n}\n';
    assert.deepEqual(
      types(
        run(
          [CALL_RULE],
          { 'src/a.ts': swapped },
          { T1: { 'src/a.ts': [pinned] } }
        ).problems
      ),
      ['more:T1:src/a.ts', 'remove:T1:src/a.ts']
    );
  });

  test('the enclosing name survives a multi-line signature and destructured parameters', () => {
    const text = [
      'export class S {',
      '  async drain(',
      '    { creatorId }: Args,',
      '    other: number',
      '  ): Promise<{',
      '    sent: number;',
      '  }> {',
      '    for (const x of xs) {',
      '      try {',
      '        await forbidden(x);',
      '      } catch (e) {',
      '        forbidden(e);',
      '      }',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const { hits } = MATCHERS.call.file(CALL_RULE, 'src/a.ts', text);
    assert.deepEqual(
      hits.map((h) => h.key),
      ['drain>forbidden(', 'drain>forbidden(']
    );
  });

  test('at commit time only the committed files exceptions are judged', () => {
    // review finding: a whole-repo rule read an untouched file, whose valid
    // exception then failed every commit as "doesn't apply to this file".
    const reader = {
      id: 'W1',
      title: 'Reads every file',
      why: 'fixture',
      fix: 'n/a',
      scope: { include: ['src/**/*.ts'] },
      match: {
        kind: 'lists-agree',
        need: (source) => {
          source.read('src/old.ts');
          return [];
        },
        have: () => new Map(),
      },
    };
    const tree = {
      'src/a.ts': 'ok();\n',
      'src/old.ts': `// ${IGNORE} T1 until=2026-12-01 by=bruce — the drain moves next\nforbidden();\n`,
    };
    const source = memorySource(tree, { changed: ['src/a.ts'] });
    const rules = [CALL_RULE, reader];
    const problems = compare(
      rules,
      collect(rules, source),
      { T1: {} },
      source,
      {
        today: '2026-11-17',
      }
    );
    assert.deepEqual(problems, []);
  });

  test('a pin for a rule that allows no baseline fails, and --init never writes one', () => {
    const strict = { ...CALL_RULE, baseline: false, exceptions: false };
    const tree = { 'src/a.ts': 'forbidden();\n' };
    assert.deepEqual(
      types(run([strict], tree, { T1: { 'src/a.ts': [K] } }).problems),
      ['unpinnable:T1:src/a.ts']
    );
    const { results } = run([strict], tree, {});
    assert.deepEqual(initialBaseline([strict], results), {});
  });

  test('--lower copies a malformed pin through instead of guessing, and keeps untouched files at commit time', () => {
    const tree = { 'src/a.ts': 'forbidden();\nforbidden();\nforbidden();\n' };
    for (const bad of [-1, '3', null]) {
      const baseline = { T1: { 'src/a.ts': bad } };
      const { results } = run([CALL_RULE], tree, baseline);
      assert.deepEqual(
        lowerBaseline([CALL_RULE], results, baseline),
        baseline,
        `pin ${bad}`
      );
    }
    const source = memorySource(
      { 'src/a.ts': 'ok();\n', 'src/b.ts': 'ok();\n' },
      { changed: ['src/a.ts'] }
    );
    const baseline = { T1: { 'src/a.ts': [K], 'src/b.ts': [K] } };
    const results = collect([CALL_RULE], source);
    assert.deepEqual(lowerBaseline([CALL_RULE], results, baseline, source), {
      T1: { 'src/b.ts': [K] },
    });
  });

  test('a renamed file carries its pin: one "moved" problem, no new or stale one', () => {
    const tree = { 'src/new.ts': 'forbidden();\n' };
    const source = memorySource(tree, {
      changed: ['src/new.ts'],
      deleted: ['src/old.ts'],
      renames: { 'src/new.ts': 'src/old.ts' },
    });
    const baseline = { T1: { 'src/old.ts': [K] } };
    const results = collect([CALL_RULE], source);
    const problems = compare([CALL_RULE], results, baseline, source);
    assert.deepEqual(types(problems), ['moved:T1:src/new.ts']);
    assert.deepEqual(lowerBaseline([CALL_RULE], results, baseline, source), {
      T1: { 'src/new.ts': [K] },
    });
  });

  test('a CRLF file keeps its exceptions, and a cite hit is counted per citation', () => {
    const crlf = `// ${IGNORE} T1 until=2026-12-01 by=bruce — the drain moves next\r\nforbidden();\r\n`;
    const source = memorySource({ 'src/a.ts': crlf });
    assert.deepEqual(
      compare([CALL_RULE], collect([CALL_RULE], source), {}, source, {
        today: '2026-11-17',
      }),
      []
    );
    const cite = {
      ...CALL_RULE,
      id: 'C1',
      scope: { include: ['**/*.md'] },
      match: { kind: 'cite', text: 'BAD/' },
    };
    const { hits } = MATCHERS.cite.file(
      cite,
      'd.md',
      'see BAD/a.md and BAD/b.md\n'
    );
    assert.deepEqual(
      hits.map((h) => h.key),
      ['BAD/a.md', 'BAD/b.md']
    );
  });

  test('judged at the base: only a fix this change made blocks', () => {
    const judge = (headTree, baseTree, baseline, rules = [CALL_RULE]) => {
      const source = memorySource(headTree);
      const problems = compare(
        rules,
        collect(rules, source),
        baseline,
        source,
        {
          bankFails: () => false,
        }
      );
      judgeFixesAtBase(rules, problems, {
        baseSource: memorySource(baseTree),
        baseBaseline: baseline,
      });
      return problems.map((p) => `${p.type}:${p.blocking}`);
    };
    const pins = { T1: { 'src/a.ts': [K] } };
    assert.deepEqual(
      judge({ 'src/a.ts': 'ok();\n' }, { 'src/a.ts': 'forbidden();\n' }, pins),
      ['remove:true'],
      'fixed by this change'
    );
    assert.deepEqual(
      judge({ 'src/a.ts': 'ok();\n' }, { 'src/a.ts': 'ok();\n' }, pins),
      ['remove:false'],
      'already fixed, unbanked, at the base'
    );
    const size = { 'T-SIZE': { 'src/big.ts': 5 } };
    assert.deepEqual(
      judge(
        { 'src/big.ts': 'a\nb\nc\nd\n' },
        { 'src/big.ts': 'a\nb\nc\nd\ne\n' },
        size,
        [SIZE_RULE]
      ),
      ['fewer:true']
    );
    assert.deepEqual(
      judge(
        { 'src/big.ts': 'a\nb\nc\nd\n' },
        { 'src/big.ts': 'a\nb\nc\nd\n' },
        size,
        [SIZE_RULE]
      ),
      ['fewer:false']
    );
  });
});

describe('round 2: countersigns', () => {
  const rules = [CALL_RULE, SIZE_RULE];

  test('the printed template, pasted back, is not a countersign', () => {
    assert.equal(
      parseCountersigns(
        'G0-RAISE: T1 src/a.ts — <why>    (T1 src/a.ts: allows "x" more)\n'
      ).size,
      0
    );
  });

  test('a renamed pin is not a raise; RULE * signs only a rule the base lacked', () => {
    const renames = new Map([['src/new.ts', 'src/old.ts']]);
    assert.deepEqual(
      raisedEntries(
        rules,
        { T1: { 'src/old.ts': [K] } },
        { T1: { 'src/new.ts': [K] } },
        { renames }
      ),
      []
    );
    // T1 existed at the base with no debt: its first pin is per file.
    const raised = raisedEntries(
      rules,
      {},
      { T1: { 'src/a.ts': [K] } },
      {
        baseRuleIds: new Set(['T1']),
      }
    );
    assert.equal(raised[0].newRule, false);
    const after = { T1: { 'src/a.ts': [K] } };
    assert.deepEqual(
      uncovered(
        raised.map((r) => raiseItem(r, after)),
        parseCountersigns(
          `G0-RAISE: T1 *@${hashOf(after.T1)} — the rule arrives with its debt\n`
        )
      ).map((m) => m.line),
      [`G0-RAISE: T1 src/a.ts@${hashOf([K])} — <why>`]
    );
  });

  test('a calling workflow is part of the gate only where the gate depends on it', () => {
    const wf = '.github/workflows/static_analysis.yml';
    const caller = (e2eRunner, trigger = 'pull_request') =>
      `name: T\non:\n  ${trigger}:\n  push:\n\njobs:\n  static-analysis:\n    uses: ./${wf}\n\n  e2e:\n    runs-on: ${e2eRunner}\n    steps:\n      - run: pnpm test\n`;
    assert.equal(
      callerPrint(caller('ubuntu-22.04'), wf),
      callerPrint(caller('ubuntu-24.04'), wf)
    );
    assert.notEqual(
      callerPrint(caller('ubuntu-22.04'), wf),
      callerPrint(caller('ubuntu-22.04', 'workflow_dispatch'), wf)
    );
    assert.notEqual(
      callerPrint(caller('x'), wf),
      callerPrint(
        caller('x').replace(`uses: ./${wf}`, `if: false\n    uses: ./${wf}`),
        wf
      )
    );
  });

  test('ciBase knows its events and stops on any other', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arch-event-'));
    try {
      const event = (payload) => {
        const path = join(dir, `${Math.random()}.json`);
        writeFileSync(path, JSON.stringify(payload));
        return path;
      };
      assert.throws(
        () =>
          ciBase(dir, {
            GITHUB_EVENT_NAME: 'workflow_dispatch',
            GITHUB_EVENT_PATH: event({}),
          }),
        /not one the gate knows how to judge/
      );
      assert.deepEqual(
        ciBase(dir, {
          GITHUB_EVENT_NAME: 'merge_group',
          GITHUB_EVENT_PATH: event({ merge_group: { base_sha: 'abc' } }),
        }),
        { kind: 'pr', base: 'abc' }
      );
      assert.equal(
        ciBase(dir, {
          GITHUB_EVENT_NAME: 'push',
          GITHUB_REF: 'refs/heads/dev',
          GITHUB_EVENT_PATH: event({ before: '0000000000' }),
        }).base,
        null
      );
      assert.throws(
        () =>
          ciBase(dir, {
            GITHUB_EVENT_NAME: 'push',
            GITHUB_REF: 'refs/heads/main',
            GITHUB_EVENT_PATH: event({}),
          }),
        /names no "before"/
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('round 2: the registry rules', async () => {
  const { RULES } = await import('./architecture-rules.mjs');
  const byId = (id) => RULES.find((r) => r.id === id);
  const newProblems = (rule, tree) =>
    run([rule], tree, {}).problems.filter((p) => p.type === 'new');

  test('A1 sees optional chaining and a call split across lines', () => {
    const a1 = byId('A1');
    for (const code of [
      'await stripe.transfers?.create({ amount });\n',
      'await stripe\n  .transfers\n  .create({ amount });\n',
      'await stripe.transfers.createReversal(id);\n',
    ]) {
      assert.equal(
        newProblems(a1, { 'packages/purchase/src/x.ts': code }).length,
        1,
        code
      );
    }
  });

  test('DOC-INDEX: a link to the index folder itself lists nothing', () => {
    const rule = byId('DOC-INDEX');
    assert.equal(
      newProblems(rule, {
        'docs/README.md': '- [All docs](./)\n- [Up](../)\n',
        'docs/probe/orphan.md': '',
      }).length,
      1
    );
  });

  test('RATE-LIMIT-BINDING fails what it cannot read, and follows what it can', () => {
    const rule = byId('RATE-LIMIT-BINDING');
    const fires = (route, bindings = ['RATE_LIMIT_API']) =>
      newProblems(rule, {
        'packages/constants/src/limits.ts': limitsTs,
        'workers/w/wrangler.jsonc': wrangler(bindings),
        'workers/w/src/routes.ts': route,
      }).reduce((n, p) => n + p.found, 0);
    for (const [route, why] of [
      [
        "procedure({ policy: { auth: 'required', ...strictPolicy } });\n",
        'a spread in the policy',
      ],
      ['procedure({ ...strictWrite, handler });\n', 'a spread of the options'],
      [
        "procedure<Body>({ policy: { rateLimit: 'strict' } });\n",
        'type arguments',
      ],
      ['const route = procedure;\n', 'a stored reference'],
    ]) {
      assert.equal(fires(route), 1, `${why} is unreadable, so it fails`);
    }
    assert.equal(
      fires(
        "import * as wu from '@codex/worker-utils';\nwu.procedure({ policy: { rateLimit: 'streaming' } });\n"
      ),
      2,
      'a call through a namespace import is read'
    );
    assert.equal(
      fires('procedure({ policy: { auth: AUTH_ROLES.PLATFORM_OWNER } });\n'),
      0,
      'an AUTH_ROLES member is never the worker role: it needs api, which exists'
    );
    assert.equal(
      fires(
        "procedure({ handler: async () => ({ policy: { auth: 'worker' } }), policy: { rateLimit: 'strict' } });\n"
      ),
      2,
      'only the top-level policy decides, never one inside the handler'
    );
    assert.equal(
      fires("procedure({ policy: { rateLimit: 'api' } });\n", [
        'RATE_LIMIT_API',
      ]).toString(),
      '0'
    );
    const routeless = newProblems(rule, {
      'packages/constants/src/limits.ts': limitsTs,
      'workers/w/wrangler.jsonc': wrangler(['RATE_LIMIT_API']),
      'workers/w/lib/routes.ts':
        "procedure({ policy: { rateLimit: 'strict' } });\n",
    });
    assert.match(
      routeless.flatMap((p) => p.hits.map((h) => h.text)).join(),
      /route files under workers\/w\/src\//,
      'a worker whose routes left src/ checks nothing, so it fails'
    );
  });

  test('CI-GATES: a job-level switch, a spaced key, a shell or a waiting caller turns a gate off', async () => {
    const rule = byId('CI-GATES');
    const { GATES, CI_SETUP_STEPS, CI_CALLERS } = await import(
      './architecture-rules.mjs'
    );
    const { gateCommands } = await import('./architecture-lists.mjs');
    const commands = GATES.flatMap(gateCommands);
    const webScripts = commands
      .map((c) => /^pnpm --filter web run (\S+)$/.exec(c)?.[1])
      .filter(Boolean);
    const steps = [...CI_SETUP_STEPS, ...commands]
      .map((c) => `      - name: s\n        run: ${c}\n`)
      .join('');
    const caller = (extra = '') =>
      `on:\n  pull_request:\njobs:\n  static:\n${extra}    uses: ./.github/workflows/static_analysis.yml\n`;
    const tree = (workflow, callerText = caller()) => ({
      '.github/workflows/static_analysis.yml': workflow,
      ...Object.fromEntries(CI_CALLERS.map((c) => [c, callerText])),
      'package.json': JSON.stringify({
        scripts: { 'check:ci': 'x', typecheck: 'x' },
      }),
      'apps/web/package.json': JSON.stringify({
        name: 'web',
        scripts: Object.fromEntries(webScripts.map((s) => [s, 'x'])),
      }),
    });
    const hits = (t) =>
      newProblems(rule, t)
        .flatMap((p) => p.hits.map((h) => h.text))
        .join('\n');
    const job = (keys) =>
      `jobs:\n  x:\n    runs-on: ubuntu-latest\n${keys}    steps:\n${steps}`;
    assert.equal(hits(tree(job(''))), '', 'the green tree');
    assert.match(
      hits(tree(job('    if: false\n'))),
      /changed by the job's if:/
    );
    assert.match(
      hits(tree(job('    continue-on-error: true\n'))),
      /changed by the job's continue-on-error:/
    );
    assert.match(
      hits(tree(`defaults:\n  run:\n    shell: true {0}\n${job('')}`)),
      /the workflow defaults:/
    );
    assert.match(
      hits(
        tree(
          job('').replace(
            'run: pnpm check:ci',
            'if : false\n        run: pnpm check:ci'
          )
        )
      ),
      /pnpm check:ci \(switched off or changed by if:\)/,
      'review finding: "if :" with a space is still an if'
    );
    assert.match(
      hits(
        tree(
          job('').replace(
            'run: pnpm check:ci',
            'shell: true {0}\n        run: pnpm check:ci'
          )
        )
      ),
      /changed by shell:/
    );
    assert.match(
      hits(tree(job(''), caller('    needs: [setup]\n'))),
      /no if: or needs:/
    );
    assert.match(
      hits(
        tree(
          job(''),
          'on:\n  push:\njobs:\n  static:\n    uses: ./.github/workflows/static_analysis.yml\n'
        )
      ),
      /on pull_request is missing/
    );
  });
});

// ---------------------------------------------------------------------------
// Round 3 review fixes
// ---------------------------------------------------------------------------

describe('round 3: the base, the gate and keys', () => {
  test('a PR pin allows what the base still had, plus its own raise', () => {
    const spent = (rules, headTree, baseTree, pins, basePins = pins) => {
      const source = memorySource(headTree);
      return spentAtBase(rules, collect(rules, source), pins, {
        baseSource: memorySource(baseTree),
        baseBaseline: basePins,
      }).map((p) => `${p.file}:${p.allowed}:${p.found}`);
    };
    const pins = { T1: { 'src/a.ts': [K] } };
    const once = { 'src/a.ts': 'forbidden();\n' };
    const fixed = { 'src/a.ts': 'ok();\n' };
    assert.deepEqual(
      spent([CALL_RULE], once, fixed, pins),
      ['src/a.ts:0:1'],
      'the base had lost it, though the pin kept it'
    );
    assert.deepEqual(spent([CALL_RULE], once, once, pins), []);
    assert.deepEqual(
      spent(
        [CALL_RULE],
        { 'src/a.ts': 'forbidden();\nforbidden();\n' },
        fixed,
        { T1: { 'src/a.ts': [K, K] } },
        pins
      ),
      ['src/a.ts:1:2'],
      "this change's raise counts; the stale pin it sits on does not"
    );
    assert.deepEqual(
      spent([CALL_RULE], once, {}, pins, {}),
      [],
      'a pin this change added is all raise'
    );
    assert.deepEqual(
      spent([CALL_RULE], { 'src/b.ts': 'forbidden();\n' }, fixed, {
        T1: { 'src/a.ts': [K] },
      }),
      [],
      'an unpinned file is judged by compare(), not here'
    );
    const size = { 'T-SIZE': { 'src/big.ts': 5 } };
    const four = { 'src/big.ts': 'a\nb\nc\nd\n' };
    assert.deepEqual(
      spent([SIZE_RULE], { 'src/big.ts': 'a\nb\nc\nd\ne\n' }, four, size),
      ['src/big.ts:4:5']
    );
    assert.deepEqual(spent([SIZE_RULE], four, four, size), []);
    const raisedTo6 = { 'T-SIZE': { 'src/big.ts': 6 } };
    assert.deepEqual(
      spent(
        [SIZE_RULE],
        { 'src/big.ts': 'a\nb\nc\nd\ne\nf\n' },
        four,
        raisedTo6,
        size
      ),
      ['src/big.ts:5:6'],
      'review finding: a raise of one released all the stale headroom too'
    );
    assert.deepEqual(
      spent(
        [SIZE_RULE],
        { 'src/big.ts': 'a\nb\nc\nd\ne\n' },
        four,
        raisedTo6,
        size
      ),
      [],
      'the base had 4, the raise adds 1'
    );
  });

  test('a whole-repo rule: a pin already stale at the base is a notice', () => {
    const WHOLE = {
      id: 'T-W',
      title: 'Lists agree',
      why: 'fixture',
      fix: 'List it.',
      scope: { include: ['cfg/**'] },
      match: {
        kind: 'lists-agree',
        need: (source, subjects) =>
          subjects.map((f) => ({
            group: 'g',
            item: source.read(f).trim(),
            file: f,
            line: 1,
            text: 'needs',
          })),
        have: () => new Map([['g', { file: 'x', items: new Set(['y']) }]]),
      },
    };
    const tree = { 'cfg/b': 'y\n' };
    const baseline = { 'T-W': { 'cfg/gone': ['x'] } };
    const judged = (baseTree) => {
      const source = memorySource(tree);
      const problems = compare(
        [WHOLE],
        collect([WHOLE], source),
        baseline,
        source,
        { bankFails: () => false }
      );
      judgeFixesAtBase([WHOLE], problems, {
        baseSource: memorySource(baseTree),
        baseBaseline: baseline,
      });
      return problems.map((p) => `${p.type}:${p.blocking}`);
    };
    assert.deepEqual(judged(tree), ['stale:false'], 'gone at the base too');
    assert.deepEqual(
      judged({ ...tree, 'cfg/gone': 'y\n' }),
      ['stale:true'],
      'this change deleted it'
    );
  });

  test('a key with a decomposed character matches its NFC pin', () => {
    const LINK = {
      id: 'T-L',
      title: 'Links resolve',
      why: 'fixture',
      fix: 'Fix it.',
      scope: { include: ['docs/**/*.md'] },
      match: { kind: 'md-link' },
    };
    const tree = { 'docs/a.md': '[x](./café.md)\n' };
    const { results } = run([LINK], tree, {});
    const key = results.get('T-L').perFile.get('docs/a.md').hits[0].key;
    const pinned = { 'T-L': { 'docs/a.md': [key.normalize('NFC')] } };
    assert.deepEqual(run([LINK], tree, pinned).problems, []);
  });

  test('A1 keys: a multi-line string above the call keeps its function, and a string never matches', async () => {
    const { RULES } = await import('./architecture-rules.mjs');
    const a1 = RULES.find((r) => r.id === 'A1');
    const text = [
      "app.post('/refund/handler', async (c) => {",
      '  const note = `line one',
      'still inside the string {',
      '`;',
      '  await stripe.refunds.create({});',
      '});',
      "app.post('/cancel/retry', async (c) => {",
      '  await stripe.refunds.create({});',
      '});',
      'async function pay() {',
      "  const s = 'transfers.create( only in a string';",
      '  await stripe.payouts.create({});',
      '}',
    ].join('\n');
    // Routes are read in a worker's source only (review round 6).
    const file = 'workers/w/src/routes/a.ts';
    const { results } = run([a1], { [file]: text }, {});
    assert.deepEqual(
      results
        .get('A1')
        .perFile.get(file)
        .hits.map((h) => h.key),
      [
        'POST /refund/handler>refunds.create(',
        'POST /cancel/retry>refunds.create(',
        'pay>payouts.create(',
      ]
    );
  });

  test('DOC-SESSION keys drop the sentence punctuation after a path', async () => {
    const { RULES } = await import('./architecture-rules.mjs');
    const rule = RULES.find((r) => r.id === 'DOC-SESSION');
    const { results } = run(
      [rule],
      {
        'apps/x.ts': `// see ${SESSION_NOTES}a/b.html.\n// and ${SESSION_NOTES}c.md, too\n`,
      },
      {}
    );
    assert.deepEqual(
      results
        .get('DOC-SESSION')
        .perFile.get('apps/x.ts')
        .hits.map((h) => h.key),
      [`${SESSION_NOTES}a/b.html`, `${SESSION_NOTES}c.md`]
    );
  });
});

describe('round 3: what the gate is made of', () => {
  test('a comment never ends a calling job, and changing one changes nothing', () => {
    const wf = '.github/workflows/static_analysis.yml';
    const caller = `on:\n  pull_request:\njobs:\n  static:\n    uses: ./${wf}\n# a note at column 0\n    with:\n      x: 1\n`;
    assert.notEqual(
      callerPrint(caller, wf),
      callerPrint(
        caller.replace('      x: 1', '      x: 1\n    if: false'),
        wf
      ),
      'review finding: a column-0 comment hid the rest of the job'
    );
    assert.equal(
      callerPrint(caller, wf),
      callerPrint(caller.replace('# a note', '# another note'), wf)
    );
  });

  test('what a gate runs is derived from its commands, followed as a shell would, plus what it declares', () => {
    const gates = [
      { id: 'A', run: 'pnpm check:ci', files: ['biome.json'] },
      {
        id: 'B',
        run: 'pnpm --filter web run check:x',
        ratchets: ['apps/web/b.json'],
      },
      { id: 'C', run: 'pnpm typecheck' },
      {
        id: 'D',
        selfTest: 'node --test scripts/d.test.mjs scripts/e.test.mjs',
        run: 'node --experimental-strip-types ./scripts/d.mjs --verbose',
      },
    ];
    const web = (scripts) => JSON.stringify({ name: 'web', scripts });
    const files = {
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
      'package.json': JSON.stringify({
        scripts: {
          'check:ci': 'biome check .',
          typecheck: 'turbo typecheck',
        },
      }),
      'apps/web/package.json': web({
        'check:x': 'svelte-kit sync && pnpm run check:x:inner',
        'check:x:inner': 'node ./scripts/x.mjs',
        typecheck: 'tsc',
      }),
      'apps/web/turbo.json': '{"tasks":{"typecheck":{}}}',
      'scripts/d.mjs': "import { x } from './lib.mjs';\n",
      'scripts/lib.mjs': 'export const x = 1;\n',
    };
    const parts = gateDependencies(gates, {
      files: Object.keys(files),
      read: (f) => files[f] ?? null,
    });
    assert.deepEqual(parts.map((p) => p.label).sort(), [
      'apps/web/b.json',
      'apps/web/package.json#scripts.check:x',
      'apps/web/package.json#scripts.check:x:inner',
      'apps/web/package.json#scripts.typecheck',
      'apps/web/scripts/x.mjs',
      'apps/web/turbo.json#tasks.typecheck',
      'biome.json',
      'package.json#scripts.check:ci',
      'package.json#scripts.typecheck',
      'pnpm-workspace.yaml#packages',
      'pnpm-workspace.yaml#settings',
      'scripts/d.mjs',
      'scripts/d.test.mjs',
      'scripts/e.test.mjs',
      'scripts/lib.mjs',
      'turbo.json',
    ]);
    const part = (label) => parts.find((p) => p.label === label);
    const script = part('apps/web/package.json#scripts.check:x');
    const withScripts = (scripts) =>
      web({
        ...JSON.parse(files['apps/web/package.json']).scripts,
        ...scripts,
      });
    assert.ok(
      script.changed(
        files['apps/web/package.json'],
        withScripts({ 'check:x': 'true' })
      )
    );
    assert.ok(
      !script.changed(
        files['apps/web/package.json'],
        withScripts({ other: 'y' })
      ),
      'another script is not this gate'
    );
    const ratchet = part('apps/web/b.json');
    assert.ok(ratchet.changed('{"e":{"a":{"T":1}}}', '{"e":{"a":{"T":2}}}'));
    assert.ok(
      ratchet.changed('{"e":{}}', '{"e":{"b":{"T":1}}}'),
      'a file newly carrying errors'
    );
    assert.ok(
      !ratchet.changed('{"e":{"a":{"T":2}}}', '{"e":{"a":{"T":1}}}'),
      'a fall only tightens'
    );
    // The root turbo.json is read whole (owner, 19 Nov: a closed list): a
    // package task, the build typecheck depends on and the global inputs all
    // live there. A package's own turbo.json is read at the gate's tasks.
    const root = part('turbo.json');
    assert.ok(
      root.changed(
        '{"tasks":{"typecheck":{}}}',
        '{"tasks":{"typecheck":{}},"globalDependencies":[]}'
      )
    );
    const task = part('apps/web/turbo.json#tasks.typecheck');
    assert.ok(
      task.changed(
        '{"tasks":{"typecheck":{}}}',
        '{"tasks":{"typecheck":{"cache":false}},"x":1}'
      )
    );
    assert.ok(
      !task.changed(
        '{"tasks":{"typecheck":{}}}',
        '{"tasks":{"typecheck":{}},"x":1}'
      ),
      'another task is not this gate'
    );
    assert.ok(
      !task.changed(
        '{"tasks":{"typecheck":{"inputs":["a"],"cache":true}}}',
        '{"tasks":{"typecheck":{"cache":true,"inputs":["a"]}}}'
      ),
      'review finding: reordering keys changed nothing yet asked again'
    );
  });

  test('the runner lives where the base lookup looks, and imports nothing outside its folder', async () => {
    const { readdirSync } = await import('node:fs');
    const root = join(HERE, '../..');
    const runner = RUNNER.slice(root.length + 1).replaceAll('\\', '/');
    assert.ok(
      GATE_ENTRY_PATHS.includes(runner),
      `${runner} must be in GATE_ENTRY_PATHS, or a base would look gate-free`
    );
    // The base's judge runs from an extracted copy of this folder alone.
    for (const file of readdirSync(HERE).filter((f) => f.endsWith('.mjs'))) {
      const text = readFileSync(join(HERE, file), 'utf8');
      for (const m of text.matchAll(
        /(?:\bfrom\s*|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g
      )) {
        assert.ok(
          !m[2].startsWith('../'),
          `${file} imports ${m[2]}, outside the folder the base's judge extracts`
        );
      }
    }
  });

  test('ciBase: a pull request from dev is a release', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arch-release-'));
    try {
      const sh = (...args) =>
        spawnSync(
          'git',
          ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
          { cwd: dir, encoding: 'utf8' }
        );
      sh('init', '-q');
      sh('commit', '-q', '--allow-empty', '-m', 'one');
      const path = join(dir, '.git', 'event.json');
      writeFileSync(
        path,
        JSON.stringify({ pull_request: { base: { sha: 'abc' } } })
      );
      const env = {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: path,
        GITHUB_BASE_REF: 'main',
      };
      assert.deepEqual(ciBase(dir, { ...env, GITHUB_HEAD_REF: 'dev' }), {
        kind: 'release',
        base: 'abc',
      });
      assert.equal(
        ciBase(dir, { ...env, GITHUB_HEAD_REF: 'dev', GITHUB_BASE_REF: 'x' })
          .kind,
        'pr',
        'dev into another branch is no release'
      );
      writeFileSync(
        path,
        JSON.stringify({
          pull_request: {
            base: { sha: 'abc' },
            head: { repo: { full_name: 'fork/codex' } },
          },
          repository: { full_name: 'brucemckayone/codex' },
        })
      );
      assert.equal(
        ciBase(dir, { ...env, GITHUB_HEAD_REF: 'dev' }).kind,
        'pr',
        "a fork's dev is no release"
      );
      assert.deepEqual(ciBase(dir, { ...env, GITHUB_HEAD_REF: 'feat/x' }), {
        kind: 'pr',
        base: 'abc',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('round 3: the registry rules', async () => {
  const { RULES, GATES, CI_SETUP_STEPS, CI_CALLERS } = await import(
    './architecture-rules.mjs'
  );
  const { gateCommands } = await import('./architecture-lists.mjs');
  const byId = (id) => RULES.find((r) => r.id === id);
  const newProblems = (rule, tree) =>
    run([rule], tree, {}).problems.filter((p) => p.type === 'new');

  test('RATE-LIMIT-BINDING reads a quoted key, and a property read is not an alias', () => {
    const rule = byId('RATE-LIMIT-BINDING');
    const fires = (route) =>
      newProblems(rule, {
        'packages/constants/src/limits.ts': limitsTs,
        'workers/w/wrangler.jsonc': wrangler(['RATE_LIMIT_API']),
        'workers/w/src/routes.ts': route,
      }).reduce((n, p) => n + p.found, 0);
    assert.equal(
      fires("procedure({ 'policy': { 'rateLimit': 'streaming' } });\n"),
      2,
      'review finding: a quoted key read as its masked text and passed as api'
    );
    for (const route of [
      'const limit = policy.rateLimit;\n',
      'const preset = options.rateLimit as string;\n',
    ]) {
      assert.equal(fires(route), 0, `${route.trim()} reads a property`);
    }
    for (const [route, why] of [
      [
        "import { procedure as p } from '@codex/worker-utils';\np({});\n",
        'a renamed import',
      ],
      [
        "import * as wu from '@codex/worker-utils';\nconst p = wu.procedure;\n",
        'a stored namespace member',
      ],
      [
        "import * as wu from '@codex/worker-utils';\nwu['procedure']({ policy: { rateLimit: 'api' } });\n",
        'a computed namespace member',
      ],
    ]) {
      assert.equal(fires(route), 1, `${why} hides its calls, so it fails`);
    }
  });

  test('CI-GATES reads a commented or quoted job header, and a quoted job key', () => {
    const rule = byId('CI-GATES');
    const commands = GATES.flatMap(gateCommands);
    const webScripts = commands
      .map((c) => /^pnpm --filter web run (\S+)$/.exec(c)?.[1])
      .filter(Boolean);
    const steps = [...CI_SETUP_STEPS, ...commands]
      .map((c) => `      - name: s\n        run: ${c}\n`)
      .join('');
    const caller = `on:\n  pull_request:\njobs:\n  static:\n    uses: ./.github/workflows/static_analysis.yml\n`;
    const hits = (workflow) =>
      newProblems(rule, {
        '.github/workflows/static_analysis.yml': workflow,
        ...Object.fromEntries(CI_CALLERS.map((c) => [c, caller])),
        'package.json': JSON.stringify({
          scripts: { 'check:ci': 'x', typecheck: 'x' },
        }),
        'apps/web/package.json': JSON.stringify({
          name: 'web',
          scripts: Object.fromEntries(webScripts.map((s) => [s, 'x'])),
        }),
      })
        .flatMap((p) => p.hits.map((h) => h.text))
        .join('\n');
    const job = (head, keys) =>
      `jobs:  # the jobs\n${head}\n    runs-on: ubuntu-latest\n${keys}    steps:  # every gate\n${steps}`;
    assert.equal(hits(job('  x:  # the job', '')), '', 'the green tree');
    assert.match(
      hits(job('  x:  # the job', '    if: false\n')),
      /changed by the job's if:/,
      'review finding: a comment on the job header hid its if:'
    );
    assert.match(
      hits(job('  "x":', '    "if": false\n')),
      /changed by the job's if:/,
      'review finding: a quoted key hid its if:'
    );
  });
});

// ---------------------------------------------------------------------------
// Round 4 review fixes (G0, 2026-11-19)
// ---------------------------------------------------------------------------

describe('round 4: masking, names, aliases and config', async () => {
  const { RULES } = await import('./architecture-rules.mjs');
  const { JOB_HEAD } = await import('./architecture-lists.mjs');
  const byId = (id) => RULES.find((r) => r.id === id);
  const keys = (text, file = 'packages/x/src/a.ts') =>
    run([byId('A1')], { [file]: text }, {})
      .results.get('A1')
      .perFile.get(file)
      .hits.map((h) => `${h.line}:${h.key}`);

  test('A1 sees a money call inside an interpolation, after a nested template, and after a regex holding a quote', () => {
    assert.deepEqual(
      keys(
        [
          'function pay() {',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text, not a template
          '  log(`sent ${(await stripe.transfers.create(p)).id}`);',
          '}',
        ].join('\n')
      ),
      ['2:pay>transfers.create('],
      'review finding: an interpolation was masked as string'
    );
    assert.deepEqual(
      keys(
        [
          'function balanceNote(payeeName) {',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text, not a template
          '  return `${payeeName ? `${payeeName}\'s` : "the payee\'s"} balance',
          '  was too low`;',
          '}',
          'function refundNow(charge) {',
          '  return stripe.refunds.create({ charge });',
          '}',
        ].join('\n')
      ),
      ['6:refundNow>refunds.create('],
      'review finding: the apostrophe flipped template parity and masked the call'
    );
    assert.deepEqual(
      keys(
        [
          'function pay(s) {',
          "  if (s) /'/.test(s) && (await stripe.refunds.create(p));",
          '}',
        ].join('\n')
      ),
      ['2:pay>refunds.create(']
    );
  });

  test('a line continuation in a string keeps the lines below it in place', () => {
    assert.deepEqual(
      keys(
        [
          'function pay() {',
          "  const s = 'one \\",
          "two';",
          '  if (x) {',
          '    const t = `a',
          'b`;',
          '    stripe.transfers.create(p);',
          '  }',
          '}',
        ].join('\n')
      ),
      ['7:pay>transfers.create(']
    );
  });

  test('routes in the form biome writes get their own keys; a header read or a cache get names nothing', () => {
    const route = (path) => [
      'app.post(',
      `  '${path}',`,
      '  procedure({',
      "    policy: { auth: 'required' },",
      '    handler: async (ctx) => {',
      '      await stripe.refunds.create({});',
      '    },',
      '  })',
      ');',
    ];
    assert.deepEqual(
      keys(
        [...route('/refund'), ...route('/cancel')].join('\n'),
        'workers/w/src/routes/r.ts'
      ),
      [
        '6:POST /refund/handler>refunds.create(',
        '15:POST /cancel/handler>refunds.create(',
      ],
      'review finding: every route keyed as procedure/handler'
    );
    assert.deepEqual(
      keys(
        [
          'function connect(request) {',
          "  if (request.headers.get('Upgrade') !== 'websocket') {",
          '    stripe.transfers.create(p);',
          '  }',
          '}',
        ].join('\n')
      ),
      ['3:connect>transfers.create(']
    );
    assert.deepEqual(
      keys(
        [
          'function settle() {',
          "  return cache.get('payout', async () => {",
          '    return stripe.transfers.create(p);',
          '  });',
          '}',
        ].join('\n')
      ),
      ['3:settle/cache.get>transfers.create(']
    );
    assert.deepEqual(
      keys(
        [
          'function settle() {',
          "  cache.get('payout', async () => {",
          '    stripe.transfers.create(p);',
          '  });',
          '}',
        ].join('\n')
      ),
      ['3:settle/cache.get>transfers.create('],
      'review finding: a non-path literal named a route'
    );
  });

  test('a method head needs its body: a call or an arrow callback is no method', () => {
    const text = [
      'class PayoutService {',
      '  async payOut(id: string): Promise<{ transferId: string }> {',
      '    return this.db.transaction(',
      '      async (tx): Promise<void> => {',
      '        await stripe.transfers.create(p);',
      '      }',
      '    );',
      '  }',
      '  async refund(id: string, onDone: () => void): Promise<void> {',
      '    await stripe.refunds.create(p);',
      '  }',
      '  async delete(id: string) {',
      '    await stripe.refunds.create(p);',
      '  }',
      '}',
    ].join('\n');
    assert.deepEqual(keys(text), [
      '5:payOut>transfers.create(',
      '10:refund>refunds.create(',
      '13:delete>refunds.create(',
    ]);
  });

  test('RATE-LIMIT-BINDING: every alias form fails; reading a property passes', () => {
    const rule = byId('RATE-LIMIT-BINDING');
    const fires = (route) =>
      run(
        [rule],
        {
          'packages/constants/src/limits.ts': limitsTs,
          'workers/w/wrangler.jsonc': wrangler(['RATE_LIMIT_API']),
          'workers/w/src/routes.ts': route,
        },
        {}
      )
        .problems.filter((p) => p.type === 'new')
        .reduce((n, p) => n + p.found, 0);
    for (const [route, why] of [
      ["(procedure as any)({ policy: { rateLimit: 'api' } });\n", 'a cast'],
      ['const route = procedure.bind(null);\n', 'a stored bind'],
      ["procedure.call(null, { policy: { rateLimit: 'api' } });\n", 'call'],
      [
        "export { procedure as route } from '@codex/worker-utils';\n",
        'a re-export',
      ],
      [
        "import wu, { procedure as p } from '@codex/worker-utils';\n",
        'a default plus a renamed import',
      ],
      [
        "import * as wu from '@codex/worker-utils';\nconst { procedure: p } = wu;\n",
        'destructured off a namespace',
      ],
      [
        "import * as wu from '@codex/worker-utils';\nconst m = wu;\n",
        'a stored namespace',
      ],
      ['const p: typeof procedure = procedure;\n', 'a typed alias'],
      [
        "import * as $wu from '@codex/worker-utils';\n$wu['procedure']({});\n",
        'a computed member of a $ namespace',
      ],
      [
        "import * as wu from '@codex/worker-utils';\nwu?.['procedure']({});\n",
        'an optional computed member',
      ],
      [
        "procedure({ get policy() { return { rateLimit: 'streaming' }; } });\n",
        'a getter policy',
      ],
    ]) {
      assert.equal(fires(route), 1, `${why} hides its calls, so it fails`);
    }
    for (const route of [
      'const limit = policy.rateLimit;\n',
      'const preset = options.rateLimit as string;\n',
    ]) {
      assert.equal(fires(route), 0, `${route.trim()} reads a property`);
    }
  });

  test('a job header with an anchor, a tag, quotes or a comment is still a job header', () => {
    for (const head of [
      '  x: &static',
      '  x: !!map',
      '  "x":  # the gate',
      "  'x':",
    ]) {
      assert.ok(JOB_HEAD.test(head), head);
    }
    assert.ok(!JOB_HEAD.test('  x: value'), 'a scalar is no job');
  });

  test('callerPrint ignores trailing comments and a comment naming the workflow, and reads a quoted job', () => {
    const wf = '.github/workflows/static_analysis.yml';
    const caller = `on:\n  pull_request: # PRs\njobs:\n  static:\n    uses: ./${wf} # the gate\n  e2e:\n    # needs ./${wf} to pass first\n    runs-on: a\n`;
    assert.equal(
      callerPrint(caller, wf),
      callerPrint(
        caller
          .replace('# PRs', '# every PR')
          .replace('# the gate', '# the static gate'),
        wf
      )
    );
    assert.equal(
      callerPrint(caller, wf),
      callerPrint(caller.replace('runs-on: a', 'runs-on: b'), wf),
      'a comment naming the workflow pulls in no job'
    );
    const quoted = `on:\n  pull_request:\njobs:\n  "static-analysis":\n    uses: ./${wf}\n`;
    assert.notEqual(
      callerPrint(quoted, wf),
      callerPrint(`${quoted}    with:\n      skip: true\n`, wf)
    );
  });

  test('DOC-BUDGET counts the words a CLAUDE.md imports', () => {
    const rule = byId('DOC-BUDGET');
    const tree = {
      'apps/x/CLAUDE.md': 'one two @./MORE.md three, not @codex/database\n',
      'apps/x/MORE.md': 'a b c d e @./CLAUDE.md\n',
    };
    const { results } = run([rule], tree, {});
    assert.equal(
      results.get('DOC-BUDGET').perFile.get('apps/x/CLAUDE.md').found,
      6 + 6,
      'review finding: moving words into an import saved nothing they cost'
    );
  });
});

// ---------------------------------------------------------------------------
// Round 5: the spec, and a failing test for each finding (owner, 19 Nov). A
// test below that names a review finding failed before its fix.
// ---------------------------------------------------------------------------

describe('round 5: the spec, and a test for each finding', async () => {
  const { RULES } = await import('./architecture-rules.mjs');
  const { GUARANTEES } = await import('./architecture-spec.mjs');
  const byId = (id) => RULES.find((r) => r.id === id);
  const keys = (text, file = 'packages/x/src/a.ts') =>
    run([byId('A1')], { [file]: text }, {})
      .results.get('A1')
      .perFile.get(file)
      .hits.map((h) => `${h.line}:${h.key}`);

  test('every clause of the spec names tests that exist', () => {
    const source = readFileSync(
      join(HERE, 'check-architecture.test.mjs'),
      'utf8'
    );
    const titles = new Set(
      [...source.matchAll(/\btest\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)].map((m) =>
        m[2].replace(/\\(['"])/g, '$1')
      )
    );
    const ids = new Set();
    for (const clause of GUARANTEES) {
      assert.ok(!ids.has(clause.id), `${clause.id} is listed once`);
      ids.add(clause.id);
      assert.ok(clause.holds.length > 0 && clause.tests.length > 0, clause.id);
      for (const title of clause.tests) {
        assert.ok(
          titles.has(title),
          `${clause.id} cites a test that doesn't exist: "${title}"`
        );
      }
    }
  });

  test('a URL in a nested template, a comment-like template or a regex at the start of a line hides no call', () => {
    assert.deepEqual(
      keys(
        [
          'function pay(proto, host) {',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text, not a template
          "  const url = `${proto ? `https://${host}` : ''}/v1`;",
          '  return stripe.transfers.create(p);',
          '}',
        ].join('\n')
      ),
      ['3:pay>transfers.create('],
      'review finding: the comment blanker read the // in the nested template as a comment'
    );
    assert.deepEqual(
      keys(
        [
          'function pay(a) {',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text, not a template
          "  const c = `${a ? `/*` : ''}`;",
          '  return stripe.transfers.create(p);',
          '}',
        ].join('\n')
      ),
      ['3:pay>transfers.create(']
    );
    assert.deepEqual(
      keys(
        [
          'function f(s) {',
          '  if (s) {}',
          '  /`/.test(s);',
          '  stripe.transfers.create({});',
          '  return `a`;',
          '}',
        ].join('\n')
      ),
      ['4:f>transfers.create('],
      'review finding: a regex after a block opened a template'
    );
    assert.deepEqual(
      keys(
        [
          'function pay() {',
          '  const msg = `${',
          'await stripe.transfers.create(p)',
          '  }`;',
          '}',
        ].join('\n')
      ),
      ['3:pay>transfers.create('],
      'review finding: a dedented line inside an interpolation ended the walk'
    );
  });

  test('a wrapped or arrow return type still names its method, and a chained, assigned or constant route names itself', () => {
    assert.deepEqual(
      keys(
        [
          'class PurchaseService {',
          '  async processRefund(',
          '    id: string',
          '  ): Promise<',
          '    RefundResult',
          '  > {',
          '    await stripe.refunds.create(p);',
          '  }',
          '  register(s): () => void {',
          '    stripe.refunds.create(p);',
          '    return () => {};',
          '  }',
          '}',
        ].join('\n')
      ),
      ['7:processRefund>refunds.create(', '10:register>refunds.create('],
      'review finding: 29 real methods keyed as their class'
    );
    assert.deepEqual(
      keys(
        [
          'app',
          "  .post('/refund', async (c) => {",
          '    await stripe.refunds.create({});',
          '  })',
          "  .post('/payout', async (c) => {",
          '    await stripe.refunds.create({});',
          '  });',
          "export const cancel = app.post('/cancel', async (c) => {",
          '  await stripe.refunds.create({});',
          '});',
          'app.post(',
          '  CONTENT_MEDIA_READY_ROUTE,',
          '  procedure({',
          '    handler: async () => {',
          '      await stripe.refunds.create({});',
          '    },',
          '  })',
          ');',
          'function f() {',
          "  const r = api.post('/x', d).then((res) => {",
          '    stripe.refunds.create(p);',
          '  });',
          '}',
        ].join('\n'),
        'workers/w/src/routes/r.ts'
      ),
      [
        '3:POST /refund>refunds.create(',
        '6:POST /payout>refunds.create(',
        '9:POST /cancel>refunds.create(',
        '15:POST CONTENT_MEDIA_READY_ROUTE/handler>refunds.create(',
        '21:f>refunds.create(',
      ],
      'review finding: chained and assigned routes keyed as (top level)'
    );
    assert.deepEqual(
      keys(
        [
          'app.get(STATUS_ROUTE, async (c) => {',
          '  await stripe.refunds.create({});',
          '});',
        ].join('\n'),
        'workers/w/src/routes/r.ts'
      ),
      ['2:GET STATUS_ROUTE>refunds.create(']
    );
  });

  test('RATE-LIMIT-BINDING: any use but a call, a key or an import entry fails', () => {
    const rule = byId('RATE-LIMIT-BINDING');
    const fires = (route) =>
      run(
        [rule],
        {
          'packages/constants/src/limits.ts': limitsTs,
          'workers/w/wrangler.jsonc': wrangler(['RATE_LIMIT_API']),
          'workers/w/src/routes.ts': route,
        },
        {}
      )
        .problems.filter((p) => p.type === 'new')
        .reduce((n, p) => n + p.found, 0);
    for (const [route, why] of [
      ["procedure?.({ policy: { rateLimit: 'api' } });\n", 'an optional call'],
      [
        "import * as wu from '@codex/worker-utils';\nwu?.procedure({ policy: { rateLimit: 'api' } });\n",
        'an optional member',
      ],
      [
        "(procedure)({ policy: { rateLimit: 'api' } });\n",
        'a parenthesised callee',
      ],
      [
        'const route = upload ? multipartProcedure : procedure;\n',
        'a ternary alias',
      ],
      ['export const routes = configs.map(procedure);\n', 'passed as a value'],
      [
        "const { procedure: p } = await import('@codex/worker-utils');\n",
        'a dynamic import',
      ],
      ['const isProcedure = (fn) => fn === procedure;\n', 'read as a value'],
    ]) {
      assert.equal(fires(route), 1, `review finding: ${why} hid its calls`);
    }
    assert.ok(
      fires(
        [
          // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text, not a template
          "const base = `${proto ? `https://${host}` : ''}`;",
          "procedure({ policy: { auth: 'required', rateLimit: 'strict' } });",
          '',
        ].join('\n')
      ) > 0,
      'review finding: a URL in a nested template masked the route below it'
    );
    for (const route of [
      "import {\n  PaginatedResult,\n  procedure,\n} from '@codex/worker-utils';\nprocedure({ policy: { auth: 'required' } });\n",
      'interface P {\n  cache?: string;\n  rateLimit?: string;\n}\n',
      "procedure({ policy: { auth: 'required', rateLimit: 'api' } });\n",
      'const limit = policy.rateLimit;\n',
    ]) {
      assert.equal(fires(route), 0, route);
    }
  });

  test('DOC-BUDGET follows an import up two folders, into a dot-folder or without an extension, to 5 hops', () => {
    const rule = byId('DOC-BUDGET');
    const words = (tree, file) =>
      run([rule], tree, {}).results.get('DOC-BUDGET').perFile.get(file).found;
    const big = 'w '.repeat(100);
    assert.equal(
      words(
        {
          'apps/web/CLAUDE.md': 'see @../../docs/big.md\n',
          'docs/big.md': big,
        },
        'apps/web/CLAUDE.md'
      ),
      102,
      'review finding: an import two folders up counted 0'
    );
    assert.equal(
      words(
        { 'CLAUDE.md': 'see @.claude/rules.md\n', '.claude/rules.md': big },
        'CLAUDE.md'
      ),
      102,
      'review finding: an import into a dot-folder counted 0'
    );
    assert.equal(
      words(
        { 'CLAUDE.md': 'Read @README for it.\n', README: big },
        'CLAUDE.md'
      ),
      104,
      'Claude Code documents an import with no extension'
    );
    assert.equal(
      words(
        { 'CLAUDE.md': 'mail bruce@hexagon.com\n', 'hexagon.com': big },
        'CLAUDE.md'
      ),
      2,
      'an address is not an import, even where a file of that name exists'
    );
    const chain = { 'CLAUDE.md': 'a @h1.md\n' };
    for (let k = 1; k <= 6; k++) {
      chain[`h${k}.md`] = k < 6 ? `x @h${k + 1}.md\n` : 'six hops away\n';
    }
    assert.equal(
      words(chain, 'CLAUDE.md'),
      2 + 5 * 2,
      'a sixth hop is never loaded'
    );
  });

  test('a gate command the reader cannot resolve is a registry error; the forms it can are followed', () => {
    const tree = {
      'package.json': JSON.stringify({
        name: 'root',
        scripts: { a: 'node s.mjs' },
      }),
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
      'apps/web/package.json': JSON.stringify({
        name: 'web',
        scripts: {
          'check:x': 'node scripts/x.mjs',
          build: 'vite build',
          typecheck: 'tsc',
        },
      }),
      'apps/web/scripts/x.mjs': '',
      's.mjs': '',
      'scripts/run.sh': '',
      'turbo.json': '{"tasks":{"build":{},"typecheck":{}}}',
    };
    const files = Object.keys(tree);
    const parts = (command) =>
      gateDependencies([{ id: 'G', title: 't', run: command }], {
        files,
        read: (f) => tree[f] ?? null,
      });
    const labels = (command) => parts(command).map((p) => p.label);
    const unreadable = (command) =>
      parts(command)
        .filter((p) => !files.includes(p.file))
        .map((p) => p.label);
    for (const command of [
      'pnpm --filter web run check:x',
      'pnpm -F web run check:x',
      'pnpm --filter=web run check:x',
      'pnpm --filter web check:x',
      'pnpm --filter web run check:x -- --ci',
    ]) {
      assert.ok(
        labels(command).includes('apps/web/scripts/x.mjs'),
        `review finding: ${command} was dropped silently`
      );
      assert.deepEqual(unreadable(command), [], command);
    }
    for (const [command, file] of [
      ['FOO=1 node s.mjs', 's.mjs'],
      ['node --test "s.mjs"', 's.mjs'],
      ['bash scripts/run.sh', 'scripts/run.sh'],
      ['./scripts/run.sh --fast', 'scripts/run.sh'],
    ]) {
      assert.ok(labels(command).includes(file), `${command} runs ${file}`);
    }
    const both = labels('turbo run build typecheck');
    for (const task of ['build', 'typecheck']) {
      assert.ok(
        both.includes(`apps/web/package.json#scripts.${task}`),
        `review finding: every turbo task after the first was dropped (${task})`
      );
    }
    for (const command of [
      'pnpm --filter nope run check:x',
      'pnpm -r run check:x',
      'node --test',
      'pnpm dlx some-tool',
      'npx some-tool',
    ]) {
      assert.ok(
        unreadable(command).length > 0,
        `review finding: ${command} fingerprinted nothing and said nothing`
      );
    }
    for (const command of [
      'node -e 0',
      'biome check .',
      'pnpm install --frozen-lockfile',
      'pnpm --filter web exec paraglide-js compile --outdir ./src/x',
    ]) {
      assert.deepEqual(unreadable(command), [], `${command} needs no file`);
    }
    const script = parts('pnpm a').find(
      (p) => p.label === 'package.json#scripts.a'
    );
    assert.equal(
      script.changed('{ "scripts": {"a": "x"} ', '{ "scripts": {"a": "y"} '),
      true,
      'review finding: a file that does not parse read as unchanged whatever changed in it'
    );
  });

  test('a pin hashes in canonical order, a path with a space can be signed, and every exception a hash covers is listed', () => {
    const item = (now) =>
      raiseItem(
        { ruleId: 'A1', file: 'a.ts', was: [], now, newRule: false },
        {}
      );
    assert.equal(
      item(['b>x(', 'a>x(']).state,
      item(['a>x(', 'b>x(']).state,
      'review finding: --lower re-sorting a pin voided its countersign'
    );
    assert.equal(
      hashOf({ inputs: ['a'], cache: true }),
      hashOf({ cache: true, inputs: ['a'] }),
      'reordering a config object signs nothing away'
    );
    assert.ok(
      parseCountersigns(
        'G0-RAISE: DOC-BUDGET docs/My Notes.md@abcd1234 — the intro grows until D12'
      ).has('DOC-BUDGET docs/My Notes.md@abcd1234'),
      'review finding: the gate printed a line its own parser rejects'
    );
    assert.deepEqual(
      uncovered(
        [
          {
            key: 'A1 a.ts',
            state: '11111111',
            star: null,
            what: ['a.ts:1: one'],
          },
          {
            key: 'A1 a.ts',
            state: '11111111',
            star: null,
            what: ['a.ts:4: two'],
          },
        ],
        new Set()
      ),
      [
        {
          line: 'G0-RAISE: A1 a.ts@11111111 — <why>',
          what: ['a.ts:1: one', 'a.ts:4: two'],
        },
      ]
    );
  });
});

// ---------------------------------------------------------------------------
// Round 6 (owner, 23 Nov): a failing test for each finding against the spec.
// A test below that names a review finding failed before its fix.
// ---------------------------------------------------------------------------
describe('round 6: a test for each finding', async () => {
  const { RULES } = await import('./architecture-rules.mjs');
  const { gateDependencies, hashOf } = await import(
    './architecture-raises.mjs'
  );
  const byId = (id) => RULES.find((r) => r.id === id);
  const keys = (text, file = 'packages/x/src/a.ts') =>
    run([byId('A1')], { [file]: text }, {})
      .results.get('A1')
      .perFile.get(file)
      .hits.map((h) => `${h.line}:${h.key}`);
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  const partsOf = (gates, tree) =>
    gateDependencies(gates, {
      files: Object.keys(tree),
      read: (f) => tree[f] ?? null,
    });
  const labels = (gates, tree) => partsOf(gates, tree).map((p) => p.label);
  const unreadable = (gates, tree) =>
    partsOf(gates, tree)
      .filter((p) => p.file.startsWith('\0'))
      .map((p) => p.label);

  test('A1 sees an optional call and a regex after a brace-less if', () => {
    assert.deepEqual(
      keys(
        [
          'export function pay(s: string) {',
          '  if (s) /`/.exec(s);',
          '  return stripe.transfers.create(p);',
          '}',
        ].join('\n')
      ),
      ['3:pay>transfers.create('],
      'review finding: the backtick in the regex opened a template that hid the call'
    );
    assert.deepEqual(
      keys(
        [
          'function pay() {',
          '  return stripe.transfers.create?.(p);',
          '}',
        ].join('\n')
      ),
      ['2:pay>transfers.create?.(']
    );
  });

  test('a key names a one-line arrow, a #private method, a parenthesised value and functionsOf(); routes are read only in a worker', () => {
    assert.deepEqual(
      keys(
        [
          'export const payCreator = (p: Params) => stripe.transfers.create(p);',
          'export const payOrg = (p: Params) => stripe.transfers.create(p);',
        ].join('\n')
      ),
      ['1:payCreator>transfers.create(', '2:payOrg>transfers.create('],
      'review finding: two one-line arrows shared the key (top level)'
    );
    assert.deepEqual(
      keys(
        [
          'export class PayoutService {',
          '  async #payCreator(id: string) {',
          '    await this.stripe.transfers.create({ id });',
          '  }',
          '',
          '  #payOrg = async (id: string) => {',
          '    await this.stripe.transfers.create({ id });',
          '  };',
          '}',
        ].join('\n')
      ),
      ['3:#payCreator>transfers.create(', '7:#payOrg>transfers.create('],
      'review finding: every private method was keyed as its class'
    );
    assert.deepEqual(
      keys(
        [
          'export async function payCreators(deps: Deps) {',
          '  const paid = (await deps.pending()).map((row) =>',
          '    stripe.transfers.create(row)',
          '  );',
          '}',
          'export function payOrgs(list: Row[]) {',
          '  for (const row of functionsOf(list)) {',
          '    stripe.transfers.create(row);',
          '  }',
          '}',
        ].join('\n')
      ),
      ['3:payCreators>transfers.create(', '8:payOrgs>transfers.create('],
      'review finding: `= (` read as an arrow, and functionsOf( as `function sOf(`'
    );
    assert.deepEqual(
      keys(
        [
          'export class PayoutService {',
          '  async payCreator(id: string) {',
          '    this.cache.get(PAYOUT_KEY, async () => {',
          '      await stripe.transfers.create({ id });',
          '    });',
          '  }',
          '',
          '  async payOrg(id: string) {',
          '    await api',
          "      .post('/payouts', {",
          '        json: await stripe.transfers.create({ id }),',
          '      })',
          '      .json();',
          '  }',
          '}',
        ].join('\n')
      ),
      [
        '4:payCreator/this.cache.get>transfers.create(',
        '11:payOrg>transfers.create(',
      ],
      'review finding (a round-5 regression): calls in a service read as routes'
    );
    assert.deepEqual(
      keys(
        [
          'app',
          "  .post('/refund', async (c) => {",
          '    await stripe.refunds.create({});',
          '  });',
        ].join('\n'),
        'workers/w/src/routes/r.ts'
      ),
      ['3:POST /refund>refunds.create(']
    );
    assert.deepEqual(
      keys(
        [
          'export class PayoutService {',
          '  async payCreator(id: string) {',
          '    this.cache.get(PAYOUT_KEY, async () => {',
          '      await stripe.transfers.create({ id });',
          '    });',
          '  }',
          '  async payOrg(id: string) {',
          '    this.cache.get(PAYOUT_KEY, async () => {',
          '      await stripe.transfers.create({ id });',
          '    });',
          '  }',
          '}',
        ].join('\n'),
        'workers/w/src/services/payouts.ts'
      ),
      [
        '4:payCreator/this.cache.get>transfers.create(',
        '9:payOrg/this.cache.get>transfers.create(',
      ],
      'a property chain is no router, even in a worker'
    );
  });

  test('RATE-LIMIT-BINDING: a key is judged by the code before it, and a computed or template import is unreadable', () => {
    const limitsTs = [
      'export const RATE_LIMIT_PRESETS = {',
      '  STRICT: {',
      "    store: 'binding',",
      "    bindingName: 'RATE_LIMIT_STRICT',",
      '  },',
      '  API: {',
      "    store: 'binding',",
      "    bindingName: 'RATE_LIMIT_API',",
      '  },',
      '} as const;',
      '',
    ].join('\n');
    const wrangler = JSON.stringify({
      name: 'w',
      ratelimits: [{ name: 'RATE_LIMIT_API', namespace_id: '1' }],
    });
    const fires = (route) =>
      run(
        [byId('RATE-LIMIT-BINDING')],
        {
          'packages/constants/src/limits.ts': limitsTs,
          'workers/w/wrangler.jsonc': wrangler,
          'workers/w/src/routes.ts': route,
        },
        {}
      ).problems.filter((p) => p.type === 'new').length;
    const strict = [
      '',
      'export const remove = route({',
      "  policy: { auth: 'required', rateLimit: 'strict' },",
      '});',
    ];
    assert.ok(
      fires(
        [
          'const route = destructive',
          `  ? // ${'a long comment that fills the window before the name '.repeat(2)}`,
          '    procedure',
          '  : (options: Options) => options;',
          ...strict,
        ].join('\n')
      ) > 0,
      'review finding: a comment before a ternary alias made it read as a key'
    );
    for (const head of [
      'const { procedure: route } = await import(`@codex/worker-utils`);',
      'const { procedure: route } = require(`@codex/worker-utils`);',
      'const { procedure: route } = await import(MODULE);',
    ]) {
      assert.ok(
        fires([head, ...strict].join('\n')) > 0,
        `review finding: ${head} brought the limiter in unread`
      );
    }
    assert.equal(
      fires(
        [
          "type KV = import('@cloudflare/workers-types').KVNamespace;",
          "import { procedure } from '@codex/worker-utils';",
          "export const list = procedure({ policy: { rateLimit: 'api' } });",
        ].join('\n')
      ),
      0,
      'a quoted import of another module is read'
    );
  });

  test('DOC-BUDGET reads imports as Claude Code does: route characters, emphasis, a full stop and a parenthesis', () => {
    const big = 'w '.repeat(100);
    const words = (md, target) =>
      run(
        [byId('DOC-BUDGET')],
        { 'apps/web/CLAUDE.md': md, [`apps/web/${target}`]: big },
        {}
      )
        .results.get('DOC-BUDGET')
        .perFile.get('apps/web/CLAUDE.md').found;
    for (const path of [
      'src/routes/(platform)/+layout.svelte',
      'src/routes/_org/[slug]/studio/+layout.ts',
    ]) {
      assert.equal(
        words(`see @${path}\n`, path),
        102,
        `review finding: @${path} was cut at a route character`
      );
    }
    const rules = 'docs/rules.md';
    assert.equal(
      words('_Also read @docs/rules.md_\n', rules),
      103,
      'review finding: an import inside emphasis was not counted'
    );
    assert.equal(words('**@docs/rules.md**\n', rules), 101);
    assert.equal(words('see [the @docs/rules.md](x)\n', rules), 103);
    assert.equal(
      words('Read @docs/rules.md. Then go.\n', rules),
      4,
      'Claude Code reads `docs/rules.md.`, which is no file'
    );
    assert.equal(
      words('Rules (@docs/rules.md) apply.\n', rules),
      3,
      'an @ after a parenthesis is no import to Claude Code'
    );
    assert.equal(
      words('<!-- @docs/rules.md -->\n`@docs/rules.md`\n', rules),
      4,
      'a comment and a code span import nothing'
    );
  });

  test("the command reader follows tsx, wrappers, preloads and pnpm's exec fallback; anything else is a registry error", () => {
    const tree = {
      'package.json': json({
        name: 'root',
        scripts: {
          'check:x': 'pnpm exec tsx scripts/x.ts',
          'check:y': 'dotenv -e .env.ci -- node scripts/y.mjs',
          'check:z': './scripts/z.mjs',
          list: 'node scripts/w.mjs',
        },
      }),
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
      'apps/web/package.json': json({ name: 'web', scripts: {} }),
      'apps/web/scripts/v.mjs': '',
      'scripts/x.ts': '',
      'scripts/y.mjs': '',
      'scripts/z.mjs': "import './z-lib.mjs';\n",
      'scripts/z-lib.mjs': '',
      'scripts/setup.mjs': '',
      'scripts/w.mjs': '',
    };
    const parts = (command) => labels([{ id: 'G', run: command }], tree);
    const reads = (command) => unreadable([{ id: 'G', run: command }], tree);
    for (const [command, part, why] of [
      ['pnpm check:x', 'scripts/x.ts', 'tsx swallowed the file it runs'],
      ['pnpm check:y', 'scripts/y.mjs', 'dotenv … -- swallowed it'],
      [
        'pnpm check:z',
        'scripts/z-lib.mjs',
        "a ./file.mjs's imports were not followed",
      ],
      [
        'env FOO=1 cross-env BAR=2 node scripts/w.mjs',
        'scripts/w.mjs',
        'an env wrapper swallowed it',
      ],
      [
        'node --import ./scripts/setup.mjs scripts/w.mjs',
        'scripts/setup.mjs',
        'a preload was no part',
      ],
      [
        'NODE_OPTIONS=--max-old-space-size=8192 node scripts/w.mjs',
        'scripts/w.mjs',
        'a memory flag preloads nothing',
      ],
      [
        'pnpm --filter web node scripts/v.mjs',
        'apps/web/scripts/v.mjs',
        "pnpm's exec fallback was read as an absent script",
      ],
      [
        'pnpm --filter web node scripts/v.mjs',
        'apps/web/package.json#scripts.node',
        'the absent script is a part: adding it changes what runs',
      ],
    ]) {
      assert.ok(
        parts(command).includes(part),
        `review finding: ${why} (${command})`
      );
    }
    for (const command of [
      'vitest run scripts/w.test.mjs',
      'npx tsc',
      'concurrently "node scripts/w.mjs"',
      'pnpm audit --prod',
      // pnpm runs its own `list`, never the package's script of that name
      'pnpm list',
      'dotenv -e .env node scripts/w.mjs',
      'NODE_OPTIONS="--require ./scripts/setup.mjs" node scripts/w.mjs',
      'env -i node scripts/w.mjs',
    ]) {
      assert.ok(
        reads(command).length > 0,
        `review finding: ${command} read as nothing to follow`
      );
    }
    assert.deepEqual(
      reads('tsc --noEmit && biome check . && vite build'),
      [],
      'the leaf binaries the gates reach'
    );
  });

  test('pnpm-workspace.yaml is read in every YAML form, and a manifest the gate cannot parse is a registry error', () => {
    const tree = {
      'package.json': json({
        name: 'root',
        scripts: { typecheck: 'turbo run typecheck' },
      }),
      'turbo.json': json({ tasks: { typecheck: {} } }),
      'packages/p/package.json': json({
        name: '@x/p',
        scripts: { typecheck: 'tsc -p .' },
      }),
    };
    const gates = [{ id: 'TYPECHECK', run: 'pnpm typecheck' }];
    const script = 'packages/p/package.json#scripts.typecheck';
    for (const yaml of [
      'packages:\n  - packages/*\n',
      "packages:\n- 'packages/*'\n",
      "packages: ['packages/*']\n",
      "'packages':\n  - packages/*\n",
    ]) {
      assert.ok(
        labels(gates, { ...tree, 'pnpm-workspace.yaml': yaml }).includes(
          script
        ),
        `review finding: ${JSON.stringify(yaml)} read as no packages`
      );
    }
    for (const yaml of [
      'packages: *globs\n',
      "packages:\n  - '!**/test/**'\n",
      'packages: packages/*\n',
    ]) {
      assert.ok(
        unreadable(gates, { ...tree, 'pnpm-workspace.yaml': yaml }).some((l) =>
          l.startsWith('pnpm-workspace.yaml')
        ),
        `${JSON.stringify(yaml)} is a registry error, never an empty workspace`
      );
    }
    const yaml = { 'pnpm-workspace.yaml': 'packages:\n  - packages/*\n' };
    const bom = `﻿${tree['packages/p/package.json']}`;
    assert.ok(
      labels(gates, {
        ...tree,
        ...yaml,
        'packages/p/package.json': bom,
      }).includes(script),
      'review finding: a BOM hid every script of the manifest'
    );
    assert.ok(
      unreadable(gates, {
        ...tree,
        ...yaml,
        'packages/p/package.json': '{ "name": "@x/p", ',
      }).some((l) => l.startsWith('packages/p/package.json')),
      'review finding: a manifest the gate derives parts from must parse'
    );
  });

  test("every task typecheck reaches counts in every package; the workspace script settings and a Biome config's local extends are gate parts", () => {
    const tree = {
      'package.json': json({
        name: 'root',
        scripts: { typecheck: 'turbo run typecheck' },
      }),
      'pnpm-workspace.yaml':
        'packages:\n  - packages/*\nscriptShell: /bin/bash\n',
      'turbo.json': json({
        tasks: { typecheck: { dependsOn: ['^build'] }, build: {} },
      }),
      'packages/p/package.json': json({
        name: '@x/p',
        scripts: {
          typecheck: 'tsc -p .',
          build: 'node build.mjs',
          gen: 'node gen.mjs',
        },
      }),
      'packages/p/build.mjs': '',
      'packages/p/gen.mjs': '',
      'packages/p/turbo.json': json({
        extends: ['//'],
        tasks: { typecheck: { dependsOn: ['^build', 'gen'] } },
      }),
      'biome.json': json({
        extends: ['./config/biome/strict.json', '@org/preset'],
      }),
      'config/biome/strict.json': json({ linter: {} }),
    };
    const gates = [
      { id: 'TYPECHECK', run: 'pnpm typecheck' },
      { id: 'BIOME', run: 'biome check .', files: ['biome.json'] },
    ];
    const parts = partsOf(gates, tree);
    const found = parts.map((p) => p.label);
    for (const [part, why] of [
      [
        'packages/p/turbo.json#tasks.gen',
        "review finding: a package turbo.json's own dependsOn was not followed",
      ],
      [
        'packages/p/package.json#scripts.gen',
        'the script of a task typecheck reaches',
      ],
      ['packages/p/gen.mjs', 'what that script runs'],
      [
        'packages/p/package.json#scripts.build',
        'owner, 23 Nov: build scripts count',
      ],
      ['packages/p/build.mjs', 'what the build script runs'],
      [
        'pnpm-workspace.yaml#settings',
        'owner, 23 Nov: scriptShell switches every script',
      ],
      [
        'config/biome/strict.json',
        'owner, 23 Nov: a local extends decides what lint enforces',
      ],
    ]) {
      assert.ok(found.includes(part), `${part}: ${why}`);
    }
    assert.ok(
      !found.some((l) => l.includes('@org')),
      'a package preset stays outside'
    );
    const part = (label) => parts.find((p) => p.label === label);
    const settings = part('pnpm-workspace.yaml#settings');
    assert.equal(settings.changed('', 'scriptShell: /usr/bin/true\n'), true);
    assert.equal(
      settings.changed(
        'packages:\n  - a/*\n',
        'packages:\n  - a/*\npatchedDependencies: {}\n'
      ),
      false,
      'another key of pnpm-workspace.yaml stays outside'
    );
    const biome = part('biome.json');
    assert.equal(
      biome.changed('{ "a": 1, "b": 2 }', '{ "b": 2, "a": 1 }'),
      false,
      'review finding: a re-sorted biome.json asked again'
    );
    assert.equal(
      hashOf(biome.state('{ "a": 1, "b": 2 }')),
      hashOf(biome.state('{\n  "b": 2,\n  "a": 1\n}')),
      'a whole JSON part hashes in canonical form'
    );
  });
});
