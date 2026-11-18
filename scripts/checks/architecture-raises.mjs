/**
 * Countersigned loosening (G0 WP-7, hardened over three reviews,
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
 *   3. change what a gate runs: the gate's     G0-RAISE: GATE <what> — <reason>
 *      own code, its CI steps, a gate script
 *      or self-test, a pnpm script or turbo
 *      task a gate runs, a gate's config
 *      (biome.json), or a rise in another
 *      gate's baseline
 *
 * The countersign is a trailer line in a commit message in the range being
 * checked. It counts only in a commit with no `Co-Authored-By: Claude` line
 * (owner, 18 Nov), and only while what it signed is unchanged: anything that
 * loosens the same item AFTER the signing commit needs a new countersign. A
 * commit message travels into dev and main with the change, so a release PR
 * passes without re-signing, and git blame keeps the reason next to the change.
 *
 * THREAT MODEL (owner, 18 Nov): honest agents that make eager mistakes, such
 * as signing their own raise or breaking this check while refactoring it. When
 * a change touches scripts/checks/, the runner also has the BASE commit's copy
 * of the gate judge the countersigns, so a bug in the new copy can't approve
 * itself. An agent that deliberately forges (leaves out its attribution, edits
 * its own CI) is not stopped here; review is the backstop for that.
 *
 * Lowering never needs a countersign: it only tightens.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IGNORE_KEYWORD, parseIgnores } from './architecture-ignores.mjs';
import { pnpmScript } from './architecture-lists.mjs';
import {
  enclosingName,
  MATCHERS,
  maskStringsWithLines,
} from './architecture-matchers.mjs';
import { tokenize } from './check-data-access-contract.mjs';

/**
 * The gate's own code. Changing any of these can loosen every rule at once (a
 * matcher that stops matching, a step that stops running), so each change
 * needs a GATE countersign. The baseline has its own per-pin check (1 above)
 * and the generated rules page is held by RULES-DOC. What the OTHER gates run
 * is derived from the registry (gateDependencies), and the calling workflows
 * are fingerprinted (callerPrint), because most of what they hold is
 * unrelated test jobs.
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
function describeRaise(r) {
  if (Array.isArray(r.now)) {
    if (typeof r.was === 'number') return `${r.was} → ${r.now.length} keys`;
    const added = minusKeys(r.now, r.was ?? []);
    return `allows ${added.map((k) => JSON.stringify(k)).join(', ')} more`;
  }
  return `${r.was ?? 'unpinned'} → ${r.now}`;
}

/**
 * A file's exceptions, each with what it excuses: the directive's fields, the
 * text of the line below it, and the function that line sits in. So a copied
 * exception, or one moved onto a different violation (or into a different
 * function with the same text), has no match at the base.
 */
function exceptionSignatures(file, text) {
  if (text === null) return [];
  const lines = text.split('\n');
  let context = null;
  const where = (line) => {
    if (file.endsWith('.md')) return '';
    if (!context) {
      const { masked, startsInside } = maskStringsWithLines(
        tokenize(text).code
      );
      context = { maskedLines: masked.split('\n'), startsInside };
    }
    return enclosingName(context.maskedLines, line, {
      startsInside: context.startsInside,
      lines,
    });
  };
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
        where(d.line + 1),
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
 * What a change loosens, as items: `key` is what a countersign names, `star`
 * the whole-rule form that also covers it (a rule the base lacked).
 */
function looseningItems({ raised, exceptions, gateChanges }) {
  const items = [];
  for (const r of raised) {
    items.push({
      key: `${r.ruleId} ${r.file}`,
      star: r.newRule ? `${r.ruleId} *` : null,
      ruleId: r.ruleId,
      line: `G0-RAISE: ${r.ruleId} ${r.newRule ? '*' : r.file} — <why>`,
      what: `${r.ruleId} ${r.file}: ${describeRaise(r)}`,
    });
  }
  for (const d of exceptions) {
    items.push({
      key: `${d.ruleId} ${d.file}`,
      star: null,
      ruleId: d.ruleId,
      line: `G0-RAISE: ${d.ruleId} ${d.file} — <why>`,
      what: `${d.file}:${d.line}: a new, copied, moved or renewed ${IGNORE_KEYWORD} for ${d.ruleId}`,
    });
  }
  for (const path of gateChanges) {
    items.push({
      key: `GATE ${path}`,
      star: null,
      ruleId: 'GATE',
      line: `G0-RAISE: GATE ${path} — <why>`,
      what: `${path}: what a gate runs changed`,
    });
  }
  return items;
}

/**
 * Everything a change loosens that no countersign names (by key alone; the
 * runner also checks that nothing changed after the signing commit).
 *
 * @param {{ raised: ReturnType<typeof raisedEntries>,
 *   exceptions: { file: string, ruleId: string, line: number }[],
 *   gateChanges: string[], signed: Set<string> }} input
 */
export function missingCountersigns(input) {
  return looseningItems(input)
    .filter(
      (i) => !input.signed.has(i.key) && !(i.star && input.signed.has(i.star))
    )
    .map(({ line, what }) => ({ line, what }));
}

// ---------------------------------------------------------------------------
// The parts of other files the gates depend on
// ---------------------------------------------------------------------------

/**
 * What a calling workflow contributes to the gate: its triggers, its
 * concurrency, and the job that runs the static-analysis workflow. Comments
 * and blank lines are left out, and they never end a block (YAML ignores a
 * comment's indentation), so only a real change counts.
 */
export function callerPrint(text, workflow) {
  if (text === null) return null;
  const lines = text.replace(/\r/g, '').split('\n');
  const isNoise = (l) => l.trim() === '' || l.trimStart().startsWith('#');
  const keep = [];
  const block = (start, isEnd) => {
    const out = [lines[start]];
    for (let i = start + 1; i < lines.length; i++) {
      if (!isNoise(lines[i]) && isEnd(lines[i])) break;
      out.push(lines[i]);
    }
    return out;
  };
  lines.forEach((line, i) => {
    if (/^(?:on|concurrency)\s*:/.test(line)) {
      keep.push(...block(i, (l) => /^\S/.test(l)));
    }
    if (/^ {2}[\w-]+\s*:\s*(?:#.*)?$/.test(line)) {
      const job = block(i, (l) => /^ {0,2}\S/.test(l));
      if (job.some((l) => l.includes(`./${workflow}`))) keep.push(...job);
    }
  });
  return keep
    .filter((l) => !isNoise(l))
    .map((l) => l.trimEnd())
    .join('\n');
}

const parseJson = (text) => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return '(unparseable)';
  }
};

/** Nested counts where every leaf is a number: true when any leaf grew. */
function countsRose(before, after) {
  const walk = (b, a) => {
    if (typeof a === 'number') return a > (typeof b === 'number' ? b : 0);
    if (a === null || typeof a !== 'object') return a !== b;
    return Object.entries(a).some(([k, v]) => walk(b?.[k], v));
  };
  return walk(parseJson(before), parseJson(after));
}

/**
 * Everything the registry's other gates run, as parts: `changed(before,
 * after)` says whether a change to the part loosens that gate. Derived from
 * each gate's commands (a `node [--test] <file>`, a pnpm script and every
 * file it runs, a turbo task and every package's script for it) plus what the
 * registry declares (`files`: configs like biome.json; `ratchets`: another
 * gate's baseline, where only a rise counts).
 */
export function gateDependencies(gates, packageFiles, read) {
  const parts = new Map();
  const add = (label, file, changed) => {
    if (!parts.has(label)) parts.set(label, { label, file, changed });
  };
  const whole = (file) => add(file, file, (a, b) => a !== b);
  const script = (file, name) =>
    add(`${file}#scripts.${name}`, file, (a, b) => {
      const x = parseJson(a);
      const y = parseJson(b);
      return (
        JSON.stringify(x?.scripts?.[name]) !==
        JSON.stringify(y?.scripts?.[name])
      );
    });
  const nodeFiles = (command, dir) => {
    for (const m of command.matchAll(
      /\bnode\s+(?:--test\s+)?([\w./-]+\.m?js)\b/g
    )) {
      whole(dir ? `${dir}/${m[1]}` : m[1]);
    }
  };
  const packageNamed = (name) =>
    packageFiles.find((f) => parseJson(read(f))?.name === name) ?? null;
  for (const gate of gates) {
    for (const command of [gate.before, gate.selfTest, gate.run].filter(
      Boolean
    )) {
      nodeFiles(command, '');
      const target = pnpmScript(command);
      if (!target) continue;
      const file =
        target.pkg === '(root)' ? 'package.json' : packageNamed(target.pkg);
      if (!file) continue;
      script(file, target.script);
      const value = parseJson(read(file))?.scripts?.[target.script] ?? '';
      nodeFiles(value, file.split('/').slice(0, -1).join('/'));
      const turbo = /^turbo run ([\w:-]+)/.exec(value);
      if (turbo) {
        const task = turbo[1];
        add(`turbo.json#tasks.${task}`, 'turbo.json', (a, b) => {
          const x = parseJson(a);
          const y = parseJson(b);
          return (
            JSON.stringify(x?.tasks?.[task]) !==
            JSON.stringify(y?.tasks?.[task])
          );
        });
        for (const pkg of packageFiles) script(pkg, task);
      }
    }
    for (const file of gate.files ?? []) whole(file);
    for (const file of gate.ratchets ?? []) add(file, file, countsRose);
  }
  return [...parts.values()];
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

/** The rule IDs the generated rules page lists at a ref. */
function ruleIdsAt(root, ref) {
  const page = showAt(root, ref, 'docs/architecture/rules.md');
  if (page === null) return null;
  return new Set(
    [...page.matchAll(/^### ([A-Z][A-Z0-9-]*)$/gm)].map((m) => m[1])
  );
}

/** The owner's countersigning commits in base..HEAD, newest first, and the agent commits that tried. */
function countersignCommits(root, base) {
  const owner = [];
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
    const signed = parseCountersigns(body);
    if (signed.size === 0) continue;
    if (AGENT_COMMIT.test(body)) byAgent.push(entry.slice(0, 9));
    else owner.push({ sha: entry.slice(0, nl), signed });
  }
  return { owner, byAgent };
}

/**
 * Everything the working tree loosens relative to `ref`, as items, whatever
 * countersigns exist.
 */
function loosenedSince(root, registry, baselineFile, ref) {
  const { rules, gates = [], callers = [] } = registry;
  const changed = changedSince(root, ref);
  const renames = renamesSince(root, ref);
  const parse = (text, where) => {
    try {
      return JSON.parse(text ?? '{}');
    } catch (err) {
      throw new Error(
        `${baselineFile} at ${where} is not valid JSON (${err.message})`
      );
    }
  };
  const readHead = (file) =>
    existsSync(join(root, file))
      ? readFileSync(join(root, file), 'utf8')
      : null;
  const beforeBaseline = parse(showAt(root, ref, baselineFile), ref);
  const afterBaseline = parse(readHead(baselineFile), 'the working tree');

  const exceptions = [];
  for (const file of changed) {
    const after = readHead(file);
    if (after === null || !after.includes(IGNORE_KEYWORD)) continue;
    const from = renames.get(file) ?? file;
    exceptions.push(...newExceptions(file, showAt(root, ref, from), after));
  }

  const gateChanges = changed.filter((f) => GATE_CODE.includes(f));
  const workflow = '.github/workflows/static_analysis.yml';
  for (const caller of callers) {
    if (!changed.includes(caller)) continue;
    if (
      callerPrint(showAt(root, ref, caller), workflow) !==
      callerPrint(readHead(caller), workflow)
    ) {
      gateChanges.push(caller);
    }
  }
  const packageFiles = splitZ(
    git(root, ['ls-files', '-z', '--', 'package.json', '*/package.json']).stdout
  ).filter((f) =>
    /^(?:package\.json|(?:apps|packages|workers)\/[^/]+\/package\.json)$/.test(
      f
    )
  );
  for (const part of gateDependencies(gates, packageFiles, readHead)) {
    if (!changed.includes(part.file)) continue;
    if (part.changed(showAt(root, ref, part.file), readHead(part.file))) {
      gateChanges.push(part.label);
    }
  }

  return looseningItems({
    raised: raisedEntries(rules, beforeBaseline, afterBaseline, {
      renames,
      baseRuleIds: ruleIdsAt(root, ref),
    }),
    exceptions,
    gateChanges: [...new Set(gateChanges)],
  });
}

/**
 * Everything the working tree loosens relative to `base` that the owner
 * hasn't countersigned. A countersign covers an item only while nothing
 * loosened that item AFTER the signing commit: it signs what it saw.
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
  const items = loosenedSince(root, registry, baselineFile, base);
  const { owner, byAgent } = countersignCommits(root, base);
  const since = new Map();
  const loosenedAfter = (sha) => {
    if (!since.has(sha)) {
      since.set(sha, loosenedSince(root, registry, baselineFile, sha));
    }
    return since.get(sha);
  };
  const covered = (item) =>
    owner.some((c) => {
      if (c.signed.has(item.key)) {
        return !loosenedAfter(c.sha).some((x) => x.key === item.key);
      }
      if (item.star && c.signed.has(item.star)) {
        return !loosenedAfter(c.sha).some((x) => x.ruleId === item.ruleId);
      }
      return false;
    });
  return {
    missing: items
      .filter((item) => !covered(item))
      .map(({ line, what }) => ({ line, what })),
    byAgent,
  };
}

// ---------------------------------------------------------------------------
// What CI compares with
// ---------------------------------------------------------------------------

/**
 * The commit a CI run compares with, and what kind of run it is:
 *
 *   pr       a pull request: the base it merges into (HEAD^1 of the merge
 *            commit GitHub checks out, so a base that moved on is seen)
 *   release  a pull request from dev: as pr, but dev's unbanked fixes are
 *            notices, not failures
 *   trunk    a push to dev or main: the commit before the push; notices only
 *   branch   a push to another branch, or a local run: its merge base with
 *            origin/dev
 *
 * An event it doesn't know throws, so a new trigger can't pass by default.
 *
 * @returns {{ kind: 'pr'|'release'|'branch'|'trunk', base: string|null, note?: string }}
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
    // A release PR (dev into main) brings every fix dev holds. Banking them
    // is dev's job, so here they are notices, as on a push to dev.
    return { kind: env.GITHUB_HEAD_REF === 'dev' ? 'release' : 'pr', base };
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
