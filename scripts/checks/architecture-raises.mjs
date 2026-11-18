/**
 * Countersigned loosening (G0 WP-7, hardened after two reviews,
 * Codex-xtcfl.7).
 *
 * The ratchet only holds if nothing loosens it quietly. pstack's rule:
 * "Anything that loosens a gate … needs a verifier's proof and then your fresh
 * countersign, because the owner is the one who wants green." There are three
 * ways to loosen this gate, and each needs the OWNER's countersign:
 *
 *   1. raise a baseline pin, or add one        G0-RAISE: <RULE> <file> — <reason>
 *      (every pin of a rule the base lacks)    G0-RAISE: <RULE> * — <reason>
 *   2. add, copy, move or renew an exception   G0-RAISE: <RULE> <file> — <reason>
 *   3. change the gate itself: its code, its   G0-RAISE: GATE <path> — <reason>
 *      CI steps, the part of a calling
 *      workflow it relies on, or a pnpm script
 *      a gate runs                             (GATE package.json#scripts.check:ci)
 *
 * The countersign is a trailer line in a commit message in the range being
 * checked, and it counts only in a commit with no `Co-Authored-By: Claude`
 * line: the agent that loosened the gate can't sign for it (owner, 18 Nov). A
 * commit message travels into dev and main with the change, so a release PR
 * passes without re-signing, and git blame keeps the reason next to the change.
 *
 * In a pull request this check runs twice: once in the PR's own CI, and once
 * from the BASE branch's copy of the gate (.github/workflows/g0-countersign.yml,
 * a pull_request_target job), so a PR that edits this file can't exempt itself.
 *
 * Lowering never needs a countersign: it only tightens.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IGNORE_KEYWORD, parseIgnores } from './architecture-ignores.mjs';
import { pnpmScript } from './architecture-lists.mjs';
import { MATCHERS } from './architecture-matchers.mjs';

/**
 * The gate's own code. Changing any of these can loosen every rule at once (a
 * matcher that stops matching, a step that stops running), so each change
 * needs a GATE countersign. The baseline has its own per-pin check (1 above)
 * and the generated rules page is held by RULES-DOC. The workflows that CALL
 * the static-analysis job are fingerprinted instead (callerPrint), because
 * most of what they hold is unrelated test jobs.
 */
export const GATE_CODE = [
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
  '.github/workflows/g0-countersign.yml',
  '.husky/pre-commit',
  '.claude/skills/codex-epic-implement/scripts/gate.sh',
];

const COUNTERSIGN =
  /^[ \t]*G0-RAISE:[ \t]+(\S+)[ \t]+(\S+)[ \t]+(?:—|--?)[ \t]+(.+?)[ \t]*$/gm;

/** A commit an agent wrote: its countersigns don't count. */
const AGENT_COMMIT =
  /^Co-Authored-By:.*(?:\bClaude\b|noreply@anthropic\.com)/im;

/**
 * The countersigns in some commit messages, as "RULE target" keys. A reason
 * must be at least three words and hold no `<placeholder>`, so a line that
 * says nothing, or the gate's own template pasted back, doesn't count.
 */
export function parseCountersigns(text) {
  const signed = new Set();
  for (const m of text.matchAll(COUNTERSIGN)) {
    const reason = m[3];
    if (/<[^>]*>/.test(reason) || reason.split(/\s+/).length < 3) continue;
    signed.add(`${m[1]} ${m[2]}`);
  }
  return signed;
}

/**
 * Every (rule, file) the new baseline allows beyond the old one. A file the
 * change renamed is compared with its old path's pin. `baseRuleIds` is the
 * base registry's rule IDs: a block may be signed as a whole (`RULE *`) only
 * when the base didn't have the rule at all.
 */
export function raisedEntries(
  rules,
  before,
  after,
  { renames = new Map(), baseRuleIds = null } = {}
) {
  const measuring = new Set(
    rules.filter((r) => MATCHERS[r.match.kind]?.unit).map((r) => r.id)
  );
  const raised = [];
  for (const [ruleId, pins] of Object.entries(after)) {
    const newRule = baseRuleIds
      ? !baseRuleIds.has(ruleId)
      : before[ruleId] === undefined;
    for (const [file, now] of Object.entries(pins)) {
      const was =
        before[ruleId]?.[file] ??
        (renames.has(file) ? before[ruleId]?.[renames.get(file)] : undefined);
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
      if (more) raised.push({ ruleId, file, was, now, newRule });
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

/**
 * A file's exceptions, each with what it excuses: the directive's fields plus
 * the text of the line below it. So a copied exception, or one moved onto a
 * different violation, has no match at the base.
 */
function exceptionSignatures(file, text) {
  if (text === null) return [];
  const lines = text.split('\n');
  return parseIgnores(file, text)
    .filter((d) => d.ok)
    .map((d) => ({
      d,
      sig: [
        d.ruleId,
        d.until,
        d.by,
        d.reason,
        (lines[d.line] ?? '').trim().replace(/\s+/g, ' '),
      ].join('|'),
    }));
}

/** Exceptions a change adds, copies, moves or renews, compared as a multiset. */
function newExceptions(file, beforeText, afterText) {
  const before = exceptionSignatures(file, beforeText).map((x) => x.sig);
  const added = [];
  for (const { d, sig } of exceptionSignatures(file, afterText)) {
    const at = before.indexOf(sig);
    if (at === -1) added.push(d);
    else before.splice(at, 1);
  }
  return added;
}

/**
 * Everything a change loosens that the owner hasn't countersigned.
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
    if (r.newRule && signed.has(`${r.ruleId} *`)) continue;
    missing.push({
      line: `G0-RAISE: ${r.ruleId} ${r.newRule ? '*' : r.file} — <why>`,
      what: `${r.ruleId} ${r.file}: ${describeRaise(r)}`,
    });
  }
  for (const d of exceptions) {
    if (signed.has(`${d.ruleId} ${d.file}`)) continue;
    missing.push({
      line: `G0-RAISE: ${d.ruleId} ${d.file} — <why>`,
      what: `${d.file}:${d.line}: a new, copied, moved or renewed ${IGNORE_KEYWORD} for ${d.ruleId}`,
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
// The parts of other files the gate depends on
// ---------------------------------------------------------------------------

/**
 * What a calling workflow contributes to the gate: its triggers, its
 * concurrency, and the job that runs the static-analysis workflow. Comments
 * and blank lines are left out, so only a real change counts.
 */
export function callerPrint(text, workflow) {
  if (text === null) return null;
  const lines = text.replace(/\r/g, '').split('\n');
  const keep = [];
  const block = (start, isEnd) => {
    const out = [lines[start]];
    for (let i = start + 1; i < lines.length && !isEnd(lines[i]); i++) {
      out.push(lines[i]);
    }
    return out;
  };
  lines.forEach((line, i) => {
    if (/^(?:on|concurrency)\s*:/.test(line)) {
      keep.push(...block(i, (l) => /^\S/.test(l)));
    }
    if (/^ {2}[\w-]+\s*:\s*$/.test(line)) {
      const job = block(i, (l) => /^ {0,2}\S/.test(l));
      if (job.some((l) => l.includes(`./${workflow}`))) keep.push(...job);
    }
  });
  return keep
    .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'))
    .map((l) => l.trimEnd())
    .join('\n');
}

/** The package.json script a gate command runs, as { file, script }. */
function gateScripts(gates, packageNameAt) {
  const out = [];
  for (const gate of gates) {
    for (const command of [gate.before, gate.selfTest, gate.run]) {
      const target = command && pnpmScript(command);
      if (!target) continue;
      const file =
        target.pkg === '(root)' ? 'package.json' : packageNameAt(target.pkg);
      if (file) out.push({ file, script: target.script });
    }
  }
  return out;
}

const scriptValue = (text, script) => {
  if (text === null) return null;
  try {
    return JSON.parse(text).scripts?.[script] ?? null;
  } catch {
    return '(unparseable package.json)';
  }
};

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

const splitZ = (s) => s.split('\0').filter(Boolean);

/** A file's text at a ref, or null when it doesn't exist there. */
function showAt(root, ref, file) {
  const r = git(root, ['show', `${ref}:${file}`], { allowFail: true });
  return r.status === 0 ? r.stdout : null;
}

/** Every path that differs between `base` and the working tree (renames as delete + add). */
function changedSince(root, base) {
  return splitZ(
    git(root, ['diff', '--name-only', '--no-renames', '-z', base]).stdout
  );
}

/** new path -> old path, for every file the change renamed since `base`. */
export function renamesSince(root, base) {
  const parts = splitZ(
    git(root, ['diff', '-M', '--name-status', '-z', '--diff-filter=R', base])
      .stdout
  );
  const renames = new Map();
  for (let i = 0; i + 2 < parts.length; i += 3) {
    if (parts[i]?.startsWith('R')) renames.set(parts[i + 2], parts[i + 1]);
  }
  return renames;
}

/** The rule IDs the base's generated rules page lists. */
function ruleIdsAt(root, base) {
  const page = showAt(root, base, 'docs/architecture/rules.md');
  if (page === null) return null;
  return new Set(
    [...page.matchAll(/^### ([A-Z][A-Z0-9-]*)$/gm)].map((m) => m[1])
  );
}

/** The countersigns the owner wrote in base..HEAD, and the agent commits that tried. */
function countersignsSince(root, base) {
  const signed = new Set();
  const byAgent = [];
  const log = git(root, [
    'log',
    '-z',
    '--format=%H%n%B',
    `${base}..HEAD`,
  ]).stdout;
  for (const entry of splitZ(log)) {
    const nl = entry.indexOf('\n');
    const body = entry.slice(nl + 1);
    const found = parseCountersigns(body);
    if (found.size === 0) continue;
    if (AGENT_COMMIT.test(body)) {
      byAgent.push(entry.slice(0, 9));
      continue;
    }
    for (const key of found) signed.add(key);
  }
  return { signed, byAgent };
}

/**
 * Everything the working tree loosens relative to `base`, and what the owner
 * countersigned in base..HEAD.
 *
 * @param {{ rules: object[], gates?: object[], callers?: string[] }} registry
 * @returns {{ skipped?: string, missing: { line: string, what: string }[],
 *   byAgent: string[] }}
 */
export function checkLoosening(root, registry, baselineFile, base) {
  const ok = git(root, ['cat-file', '-e', `${base}^{commit}`], {
    allowFail: true,
  });
  if (ok.status !== 0) {
    throw new Error(
      `base ${base} is not a commit this clone has. CI checks out with fetch-depth: 0, so it is gone from the remote (a force-push?)`
    );
  }
  if (showAt(root, base, 'scripts/checks/check-architecture.mjs') === null) {
    return {
      skipped: `${base} has no architecture gate yet; nothing to countersign`,
      missing: [],
      byAgent: [],
    };
  }
  const { rules, gates = [], callers = [] } = registry;
  const changed = changedSince(root, base);
  const renames = renamesSince(root, base);
  const parse = (text, where) => {
    try {
      return JSON.parse(text ?? '{}');
    } catch (err) {
      throw new Error(
        `${baselineFile} at ${where} is not valid JSON (${err.message})`
      );
    }
  };
  const beforeBaseline = parse(showAt(root, base, baselineFile), base);
  const headPath = join(root, baselineFile);
  const afterBaseline = existsSync(headPath)
    ? parse(readFileSync(headPath, 'utf8'), 'the working tree')
    : {};
  const readHead = (file) =>
    existsSync(join(root, file))
      ? readFileSync(join(root, file), 'utf8')
      : null;

  const exceptions = [];
  for (const file of changed) {
    const after = readHead(file);
    if (after === null || !after.includes(IGNORE_KEYWORD)) continue;
    const from = renames.get(file) ?? file;
    exceptions.push(...newExceptions(file, showAt(root, base, from), after));
  }

  const gateChanges = changed.filter((f) => GATE_CODE.includes(f));
  for (const caller of callers) {
    if (!changed.includes(caller)) continue;
    const workflow = '.github/workflows/static_analysis.yml';
    if (
      callerPrint(showAt(root, base, caller), workflow) !==
      callerPrint(readHead(caller), workflow)
    ) {
      gateChanges.push(caller);
    }
  }
  const packageName = (text) => {
    try {
      return JSON.parse(text ?? '{}').name ?? null;
    } catch {
      return null;
    }
  };
  // Only a CHANGED package.json can have changed a gate's script.
  const packageNameAt = (name) =>
    changed.find(
      (f) =>
        /^(?:apps|packages|workers)\/[^/]+\/package\.json$/.test(f) &&
        packageName(readHead(f) ?? showAt(root, base, f)) === name
    ) ?? null;
  for (const { file, script } of gateScripts(gates, packageNameAt)) {
    if (!changed.includes(file)) continue;
    if (
      scriptValue(showAt(root, base, file), script) !==
      scriptValue(readHead(file), script)
    ) {
      gateChanges.push(`${file}#scripts.${script}`);
    }
  }

  const { signed, byAgent } = countersignsSince(root, base);
  return {
    missing: missingCountersigns({
      raised: raisedEntries(rules, beforeBaseline, afterBaseline, {
        renames,
        baseRuleIds: ruleIdsAt(root, base),
      }),
      exceptions,
      gateChanges: [...new Set(gateChanges)],
      signed,
    }),
    byAgent,
  };
}

/**
 * Where a CI run's change starts, from the GitHub event. A pull request checks
 * out a merge commit whose first parent is the base it was built on (the
 * moving tip of the base branch would blame the PR for the base's own later
 * changes). A merge-queue group names its base. A push to dev or main starts
 * where the branch was before the push; a push to any other branch, and a
 * local run, start where the branch left origin/dev. Anything else is an event
 * the gate doesn't know how to judge, and it stops the build.
 *
 * @returns {{ kind: 'pr'|'branch'|'trunk', base: string|null, note?: string }}
 */
export function ciBase(root, env = process.env) {
  const event = env.GITHUB_EVENT_NAME;
  const fromDev = (kind, why) => {
    const mb = git(root, ['merge-base', 'HEAD', 'origin/dev'], {
      allowFail: true,
    });
    if (mb.status !== 0) {
      throw new Error(
        `${why}, and HEAD has no merge base with origin/dev (git fetch origin dev)`
      );
    }
    return { kind, base: mb.stdout.trim() };
  };
  if (!event) return fromDev('branch', 'a local run compares with origin/dev');
  const payload = env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
    : {};
  if (event === 'pull_request') {
    const parents = git(root, ['rev-list', '--parents', '-n', '1', 'HEAD'])
      .stdout.trim()
      .split(' ');
    const base =
      parents.length >= 3 ? parents[1] : payload.pull_request?.base?.sha;
    if (!base) {
      throw new Error(
        'a pull_request run with no base: HEAD is not a merge commit and the event names no pull_request.base.sha'
      );
    }
    return { kind: 'pr', base };
  }
  if (event === 'merge_group') {
    const base = payload.merge_group?.base_sha;
    if (!base)
      throw new Error('a merge_group run whose event names no base_sha');
    return { kind: 'pr', base };
  }
  if (event === 'push') {
    const branch = (env.GITHUB_REF ?? '').replace(/^refs\/heads\//, '');
    if (branch === 'dev' || branch === 'main') {
      const before = payload.before;
      if (!before)
        throw new Error('a push run whose event names no "before" commit');
      return /^0+$/.test(before)
        ? {
            kind: 'trunk',
            base: null,
            note: 'a new branch: nothing before it to compare with',
          }
        : { kind: 'trunk', base: before };
    }
    return fromDev(
      'branch',
      `a push to ${branch || 'a branch'} compares with origin/dev`
    );
  }
  throw new Error(
    `event ${event} is not one the gate knows how to judge; teach ciBase() its base`
  );
}
