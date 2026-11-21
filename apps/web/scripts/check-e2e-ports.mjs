#!/usr/bin/env node
/**
 * The e2e origin gate (Codex-1yd58 WP-11).
 *
 * The e2e suite finds the web app through ONE helper,
 * `apps/web/e2e/helpers/origin.ts`: `E2E_BASE_URL` (`PLAYWRIGHT_BASE_URL`, or
 * the default), `E2E_ORIGIN`, `E2E_HOST`, `orgOrigin()` and `orgUrl()`.
 * Specs and helpers used to write the default dev port into URLs, Origin
 * headers and host fallbacks, so a run against any other port (the epic
 * worktree's dev server on :3000) broke them one by one, and each fix found
 * the next.
 *
 * This fails on the default port written anywhere under `e2e/` except
 * `helpers/origin.ts`, in code AND in comments: a comment says "the default
 * port". A number is the port only when it stands alone, so a longer number
 * or a UUID group (`-5173-`) is not one.
 *
 *   node apps/web/scripts/check-e2e-ports.mjs            # the real e2e/ tree
 *   node apps/web/scripts/check-e2e-ports.mjs --root DIR # another tree (tests)
 *
 * Exit 0: clean. Exit 1: a hardcoded port, or the wrong tree. Exit 2: usage.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const E2E_DIR = join(WEB_ROOT, 'e2e');

/** The one file allowed to name the default port, relative to `e2e/`. */
export const ORIGIN_FILE = 'helpers/origin.ts';

/** The default dev port the suite must not repeat. */
export const DEFAULT_PORT = '5173';

/** Fewer files than this under the real tree means it moved. */
const MIN_FILES = 50;

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

/** The port standing alone: not part of a longer number, word or UUID. */
const PORT = new RegExp(`(?<![\\w.$-])${DEFAULT_PORT}(?![\\w$-])`);

/** Every line of `source` that names the default port, 1-based. */
export function scanSource(source) {
  const hits = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (PORT.test(lines[i])) hits.push({ line: i + 1, text: lines[i].trim() });
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

/** The violations under `e2eDir`, and whether the tree is the right one. */
export function collectViolations({ e2eDir = E2E_DIR } = {}) {
  const violations = [];
  const files = walk(e2eDir);
  let originFound = false;
  let originNamesDefault = false;
  for (const file of files) {
    const rel = relative(e2eDir, file).split(sep).join('/');
    const hits = scanSource(readFileSync(file, 'utf8'));
    if (rel === ORIGIN_FILE) {
      originFound = true;
      originNamesDefault = hits.length > 0;
      continue;
    }
    for (const hit of hits) violations.push({ file: rel, ...hit });
  }
  return {
    violations,
    filesScanned: files.length,
    originFound,
    originNamesDefault,
  };
}

function parseArgs(argv) {
  let root = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' && argv[i + 1]) root = argv[++i];
    else if (a.startsWith('--root=')) root = a.slice('--root='.length);
    else return { error: `unknown argument: ${a}` };
  }
  return { root };
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
  const { violations, filesScanned, originFound, originNamesDefault } =
    collectViolations({ e2eDir });
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
  for (const v of violations)
    console.error(`e2e/${v.file}:${v.line}  ${v.text}`);
  if (violations.length > 0) {
    console.error(
      `\n${violations.length} hardcoded default port(s) under e2e/. ` +
        `Build URLs from e2e/${ORIGIN_FILE} (E2E_BASE_URL, E2E_ORIGIN, E2E_HOST, orgOrigin, orgUrl); ` +
        'in a comment, say "the default port". See the header of apps/web/scripts/check-e2e-ports.mjs.'
    );
    process.exit(1);
  }
  console.log(
    `OK: no hardcoded default port in ${filesScanned} e2e file(s) outside ${ORIGIN_FILE}.`
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
