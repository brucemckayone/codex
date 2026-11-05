/**
 * Tests for the Dialog structure gate (Codex-vlphc.1).
 *
 * node:test rather than vitest, as for check-brand-editor-boundary: the thing
 * under test is a plain `.mjs` CLI. Wired via `pnpm --filter web run
 * check:dialog-structure:test` and a self-test step in static_analysis.yml.
 *
 * Each case writes a throwaway `src/` tree with the real layout (the Dialog
 * barrel at lib/components/ui/Dialog/index.ts, which the gate reads its part
 * names from) and points `collectViolations` at it. The real tree is never
 * touched.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { collectViolations } from './check-dialog-structure.mjs';

const DIALOG_INDEX = `import Root from './Dialog.svelte';
import Body from './DialogBody.svelte';
import Content from './DialogContent.svelte';
import Footer from './DialogFooter.svelte';
import Form from './DialogFormElement.svelte';
import Header from './DialogHeader.svelte';
import Title from './DialogTitle.svelte';

export { Root, Content, Title, Footer, Header, Body, Form };
`;

const IMPORT = `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
</script>
`;

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dialog-gate-'));
  writeFixture('src/lib/components/ui/Dialog/index.ts', DIALOG_INDEX);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeFixture(relPath, content) {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function scan(allowlist = []) {
  return collectViolations({ srcRoot: join(root, 'src'), cwd: root, allowlist });
}

/** `rule@line` for each violation, the shape the assertions compare. */
function summary(result) {
  return result.violations.map((v) => `${v.rule}@${v.line}`);
}

// --- Passing -------------------------------------------------------------

test('PASSES the shared shapes: Header/Body/Footer, Dialog.Form, a drawer, blocks, a local snippet', () => {
  writeFixture(
    'src/routes/ok/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  import * as Card from '$lib/components/ui/Card';
  let open = $state(false);
</script>

{#snippet body()}
  <Dialog.Body><p>body</p></Dialog.Body>
{/snippet}

<Card.Content><div>a Card's Content is not Dialog's</div></Card.Content>

<Dialog.Root bind:open>
  <Dialog.Content>
    <!-- a comment is fine -->
    <Dialog.Header><Dialog.Title>t</Dialog.Title></Dialog.Header>
    <Dialog.Toolbar direction="column"><input type="search" /></Dialog.Toolbar>
    {#if open}
      <Dialog.Form onsubmit={(e) => e.preventDefault()}>
        <Dialog.Toolbar><input type="search" /></Dialog.Toolbar>
        {#each [1] as i (i)}<Dialog.Body><input /></Dialog.Body>{/each}
        <Dialog.Footer><button type="submit">Save</button></Dialog.Footer>
      </Dialog.Form>
    {:else}
      {@render body()}
    {/if}
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root>
  <Dialog.Content variant="drawer" sheet>
    {#key open}<Dialog.Body><section>s</section></Dialog.Body>{/key}
  </Dialog.Content>
</Dialog.Root>

<style>
  .dialog-body { color: red; } /* scoped: only this file's own markup */
  :global(.my-panel) { color: red; }
</style>
`
  );

  const result = scan();
  assert.deepEqual(summary(result), []);
  assert.ok(result.filesScanned >= 2, 'sanity: the scan must visit the fixture files');
});

// --- content-child / form-child -----------------------------------------

test('CATCHES the tier-form shape: a raw <form> between Content and Body', () => {
  writeFixture(
    'src/routes/tier/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content>
    <Dialog.Header>t</Dialog.Header>
    <form class="tier-form">
      <Dialog.Body>b</Dialog.Body>
      <Dialog.Footer>f</Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
`
  );

  const result = scan();
  assert.deepEqual(summary(result), ['content-child@8']);
  assert.equal(result.violations[0].file, 'src/routes/tier/+page.svelte');
  assert.match(result.violations[0].detail, /<form> is a direct child of Dialog\.Content/);
});

test('CATCHES a Dialog.Form whose direct child is not Body or Footer', () => {
  writeFixture(
    'src/routes/form/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content>
    <Dialog.Form>
      <Dialog.Header>a Header belongs outside the form</Dialog.Header>
      <div class="fields"><Dialog.Body>b</Dialog.Body></div>
    </Dialog.Form>
  </Dialog.Content>
</Dialog.Root>
`
  );

  assert.deepEqual(summary(scan()), ['form-child@8', 'form-child@9']);
});

test('CATCHES a violation nested in blocks, in a local snippet, and an unprovable {@render}', () => {
  writeFixture(
    'src/routes/nested/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  let { children } = $props();
  let items = $state([1]);
</script>

{#snippet extra()}
  <div class="extra"></div>
{/snippet}

<Dialog.Root>
  <Dialog.Content>
    {#if items.length}
      {#each items as item (item)}
        {#await Promise.resolve(item) then v}
          <section>{v}</section>
        {/await}
      {/each}
    {/if}
    {@render extra()}
    {@render children?.()}
    stray text
  </Dialog.Content>
</Dialog.Root>
`
  );

  assert.deepEqual(summary(scan()), [
    'content-child@16',
    'content-child@8',
    'content-child@21',
    'content-child@22',
  ]);
});

// --- Alias resolution ----------------------------------------------------

test('RESOLVES another namespace alias, a named import, a part file and a relative path', () => {
  writeFixture(
    'src/routes/alias/+page.svelte',
    `<script lang="ts">
  import * as Modal from '$lib/components/ui/Dialog/index.js';
  import { Content as Panel, Body } from '../../lib/components/ui/Dialog';
  import RawContent from '$lib/components/ui/Dialog/DialogContent.svelte';
</script>

<Modal.Content><div>1</div></Modal.Content>
<Panel><Body>ok</Body><div>2</div></Panel>
<RawContent><div>3</div></RawContent>
`
  );

  assert.deepEqual(summary(scan()), ['content-child@7', 'content-child@8', 'content-child@9']);
});

test('FAILS LOUDLY on a script-side alias and on a re-export of the module', () => {
  writeFixture(
    'src/routes/sneaky/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  const Panel = Dialog.Content;
</script>

<Panel><div>hidden from a tag-only check</div></Panel>
`
  );
  writeFixture('src/lib/barrel.ts', "export * as Dialog from '$lib/components/ui/Dialog';\n");

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`).sort(),
    ['src/lib/barrel.ts alias@1', 'src/routes/sneaky/+page.svelte alias@3']
  );
});

test('FAILS LOUDLY on a .svelte file that does not parse', () => {
  writeFixture('src/routes/broken/+page.svelte', `${IMPORT}<div>{#if}</div>\n`);

  assert.deepEqual(summary(scan()).map((s) => s.split('@')[0]), ['parse']);
});

test('THROWS when the Dialog barrel is missing, rather than scanning blind', () => {
  rmSync(join(root, 'src/lib/components/ui/Dialog/index.ts'));
  writeFixture('src/routes/x/+page.svelte', '<p>x</p>\n');

  assert.throws(() => scan(), /index\.ts does not exist/);
});

// --- global-style --------------------------------------------------------

test('CATCHES :global() styling of the Dialog outside ui/Dialog/, in every form', () => {
  writeFixture(
    'src/lib/components/studio/Drawer.svelte',
    `<p>x</p>

<style>
  :global(.dialog-content.my-drawer) { position: fixed; }
  @media (max-width: 1px) {
    .wrap :global(.dialog-footer) { padding: 0; }
  }
  :global {
    .dialog-body { gap: 0; }
  }
  :global(.dialog-content-wrapper-ish) { color: red; }
  :global(.not-a-dialog) .dialog-title { color: red; }
</style>
`
  );
  writeFixture('src/lib/styles/app.css', '/* .dialog-content in a comment */\n.dialog-overlay { opacity: 0; }\n');

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`),
    [
      'src/lib/components/studio/Drawer.svelte global-style@4',
      'src/lib/components/studio/Drawer.svelte global-style@6',
      'src/lib/components/studio/Drawer.svelte global-style@9',
      'src/lib/components/studio/Drawer.svelte global-style@12',
      'src/lib/styles/app.css global-style@2',
    ]
  );
});

test('a page may give its Dialog.Form class spacing, never layout', () => {
  writeFixture(
    'src/routes/tier/+page.svelte',
    `<p>x</p>

<style>
  :global(.dialog-form.tier-form) { gap: var(--space-4); padding: var(--space-4); }
  :global(.dialog-form.tier-form .field) { display: grid; }
  :global(.dialog-form.tier-form) { display: block; gap: 0; }
  :global(.page .dialog-form) { overflow-y: auto; min-height: 0; }
  :global(.dialog-form.tier-form) { flex: 1; }
</style>
`
  );
  writeFixture(
    'src/lib/styles/forms.css',
    '.dialog-form.x { padding: 0; }\n.dialog-form.y { max-height: 10rem; }\n'
  );

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`),
    [
      'src/lib/styles/forms.css global-style@2',
      'src/routes/tier/+page.svelte global-style@6',
      'src/routes/tier/+page.svelte global-style@7',
      'src/routes/tier/+page.svelte global-style@8',
    ]
  );
  assert.match(result.violations[1].detail, /sets display on \.dialog-form; only spacing may change/);
  assert.match(result.violations[2].detail, /sets overflow-y, min-height/);
});

test('does NOT flag the Dialog styling itself inside ui/Dialog/', () => {
  writeFixture(
    'src/lib/components/ui/Dialog/DialogExtra.svelte',
    '<div class="dialog-body"></div>\n<style>\n  :global(.dialog-body) { gap: 0; }\n</style>\n'
  );

  assert.deepEqual(summary(scan()), []);
});

// --- own-dialog ----------------------------------------------------------

test('CATCHES role="dialog" and aria-modal outside lib/components/ui/, and only there', () => {
  writeFixture(
    'src/lib/components/search/Palette.svelte',
    `<script lang="ts">
  const selector = '[role="dialog"]';
</script>

<div role="dialog" aria-label="Search"></div>
<div role={'alertdialog'}></div>
<div aria-modal="true"></div>
<div role="menu"></div>
`
  );
  writeFixture('src/lib/components/ui/Modal/Modal.svelte', '<div role="dialog" aria-modal="true"></div>\n');

  assert.deepEqual(
    scan().violations.map((v) => `${v.file} ${v.rule}@${v.line}`),
    [
      'src/lib/components/search/Palette.svelte own-dialog@5',
      'src/lib/components/search/Palette.svelte own-dialog@6',
      'src/lib/components/search/Palette.svelte own-dialog@7',
    ]
  );
});

// --- Allowlist -----------------------------------------------------------

test('the ALLOWLIST waives a file for one rule only, and reports an entry that matches nothing', () => {
  writeFixture(
    'src/routes/known/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content><form></form></Dialog.Content>
</Dialog.Root>
<div role="dialog"></div>
`
  );

  const allowlist = [
    { file: 'src/routes/known/+page.svelte', rule: 'content-child', reason: 'known' },
    { file: 'src/routes/fixed/+page.svelte', rule: 'content-child', reason: 'already fixed' },
  ];
  const result = scan(allowlist);

  assert.deepEqual(summary(result), ['own-dialog@8']);
  assert.equal(result.allowlisted, 1);
  assert.deepEqual(
    result.stale.map((a) => a.file),
    ['src/routes/fixed/+page.svelte']
  );
});
