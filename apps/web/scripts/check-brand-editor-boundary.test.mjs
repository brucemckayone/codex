/**
 * Tests for the public-bundle editor import boundary gate (WP CE-4,
 * Codex-2pryk.1.4).
 *
 * Run with node's built-in test runner (`node --test`) rather than vitest: the
 * thing under test is a plain `.mjs` node CLI, so node:test keeps it zero-dep
 * and outside the app's jsdom/vite transform (and sidesteps typing an untyped
 * `.mjs` import from a `.ts` test). Wired via `pnpm --filter web run
 * check:brand-boundary:test` and a CI self-test step in static_analysis.yml.
 *
 * Each case builds a throwaway fixture tree that mirrors the real layout and
 * points `collectViolations` at it: `routes/` is the required root; the public
 * lib entry modules `lib/page-builder` + `lib/brand-editor` are the optional
 * roots. The real repo tree is never touched.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { collectViolations } from './check-brand-editor-boundary.mjs';

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'boundary-gate-'));
  // The required `routes` root always exists in the real tree; create it so a
  // case that only writes lib fixtures still presents it to the scan.
  mkdirSync(join(root, 'routes'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Write `content` to `<root>/<relPath>`, creating parent dirs. */
function writeFixture(relPath, content) {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** Scan the fixture the way the CLI scans the real tree. */
function scanFixture() {
  return collectViolations({
    requiredRoots: [join(root, 'routes')],
    optionalRoots: [join(root, 'lib/page-builder'), join(root, 'lib/brand-editor')],
    // The banned DIRECTORIES must be fixture-relative, or a relative specifier
    // would resolve into the temp tree and be compared against the real repo's
    // editor paths — i.e. the relative-crossing cases would pass vacuously.
    bannedDirs: [
      join(root, 'lib/components/brand-editor'),
      join(root, 'lib/components/page-builder'),
    ],
    cwd: root,
  });
}

// --- The core new requirement (HARDENING §B18) ---------------------------

test('CATCHES a page-builder editor leak from the public lib renderer', () => {
  writeFixture(
    'lib/page-builder/render.ts',
    "import Editor from '$lib/components/page-builder/Editor.svelte';\nexport const x = Editor;\n"
  );

  const { violations } = scanFixture();
  assert.equal(violations.length, 1);
  assert.match(violations[0].file, /lib\/page-builder\/render\.ts$/);
  assert.match(violations[0].text, /\$lib\/components\/page-builder\/Editor\.svelte/);
});

test('CATCHES a brand-editor leak from the public brand store (rule applies within lib)', () => {
  writeFixture(
    'lib/brand-editor/leak.ts',
    "import { Panel } from '$lib/components/brand-editor';\nexport const p = Panel;\n"
  );

  const { violations } = scanFixture();
  assert.equal(violations.length, 1);
  assert.match(violations[0].text, /\$lib\/components\/brand-editor/);
});

// --- Clean lib passes -----------------------------------------------------

test('PASSES clean lib: public renderer using only the allowed store + relative imports', () => {
  writeFixture(
    'lib/page-builder/render.ts',
    [
      "import { brandEditor } from '$lib/brand-editor';", // allowed: store, no /components/
      "import { section } from './sections';", // relative, fine
      'export const r = { brandEditor, section };',
    ].join('\n')
  );
  writeFixture('lib/page-builder/sections.ts', 'export const section = 1;\n');

  const { violations, filesScanned } = scanFixture();
  assert.equal(violations.length, 0);
  assert.ok(filesScanned > 0, 'sanity: the scan must actually visit files');
});

// --- Scope: legitimate studio-side lib composition is NOT flagged ---------

test('does NOT flag studio-only lib composition of the editor (not a public root)', () => {
  // brand-studio composes the brand-editor levels and is imported only by the
  // studio/brand route → studio chunk, not public. It lives in src/lib but is
  // NOT a scanned public root, so its editor imports must not be flagged.
  writeFixture(
    'lib/components/brand-studio/BrandStudioRail.svelte',
    "<script>import Colors from '$lib/components/brand-editor/levels/Colors.svelte';</script>\n"
  );

  const { violations } = scanFixture();
  assert.equal(violations.length, 0);
});

// --- Preserved behavior ---------------------------------------------------

test('does NOT flag a dynamic import() of the editor (lazy separate chunk)', () => {
  writeFixture(
    'lib/page-builder/lazy.ts',
    "export const load = () => import('$lib/components/page-builder/Editor.svelte');\n"
  );

  const { violations } = scanFixture();
  assert.equal(violations.length, 0);
});

test('does NOT flag the allowed $lib/brand-editor store import (name collision with banned UI)', () => {
  writeFixture(
    'lib/page-builder/render.ts',
    "import { brandEditor } from '$lib/brand-editor';\nexport const b = brandEditor;\n"
  );

  const { violations } = scanFixture();
  assert.equal(violations.length, 0);
});

test('preserves route behavior: flags a public route, spares a studio route', () => {
  writeFixture(
    'routes/_org/[slug]/+layout.svelte',
    "<script>import { Panel } from '$lib/components/brand-editor';</script>\n"
  );
  writeFixture(
    'routes/_org/[slug]/studio/brand/+page.svelte',
    "<script>import { Panel } from '$lib/components/brand-editor';</script>\n"
  );

  const { violations } = scanFixture();
  assert.equal(violations.length, 1, 'only the public route leak is flagged');
  assert.match(violations[0].file, /\+layout\.svelte$/);
  assert.doesNotMatch(violations[0].file, /studio/);
});

test('skips commented-out example imports', () => {
  writeFixture(
    'lib/page-builder/notes.ts',
    "// import Editor from '$lib/components/page-builder/Editor.svelte';\nexport const n = 1;\n"
  );

  const { violations } = scanFixture();
  assert.equal(violations.length, 0);
});

// --- Optional roots & fail-closed guard -----------------------------------

// --- Closed holes (Codex-1x6lu) ------------------------------------------
//
// Both were reachable by ordinary tooling, not deliberate evasion: an IDE
// auto-import writes RELATIVE paths by default, and a re-export is a static
// dependency that reads nothing like an import.

test('CATCHES a RELATIVE-path crossing into the editor (the IDE auto-import shape)', () => {
  writeFixture(
    'lib/page-builder/render/frame.ts',
    "import Editor from '../../components/page-builder/Editor.svelte';\nexport const x = Editor;\n"
  );
  writeFixture('lib/components/page-builder/Editor.svelte', '<div></div>\n');

  const { violations } = scanFixture();
  assert.equal(violations.length, 1, 'a relative specifier must be resolved, not pattern-matched');
  assert.match(violations[0].text, /\.\.\/\.\.\/components\/page-builder/);
});

test('CATCHES a shallower relative crossing too — depth must not matter', () => {
  writeFixture(
    'lib/page-builder/render.ts',
    "import { Panel } from '../components/brand-editor/Panel.svelte';\nexport const p = Panel;\n"
  );
  writeFixture('lib/components/brand-editor/Panel.svelte', '<div></div>\n');

  assert.equal(scanFixture().violations.length, 1);
});

test('CATCHES `export … from` an editor UI — a re-export is a static dependency', () => {
  writeFixture(
    'lib/page-builder/index.ts',
    "export { Editor } from '$lib/components/page-builder/Editor.svelte';\n"
  );

  const { violations } = scanFixture();
  assert.equal(violations.length, 1);
  assert.match(violations[0].text, /^export/);
});

test('CATCHES `export * from` an editor UI', () => {
  writeFixture('lib/page-builder/index.ts', "export * from '$lib/components/page-builder';\n");
  assert.equal(scanFixture().violations.length, 1);
});

test('CATCHES a MULTI-LINE re-export of the editor', () => {
  // The clause spans newlines, which the matcher's character class admits
  // while still stopping at a quote or semicolon so it cannot run past its own
  // statement. A single-line-only matcher misses this and it is the form
  // prettier produces once the clause is long enough.
  writeFixture(
    'lib/page-builder/index.ts',
    'export {\n  Editor,\n  Panel,\n} from \'$lib/components/page-builder\';\n'
  );
  const { violations } = scanFixture();
  assert.equal(violations.length, 1);
  assert.match(violations[0].text, /^export/);
});

test('does NOT treat an exported string that merely NAMES an editor path as a dependency', () => {
  // A sanity case, NOT a discriminating one: mutation-testing showed that
  // relaxing the re-export matcher's `from` clause to optional changes no
  // verdict here, because a specifier's quote must follow `export` directly
  // either way. Kept because these strings do occur (docs, error messages),
  // and their appearing in a violation list would be a real false alarm.
  writeFixture(
    'lib/page-builder/tokens.ts',
    [
      "export const banned = '$lib/components/page-builder';",
      "export const note = 'see ../components/brand-editor for the editor';",
      "export const v = 'plain';",
    ].join('\n') + '\n'
  );
  assert.deepEqual(scanFixture().violations, []);
});

test('does NOT flag a relative import that resolves OUTSIDE the editor dirs', () => {
  writeFixture(
    'lib/page-builder/render/frame.ts',
    "import { helper } from '../helpers';\nimport { near } from '../../page-builder/shared';\nexport const x = [helper, near];\n"
  );
  writeFixture('lib/page-builder/helpers.ts', 'export const helper = 1;\n');
  writeFixture('lib/page-builder/shared.ts', 'export const near = 2;\n');
  writeFixture('lib/components/page-builder/Editor.svelte', '<div></div>\n');

  assert.deepEqual(scanFixture().violations, [], 'containment, not prefix matching');
});

test('does NOT flag a DYNAMIC relative import of the editor (lazy chunk)', () => {
  writeFixture(
    'lib/page-builder/render.ts',
    "export const load = () => import('../components/page-builder/Editor.svelte');\n"
  );
  writeFixture('lib/components/page-builder/Editor.svelte', '<div></div>\n');

  assert.deepEqual(scanFixture().violations, []);
});

test('tolerates an absent optional root (page-builder not built yet)', () => {
  // Only brand-editor exists; page-builder root is absent → skipped, no throw.
  writeFixture('lib/brand-editor/index.ts', "export const ok = true;\n");

  const { violations, filesScanned } = scanFixture();
  assert.equal(violations.length, 0);
  assert.ok(filesScanned > 0);
});

test('throws on a missing REQUIRED root (misconfiguration fails loud, never silent)', () => {
  assert.throws(
    () =>
      collectViolations({
        requiredRoots: [join(root, 'does-not-exist')],
        optionalRoots: [],
        cwd: root,
      }),
    /required scan root does not exist/
  );
});

test('reports filesScanned=0 when nothing matches (main() fails closed on this)', () => {
  // routes exists but is empty and there are no optional roots → nothing
  // scanned. main() turns filesScanned===0 into a non-zero exit.
  const { violations, filesScanned } = collectViolations({
    requiredRoots: [join(root, 'routes')],
    optionalRoots: [],
    cwd: root,
  });
  assert.equal(violations.length, 0);
  assert.equal(filesScanned, 0);
});
