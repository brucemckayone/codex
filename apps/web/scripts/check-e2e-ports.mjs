#!/usr/bin/env node
/**
 * The e2e origin gate.
 *
 * The e2e suite finds the web app through ONE helper,
 * `apps/web/e2e/helpers/origin.ts` (`E2E_BASE_URL`, `E2E_ORIGIN`, `E2E_HOST`,
 * `orgOrigin()`, `orgUrl()`), and each worker through `helpers/workers.ts`
 * (`workerUrl()`, on its `SERVICE_PORTS` port from `@codex/constants`).
 * Specs and helpers used to write the ports out. The default dev port sat in
 * URLs, Origin headers and host fallbacks, so a run against any other port
 * (the epic worktree's dev server on :3000) broke them one by one, and each
 * fix found the next. The workers' ports sat in some 30 URLs and probes, one
 * of them the wrong worker's (pricing-reactivate.spec.ts checked
 * organization-api on the notifications port).
 *
 * This fails on, anywhere under `e2e/`, in code AND in comments (a comment
 * says "the default port", or names the worker):
 *  - the default port, except in `helpers/origin.ts`;
 *  - any `SERVICE_PORTS` value, with no exemption: `helpers/workers.ts` reads
 *    them from the constant. The values are read from
 *    `packages/constants/src/urls.ts` as text, so a new or moved port is
 *    checked without editing this file, and no build is needed first.
 * A number is a port only when it stands alone, so a longer number or a UUID
 * group (`-4001-`) is not one.
 *
 *   node apps/web/scripts/check-e2e-ports.mjs          # the real trees
 *   node apps/web/scripts/check-e2e-ports.mjs --root DIR --constants FILE
 *
 * Exit 0: clean. Exit 1: a hardcoded port, or the wrong tree. Exit 2: usage.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const E2E_DIR = join(WEB_ROOT, 'e2e');

/** Where `SERVICE_PORTS` is defined (read as text). */
export const SERVICE_PORTS_FILE = join(
  WEB_ROOT,
  '..',
  '..',
  'packages',
  'constants',
  'src',
  'urls.ts'
);

/** The one file allowed to name the default port, relative to `e2e/`. */
export const ORIGIN_FILE = 'helpers/origin.ts';

/** The default dev port the suite must not repeat. */
export const DEFAULT_PORT = '5173';

/** Fewer files than this under the real tree means it moved. */
const MIN_FILES = 50;

/** Fewer `SERVICE_PORTS` names than this means the constant moved. */
const MIN_SERVICE_PORTS = 5;

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.html',
  '.svelte',
  '.txt',
]);

const SKIP_DIRS = new Set([
  'node_modules',
  'test-results',
  'playwright-report',
]);

/**
 * Block and line comments, in ONE left-to-right pass so whichever starts
 * first wins: urls.ts has a line comment naming `workers/*\/wrangler.jsonc`,
 * and a block pass first would open a comment there and swallow everything to
 * the next `*\/`. A `//` after a colon is a URL, not a comment.
 */
const COMMENT = /\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm;

/**
 * `SERVICE_PORTS` as a map from each port to every name that holds it
 * (`CONTENT` and `ACCESS` share one). Comments are dropped first, so a port
 * a comment mentions is not read as an entry; only the `SERVICE_PORTS` block
 * is read, so another constant's numbers are not either.
 */
export function parseServicePorts(source) {
  const code = source.replace(COMMENT, (_comment, lead) => lead ?? ' ');
  const block = /export\s+const\s+SERVICE_PORTS\s*=\s*\{([^}]*)\}/.exec(code);
  const byPort = new Map();
  if (!block) return byPort;
  for (const m of block[1].matchAll(/\b([A-Z][A-Z0-9_]*)\s*:\s*(\d+)\b/g)) {
    const names = byPort.get(m[2]) ?? [];
    names.push(m[1]);
    byPort.set(m[2], names);
  }
  return byPort;
}

/** Any of `ports` standing alone: not part of a longer number, word or UUID. */
function portPattern(ports) {
  const alternatives = [...new Set(ports)].sort((a, b) => b.length - a.length);
  return new RegExp(
    `(?<![\\w.$-])(?:${alternatives.join('|')})(?![\\w$-])`,
    'g'
  );
}

/**
 * Every line of `source` that names one of `ports`, 1-based, with the ports
 * it names (each once).
 */
export function scanSource(source, ports = [DEFAULT_PORT]) {
  const pattern = portPattern(ports);
  const hits = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const found = [
      ...new Set(Array.from(lines[i].matchAll(pattern), (m) => m[0])),
    ];
    if (found.length > 0) {
      hits.push({ line: i + 1, text: lines[i].trim(), ports: found });
    }
  }
  return hits;
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), files);
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name))) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

/**
 * The violations under `e2eDir` against the default port and every port in
 * `servicePorts` (from parseServicePorts), and whether the tree is the right
 * one. `helpers/origin.ts` is exempt from the default port only.
 */
export function collectViolations({ e2eDir = E2E_DIR, servicePorts }) {
  const ports = [DEFAULT_PORT, ...servicePorts.keys()];
  const violations = [];
  const files = walk(e2eDir);
  let originFound = false;
  let originNamesDefault = false;
  for (const file of files) {
    const rel = relative(e2eDir, file).split(sep).join('/');
    const hits = scanSource(readFileSync(file, 'utf8'), ports);
    const isOrigin = rel === ORIGIN_FILE;
    if (isOrigin) originFound = true;
    for (const hit of hits) {
      if (!isOrigin) {
        violations.push({ file: rel, ...hit });
        continue;
      }
      if (hit.ports.includes(DEFAULT_PORT)) originNamesDefault = true;
      const others = hit.ports.filter((p) => p !== DEFAULT_PORT);
      if (others.length > 0) {
        violations.push({ file: rel, ...hit, ports: others });
      }
    }
  }
  return {
    violations,
    filesScanned: files.length,
    originFound,
    originNamesDefault,
  };
}

/** What a port is, for the report: the default, or its SERVICE_PORTS names. */
function describePort(port, servicePorts) {
  if (port === DEFAULT_PORT) return 'the default port';
  return (servicePorts.get(port) ?? [])
    .map((name) => `SERVICE_PORTS.${name}`)
    .join(' / ');
}

function parseArgs(argv) {
  let root = null;
  let constants = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' && argv[i + 1]) root = argv[++i];
    else if (a.startsWith('--root=')) root = a.slice('--root='.length);
    else if (a === '--constants' && argv[i + 1]) constants = argv[++i];
    else if (a.startsWith('--constants='))
      constants = a.slice('--constants='.length);
    else return { error: `unknown argument: ${a}` };
  }
  return { root, constants };
}

/** SERVICE_PORTS from `file`, or why it is the wrong file. */
function readServicePorts(file) {
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    return { error: `no file at ${file}` };
  }
  const servicePorts = parseServicePorts(source);
  const names = [...servicePorts.values()].flat();
  if (names.length < MIN_SERVICE_PORTS || !names.includes('AUTH')) {
    return {
      error:
        `${file} no longer defines SERVICE_PORTS (${names.length} port name(s) read, ` +
        `AUTH ${names.includes('AUTH') ? 'among them' : 'not among them'})`,
    };
  }
  return { servicePorts };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`check-e2e-ports: ${args.error}`);
    process.exit(2);
  }
  const e2eDir = args.root ? resolve(args.root) : E2E_DIR;
  let isDir = false;
  try {
    isDir = statSync(e2eDir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    console.error(`check-e2e-ports: no e2e directory at ${e2eDir}.`);
    process.exit(1);
  }
  // A constants file that moved or lost the block would leave only the
  // default port checked, and an OK would hide every worker port.
  const constantsFile = args.constants
    ? resolve(args.constants)
    : SERVICE_PORTS_FILE;
  const { servicePorts, error } = readServicePorts(constantsFile);
  if (error) {
    console.error(
      `check-e2e-ports: ${error}. SERVICE_PORTS moved: point SERVICE_PORTS_FILE in apps/web/scripts/check-e2e-ports.mjs at it.`
    );
    process.exit(1);
  }
  const { violations, filesScanned, originFound, originNamesDefault } =
    collectViolations({ e2eDir, servicePorts });
  // No helper, a helper that no longer holds the default, or a real tree
  // that shrank: the wrong tree, and an OK would mean nothing was read.
  const tooFew = !args.root && filesScanned < MIN_FILES;
  if (!originFound || !originNamesDefault || tooFew) {
    const why = !originFound
      ? `no ${ORIGIN_FILE}`
      : !originNamesDefault
        ? `${ORIGIN_FILE} no longer names the default port`
        : `only ${filesScanned} file(s)`;
    console.error(
      `check-e2e-ports: ${why} under ${e2eDir}. ` +
        'The e2e origin moved: point ORIGIN_FILE / DEFAULT_PORT in apps/web/scripts/check-e2e-ports.mjs at it.'
    );
    process.exit(1);
  }
  for (const v of violations) {
    const what = v.ports.map((p) => describePort(p, servicePorts)).join(', ');
    console.error(`e2e/${v.file}:${v.line}  [${what}]  ${v.text}`);
  }
  if (violations.length > 0) {
    console.error(
      `\n${violations.length} hardcoded port(s) under e2e/. ` +
        `Build the app's URLs from e2e/${ORIGIN_FILE} (E2E_BASE_URL, E2E_ORIGIN, E2E_HOST, orgOrigin, orgUrl) ` +
        "and each worker's from e2e/helpers/workers.ts (workerUrl, SERVICE_PORTS); " +
        'in a comment, say "the default port" or name the worker. See the header of apps/web/scripts/check-e2e-ports.mjs.'
    );
    process.exit(1);
  }
  console.log(
    `OK: no hardcoded port in ${filesScanned} e2e file(s): the default port only in ${ORIGIN_FILE}, ` +
      `and none of ${servicePorts.size} SERVICE_PORTS value(s) anywhere.`
  );
}

/**
 * Whether this file is the process's entry. Compared as real paths: Node
 * resolves import.meta.url through symlinks but not argv[1], so a plain
 * comparison skips main() under a symlinked checkout and exits 0 unchecked.
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

if (isEntrypoint()) main();
