/**
 * Countersigned loosening (G0 WP-7, hardened over four reviews,
 * Codex-xtcfl.7).
 *
 * The ratchet only holds if nothing loosens it quietly. pstack's rule:
 * "Anything that loosens a gate … needs a verifier's proof and then your fresh
 * countersign, because the owner is the one who wants green." There are three
 * ways to loosen this gate, and each needs the OWNER's countersign:
 *
 *   1. raise a baseline pin, or add one        G0-RAISE: <RULE> <file>@<hash> — <reason>
 *      (every pin of a rule the base lacks)    G0-RAISE: <RULE> *@<hash> — <reason>
 *   2. add, copy, move or renew an exception   G0-RAISE: <RULE> <file>@<hash> — <reason>
 *   3. change what a gate runs: the gate's     G0-RAISE: GATE <what>@<hash> — <reason>
 *      own code, its CI steps, a gate script,
 *      a pnpm script or turbo task a gate runs,
 *      a gate's config (biome.json, a nested
 *      biome config, a new .gitignore line), or
 *      a rise in another gate's baseline
 *
 * The <hash> is a short hash of the item's content as the change leaves it,
 * and the gate prints it in the line to sign (owner, 19 Nov). So a countersign
 * covers exactly what the owner saw: an amend that folds a further change into
 * the signing commit, a countersign cherry-picked onto another change, or a
 * change to the same item merged in from the base all change the hash, and
 * the gate asks again, printing the new one.
 *
 * The countersign is a trailer line in a commit message in the range being
 * checked. It counts only in a commit with no `Co-Authored-By: Claude` line
 * (owner, 18 Nov). A pull request into dev is where it is judged; a push to
 * dev or main, and a release PR from dev, only note what is unsigned (owner,
 * 19 Nov), because two PRs that each signed the same file produce a merged
 * state neither signed.
 *
 * THREAT MODEL (owner, 18 Nov): honest agents that make eager mistakes, such
 * as signing their own raise or breaking this check while refactoring it. When
 * a change touches the gate's own code, the runner also has the BASE commit's
 * copy of the gate judge the countersigns, so a bug in the new copy can't
 * approve itself. An agent that deliberately forges (leaves out its
 * attribution, edits its own CI) is not stopped here; review is the backstop.
 *
 * Lowering never needs a countersign: it only tightens.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { IGNORE_KEYWORD, parseIgnores } from './architecture-ignores.mjs';
import { JOB_HEAD, pnpmScript } from './architecture-lists.mjs';
import {
  enclosingName,
  MATCHERS,
  maskStringsWithLines,
} from './architecture-matchers.mjs';
import { tokenize } from './check-data-access-contract.mjs';

/**
 * Where the gate's runner has lived, oldest first. "Does the base have a
 * gate?" is asked of every path here, so moving the runner can't make a base
 * look gate-free. A move ADDS its new path; the self-test fails when the
 * runner isn't at one of these.
 */
export const GATE_ENTRY_PATHS = ['scripts/checks/check-architecture.mjs'];

/** The gate's own folder: every tracked file in it is gate code, except the baseline. */
export const GATE_DIR = 'scripts/checks/';

/**
 * Gate code outside GATE_DIR: the workflow that runs it, the hook and the
 * local mirror of CI. The calling workflows are fingerprinted by callerPrint,
 * because most of what they hold is unrelated test jobs.
 */
const GATE_CODE_ELSEWHERE = [
  '.github/workflows/static_analysis.yml',
  '.husky/pre-commit',
  '.claude/skills/codex-epic-implement/scripts/gate.sh',
];

/** Whether a path is the gate's own code. The baseline has its own per-pin check. */
export function isGateCode(file, baselineFile) {
  if (file === baselineFile) return false;
  return file.startsWith(GATE_DIR) || GATE_CODE_ELSEWHERE.includes(file);
}

/** The short content hash a countersign names: 8 hex digits of sha256. */
export function hashOf(value) {
  const text =
    typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}

const COUNTERSIGN =
  /^[ \t]*G0-RAISE:[ \t]+(\S+)[ \t]+(\S+)[ \t]+(?:—|--?)[ \t]+(.+?)[ \t]*$/gm;

/** A commit an agent wrote: its countersigns don't count. */
const AGENT_COMMIT =
  /^Co-Authored-By:.*(?:\bClaude\b|noreply@anthropic\.com)/im;

/**
 * The countersigns in some commit messages, as "RULE target" strings, the
 * target carrying its `@hash`. A reason must be at least three words and hold
 * no `<placeholder>`, so a line that says nothing, or the gate's own template
 * pasted back, doesn't count.
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

// ---------------------------------------------------------------------------
// What a change loosens, each with the hash a countersign must name
// ---------------------------------------------------------------------------

/**
 * A raised pin as the item to sign: its key, the hash of the pin as the
 * change leaves it, and, for a rule the base lacked, the whole-rule form
 * (`RULE *`) with the hash of the rule's whole block.
 */
export function raiseItem(r, afterBaseline) {
  return {
    key: `${r.ruleId} ${r.file}`,
    state: hashOf(r.now),
    star: r.newRule
      ? { key: `${r.ruleId} *`, state: hashOf(afterBaseline[r.ruleId]) }
      : null,
    what: `${r.ruleId} ${r.file}: ${describeRaise(r)}`,
  };
}

/** The line to sign for an item: its whole-rule form when it has one. */
const signLine = (item) => {
  const { key, state } = item.star ?? item;
  return `G0-RAISE: ${key}@${state} — <why>`;
};

/**
 * The items no countersign covers, grouped by the line to sign (every pin of
 * a new rule shares one `RULE *` line).
 *
 * @param {{ key: string, state: string, star: object|null, what: string }[]} items
 * @param {Set<string>} signed  "KEY@hash" strings from owner commits
 * @returns {{ line: string, what: string[] }[]}
 */
export function uncovered(items, signed) {
  const lines = new Map();
  for (const item of items) {
    const ok =
      signed.has(`${item.key}@${item.state}`) ||
      (item.star && signed.has(`${item.star.key}@${item.star.state}`));
    if (ok) continue;
    const line = signLine(item);
    if (!lines.has(line)) lines.set(line, []);
    lines.get(line).push(item.what);
  }
  return [...lines].map(([line, what]) => ({ line, what }));
}

// ---------------------------------------------------------------------------
// The parts of other files the gates depend on
// ---------------------------------------------------------------------------

/**
 * What a calling workflow contributes to the gate: its triggers, its
 * concurrency, and the job that runs the static-analysis workflow. Comments
 * (whole-line or trailing) and blank lines are left out and never end a block
 * (YAML ignores a comment's indentation), so only a real change counts.
 */
export function callerPrint(text, workflow) {
  if (text === null) return null;
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+#(?=[^'"]*$).*$/, ''));
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
    if (/^(['"]?)(?:on|concurrency)\1\s*:/.test(line)) {
      keep.push(...block(i, (l) => /^\S/.test(l)));
    }
    if (JOB_HEAD.test(line)) {
      const job = block(i, (l) => /^ {0,2}\S/.test(l));
      const uses = job.some(
        // a comment line never starts with `uses:`, so it can't pull a job in
        (l) => /^\s*(['"]?)uses\1\s*:/.test(l) && l.includes(`./${workflow}`)
      );
      if (uses) keep.push(...job);
    }
  });
  return keep
    .filter((l) => !isNoise(l))
    .map((l) => l.trimEnd())
    .join('\n');
}

/** `apps/*` and the like (pnpm-workspace.yaml globs) as an anchored RegExp. */
const workspaceGlob = (glob) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\0')
      .replace(/\*/g, '[^/]+')
      .replace(/\0/g, '.*')}/package\\.json$`
  );

/** The package.json files pnpm treats as the workspace: the root plus pnpm-workspace.yaml's globs. */
function workspacePackages(files, read) {
  const yaml = read('pnpm-workspace.yaml') ?? '';
  const globs = [];
  let inPackages = false;
  for (const line of yaml.split('\n')) {
    if (/^packages\s*:/.test(line)) inPackages = true;
    else if (/^\S/.test(line)) inPackages = false;
    else if (inPackages) {
      const m = /^\s*-\s*(['"]?)([^'"#\s]+)\1/.exec(line);
      if (m) globs.push(workspaceGlob(m[2]));
    }
  }
  return files.filter(
    (f) => f === 'package.json' || globs.some((re) => re.test(f))
  );
}

/** The files a `node …` command runs: every file argument with --test, else the entry. */
function nodeFiles(words) {
  const files = [];
  const test = words.includes('--test');
  const takesValue = new Set([
    '--import',
    '--require',
    '-r',
    '--loader',
    '--experimental-loader',
    '--env-file',
  ]);
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    if (takesValue.has(w)) {
      k += 1;
      continue;
    }
    if (w.startsWith('-')) continue;
    if (/\.[mc]?[jt]s$/.test(w)) files.push(w);
    if (!test) break; // the rest are the script's own arguments
  }
  return files;
}

const pick = (value, path) =>
  path.reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), value);

/**
 * Everything the registry's other gates run, as parts: `changed(before,
 * after)` says whether a change to the part loosens that gate, and
 * `state(text)` is what a countersign's hash covers. Derived from each gate's
 * commands, followed as a shell would:
 *
 *   node [flags] <file …>    the file, and every module it imports relatively
 *   pnpm [--filter p] [run] <script>
 *                            the script's value in that package, followed in
 *                            turn, and pnpm-workspace.yaml (which --filter
 *                            resolves through)
 *   turbo [run] <task>       the task in turbo.json and in every package's
 *                            turbo.json, and every workspace package's script
 *                            for it
 *
 * plus what the registry declares: `files` (configs like biome.json) and
 * `ratchets` (another gate's baseline, where only a rise counts). Globs a
 * gate reads by pattern (`filesMatching`) are matched against the change by
 * the caller, since a new nested config is not a tracked file yet.
 *
 * @param {{ files: string[], read: (file: string) => string|null }} tree
 */
export function gateDependencies(gates, { files, read }) {
  const tracked = new Set(files);
  const parts = new Map();
  const add = (part) => {
    if (!parts.has(part.label)) parts.set(part.label, part);
  };
  const whole = (file) =>
    add({ label: file, file, changed: (a, b) => a !== b, state: (t) => t });
  const json = (file, path, label) =>
    add({
      label,
      file,
      changed: (a, b) =>
        JSON.stringify(pick(parseJson(a), path)) !==
        JSON.stringify(pick(parseJson(b), path)),
      state: (t) => pick(parseJson(t), path) ?? null,
    });
  const packages = workspacePackages(files, read);
  const packageNamed = (name) =>
    packages.find((f) => parseJson(read(f))?.name === name) ?? null;
  const dirOf = (file) => posix.dirname(file).replace(/^\.$/, '');
  const resolveModule = (path) =>
    [path, `${path}.mjs`, `${path}.js`, `${path}.ts`, `${path}/index.mjs`].find(
      (p) => tracked.has(p)
    ) ?? null;

  const followNode = (file, seen) => {
    if (seen.has(file)) return;
    seen.add(file);
    whole(file);
    const text = read(file);
    if (text === null || /\.json$/.test(file)) return;
    for (const m of text.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])(\.{1,2}\/[^'"]+)\1/gm
    )) {
      const target = resolveModule(posix.join(posix.dirname(file), m[2]));
      if (target) followNode(target, seen);
    }
  };
  const scripts = new Set();
  const script = (file, name) => {
    const label = `${file}#scripts.${name}`;
    json(file, ['scripts', name], label);
    if (scripts.has(label)) return;
    scripts.add(label);
    const value = parseJson(read(file))?.scripts?.[name];
    if (typeof value === 'string') runs(value, dirOf(file));
  };
  const turboTask = (task) => {
    json('turbo.json', ['tasks', task], `turbo.json#tasks.${task}`);
    for (const pkg of packages) {
      const nested = `${dirOf(pkg) ? `${dirOf(pkg)}/` : ''}turbo.json`;
      if (nested !== 'turbo.json' && tracked.has(nested)) {
        json(nested, ['tasks', task], `${nested}#tasks.${task}`);
      }
      if (parseJson(read(pkg))?.scripts?.[task] !== undefined)
        script(pkg, task);
    }
  };
  const runs = (command, dir) => {
    for (const segment of command.split(/&&|\|\||;|\|/)) {
      const words = segment.trim().split(/\s+/).filter(Boolean);
      if (words[0] === 'node') {
        for (const f of nodeFiles(words.slice(1))) {
          followNode(posix.normalize(dir ? `${dir}/${f}` : f), new Set());
        }
      } else if (words[0] === 'turbo') {
        const task = words[1] === 'run' ? words[2] : words[1];
        if (task && !task.startsWith('-')) turboTask(task);
      } else if (words[0] === 'pnpm') {
        // --filter resolves through the workspace list; without one, pnpm
        // runs a single project.
        if (tracked.has('pnpm-workspace.yaml')) whole('pnpm-workspace.yaml');
        const target = pnpmScript(words.join(' '));
        if (!target) continue;
        const file =
          target.pkg === '(root)'
            ? dir
              ? `${dir}/package.json`
              : 'package.json'
            : packageNamed(target.pkg);
        if (file) script(file, target.script);
      }
    }
  };

  for (const gate of gates) {
    for (const command of [gate.before, gate.selfTest, gate.run].filter(
      Boolean
    )) {
      runs(command, '');
    }
    for (const file of gate.files ?? []) whole(file);
    for (const file of gate.ratchets ?? []) {
      add({ label: file, file, changed: countsRose, state: (t) => t });
    }
  }
  return [...parts.values()];
}

/** Whether a .gitignore change adds a line (a removal only un-ignores). */
function addsIgnoreLine(before, after) {
  const rules = (t) =>
    (t ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  const was = rules(before);
  return rules(after).some((l) => !was.includes(l));
}

/** A repo-relative glob (`**`, `*`, `{a,b}`) as an anchored RegExp. */
function globRe(glob) {
  let re = '';
  for (let k = 0; k < glob.length; k++) {
    const c = glob[k];
    if (c === '*' && glob[k + 1] === '*') {
      re += glob[k + 2] === '/' ? '(?:.*/)?' : '.*';
      k += glob[k + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '{') re += '(?:';
    else if (c === '}') re += ')';
    else if (c === ',') re += '|';
    else re += c.replace(/[.+^$()|[\]\\?]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
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

/** Every tracked path in the checkout. */
function trackedFiles(root) {
  return splitZ(git(root, ['ls-files', '-z']).stdout);
}

/** Whether a commit holds the gate (at any path it has lived at). */
export function gateAt(root, ref) {
  return GATE_ENTRY_PATHS.find(
    (p) =>
      git(root, ['cat-file', '-e', `${ref}:${p}`], { allowFail: true })
        .status === 0
  );
}

/**
 * The owner's countersigns in base..HEAD ("KEY@hash"), the agent commits whose
 * trailers were not counted, and the owner trailers that name no hash (the
 * old form, which covers nothing).
 */
export function countersignsIn(root, base) {
  const signed = new Set();
  const byAgent = [];
  const unbound = [];
  const log = git(root, [
    'log',
    '-z',
    '--format=%H%n%B',
    `${base}..HEAD`,
  ]).stdout;
  for (const entry of splitZ(log)) {
    const body = entry.slice(entry.indexOf('\n') + 1);
    const found = parseCountersigns(body);
    if (found.size === 0) continue;
    if (AGENT_COMMIT.test(body)) {
      byAgent.push(entry.slice(0, 9));
      continue;
    }
    for (const s of found) {
      if (/@[0-9a-f]{8}$/.test(s)) signed.add(s);
      else unbound.push(s);
    }
  }
  return { signed, byAgent, unbound };
}

/**
 * Everything the working tree loosens relative to `ref`, as items to sign,
 * whatever countersigns exist.
 */
function loosenedSince(root, registry, baselineFile, ref) {
  const { rules, gates = [], callers = [] } = registry;
  const changed = changedSince(root, ref);
  const renames = renamesSince(root, ref);
  const files = trackedFiles(root);
  const readHead = (file) =>
    existsSync(join(root, file))
      ? readFileSync(join(root, file), 'utf8')
      : null;
  const parse = (text, where) => {
    try {
      return JSON.parse(text ?? '{}');
    } catch (err) {
      throw new Error(
        `${baselineFile} at ${where} is not valid JSON (${err.message})`
      );
    }
  };
  // A moved baseline is read at its old path at the base.
  const beforeBaseline = parse(
    showAt(root, ref, renames.get(baselineFile) ?? baselineFile),
    ref
  );
  const afterBaseline = parse(readHead(baselineFile), 'the working tree');

  const items = new Map();
  const add = (item) => {
    const id = `${item.key}@${item.state}`;
    if (!items.has(id)) items.set(id, item);
  };

  for (const r of raisedEntries(rules, beforeBaseline, afterBaseline, {
    renames,
    baseRuleIds: ruleIdsAt(root, ref),
  })) {
    add(raiseItem(r, afterBaseline));
  }

  for (const file of changed) {
    const after = readHead(file);
    if (after === null || !after.includes(IGNORE_KEYWORD)) continue;
    const from = renames.get(file) ?? file;
    const sigs = exceptionSignatures(file, after);
    for (const d of newExceptions(file, showAt(root, ref, from), after)) {
      add({
        key: `${d.ruleId} ${file}`,
        state: hashOf(
          sigs
            .filter((x) => x.d.ruleId === d.ruleId)
            .map((x) => x.sig)
            .sort()
        ),
        star: null,
        what: `${file}:${d.line}: a new, copied, moved or renewed ${IGNORE_KEYWORD} for ${d.ruleId}`,
      });
    }
  }

  const gate = (label, content, what) =>
    add({ key: `GATE ${label}`, state: hashOf(content), star: null, what });
  for (const file of changed) {
    if (isGateCode(file, baselineFile)) {
      gate(file, readHead(file), `${file}: the gate's own code changed`);
    }
  }
  const workflow = '.github/workflows/static_analysis.yml';
  for (const caller of callers) {
    if (!changed.includes(caller)) continue;
    const after = callerPrint(readHead(caller), workflow);
    if (callerPrint(showAt(root, ref, caller), workflow) !== after) {
      gate(
        caller,
        after,
        `${caller}: its triggers, concurrency or static-analysis job changed`
      );
    }
  }
  for (const part of gateDependencies(gates, { files, read: readHead })) {
    if (!changed.includes(part.file)) continue;
    const after = readHead(part.file);
    if (part.changed(showAt(root, ref, part.file), after)) {
      gate(
        part.label,
        part.state(after),
        `${part.label}: what a gate runs changed`
      );
    }
  }
  for (const g of gates) {
    for (const glob of g.filesMatching ?? []) {
      const re = globRe(glob);
      for (const file of changed) {
        if (!re.test(file)) continue;
        const before = showAt(root, ref, renames.get(file) ?? file);
        const after = readHead(file);
        const ignore = posix.basename(file) === '.gitignore';
        if (ignore ? !addsIgnoreLine(before, after) : before === after) {
          continue;
        }
        gate(
          file,
          after,
          ignore
            ? `${file}: a new ignore line, and ${g.id} skips what it matches`
            : `${file}: a config ${g.id} reads`
        );
      }
    }
  }
  return [...items.values()];
}

/**
 * Everything the working tree loosens relative to `base` that the owner
 * hasn't countersigned at its current hash.
 *
 * @param {{ rules: object[], gates?: object[], callers?: string[] }} registry
 * @returns {{ skipped?: string, missing: { line: string, what: string[] }[],
 *   byAgent: string[], unbound: string[] }}
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
  if (!gateAt(root, base)) {
    return {
      skipped: `${base} has no architecture gate yet; nothing to countersign`,
      missing: [],
      byAgent: [],
      unbound: [],
    };
  }
  const items = loosenedSince(root, registry, baselineFile, base);
  const { signed, byAgent, unbound } = countersignsIn(root, base);
  return { missing: uncovered(items, signed), byAgent, unbound };
}

// ---------------------------------------------------------------------------
// What CI compares with
// ---------------------------------------------------------------------------

/**
 * The commit a CI run compares with, and what kind of run it is:
 *
 *   pr       a pull request: the base it merges into (HEAD^1 of the merge
 *            commit GitHub checks out, so a base that moved on is seen)
 *   release  a pull request from this repo's dev into main: as pr, but
 *            unbanked fixes and unsigned loosening are notices
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
    // A release PR (this repo's dev into main) brings every fix and every
    // signed loosening dev holds; judging them is dev's PRs' job, so here they
    // are notices, as on a push to dev. A fork's branch named dev is no release.
    const headRepo = payload.pull_request?.head?.repo?.full_name;
    const sameRepo = !headRepo || headRepo === payload.repository?.full_name;
    const release =
      env.GITHUB_HEAD_REF === 'dev' &&
      env.GITHUB_BASE_REF === 'main' &&
      sameRepo;
    return { kind: release ? 'release' : 'pr', base };
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
