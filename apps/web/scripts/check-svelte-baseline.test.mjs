/**
 * Tests for the svelte-check baseline gate (Codex-3ckzk).
 *
 * node:test, like the other gate scripts: the thing under test is a plain
 * .mjs CLI. Every case feeds a hand-written machine-verbose log through
 * `--input`, so svelte-check itself never runs here; the CI step runs it.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';

import {
  codeKey,
  countErrors,
  parseMachineVerbose,
  readBaseline,
  run,
} from './check-svelte-baseline.mjs';

const GATE = fileURLToPath(
  new URL('./check-svelte-baseline.mjs', import.meta.url)
);
const REAL_BASELINE = fileURLToPath(
  new URL('./svelte-check-baseline.json', import.meta.url)
);

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'svelte-baseline-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const diag = (
  type,
  filename,
  code,
  line = 0,
  message = `${type} ${code}`,
  source = 'ts'
) =>
  `1 ${JSON.stringify({ type, filename, start: { line, character: 4 }, end: { line, character: 9 }, message, code, source })}`;

/** A machine-verbose log: START, the diagnostics, and a COMPLETED line that agrees with them. */
function log(lines, { files = 10, errors, warnings } = {}) {
  const e = errors ?? lines.filter((l) => l.includes('"type":"ERROR"')).length;
  const w =
    warnings ?? lines.filter((l) => l.includes('"type":"WARNING"')).length;
  return [
    '1 START "/web"',
    ...lines,
    `2 COMPLETED ${files} FILES ${e} ERRORS ${w} WARNINGS 1 FILES_WITH_PROBLEMS`,
    '',
  ].join('\n');
}

/** Runs the CLI on a log and a baseline in the temp dir; returns its exit code and what it printed. */
function check(logText, baseline, extra = []) {
  const input = join(dir, 'log.txt');
  const base = join(dir, 'baseline.json');
  writeFileSync(input, logText);
  writeFileSync(base, `${JSON.stringify({ errors: baseline }, null, 2)}\n`);
  const out = [];
  const err = [];
  const code = run(['--input', input, '--baseline', base, ...extra], {
    log: (s) => out.push(s),
    error: (s) => err.push(s),
  });
  const raw = readFileSync(base, 'utf8');
  return {
    code,
    out: out.join('\n'),
    err: err.join('\n'),
    raw,
    baseline: JSON.parse(raw).errors,
  };
}

const KNOWN = [
  diag('ERROR', 'src/A.svelte', 2322, 3),
  diag('ERROR', 'src/A.svelte', 2322, 9),
  diag('ERROR', 'src/B.svelte', 2339),
];
const KNOWN_COUNTS = {
  'src/A.svelte': { TS2322: 2 },
  'src/B.svelte': { TS2339: 1 },
};

test('PASSES when every error is in the baseline, and ignores warnings', () => {
  // A leading `--` is what `pnpm run <script> -- --prune` can hand on.
  const result = check(
    log([
      ...KNOWN,
      diag('WARNING', 'src/C.svelte', 'a11y_label', 1, 'w', 'svelte'),
    ]),
    KNOWN_COUNTS,
    ['--']
  );

  assert.equal(result.code, 0, result.err);
  assert.match(
    result.out,
    /^OK: svelte-check found 3 error\(s\) in 2 file\(s\), all in the baseline \(10 files checked, 1 warning\(s\) not baselined\)\.$/
  );
});

test('FAILS on a new error: one more of a listed code, a new code, a new file', () => {
  const result = check(
    log([
      ...KNOWN,
      diag('ERROR', 'src/A.svelte', 2322, 20, 'Type x is not assignable'),
      diag('ERROR', 'src/B.svelte', 2345),
      diag('ERROR', 'src/D.svelte', 2304),
    ]),
    KNOWN_COUNTS
  );

  assert.equal(result.code, 1);
  assert.match(result.err, /Fix them; the baseline only shrinks/);
  assert.match(result.err, /src\/A\.svelte TS2322: 3 found, 2 in the baseline/);
  assert.match(result.err, /src\/A\.svelte:21:5 Type x is not assignable/);
  assert.match(result.err, /src\/B\.svelte TS2345: 1 found, 0 in the baseline/);
  assert.match(result.err, /src\/D\.svelte TS2304: 1 found, 0 in the baseline/);
  assert.doesNotMatch(result.err, /src\/B\.svelte TS2339/);
});

test('FAILS on a stale entry, and --prune lowers or removes only the stale ones', () => {
  // Out of order on purpose: --prune writes the baseline sorted.
  const baseline = {
    'src/Gone.svelte': { TS2551: 2 },
    'src/B.svelte': { TS2339: 1 },
    'src/A.svelte': { TS2322: 3 },
  };
  const stale = check(log(KNOWN), baseline);

  assert.equal(stale.code, 1);
  assert.match(stale.err, /stale: the errors are fixed\. Run with --prune/);
  assert.match(stale.err, /src\/A\.svelte TS2322: 3 in the baseline, 2 found/);
  assert.match(
    stale.err,
    /src\/Gone\.svelte TS2551: 2 in the baseline, 0 found/
  );
  assert.deepEqual(stale.baseline, baseline, 'a plain run writes nothing');

  const pruned = check(log(KNOWN), baseline, ['--prune']);
  assert.equal(pruned.code, 0, pruned.err);
  assert.equal(
    pruned.raw,
    `${JSON.stringify({ errors: KNOWN_COUNTS }, null, 2)}\n`
  );
  assert.match(pruned.out, /pruned src\/A\.svelte TS2322: 3 -> 2/);
  assert.match(pruned.out, /pruned src\/Gone\.svelte TS2551: 2 -> 0/);
});

test('--prune never adds: a new error still fails and stays out of the baseline', () => {
  const result = check(
    log([...KNOWN, diag('ERROR', 'src/D.svelte', 2304)]),
    { ...KNOWN_COUNTS, 'src/B.svelte': { TS2339: 2 } },
    ['--prune']
  );

  assert.equal(result.code, 1);
  assert.deepEqual(result.baseline, KNOWN_COUNTS);
  assert.match(result.err, /src\/D\.svelte TS2304: 1 found, 0 in the baseline/);
});

test('FAILS CLOSED on output it cannot trust: no COMPLETED line, 0 files, a total that disagrees, a bad line', () => {
  const cases = {
    unfinished: ['1 START "/web"', ...KNOWN].join('\n'),
    'no files': log([], { files: 0 }),
    'total disagrees': log(KNOWN, { errors: 4 }),
    'unreadable diagnostic': log([...KNOWN, '1 {"type":"ERROR",']),
    'unknown line': log([...KNOWN, 'Getting Svelte diagnostics...']),
  };
  const messages = {
    unfinished: /printed no COMPLETED line/,
    'no files': /checked 0 files/,
    'total disagrees': /reported 4 error\(s\) but printed 3/,
    'unreadable diagnostic': /unreadable diagnostic line/,
    'unknown line':
      /unexpected svelte-check output: Getting Svelte diagnostics/,
  };
  for (const [name, text] of Object.entries(cases)) {
    const result = check(text, KNOWN_COUNTS);
    assert.equal(result.code, 1, name);
    assert.match(result.err, messages[name], name);
  }
});

test('keys a TypeScript code as TS<n> and any other as source/code', () => {
  assert.equal(codeKey({ code: 2322, source: 'ts' }), 'TS2322');
  // svelte-check omits `source` on a .ts file's diagnostic.
  assert.equal(codeKey({ code: 2741 }), 'TS2741');
  assert.equal(
    codeKey({ code: 'missing-declaration', source: 'svelte' }),
    'svelte/missing-declaration'
  );
  const { errors } = parseMachineVerbose(
    log([
      ...KNOWN,
      diag('ERROR', 'src/E.svelte', 'missing-declaration', 0, 'm', 'svelte'),
    ])
  );
  assert.deepEqual(countErrors(errors), {
    ...KNOWN_COUNTS,
    'src/E.svelte': { 'svelte/missing-declaration': 1 },
  });
});

test('REJECTS a baseline that is not counts of 1 or more', () => {
  const path = join(dir, 'bad.json');
  for (const [body, message] of [
    ['{}', /has no "errors" object/],
    [
      '{"errors":{"src/A.svelte":{"TS2322":0}}}',
      /must be a count of 1 or more, not 0/,
    ],
    [
      '{"errors":{"src/A.svelte":{"TS2322":1.5}}}',
      /must be a count of 1 or more, not 1\.5/,
    ],
  ]) {
    writeFileSync(path, body);
    assert.throws(() => readBaseline(path), message);
  }
});

test('the committed baseline reads, and is written in the order --prune writes it', () => {
  const errors = readBaseline(REAL_BASELINE);
  const files = Object.keys(errors);
  assert.deepEqual(files, [...files].sort());
  for (const file of files)
    assert.deepEqual(
      Object.keys(errors[file]),
      Object.keys(errors[file]).sort(),
      file
    );
  assert.equal(
    readFileSync(REAL_BASELINE, 'utf8'),
    `${JSON.stringify({ errors }, null, 2)}\n`
  );
});

test('RUNS when started through a symlink (Codex-noyrq)', () => {
  const input = join(dir, 'log.txt');
  const base = join(dir, 'baseline.json');
  writeFileSync(input, log(KNOWN));
  writeFileSync(base, JSON.stringify({ errors: KNOWN_COUNTS }));
  const link = join(dir, 'linked-gate.mjs');
  symlinkSync(GATE, link);

  const result = spawnSync(
    process.execPath,
    [link, '--input', input, '--baseline', base],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^OK: svelte-check found 3 error/);
});
