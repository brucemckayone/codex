#!/usr/bin/env node
/**
 * Architecture gate: one runner, one registry, one baseline (G0, Codex-xtcfl).
 *
 * WHY THIS FILE EXISTS. A rule that lives only in prose is a convention, and the
 * repo's own census showed what conventions turn into: one retro for 69 closed
 * epics, one cited doc path in six dead, a money file the architecture doc said
 * was 5,097 lines long when it was 9,015. Every rule this gate holds is ONE data
 * entry in `architecture-rules.mjs`; this file finds what each rule matches,
 * compares the counts with `architecture-baseline.json`, and fails the build on
 * any difference.
 *
 * ============================================================================
 * THE RATCHET
 * ============================================================================
 *
 * Counts are keyed by (rule, file), never by line, so editing a file that
 * carries known debt doesn't churn the baseline.
 *
 *   found > allowed        FAIL  a new violation. The message names the line,
 *                                the fix and the rule's doc anchor.
 *   found < allowed        FAIL  the fix must be banked with --lower, so the
 *                                headroom it freed can't be spent later by a
 *                                new violation.
 *   a pinned file is gone  FAIL  --lower removes the entry.
 *   equal                  pass
 *
 * A file the baseline doesn't list is allowed the rule's default: 0 for most
 * rules, the size limit for a measuring rule (SIZE, DOC-BUDGET). `--lower`
 * only ever lowers or removes. RAISING a count is a hand edit of the JSON, so
 * it shows in the PR diff where review sees it and asks for the reason.
 *
 * ============================================================================
 * MODES
 * ============================================================================
 *
 *   pnpm check:arch                 every TRACKED file (what CI sees; an
 *                                   untracked file is caught at commit time)
 *   pnpm check:arch --staged        pre-commit: only the files staged for
 *                                   commit, read from the INDEX (`git show
 *                                   :path`), so it checks exactly what is being
 *                                   committed. Effects across the repo (a
 *                                   deleted doc breaking a link elsewhere) are
 *                                   left to the full run in CI.
 *   pnpm check:arch --lower         rewrite the baseline with lowered or
 *                                   removed counts only
 *   pnpm check:arch --init          write the first baseline; refuses if one
 *                                   exists
 *
 * Test-only flags: `--root <dir>` (a fixture repo), `--rules <module>` (a
 * fixture registry), `--baseline <path>` (relative to the root).
 *
 * Exit codes: 0 pass, 1 violations, 2 usage or registry error.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { MATCHERS } from './architecture-matchers.mjs';
import { RULES } from './architecture-rules.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const BASELINE_FILE = 'scripts/checks/architecture-baseline.json';

/** Hits printed per (rule, file); the count line still states the total. */
const MAX_HITS_SHOWN = 5;

// ---------------------------------------------------------------------------
// Globs
// ---------------------------------------------------------------------------

/**
 * A repo-relative glob as an anchored RegExp: `**` spans directories, `*` and
 * `?` stay inside one segment, `{a,b}` is alternation. No dependency, because
 * this gate must run in the static-analysis job before anything is built.
 *
 * @param {string} glob
 */
export function globToRegExp(glob) {
  let re = '';
  let depth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      depth += 1;
      re += '(?:';
    } else if (c === '}' && depth > 0) {
      depth -= 1;
      re += ')';
    } else if (c === ',' && depth > 0) {
      re += '|';
    } else {
      re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

const globCache = new Map();

function matchesGlob(file, glob) {
  let re = globCache.get(glob);
  if (!re) {
    re = globToRegExp(glob);
    globCache.set(glob, re);
  }
  return re.test(file);
}

/** Whether `file` is inside the rule's `scope` (include minus exclude). */
export function inScope(rule, file) {
  const { include = ['**'], exclude = [] } = rule.scope ?? {};
  return (
    include.some((g) => matchesGlob(file, g)) &&
    !exclude.some((g) => matchesGlob(file, g))
  );
}

// ---------------------------------------------------------------------------
// Sources: what the rules read
// ---------------------------------------------------------------------------
//
// A source is { files, has(file), read(file), changed, deleted }. `changed` is
// null for a full run, or the Set of staged paths at commit time; `deleted` is
// what the commit removes. Matchers read ONLY through it, which is what lets
// the same rules check the working tree, the index, or a fixture.

function git(root, args) {
  const r = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr ?? '').trim()}`);
  }
  return r.stdout;
}

const splitZ = (s) => s.split('\0').filter(Boolean);

function isRegularFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Every tracked file, read from the working tree. Tracked only, never untracked:
 * `--init` and `--lower` write the baseline from this list, and a baseline
 * built from a local scratch file would fail CI with a stale entry.
 */
export function treeSource(root = REPO_ROOT) {
  const files = splitZ(git(root, ['ls-files', '-z', '--cached'])).filter((f) =>
    // ls-files still lists a file deleted in the tree but not yet staged
    isRegularFile(join(root, f))
  );
  const set = new Set(files);
  return {
    files,
    has: (f) => set.has(f),
    read: (f) => readFileSync(join(root, f), 'utf8'),
    changed: null,
    deleted: [],
  };
}

/** The index, as the next commit will hold it. */
export function stagedSource(root = REPO_ROOT) {
  const files = splitZ(git(root, ['ls-files', '-z', '--cached']));
  const diff = (filter) =>
    splitZ(
      git(root, [
        'diff',
        '--cached',
        '--name-only',
        '--no-renames', // a rename is a delete plus an add, so its pin goes stale
        '-z',
        `--diff-filter=${filter}`,
      ])
    );
  const set = new Set(files);
  const cache = new Map();
  return {
    files,
    has: (f) => set.has(f),
    read: (f) => {
      if (!cache.has(f)) cache.set(f, git(root, ['show', `:${f}`]));
      return cache.get(f);
    },
    changed: new Set(diff('ACMT')),
    deleted: diff('D'),
  };
}

/**
 * A source over an in-memory tree, for the self-test.
 *
 * @param {Record<string, string>} tree
 * @param {{ changed?: string[], deleted?: string[] }} [commit]
 */
export function memorySource(tree, commit) {
  const files = Object.keys(tree).sort();
  return {
    files,
    has: (f) => Object.hasOwn(tree, f),
    read: (f) => {
      if (!Object.hasOwn(tree, f)) throw new Error(`no fixture file ${f}`);
      return tree[f];
    },
    changed: commit ? new Set(commit.changed ?? []) : null,
    deleted: commit?.deleted ?? [],
  };
}

// ---------------------------------------------------------------------------
// The registry's own contract
// ---------------------------------------------------------------------------

const RULE_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;

/** Throws on a malformed registry, so a typo can't silently disable a rule. */
export function validateRules(rules) {
  const seen = new Set();
  for (const rule of rules) {
    const where = `rule ${JSON.stringify(rule?.id)}`;
    if (!RULE_ID.test(rule?.id ?? '')) {
      throw new Error(`${where}: id must look like A1 or DOC-LINK`);
    }
    if (seen.has(rule.id)) throw new Error(`${where}: duplicate id`);
    seen.add(rule.id);
    for (const field of ['title', 'fix', 'why']) {
      if (typeof rule[field] !== 'string' || rule[field].trim() === '') {
        throw new Error(`${where}: missing "${field}"`);
      }
    }
    const matcher = MATCHERS[rule.match?.kind];
    if (!matcher) {
      throw new Error(`${where}: unknown match kind "${rule.match?.kind}"`);
    }
    matcher.validate?.(rule);
  }
}

/** The rule's anchor in the generated rules page. */
export function ruleAnchor(rule) {
  return `docs/architecture/rules.md#${rule.id.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Collect, compare, lower
// ---------------------------------------------------------------------------

/**
 * What every rule finds. Per rule: `evaluated` (the files whose counts are
 * judged this run) and `perFile` (file -> { found, hits }). A rule left out of
 * the map was not triggered (commit time only).
 */
export function collect(rules, source) {
  const results = new Map();
  for (const rule of rules) {
    const matcher = MATCHERS[rule.match.kind];
    const subjects = source.files.filter((f) => inScope(rule, f));
    if (matcher.whole) {
      // A whole-repo rule (the package graph, the generated page) runs at
      // commit time only when the commit touches something in its scope.
      if (
        source.changed &&
        !subjects.some((f) => source.changed.has(f)) &&
        !source.deleted.some((f) => inScope(rule, f))
      ) {
        continue;
      }
      const perFile = matcher.whole(rule, { source, subjects });
      results.set(rule.id, {
        perFile,
        evaluated: new Set([...subjects, ...perFile.keys()]),
      });
      continue;
    }
    const targets = source.changed
      ? subjects.filter((f) => source.changed.has(f))
      : subjects;
    const perFile = new Map();
    for (const file of targets) {
      perFile.set(
        file,
        matcher.file(rule, file, source.read(file), { source })
      );
    }
    results.set(rule.id, { perFile, evaluated: new Set(targets) });
  }
  return results;
}

function defaultAllowed(rule, file) {
  return MATCHERS[rule.match.kind].defaultAllowed?.(rule, file) ?? 0;
}

/**
 * Every difference between what was found and what the baseline allows.
 *
 * @returns {{type: 'new'|'more'|'fewer'|'remove'|'stale'|'unknown-rule',
 *   rule?: object, ruleId: string, file?: string, found?: number,
 *   allowed?: number, hits?: object[]}[]}
 */
export function compare(rules, results, baseline, source) {
  const problems = [];
  for (const rule of rules) {
    const result = results.get(rule.id);
    if (!result) continue;
    const pins = baseline[rule.id] ?? {};
    for (const file of result.evaluated) {
      const { found, hits } = result.perFile.get(file) ?? {
        found: 0,
        hits: [],
      };
      const base = { rule, ruleId: rule.id, file, found, hits };
      const fallback = defaultAllowed(rule, file);
      const pinned = pins[file];
      if (pinned === undefined) {
        if (found > fallback) {
          problems.push({ ...base, type: 'new', allowed: fallback });
        }
      } else if (found > pinned) {
        problems.push({ ...base, type: 'more', allowed: pinned });
      } else if (found < pinned) {
        problems.push({
          ...base,
          type: found <= fallback ? 'remove' : 'fewer',
          allowed: pinned,
        });
      }
    }
    for (const [file, pinned] of Object.entries(pins)) {
      if (result.evaluated.has(file)) continue;
      // A full run judges every file in scope, so an entry it didn't evaluate
      // is gone or out of scope. A commit only judges what it touches, so
      // there an entry is stale only when the commit deletes its file.
      const gone = source.changed ? source.deleted.includes(file) : true;
      if (gone) {
        problems.push({
          type: 'stale',
          rule,
          ruleId: rule.id,
          file,
          found: 0,
          allowed: pinned,
          hits: [],
        });
      }
    }
  }
  const known = new Set(rules.map((r) => r.id));
  for (const ruleId of Object.keys(baseline)) {
    if (!known.has(ruleId)) problems.push({ type: 'unknown-rule', ruleId });
  }
  return problems;
}

/** The baseline with every fixed or vanished count banked. Never raises, never adds. */
export function lowerBaseline(rules, results, baseline) {
  const next = {};
  for (const [ruleId, pins] of Object.entries(baseline)) {
    const rule = rules.find((r) => r.id === ruleId);
    const result = rule && results.get(ruleId);
    if (!result) continue; // an unknown rule is a hand edit, not --lower's call
    for (const [file, pinned] of Object.entries(pins)) {
      if (!result.evaluated.has(file)) continue;
      const found = result.perFile.get(file)?.found ?? 0;
      const kept = Math.min(found, pinned);
      if (kept <= defaultAllowed(rule, file)) continue;
      next[ruleId] ??= {};
      next[ruleId][file] = kept;
    }
  }
  return sortBaseline(next);
}

/** The first baseline: every count above its rule's default. */
export function initialBaseline(rules, results) {
  const next = {};
  for (const rule of rules) {
    const result = results.get(rule.id);
    if (!result) continue;
    for (const [file, { found }] of result.perFile) {
      if (found <= defaultAllowed(rule, file)) continue;
      next[rule.id] ??= {};
      next[rule.id][file] = found;
    }
  }
  return sortBaseline(next);
}

function sortBaseline(baseline) {
  const sorted = {};
  for (const ruleId of Object.keys(baseline).sort()) {
    sorted[ruleId] = {};
    for (const file of Object.keys(baseline[ruleId]).sort()) {
      sorted[ruleId][file] = baseline[ruleId][file];
    }
  }
  return sorted;
}

/** Biome's JSON format (2-space indent, trailing newline). */
export function serializeBaseline(baseline) {
  return `${JSON.stringify(baseline, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function amount(rule, n) {
  const unit = MATCHERS[rule.match.kind].unit;
  const text = n.toLocaleString('en-GB');
  return unit ? `${text} ${unit}` : text;
}

/**
 * Everything an agent needs to correct itself, per problem: which rule, where,
 * the one fix, where the rule is written, and how this file's count compares
 * with the debt it was already allowed. That last line is what makes an agent
 * fix what it just introduced instead of trying to clear the whole baseline.
 */
export function formatProblems(problems) {
  const lines = [];
  const counts = { new: 0, bank: 0, unknown: 0 };
  for (const p of problems) {
    if (p.type === 'unknown-rule') {
      counts.unknown += 1;
      lines.push(
        `  The baseline lists rule "${p.ruleId}", which the registry doesn't define.`,
        '  Remove that block from the baseline by hand.',
        ''
      );
      continue;
    }
    const { rule } = p;
    lines.push(`  [${rule.id}] ${rule.title}`);
    if (p.type === 'new' || p.type === 'more') {
      counts.new += 1;
      const shown = p.hits.slice(0, MAX_HITS_SHOWN);
      if (shown.length === 0) lines.push(`  ${p.file}`);
      for (const hit of shown) {
        lines.push(`  ${p.file}:${hit.line}`);
        if (hit.text) lines.push(`      ${hit.text}`);
      }
      if (p.hits.length > shown.length) {
        lines.push(`  … and ${p.hits.length - shown.length} more in this file`);
      }
      lines.push(
        `  Fix: ${rule.fix}`,
        `  Rule: ${ruleAnchor(rule)}  ·  allowed in this file: ${amount(rule, p.allowed)}, found: ${amount(rule, p.found)}`,
        ''
      );
      continue;
    }
    counts.bank += 1;
    if (p.type === 'fewer') {
      lines.push(
        `  ${p.file}: allowed ${amount(rule, p.allowed)}, found ${amount(rule, p.found)}. Bank the fix: pnpm check:arch --lower`,
        ''
      );
    } else {
      const why =
        p.type === 'stale'
          ? 'is gone or out of scope'
          : 'no longer needs an entry';
      lines.push(
        `  ${p.file} ${why}, but the baseline still lists it (${amount(rule, p.allowed)}). Remove it: pnpm check:arch --lower`,
        ''
      );
    }
  }
  const head =
    `✗ check-architecture: ${counts.new} new violation(s), ` +
    `${counts.bank} baseline entr${counts.bank === 1 ? 'y' : 'ies'} to lower` +
    (counts.unknown ? `, ${counts.unknown} unknown rule(s)` : '');
  return [head, ...lines].join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { staged: false, lower: false, init: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--staged') opts.staged = true;
    else if (arg === '--lower') opts.lower = true;
    else if (arg === '--init') opts.init = true;
    else if (arg === '--root' || arg === '--rules' || arg === '--baseline') {
      const value = argv[i + 1];
      if (!value) throw new UsageError(`${arg} needs a value`);
      opts[arg.slice(2)] = value;
      i += 1;
    } else {
      throw new UsageError(`unknown option ${arg}`);
    }
  }
  if ([opts.staged, opts.lower, opts.init].filter(Boolean).length > 1) {
    throw new UsageError('--staged, --lower and --init are exclusive');
  }
  return opts;
}

class UsageError extends Error {}

function readBaseline(source, root, file, staged) {
  if (staged) return source.has(file) ? JSON.parse(source.read(file)) : {};
  const path = join(root, file);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

/** @returns {Promise<number>} the exit code */
export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`check-architecture: ${err.message}`);
    return 2;
  }
  const root = opts.root ? resolve(opts.root) : REPO_ROOT;
  const baselineFile = opts.baseline ?? BASELINE_FILE;
  const rules = opts.rules
    ? (await import(pathToFileURL(resolve(opts.rules)).href)).RULES
    : RULES;
  try {
    validateRules(rules);
  } catch (err) {
    console.error(`check-architecture: registry error: ${err.message}`);
    return 2;
  }

  const source = opts.staged ? stagedSource(root) : treeSource(root);
  const results = collect(rules, source);

  if (opts.init) {
    if (existsSync(join(root, baselineFile))) {
      console.error(
        `check-architecture: ${baselineFile} already exists. --init writes only the FIRST baseline; use --lower to bank fixes, or edit it by hand to raise a count.`
      );
      return 2;
    }
    const baseline = initialBaseline(rules, results);
    writeFileSync(join(root, baselineFile), serializeBaseline(baseline));
    const entries = Object.values(baseline).reduce(
      (n, pins) => n + Object.keys(pins).length,
      0
    );
    console.log(
      `check-architecture: wrote ${baselineFile} (${entries} entries).`
    );
    return 0;
  }

  const baseline = readBaseline(source, root, baselineFile, opts.staged);

  if (opts.lower) {
    const lowered = lowerBaseline(rules, results, baseline);
    writeFileSync(join(root, baselineFile), serializeBaseline(lowered));
    console.log(
      `check-architecture: lowered ${baselineFile}. Re-run the check to confirm.`
    );
    return 0;
  }

  const problems = compare(rules, results, baseline, source);
  if (problems.length > 0) {
    console.error(formatProblems(problems));
    return 1;
  }
  const judged = [...results.values()].reduce(
    (n, r) => n + r.evaluated.size,
    0
  );
  console.log(
    `OK: ${results.size} of ${rules.length} rule(s) ran over ${judged} (rule, file) pair(s)` +
      `${opts.staged ? ' in the staged changes' : ''}; every count equals the baseline.`
  );
  return 0;
}

/**
 * Whether this file is the process's entry, so the self-test can import it
 * without running main(). Compared as real paths, as the data-access gate
 * learned (Codex-noyrq): a symlinked argv[1] otherwise skips main() and exits 0
 * having checked nothing.
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

if (isEntrypoint()) {
  process.exitCode = await main();
}
