#!/usr/bin/env node
/**
 * WF-BD-CLOSE (W0, Codex-sqs36): an epic is closed only after its retro, or
 * as abandoned.
 *
 * A Claude Code PreToolUse hook on Bash, wired in the tracked
 * `.claude/settings.json`. Claude Code pipes the tool call to stdin as JSON
 * (`{ tool_name: 'Bash', tool_input: { command }, cwd, … }`). Exit 0 lets the
 * command run. Exit 2 blocks it, and stderr goes back to the agent as the
 * reason. Any other exit is a hook error, and the command runs anyway.
 *
 * It refuses, when the issue is an epic whose `docs/epics/<id>/epic.md` doesn't
 * say retro-done or abandoned:
 *   bd [global flags] close|done <ids…> [--force …]
 *   bd [global flags] update <ids…> --status closed   (or -s closed, -sclosed)
 * It also refuses outright:
 *   bd epic close-eligible            (closes epics in bulk; --dry-run passes)
 *   bd close / bd update -s closed with NO id: bd then closes the "last
 *   touched" issue, which the guard can't see.
 *
 * epic.md is read from the command's checkout (cwd, or `bd -C <dir>`), and
 * from that checkout's `origin/dev` when the local copy isn't done yet, so a
 * merged retro PR counts before you pull.
 *
 * Out of its reach, on purpose: `bd sql`, `batch`, `import`, `supersede`,
 * `duplicate`, a command built at run time (`eval`, a variable holding "bd"),
 * and a human closing an epic in their own shell. It is an agent-side gate.
 *
 * `--check-wiring` is the CI half: it fails unless the tracked
 * `.claude/settings.json` still runs this script on every Bash call.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEpicFile } from './workflow-epic.mjs';

export const DONE_STATUSES = ['retro-done', 'abandoned'];
export const HOOK_SCRIPT = 'scripts/checks/bd-close-guard.mjs';
export const SETTINGS_FILE = '.claude/settings.json';

/** bd's global flags that take a value. The booleans need no list. */
const GLOBAL_VALUE_FLAGS = new Set([
  '--actor',
  '--db',
  '-C',
  '--directory',
  '--dolt-auto-commit',
]);
/** The flags that take a value, per subcommand (bd 1.2.2). */
const VALUE_FLAGS = {
  close: new Set(['-r', '--reason', '--reason-file', '--session']),
  update: new Set([
    '--acceptance',
    '--add-label',
    '--append-notes',
    '-a',
    '--assignee',
    '--await-id',
    '--body-file',
    '--defer',
    '-d',
    '--description',
    '--design',
    '--design-file',
    '--due',
    '-e',
    '--estimate',
    '--external-ref',
    '--metadata',
    '--notes',
    '--parent',
    '-p',
    '--priority',
    '--remove-label',
    '--session',
    '--set-labels',
    '--set-metadata',
    '--spec-id',
    '-s',
    '--status',
    '--title',
    '-t',
    '--type',
    '--unset-metadata',
  ]),
};
VALUE_FLAGS.done = VALUE_FLAGS.close;
/** Words that run the next word as the command. */
const PREFIXES = new Set([
  'command',
  'exec',
  'env',
  'time',
  'nohup',
  'sudo',
  'doas',
  'xargs',
  'timeout',
  'gtimeout',
  'nice',
  'stdbuf',
  'caffeinate',
]);
/**
 * Reserved words that can start a simple command before bd: `if bd close x`,
 * `do bd close x` in a loop, `{ bd close x; }`, `! bd close x`.
 */
const KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
  '!',
  '{',
]);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);

const base = (word) => word.slice(word.lastIndexOf('/') + 1);

/** Whether a command can name bd at all; the fast path for every other Bash call. */
export const mentionsBd = (command) => /(^|[^\w.-])bd(?![\w.-])/.test(command);

/**
 * A shell command line split into simple commands, each a list of words, with
 * quotes and backslashes resolved. Separators: ; & && || | newlines, ( ) and
 * the edges of $( … ) and ` … `, so `x && (bd close y)` yields ['bd','close','y'].
 * Never throws: an unclosed quote runs to the end of the line.
 */
export function simpleCommands(line) {
  const commands = [];
  let words = [];
  let word = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'") {
      const close = line.indexOf("'", i + 1);
      const end = close === -1 ? line.length : close;
      word = (word ?? '') + line.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      word = word ?? '';
      for (i++; i < line.length && line[i] !== '"'; i++) {
        if (
          line[i] === '\\' &&
          i + 1 < line.length &&
          '"\\$`'.includes(line[i + 1])
        )
          i++;
        else if (line[i] === '$' && line[i + 1] === '(') {
          // A $( … ) inside quotes is still a command; split it out.
          const inner = matchParen(line, i + 1);
          commands.push(...simpleCommands(line.slice(i + 2, inner)));
          i = inner;
          continue;
        }
        word += line[i];
      }
    } else if (c === '\\') {
      if (line[i + 1] === '\n') i++;
      else {
        word = (word ?? '') + (line[i + 1] ?? '');
        i++;
      }
    } else if (c === '#' && word === null) {
      const nl = line.indexOf('\n', i);
      i = nl === -1 ? line.length : nl - 1;
    } else if (' \t'.includes(c)) {
      endWord();
    } else if (';&|\n()`'.includes(c) || (c === '$' && line[i + 1] === '(')) {
      if (c === '$') i++;
      endCommand();
    } else {
      word = (word ?? '') + c;
    }
  }
  endCommand();
  return commands;
}

/** The index of the `)` that closes the `(` at `open`, or the line's end. */
function matchParen(line, open) {
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    if (line[i] === '(') depth++;
    else if (line[i] === ')' && --depth === 0) return i;
  }
  return line.length;
}

/**
 * The bd argument lists in a command line: each `bd …` call's words after
 * `bd`, with env assignments, wrappers (`command`, `env`, `xargs`, …) and
 * `sh -c "…"` unwrapped.
 */
export function bdCalls(line) {
  const calls = [];
  for (let words of simpleCommands(line)) {
    for (;;) {
      while (
        words.length &&
        (KEYWORDS.has(words[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]))
      )
        words = words.slice(1);
      if (words.length && PREFIXES.has(base(words[0]))) {
        // A wrapper's own flags may take values (`xargs -n 1`, `sudo -u x`),
        // so jump to the bd or shell it runs, if any.
        const next = words.findIndex(
          (w, i) => i > 0 && (base(w) === 'bd' || SHELLS.has(base(w)))
        );
        words = next === -1 ? [] : words.slice(next);
        continue;
      }
      break;
    }
    if (!words.length) continue;
    const name = base(words[0]);
    if (SHELLS.has(name)) {
      const flag = words.findIndex(
        (w, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(w)
      );
      if (flag !== -1 && words[flag + 1] !== undefined)
        calls.push(...bdCalls(words[flag + 1]));
    } else if (name === 'bd') {
      calls.push(words.slice(1));
    }
  }
  return calls;
}

/**
 * What one bd call would close: `{ ids, globals }` to check, `{ refuse }` to
 * block outright, or null when it closes nothing. `globals` are the flags that
 * pick the database (`--db`, `-C`, `--global`), for the `bd show` that checks.
 */
export function closeIntent(args) {
  const globals = [];
  const positional = [];
  let sub = null;
  let status = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-') || arg === '-') {
      if (sub === null) sub = arg;
      else positional.push(arg);
      continue;
    }
    // Read flags the way pflag (bd's flag parser) does: --name=value and
    // --name value; a short cluster letter by letter, so -qv is two booleans
    // and -qs closed, -qsclosed and -qs=closed end in -s with its value.
    const takesValue = (f) =>
      GLOBAL_VALUE_FLAGS.has(f) || VALUE_FLAGS[sub]?.has(f);
    const pairs = [];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const flag = eq === -1 ? arg : arg.slice(0, eq);
      if (eq !== -1) pairs.push([flag, arg.slice(eq + 1)]);
      else pairs.push([flag, takesValue(flag) ? args[++i] : undefined]);
    } else {
      for (let j = 1; j < arg.length; j++) {
        const flag = `-${arg[j]}`;
        if (!takesValue(flag)) {
          pairs.push([flag, undefined]);
          continue;
        }
        const rest = arg.slice(j + 1);
        pairs.push([flag, rest === '' ? args[++i] : rest.replace(/^=/, '')]);
        break;
      }
    }
    for (const [flag, value] of pairs) {
      if (
        (flag === '--db' || flag === '-C' || flag === '--directory') &&
        value !== undefined
      ) {
        globals.push(flag === '--db' ? '--db' : '-C', value);
      } else if (flag === '--global') {
        globals.push('--global');
      }
      if (sub === 'update' && (flag === '-s' || flag === '--status'))
        status = value;
      if (flag === '--dry-run') dryRun = true;
    }
  }
  if (sub === 'epic') {
    if (positional[0] === 'close-eligible' && !dryRun) {
      return {
        refuse:
          '`bd epic close-eligible` closes epics in bulk, past their retro. Close each epic with `bd close <id>` once its docs/epics/<id>/epic.md says retro-done or abandoned (run it with --dry-run to see the list).',
      };
    }
    return null;
  }
  // bd's help: "bd todo done <id> -> bd close <id>".
  const todoDone = sub === 'todo' && positional[0] === 'done';
  const closes =
    sub === 'close' ||
    sub === 'done' ||
    todoDone ||
    (sub === 'update' && status === 'closed');
  if (!closes) return null;
  const ids = todoDone ? positional.slice(1) : positional;
  const what = todoDone ? 'todo done' : sub;
  if (ids.length === 0) {
    return {
      refuse: `\`bd ${what}\` with no id closes the last touched issue, which may be an epic. Name the id(s) so the guard can check them.`,
    };
  }
  // A variable, a substitution, a glob or xargs' {} is filled in after the
  // guard has looked, so it can't tell whether that id is an epic.
  const unreadable = ids.filter((id) => id === '' || /[$`{}*?[\]]/.test(id));
  if (unreadable.length) {
    return {
      refuse: `\`bd ${what}\` names ${unreadable.map((id) => JSON.stringify(id)).join(', ')}, which the shell fills in after the guard has looked. Name each id literally so the guard can check it.`,
    };
  }
  return { ids, globals };
}

/** The status in an epic.md's front matter (WF-EPIC's own parser), or null. */
function epicStatusIn(text) {
  const parsed = parseEpicFile(text);
  return parsed.error ? null : (parsed.fields.status ?? null);
}

const git = (cwd, args) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

/** The epic.md statuses for an id: the checkout's copy, then its origin/dev copy. */
export function readEpicStatuses(id, dir) {
  let root;
  try {
    root = git(dir, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    root = dir;
  }
  const path = `docs/epics/${id}/epic.md`;
  const statuses = [];
  if (existsSync(join(root, path)))
    statuses.push(epicStatusIn(readFileSync(join(root, path), 'utf8')));
  try {
    statuses.push(epicStatusIn(git(root, ['show', `origin/dev:${path}`])));
  } catch {
    // Not on origin/dev (or no such ref): the local copy decides.
  }
  return { path, statuses };
}

/** The issues bd knows among `ids`, as `{ id, issue_type, status }`. */
export function showIssues(ids, globals, cwd) {
  let out;
  try {
    out = execFileSync('bd', [...globals, 'show', ...ids, '--json'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
  } catch (err) {
    // bd exits 1 with this when none of the ids exist: nothing to close.
    if (
      /no issues? found matching/.test(`${err.stdout ?? ''}${err.stderr ?? ''}`)
    )
      return [];
    throw err;
  }
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * The verdict on one Bash command: `{ ok: true }` or `{ ok: false, reason }`.
 * `deps` stubs bd and the epic files in tests.
 */
export function decide({ command, cwd }, deps = {}) {
  const show = deps.showIssues ?? showIssues;
  const statusesOf = deps.readEpicStatuses ?? readEpicStatuses;
  if (typeof command !== 'string' || !mentionsBd(command)) return { ok: true };
  const reasons = [];
  // Every id a checkout's database is asked about, so each checkout costs one
  // bd show: a cold one takes seconds, and the hook has 30 in all.
  const checkouts = new Map();
  for (const args of bdCalls(command)) {
    const intent = closeIntent(args);
    if (!intent) continue;
    if (intent.refuse) {
      reasons.push(intent.refuse);
      continue;
    }
    const at = intent.globals.indexOf('-C');
    const dir = at === -1 ? cwd : resolve(cwd, intent.globals[at + 1]);
    const key = JSON.stringify([dir, intent.globals]);
    if (!checkouts.has(key))
      checkouts.set(key, { dir, globals: intent.globals, ids: new Set() });
    for (const id of intent.ids) checkouts.get(key).ids.add(id);
  }
  for (const { dir, globals, ids: idSet } of checkouts.values()) {
    const ids = [...idSet];
    let issues;
    try {
      issues = show(ids, globals, dir);
    } catch (err) {
      reasons.push(
        `could not check whether ${ids.join(', ')} is an epic (bd show failed: ${String(err.message ?? err).split('\n')[0]}). Retry once bd answers.`
      );
      continue;
    }
    for (const issue of issues) {
      if (issue.issue_type !== 'epic' || issue.status === 'closed') continue;
      const { path, statuses } = statusesOf(issue.id, dir);
      if (statuses.some((s) => DONE_STATUSES.includes(s))) continue;
      const found = statuses.filter(Boolean);
      reasons.push(
        found.length
          ? `${issue.id} is an epic, and ${path} says "${found[0]}". Run its retro first (codex-epic-retro sets retro-done), or mark it abandoned with a reason.`
          : `${issue.id} is an epic with no ${path}. Write one: status retro-done after its retro, or status abandoned with a reason (docs/epics/_template/epic.md).`
      );
    }
  }
  return reasons.length
    ? { ok: false, reason: reasons.join('\n') }
    : { ok: true };
}

/**
 * Why `.claude/settings.json` doesn't run this guard on every Bash call, or
 * null when it does.
 */
export function wiringProblem(settingsText) {
  let settings;
  try {
    settings = JSON.parse(settingsText);
  } catch (err) {
    return `${SETTINGS_FILE} is not JSON (${err.message}), so Claude Code ignores every setting in it`;
  }
  const entries = settings?.hooks?.PreToolUse;
  if (!Array.isArray(entries))
    return `${SETTINGS_FILE} has no hooks.PreToolUse list`;
  const wired = entries.some(
    (e) =>
      (e.matcher === 'Bash' || e.matcher === undefined || e.matcher === '*') &&
      (e.hooks ?? []).some(
        (h) =>
          h.type === 'command' &&
          !h.if &&
          !h.async &&
          h.onFailure === 'block' &&
          String(h.command).includes(HOOK_SCRIPT)
      )
  );
  return wired
    ? null
    : `${SETTINGS_FILE} hooks.PreToolUse has no unconditional "Bash" command hook running ${HOOK_SCRIPT} with "onFailure": "block" (without it, a timeout or a crash lets the command run)`;
}

async function main() {
  if (process.argv.includes('--check-wiring')) {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const file = join(root, SETTINGS_FILE);
    const problem = existsSync(file)
      ? wiringProblem(readFileSync(file, 'utf8'))
      : `${SETTINGS_FILE} is missing`;
    if (problem) {
      console.error(`✗ WF-BD-CLOSE: ${problem}.`);
      process.exit(1);
    }
    console.log(
      `✓ WF-BD-CLOSE: ${SETTINGS_FILE} runs the guard on every Bash call.`
    );
    return;
  }
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let call;
  try {
    call = JSON.parse(input);
  } catch {
    return; // Not a hook payload: nothing to judge.
  }
  if (call.tool_name && call.tool_name !== 'Bash') return;
  const command = call.tool_input?.command;
  const cwd = call.cwd && isAbsolute(call.cwd) ? call.cwd : process.cwd();
  const verdict = decide({ command, cwd });
  if (!verdict.ok) {
    process.stderr.write(
      `WF-BD-CLOSE refused this bd call:\n${verdict.reason}\n`
    );
    process.exit(2);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
