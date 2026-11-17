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
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RULES_DOC, renderRulesDoc } from './architecture-docs.mjs';
import {
  applyIgnores,
  IGNORE_KEYWORD,
  ignoreProblems,
  parseIgnores,
} from './architecture-ignores.mjs';
import { MATCHERS } from './architecture-matchers.mjs';
import { GATES, RULES } from './architecture-rules.mjs';

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
 * the map was not triggered (commit time only). Hits a valid inline exception
 * excuses are dropped here; `results.directives` keeps every exception seen,
 * so compare() can fail the expired, unused and malformed ones.
 */
export function collect(rules, source) {
  const results = new Map();
  const directives = new Map();
  // Every file a matcher reads passes through here once per read, so an
  // exception is found wherever the rules look, and nowhere else.
  const reading = {
    ...source,
    read: (file) => {
      const text = source.read(file);
      if (!directives.has(file) && text.includes(IGNORE_KEYWORD)) {
        directives.set(file, parseIgnores(file, text));
      }
      return text;
    },
  };
  const excuse = (rule, perFile) => {
    if (MATCHERS[rule.match.kind].unit) return perFile; // measuring: no offending line
    for (const [file, result] of perFile) {
      if (result.hits.length === 0) continue;
      const hits = applyIgnores(rule.id, result.hits, directives.get(file));
      perFile.set(file, { found: hits.length, hits });
    }
    return perFile;
  };
  for (const rule of rules) {
    const matcher = MATCHERS[rule.match.kind];
    const subjects = source.files.filter((f) => inScope(rule, f));
    if (matcher.whole) {
      // A whole-repo rule (the package graph, a pair of lists) runs at commit
      // time only when the commit touches something in its scope.
      if (
        source.changed &&
        !subjects.some((f) => source.changed.has(f)) &&
        !source.deleted.some((f) => inScope(rule, f))
      ) {
        continue;
      }
      const perFile = matcher.whole(rule, { source: reading, subjects });
      // note each reported file's exceptions; a hit can name a file that is missing
      for (const file of perFile.keys()) {
        if (source.has(file)) reading.read(file);
      }
      results.set(rule.id, {
        perFile: excuse(rule, perFile),
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
        matcher.file(rule, file, reading.read(file), { source: reading })
      );
    }
    results.set(rule.id, {
      perFile: excuse(rule, perFile),
      evaluated: new Set(targets),
    });
  }
  results.directives = directives;
  return results;
}

/** Today as YYYY-MM-DD in UTC, the format an exception's `until=` uses. */
export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
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
export function compare(
  rules,
  results,
  baseline,
  source,
  { today = todayUtc() } = {}
) {
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
  if (results.directives) {
    problems.push(
      ...ignoreProblems(results.directives, {
        known,
        measuring: new Set(
          rules.filter((r) => MATCHERS[r.match.kind].unit).map((r) => r.id)
        ),
        ranOn: (ruleId, file) =>
          results.get(ruleId)?.evaluated.has(file) ?? false,
        today,
      })
    );
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
// Countersigned raises
// ---------------------------------------------------------------------------
//
// The ratchet has one hole: the agent that wants green can edit the baseline
// upwards. pstack's rule for that is "Anything that loosens a gate … needs a
// verifier's proof and then your fresh countersign, because the owner is the
// one who wants green." So in a pull request every raised or added count must
// be named in the PR description, with its reason, on a line of its own:
//   G0-RAISE: <RULE> <file> — <reason>
// --lower never needs one: lowering only tightens.

/** Every (rule, file) the new baseline allows more than the old one did. */
export function raisedEntries(before, after) {
  const raised = [];
  for (const [ruleId, pins] of Object.entries(after)) {
    for (const [file, now] of Object.entries(pins)) {
      const was = before[ruleId]?.[file];
      if (was === undefined || now > was)
        raised.push({ ruleId, file, was, now });
    }
  }
  return raised;
}

const RAISE_LINE =
  /^[ \t>*-]*G0-RAISE:\s*(\S+)\s+(\S+)\s+(?:—|-{1,2})\s+\S.*$/gm;

/** The raises a PR description countersigns, as "RULE file" keys. */
export function countersigned(body) {
  return new Set([...body.matchAll(RAISE_LINE)].map((m) => `${m[1]} ${m[2]}`));
}

/** The raises a PR description doesn't countersign. */
export function missingCountersigns(before, after, body) {
  const signed = countersigned(body);
  return raisedEntries(before, after).filter(
    (r) => !signed.has(`${r.ruleId} ${r.file}`)
  );
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
    if (p.type === 'ignore') {
      counts.new += 1;
      lines.push(
        `  [${IGNORE_KEYWORD}] ${p.file}:${p.line}`,
        `  This exception ${p.why}.`,
        '  Rule: docs/architecture/rules.md#exceptions',
        ''
      );
      continue;
    }
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
  const opts = {
    staged: false,
    lower: false,
    init: false,
    writeRules: false,
    gates: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--staged') opts.staged = true;
    else if (arg === '--lower') opts.lower = true;
    else if (arg === '--init') opts.init = true;
    else if (arg === '--write-rules') opts.writeRules = true;
    else if (arg === '--gates') opts.gates = true;
    else if (
      arg === '--root' ||
      arg === '--rules' ||
      arg === '--baseline' ||
      arg === '--raises'
    ) {
      const value = argv[i + 1];
      if (!value) throw new UsageError(`${arg} needs a value`);
      opts[arg.slice(2)] = value;
      i += 1;
    } else {
      throw new UsageError(`unknown option ${arg}`);
    }
  }
  const modes = ['staged', 'lower', 'init', 'raises', 'writeRules', 'gates'];
  if (modes.filter((m) => opts[m]).length > 1) {
    throw new UsageError(
      '--staged, --lower, --init, --raises, --write-rules and --gates are exclusive'
    );
  }
  return opts;
}

class UsageError extends Error {}

function readBaseline(source, root, file, staged) {
  if (staged) return source.has(file) ? JSON.parse(source.read(file)) : {};
  const path = join(root, file);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

/**
 * --gates: run every CI static gate the registry lists, in order, the way the
 * static-analysis job does. gate.sh calls this so a gate added to CI can't be
 * skipped locally (Codex-kxdz9). A pull-request-only step is reported, not
 * run; a gate gate.sh runs itself is skipped here.
 */
function runGates(root, gates) {
  const failed = [];
  for (const gate of gates) {
    if (gate.localBy) {
      console.log(`- ${gate.id}: run by ${gate.localBy}`);
      continue;
    }
    for (const command of [gate.before, gate.selfTest, gate.run].filter(
      Boolean
    )) {
      console.log(`- ${gate.id}: ${command}`);
      const r = spawnSync(command, {
        cwd: root,
        shell: true,
        stdio: 'inherit',
      });
      if (r.status !== 0) {
        failed.push(`${gate.id} (${command})`);
        break;
      }
    }
    for (const command of gate.prOnly ?? []) {
      console.log(`- ${gate.id}: CI pull requests only: ${command}`);
    }
  }
  if (failed.length > 0) {
    console.error(
      `✗ check-architecture --gates: ${failed.length} gate(s) failed: ${failed.join(', ')}`
    );
    return 1;
  }
  console.log(
    `OK: all ${gates.filter((g) => !g.localBy).length} CI static gates passed locally.`
  );
  return 0;
}

/**
 * --raises <base-ref>: every count the working baseline raises or adds over
 * the base ref's must be countersigned in the PR description, which CI passes
 * in G0_PR_BODY. A base with no baseline means this PR writes the first one.
 */
function checkRaises(root, baselineFile, baseRef) {
  const body = process.env.G0_PR_BODY;
  if (body === undefined) {
    console.error(
      'check-architecture: --raises reads the PR description from G0_PR_BODY; it runs in a pull_request job.'
    );
    return 2;
  }
  const base = spawnSync('git', ['show', `${baseRef}:${baselineFile}`], {
    cwd: root,
    encoding: 'utf8',
  });
  if (base.status !== 0) {
    if (/does not exist|exists on disk, but not in/.test(base.stderr)) {
      console.log(
        `OK: ${baseRef} has no ${baselineFile}, so this PR writes the first baseline; nothing to countersign.`
      );
      return 0;
    }
    console.error(
      `check-architecture: git show ${baseRef}:${baselineFile} failed: ${base.stderr.trim()}`
    );
    return 2;
  }
  const headPath = join(root, baselineFile);
  const head = existsSync(headPath)
    ? JSON.parse(readFileSync(headPath, 'utf8'))
    : {};
  const missing = missingCountersigns(JSON.parse(base.stdout), head, body);
  if (missing.length === 0) {
    console.log(
      'OK: every raised baseline count is countersigned in the PR description.'
    );
    return 0;
  }
  console.error(
    [
      `✗ check-architecture: ${missing.length} raised baseline count(s) are not countersigned.`,
      '  A raise loosens a gate, so it needs its reason in the PR description. Add a line per entry:',
      ...missing.map(
        (r) =>
          `  G0-RAISE: ${r.ruleId} ${r.file} — <why> (${r.was ?? 'new entry'} → ${r.now})`
      ),
      '  Rule: docs/architecture/rules.md#raises',
    ].join('\n')
  );
  return 1;
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

  if (opts.raises) return checkRaises(root, baselineFile, opts.raises);
  if (opts.writeRules) {
    mkdirSync(dirname(join(root, RULES_DOC)), { recursive: true });
    writeFileSync(join(root, RULES_DOC), renderRulesDoc(rules, GATES));
    console.log(`check-architecture: wrote ${RULES_DOC}.`);
    return 0;
  }
  if (opts.gates) return runGates(root, GATES);

  const source = opts.staged ? stagedSource(root) : treeSource(root);
  let results;
  try {
    results = collect(rules, source);
  } catch (err) {
    // A matcher that can't read what it depends on (limits.ts reshaped, a
    // wrangler.jsonc that doesn't parse) must stop the build, not pass it.
    console.error(`check-architecture: a rule could not run: ${err.message}`);
    return 2;
  }

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
