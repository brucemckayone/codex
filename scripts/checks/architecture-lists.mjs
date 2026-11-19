/**
 * List extractors for the architecture gate's `lists-agree` rules (G0 WP-7,
 * Codex-xtcfl.7). Each pair answers one question the runtime can't: does the
 * list one file NEEDS match the list another file HAS?
 *
 * RATE-LIMIT-BINDING. `procedure()` enforces `policy.rateLimit` through a
 * wrangler binding. A preset a worker has no binding for FAILS OPEN: every
 * request passes, and `rate_limit.fail_open` is logged at error level on each
 * one (root CLAUDE.md, Security). Nothing caught that before deploy except
 * prose saying "add the binding in the same change". This pair makes it a
 * build failure: every preset a worker's routes use must have its binding in
 * EVERY environment of that worker's wrangler.jsonc, because wrangler does not
 * inherit `ratelimits` or Durable Object bindings into `env.*` blocks.
 *
 * What the rule can't read statically (a spread that could carry a policy, a
 * non-literal preset, an aliased or namespaced factory it can't follow, type
 * arguments) is a violation, never a guess. An exception can cover a
 * genuinely dynamic one.
 */

import { lineIndex, maskStrings } from './architecture-matchers.mjs';
import { tokenize } from './check-data-access-contract.mjs';

export const PRESETS_FILE = 'packages/constants/src/limits.ts';

/**
 * The `auth` preset runs on a Durable Object, not the native binding, so
 * limits.ts names no binding for it. This is the name the auth worker binds
 * it under (workers/auth/wrangler.jsonc).
 */
const DURABLE_OBJECT_BINDING = 'RATE_LIMIT_DO';

/** The preset `procedure()` applies when a route declares none. */
const DEFAULT_PRESET = 'api';

/**
 * preset name -> binding name, read from RATE_LIMIT_PRESETS in limits.ts, so
 * the mapping is derived rather than copied. Throws when nothing parses: a
 * fail-soft empty map would pass every worker while checking nothing.
 */
function readPresetBindings(source) {
  if (!source.has(PRESETS_FILE)) throw new Error(`${PRESETS_FILE} is missing`);
  const text = source.read(PRESETS_FILE);
  const start = text.indexOf('export const RATE_LIMIT_PRESETS = {');
  if (start === -1) {
    throw new Error(`RATE_LIMIT_PRESETS not found in ${PRESETS_FILE}`);
  }
  const { code } = tokenize(text.slice(start));
  const presets = new Map();
  for (const m of code.matchAll(/\n {2}([A-Z_]+): \{([\s\S]*?)\n {2}\},/g)) {
    const store = /store: '([\w-]+)'/.exec(m[2])?.[1];
    const binding =
      store === 'binding'
        ? /bindingName: '(\w+)'/.exec(m[2])?.[1]
        : store === 'durable-object'
          ? DURABLE_OBJECT_BINDING
          : undefined;
    if (binding) presets.set(m[1].toLowerCase(), binding);
  }
  if (presets.size === 0) {
    throw new Error(`no rate-limit presets parsed from ${PRESETS_FILE}`);
  }
  return presets;
}

/** wrangler.jsonc as data: comments blanked, trailing commas dropped. */
function parseJsonc(text) {
  const { code } = tokenize(text);
  return JSON.parse(code.replace(/,(\s*[}\]])/g, '$1'));
}

/** Each environment of a wrangler config: the top level, then every env.*. */
function environments(config) {
  return [
    ['top level', config],
    ...Object.entries(config.env ?? {}).map(([name, env]) => [
      `env.${name}`,
      env,
    ]),
  ];
}

/**
 * Every call that enforces a rate limit: the three route factories, which
 * apply `policy.rateLimit` (an omitted one means `api`), and the `rateLimit()`
 * middleware called directly, which enforces with the binding it is GIVEN. A
 * call through a namespace import (`import * as wu from '@codex/worker-utils'`,
 * then `wu.procedure(`) counts too.
 */
const ROUTE_FACTORIES = [
  'procedure',
  'multipartProcedure',
  'binaryUploadProcedure',
];
const LIMITERS = [...ROUTE_FACTORIES, 'rateLimit'];
const NAMES = LIMITERS.join('|');
const LIMITER_MODULE = /^@codex\/(?:worker-utils|security)(?:\/[\w/-]+)?$/;

/** A name as a RegExp source: a namespace may hold `$`. */
const escapeName = (name) => name.replace(/\$/g, '\\$');

/** `(?:wu\s*\.\s*)?` for the file's limiter namespaces, or '' when it has none. */
const receiverOf = (namespaces) =>
  namespaces.length
    ? `(?:(?:${namespaces.map(escapeName).join('|')})\\s*\\.\\s*)?`
    : '';

/**
 * Every way a file can reach a limiter that this rule can't follow to a call:
 * a stored reference to the factory or a namespace (`const p = procedure`,
 * `const p: typeof procedure = …`, `const { procedure: p } = wu`, `const m =
 * wu`), and the factory followed by `as` (a renamed import or re-export, `{
 * procedure as route }`, or a cast), a non-null assertion or call/apply/bind. A property READ is none of these:
 * `const limit = policy.rateLimit` and `options.rateLimit as string` name a
 * value, not the factory, because only a limiter namespace may come before it.
 */
const aliased = (namespaces) => {
  const receiver = receiverOf(namespaces);
  const forms = [
    `\\b(?:const|let|var)\\b[^;]*?=\\s*${receiver}(?:${NAMES})\\b(?!\\s*[(<])`,
    `(?<![\\w$.])${receiver}(?:${NAMES})\\s*(?:\\bas\\b|!(?!=)|\\.\\s*(?:call|apply|bind)\\b)`,
  ];
  if (namespaces.length) {
    forms.push(
      `\\b(?:const|let|var)\\b[^;]*?=\\s*(?:${namespaces.map(escapeName).join('|')})\\s*(?:[;,)]|$)`
    );
  }
  return new RegExp(forms.join('|'), 'm');
};

/** The index of the bracket that closes the one at `open`, in masked text. */
function closing(text, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return text.length - 1;
}

/**
 * The top-level entries of the object literal whose `{` is at `open`: a
 * spread, a shorthand (or method), or `key: value` with the value's span. The
 * structure is read from `masked` (no string can hold a bracket or comma), a
 * quoted key's NAME from `code`, at the same offsets.
 */
function objectEntries(code, masked, open) {
  const close = closing(masked, open);
  const entries = [];
  const push = (from, to) => {
    const raw = masked.slice(from, to);
    const text = raw.trim();
    if (!text) return;
    const at = from + raw.indexOf(text);
    if (text.startsWith('...')) {
      entries.push({ spread: true });
      return;
    }
    const source = code.slice(at, to);
    // A getter, setter, async or generator method computes its value: `get
    // policy() { return … }` must not read as a shorthand named `get`.
    const m = /^(?:get|set|async|static)\s+[\w$'"[]|^\*/.test(source)
      ? null
      : /^(?:([\w$]+)|(['"])([\w$-]+)\2)\s*(:)?/.exec(source);
    if (!m) {
      entries.push({ unreadable: true });
      return;
    }
    const key = m[1] ?? m[3];
    if (!m[4]) {
      entries.push({ key, shorthand: true });
      return;
    }
    const valueAt = at + m[0].length;
    const lead = masked.slice(valueAt, to);
    entries.push({
      key,
      start: valueAt + (lead.length - lead.trimStart().length),
      end: to,
    });
  };
  let depth = 0;
  let from = open + 1;
  for (let i = open + 1; i < close; i++) {
    const ch = masked[i];
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) {
      push(from, i);
      from = i + 1;
    }
  }
  push(from, close);
  return entries;
}

/** A string literal's value, if `text` starts with one and it has no interpolation. */
const literal = (text) =>
  /^(['"`])([\w-]+)\1/.exec(text.trimStart())?.[2] ?? null;

/** `c.env.X`, `env.X` or a bare `X`: the binding a value names, if it names one. */
const bindingName = (text) =>
  /^(?:[\w$]+\s*\.\s*)*env\s*\.\s*([A-Z][A-Z0-9_]*)\s*$/.exec(text)?.[1] ??
  /^([A-Z][A-Z0-9_]*)\s*$/.exec(text)?.[1] ??
  null;

/**
 * What a call resolves to: `{ preset }` (a route factory), `{ preset, binding }`
 * (a direct `rateLimit()`), `{ exempt: true }` (a worker-to-worker route), or
 * `{ unknown }` with the reason it can't be read. Only the options object's
 * top level, and the `policy` object's top level, are read: a key inside the
 * handler, or a spread that could carry a policy, never decides. What this
 * can't read is a violation, never a guess; an exception can cover a
 * genuinely dynamic one.
 */
function resolveLimit(callee, code, masked, open) {
  const first = masked.slice(open + 1).search(/\S/);
  const brace = open + 1 + first;
  if (first === -1 || masked[brace] !== '{') {
    return { unknown: `${callee}() options are not an object literal` };
  }
  const value = (entry) => code.slice(entry.start, entry.end).trim();
  const entries = objectEntries(code, masked, brace);
  if (entries.some((e) => e.spread || e.unreadable)) {
    return {
      unknown: `${callee}() options contain a spread or computed key, which can carry a rate limit`,
    };
  }
  const get = (list, key) => list.find((e) => e.key === key);
  if (callee === 'rateLimit') {
    const preset = get(entries, 'preset');
    const name = preset && !preset.shorthand ? literal(value(preset)) : null;
    if (!name) return { unknown: 'rateLimit() preset is not a literal' };
    const store = get(entries, 'binding') ?? get(entries, 'namespace');
    const binding =
      store && !store.shorthand ? bindingName(value(store)) : null;
    if (!binding) {
      return {
        unknown: 'rateLimit() names no binding or namespace the gate can read',
      };
    }
    return { preset: name, binding };
  }
  const policy = get(entries, 'policy');
  if (!policy) return { preset: DEFAULT_PRESET };
  if (policy.shorthand) {
    return { unknown: `${callee}() policy is a shorthand variable` };
  }
  if (masked[policy.start] !== '{') {
    return { unknown: `${callee}() policy is not an object literal` };
  }
  const rules = objectEntries(code, masked, policy.start);
  if (rules.some((e) => e.spread || e.unreadable)) {
    return { unknown: `${callee}() policy contains a spread or computed key` };
  }
  const auth = get(rules, 'auth');
  if (auth) {
    const text = auth.shorthand ? '' : value(auth);
    const kind = literal(text);
    // AUTH_ROLES (@codex/constants) has no worker role, so a route that names
    // one of its members is never the exempt worker-to-worker kind.
    if (!kind && !/^AUTH_ROLES\s*\.\s*[A-Z_]+$/.test(text)) {
      return { unknown: `${callee}() policy auth is not a literal` };
    }
    if (kind === 'worker') return { exempt: true };
  }
  const limit = get(rules, 'rateLimit');
  if (!limit) return { preset: DEFAULT_PRESET };
  const preset = limit.shorthand ? null : literal(value(limit));
  return preset
    ? { preset }
    : { unknown: `${callee}() rateLimit is not a literal` };
}

/** The names a file imports a limiter module under (`import * as wu`). */
function limiterNamespaces(code) {
  const namespaces = [];
  for (const m of code.matchAll(
    /\bimport\s*\*\s*as\s+([\w$]+)\s+from\s*(['"])([^'"]+)\2/g
  )) {
    if (LIMITER_MODULE.test(m[3])) namespaces.push(m[1]);
  }
  return namespaces;
}

/** Every rate-limiting call in comment-blanked code. */
function limiterCalls(masked, namespaces) {
  const receiver = receiverOf(namespaces);
  const call = new RegExp(`(?<![\\w$.])${receiver}(${NAMES})\\s*([(<])`, 'g');
  const calls = [];
  for (const m of masked.matchAll(call)) {
    calls.push({
      callee: m[1],
      index: m.index,
      typeArgs: m[2] === '<',
      open: m.index + m[0].length - 1,
    });
  }
  return calls;
}

const workerOf = (file) => file.split('/').slice(0, 2).join('/');

const wranglerFiles = (subjects) =>
  subjects.filter((f) => /^workers\/[^/]+\/wrangler\.jsonc$/.test(f));

const isRouteFile = (file) => /^workers\/[^/]+\/src\/.*\.ts$/.test(file);

export const rateLimitBindings = {
  need(source, subjects) {
    // Read only when a route needs it, so a tree with no routes needs no limits.ts.
    let presets;
    const envsOf = new Map();
    const needs = [];
    for (const file of wranglerFiles(subjects)) {
      const worker = workerOf(file);
      envsOf.set(
        worker,
        environments(parseJsonc(source.read(file))).map(([name]) => name)
      );
      // A worker whose routes moved out of src/ would otherwise check nothing.
      if (!subjects.some((f) => isRouteFile(f) && workerOf(f) === worker)) {
        needs.push({
          group: worker,
          item: `route files under ${worker}/src/`,
          file,
          line: 1,
          text: 'this worker has a wrangler.jsonc',
        });
      }
    }
    const seen = new Set();
    for (const file of subjects) {
      if (!isRouteFile(file)) continue;
      const text = source.read(file);
      const { code } = tokenize(text);
      const masked = maskStrings(code);
      const { lineOf } = lineIndex(text);
      const worker = workerOf(file);
      const add = (line, item, why) => {
        const seenKey = `${file}\0${item}`;
        if (seen.has(seenKey)) return;
        seen.add(seenKey);
        needs.push({ group: worker, item, file, line, text: why });
      };
      const unknown = (line, why) =>
        needs.push({
          group: worker,
          item: 'a rate limit the gate can read',
          file,
          line,
          text: why,
        });
      const namespaces = limiterNamespaces(code);
      const alias = aliased(namespaces).exec(masked);
      if (alias) {
        const shown = alias[0].replace(/\s+/g, ' ');
        unknown(
          lineOf(alias.index),
          `"${shown.length > 60 ? `…${shown.slice(-60)}` : shown}" hides its calls from this rule`
        );
      }
      for (const ns of namespaces) {
        const bracket = new RegExp(
          `(?<![\\w$.])${escapeName(ns)}\\s*(?:\\?\\.\\s*)?\\[`
        ).exec(masked);
        if (bracket) {
          unknown(
            lineOf(bracket.index),
            `${ns}[…] reads the limiter module by a computed name`
          );
        }
      }
      for (const call of limiterCalls(masked, namespaces)) {
        const line = lineOf(call.index);
        if (call.typeArgs) {
          unknown(
            line,
            `${call.callee}<…>() type arguments hide its options from this rule`
          );
          continue;
        }
        const limit = resolveLimit(call.callee, code, masked, call.open);
        if (limit.exempt) continue;
        if (limit.unknown) {
          unknown(line, limit.unknown);
          continue;
        }
        presets ??= readPresetBindings(source);
        const expected = presets.get(limit.preset);
        const binding =
          limit.binding ?? expected ?? `an unknown preset "${limit.preset}"`;
        const why = `${call.callee}() uses rateLimit '${limit.preset}'`;
        if (limit.binding && limit.binding !== expected) {
          add(
            line,
            `rateLimit() binding ${limit.binding} matching its preset '${limit.preset}' (${expected ?? 'unknown'})`,
            why
          );
        }
        for (const env of envsOf.get(worker) ?? ['(no wrangler.jsonc)']) {
          add(line, `${binding} in ${env}`, why);
        }
      }
    }
    return needs;
  },

  have(source, subjects) {
    const have = new Map();
    for (const file of wranglerFiles(subjects)) {
      const items = new Set();
      for (const [env, config] of environments(parseJsonc(source.read(file)))) {
        const names = [
          ...(config.ratelimits ?? []).map((r) => r.name),
          ...(config.durable_objects?.bindings ?? []).map((b) => b.name),
        ];
        for (const name of names) items.add(`${name} in ${env}`);
      }
      have.set(workerOf(file), { file, items });
    }
    return have;
  },
};

// ---------------------------------------------------------------------------
// CI-GATES: the registry's gate index and the static-analysis job agree
// ---------------------------------------------------------------------------
//
// gate.sh, the local mirror of CI, skipped five of CI's static gates, and PR
// #705 went red in CI four minutes after passing it locally (Codex-kxdz9). So
// the registry lists every gate the job runs, `--gates` runs them locally, and
// this pair fails when either side gains a step the other lacks.

/**
 * Each step of each `steps:` list in a workflow file, read as block mappings:
 * its `run:` command, and whether anything can switch it off (`if:`,
 * `continue-on-error:`). A step written in a form this reader doesn't parse
 * (a flow mapping, a quoted key, a block-scalar run) is reported as such, never
 * skipped, so a gate can't hide behind YAML syntax.
 */
function workflowSteps(text) {
  const steps = [];
  let inSteps = false;
  let itemIndent = null;
  let current = null;
  let job = null;
  const finish = () => {
    if (current) steps.push(current);
    current = null;
  };
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const jobHead = JOB_HEAD.exec(line);
    if (jobHead) {
      finish();
      inSteps = false;
      job = jobHead[2];
      return;
    }
    if (/^\s*(['"]?)steps\1\s*:\s*(?:#.*)?$/.test(line)) {
      finish();
      inSteps = true;
      itemIndent = null;
      return;
    }
    if (!inSteps || line.trim() === '' || line.trimStart().startsWith('#'))
      return;
    const indent = line.length - line.trimStart().length;
    const item = /^(\s*)-\s+(.*)$/.exec(line);
    if (item && (itemIndent === null || indent === itemIndent)) {
      finish();
      itemIndent = indent;
      current = {
        line: i + 1,
        job,
        run: null,
        conditional: null,
        unreadable: null,
      };
      readKey(current, item[2], i + 1);
      return;
    }
    if (itemIndent !== null && indent <= itemIndent) {
      // anything at or above the item indent that isn't an item ends the list
      finish();
      inSteps = false;
      return;
    }
    if (current && indent === itemIndent + 2)
      readKey(current, line.trim(), i + 1);
  });
  finish();
  // A job-level switch, or a workflow-wide `defaults:`, turns off every step.
  const jobKeys = jobs(text);
  const workflowDefaults = /^defaults\s*:/m.test(text);
  for (const step of steps) {
    const off = (jobKeys.get(step.job) ?? []).find((k) =>
      /^(?:if|continue-on-error|defaults)\s*:/.test(k)
    );
    if (off) step.conditional ??= `the job's ${off.split(':')[0].trim()}:`;
    if (workflowDefaults) step.conditional ??= 'the workflow defaults:';
  }
  return steps;
}

/**
 * A job's header line, `  name:`, quoted or not, with or without an anchor,
 * a tag or a comment (`  static: &base  # the gate`).
 */
export const JOB_HEAD =
  /^ {2}(['"]?)([\w-]+)\1\s*:\s*(?:[&!][^\s#]+\s*)*(?:#.*)?$/;

/** A YAML key with its quotes dropped, so `"if": x` reads as `if: x`. */
const unquoteKey = (text) => text.replace(/^(['"])([\w-]+)\1(\s*:)/, '$2$3');

/** Step keys that switch a step off, or change what its run: line does. */
const STEP_SWITCHES = ['if', 'continue-on-error', 'shell', 'working-directory'];

function readKey(step, text, line) {
  if (text.startsWith('{')) {
    step.unreadable = 'a flow-mapping step';
    return;
  }
  if (/^["']\w[\w-]*["']\s*:/.test(text)) {
    step.unreadable = 'a step with a quoted key';
    return;
  }
  const m = /^([\w-]+)\s*:\s*(.*?)\s*$/.exec(text);
  if (!m) return;
  if (STEP_SWITCHES.includes(m[1])) step.conditional ??= `${m[1]}:`;
  if (m[1] === 'run') {
    const command = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (/^[|>][-+]?$/.test(command)) step.unreadable = 'a multi-line run block';
    else {
      step.run = command;
      step.runLine = line;
    }
  }
}

/** The commands a registry gate runs in CI. */
export const gateCommands = (gate) => [gate.selfTest, gate.run].filter(Boolean);

/** `pnpm [--filter <pkg>] [run] <script>`: the package and script a command needs. */
export function pnpmScript(command) {
  const filtered = /^pnpm --filter (\S+) run (\S+)$/.exec(command);
  if (filtered) return { pkg: filtered[1], script: filtered[2] };
  const root = /^pnpm (?:run )?([\w:-]+)$/.exec(command);
  if (root && !['install', 'exec', 'dlx'].includes(root[1])) {
    return { pkg: '(root)', script: root[1] };
  }
  return null;
}

/** The job blocks of a workflow, by name, with their own (4-space) keys. */
function jobs(text) {
  const out = new Map();
  let name = null;
  let inJobs = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^(['"]?)jobs\1\s*:\s*(?:#.*)?$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    const job = JOB_HEAD.exec(line);
    if (job) {
      name = job[2];
      out.set(name, []);
    } else if (name && /^ {4}[^\s#]/.test(line)) {
      out.get(name).push(unquoteKey(line.trim()));
    } else if (/^[^\s#]/.test(line)) inJobs = false;
  }
  return out;
}

export function ciGateLists({
  workflow,
  callers,
  gates,
  setupSteps,
  registryFile,
}) {
  const registryLine = (source, command) => {
    const text = source.has(registryFile) ? source.read(registryFile) : '';
    const at = text.indexOf(command);
    return at === -1 ? 1 : lineIndex(text).lineOf(at);
  };
  const stepsIn = (source) =>
    source.has(workflow) ? workflowSteps(source.read(workflow)) : [];
  // A caller job that is conditional, or waits on another job, can be skipped,
  // and a skipped required job reports Success.
  const callerOk = (source, caller) => {
    if (!source.has(caller)) return false;
    for (const keys of jobs(source.read(caller)).values()) {
      const uses = keys.some((k) =>
        new RegExp(
          `^uses\\s*:\\s*(['"]?)\\./${workflow.replace(/[.]/g, '\\.')}\\1\\s*$`
        ).test(k)
      );
      if (uses && !keys.some((k) => /^(?:if|needs)\s*:/.test(k))) return true;
    }
    return false;
  };
  const onPullRequest = (source) =>
    callers.some((caller) => {
      if (!source.has(caller)) return false;
      const on = /^on\s*:(.*)\n((?:[ \t]+.*\n|\s*\n)*)/m.exec(
        source.read(caller).replace(/\r/g, '')
      );
      return Boolean(on && /\bpull_request\b(?!_)/.test(on[1] + on[2]));
    });
  const scriptsOf = (source) => {
    const scripts = new Set();
    for (const file of source.files) {
      if (
        !/^(?:package\.json|(?:apps|packages|workers)\/[^/]+\/package\.json)$/.test(
          file
        )
      )
        continue;
      try {
        const pkg = JSON.parse(source.read(file));
        const name = file === 'package.json' ? '(root)' : pkg.name;
        for (const script of Object.keys(pkg.scripts ?? {}))
          scripts.add(`${name} has script ${script}`);
      } catch {
        // an unparseable package.json simply provides no scripts
      }
    }
    return scripts;
  };
  return {
    need(source) {
      const needs = [];
      for (const gate of gates) {
        for (const command of gateCommands(gate)) {
          const line = registryLine(source, command);
          needs.push({
            group: 'workflow',
            item: command,
            file: registryFile,
            line,
            text: `gate ${gate.id} runs this`,
          });
          // `pnpm --filter x run <missing>` exits 0, so the script must exist.
          const target = pnpmScript(command);
          if (target) {
            needs.push({
              group: 'scripts',
              item: `${target.pkg} has script ${target.script}`,
              file: registryFile,
              line,
              text: `gate ${gate.id} runs a pnpm script`,
            });
          }
        }
      }
      for (const step of stepsIn(source)) {
        let item = null;
        if (step.unreadable)
          item = `(${step.unreadable}: write gate steps as block mappings with a plain run: line)`;
        else if (step.run && step.conditional)
          item = `${step.run} (switched off or changed by ${step.conditional})`;
        else if (step.run) item = step.run;
        if (item) {
          needs.push({
            group: 'registry',
            item,
            file: workflow,
            line: step.runLine ?? step.line,
            text: 'this CI step',
          });
        }
      }
      needs.push({
        group: 'callers',
        item: `a calling workflow runs ${workflow} on pull_request`,
        file: callers[0],
        line: 1,
        text: 'the static-analysis job must gate pull requests',
      });
      for (const caller of callers) {
        needs.push({
          group: 'callers',
          item: `${caller} runs ${workflow} from a job with no if: or needs:`,
          file: caller,
          line: 1,
          text: 'the static-analysis job must always run',
        });
      }
      return needs;
    },
    have(source) {
      const steps = stepsIn(source).filter(
        (s) => s.run && !s.conditional && !s.unreadable
      );
      return new Map([
        [
          'workflow',
          { file: workflow, items: new Set(steps.map((s) => s.run)) },
        ],
        [
          'registry',
          {
            file: `${registryFile} (GATES or CI_SETUP_STEPS)`,
            items: new Set([...gates.flatMap(gateCommands), ...setupSteps]),
          },
        ],
        [
          'callers',
          {
            file: 'the calling workflows',
            items: new Set([
              ...callers
                .filter((c) => callerOk(source, c))
                .map(
                  (c) =>
                    `${c} runs ${workflow} from a job with no if: or needs:`
                ),
              ...(onPullRequest(source)
                ? [`a calling workflow runs ${workflow} on pull_request`]
                : []),
            ]),
          },
        ],
        [
          'scripts',
          { file: 'the package.json scripts', items: scriptsOf(source) },
        ],
      ]);
    },
  };
}
