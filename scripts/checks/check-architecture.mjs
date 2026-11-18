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
 * The baseline is keyed by (rule, file), never by line, so editing a file that
 * carries known debt doesn't churn it. A rule that measures a file (SIZE,
 * DOC-BUDGET) pins a number; every other rule pins the KEY of each violation
 * it allows (the matched call, the dead link's target), so fixing one
 * violation can't pay for a new one in the same file.
 *
 *   a key or size beyond the pin   FAIL  a new violation. The message names
 *                                        the line, the fix and the rule's doc
 *                                        anchor.
 *   a pinned key gone, a size down FAIL in a commit or PR that touches the
 *                                        file, until --lower banks the fix (so
 *                                        the freed headroom can't be spent
 *                                        later); a notice anywhere else
 *   a pinned file gone             same as a fix: --lower removes the entry
 *   equal                          pass
 *
 * A file the baseline doesn't list is allowed nothing, or the size limit for a
 * measuring rule. `--lower` only ever lowers or removes. Anything that LOOSENS
 * the gate (a raised or added pin, a new or renewed exception, a change to the
 * gate's own files) needs a countersign: a `G0-RAISE:` trailer in a commit
 * message, checked by --ci (see architecture-raises.mjs).
 *
 * ============================================================================
 * MODES
 * ============================================================================
 *
 *   pnpm check:arch                 every TRACKED file (an untracked file is
 *                                   caught at commit time)
 *   pnpm check:arch --staged        pre-commit: only the files staged for
 *                                   commit, read from the INDEX (`git show
 *                                   :path`), so it checks exactly what is being
 *                                   committed. Effects across the repo (a
 *                                   deleted doc breaking a link elsewhere) are
 *                                   left to the full run in CI.
 *   pnpm check:arch --ci            the full run, plus: unbanked fixes fail in
 *                                   the files a PR touches, and every loosening
 *                                   since the change's base is countersigned
 *   pnpm check:arch --raises <ref>  only the countersign check, against <ref>
 *   pnpm check:arch --lower         bank fixes: lower or remove pins only
 *   pnpm check:arch --init          write the first baseline; refuses if one
 *                                   exists. `--init --rule <ID>` seeds the
 *                                   block for a rule added later
 *   pnpm check:arch --write-rules   regenerate docs/architecture/rules.md
 *   pnpm check:arch --gates [--skip IDS]
 *                                   run every CI static gate the registry
 *                                   lists, the way CI does (gate.sh)
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
import {
  checkLoosening,
  ciBase,
  touchedFiles,
} from './architecture-raises.mjs';
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

/** Whether a rule measures a file (SIZE, DOC-BUDGET) rather than listing violations. */
export function isMeasuring(rule) {
  return Boolean(MATCHERS[rule.match.kind].unit);
}

/** The items of `a` that `b` doesn't match one for one (a multiset difference). */
export function minus(a, b) {
  const left = [...b];
  const out = [];
  for (const x of a) {
    const at = left.indexOf(x);
    if (at === -1) out.push(x);
    else left.splice(at, 1);
  }
  return out;
}

const keyOf = (hit) => hit.key ?? hit.text;

/**
 * Every difference between what was found and what the baseline allows.
 *
 * A measuring rule pins a number per file. Any other rule pins the KEY of each
 * violation it allows (the matched call, the dead link's target), so a fixed
 * violation can't pay for a new one in the same file: the new one's key isn't
 * pinned, and it fails even when the count is unchanged.
 *
 * A fix that hasn't been banked with --lower is `blocking` only where
 * `bankFails(file)` says so: at commit time and in a pull request, for the
 * files that change touches. Elsewhere it is a notice. Two green PRs that bank
 * different fixes in one file can otherwise merge cleanly into a red branch.
 */
export function compare(
  rules,
  results,
  baseline,
  source,
  { today = todayUtc(), bankFails = () => true } = {}
) {
  const problems = [];
  const bank = (p) => problems.push({ ...p, blocking: bankFails(p.file) });
  for (const rule of rules) {
    const result = results.get(rule.id);
    if (!result) continue;
    const pins = baseline[rule.id] ?? {};
    const measuring = isMeasuring(rule);
    for (const file of result.evaluated) {
      const { found, hits } = result.perFile.get(file) ?? {
        found: 0,
        hits: [],
      };
      const base = { rule, ruleId: rule.id, file, found, hits };
      const pinned = pins[file];
      if (measuring && pinned !== undefined && !Number.isInteger(pinned)) {
        problems.push({ ...base, type: 'format', blocking: true });
        continue;
      }
      if (measuring) {
        const fallback = defaultAllowed(rule, file);
        if (pinned === undefined) {
          if (found > fallback) {
            problems.push({
              ...base,
              type: 'new',
              allowed: fallback,
              blocking: true,
            });
          }
        } else if (found > pinned) {
          problems.push({
            ...base,
            type: 'more',
            allowed: pinned,
            blocking: true,
          });
        } else if (found < pinned) {
          bank({
            ...base,
            type: found <= fallback ? 'remove' : 'fewer',
            allowed: pinned,
          });
        }
        continue;
      }
      if (pinned !== undefined && !Array.isArray(pinned)) {
        problems.push({ ...base, type: 'format', blocking: true });
        continue;
      }
      const allowedKeys = pinned ?? [];
      const foundKeys = hits.map(keyOf);
      const added = minus(foundKeys, allowedKeys);
      if (added.length > 0) {
        const pending = [...added];
        const newHits = hits.filter((h) => {
          const at = pending.indexOf(keyOf(h));
          if (at === -1) return false;
          pending.splice(at, 1);
          return true;
        });
        problems.push({
          ...base,
          type: pinned === undefined ? 'new' : 'more',
          allowed: allowedKeys.length,
          hits: newHits,
          blocking: true,
        });
      }
      const fixed = minus(allowedKeys, foundKeys);
      if (fixed.length > 0) {
        bank({
          ...base,
          type: fixed.length === allowedKeys.length ? 'remove' : 'fewer',
          allowed: allowedKeys.length,
          fixed,
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
        bank({
          type: 'stale',
          rule,
          ruleId: rule.id,
          file,
          found: 0,
          allowed: Array.isArray(pinned) ? pinned.length : pinned,
          hits: [],
        });
      }
    }
  }
  const known = new Set(rules.map((r) => r.id));
  for (const ruleId of Object.keys(baseline)) {
    if (!known.has(ruleId))
      problems.push({ type: 'unknown-rule', ruleId, blocking: true });
  }
  if (results.directives) {
    for (const p of ignoreProblems(results.directives, {
      known,
      measuring: new Set(rules.filter(isMeasuring).map((r) => r.id)),
      noExceptions: new Set(
        rules.filter((r) => r.exceptions === false).map((r) => r.id)
      ),
      ran: (ruleId) => results.has(ruleId),
      ranOn: (ruleId, file) =>
        results.get(ruleId)?.evaluated.has(file) ?? false,
      today,
    })) {
      problems.push({ ...p, blocking: true });
    }
  }
  return problems;
}

/**
 * The baseline with every fixed or vanished violation banked. Never raises,
 * never adds. A block for a rule the registry doesn't define is copied through
 * untouched: removing it is a hand edit that review sees.
 */
export function lowerBaseline(rules, results, baseline) {
  const next = {};
  for (const [ruleId, pins] of Object.entries(baseline)) {
    const rule = rules.find((r) => r.id === ruleId);
    const result = rule && results.get(ruleId);
    if (!result) {
      next[ruleId] = pins;
      continue;
    }
    for (const [file, pinned] of Object.entries(pins)) {
      if (!result.evaluated.has(file)) continue;
      const entry = result.perFile.get(file) ?? { found: 0, hits: [] };
      let kept;
      if (isMeasuring(rule)) {
        if (!Number.isInteger(pinned)) {
          kept = pinned; // a format problem; --lower won't guess
        } else {
          kept = Math.min(entry.found, pinned);
          if (kept <= defaultAllowed(rule, file)) continue;
        }
      } else {
        const foundKeys = entry.hits.map(keyOf).sort();
        // A count where keys belong (the old format, or a hand edit) becomes
        // at most that many keys; any found beyond it then fail as new.
        kept = Array.isArray(pinned)
          ? minus(pinned, minus(pinned, foundKeys)).sort()
          : foundKeys.slice(0, pinned);
        if (kept.length === 0) continue;
      }
      next[ruleId] ??= {};
      next[ruleId][file] = kept;
    }
  }
  return sortBaseline(next);
}

/** A baseline block per rule: every count above its default, or every violation's key. */
export function initialBaseline(rules, results) {
  const next = {};
  for (const rule of rules) {
    const result = results.get(rule.id);
    if (!result) continue;
    for (const [file, { found, hits }] of result.perFile) {
      let entry;
      if (isMeasuring(rule)) {
        if (found <= defaultAllowed(rule, file)) continue;
        entry = found;
      } else {
        if (hits.length === 0) continue;
        entry = hits.map(keyOf).sort();
      }
      next[rule.id] ??= {};
      next[rule.id][file] = entry;
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

/** Biome's JSON line width (biome.json `formatter.lineWidth`). */
const JSON_WIDTH = 80;

/**
 * The baseline as biome formats it, so `--lower` and the commit hook's
 * `biome check --write` never fight over it: objects one key per line, and a
 * key array on one line when it fits in 80 columns, else one key per line.
 */
export function serializeBaseline(baseline) {
  const q = (v) => JSON.stringify(v);
  const rules = Object.entries(baseline);
  if (rules.length === 0) return '{}\n';
  const out = ['{'];
  rules.forEach(([ruleId, pins], i) => {
    const ruleEnd = i < rules.length - 1 ? ',' : '';
    const files = Object.entries(pins);
    if (files.length === 0) {
      out.push(`  ${q(ruleId)}: {}${ruleEnd}`);
      return;
    }
    out.push(`  ${q(ruleId)}: {`);
    files.forEach(([file, pin], j) => {
      const end = j < files.length - 1 ? ',' : '';
      const head = `    ${q(file)}: `;
      if (!Array.isArray(pin) || pin.length === 0) {
        out.push(`${head}${q(pin)}${end}`);
        return;
      }
      const flat = `${head}[${pin.map(q).join(', ')}]${end}`;
      if (flat.length <= JSON_WIDTH) {
        out.push(flat);
        return;
      }
      out.push(`${head}[`);
      pin.forEach((key, n) => {
        out.push(`      ${q(key)}${n < pin.length - 1 ? ',' : ''}`);
      });
      out.push(`    ]${end}`);
    });
    out.push(`  }${ruleEnd}`);
  });
  out.push('}');
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function amount(rule, n) {
  const unit = MATCHERS[rule.match.kind].unit;
  // Fixed digit grouping, so output never depends on the machine's locale.
  const text = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return unit ? `${text} ${unit}` : text;
}

/**
 * Everything an agent needs to correct itself, per problem: which rule, where,
 * the one fix, where the rule is written, and how this file compares with the
 * debt it was already allowed. That last line is what makes an agent fix what
 * it just introduced instead of trying to clear the whole baseline.
 */
export function formatProblems(problems) {
  const lines = [];
  for (const p of problems) {
    if (p.type === 'ignore') {
      lines.push(
        `  [${IGNORE_KEYWORD}] ${p.file}:${p.line}`,
        `  This exception ${p.why}.`,
        '  Rule: docs/architecture/rules.md#exceptions',
        ''
      );
      continue;
    }
    if (p.type === 'unknown-rule') {
      lines.push(
        `  The baseline lists rule "${p.ruleId}", which the registry doesn't define.`,
        '  Remove that block from the baseline by hand (with a countersign).',
        ''
      );
      continue;
    }
    const { rule } = p;
    lines.push(`  [${rule.id}] ${rule.title}`);
    if (p.type === 'format') {
      lines.push(
        isMeasuring(rule)
          ? `  ${p.file}: the baseline pin must be a whole number (${p.rule.match.kind} measures ${MATCHERS[rule.match.kind].unit}). Fix the JSON by hand.`
          : `  ${p.file}: the baseline holds a count where this rule pins violation keys. Convert it: pnpm check:arch --lower`,
        ''
      );
      continue;
    }
    if (p.type === 'new' || p.type === 'more') {
      const shown = p.hits.slice(0, MAX_HITS_SHOWN);
      if (shown.length === 0) lines.push(`  ${p.file}`);
      for (const hit of shown) {
        lines.push(`  ${p.file}:${hit.line}`);
        if (hit.text) lines.push(`      ${hit.text}`);
      }
      if (p.hits.length > shown.length) {
        lines.push(`  … and ${p.hits.length - shown.length} more in this file`);
      }
      const tally = isMeasuring(rule)
        ? `allowed in this file: ${amount(rule, p.allowed)}, found: ${amount(rule, p.found)}`
        : `the baseline pins ${p.allowed} in this file; ${p.hits.length} found here ${p.hits.length === 1 ? "isn't" : "aren't"} among them`;
      lines.push(
        `  Fix: ${rule.fix}`,
        `  Rule: ${ruleAnchor(rule)}  ·  ${tally}`,
        ''
      );
      continue;
    }
    if (p.type === 'fewer' || p.type === 'remove') {
      const what = p.fixed
        ? `fixed ${p.fixed.map((k) => JSON.stringify(k)).join(', ')}`
        : `allowed ${amount(rule, p.allowed)}, found ${amount(rule, p.found)}`;
      lines.push(
        `  ${p.file}: ${what}. Bank the fix: pnpm check:arch --lower`,
        ''
      );
      continue;
    }
    lines.push(
      `  ${p.file} is gone or out of scope, but the baseline still lists it. Remove it: pnpm check:arch --lower`,
      ''
    );
  }
  return lines.join('\n');
}

function report(problems, okLine) {
  const blocking = problems.filter((p) => p.blocking);
  const notices = problems.filter((p) => !p.blocking);
  if (notices.length > 0) {
    console.log(
      `note: ${notices.length} fixed violation(s) not yet banked. They block only a commit or pull request that touches the file; pnpm check:arch --lower banks them:`
    );
    console.log(formatProblems(notices));
  }
  if (blocking.length > 0) {
    console.error(`✗ check-architecture: ${blocking.length} problem(s)`);
    console.error(formatProblems(blocking));
    return 1;
  }
  console.log(okLine);
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

class UsageError extends Error {}

const VALUE_FLAGS = [
  '--root',
  '--rules',
  '--baseline',
  '--raises',
  '--rule',
  '--skip',
];
const MODE_FLAGS = [
  '--staged',
  '--lower',
  '--init',
  '--ci',
  '--write-rules',
  '--gates',
];

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (MODE_FLAGS.includes(arg)) opts[arg.slice(2)] = true;
    else if (VALUE_FLAGS.includes(arg)) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--'))
        throw new UsageError(`${arg} needs a value`);
      opts[arg.slice(2)] = value;
      i += 1;
    } else throw new UsageError(`unknown option ${arg}`);
  }
  const modes = [...MODE_FLAGS.map((f) => f.slice(2)), 'raises'].filter(
    (m) => opts[m]
  );
  if (modes.length > 1)
    throw new UsageError(`--${modes.join(' and --')} are exclusive`);
  if (opts.rule && !opts.init) throw new UsageError('--rule goes with --init');
  if (opts.skip && !opts.gates)
    throw new UsageError('--skip goes with --gates');
  return opts;
}

function readBaseline(source, root, file, staged) {
  const text = staged
    ? source.has(file)
      ? source.read(file)
      : null
    : existsSync(join(root, file))
      ? readFileSync(join(root, file), 'utf8')
      : null;
  if (text === null) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message})`);
  }
}

/**
 * --gates [--skip IDS]: run every CI static gate the registry lists, in order,
 * the way the static-analysis job does. gate.sh calls it with --skip for the
 * gates it has just run itself, so a gate added to CI can't be skipped locally
 * (Codex-kxdz9). A gate whose every command was skipped is not counted as
 * passed.
 */
function runGates(root, gates, skip) {
  const failed = [];
  let ran = 0;
  for (const gate of gates) {
    if (skip.has(gate.id)) {
      console.log(`- ${gate.id}: skipped (--skip)`);
      continue;
    }
    const commands = [gate.before, gate.selfTest, gate.run].filter(Boolean);
    if (commands.length === 0) continue;
    ran += 1;
    for (const command of commands) {
      console.log(`- ${gate.id}: ${command}`);
      const r = spawnSync(command, {
        cwd: root,
        shell: true,
        stdio: 'inherit',
      });
      if (r.status !== 0) {
        failed.push(`${gate.id} (${command})`);
        if (gate.needs) console.error(`  ${gate.id} needs ${gate.needs}.`);
        break;
      }
    }
  }
  if (failed.length > 0) {
    console.error(
      `✗ check-architecture --gates: ${failed.length} gate(s) failed: ${failed.join(', ')}`
    );
    return 1;
  }
  console.log(
    `OK: ${ran} CI static gate(s) passed locally${skip.size ? ` (${[...skip].join(', ')} skipped)` : ''}.`
  );
  return 0;
}

function loosening(root, rules, baselineFile, base) {
  const { skipped, missing } = checkLoosening(root, rules, baselineFile, base);
  if (skipped) {
    console.log(`OK: ${skipped}.`);
    return 0;
  }
  if (missing.length === 0) {
    console.log(
      `OK: everything this change loosens since ${base} is countersigned.`
    );
    return 0;
  }
  console.error(
    [
      `✗ check-architecture: ${missing.length} loosening(s) since ${base} are not countersigned.`,
      '  A raised baseline entry, a new or renewed exception, or a change to the gate itself loosens it.',
      '  Add one trailer line per item to a commit message in this change (git commit --amend, or a new commit):',
      ...missing.map((m) => `    ${m.line}    (${m.what})`),
      '  Rule: docs/architecture/rules.md#raises',
    ].join('\n')
  );
  return 1;
}

/** Unstaged edits to the gate's own code would make --staged judge with rules the commit doesn't carry. */
function unstagedGateEdits(root) {
  const r = spawnSync('git', ['diff', '--name-only', '--', 'scripts/checks/'], {
    cwd: root,
    encoding: 'utf8',
  });
  return r.stdout
    .split('\n')
    .filter((f) =>
      /^scripts\/checks\/(?:check-architecture|architecture-[\w-]+)\.mjs$/.test(
        f
      )
    );
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
  try {
    return await run(opts);
  } catch (err) {
    // A gate that can't run must stop the build, and say it is broken rather
    // than reporting a violation (exit 1 means "you added one").
    console.error(`check-architecture: could not run: ${err.message}`);
    return 2;
  }
}

async function run(opts) {
  const root = opts.root ? resolve(opts.root) : REPO_ROOT;
  const baselineFile = opts.baseline ?? BASELINE_FILE;
  const registry = opts.rules
    ? await import(pathToFileURL(resolve(opts.rules)).href)
    : { RULES, GATES };
  const rules = registry.RULES;
  const gates = registry.GATES ?? [];
  try {
    validateRules(rules);
  } catch (err) {
    console.error(`check-architecture: registry error: ${err.message}`);
    return 2;
  }

  if (opts.raises) return loosening(root, rules, baselineFile, opts.raises);
  if (opts['write-rules']) {
    mkdirSync(dirname(join(root, RULES_DOC)), { recursive: true });
    writeFileSync(join(root, RULES_DOC), renderRulesDoc(rules, gates));
    console.log(`check-architecture: wrote ${RULES_DOC}.`);
    return 0;
  }
  if (opts.gates) {
    return runGates(
      root,
      gates,
      new Set((opts.skip ?? '').split(',').filter(Boolean))
    );
  }

  if (opts.staged) {
    const edits = unstagedGateEdits(root);
    if (edits.length > 0) {
      console.error(
        `check-architecture --staged: the gate's own code has unstaged edits (${edits.join(', ')}), so this commit can't be judged by the rules it carries. Stage them or stash them first.`
      );
      return 2;
    }
  }

  const source = opts.staged ? stagedSource(root) : treeSource(root);
  const results = collect(rules, source);

  // A rule whose scope matches nothing checks nothing: a typo'd glob or a
  // moved folder would otherwise pass forever.
  if (!source.changed) {
    const idle = rules.filter(
      (r) => (results.get(r.id)?.evaluated.size ?? 0) === 0
    );
    if (idle.length > 0) {
      console.error(
        `check-architecture: registry error: rule(s) ${idle.map((r) => r.id).join(', ')} match no tracked file. Fix the scope.`
      );
      return 2;
    }
  }

  if (opts.init) return init(root, baselineFile, rules, results, opts.rule);

  const baseline = readBaseline(
    source,
    root,
    baselineFile,
    Boolean(opts.staged)
  );

  if (opts.lower) {
    writeFileSync(
      join(root, baselineFile),
      serializeBaseline(lowerBaseline(rules, results, baseline))
    );
    console.log(
      `check-architecture: lowered ${baselineFile}. Re-run the check to confirm.`
    );
    return 0;
  }

  // Which unbanked fixes block: at commit time and in a pull request, those in
  // files the change touches; anywhere else, none (they are notices).
  let bankFails = () => false;
  let ci = null;
  if (opts.staged) {
    bankFails = (file) =>
      source.changed.has(file) || source.deleted.includes(file);
  }
  if (opts.ci) {
    ci = ciBase(root);
    if (ci.kind === 'pr' && ci.base) {
      const touched = touchedFiles(root, ci.base);
      bankFails = (file) => touched.has(file);
    }
  }

  const problems = compare(rules, results, baseline, source, { bankFails });
  const judged = [...results.values()].reduce(
    (n, r) => n + r.evaluated.size,
    0
  );
  let code = report(
    problems,
    `OK: ${results.size} of ${rules.length} rule(s) ran over ${judged} (rule, file) pair(s)${opts.staged ? ' in the staged changes' : ''}; nothing new against the baseline.`
  );

  if (ci) {
    if (ci.base)
      code = Math.max(code, loosening(root, rules, baselineFile, ci.base));
    else console.log(`note: no countersign check (${ci.note}).`);
  }
  return code;
}

/** --init [--rule ID]: the first baseline, or the first block for a rule added later. */
function init(root, baselineFile, rules, results, ruleId) {
  const path = join(root, baselineFile);
  if (!ruleId) {
    if (existsSync(path)) {
      console.error(
        `check-architecture: ${baselineFile} already exists. --init writes only the FIRST baseline; --init --rule <ID> seeds a new rule's block; --lower banks fixes.`
      );
      return 2;
    }
    const baseline = initialBaseline(rules, results);
    writeFileSync(path, serializeBaseline(baseline));
    const entries = Object.values(baseline).reduce(
      (n, pins) => n + Object.keys(pins).length,
      0
    );
    console.log(
      `check-architecture: wrote ${baselineFile} (${entries} entries).`
    );
    return 0;
  }
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) {
    console.error(`check-architecture: no rule ${ruleId} in the registry.`);
    return 2;
  }
  const baseline = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : {};
  if (baseline[ruleId] !== undefined) {
    console.error(
      `check-architecture: ${baselineFile} already has a ${ruleId} block; use --lower to bank fixes.`
    );
    return 2;
  }
  const block = initialBaseline([rule], results)[ruleId] ?? {};
  const next = {};
  for (const id of [...Object.keys(baseline), ruleId].sort())
    next[id] = id === ruleId ? block : baseline[id];
  writeFileSync(path, serializeBaseline(next));
  console.log(
    `check-architecture: seeded ${ruleId} (${Object.keys(block).length} entries). Countersign it in the commit: G0-RAISE: ${ruleId} * — <why this debt is accepted>`
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
