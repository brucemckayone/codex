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
  missingCountersigns,
  parseCountersigns,
  raisedEntries,
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
  const LOCAL = { GITHUB_EVENT_NAME: '', GITHUB_EVENT_PATH: '' };
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
    assert.match(r.stdout, /G0-RAISE: T2 \* —/);
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
      /\n {4}G0-RAISE: T1 src\/pinned\.ts — <why>\n/
    );
    assert.match(
      unsigned.stderr,
      /\n {8}T1 src\/pinned\.ts: allows "\(top level\)>forbidden\(" more\n/
    );
    sh([
      'commit',
      '-q',
      '--amend',
      '-m',
      'raise\n\nG0-RAISE: T1 src/pinned.ts — ok',
    ]);
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
    assert.match(r.stderr, /G0-RAISE: T1 src\/a\.ts — <why>/);
    assert.match(
      r.stderr,
      /G0-RAISE: GATE scripts\/checks\/check-architecture\.mjs — <why>/
    );
    sh([
      'commit',
      '-q',
      '--amend',
      '-m',
      'loosen\n\nG0-RAISE: T1 src/a.ts — the drain moves next week\nG0-RAISE: GATE scripts/checks/check-architecture.mjs — the stand-in changes shape',
    ]);
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
    assert.match(
      cli('--gates', '--skip', 'OK,BAD').stdout,
      /0 CI static gate\(s\) passed/,
      'a skipped gate is not counted as passed'
    );
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

  test('--staged refuses while the gate itself has unstaged edits', () => {
    setUp();
    initAndCommit();
    write(GATE_STAND_IN, '// edited, not staged\n');
    const r = cli('--staged');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unstaged or untracked edits/);
  });

  // ---- round 2 review fixes -------------------------------------------

  test('a copied exception, or one moved onto another violation, needs a countersign', () => {
    setUp();
    initAndCommit();
    const dir = `// ${IGNORE} T1 until=2026-12-01 by=bruce — the drain moves next\n`;
    write('src/a.ts', `${dir}forbidden(one);\n`);
    sh(['add', '.']);
    sh([
      'commit',
      '-qm',
      'one\n\nG0-RAISE: T1 src/a.ts — the drain moves next week',
    ]);
    const signedBase = head();
    assert.equal(
      cli('--raises', `${head()}~1`).status,
      0,
      'the first one is signed'
    );
    write('src/a.ts', `${dir}forbidden(one);\n${dir}forbidden(two);\n`);
    commit('copy it');
    const copied = cli('--raises', signedBase);
    assert.equal(
      copied.status,
      1,
      'review finding: a copy matched the original'
    );
    assert.match(copied.stderr, /G0-RAISE: T1 src\/a\.ts — <why>/);
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
      /! git commit --allow-empty -m 'G0 countersign' -m 'G0-RAISE: T1 src\/pinned\.ts — <why>'/
    );
    sh([
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'owner\n\nG0-RAISE: T1 src/pinned.ts — hotfix first, extracted next',
    ]);
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
      /G0-RAISE: GATE package\.json#scripts\.check:x — <why>/
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

  test('a new block for a new rule can be signed as a whole', () => {
    const raised = raisedEntries(rules, {}, { T1: { 'src/a.ts': [K] } });
    assert.equal(raised[0].newRule, true);
    const signed = parseCountersigns(
      'G0-RAISE: T1 * — the rule arrives with its debt\n'
    );
    assert.deepEqual(
      missingCountersigns({ raised, exceptions: [], gateChanges: [], signed }),
      []
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
    const raised = raisedEntries(rules, before, {
      T1: { 'src/a.ts': [K, K, K], 'src/c.ts': [K] },
    });
    const missing = missingCountersigns({
      raised,
      exceptions: [{ file: 'src/d.ts', ruleId: 'T1', line: 4 }],
      gateChanges: ['scripts/checks/architecture-rules.mjs'],
      signed: parseCountersigns(
        'G0-RAISE: T1 src/a.ts — the hotfix lands first\n'
      ),
    });
    assert.deepEqual(
      missing.map((m) => m.line),
      [
        'G0-RAISE: T1 src/c.ts — <why>',
        'G0-RAISE: T1 src/d.ts — <why>',
        'G0-RAISE: GATE scripts/checks/architecture-rules.mjs — <why>',
      ]
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
    assert.deepEqual(
      missingCountersigns({
        raised,
        exceptions: [],
        gateChanges: [],
        signed: parseCountersigns(
          'G0-RAISE: T1 * — the rule arrives with its debt\n'
        ),
      }).map((m) => m.line),
      ['G0-RAISE: T1 src/a.ts — <why>']
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
