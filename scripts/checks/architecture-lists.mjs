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
 * The preset a `procedure()` call's policy resolves to: an explicit string,
 * the default when none is declared, or null when it is exempt (`auth:
 * 'worker'`) or not statically known (a function or a variable).
 */
function presetOf(callText) {
  if (/auth:\s*['"]worker['"]/.test(callText)) return null;
  const literal = /rateLimit:\s*['"]([a-z-]+)['"]/.exec(callText);
  if (literal) return literal[1];
  if (/rateLimit\s*:/.test(callText)) return null;
  return DEFAULT_PRESET;
}

/** Every `procedure(...)` call in comment-blanked code, with its full argument text. */
function procedureCalls(code) {
  const calls = [];
  for (const m of code.matchAll(/(?<![\w.$])procedure\(/g)) {
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (; end < code.length; end++) {
      if (code[end] === '(') depth += 1;
      else if (code[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push({ index: m.index, text: code.slice(m.index, end + 1) });
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
      for (const call of procedureCalls(code)) {
        const preset = presetOf(call.text);
        if (preset === null) continue;
        presets ??= readPresetBindings(source);
        const binding = presets.get(preset) ?? `an unknown preset "${preset}"`;
        for (const env of envsOf.get(worker) ?? ['(no wrangler.jsonc)']) {
          const item = `${binding} in ${env}`;
          const key = `${file}\0${item}`;
          if (seen.has(key)) continue;
          seen.add(key);
          needs.push({
            group: worker,
            item,
            file,
            line: lineOf(call.index),
            text: `procedure() uses rateLimit '${preset}'`,
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

/** Each `run:` step in a workflow file. A block scalar can't be matched. */
function workflowRuns(text) {
  const runs = [];
  text.split('\n').forEach((line, i) => {
    const m = /^\s*(?:-\s+)?run:\s*(.*?)\s*$/.exec(line);
    if (!m) return;
    let command = m[1].replace(/^(['"])(.*)\1$/, '$2');
    if (command === '|' || command === '>' || /^[|>][-+]?$/.test(command)) {
      command = '(a multi-line run block; keep gate steps on one line)';
    }
    runs.push({ command, line: i + 1 });
  });
  return runs;
}

/** The commands a registry gate runs in CI. */
export const gateCommands = (gate) =>
  [gate.selfTest, gate.run, ...(gate.prOnly ?? [])].filter(Boolean);

export function ciGateLists({ workflow, gates, setupSteps, registryFile }) {
  const registryLine = (source, command) => {
    const text = source.has(registryFile) ? source.read(registryFile) : '';
    const at = text.indexOf(command);
    return at === -1 ? 1 : lineIndex(text).lineOf(at);
  };
  const runsIn = (source) =>
    source.has(workflow) ? workflowRuns(source.read(workflow)) : [];
  return {
    need(source) {
      const needs = [];
      for (const gate of gates) {
        for (const command of gateCommands(gate)) {
          needs.push({
            group: 'workflow',
            item: command,
            file: registryFile,
            line: registryLine(source, command),
            text: `gate ${gate.id} runs this`,
          });
        }
      }
      for (const run of runsIn(source)) {
        needs.push({
          group: 'registry',
          item: run.command,
          file: workflow,
          line: run.line,
          text: 'this CI step',
        });
      }
      return needs;
    },
    have(source) {
      return new Map([
        [
          'workflow',
          {
            file: workflow,
            items: new Set(runsIn(source).map((r) => r.command)),
          },
        ],
        [
          'registry',
          {
            file: `${registryFile} (GATES or CI_SETUP_STEPS)`,
            items: new Set([...gates.flatMap(gateCommands), ...setupSteps]),
          },
        ],
      ]);
    },
  };
}
