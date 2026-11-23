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
 *      biome config, an ignore file), or a
 *      rise in another gate's baseline
 *
 * That list is CLOSED: S6 of architecture-spec.mjs says exactly what is on it
 * and what is outside it, and a command the reader can't resolve is a
 * registry error rather than a part that fingerprints nothing.
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
import {
  globToRegExp,
  JOB_HEAD,
  parseJsonc,
  pnpmCommand,
} from './architecture-lists.mjs';
import {
  enclosingName,
  MATCHERS,
  scanSource,
} from './architecture-matchers.mjs';

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

/** JSON with every object's keys sorted, so key order never changes a hash. */
function canonical(value) {
  return JSON.stringify(value ?? null, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]])
        )
      : v
  );
}

/** The short content hash a countersign names: 8 hex digits of sha256. */
export function hashOf(value) {
  const text = typeof value === 'string' ? value : canonical(value);
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}

/** A pin as its countersign covers it: a key pin is a multiset, so sorted. */
const canonicalPin = (pin) => (Array.isArray(pin) ? [...pin].sort() : pin);

/** The hash a pin's countersign names (a raise, or growth into the pin). */
export const pinState = (pin) => hashOf(canonicalPin(pin));

/** The hash a `RULE *` countersign names: the rule's whole block. */
export const blockState = (block) =>
  hashOf(
    Object.fromEntries(
      Object.entries(block ?? {}).map(([file, pin]) => [
        file,
        canonicalPin(pin),
      ])
    )
  );

/** The target runs up to its `@hash`, so a path with a space can be signed. */
const COUNTERSIGN =
  /^[ \t]*G0-RAISE:[ \t]+(\S+)[ \t]+(.+?@[0-9a-f]{8}|\S+)[ \t]+(?:—|--?)[ \t]+(.+?)[ \t]*$/gm;

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
      const { masked, startsInside } = scanSource(text);
      context = { maskedLines: masked.split('\n'), startsInside };
    }
    return enclosingName(context.maskedLines, line, {
      startsInside: context.startsInside,
      lines,
      file,
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
    state: pinState(r.now),
    star: r.newRule
      ? { key: `${r.ruleId} *`, state: blockState(afterBaseline[r.ruleId]) }
      : null,
    what: [`${r.ruleId} ${r.file}: ${describeRaise(r)}`],
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
    lines.get(line).push(...[item.what].flat());
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

/** What a reader returns for text it can't parse: the raw text, so a change to it still counts. */
class Unparseable {
  constructor(text) {
    this.unparseable = text;
  }
}

/** One glob of pnpm-workspace.yaml's list, quoted or not; undefined for a form this doesn't read. */
function workspaceGlobOf(item) {
  const text = item.trim();
  const quoted = /^(['"])(.*)\1$/.exec(text);
  const glob = quoted ? quoted[2] : text;
  // an unquoted `*x` or `&x` is a YAML alias or anchor; `!` is an exclusion
  if (!quoted && /^[*&]/.test(glob)) return undefined;
  return /^[^'"#\s,![\]{}]+$/.test(glob) ? glob : undefined;
}

/**
 * pnpm-workspace.yaml's `packages:` list, in each YAML form pnpm reads the
 * same: a block sequence, indented or at column 0, or a one-line flow
 * sequence, under a key quoted or not. A form this doesn't read (an anchor, a
 * `!` exclusion, anything else under the key) is Unparseable, which the
 * caller makes a registry error: never an empty workspace (review round 6).
 */
function workspaceList(yaml) {
  if (yaml === null) return null;
  const lines = yaml.replace(/^﻿/, '').split('\n');
  const uncommented = (l) => l.replace(/(^|\s)#.*$/, '');
  for (let i = 0; i < lines.length; i++) {
    const key = /^(['"]?)packages\1\s*:(.*)$/.exec(lines[i]);
    if (!key) continue;
    const value = uncommented(key[2]).trim();
    let globs = null;
    if (/^\[.*\]$/.test(value)) {
      globs = value
        .slice(1, -1)
        .split(',')
        .filter((s) => s.trim())
        .map(workspaceGlobOf);
    } else if (value === '') {
      globs = [];
      for (const raw of lines.slice(i + 1)) {
        const line = uncommented(raw);
        if (line.trim() === '') continue;
        const item = /^\s*-\s+(.*)$/.exec(line);
        if (item) globs.push(workspaceGlobOf(item[1]));
        else if (/^\S/.test(line))
          break; // the next key
        else globs.push(undefined); // something under the key this doesn't read
      }
    }
    return globs?.length && globs.every(Boolean)
      ? globs
      : new Unparseable(yaml);
  }
  return [];
}

/** The package.json files pnpm treats as the workspace: the root plus the list's globs. */
function workspacePackages(files, globs) {
  const res = globs.map(workspaceGlob);
  return files.filter(
    (f) => f === 'package.json' || res.some((re) => re.test(f))
  );
}

/**
 * pnpm-workspace.yaml's settings that decide how every script runs. pnpm 10
 * reads them there as well as in .npmrc, and `scriptShell: /usr/bin/true`
 * switches every gate script off (owner, 23 Nov). Each value is its line's
 * text after the colon; every other key stays outside (S6).
 */
const SCRIPT_SETTINGS = [
  'scriptShell',
  'shellEmulator',
  'ignoreScripts',
  'enablePrePostScripts',
];
function scriptSettings(yaml) {
  if (yaml === null) return null;
  const out = {};
  for (const line of yaml.replace(/^﻿/, '').split('\n')) {
    const m = /^(['"]?)([\w-]+)\1\s*:(.*)$/.exec(line);
    if (m && SCRIPT_SETTINGS.includes(m[2])) out[m[2]] = m[3].trim();
  }
  return out;
}

/**
 * The files a node-like command runs: every file argument with --test, else
 * the entry; the modules it preloads (`--import ./x.mjs`, `-r ./x.cjs`; a
 * package name stays outside); and its `--env-file`s.
 */
function nodeFiles(words) {
  const files = [];
  const preloads = [];
  const envFiles = [];
  const test = words.includes('--test');
  const PRELOAD = new Set([
    '--import',
    '--require',
    '-r',
    '--loader',
    '--experimental-loader',
  ]);
  for (let k = 0; k < words.length; k++) {
    const eq = /^(--[\w-]+)=(.*)$/.exec(words[k]);
    const flag = eq ? eq[1] : words[k];
    if (PRELOAD.has(flag) || flag === '--env-file') {
      const value = eq ? eq[2] : words[++k];
      if (value === undefined) continue;
      if (flag === '--env-file') envFiles.push(value);
      else if (/^\.{1,2}\//.test(value) || /\.[mc]?[jt]s$/.test(value)) {
        preloads.push(value);
      }
      continue;
    }
    if (flag.startsWith('-')) continue;
    if (/\.[mc]?[jt]s$/.test(flag)) files.push(flag);
    if (!test) break; // the rest are the script's own arguments
  }
  return { files, preloads, envFiles };
}

/** A command segment's words, as a shell splits them: `A="b c"` is one word, quotes dropped. */
function shellWords(segment) {
  return [...segment.matchAll(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)].map((m) =>
    m[0].replace(/"([^"]*)"|'([^']*)'/g, '$1$2')
  );
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/**
 * A command with its wrappers peeled off: leading `VAR=value`s, `env` and
 * `cross-env` with their assignments, `dotenv [options] --`, `time`, `nice`
 * and `exec` each run the rest as a command. A string is why the gate can't
 * read it: a `NODE_OPTIONS` that preloads a module (a memory flag is fine),
 * an `env` flag, a `dotenv` without `--`.
 */
function peel(words) {
  let rest = words;
  for (;;) {
    while (rest.length && ASSIGNMENT.test(rest[0])) {
      const options = /^NODE_OPTIONS=(.*)$/.exec(rest[0])?.[1] ?? '';
      if (
        /(?:^|\s)(?:--import|--require|-r|--loader|--experimental-loader)\b/.test(
          options
        )
      ) {
        return 'a NODE_OPTIONS preload, which the gate cannot follow';
      }
      rest = rest.slice(1);
    }
    const [first] = rest;
    if (first === 'env' || first === 'cross-env') {
      rest = rest.slice(1);
      if (rest[0]?.startsWith('-'))
        return `an ${first} flag the gate cannot read`;
    } else if (first === 'dotenv') {
      const end = rest.indexOf('--');
      if (end === -1) return 'dotenv without -- before its command';
      rest = rest.slice(end + 1);
    } else if (first === 'time' || first === 'nice' || first === 'exec') {
      rest = rest.slice(1);
    } else {
      return rest;
    }
  }
}

/** Runners that run a file with node, read as node is. */
const NODE_LIKE = new Set(['node', 'tsx', 'ts-node', 'vite-node']);
const SHELLS = new Set(['bash', 'sh', 'zsh']);
/**
 * The binaries a gate's commands may run whose command text is all the gate
 * reads of them: the tools the registry's gates reach, at the versions the
 * lockfile pins (S6 outside). Any other first word (vitest, npx, concurrently,
 * a new tool) is a registry error until it is added here or followed: an
 * allow-list, not a guess that an unknown word reads nothing (review round 6).
 */
const LEAF_BINARIES = new Set([
  'biome',
  'husky',
  'paraglide-js',
  'svelte-check',
  'svelte-kit',
  'tsc',
  'vite',
  'echo',
  'true',
]);
/** Scripts `pnpm install` runs in every workspace package, before every later gate. */
const LIFECYCLE = [
  'pnpm:devPreinstall',
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
];
/** A Biome config, at any depth. */
const BIOME_CONFIG = /(?:^|\/)\.?biome\.jsonc?$/;

const pick = (value, path) =>
  path.reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), value);

/** A JSON(C) file at a path, or Unparseable when it doesn't parse. */
const view = (text, path) => {
  if (text === null) return null;
  try {
    return pick(parseJsonc(text), path) ?? null;
  } catch {
    return new Unparseable(text);
  }
};

/**
 * The tasks a turbo task runs through `dependsOn` (`^build` -> build), itself
 * first, read from the root turbo.json and from every package's own, since a
 * package's turbo.json can give its task another dependency (review round 6).
 * One set for every package: a task reached in any package counts in all of
 * them (owner, 23 Nov: the whole closure).
 */
function taskClosure(task, configs) {
  const seen = new Set();
  const visit = (t) => {
    if (seen.has(t)) return;
    seen.add(t);
    for (const tasks of configs) {
      if (!tasks || typeof tasks !== 'object') continue;
      for (const [key, config] of Object.entries(tasks)) {
        if (key !== t && !key.endsWith(`#${t}`)) continue;
        const deps = Array.isArray(config?.dependsOn) ? config.dependsOn : [];
        for (const dep of deps) {
          if (typeof dep === 'string')
            visit(dep.replace(/^\^/, '').replace(/^.*#/, ''));
        }
      }
    }
  };
  visit(task);
  return [...seen];
}

/**
 * Everything the registry's other gates run, as parts: `changed(before,
 * after)` says whether a change to the part loosens that gate, and
 * `state(text)` is what a countersign's hash covers. Derived from each gate's
 * commands, followed as a shell would (S6 of architecture-spec.mjs):
 *
 *   node|tsx|ts-node|vite-node [flags] <file …>
 *                            the file, every module it imports relatively,
 *                            what it preloads, and its --env-file
 *   env, cross-env, dotenv … --, time, nice, exec, VAR=value
 *                            peeled: the rest is the command
 *   pnpm [-F|--filter[=]p] [run] <script> [args]
 *                            the script's value in that package, with its
 *                            pre/post scripts, followed in turn; a bare
 *                            `pnpm <name>` with no such script runs <name>
 *                            as `pnpm exec` does. pnpm-workspace.yaml's
 *                            packages list and script settings, .npmrc and
 *                            .pnpmfile.cjs
 *   turbo [run] <task …>     the root turbo.json, whole; every task the task
 *                            depends on, root or package turbo.json, at each
 *                            package's turbo.json and as each package's script
 *   bash <file>, ./<file>    the file; a ./<file>.mjs is followed as node
 *
 * plus every workspace package's install lifecycle scripts, and what the
 * registry declares: `files` (configs like biome.json, with the files a Biome
 * config `extends`) and `ratchets` (another gate's baseline, where only a rise
 * counts). Globs a gate reads by pattern (`filesMatching`) are matched against
 * the change by the caller, since a new nested config is not a tracked file
 * yet; the tracked ones' `extends` are followed here.
 *
 * A command it can't resolve (`pnpm -r`, a filter naming no package, `node`
 * with no file, a first word that isn't in LEAF_BINARIES), and a manifest it
 * derives parts from but can't parse, becomes a part no tracked file can be,
 * so the full run's registry check names it and exits 2: never a part that
 * fingerprints nothing.
 *
 * @param {{ files: string[], read: (file: string) => string|null }} tree
 */
export function gateDependencies(gates, { files, read: readFile }) {
  const tracked = new Set(files);
  // Each file is read once: over a base tree every read is a `git show`.
  const texts = new Map();
  const read = (file) => {
    if (!texts.has(file)) texts.set(file, readFile(file));
    return texts.get(file);
  };
  const parts = new Map();
  const add = (part) => {
    if (!parts.has(part.label)) parts.set(part.label, part);
  };
  // A JSON file is compared and hashed in canonical form, so re-sorting one
  // signs nothing away and asks nothing (S7).
  const whole = (file) =>
    /\.jsonc?$/.test(file)
      ? add({
          label: file,
          file,
          changed: (a, b) => canonical(view(a, [])) !== canonical(view(b, [])),
          state: (t) => view(t, []),
        })
      : add({ label: file, file, changed: (a, b) => a !== b, state: (t) => t });
  const json = (file, path, label) =>
    add({
      label,
      file,
      changed: (a, b) => canonical(view(a, path)) !== canonical(view(b, path)),
      state: (t) => view(t, path),
    });
  const unreadable = (command, why) =>
    add({
      label: `${command} (${why})`,
      file: `\0${command}`,
      changed: () => false,
      state: () => null,
    });
  // A file parts are DERIVED from must parse: read as no scripts and no tasks,
  // an unparseable one (a BOM'd manifest) hid every part it holds (round 6).
  const parsed = (file, path) => {
    const value = view(read(file), path);
    if (!(value instanceof Unparseable)) return value;
    unreadable(file, 'a file the gate derives parts from but cannot parse');
    return null;
  };
  const list = workspaceList(read('pnpm-workspace.yaml'));
  if (list instanceof Unparseable) {
    unreadable('pnpm-workspace.yaml', 'a packages list the gate cannot read');
  }
  const packages = workspacePackages(files, Array.isArray(list) ? list : []);
  const scriptsOf = (file) => parsed(file, ['scripts']);
  const packageNamed = (name) =>
    packages.find((f) => parsed(f, ['name']) === name) ?? null;
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
  // A script with its pre/post scripts; a pre/post part only where one exists.
  const script = (file, name) => {
    for (const n of [`pre${name}`, name, `post${name}`]) {
      const value = scriptsOf(file)?.[n];
      if (n !== name && value === undefined) continue;
      const label = `${file}#scripts.${n}`;
      json(file, ['scripts', n], label);
      if (scripts.has(label)) continue;
      scripts.add(label);
      if (typeof value === 'string') runs(value, dirOf(file));
    }
  };
  const nestedTurbo = (pkg) => {
    const dir = dirOf(pkg);
    return dir && tracked.has(`${dir}/turbo.json`) ? `${dir}/turbo.json` : null;
  };
  const turboTask = (task) => {
    whole('turbo.json');
    const closure = taskClosure(task, [
      parsed('turbo.json', ['tasks']),
      ...packages
        .map(nestedTurbo)
        .filter(Boolean)
        .map((f) => parsed(f, ['tasks'])),
    ]);
    for (const pkg of packages) {
      const nested = nestedTurbo(pkg);
      for (const t of closure) {
        if (nested) json(nested, ['tasks', t], `${nested}#tasks.${t}`);
        if (scriptsOf(pkg)?.[t] !== undefined) script(pkg, t);
      }
    }
  };
  const pnpmSetup = () => {
    if (tracked.has('pnpm-workspace.yaml')) {
      add({
        label: 'pnpm-workspace.yaml#packages',
        file: 'pnpm-workspace.yaml',
        changed: (a, b) =>
          canonical(workspaceList(a)) !== canonical(workspaceList(b)),
        state: (t) => workspaceList(t),
      });
      add({
        label: 'pnpm-workspace.yaml#settings',
        file: 'pnpm-workspace.yaml',
        changed: (a, b) =>
          canonical(scriptSettings(a)) !== canonical(scriptSettings(b)),
        state: (t) => scriptSettings(t),
      });
    }
    for (const file of ['.npmrc', '.pnpmfile.cjs']) {
      if (tracked.has(file)) whole(file);
    }
  };
  const runs = (command, dir) => {
    for (const segment of command.split(/&&|\|\||;|\|/)) {
      const shown = segment.trim();
      const words = peel(shellWords(segment));
      if (typeof words === 'string') {
        unreadable(shown, words);
        continue;
      }
      if (words.length === 0) continue;
      const [first, ...rest] = words;
      const at = (f) => posix.normalize(dir ? `${dir}/${f}` : f);
      if (NODE_LIKE.has(first)) {
        if (rest.some((w) => ['-e', '--eval', '-p', '--print'].includes(w))) {
          continue; // inline code: the command text is all it runs
        }
        const { files: entry, preloads, envFiles } = nodeFiles(rest);
        if (entry.length === 0) {
          unreadable(shown, `a ${first} command with no file`);
        }
        for (const f of [...preloads, ...entry]) followNode(at(f), new Set());
        for (const f of envFiles) if (tracked.has(at(f))) whole(at(f));
      } else if (first === 'turbo') {
        const tasks = (rest[0] === 'run' ? rest.slice(1) : rest).filter(
          (w) => !w.startsWith('-')
        );
        if (tasks.length === 0)
          unreadable(shown, 'a turbo command with no task');
        for (const task of tasks) turboTask(task);
      } else if (first === 'pnpm') {
        pnpmSetup();
        const target = pnpmCommand(rest);
        if (!target) {
          unreadable(shown, 'a pnpm form the gate cannot follow');
        } else if (target.kind === 'exec' || target.kind === 'script') {
          const file =
            target.pkg === '(root)'
              ? dir
                ? `${dir}/package.json`
                : 'package.json'
              : packageNamed(target.pkg);
          if (!file) {
            unreadable(shown, `no workspace package is named ${target.pkg}`);
          } else if (target.kind === 'exec') {
            runs(target.command, dirOf(file));
          } else {
            script(file, target.script);
            // A bare `pnpm <name>` with no such script runs <name> as a
            // command, as `pnpm exec` does (round 6). The absent script is
            // still a part: adding it changes what runs.
            if (
              target.command &&
              scriptsOf(file)?.[target.script] === undefined
            ) {
              runs(target.command, dirOf(file));
            }
          }
        }
      } else if (SHELLS.has(first)) {
        const file = rest.find((w) => !w.startsWith('-'));
        if (file) whole(at(file));
        else unreadable(shown, `${first} with no script file`);
      } else if (first.includes('/')) {
        // A path command runs by its shebang: node, for a module.
        if (/\.[mc]?[jt]s$/.test(first)) followNode(at(first), new Set());
        else whole(at(first));
      } else if (!LEAF_BINARIES.has(first)) {
        unreadable(shown, `${first} is no command the gate can follow`);
      }
    }
  };
  // The files a Biome config extends decide what it enforces, so each local
  // one is a part (owner, 23 Nov). A package preset stays outside.
  const followExtends = (file, seen = new Set()) => {
    if (seen.has(file)) return;
    seen.add(file);
    const value = parsed(file, ['extends']);
    for (const target of [value ?? []].flat()) {
      if (typeof target !== 'string') continue;
      if (!/^\.{1,2}\//.test(target) && !/\.jsonc?$/.test(target)) continue;
      const path = posix.normalize(posix.join(dirOf(file), target));
      whole(path);
      followExtends(path, seen);
    }
  };

  for (const pkg of packages) {
    for (const name of LIFECYCLE) {
      const value = scriptsOf(pkg)?.[name];
      if (value === undefined) continue;
      json(pkg, ['scripts', name], `${pkg}#scripts.${name}`);
      if (typeof value === 'string') runs(value, dirOf(pkg));
    }
  }
  for (const gate of gates) {
    for (const command of [gate.before, gate.selfTest, gate.run].filter(
      Boolean
    )) {
      runs(command, '');
    }
    for (const file of gate.files ?? []) {
      whole(file);
      if (BIOME_CONFIG.test(file)) followExtends(file);
    }
    const patterns = (gate.filesMatching ?? []).map(globToRegExp);
    for (const file of files) {
      if (BIOME_CONFIG.test(file) && patterns.some((re) => re.test(file))) {
        followExtends(file);
      }
    }
    for (const file of gate.ratchets ?? []) {
      add({
        label: file,
        file,
        changed: countsRose,
        state: (t) => view(t, []),
      });
    }
  }
  return [...parts.values()];
}

/** The ignore files Biome obeys through vcs.useIgnoreFile. */
const IGNORE_FILES = new Set(['.gitignore', '.ignore']);

/**
 * Whether an ignore-file change can make Biome skip a file it checked. The
 * last matching line wins, so only two edits are safe: deleting a plain line
 * (what it ignored is checked again, or still ignored by an earlier line) and
 * adding a `!` line anywhere (a negation can only un-ignore). A new plain
 * line, a lost negation and a new order can each ignore more (review round
 * 5). A file is compared at its own path, because its patterns are relative
 * to its folder: a moved one is a new file there.
 */
function ignoreLoosens(before, after) {
  const rules = (t) =>
    (t ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  const was = rules(before);
  const now = rules(after);
  let i = 0;
  let j = 0;
  while (i < was.length || j < now.length) {
    if (i < was.length && j < now.length && was[i] === now[j]) {
      i += 1;
      j += 1;
    } else if (
      j < now.length &&
      now[j].startsWith('!') &&
      !was.slice(i).includes(now[j])
    ) {
      j += 1; // an added negation
    } else if (i < was.length && !was[i].startsWith('!')) {
      i += 1; // a deleted plain line
    } else {
      return true;
    }
  }
  return false;
}

/** Nested counts where every leaf is a number: true when any leaf grew. */
function countsRose(before, after) {
  const walk = (b, a) => {
    if (typeof a === 'number') return a > (typeof b === 'number' ? b : 0);
    if (a === null || typeof a !== 'object') return a !== b;
    return Object.entries(a).some(([k, v]) => walk(b?.[k], v));
  };
  return walk(view(before, []), view(after, []));
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

/** Every tracked path in the checkout, or in a commit. */
function trackedFiles(root, ref = null) {
  return splitZ(
    ref
      ? git(root, ['ls-tree', '-r', '-z', '--name-only', ref]).stdout
      : git(root, ['ls-files', '-z']).stdout
  );
}

const RULES_PAGE = 'docs/architecture/rules.md';

const existsAt = (root, ref, path) =>
  git(root, ['cat-file', '-e', `${ref}:${path}`], { allowFail: true })
    .status === 0;

/**
 * Where a commit holds the gate's runner (at any path it has lived at), or
 * null when it has no gate yet. A commit that holds the gate's baseline or
 * its rules page but no runner at a listed path is an error, not "no gate":
 * a refactor that moved the runner and REPLACED its path in GATE_ENTRY_PATHS
 * would otherwise switch off every countersign check, the base copy's too
 * (review round 5).
 */
export function gateAt(root, ref, baselineAtRef = null) {
  const entry = GATE_ENTRY_PATHS.find((p) => existsAt(root, ref, p));
  if (entry) return entry;
  const footprints = [RULES_PAGE, baselineAtRef].filter(
    (p) => p && existsAt(root, ref, p)
  );
  if (footprints.length > 0) {
    throw new Error(
      `${ref} holds the gate (${footprints.join(', ')}) but no runner at any of GATE_ENTRY_PATHS (${GATE_ENTRY_PATHS.join(', ')}). A move must ADD the runner's new path to that list, never replace the old one`
    );
  }
  return null;
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

  // Items that share a key and hash share one sign line, and every one of
  // them is listed under it (two exceptions in a file share one hash).
  const items = new Map();
  const add = (item) => {
    const id = `${item.key}@${item.state}`;
    const what = [item.what].flat();
    if (items.has(id)) items.get(id).what.push(...what);
    else items.set(id, { ...item, what });
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
  // Read over BOTH trees: a part only the base has is one the change deleted
  // (a package's typecheck script), and that switches its gate off too.
  const baseTexts = new Map();
  const readBase = (file) => {
    if (!baseTexts.has(file)) baseTexts.set(file, showAt(root, ref, file));
    return baseTexts.get(file);
  };
  const parts = new Map();
  for (const tree of [
    { files, read: readHead },
    { files: trackedFiles(root, ref), read: readBase },
  ]) {
    for (const part of gateDependencies(gates, tree)) {
      if (!parts.has(part.label)) parts.set(part.label, part);
    }
  }
  for (const part of parts.values()) {
    if (!changed.includes(part.file)) continue;
    const after = readHead(part.file);
    if (part.changed(readBase(part.file), after)) {
      gate(
        part.label,
        part.state(after),
        `${part.label}: what a gate runs changed`
      );
    }
  }
  for (const g of gates) {
    for (const glob of g.filesMatching ?? []) {
      const re = globToRegExp(glob);
      for (const file of changed) {
        if (!re.test(file)) continue;
        // At its own path, never through a rename: what an ignore file or a
        // nested config does depends on the folder it sits in.
        const before = readBase(file);
        const after = readHead(file);
        const ignore = IGNORE_FILES.has(posix.basename(file));
        if (ignore ? !ignoreLoosens(before, after) : before === after) {
          continue;
        }
        gate(
          file,
          after,
          ignore
            ? `${file}: an ignore file can now skip more, and ${g.id} skips what it matches`
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
  const baselineAtBase =
    renamesSince(root, base).get(baselineFile) ?? baselineFile;
  if (!gateAt(root, base, baselineAtBase)) {
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
