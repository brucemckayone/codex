#!/usr/bin/env node
/**
 * svelte-check against a committed baseline (Codex-3ckzk).
 *
 * CI's web typecheck is `svelte-kit sync && tsc --noEmit`, and tsc never reads
 * a .svelte file. So a type error inside a component, or a type-level guard
 * written for its consumers (Dialog.Content's CssLength-typed maxHeight, the
 * Popover's required name), was enforced only in an editor. svelte-check
 * reads them, but the tree carries a standing set of errors, so a plain
 * `svelte-check` step would fail on day one.
 *
 * This runs svelte-check ONCE (`--output machine-verbose`, the machine form
 * that carries each diagnostic's code), counts its ERRORs by (file, code), and
 * compares the counts with svelte-check-baseline.json beside this script:
 *   - a count above its baseline (or a key the baseline lacks) is a NEW error,
 *     and fails, listing svelte-check's own messages for that key;
 *   - a count below its baseline is STALE, and fails too, so a fixed error
 *     can't leave headroom for a new one. The baseline only shrinks, the way
 *     the dialog gate's allowlist pins each entry's `expect`.
 * Lines are not part of the key, so editing a file with a known error doesn't
 * churn the baseline. Warnings are not baselined (svelte-check's own exit code
 * ignores them too).
 *
 * It fails closed: svelte-check that crashes, prints no COMPLETED line,
 * checks no file, or reports a different error total from the lines it
 * printed, fails rather than passing on nothing.
 *
 * Shrinking it: fix the error, then run
 *   pnpm --filter web run check:svelte-baseline --prune
 * which lowers (or removes) the stale entries and writes nothing else. Never
 * add an entry by hand to get past a new error; fix the error. The one honest
 * reason to raise the baseline is a svelte-check or TypeScript upgrade that
 * reports existing code differently, and that change shows in the JSON diff.
 *
 * Usage (from apps/web, after `svelte-kit sync` and the paraglide compile):
 *   node scripts/check-svelte-baseline.mjs [--prune] [--input <log>] [--baseline <json>]
 *     --input     read a saved machine-verbose log instead of running svelte-check
 *     --baseline  compare with another baseline file (the self-test uses this)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_BASELINE = fileURLToPath(
  new URL('./svelte-check-baseline.json', import.meta.url)
);

/** A diagnostic's code as a key: `TS2322` for TypeScript, `<source>/<code>` otherwise. */
export function codeKey(diagnostic) {
  const { code, source } = diagnostic;
  if (typeof code === 'number') return `TS${code}`;
  return `${source ?? 'unknown'}/${code ?? 'none'}`;
}

/**
 * svelte-check's machine-verbose output: `<time> START "<dir>"`, one
 * `<time> {json}` line per diagnostic, and `<time> COMPLETED <n> FILES <n>
 * ERRORS <n> WARNINGS <n> FILES_WITH_PROBLEMS`. Any other line is a failure.
 */
export function parseMachineVerbose(text) {
  const errors = [];
  const problems = [];
  let completed = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const rest = line.replace(/^\d+ /, '');
    if (rest.startsWith('START ')) continue;
    const done = rest.match(
      /^COMPLETED (\d+) FILES (\d+) ERRORS (\d+) WARNINGS (\d+) FILES_WITH_PROBLEMS$/
    );
    if (done) {
      completed = {
        files: Number(done[1]),
        errors: Number(done[2]),
        warnings: Number(done[3]),
      };
      continue;
    }
    if (rest.startsWith('{')) {
      let diagnostic;
      try {
        diagnostic = JSON.parse(rest);
      } catch {
        problems.push(`unreadable diagnostic line: ${line.slice(0, 200)}`);
        continue;
      }
      if (diagnostic.type === 'ERROR') errors.push(diagnostic);
      continue;
    }
    problems.push(`unexpected svelte-check output: ${line.slice(0, 200)}`);
  }
  if (!completed)
    problems.push(
      'svelte-check printed no COMPLETED line, so it did not finish'
    );
  else if (completed.files === 0)
    problems.push('svelte-check checked 0 files, so its config found nothing');
  else if (completed.errors !== errors.length) {
    problems.push(
      `svelte-check reported ${completed.errors} error(s) but printed ${errors.length}`
    );
  }
  return { errors, completed, problems };
}

/** Error counts as `{ file: { code: n } }`, files and codes sorted. */
export function countErrors(errors) {
  const counts = {};
  for (const e of errors) {
    const byCode = (counts[e.filename] ??= {});
    const key = codeKey(e);
    byCode[key] = (byCode[key] ?? 0) + 1;
  }
  return sortCounts(counts);
}

function sortCounts(counts) {
  const sorted = {};
  for (const file of Object.keys(counts).sort()) {
    const codes = Object.keys(counts[file]).sort();
    if (codes.length)
      sorted[file] = Object.fromEntries(codes.map((c) => [c, counts[file][c]]));
  }
  return sorted;
}

/** Each (file, code) whose count differs from the baseline: `added` above it, `stale` below. */
export function compareCounts(current, baseline) {
  const added = [];
  const stale = [];
  const files = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const file of [...files].sort()) {
    const codes = new Set([
      ...Object.keys(current[file] ?? {}),
      ...Object.keys(baseline[file] ?? {}),
    ]);
    for (const code of [...codes].sort()) {
      const found = current[file]?.[code] ?? 0;
      const expected = baseline[file]?.[code] ?? 0;
      if (found > expected) added.push({ file, code, expected, found });
      else if (found < expected) stale.push({ file, code, expected, found });
    }
  }
  return { added, stale };
}

/** The baseline lowered to what was found, for each stale entry only. */
export function prunedBaseline(baseline, stale) {
  const next = structuredClone(baseline);
  for (const { file, code, found } of stale) {
    if (found > 0) next[file][code] = found;
    else delete next[file][code];
  }
  return sortCounts(next);
}

export function readBaseline(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const errors = parsed?.errors;
  if (!errors || typeof errors !== 'object')
    throw new Error(`${path} has no "errors" object`);
  for (const [file, codes] of Object.entries(errors)) {
    for (const [code, n] of Object.entries(codes)) {
      if (!Number.isInteger(n) || n < 1)
        throw new Error(
          `${path}: ${file} ${code} must be a count of 1 or more, not ${n}`
        );
    }
  }
  return errors;
}

export function writeBaseline(path, errors) {
  writeFileSync(path, `${JSON.stringify({ errors }, null, 2)}\n`);
}

function runSvelteCheck() {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('svelte-check/package.json');
  const { bin } = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const binPath = join(
    dirname(pkgPath),
    typeof bin === 'string' ? bin : bin['svelte-check']
  );
  const run = spawnSync(
    process.execPath,
    [binPath, '--tsconfig', './tsconfig.json', '--output', 'machine-verbose'],
    {
      cwd: WEB_ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    }
  );
  if (run.error) throw run.error;
  // Exit 1 just means errors were found; the counts decide. Anything else is a crash.
  if (run.status !== 0 && run.status !== 1) {
    return {
      stdout: run.stdout,
      crash: `svelte-check exited ${run.status ?? run.signal}: ${(run.stderr ?? '').slice(0, 2000)}`,
    };
  }
  return { stdout: run.stdout, crash: null };
}

function parseArgs(argv) {
  const options = { prune: false, input: null, baseline: DEFAULT_BASELINE };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // `pnpm run <script> -- --prune` may pass the separator through.
    if (arg === '--') continue;
    if (arg === '--prune') options.prune = true;
    else if (arg === '--input' || arg === '--baseline') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} needs a path`);
      options[arg.slice(2)] = value;
    } else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

const show = (e) =>
  `      ${e.filename}:${e.start.line + 1}:${e.start.character + 1} ${e.message.split('\n')[0]}`;

/** The whole check; returns the exit code. */
export function run(argv, log = console) {
  const options = parseArgs(argv);
  let stdout;
  if (options.input) stdout = readFileSync(options.input, 'utf8');
  else {
    const result = runSvelteCheck();
    if (result.crash) {
      log.error(`check-svelte-baseline: ${result.crash}`);
      return 1;
    }
    stdout = result.stdout;
  }
  const { errors, completed, problems } = parseMachineVerbose(stdout);
  if (problems.length) {
    for (const p of problems) log.error(`check-svelte-baseline: ${p}`);
    return 1;
  }
  const baseline = readBaseline(options.baseline);
  const { added, stale } = compareCounts(countErrors(errors), baseline);

  if (options.prune && stale.length) {
    writeBaseline(options.baseline, prunedBaseline(baseline, stale));
    for (const s of stale)
      log.log(`pruned ${s.file} ${s.code}: ${s.expected} -> ${s.found}`);
  }
  if (added.length) {
    log.error(
      'svelte-check found errors the baseline does not list. Fix them; the baseline only shrinks.\n'
    );
    for (const a of added) {
      log.error(
        `  ${a.file} ${a.code}: ${a.found} found, ${a.expected} in the baseline`
      );
      for (const e of errors.filter(
        (x) => x.filename === a.file && codeKey(x) === a.code
      ))
        log.error(show(e));
    }
  }
  if (stale.length && !options.prune) {
    log.error(
      '\nThese baseline entries are stale: the errors are fixed. Run with --prune to lower them.\n'
    );
    for (const s of stale)
      log.error(
        `  ${s.file} ${s.code}: ${s.expected} in the baseline, ${s.found} found`
      );
  }
  if (added.length || (stale.length && !options.prune)) return 1;
  const total = errors.length;
  log.log(
    `OK: svelte-check found ${total} error(s) in ${Object.keys(countErrors(errors)).length} file(s), all in the baseline ` +
      `(${completed.files} files checked, ${completed.warnings} warning(s) not baselined).`
  );
  return 0;
}

/**
 * Whether this file is the process's entry. Compared as real paths: Node
 * resolves import.meta.url through symlinks but not argv[1] (Codex-noyrq).
 */
function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isEntrypoint()) process.exitCode = run(process.argv.slice(2));
