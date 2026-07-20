#!/usr/bin/env node
/**
 * Brand-editor import boundary guardrail (WP-0.2, Codex-cijzb).
 *
 * `$lib/components/brand-editor/**` is the heavy brand-editor UI (panel,
 * header, color pickers, font picker, etc). A STATIC `import ... from` of
 * any of it inside a customer-facing (public) route file bundles the editor
 * into that page's Vite chunk and ships unused editor code to every
 * visitor. This script fails CI if that ever happens.
 *
 * Allowed (NOT flagged):
 *   - `$lib/brand-editor` (no `/components/`) — the store + css-injection
 *     helpers the public org layout legitimately imports to apply branding.
 *   - `import('$lib/components/brand-editor/...')` (dynamic, parens) — a
 *     lazy, separate chunk. See `src/routes/_org/[slug]/+layout.svelte`
 *     (BrandEditorMount) for the reference pattern.
 *   - Studio route files (any path with a `studio` segment) — studio is an
 *     admin-only `ssr = false` SPA that ships in its own bundle, never in
 *     the public one. Excluded from the scan entirely.
 *
 * Banned (flagged, exit 1):
 *   - `import ... from '$lib/components/brand-editor/...'` (static, single
 *     or double quotes) anywhere else under `src/routes`.
 *
 * Grep-style, not AST-based — matches the rest of this repo's script-based
 * gates (e.g. scripts/denoise/find-consumers.ts). It will miss an import
 * disguised inside a string/template literal, and it only flags `import`,
 * not `export ... from`. No public route currently needs either form, so
 * this is a deliberate scope limit, not an oversight.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTES_ROOT = fileURLToPath(new URL('../src/routes', import.meta.url));
const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

const ROUTE_FILE_EXTENSIONS = new Set(['.svelte', '.ts', '.js']);
const EXCLUDED_DIR_NAMES = new Set(['studio', 'node_modules']);
const BANNED_MODULE = '$lib/components/brand-editor';

// Static `import <specifier> from '<module>'` OR side-effect `import '<module>'`
// (any quote style, matched pair via the \1 backreference). Requires whitespace
// directly after `import`, so dynamic `import('...')` calls and `typeof
// import('...')` type queries — which have no whitespace before the paren —
// never match; those are lazy-chunk loads, not static bundle-time imports.
const STATIC_IMPORT_RE = /import\s+(?:[^'";]*?\s+from\s+)?(['"])([^'"]+)\1/g;

function isBannedModule(modulePath) {
  return modulePath === BANNED_MODULE || modulePath.startsWith(`${BANNED_MODULE}/`);
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

function findViolations(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations = [];

  for (const match of content.matchAll(STATIC_IMPORT_RE)) {
    const modulePath = match[2];
    if (!isBannedModule(modulePath)) continue;

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

function main() {
  const files = walk(ROUTES_ROOT);
  const violations = [];

  for (const file of files) {
    for (const violation of findViolations(file)) {
      violations.push({ file: relative(WEB_ROOT, file), ...violation });
    }
  }

  if (violations.length > 0) {
    console.error('Brand-editor import boundary violation(s):\n');
    for (const v of violations) {
      console.error(`${v.file}:${v.line}: ${v.text}`);
    }
    console.error(
      `\n${violations.length} violation(s). Public route files may not statically import from ` +
        `'${BANNED_MODULE}/...' — it bundles the heavy editor UI into the public chunk. Use a ` +
        `dynamic import('${BANNED_MODULE}/...') instead (see ` +
        `src/routes/_org/[slug]/+layout.svelte), or import '$lib/brand-editor' (no /components/) ` +
        `if you only need the store/css-injection helpers.`
    );
    process.exit(1);
  }

  console.log(`OK: no static '${BANNED_MODULE}/...' imports in ${files.length} public route file(s).`);
}

main();
