/**
 * Countersigned loosening (G0 WP-7, hardened after review, Codex-xtcfl.7).
 *
 * The ratchet only holds if nothing loosens it quietly. pstack's rule:
 * "Anything that loosens a gate … needs a verifier's proof and then your fresh
 * countersign, because the owner is the one who wants green." There are three
 * ways to loosen this gate, and each needs a countersign:
 *
 *   1. raise a baseline entry, or add one      G0-RAISE: <RULE> <file> — <reason>
 *      (a whole new block, for a new rule)     G0-RAISE: <RULE> * — <reason>
 *   2. add or renew an inline exception        G0-RAISE: <RULE> <file> — <reason>
 *   3. change the gate itself: its registry,   G0-RAISE: GATE <path> — <reason>
 *      matchers, runner, CI wiring or hooks
 *
 * The countersign is a TRAILER LINE IN A COMMIT MESSAGE in the range being
 * checked, not the PR description: a commit message is never a stale copy, it
 * travels into dev and main with the change (so a release PR passes without
 * re-signing), and git blame keeps it next to the change it explains.
 *
 * Lowering never needs one: it only tightens.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IGNORE_KEYWORD, parseIgnores } from './architecture-ignores.mjs';
import { MATCHERS } from './architecture-matchers.mjs';

/**
 * The gate's own files. Changing any of them can loosen every rule at once
 * (a matcher that stops matching, a step that stops running), so each change
 * needs a countersign. The baseline has its own per-entry check (1 above) and
 * the generated rules page is held by RULES-DOC.
 */
const GATE_FILES = [
  'scripts/checks/check-architecture.mjs',
  'scripts/checks/check-architecture.test.mjs',
  'scripts/checks/architecture-rules.mjs',
  'scripts/checks/architecture-matchers.mjs',
  'scripts/checks/architecture-lists.mjs',
  'scripts/checks/architecture-ignores.mjs',
  'scripts/checks/architecture-docs.mjs',
  'scripts/checks/architecture-raises.mjs',
  'scripts/checks/check-data-access-contract.mjs',
  '.github/workflows/static_analysis.yml',
  '.github/workflows/testing.yml',
  '.github/workflows/main-gate.yml',
  '.husky/pre-commit',
  '.claude/skills/codex-epic-implement/scripts/gate.sh',
];

const COUNTERSIGN =
  /^[ \t]*G0-RAISE:[ \t]+(\S+)[ \t]+(\S+)[ \t]+(?:—|--?)[ \t]+(.+?)[ \t]*$/gm;

/**
 * The countersigns in some commit messages, as "RULE target" keys. A reason
 * must be at least three words and not a template placeholder, so a line that
 * says nothing doesn't count.
 */
export function parseCountersigns(text) {
  const signed = new Set();
  for (const m of text.matchAll(COUNTERSIGN)) {
    const reason = m[3];
    if (/^<.*>$/.test(reason) || reason.split(/\s+/).length < 3) continue;
    signed.add(`${m[1]} ${m[2]}`);
  }
  return signed;
}

/** Every (rule, file) the new baseline allows beyond the old one. */
export function raisedEntries(rules, before, after) {
  const measuring = new Set(
    rules.filter((r) => MATCHERS[r.match.kind]?.unit).map((r) => r.id)
  );
  const raised = [];
  for (const [ruleId, pins] of Object.entries(after)) {
    const newBlock = before[ruleId] === undefined;
    for (const [file, now] of Object.entries(pins)) {
      const was = before[ruleId]?.[file];
      // Any pin whose shape the ratchet can't compare counts as a raise, so a
      // hand edit can't slip past the countersign by changing a pin's type.
      let more;
      if (measuring.has(ruleId)) {
        more = typeof now !== 'number' || typeof was !== 'number' || now > was;
      } else if (!Array.isArray(now)) {
        more = true;
      } else if (typeof was === 'number') {
        more = now.length > was;
      } else {
        more = minusKeys(now, was ?? []).length > 0;
      }
      if (more) raised.push({ ruleId, file, was, now, newBlock });
    }
  }
  return raised;
}

function minusKeys(a, b) {
  const left = [...b];
  return (Array.isArray(a) ? a : []).filter((x) => {
    const at = left.indexOf(x);
    if (at === -1) return true;
    left.splice(at, 1);
    return false;
  });
}

/** Exceptions a change adds or renews, compared directive by directive. */
function newExceptions(file, beforeText, afterText) {
  const signature = (d) => `${d.ruleId}|${d.until}|${d.by}|${d.reason}`;
  const before = new Set(
    beforeText === null
      ? []
      : parseIgnores(file, beforeText)
          .filter((d) => d.ok)
          .map(signature)
  );
  return parseIgnores(file, afterText).filter(
    (d) => d.ok && !before.has(signature(d))
  );
}

/**
 * Everything a change loosens that its commits don't countersign.
 *
 * @param {{ raised: ReturnType<typeof raisedEntries>,
 *   exceptions: { file: string, ruleId: string, line: number }[],
 *   gateChanges: string[], signed: Set<string> }} input
 */
export function missingCountersigns({
  raised,
  exceptions,
  gateChanges,
  signed,
}) {
  const missing = [];
  for (const r of raised) {
    if (signed.has(`${r.ruleId} ${r.file}`)) continue;
    if (r.newBlock && signed.has(`${r.ruleId} *`)) continue;
    missing.push({
      line: `G0-RAISE: ${r.ruleId} ${r.newBlock ? '*' : r.file} — <why>`,
      what: `${r.ruleId} ${r.file}: ${describeRaise(r)}`,
    });
  }
  for (const d of exceptions) {
    if (signed.has(`${d.ruleId} ${d.file}`)) continue;
    missing.push({
      line: `G0-RAISE: ${d.ruleId} ${d.file} — <why>`,
      what: `${d.file}:${d.line}: a new or renewed ${IGNORE_KEYWORD} for ${d.ruleId}`,
    });
  }
  for (const path of gateChanges) {
    if (signed.has(`GATE ${path}`)) continue;
    missing.push({
      line: `G0-RAISE: GATE ${path} — <why>`,
      what: `${path}: the gate itself changed`,
    });
  }
  return missing;
}

function describeRaise(r) {
  if (Array.isArray(r.now)) {
    if (typeof r.was === 'number') return `${r.was} → ${r.now.length} keys`;
    const added = minusKeys(r.now, r.was ?? []);
    return `allows ${added.map((k) => JSON.stringify(k)).join(', ')} more`;
  }
  return `${r.was ?? 'unpinned'} → ${r.now}`;
}

// ---------------------------------------------------------------------------
// Reading the change from git
// ---------------------------------------------------------------------------

function git(root, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr ?? '').trim()}`);
  }
  return r;
}

/** A file's text at a ref, or null when it doesn't exist there. */
function showAt(root, ref, file) {
  const r = git(root, ['show', `${ref}:${file}`], { allowFail: true });
  return r.status === 0 ? r.stdout : null;
}

/**
 * Everything the working tree loosens relative to `base`, and what the commits
 * in base..HEAD countersign.
 *
 * @returns {{ skipped?: string, missing: { line: string, what: string }[] }}
 */
export function checkLoosening(root, rules, baselineFile, base) {
  const ok = git(root, ['cat-file', '-e', `${base}^{commit}`], {
    allowFail: true,
  });
  if (ok.status !== 0) {
    throw new Error(
      `base ${base} is not a commit this clone has (CI needs fetch-depth: 0)`
    );
  }
  if (showAt(root, base, 'scripts/checks/check-architecture.mjs') === null) {
    return {
      skipped: `${base} has no architecture gate yet; nothing to countersign`,
      missing: [],
    };
  }
  const changed = git(root, ['diff', '--name-only', '--no-renames', base])
    .stdout.split('\n')
    .filter(Boolean);
  const beforeBaseline = JSON.parse(showAt(root, base, baselineFile) ?? '{}');
  const headPath = join(root, baselineFile);
  const afterBaseline = existsSync(headPath)
    ? JSON.parse(readFileSync(headPath, 'utf8'))
    : {};
  const exceptions = [];
  for (const file of changed) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const after = readFileSync(path, 'utf8');
    if (!after.includes(IGNORE_KEYWORD)) continue;
    exceptions.push(...newExceptions(file, showAt(root, base, file), after));
  }
  const gateChanges = changed.filter((f) => GATE_FILES.includes(f));
  const messages = git(root, ['log', '--format=%B%n', `${base}..HEAD`]).stdout;
  return {
    missing: missingCountersigns({
      raised: raisedEntries(rules, beforeBaseline, afterBaseline),
      exceptions,
      gateChanges,
      signed: parseCountersigns(messages),
    }),
  };
}

/**
 * Where a CI run's change starts, from the GitHub event. A pull request checks
 * out a merge commit whose first parent is the base it was built on (the
 * moving tip of the base branch would blame the PR for the base's own later
 * changes). A push to dev or main starts where the branch was before the push;
 * a push to any other branch starts where it left dev. Outside CI there is no
 * change to judge.
 *
 * @returns {{ kind: 'pr'|'push'|'local', base: string|null, note?: string }}
 */
export function ciBase(root, env = process.env) {
  const event = env.GITHUB_EVENT_NAME;
  if (!event) return { kind: 'local', base: null, note: 'not in CI' };
  const payload = env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
    : {};
  if (event === 'pull_request') {
    const parents = git(root, ['rev-list', '--parents', '-n', '1', 'HEAD'])
      .stdout.trim()
      .split(' ');
    const base =
      parents.length >= 3 ? 'HEAD^1' : payload.pull_request?.base?.sha;
    return { kind: 'pr', base: base ?? null };
  }
  if (event === 'push') {
    const branch = (env.GITHUB_REF ?? '').replace(/^refs\/heads\//, '');
    if (branch === 'dev' || branch === 'main') {
      const before = payload.before;
      return /^0+$/.test(before ?? '0')
        ? { kind: 'push', base: null, note: 'a new branch' }
        : { kind: 'push', base: before };
    }
    const mb = git(root, ['merge-base', 'HEAD', 'origin/dev'], {
      allowFail: true,
    });
    return mb.status === 0
      ? { kind: 'push', base: mb.stdout.trim() }
      : { kind: 'push', base: null, note: 'no merge base with origin/dev' };
  }
  return { kind: 'local', base: null, note: `event ${event}` };
}

/** The files a change touches, relative to its base. */
export function touchedFiles(root, base) {
  return new Set(
    git(root, ['diff', '--name-only', '--no-renames', base])
      .stdout.split('\n')
      .filter(Boolean)
  );
}
