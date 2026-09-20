#!/usr/bin/env node
/**
 * Public-bundle editor import boundary guardrail.
 *
 * Origin: WP-0.2, Codex-cijzb (brand editor). Generalized to also scan the
 * public `$lib` entry modules and to cover the page-builder editor: WP CE-4,
 * Codex-2pryk.1.4 (see docs/design/course-journeys/HARDENING.md §B18).
 *
 * The heavy admin-only editor UIs must NEVER be pulled into the public
 * (customer-facing) Vite chunk. A STATIC `import ... from` of one inside a file
 * that ships in the public bundle bundles that whole editor into the page and
 * ships unused editor code to every visitor. This script fails CI if that
 * happens.
 *
 * Banned editor UIs (BANNED_MODULES) — never statically importable by
 * public-bundle code:
 *   - `$lib/components/brand-editor/**` — the brand-editor panel/pickers.
 *   - `$lib/components/page-builder/**` — the page-builder / journeys editor.
 *     (Both trees now EXIST — 25 and 37 files respectively as of 2026-09-16 —
 *     so this is a live rule, not one armed ahead of a build. Calibrated:
 *     injecting `import … from '$lib/components/page-builder'` into
 *     src/lib/page-builder/render/types.ts is caught and exits 1.)
 *
 * WHAT COUNTS AS "PUBLIC-BUNDLE CODE" — and why lib is scanned narrowly.
 * A ROUTE file's bundle is knowable from its path: anything under a `studio`
 * segment is the admin-only `ssr = false` SPA (its own chunk), everything else
 * is public. So all of `src/routes` (minus `studio`) is scanned.
 * A LIB file has NO such marker — whether it lands in the public or the studio
 * chunk depends entirely on which route imports it. `$lib/components/brand-editor`
 * itself, `$lib/components/brand-studio` (the studio editor host) and the
 * agreements dialogs are reached ONLY from `studio` routes, so their editor
 * imports are legitimate studio-chunk composition, NOT public leaks — scanning
 * all of `src/lib` would false-flag them. The only lib modules KNOWN to be
 * public-bundle entry points are scanned (PUBLIC_LIB_ROOTS):
 *   - `$lib/page-builder/**` — the public journeys/page renderer. This is the
 *     exact blind spot HARDENING §B18 flagged: the routes-only scan never saw a
 *     lib renderer statically importing `$lib/components/page-builder`, so the
 *     editor could ship to the public and the gate stayed green.
 *   - `$lib/brand-editor/**` — the store + css-injection helpers the public org
 *     layout imports. This is where "the brand-editor rule now applies within
 *     lib" lands: the public store must not pull in `$lib/components/brand-editor`.
 * Both public-lib roots are OPTIONAL — scanned only when present — which dates
 * from `$lib/page-builder` not existing. It exists now (65 files) and IS
 * scanned; the optionality is kept only so a fresh checkout mid-refactor does
 * not hard-fail. `src/routes` is REQUIRED (a missing required root is a
 * misconfiguration → hard error, never a silent empty scan).
 *
 * Allowed (NOT flagged):
 *   - `$lib/brand-editor` (no `/components/`) — see above. NB the name collision
 *     with the banned `$lib/components/brand-editor`: the ban matches only the
 *     `/components/` path, and `$lib/brand-editor` is scanned as a public root,
 *     never confused with the editor UI.
 *   - `import('$lib/components/<editor>/...')` (dynamic, parens) — a lazy,
 *     separate chunk, not a static bundle-time dependency.
 *   - Studio route files (any path with a `studio` segment) — excluded entirely.
 *
 * Banned (flagged, exit 1):
 *   - `import ... from '$lib/components/{brand-editor,page-builder}/...'`
 *     (static, single or double quotes) inside a scanned public-bundle file.
 *
 * Grep-style, not AST-based — matches the rest of this repo's script-based
 * gates (e.g. scripts/denoise/find-consumers.ts). It will still miss an import
 * disguised inside a string or template literal.
 *
 * TWO HOLES THAT USED TO BE HERE ARE NOW CLOSED (Codex-1x6lu), because both
 * were reachable by ordinary tooling rather than by deliberate evasion:
 *
 *   - A RELATIVE specifier (`../components/page-builder/Editor.svelte`). This
 *     was the dangerous one: an IDE auto-import writes relative paths by
 *     default, so the most likely way to introduce the violation was the one
 *     spelling the gate could not see. Relative specifiers are now RESOLVED
 *     against the importing file and checked for containment in the banned
 *     directories (BANNED_DIRS), so depth and `./` vs `../` do not matter.
 *   - `export … from '<editor>'`. A re-export is a static dependency too: it
 *     bundles the editor exactly as an import does.
 *
 * The re-export matcher requires the `from` clause, so `export const x = '…'`
 * is not mistaken for a dependency — the load-bearing near-miss, asserted in
 * the suite.
 *
 * Exported (`collectViolations`) so the accompanying node:test suite can point
 * the same scan at fixture roots; `main()` runs only as the CLI entrypoint.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

const ROUTE_FILE_EXTENSIONS = new Set(['.svelte', '.ts', '.js']);

// Editor UIs that must never be STATICALLY imported by public-bundle code.
const BANNED_MODULES = ['$lib/components/brand-editor', '$lib/components/page-builder'];

// The same two editor UIs as absolute DIRECTORIES, used to judge a RELATIVE
// specifier after resolving it against the importing file. Path-based rather
// than string-based so `../components/page-builder/x`,
// `../../components/page-builder`, and any other depth all land the same way.
const BANNED_DIRS = [
  fileURLToPath(new URL('../src/lib/components/brand-editor', import.meta.url)),
  fileURLToPath(new URL('../src/lib/components/page-builder', import.meta.url)),
];

// Dir *names* skipped everywhere: `studio` is the admin-only ssr=false SPA that
// ships in its own bundle (never the public one); `node_modules` is deps.
const EXCLUDED_DIR_NAMES = new Set(['studio', 'node_modules']);

// Public route surface — REQUIRED (a missing one is a misconfiguration).
const REQUIRED_ROOTS = [fileURLToPath(new URL('../src/routes', import.meta.url))];

// Public `$lib` entry modules — OPTIONAL (scanned only when present; the
// page-builder renderer is armed ahead of the Journeys build). See header.
const PUBLIC_LIB_ROOTS = [
  fileURLToPath(new URL('../src/lib/page-builder', import.meta.url)),
  fileURLToPath(new URL('../src/lib/brand-editor', import.meta.url)),
];

// Static `import <specifier> from '<module>'` OR side-effect `import '<module>'`
// (any quote style, matched pair via the \1 backreference). Requires whitespace
// directly after `import`, so dynamic `import('...')` calls and `typeof
// import('...')` type queries — which have no whitespace before the paren —
// never match; those are lazy-chunk loads, not static bundle-time imports.
const STATIC_IMPORT_RE = /import\s+(?:[^'";]*?\s+from\s+)?(['"])([^'"]+)\1/g;

// Static `export <clause> from '<module>'` (incl. `export * from`, and the
// multi-line `export {\n X \n} from '…'` form — the character class admits
// newlines but stops at a quote or semicolon, so a clause cannot run past the
// end of its own statement). The `from` clause is mandatory because that is
// the actual grammar of a re-export; note it is NOT what prevents
// `export const x = 'some string'` from matching — that is already excluded by
// requiring the specifier's quote to follow `export` directly. Mutation-tested:
// relaxing `from` to optional changes no verdict on valid JS.
const STATIC_REEXPORT_RE = /export\s+[^'";]*?\s+from\s+(['"])([^'"]+)\1/g;

function isBannedModule(modulePath, bannedModules) {
  return bannedModules.some(
    (banned) => modulePath === banned || modulePath.startsWith(`${banned}/`)
  );
}

/** Is `candidate` the directory `dir` itself, or anything beneath it? */
function isInside(dir, candidate) {
  if (candidate === dir) return true;
  const rel = relative(dir, candidate);
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/');
}

/**
 * A relative specifier is judged by WHERE IT RESOLVES TO, not how it is spelt.
 * `../components/page-builder/Editor.svelte` from inside
 * `src/lib/page-builder/render/` resolves into the banned editor directory and
 * is a leak; `./sections` resolves to a sibling and is not.
 */
function isBannedRelative(importerFile, modulePath, bannedDirs) {
  if (!modulePath.startsWith('.')) return false;
  const resolved = resolve(dirname(importerFile), modulePath);
  return bannedDirs.some((dir) => isInside(dir, resolved));
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    const dot = entry.name.lastIndexOf('.');
    const ext = dot === -1 ? '' : entry.name.slice(dot);
    if (ROUTE_FILE_EXTENSIONS.has(ext)) files.push(fullPath);
  }
  return files;
}

function findViolations(filePath, bannedModules, bannedDirs) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations = [];

  const matches = [
    ...content.matchAll(STATIC_IMPORT_RE),
    ...content.matchAll(STATIC_REEXPORT_RE),
  ].sort((a, b) => a.index - b.index);

  for (const match of matches) {
    const modulePath = match[2];
    const banned =
      isBannedModule(modulePath, bannedModules) ||
      isBannedRelative(filePath, modulePath, bannedDirs);
    if (!banned) continue;

    const line = content.slice(0, match.index).split('\n').length;
    const lineText = lines[line - 1]?.trim() ?? '';
    // Skip obvious comment lines (`// ...` or JSDoc `* ...`). This is a
    // grep-style scan, not an AST walk, so it can't fully distinguish code
    // from comments — this covers the common "documented example" case.
    if (lineText.startsWith('//') || lineText.startsWith('*')) continue;

    violations.push({ line, text: match[0].replace(/\s+/g, ' ').trim() });
  }

  return violations;
}

/**
 * Core scan. Pure with respect to the filesystem it's pointed at — the CLI
 * supplies the real roots; the test suite supplies fixture roots. File paths in
 * the returned violations are relative to `cwd`. A missing REQUIRED root throws
 * (fail loud); a missing OPTIONAL root is skipped (e.g. page-builder pre-build).
 *
 * @returns {{ violations: {file:string,line:number,text:string}[], filesScanned: number }}
 */
export function collectViolations({
  requiredRoots = REQUIRED_ROOTS,
  optionalRoots = PUBLIC_LIB_ROOTS,
  bannedModules = BANNED_MODULES,
  bannedDirs = BANNED_DIRS,
  cwd = WEB_ROOT,
} = {}) {
  const violations = [];
  let filesScanned = 0;

  const scan = (root) => {
    for (const file of walk(root)) {
      filesScanned += 1;
      for (const violation of findViolations(file, bannedModules, bannedDirs)) {
        violations.push({ file: relative(cwd, file), ...violation });
      }
    }
  };

  for (const root of requiredRoots) {
    if (!existsSync(root)) {
      throw new Error(`Import boundary gate: required scan root does not exist: ${root}`);
    }
    scan(root);
  }
  for (const root of optionalRoots) {
    if (existsSync(root)) scan(root);
  }

  return { violations, filesScanned };
}

function main() {
  const { violations, filesScanned } = collectViolations();

  // Fail closed if the scan found nothing to look at: a broken required-root
  // path would otherwise pass silently (green with 0 files) — the exact class
  // of blind spot that let the routes-only scan miss lib leaks (HARDENING §B18).
  if (filesScanned === 0) {
    console.error('Import boundary gate scanned 0 files — scan roots are misconfigured. Failing closed.');
    process.exit(1);
  }

  if (violations.length > 0) {
    console.error('Public-bundle editor import boundary violation(s):\n');
    for (const v of violations) {
      console.error(`${v.file}:${v.line}: ${v.text}`);
    }
    console.error(
      `\n${violations.length} violation(s). Public route/lib files may not statically import an ` +
        `editor UI (${BANNED_MODULES.join(', ')}) — it bundles the heavy editor into the public ` +
        `chunk. Use a dynamic import('<module>/...') instead, or import '$lib/brand-editor' (no ` +
        `/components/) if you only need the store/css-injection helpers.`
    );
    process.exit(1);
  }

  console.log(
    `OK: no static editor imports (${BANNED_MODULES.join(', ')}) in ${filesScanned} public route/lib file(s).`
  );
}

// Run only as the CLI entrypoint — never when imported (e.g. by the test suite).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
