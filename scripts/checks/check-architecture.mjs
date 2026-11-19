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
 *   a pinned key gone, a size down FAIL in the commit or pull request that
 *                                        made the fix, until --lower banks it
 *                                        (so the freed headroom can't be spent
 *                                        later); a notice anywhere else. A
 *                                        commit made it if it stages the file;
 *                                        a pull request, if the violation was
 *                                        still there at its base
 *   a pinned file gone             same as a fix: --lower removes the entry
 *   equal                          pass
 *
 * In a pull request a pin also allows no more than the base still had (plus
 * any countersigned raise), so headroom a fix left unbanked on dev can't be
 * spent by a later change.
 *
 * A file the baseline doesn't list is allowed nothing, or the size limit for a
 * measuring rule. `--lower` only ever lowers or removes. Anything that LOOSENS
 * the gate (a raised or added pin, a new or renewed exception, a change to
 * what a gate runs) needs the owner's countersign: a `G0-RAISE:` trailer in a
 * commit message, checked by --ci (see architecture-raises.mjs).
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
 *                                   the pull request that made them, pins are
 *                                   capped at the base, and every loosening
 *                                   since the base is countersigned (judged by
 *                                   the base's copy of the gate too, when the
 *                                   change edits it)
 *   pnpm check:arch --raises <ref>  only the countersign check, against <ref>
 *   … --raises-ci                   the countersign check against the base
 *                                   this copy's own ciBase finds: how a newer
 *                                   copy calls the base's copy as its judge
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
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The gate's own modules load here, under a handler that exists only while
// they load: a syntax error in one of them must exit 2 ("the gate can't
// run"), never 1 ("you added a violation"). Plain `await import()` keeps every
// use visible to fallow.
const failToLoad = (err) => {
  console.error(
    `check-architecture: could not load the gate's modules: ${String(err?.message ?? err).split('\n')[0]}`
  );
  process.exit(2);
};
process.on('uncaughtException', failToLoad);
const { RULES_DOC, renderRulesDoc } = await import('./architecture-docs.mjs');
const { applyIgnores, IGNORE_KEYWORD, ignoreProblems, parseIgnores } =
  await import('./architecture-ignores.mjs');
const { globToRegExp } = await import('./architecture-lists.mjs');
const { MATCHERS } = await import('./architecture-matchers.mjs');
const {
  blockState,
  checkLoosening,
  ciBase,
  countersignsIn,
  GATE_DIR,
  GATE_ENTRY_PATHS,
  gateAt,
  gateDependencies,
  hashOf,
  isGateCode,
  pinState,
  renamesSince,
} = await import('./architecture-raises.mjs');
const { CI_CALLERS, GATES, RULES } = await import('./architecture-rules.mjs');
process.off('uncaughtException', failToLoad);

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const BASELINE_FILE = 'scripts/checks/architecture-baseline.json';

/** Hits printed per (rule, file); the count line still states the total. */
const MAX_HITS_SHOWN = 5;

// ---------------------------------------------------------------------------
// Globs
// ---------------------------------------------------------------------------

export { globToRegExp };

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

/**
 * `git ls-files -s` / `ls-tree` entries as { path, mode }. Every source reads
 * the same way: a submodule (160000) is not a file, and a symlink (120000) is
 * a path that exists but has no text, so the commit-time run and the full run
 * can't disagree about one.
 */
function entries(raw) {
  return splitZ(raw)
    .map((entry) => ({
      path: entry.slice(entry.indexOf('\t') + 1),
      mode: entry.slice(0, 6),
    }))
    .filter((e) => e.mode !== '160000');
}

function isFileInTree(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/** new -> old for every rename staged in the index. */
function stagedRenames(root) {
  const parts = splitZ(
    git(root, [
      'diff',
      '--cached',
      '-M',
      '--name-status',
      '-z',
      '--diff-filter=R',
    ])
  );
  const renames = new Map();
  for (let i = 0; i + 2 < parts.length; i += 3) {
    if (parts[i].startsWith('R')) renames.set(parts[i + 2], parts[i + 1]);
  }
  return renames;
}

/**
 * Every tracked file, read from the working tree. Tracked only, never untracked:
 * `--init` and `--lower` write the baseline from this list, and a baseline
 * built from a local scratch file would fail CI with a stale entry.
 */
export function treeSource(root = REPO_ROOT) {
  const links = new Set();
  const files = [];
  for (const { path, mode } of entries(
    git(root, ['ls-files', '-s', '-z', '--cached'])
  )) {
    if (mode === '120000') {
      links.add(path);
      files.push(path);
    } else if (isFileInTree(join(root, path))) {
      // ls-files still lists a file deleted in the tree but not yet staged
      files.push(path);
    }
  }
  const set = new Set(files);
  return {
    files,
    has: (f) => set.has(f),
    read: (f) => (links.has(f) ? '' : readFileSync(join(root, f), 'utf8')),
    changed: null,
    deleted: [],
    renames: new Map(),
  };
}

/** The index, as the next commit will hold it. */
export function stagedSource(root = REPO_ROOT) {
  const links = new Set();
  const files = [];
  for (const { path, mode } of entries(
    git(root, ['ls-files', '-s', '-z', '--cached'])
  )) {
    if (mode === '120000') links.add(path);
    files.push(path);
  }
  const diff = (filter) =>
    splitZ(
      git(root, [
        'diff',
        '--cached',
        '--name-only',
        '--no-renames', // a rename is a delete plus an add; `renames` pairs them
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
      if (links.has(f)) return '';
      if (!cache.has(f)) cache.set(f, git(root, ['show', `:${f}`]));
      return cache.get(f);
    },
    changed: new Set(diff('ACMT')),
    deleted: diff('D'),
    renames: stagedRenames(root),
  };
}

/**
 * A commit's tree, for judging a fix against the base. `judge` names the files
 * per-file rules evaluate; reads are lazy, so only what a rule needs is read.
 */
export function revSource(root, rev, judge) {
  const links = new Set();
  const files = [];
  for (const { path, mode } of entries(
    git(root, ['ls-tree', '-r', '-z', '--full-tree', rev])
  )) {
    if (mode === '120000') links.add(path);
    files.push(path);
  }
  const set = new Set(files);
  const cache = new Map();
  return {
    files,
    has: (f) => set.has(f),
    read: (f) => {
      if (links.has(f)) return '';
      if (!cache.has(f)) cache.set(f, git(root, ['show', `${rev}:${f}`]));
      return cache.get(f);
    },
    changed: new Set(judge),
    deleted: [],
    renames: new Map(),
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
    renames: new Map(Object.entries(commit?.renames ?? {})),
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

// NFC, as the baseline stores keys (serializeBaseline), so a decomposed
// character in a file can't read as a new key and a fixed one at once.
const keyOf = (hit) => (hit.key ?? hit.text).normalize('NFC');

/**
 * Every difference between what was found and what the baseline allows.
 *
 * A measuring rule pins a number per file. Any other rule pins the KEY of each
 * violation it allows (the call and the function it sits in, the dead link's
 * target), so a fixed violation can't pay for a new one in the same file: the
 * new one's key isn't pinned, and it fails even when the count is unchanged.
 * A file the change RENAMED is judged against its old path's pin.
 *
 * A fix that hasn't been banked with --lower is `blocking` only where
 * `bankFails(file)` says so (at commit time, the staged files). In a pull
 * request the runner then decides against the base (judgeFixesAtBase).
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
  const renames = source.renames ?? new Map();
  for (const rule of rules) {
    const result = results.get(rule.id);
    if (!result) continue;
    const pins = baseline[rule.id] ?? {};
    if (rule.baseline === false && Object.keys(pins).length > 0) {
      problems.push({
        type: 'unpinnable',
        rule,
        ruleId: rule.id,
        file: Object.keys(pins)[0],
        blocking: true,
      });
    }
    const measuring = isMeasuring(rule);
    const carried = new Set();
    for (const file of result.evaluated) {
      const { found, hits } = result.perFile.get(file) ?? {
        found: 0,
        hits: [],
      };
      const base = { rule, ruleId: rule.id, file, found, hits };
      let pinned = pins[file];
      const from = renames.get(file);
      if (
        pinned === undefined &&
        from !== undefined &&
        pins[from] !== undefined &&
        !result.evaluated.has(from)
      ) {
        pinned = pins[from];
        carried.add(from);
        bank({ ...base, type: 'moved', from, allowed: pinned, hits: [] });
      }
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
        // Every hit that shares an added key is shown: which of two identical
        // calls is the new one, only the diff knows.
        const addedKeys = new Set(added);
        problems.push({
          ...base,
          type: pinned === undefined ? 'new' : 'more',
          allowed: allowedKeys.length,
          added: added.length,
          hits: hits.filter((h) => addedKeys.has(keyOf(h))),
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
      if (result.evaluated.has(file) || carried.has(file)) continue;
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
      // At commit time a rule may read a file the commit doesn't touch (a
      // whole-repo rule, the docs index); only the committed files' own
      // exceptions are judged there.
      judged: (file) => !source.changed || source.changed.has(file),
      today,
    })) {
      problems.push({ ...p, blocking: true });
    }
  }
  return problems;
}

/** A count where keys belong: the old format, convertible without raising. */
const isLegacyCount = (pin) => Number.isInteger(pin) && pin >= 0;

/**
 * The baseline with every fixed or vanished violation banked. Never raises,
 * never adds. A block for a rule the registry doesn't define is copied through
 * untouched: removing it is a hand edit that review sees. A renamed file's pin
 * moves to its new path. At commit time (`source.changed` set) a pin for a
 * file the commit doesn't touch is kept as it is.
 */
export function lowerBaseline(rules, results, baseline, source = {}) {
  const renames = source.renames ?? new Map();
  const movedTo = new Map([...renames].map(([to, from]) => [from, to]));
  const partial = Boolean(source.changed);
  const next = {};
  const put = (ruleId, file, pin) => {
    next[ruleId] ??= {};
    next[ruleId][file] = pin;
  };
  for (const [ruleId, pins] of Object.entries(baseline)) {
    const rule = rules.find((r) => r.id === ruleId);
    const result = rule && results.get(ruleId);
    if (!result) {
      next[ruleId] = pins;
      continue;
    }
    for (const [pinnedAt, pinned] of Object.entries(pins)) {
      let file = pinnedAt;
      if (!result.evaluated.has(file)) {
        const to = movedTo.get(file);
        if (to && result.evaluated.has(to) && pins[to] === undefined) file = to;
        else {
          const gone = !partial || (source.deleted ?? []).includes(file);
          if (!gone) put(ruleId, file, pinned);
          continue;
        }
      }
      const entry = result.perFile.get(file) ?? { found: 0, hits: [] };
      if (isMeasuring(rule)) {
        if (!Number.isInteger(pinned)) {
          put(ruleId, file, pinned); // a format problem; --lower won't guess
          continue;
        }
        const kept = Math.min(entry.found, pinned);
        if (kept > defaultAllowed(rule, file)) put(ruleId, file, kept);
        continue;
      }
      const foundKeys = entry.hits.map(keyOf).sort();
      let kept;
      if (Array.isArray(pinned)) {
        kept = minus(pinned, minus(pinned, foundKeys)).sort();
      } else if (isLegacyCount(pinned)) {
        // at most that many keys; any found beyond it then fail as new
        kept = foundKeys.slice(0, pinned);
      } else {
        put(ruleId, file, pinned); // a format problem; --lower won't guess
        continue;
      }
      if (kept.length > 0) put(ruleId, file, kept);
    }
  }
  return sortBaseline(next);
}

/** A baseline block per rule: every count above its default, or every violation's key. */
export function initialBaseline(rules, results) {
  const next = {};
  for (const rule of rules) {
    if (rule.baseline === false) continue; // its drift is fixed, never held
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

/**
 * In a pull request, an unbanked fix blocks only when THIS change made it:
 * the violation still existed at the base (owner, 18 Nov). So a fix made from
 * another file (a dead link's target created) must be banked by the PR that
 * made it, and fixes already left unbanked on dev stay notices, so two PRs
 * can't merge into a red dev and a release PR isn't blocked by others' fixes.
 * The base is measured only for the files with a notice.
 */
export function judgeFixesAtBase(
  rules,
  problems,
  { baseSource, baseBaseline, renames = new Map() }
) {
  const notices = problems.filter(
    (p) => !p.blocking && ['fewer', 'remove', 'stale', 'moved'].includes(p.type)
  );
  if (notices.length === 0) return;
  const atBase = (file) => renames.get(file) ?? file;
  baseSource.changed = new Set(notices.map((p) => atBase(p.file)));
  const ruleSet = rules.filter((r) => notices.some((p) => p.ruleId === r.id));
  const baseResults = collect(ruleSet, baseSource);
  for (const p of notices) {
    const result = baseResults.get(p.ruleId);
    const file = atBase(p.file);
    if (!result && p.type === 'stale' && !baseSource.has(file)) {
      // A whole-repo rule doesn't run over a base the notices don't touch;
      // a pin whose file was already gone at the base is dev's to bank.
      continue;
    }
    if (!result) {
      p.blocking = true; // couldn't measure the base: never assume the fix is old
      continue;
    }
    const was = result.perFile.get(file);
    if (p.type === 'moved') {
      p.blocking = true; // this change made the rename
    } else if (p.type === 'stale') {
      p.blocking = result.evaluated.has(file);
    } else if (isMeasuring(p.rule)) {
      p.blocking = p.found < Math.min(was?.found ?? Infinity, p.allowed);
    } else {
      const pinnedAtBase = baseBaseline[p.ruleId]?.[file];
      const unbankedAtBase = Array.isArray(pinnedAtBase)
        ? minus(pinnedAtBase, (was?.hits ?? []).map(keyOf))
        : [];
      p.blocking = minus(p.fixed, unbankedAtBase).length > 0;
    }
  }
}

/**
 * In a pull request, a pin allows no more than the base still had, plus what
 * this change raised it by (a raise is countersigned, in checkLoosening). A
 * pin dev left stale (a fix nobody banked: a trunk push only notes it) is
 * headroom nothing uses, and a later change must not spend it: re-adding a
 * violation dev had lost would pass against the pin alone. Only a file this
 * change reads differently can spend it, but a rule may read other files (a
 * link's target), so every file holding pinned debt is measured at the base.
 *
 * @returns {object[]} a blocking 'spent' problem per (rule, file)
 */
export function spentAtBase(
  rules,
  results,
  baseline,
  { baseSource, baseBaseline, renames = new Map() }
) {
  const atBase = (file) => renames.get(file) ?? file;
  const candidates = [];
  for (const rule of rules) {
    const result = results.get(rule.id);
    const pins = baseline[rule.id];
    if (!result || !pins || rule.baseline === false) continue;
    for (const file of result.evaluated) {
      const from = renames.get(file);
      const pinned =
        pins[file] ??
        (from !== undefined && !result.evaluated.has(from)
          ? pins[from]
          : undefined);
      if (pinned === undefined) continue;
      const { found, hits } = result.perFile.get(file) ?? {
        found: 0,
        hits: [],
      };
      if (isMeasuring(rule)) {
        if (!Number.isInteger(pinned)) continue; // a format problem already
        if (found > defaultAllowed(rule, file) && found <= pinned) {
          candidates.push({ rule, file, pinned, found, hits });
        }
      } else if (Array.isArray(pinned)) {
        const foundKeys = hits.map(keyOf);
        const within = minus(foundKeys, minus(foundKeys, pinned));
        if (within.length > 0) {
          candidates.push({ rule, file, pinned, found, hits, within });
        }
      }
    }
  }
  if (candidates.length === 0) return [];
  baseSource.changed = new Set(candidates.map((c) => atBase(c.file)));
  const ruleSet = rules.filter((r) => candidates.some((c) => c.rule === r));
  const baseResults = collect(ruleSet, baseSource);
  const problems = [];
  for (const c of candidates) {
    const file = atBase(c.file);
    const basePin = baseBaseline[c.rule.id]?.[file];
    if (basePin === undefined) continue; // the whole pin is this change's raise
    const was = baseResults.get(c.rule.id)?.perFile.get(file) ?? {
      found: 0,
      hits: [],
    };
    const base = {
      rule: c.rule,
      ruleId: c.rule.id,
      file: c.file,
      found: c.found,
      type: 'spent',
      blocking: true,
      atBase: was.found,
      pinned: c.pinned,
      // Growing into a stale pin loosens as a raise does, so the same
      // countersign covers it: the pin's own hash (owner, 19 Nov).
      sign: `${c.rule.id} ${c.file}@${pinState(c.pinned)}`,
    };
    if (isMeasuring(c.rule)) {
      if (!Number.isInteger(basePin)) continue; // a format problem at the base
      // A countersigned raise adds to what the base still had, never to the
      // stale headroom above it, as a key rule's raise does.
      const allowed = Math.min(
        c.pinned,
        Math.max(was.found, defaultAllowed(c.rule, c.file)) +
          Math.max(0, c.pinned - basePin)
      );
      if (c.found > allowed) problems.push({ ...base, allowed, hits: [] });
      continue;
    }
    if (!Array.isArray(basePin)) continue; // a legacy count: --lower converts it
    const raised = minus(c.pinned, basePin);
    const room = [...was.hits.map(keyOf), ...raised];
    const allowedKeys = minus(c.pinned, minus(c.pinned, room));
    const spent = minus(c.within, allowedKeys);
    if (spent.length === 0) continue;
    const spentKeys = new Set(spent);
    problems.push({
      ...base,
      allowed: allowedKeys.length,
      added: spent.length,
      spent,
      hits: c.hits.filter((h) => spentKeys.has(keyOf(h))),
    });
  }
  return problems;
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
 * How wide biome counts a string: a wide East Asian character is two columns,
 * a combining mark none. Keys come from file content, so they can hold either.
 */
function displayWidth(text) {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (/\p{M}/u.test(ch)) continue;
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x20000 && cp <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

/**
 * The baseline as biome formats it, so `--lower` and the commit hook's
 * `biome check --write` never fight over it: objects one key per line, and a
 * key array on one line when it fits in 80 columns, else one key per line.
 * Keys are NFC-normalised, because biome rewrites a decomposed character.
 */
export function serializeBaseline(baseline) {
  const q = (v) =>
    JSON.stringify(typeof v === 'string' ? v.normalize('NFC') : v);
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
      if (displayWidth(flat) <= JSON_WIDTH) {
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

/** Where a problem is: each hit's line and text, up to MAX_HITS_SHOWN, or the file alone. */
function hitLines(p) {
  const shown = p.hits.slice(0, MAX_HITS_SHOWN);
  if (shown.length === 0) return [`  ${p.file}`];
  const out = [];
  for (const hit of shown) {
    out.push(`  ${p.file}:${hit.line}`);
    if (hit.text) out.push(`      ${hit.text}`);
  }
  if (p.hits.length > shown.length) {
    out.push(`  … and ${p.hits.length - shown.length} more in this file`);
  }
  return out;
}

/**
 * Everything an agent needs to correct itself, per problem: which rule, where,
 * the one fix, where the rule is written, and how this file compares with the
 * debt it was already allowed. That last line is what makes an agent fix what
 * it just introduced instead of trying to clear the whole baseline. At commit
 * time (`staged`) the banking command is the one that banks the index.
 */
export function formatProblems(problems, { staged = false } = {}) {
  const lower = staged
    ? 'pnpm check:arch --lower --staged'
    : 'pnpm check:arch --lower';
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
        '  Remove that block from the baseline by hand (the owner countersigns it).',
        ''
      );
      continue;
    }
    const { rule } = p;
    lines.push(`  [${rule.id}] ${rule.title}`);
    if (p.type === 'unpinnable') {
      lines.push(
        `  ${rule.id} can't be held in the baseline: its drift is fixed, never pinned. Fix it, then delete the ${rule.id} block from the baseline by hand.`,
        ''
      );
      continue;
    }
    if (p.type === 'format') {
      lines.push(
        isMeasuring(rule)
          ? `  ${p.file}: the baseline pin must be a whole number (${p.rule.match.kind} measures ${MATCHERS[rule.match.kind].unit}). Fix the JSON by hand.`
          : `  ${p.file}: the baseline holds a count where this rule pins violation keys. Convert it: ${lower}`,
        ''
      );
      continue;
    }
    if (p.type === 'new' || p.type === 'more') {
      lines.push(...hitLines(p));
      let tally;
      if (isMeasuring(rule)) {
        tally = `allowed in this file: ${amount(rule, p.allowed)}, found: ${amount(rule, p.found)}`;
      } else if (p.hits.length > p.added) {
        tally = `these ${p.hits.length} share a key the baseline pins fewer of; ${p.added} of them ${p.added === 1 ? 'is' : 'are'} new`;
      } else {
        tally = `the baseline pins ${p.allowed} in this file; ${p.added} found here ${p.added === 1 ? "isn't" : "aren't"} among them`;
      }
      lines.push(
        `  Fix: ${rule.fix}`,
        `  Rule: ${ruleAnchor(rule)}  ·  ${tally}`,
        ''
      );
      continue;
    }
    if (p.type === 'spent') {
      lines.push(...hitLines(p));
      const was = isMeasuring(rule)
        ? `the base measures ${amount(rule, p.atBase)} where the baseline pins ${amount(rule, p.pinned)}, so this change may have ${amount(rule, p.allowed)}; it has ${amount(rule, p.found)}`
        : `the base no longer had ${p.spent.map((k) => JSON.stringify(k)).join(', ')}, though the baseline still pins ${p.spent.length === 1 ? 'it' : 'them'}`;
      lines.push(
        `  This fits the pin only because a fix was left unbanked before this change: ${was}.`,
        `  Fix: ${rule.fix} (The stale pin is banked by ${lower} once the violation is gone.)`,
        ...(p.blocking
          ? [
              `  Or the owner accepts it, as a raise of that pin: G0-RAISE: ${p.sign} — <why>`,
            ]
          : []),
        `  Rule: ${ruleAnchor(rule)}`,
        ''
      );
      continue;
    }
    if (p.type === 'moved') {
      lines.push(
        `  ${p.file}: renamed from ${p.from}, whose pin it now carries. Move the pin in the baseline: ${lower}`,
        ''
      );
      continue;
    }
    if (p.type === 'fewer' || p.type === 'remove') {
      const what = p.fixed
        ? `fixed ${p.fixed.map((k) => JSON.stringify(k)).join(', ')}`
        : `allowed ${amount(rule, p.allowed)}, found ${amount(rule, p.found)}`;
      lines.push(`  ${p.file}: ${what}. Bank the fix: ${lower}`, '');
      continue;
    }
    lines.push(
      `  ${p.file} is gone or out of scope, but the baseline still lists it. Remove it: ${lower}`,
      ''
    );
  }
  return lines.join('\n');
}

function report(problems, okLine, { staged = false } = {}) {
  const blocking = problems.filter((p) => p.blocking);
  const spent = problems.filter((p) => !p.blocking && p.type === 'spent');
  const notices = problems.filter((p) => !p.blocking && p.type !== 'spent');
  if (notices.length > 0) {
    console.log(
      `note: ${notices.length} fixed violation(s) not yet banked. They block only the commit or pull request that made the fix; pnpm check:arch --lower banks them:`
    );
    console.log(formatProblems(notices, { staged }));
  }
  if (spent.length > 0) {
    console.log(
      `note: ${spent.length} file(s) grow into a pin above what the base measured. The pull request into dev judged them:`
    );
    console.log(formatProblems(spent, { staged }));
  }
  if (blocking.length > 0) {
    console.error(`✗ check-architecture: ${blocking.length} problem(s)`);
    console.error(formatProblems(blocking, { staged }));
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
  '--raises-ci',
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
  // --lower --staged is one mode: bank the fixes the index holds.
  const modes = [...MODE_FLAGS.map((f) => f.slice(2)), 'raises'].filter(
    (m) => opts[m] && !(m === 'staged' && opts.lower)
  );
  if (modes.length > 1)
    throw new UsageError(`--${modes.join(' and --')} are exclusive`);
  if (opts.rule && !opts.init) throw new UsageError('--rule goes with --init');
  if (opts.skip && !opts.gates)
    throw new UsageError('--skip goes with --gates');
  return opts;
}

function parseBaseline(text, file) {
  if (text === null) return {};
  try {
    return JSON.parse(text, (_, v) =>
      typeof v === 'string' ? v.normalize('NFC') : v
    );
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message})`);
  }
}

function readBaseline(source, root, file, staged) {
  if (staged)
    return parseBaseline(source.has(file) ? source.read(file) : null, file);
  const path = join(root, file);
  return parseBaseline(
    existsSync(path) ? readFileSync(path, 'utf8') : null,
    file
  );
}

/**
 * The baseline at a commit, or {} where the commit has none. Any other git
 * failure throws (exit 2): an unreadable base must not read as "no pins".
 */
function baselineAt(root, rev, file) {
  const has = spawnSync('git', ['cat-file', '-e', `${rev}:${file}`], {
    cwd: root,
  });
  if (has.status !== 0) {
    const commit = spawnSync('git', ['cat-file', '-e', `${rev}^{commit}`], {
      cwd: root,
    });
    if (commit.status !== 0) throw new Error(`${rev} is not a commit`);
    return {};
  }
  const r = spawnSync('git', ['show', `${rev}:${file}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(
      `git show ${rev}:${file} failed: ${(r.stderr ?? r.error?.message ?? '').trim()}`
    );
  }
  return parseBaseline(r.stdout, `${file} at ${rev}`);
}

/**
 * --gates [--skip IDS]: run every CI static gate the registry lists, in order,
 * the way the static-analysis job does. gate.sh calls it with --skip for the
 * gates it has just run itself, so a gate added to CI can't be skipped locally
 * (Codex-kxdz9). A gate whose every command was skipped is not counted as
 * passed.
 */
function runGates(root, gates, skip) {
  const unknown = [...skip].filter((id) => !gates.some((g) => g.id === id));
  if (unknown.length > 0) {
    console.error(
      `check-architecture --gates: --skip names no gate: ${unknown.join(', ')}. The gates are ${gates.map((g) => g.id).join(', ')}.`
    );
    return 2;
  }
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
  if (ran === 0) {
    console.error(
      'check-architecture --gates: no gate ran, so nothing was checked.'
    );
    return 2;
  }
  console.log(
    `OK: ${ran} CI static gate(s) passed locally${skip.size ? ` (${[...skip].join(', ')} skipped)` : ''}.`
  );
  return 0;
}

/** Shell-quote one argument for the one-liner the owner pastes. */
const shellArg = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The countersign check against `base`. In a pull request into dev it fails
 * on anything unsigned; on a push to dev or main, or a release PR, it only
 * notes it (`notice`), because two PRs that each signed the same file make a
 * merged state neither signed (owner, 19 Nov).
 */
function loosening(
  root,
  registry,
  baselineFile,
  base,
  { notice = false } = {}
) {
  const { skipped, missing, byAgent, unbound } = checkLoosening(
    root,
    registry,
    baselineFile,
    base
  );
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
  const lines = [
    `${notice ? 'note' : '✗ check-architecture'}: ${missing.length} loosening(s) since ${base} have no countersign from the owner at their current content.`,
  ];
  if (notice) {
    lines.push(
      '  Each pull request into dev was where these were judged; here they are only noted.'
    );
  } else {
    lines.push(
      '  A raised baseline pin, a new or moved exception, or a change to what a gate runs loosens it.',
      '  Only the OWNER can countersign: a G0-RAISE trailer counts only in a commit with no',
      '  Co-Authored-By: Claude line, and it covers the item only at the @hash it names, so any',
      '  later change to that item (an amend, a merge from the base) needs a new one. An agent',
      '  must stop and ask the owner to write each reason and run this in the checkout (the',
      '  <why> placeholders do not count):',
      `    ! git commit --allow-empty -m 'G0 countersign' ${missing.map((m) => `-m ${shellArg(m.line)}`).join(' ')}`
    );
  }
  lines.push('  What each one loosens:');
  for (const m of missing) {
    lines.push(`    ${m.line}`, ...m.what.map((w) => `        ${w}`));
  }
  if (byAgent.length > 0) {
    lines.push(
      `  Trailers in agent commits (${byAgent.join(', ')}) were not counted.`
    );
  }
  if (unbound.length > 0) {
    lines.push(
      `  These owner trailers name no @hash, so they cover nothing: ${unbound.join('; ')}.`
    );
  }
  lines.push('  Rule: docs/architecture/rules.md#raises');
  (notice ? console.log : console.error)(lines.join('\n'));
  return notice ? 0 : 1;
}

/**
 * Unstaged or untracked edits to the gate's own code would make --staged
 * judge with rules the commit doesn't carry.
 */
function unstagedGateEdits(root, baselineFile) {
  const r = spawnSync(
    'git',
    ['status', '--porcelain', '-z', '--untracked-files=all'],
    { cwd: root, encoding: 'utf8' }
  );
  if (r.status !== 0) {
    throw new Error(`git status failed: ${(r.stderr ?? '').trim()}`);
  }
  return r.stdout
    .split('\0')
    .filter(Boolean)
    .filter((entry) => {
      const xy = entry.slice(0, 2);
      const path = entry.slice(3);
      const untracked = xy === '??';
      const unstaged = xy[1] !== ' ';
      return (
        (untracked || unstaged) &&
        (isGateCode(path, baselineFile) ||
          (untracked && path.startsWith(GATE_DIR)))
      );
    })
    .map((entry) => entry.slice(3));
}

/**
 * A pull request's base must be a real ancestor of what CI checked out, and
 * not that commit itself: a ciBase bug that compared HEAD with HEAD would
 * otherwise pass every check while judging nothing.
 */
function verifyBase(root, ci) {
  if (!ci.base || (ci.kind !== 'pr' && ci.kind !== 'release')) return;
  const sha = (ref) =>
    spawnSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
      cwd: root,
      encoding: 'utf8',
    }).stdout.trim();
  if (sha(ci.base) === sha('HEAD')) {
    throw new Error(
      `the pull request's base ${ci.base} is HEAD itself, so nothing would be judged`
    );
  }
  const ancestor = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', ci.base, 'HEAD'],
    { cwd: root }
  );
  if (ancestor.status !== 0) {
    throw new Error(
      `the pull request's base ${ci.base} is not an ancestor of HEAD`
    );
  }
}

/**
 * The sign that lets the owner merge past a base copy that cannot run. It
 * covers that base and the gate code as it stands, so a further edit to the
 * gate after the owner signed asks again (review round 5).
 */
function baseJudgeKey(root, base, baselineFile) {
  const files = spawnSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .stdout.split('\0')
    .filter((f) => f && isGateCode(f, baselineFile))
    .sort();
  const code = files.map((f) => {
    const path = join(root, f);
    return `${f}\n${existsSync(path) ? readFileSync(path, 'utf8') : ''}`;
  });
  return `GATE base-judge@${hashOf([base, ...code].join('\0'))}`;
}

/**
 * When a change edits the gate's own code, the BASE commit's copy of the gate
 * judges it too, so a bug in the new copy (a file it stops treating as gate
 * code, a check that stops matching) can't approve itself (owner, 18 Nov).
 * The base's gate folder is extracted to a temporary directory and run over
 * this checkout as data, with its own registry, in two passes:
 *
 *   --raises-ci   the countersigns, against the base the BASE copy finds
 *                 itself, so one bug in this copy's ciBase can't switch off
 *                 both judges
 *   (full run)    the base's rules over this tree: anything it finds is
 *                 listed for the GATE countersign (owner, 19 Nov), so the
 *                 owner sees what the new gate stops catching. Not blocking.
 *
 * Its argv (--root, --raises-ci, --baseline) is a contract with every older
 * copy: never rename those flags. When the base copy can't run at all, the
 * owner can sign `G0-RAISE: GATE base-judge@<base> — <why>` to merge past it.
 * It needs only node, so it runs before `pnpm install`.
 */
function baseGateJudges(root, base, baselineFile) {
  const gitIn = (args, input) =>
    spawnSync('git', args, {
      cwd: root,
      input,
      maxBuffer: 256 * 1024 * 1024,
    });
  const entry = gateAt(
    root,
    base,
    renamesSince(root, base).get(baselineFile) ?? baselineFile
  );
  const dirs = [
    ...new Set([GATE_DIR, ...GATE_ENTRY_PATHS.map((p) => `${dirname(p)}/`)]),
  ];
  // The baseline is data the new copy judges pin by pin, not gate code: a
  // bank or a raise alone runs no base copy.
  const diff = gitIn([
    'diff',
    '--quiet',
    base,
    '--',
    ...dirs,
    `:(exclude)${baselineFile}`,
  ]);
  if (diff.status === 0) return 0; // the gate is the base's own
  if (diff.status !== 1) {
    throw new Error(`git diff ${base} -- ${dirs.join(' ')} failed`);
  }
  if (!entry) {
    console.log(
      `note: ${base} has no architecture gate yet, so only this copy judges its countersigns.`
    );
    return 0;
  }
  const dir = mkdtempSync(join(tmpdir(), 'g0-base-gate-'));
  try {
    const archive = gitIn([
      'archive',
      '--format=tar',
      base,
      `${dirname(entry)}/`,
    ]);
    if (archive.status !== 0) throw new Error(`git archive ${base} failed`);
    const untar = spawnSync('tar', ['-x', '-C', dir], {
      input: archive.stdout,
    });
    if (untar.status !== 0) {
      throw new Error('tar could not unpack the base gate');
    }
    const copy = join(dir, entry);
    const common = ['--root', root, '--baseline', baselineFile];
    console.log(
      `The gate's own code changed since ${base}, so its copy there (${entry}) judges the countersigns too:`
    );
    const judged = spawnSync(
      process.execPath,
      [copy, '--raises-ci', ...common],
      { cwd: root, stdio: 'inherit' }
    );
    if (judged.status !== 0 && judged.status !== 1) {
      const key = baseJudgeKey(root, base, baselineFile);
      if (countersignsIn(root, base).signed.has(key)) {
        console.log(
          `note: the base's copy could not run (exit ${judged.status ?? judged.signal}); the owner signed ${key} for this gate code.`
        );
        return 0;
      }
      throw new Error(
        `the base's copy of the gate could not run (exit ${judged.status ?? judged.signal}). If that is the change itself (a flag or an import the base can't follow), the owner can sign past it for this gate code: G0-RAISE: ${key} — <why>`
      );
    }
    const full = spawnSync(process.execPath, [copy, ...common], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (full.status !== 0) {
      const shown = `${full.stdout}${full.stderr}`.trimEnd().split('\n');
      console.log(
        [
          `note: the base's copy of the gate, run over this change, finds what is listed below (exit ${full.status}). The GATE countersign covers it: read it before signing.`,
          ...shown.slice(0, 60).map((l) => `  | ${l}`),
          ...(shown.length > 60
            ? [`  | … and ${shown.length - 60} more lines`]
            : []),
        ].join('\n')
      );
    }
    return judged.status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The renames since the baseline last changed, so --lower moves a renamed
 * file's pin. Any rename since then can only have left a pin at its old path.
 */
function baselineRenames(root, baselineFile) {
  const last = spawnSync(
    'git',
    ['log', '-1', '--format=%H', '--', baselineFile],
    { cwd: root, encoding: 'utf8' }
  );
  if (last.status !== 0) {
    throw new Error(`git log -- ${baselineFile} failed: ${last.stderr.trim()}`);
  }
  const since = last.stdout.trim();
  return since ? renamesSince(root, since) : new Map();
}

/** Whether a tracked file's working copy differs from the index. */
function hasUnstagedEdits(root, file) {
  const r = spawnSync('git', ['diff', '--quiet', '--', file], { cwd: root });
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`git diff -- ${file} failed`);
  }
  return r.status === 1;
}

/** Whether a file exists in the working tree but is not in the index. */
function untrackedHere(root, file) {
  if (!existsSync(join(root, file))) return false;
  return (
    spawnSync('git', ['ls-files', '--error-unmatch', '--', file], {
      cwd: root,
    }).status !== 0
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

/**
 * Every include glob must match a tracked file: a typo'd one checks nothing.
 * A glob the registry lists in `scope.optional` (with its reason) is waiting
 * for files that don't exist yet.
 */
function idleGlobs(rules, files) {
  const idle = [];
  for (const rule of rules) {
    const optional = new Set(rule.scope?.optional ?? []);
    for (const glob of rule.scope?.include ?? ['**']) {
      if (optional.has(glob)) continue;
      if (!files.some((f) => matchesGlob(f, glob)))
        idle.push(`${rule.id} ${glob}`);
    }
  }
  return idle;
}

async function run(opts) {
  const root = opts.root ? resolve(opts.root) : REPO_ROOT;
  const baselineFile = opts.baseline ?? BASELINE_FILE;
  const registry = opts.rules
    ? await import(pathToFileURL(resolve(opts.rules)).href)
    : { RULES, GATES, CI_CALLERS };
  const rules = registry.RULES;
  const gates = registry.GATES ?? [];
  const forLoosening = { rules, gates, callers: registry.CI_CALLERS ?? [] };
  try {
    validateRules(rules);
  } catch (err) {
    console.error(`check-architecture: registry error: ${err.message}`);
    return 2;
  }

  if (opts.raises)
    return loosening(root, forLoosening, baselineFile, opts.raises);
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
  // How a newer copy of the gate calls this one, as the base's judge: the
  // base is found HERE, by this copy's own ciBase.
  if (opts['raises-ci']) {
    const ci = ciBase(root);
    if (!ci.base) {
      console.log(`note: no countersign check (${ci.note}).`);
      return 0;
    }
    verifyBase(root, ci);
    return loosening(root, forLoosening, baselineFile, ci.base, {
      notice: ci.kind === 'trunk' || ci.kind === 'release',
    });
  }

  const source = opts.staged ? stagedSource(root) : treeSource(root);

  if (opts.staged) {
    // An empty commit (the owner's countersign) has nothing to judge.
    if (
      !opts.lower &&
      source.changed.size === 0 &&
      source.deleted.length === 0
    ) {
      console.log('OK: nothing staged for the architecture gate to judge.');
      return 0;
    }
    const edits = unstagedGateEdits(root, baselineFile);
    if (edits.length > 0) {
      console.error(
        `check-architecture --staged: the gate's own code has unstaged or untracked edits (${edits.join(', ')}), so this commit can't be judged by the rules it carries. Stage them or stash them first.`
      );
      return 2;
    }
    if (
      opts.lower &&
      (hasUnstagedEdits(root, baselineFile) ||
        untrackedHere(root, baselineFile))
    ) {
      console.error(
        `check-architecture --lower --staged: ${baselineFile} has edits the index doesn't hold (or isn't staged at all), which banking the index would overwrite. Stage it (git add) or discard the edits first.`
      );
      return 2;
    }
  }

  if (!opts.staged) {
    const idle = idleGlobs(rules, source.files);
    if (idle.length > 0) {
      console.error(
        `check-architecture: registry error: these scope globs match no tracked file, so they check nothing: ${idle.join('; ')}. Fix the scope.`
      );
      return 2;
    }
    // A gate part that is no tracked file is fingerprinted as nothing: a
    // typo'd `files` entry, or a command form the reader got wrong.
    const missing = gateDependencies(gates, {
      files: source.files,
      read: (f) => (source.has(f) ? source.read(f) : null),
    }).filter((part) => !source.has(part.file));
    if (missing.length > 0) {
      console.error(
        `check-architecture: registry error: these files a gate runs or reads are not tracked, or a gate command can't be read, so a change to them could never need a countersign: ${missing.map((p) => p.label).join('; ')}. Fix the gate's command, files or ratchets.`
      );
      return 2;
    }
  }

  // --ci: where the change starts, and the renames since then.
  let ci = null;
  if (opts.ci) {
    ci = ciBase(root);
    verifyBase(root, ci);
    if (ci.base) source.renames = renamesSince(root, ci.base);
  }

  const results = collect(rules, source);
  if (opts.init) return init(root, baselineFile, rules, results, opts.rule);

  const baseline = readBaseline(
    source,
    root,
    baselineFile,
    Boolean(opts.staged)
  );

  if (opts.lower) {
    if (!opts.staged) source.renames = baselineRenames(root, baselineFile);
    const lowered = serializeBaseline(
      lowerBaseline(rules, results, baseline, source)
    );
    writeFileSync(join(root, baselineFile), lowered);
    if (opts.staged) {
      const added = spawnSync('git', ['add', '--', baselineFile], {
        cwd: root,
      });
      if (added.status !== 0) throw new Error(`git add ${baselineFile} failed`);
      console.log(
        `check-architecture: banked the staged fixes in ${baselineFile} and staged it.`
      );
    } else {
      console.log(
        `check-architecture: lowered ${baselineFile}. Re-run the check to confirm.`
      );
    }
    return 0;
  }

  // At commit time an unbanked fix blocks in the files the commit touches. In
  // a pull request (or a local --ci) it blocks when this change made it,
  // judged against the base. A push to dev or main, or a release PR, only
  // notes a fix. Wherever there is a base but trunk, a pin allows no more
  // than the base still had.
  const bankFails = opts.staged
    ? (file) => source.changed.has(file) || source.deleted.includes(file)
    : () => false;
  const problems = compare(rules, results, baseline, source, { bankFails });
  if (ci?.base && ci.kind !== 'trunk') {
    const atBase = {
      baseSource: revSource(root, ci.base, []),
      baseBaseline: baselineAt(
        root,
        ci.base,
        source.renames.get(baselineFile) ?? baselineFile
      ),
      renames: source.renames,
    };
    if (ci.kind === 'pr' || ci.kind === 'branch') {
      judgeFixesAtBase(rules, problems, atBase);
    }
    const spent = spentAtBase(rules, results, baseline, atBase);
    if (spent.length > 0) {
      const { signed } = countersignsIn(root, ci.base);
      for (const p of spent) {
        if (signed.has(p.sign)) continue; // the owner accepted it
        p.blocking = ci.kind !== 'release';
        problems.push(p);
      }
    }
  }
  const judged = [...results.values()].reduce(
    (n, r) => n + r.evaluated.size,
    0
  );
  let code = report(
    problems,
    `OK: ${results.size} of ${rules.length} rule(s) ran over ${judged} (rule, file) pair(s)${opts.staged ? ' in the staged changes' : ''}; nothing new against the baseline.`,
    { staged: Boolean(opts.staged) }
  );

  if (ci) {
    if (ci.base) {
      code = Math.max(
        code,
        loosening(root, forLoosening, baselineFile, ci.base, {
          notice: ci.kind === 'trunk' || ci.kind === 'release',
        }),
        baseGateJudges(root, ci.base, baselineFile)
      );
    } else console.log(`note: no countersign check (${ci.note}).`);
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
  if (rule.baseline === false) {
    console.error(
      `check-architecture: ${ruleId} can't be held in the baseline: its drift is fixed, never pinned.`
    );
    return 2;
  }
  const baseline = parseBaseline(
    existsSync(path) ? readFileSync(path, 'utf8') : null,
    baselineFile
  );
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
    `check-architecture: seeded ${ruleId} (${Object.keys(block).length} entries). The owner countersigns it: G0-RAISE: ${ruleId} *@${blockState(block)} — <why this debt is accepted>`
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
