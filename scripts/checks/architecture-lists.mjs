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
 * Known limit: a `rateLimit` written as a function or a variable can't be
 * resolved statically and is skipped, not guessed.
 */

import { lineIndex } from './architecture-matchers.mjs';
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
 * middleware called directly with a `preset`.
 */
const ROUTE_FACTORIES = [
  'procedure',
  'multipartProcedure',
  'binaryUploadProcedure',
];
const LIMITERS = [...ROUTE_FACTORIES, 'rateLimit'];
const CALL = new RegExp(`(?<![\\w.$])(${LIMITERS.join('|')})\\(`, 'g');
const ALIASED = new RegExp(`\\b(?:${LIMITERS.join('|')})\\s+as\\s+\\w+`);

/** The index of the bracket that closes the one at `open`. */
function closing(code, open) {
  const pair = { '(': ')', '{': '}' };
  const close = pair[code[open]];
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === code[open]) depth += 1;
    else if (code[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return code.length - 1;
}

/** A string literal's value, if `text` starts with one and it has no interpolation. */
const literal = (text) =>
  /^(['"`])([a-z-]+)\1/.exec(text.trimStart())?.[2] ?? null;

/**
 * What a call resolves to: `{ preset }`, `{ exempt: true }` (a worker-to-worker
 * route), or `{ unknown }` with the reason it can't be read. Only the call's
 * `policy` object is read, never its handler, so an `auth: 'worker'` inside a
 * handler can't exempt the route. A policy or preset the code can't read
 * statically is a violation, not a guess: an exception can cover a genuinely
 * dynamic one.
 */
function resolveLimit(callee, args) {
  if (callee === 'rateLimit') {
    const at = /\bpreset\s*:/.exec(args);
    if (!at) return { unknown: 'rateLimit() names no preset' };
    const preset = literal(args.slice(at.index + at[0].length));
    return preset
      ? { preset }
      : { unknown: 'rateLimit() preset is not a literal' };
  }
  const key = /[{,]\s*policy\s*(?=[:,}])/.exec(args);
  if (!key) return { preset: DEFAULT_PRESET };
  let rest = args.slice(key.index + key[0].length);
  if (!rest.startsWith(':'))
    return { unknown: `${callee}() policy is a shorthand variable` };
  rest = rest.slice(1).trimStart();
  if (!rest.startsWith('{'))
    return { unknown: `${callee}() policy is not an object literal` };
  const policy = rest.slice(0, closing(rest, 0) + 1);
  if (/\bauth\s*:\s*['"`]worker['"`]/.test(policy)) return { exempt: true };
  const limit = /\brateLimit\s*:/.exec(policy);
  if (!limit) return { preset: DEFAULT_PRESET };
  const preset = literal(policy.slice(limit.index + limit[0].length));
  return preset
    ? { preset }
    : { unknown: `${callee}() rateLimit is not a literal` };
}

/** Every rate-limiting call in comment-blanked code, with its argument text. */
function limiterCalls(code) {
  const calls = [];
  for (const m of code.matchAll(CALL)) {
    const open = m.index + m[0].length - 1;
    calls.push({
      callee: m[1],
      index: m.index,
      args: code.slice(open, closing(code, open) + 1),
    });
  }
  return calls;
}

const workerOf = (file) => file.split('/').slice(0, 2).join('/');

const wranglerFiles = (subjects) =>
  subjects.filter((f) => /^workers\/[^/]+\/wrangler\.jsonc$/.test(f));

export const rateLimitBindings = {
  need(source, subjects) {
    // Read only when a route needs it, so a tree with no routes needs no limits.ts.
    let presets;
    const envsOf = new Map();
    for (const file of wranglerFiles(subjects)) {
      envsOf.set(
        workerOf(file),
        environments(parseJsonc(source.read(file))).map(([name]) => name)
      );
    }
    const needs = [];
    const seen = new Set();
    for (const file of subjects) {
      if (!/^workers\/[^/]+\/src\/.*\.ts$/.test(file)) continue;
      const text = source.read(file);
      const { code } = tokenize(text);
      const { lineOf } = lineIndex(text);
      const worker = workerOf(file);
      const unknown = (line, why) => {
        needs.push({
          group: worker,
          item: 'a rate limit the gate can read',
          file,
          line,
          text: why,
        });
      };
      const alias = ALIASED.exec(code);
      if (alias)
        unknown(
          lineOf(alias.index),
          `"${alias[0]}" hides its calls from this rule`
        );
      for (const call of limiterCalls(code)) {
        const limit = resolveLimit(call.callee, call.args);
        if (limit.exempt) continue;
        const line = lineOf(call.index);
        if (limit.unknown) {
          unknown(line, limit.unknown);
          continue;
        }
        presets ??= readPresetBindings(source);
        const binding =
          presets.get(limit.preset) ?? `an unknown preset "${limit.preset}"`;
        for (const env of envsOf.get(worker) ?? ['(no wrangler.jsonc)']) {
          const item = `${binding} in ${env}`;
          const seenKey = `${file}\0${item}`;
          if (seen.has(seenKey)) continue;
          seen.add(seenKey);
          needs.push({
            group: worker,
            item,
            file,
            line,
            text: `${call.callee}() uses rateLimit '${limit.preset}'`,
          });
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
  const finish = () => {
    if (current) steps.push(current);
    current = null;
  };
  text.split('\n').forEach((line, i) => {
    if (/^\s*steps:\s*$/.test(line)) {
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
        run: null,
        conditional: false,
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
  return steps;
}

function readKey(step, text, line) {
  if (text.startsWith('{')) {
    step.unreadable = 'a flow-mapping step';
    return;
  }
  if (/^["']\w[\w-]*["']\s*:/.test(text)) {
    step.unreadable = 'a step with a quoted key';
    return;
  }
  const m = /^([\w-]+):\s*(.*?)\s*$/.exec(text);
  if (!m) return;
  if (m[1] === 'if' || m[1] === 'continue-on-error') step.conditional = true;
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
function pnpmScript(command) {
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
  for (const line of text.split('\n')) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    const job = /^ {2}([\w-]+):\s*$/.exec(line);
    if (job) {
      name = job[1];
      out.set(name, []);
    } else if (name && /^ {4}\S/.test(line)) out.get(name).push(line.trim());
    else if (/^\S/.test(line)) inJobs = false;
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
  const callerOk = (source, caller) => {
    if (!source.has(caller)) return false;
    for (const keys of jobs(source.read(caller)).values()) {
      if (
        keys.includes(`uses: ./${workflow}`) &&
        !keys.some((k) => /^if:/.test(k))
      ) {
        return true;
      }
    }
    return false;
  };
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
          item = `${step.run} (switched off by if: or continue-on-error)`;
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
      for (const caller of callers) {
        needs.push({
          group: 'callers',
          item: `${caller} runs ${workflow} from a job with no if:`,
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
            items: new Set(
              callers
                .filter((c) => callerOk(source, c))
                .map((c) => `${c} runs ${workflow} from a job with no if:`)
            ),
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
