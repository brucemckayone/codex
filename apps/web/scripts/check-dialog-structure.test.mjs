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
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ALLOWLIST, collectViolations, PART_DATA_ATTRS } from './check-dialog-structure.mjs';

const GATE = fileURLToPath(new URL('./check-dialog-structure.mjs', import.meta.url));

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

// --- body-place / toolbar-body -------------------------------------------

test('CATCHES a Dialog.Body outside Content and Form: in Header, Toolbar, Body, Footer, a stray snippet, a lone file', () => {
  writeFixture(
    'src/routes/place/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>t</Dialog.Title><Dialog.Body>in Header</Dialog.Body></Dialog.Header>
    <Dialog.Toolbar><Dialog.Body>in Toolbar</Dialog.Body></Dialog.Toolbar>
    <Dialog.Body><Dialog.Body>in Body</Dialog.Body></Dialog.Body>
    <Dialog.Footer><Dialog.Body>in Footer</Dialog.Body>{@render stray()}</Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

{#snippet stray()}
  <Dialog.Body>rendered in a Footer</Dialog.Body>
{/snippet}
`
  );
  writeFixture('src/lib/components/BodyOnly.svelte', `${IMPORT}<Dialog.Body>a Body with no panel</Dialog.Body>\n`);

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`).sort(),
    [
      'src/lib/components/BodyOnly.svelte body-place@4',
      'src/routes/place/+page.svelte body-place@10',
      'src/routes/place/+page.svelte body-place@15',
      'src/routes/place/+page.svelte body-place@7',
      'src/routes/place/+page.svelte body-place@8',
      'src/routes/place/+page.svelte body-place@9',
    ]
  );
  assert.match(result.violations.find((v) => v.line === 8).detail, /sits in Dialog\.Toolbar; only Dialog\.Content or Dialog\.Form/);
});

test('ALLOWS a Body in Content or Form, through blocks, and from a local snippet rendered there', () => {
  writeFixture(
    'src/routes/place/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  let a = $state(true);
</script>

{#snippet body()}<Dialog.Body>from a snippet</Dialog.Body>{/snippet}

<Dialog.Root>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>t</Dialog.Title></Dialog.Header>
    {#if a}{@render body()}{:else}<Dialog.Body>direct</Dialog.Body>{/if}
  </Dialog.Content>
</Dialog.Root>
<Dialog.Root>
  <Dialog.Content>
    <Dialog.Form>{#each [1] as i (i)}<Dialog.Body>in a Form</Dialog.Body>{/each}<Dialog.Footer>f</Dialog.Footer></Dialog.Form>
  </Dialog.Content>
</Dialog.Root>
`
  );

  assert.deepEqual(summary(scan()), []);
});

test('CATCHES a Toolbar in a panel with no Body, in Content or in its Form', () => {
  writeFixture(
    'src/routes/toolbar/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>t</Dialog.Title></Dialog.Header>
    <Dialog.Toolbar direction="column"><label>a<input /></label><label>b<input /></label></Dialog.Toolbar>
    <Dialog.Footer>f</Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
<Dialog.Root>
  <Dialog.Content>
    <Dialog.Form><Dialog.Toolbar><input /></Dialog.Toolbar><Dialog.Footer>f</Dialog.Footer></Dialog.Form>
  </Dialog.Content>
</Dialog.Root>
`
  );

  const result = scan();
  assert.deepEqual(summary(result), ['toolbar-body@8', 'toolbar-body@14']);
  assert.match(result.violations[0].detail, /never scrolls \(flex: none\) and this panel has no Dialog\.Body/);
});

test('ALLOWS a Toolbar beside a Body, in Content or in its Form', () => {
  writeFixture(
    'src/routes/toolbar/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content>
    <Dialog.Toolbar direction="column"><input type="search" /></Dialog.Toolbar>
    <Dialog.Form><Dialog.Body>b</Dialog.Body><Dialog.Footer>f</Dialog.Footer></Dialog.Form>
  </Dialog.Content>
</Dialog.Root>
<Dialog.Root>
  <Dialog.Content>
    <Dialog.Form><Dialog.Toolbar><input /></Dialog.Toolbar><Dialog.Body>b</Dialog.Body></Dialog.Form>
  </Dialog.Content>
</Dialog.Root>
`
  );

  assert.deepEqual(summary(scan()), []);
});

test('CATCHES a Dialog.Form outside Content: in Header, Toolbar, Body, Footer, and a lone file', () => {
  writeFixture(
    'src/routes/form-place/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>T</Dialog.Title><Dialog.Form><Dialog.Body>a</Dialog.Body></Dialog.Form></Dialog.Header>
    <Dialog.Toolbar><Dialog.Form><Dialog.Footer>b</Dialog.Footer></Dialog.Form></Dialog.Toolbar>
    <Dialog.Body><Dialog.Form><Dialog.Footer>c</Dialog.Footer></Dialog.Form></Dialog.Body>
    <Dialog.Footer><Dialog.Form><Dialog.Footer>d</Dialog.Footer></Dialog.Form></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
`
  );
  writeFixture('src/lib/components/FormOnly.svelte', `${IMPORT}<Dialog.Form><Dialog.Body>x</Dialog.Body></Dialog.Form>\n`);

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`).sort(),
    [
      'src/lib/components/FormOnly.svelte form-place@4',
      'src/routes/form-place/+page.svelte form-place@10',
      // The Form in Header launders its Body past body-place: form-place catches it.
      'src/routes/form-place/+page.svelte form-place@7',
      'src/routes/form-place/+page.svelte form-place@8',
      'src/routes/form-place/+page.svelte form-place@9',
    ]
  );
  assert.match(result.violations.find((v) => v.line === 7).detail, /<Dialog\.Form> sits in Dialog\.Header; only Dialog\.Content may hold it/);
});

test('ALLOWS a Form in Content, through blocks, and from a local snippet rendered there', () => {
  writeFixture(
    'src/routes/form-ok/+page.svelte',
    `${IMPORT}
{#snippet form()}<Dialog.Form><Dialog.Body>b</Dialog.Body><Dialog.Footer>f</Dialog.Footer></Dialog.Form>{/snippet}
<Dialog.Root>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>T</Dialog.Title></Dialog.Header>
    {#if a}<Dialog.Form><Dialog.Body>x</Dialog.Body></Dialog.Form>{:else}{@render form()}{/if}
  </Dialog.Content>
</Dialog.Root>
`
  );

  assert.deepEqual(summary(scan()), []);
});

// --- snippet-name / svelte:boundary --------------------------------------

test('CATCHES a rendered snippet whose name is bound again: a second snippet, a parameter, an {#each} name', () => {
  writeFixture(
    'src/routes/shadow/+page.svelte',
    `${IMPORT}
{#snippet body()}<Dialog.Body>ok</Dialog.Body>{/snippet}
{#snippet panel(body)}<Dialog.Root><Dialog.Content>{@render body()}</Dialog.Content></Dialog.Root>{/snippet}
{#snippet row()}<Dialog.Body>a</Dialog.Body>{/snippet}
<section>{#snippet row()}<div class="raw"><Dialog.Body>x</Dialog.Body></div>{/snippet}<Dialog.Root><Dialog.Content>{@render row()}</Dialog.Content></Dialog.Root></section>
{#each heads as head}<Dialog.Root><Dialog.Content>{@render head()}<Dialog.Body>b</Dialog.Body></Dialog.Content></Dialog.Root>{/each}
{#snippet head()}<Dialog.Header>h</Dialog.Header>{/snippet}
{@render panel(body)}
`
  );

  const result = scan();
  // Each shadow resolves, by name, to a snippet that passes; only the name rule sees them.
  assert.deepEqual(summary(result), ['snippet-name@5', 'snippet-name@7', 'snippet-name@8', 'snippet-name@10']);
  assert.match(result.violations[0].detail, /\{#snippet body\(\)\} shares its name with another binding/);
});

test('ALLOWS unique snippet names, a shadowed name never {@render}ed, and a file without the Dialog', () => {
  writeFixture(
    'src/routes/names/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  import Table from './Table.svelte';
</script>

{#snippet body()}<Dialog.Body>ok</Dialog.Body>{/snippet}
{#snippet row(item)}<p>{item}</p>{/snippet}
{#snippet cell()}<td>c</td>{/snippet}
{#each items as item}{@render row(item)}{/each}
{#each cols as cell}<Table {cell} />{/each}
<Dialog.Root><Dialog.Content>{@render body()}</Dialog.Content></Dialog.Root>
`
  );
  writeFixture('src/routes/no-dialog/+page.svelte', '{#snippet a()}x{/snippet}\n<div>{#snippet a()}y{/snippet}{@render a()}</div>\n');
  // Type-only imports bind no part, so this file uses no Dialog either.
  writeFixture(
    'src/routes/types-only/+page.svelte',
    `<script lang="ts">
  import type { Body } from '$lib/components/ui/Dialog';
  import { type Content } from '$lib/components/ui/Dialog';
</script>
{#snippet a()}x{/snippet}
<div>{#snippet a()}y{/snippet}{@render a()}</div>
`
  );

  assert.deepEqual(summary(scan()), []);
});

test("CATCHES what a <svelte:boundary>'s failed or pending snippet renders in its place", () => {
  writeFixture(
    'src/routes/boundary/+page.svelte',
    `${IMPORT}
{#snippet oops()}<div class="raw">failed</div>{/snippet}
<Dialog.Root>
  <Dialog.Content>
    <svelte:boundary failed={oops} pending={wait()}><Dialog.Body>x</Dialog.Body></svelte:boundary>
  </Dialog.Content>
</Dialog.Root>
`
  );

  const result = scan();
  // The raw div, at its snippet; then the pending render this check can't follow.
  assert.deepEqual(summary(result), ['content-child@5', 'content-child@8']);
  assert.match(result.violations[1].detail, /renders what this check cannot see/);
});

test("ALLOWS a boundary whose failed snippet renders a Body, by shorthand or inline", () => {
  writeFixture(
    'src/routes/boundary-ok/+page.svelte',
    `${IMPORT}
{#snippet failed()}<Dialog.Body>Something went wrong</Dialog.Body>{/snippet}
<Dialog.Root>
  <Dialog.Content>
    <svelte:boundary {failed}><Dialog.Body>x</Dialog.Body></svelte:boundary>
    <svelte:boundary>{#snippet pending()}<Dialog.Body>…</Dialog.Body>{/snippet}<Dialog.Body>y</Dialog.Body></svelte:boundary>
  </Dialog.Content>
</Dialog.Root>
`
  );

  assert.deepEqual(summary(scan()), []);
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

test('CATCHES every value read of a Dialog binding, <svelte:component>, a trailing slash, and a .ts/.js importing the module', () => {
  writeFixture(
    'src/routes/reads/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog/';
  import { Content, Body } from '$lib/components/ui/Dialog';
  const Panel = Content;
</script>

<svelte:component this={Dialog.Content}><div>1</div></svelte:component>
{#if true}{@const Inner = Body}<Inner>x</Inner>{/if}
<Thing part={Dialog} />
`
  );
  writeFixture('src/lib/kit.ts', "import * as D from './components/ui/Dialog';\nexport { D as Dialog };\n");
  writeFixture('src/lib/lazy.js', "export const load = () => import('$lib/components/ui/Dialog/DialogBody.svelte');\n");

  assert.deepEqual(
    scan().violations.map((v) => `${v.file} ${v.rule}@${v.line}`).sort(),
    [
      'src/lib/kit.ts alias@1',
      'src/lib/lazy.js alias@1',
      'src/routes/reads/+page.svelte alias@4',
      'src/routes/reads/+page.svelte alias@7',
      'src/routes/reads/+page.svelte alias@8',
      'src/routes/reads/+page.svelte alias@9',
      // Through <svelte:component>, and resolved through the trailing slash.
      'src/routes/reads/+page.svelte content-child@7',
    ]
  );
});

test('ALLOWS a type, a member or key of the same name, tag use, type-only imports, and tests', () => {
  writeFixture(
    'src/routes/ok/+page.svelte',
    `<script module lang="ts">
  export type { Content } from '$lib/components/ui/Dialog';
</script>
<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  import type { ComponentProps } from 'svelte';
  import type DialogBody from '$lib/components/ui/Dialog/DialogBody.svelte';
  import { type Footer as FooterPart } from '$lib/components/ui/Dialog';
  type Props = ComponentProps<typeof Dialog.Content> & ComponentProps<typeof DialogBody> & ComponentProps<FooterPart>;
  const labels = { Dialog: 'a key', Content: 'another' };
  const label = labels.Dialog as string;
</script>

<Dialog.Root><Dialog.Content><Dialog.Body>{labels.Content}{label}</Dialog.Body></Dialog.Content></Dialog.Root>
`
  );
  writeFixture(
    'src/lib/types.ts',
    [
      "import type DialogContent from '$lib/components/ui/Dialog/DialogContent.svelte';",
      "import { type Body } from '$lib/components/ui/Dialog';",
      "export type { Content } from '$lib/components/ui/Dialog';",
      "export type P = ComponentProps<typeof import('$lib/components/ui/Dialog').Content>;",
      'export type Q = ComponentProps<typeof DialogContent> & ComponentProps<typeof Body>;',
      '',
    ].join('\n')
  );
  // Tests are not shipped: they may import the module and stub showModal.
  const testSource =
    "import * as Dialog from '$lib/components/ui/Dialog';\nHTMLDialogElement.prototype.showModal = () => {};\nexpect(Dialog.Content).toBeDefined();\n";
  writeFixture('src/lib/components/studio/x.svelte.test.ts', testSource);
  writeFixture('src/lib/components/studio/y.spec.ts', testSource);
  writeFixture('src/lib/other.ts', "import { x } from '$lib/components/ui/Card';\nexport const ui = '$lib/components/ui/Dialog';\n");

  assert.deepEqual(summary(scan()), []);
});

test('CATCHES a ui/ barrel, { default as X }, import() in a .svelte, .mjs/.mts/.cjs/.cts files, and reads under as/satisfies/!', () => {
  writeFixture('src/lib/components/ui/Feedback/parts.ts', "import * as Dialog from '../Dialog';\nexport { Dialog };\n");
  writeFixture(
    'src/routes/default-as/+page.svelte',
    `<script lang="ts">
  import { default as Panel } from '$lib/components/ui/Dialog/DialogContent.svelte';
  const load = () => import('$lib/components/ui/Dialog');
</script>

<Panel><div class="raw">x</div></Panel>
{#await import('$lib/components/ui/Dialog/DialogBody.svelte') then m}<m.default>y</m.default>{/await}
`
  );
  writeFixture(
    'src/routes/ts-reads/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  const A = Dialog.Content as typeof Dialog.Content;
  const B = Dialog.Body satisfies unknown;
  const C = Dialog!.Footer;
</script>
`
  );
  writeFixture('src/lib/a.mjs', "export * as Dialog from '$lib/components/ui/Dialog';\n");
  writeFixture('src/lib/b.mts', "import { Body } from '$lib/components/ui/Dialog';\nexport { Body };\n");
  writeFixture('src/lib/c.cjs', 'const open = (d) => d.showModal();\nmodule.exports = { open };\n');
  writeFixture('src/lib/d.cts', "import * as Melt from '@melt-ui/svelte';\nexport const d = Melt.createDialog();\n");

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`).sort(),
    [
      'src/lib/a.mjs alias@1',
      'src/lib/b.mts alias@1',
      'src/lib/c.cjs own-dialog@1',
      'src/lib/components/ui/Feedback/parts.ts alias@1',
      'src/lib/d.cts own-dialog@2',
      'src/routes/default-as/+page.svelte alias@3',
      'src/routes/default-as/+page.svelte alias@7',
      // `{ default as Panel }` binds Panel to Content.
      'src/routes/default-as/+page.svelte content-child@6',
      'src/routes/ts-reads/+page.svelte alias@3',
      'src/routes/ts-reads/+page.svelte alias@4',
      'src/routes/ts-reads/+page.svelte alias@5',
    ]
  );
  assert.match(result.violations.find((v) => v.file === 'src/lib/a.mjs').detail, /import it from \$lib\/components\/ui\/Dialog directly/);
});

test('FAILS LOUDLY on a .svelte file that does not parse', () => {
  writeFixture('src/routes/broken/+page.svelte', `${IMPORT}<div>{#if}</div>\n`);

  assert.deepEqual(summary(scan()).map((s) => s.split('@')[0]), ['parse']);
});

test('FAILS LOUDLY on a .css file that does not parse, at its own line', () => {
  writeFixture('src/lib/styles/broken.css', '.a { color: red; }\n}\n.dialog-body { flex: none; }\n');

  const result = scan();
  assert.deepEqual(summary(result), ['parse@2']);
  // Svelte's parser is stricter than browsers (`:lang("en")`): say whose rule it is.
  assert.match(result.violations[0].detail, /svelte's CSS parser rejects this .*rewrite the construct/);
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

test('ALLOWS spacing on .dialog-form plus the page\'s own class', () => {
  writeFixture(
    'src/routes/tier/+page.svelte',
    `<p>x</p>

<style>
  :global(.dialog-form.tier-form) { gap: var(--space-4); padding: var(--space-4); }
  :global(.tier-form.dialog-form) { row-gap: 0; padding-inline: 0; margin-block-end: var(--space-2); }
  :global(.dialog-form.tier-form), :global(.dialog-form.faq-form) { column-gap: 0; margin: 0; }
  .field { display: grid; }
</style>
`
  );
  writeFixture('src/lib/styles/forms.css', '.dialog-form.x { padding: 0; }\n');

  assert.deepEqual(scan().violations, []);
});

test('CATCHES any property on .dialog-form.<own-class> other than gap, padding and margin', () => {
  writeFixture(
    'src/routes/tier/+page.svelte',
    `<p>x</p>

<style>
  :global(.dialog-form.tier-form) { display: block; gap: 0; }
  :global(.dialog-form.tier-form) { overflow-y: auto; min-height: 0; }
  :global(.dialog-form.tier-form) { flex: 1; }
  :global(.dialog-form.tier-form) { position: relative; max-height: 10rem; height: 100%; }
  :global(.dialog-form.tier-form) { color: red; }
</style>
`
  );
  writeFixture('src/lib/styles/forms.css', '.dialog-form.y { flex-direction: row; }\n');

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`),
    [
      'src/lib/styles/forms.css global-style@1',
      'src/routes/tier/+page.svelte global-style@4',
      'src/routes/tier/+page.svelte global-style@5',
      'src/routes/tier/+page.svelte global-style@6',
      'src/routes/tier/+page.svelte global-style@7',
      'src/routes/tier/+page.svelte global-style@8',
    ]
  );
  assert.match(result.violations[1].detail, /sets display on \.dialog-form; only gap, padding and margin may change/);
  assert.match(result.violations[2].detail, /sets overflow-y, min-height on/);
  assert.match(result.violations[4].detail, /sets position, max-height, height on/);
});

test('CATCHES .dialog-form styled bare, inside a combinator, or around a descendant', () => {
  writeFixture(
    'src/routes/tier/+page.svelte',
    `<p>x</p>

<style>
  :global(.dialog-form) { gap: 0; }
  :global(.page .dialog-form.tier-form) { padding: 0; }
  :global(.dialog-form.tier-form .field) { margin: 0; }
  :global(.dialog-form.tier-form), :global(.dialog-form) { gap: 0; }
  :global(form.dialog-form.tier-form) { gap: 0; }
  :global(.dialog-form.tier-form:focus-within) { padding: 0; }
</style>
`
  );
  writeFixture('src/lib/styles/forms.css', '.dialog-form { padding: 0; }\n');

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`),
    [
      'src/lib/styles/forms.css global-style@1',
      'src/routes/tier/+page.svelte global-style@4',
      'src/routes/tier/+page.svelte global-style@5',
      'src/routes/tier/+page.svelte global-style@6',
      'src/routes/tier/+page.svelte global-style@7',
      'src/routes/tier/+page.svelte global-style@8',
      'src/routes/tier/+page.svelte global-style@9',
    ]
  );
  for (const v of result.violations) {
    assert.match(v.detail, /style a Dialog\.Form only as \.dialog-form\.<your-class>/);
  }
});

test("CATCHES the Dialog's attributes in a global rule, and global rules nested in a rule or at-rule", () => {
  writeFixture(
    'src/routes/attrs/+page.svelte',
    `<p>x</p>

<style>
  :global([data-melt-dialog-content]) { overflow: visible; }
  :global(div[role='dialog'] > div) { flex: none; }
  :global([aria-modal='true'] .x) { color: red; }
  :global([data-layout='dialog']) { flex: none; }
  :global(.panel[data-variant="drawer"]) { width: 100%; }
  :global([data-flush]) { padding: 0; }
  :global(.dialog-form.tier-form) {
    gap: 0;
    @media (max-width: 1px) { display: block; }
    & { flex: 1; }
  }
  .page {
    :global(.dialog-body) { gap: 0; }
  }
</style>
`
  );
  writeFixture(
    'src/lib/styles/nested.css',
    '.dialog-content {\n  overflow: visible;\n  &:focus-visible { outline: none; }\n}\n.panel {\n  .dialog-footer { display: none; }\n}\n@media (max-width: 1px) {\n  [data-melt-dialog-overlay] { opacity: 0; }\n}\n'
  );

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`).sort(),
    [
      'src/lib/styles/nested.css global-style@1',
      'src/lib/styles/nested.css global-style@3',
      'src/lib/styles/nested.css global-style@6',
      'src/lib/styles/nested.css global-style@9',
      'src/routes/attrs/+page.svelte global-style@12',
      'src/routes/attrs/+page.svelte global-style@13',
      'src/routes/attrs/+page.svelte global-style@16',
      'src/routes/attrs/+page.svelte global-style@4',
      'src/routes/attrs/+page.svelte global-style@5',
      'src/routes/attrs/+page.svelte global-style@6',
      'src/routes/attrs/+page.svelte global-style@7',
      'src/routes/attrs/+page.svelte global-style@8',
      'src/routes/attrs/+page.svelte global-style@9',
    ]
  );
  assert.match(result.violations.find((v) => v.line === 5).detail, /through \[role='dialog'\]/);
  assert.match(result.violations.find((v) => v.line === 12).detail, /sets display on \.dialog-form/);
});

test("ALLOWS other components' data attributes, and nested spacing on .dialog-form.<own>", () => {
  writeFixture(
    'src/routes/attrs/+page.svelte',
    `<p>x</p>

<style>
  :global(.lp[data-lp-style='bold']) .tm[data-layout='grid'] { gap: 0; }
  :global(.btn[data-variant='primary']) { color: red; }
  :global([data-size='lg']) { font-size: 2rem; }
  :global(.dialog-form.tier-form) {
    gap: var(--space-4);
    @media (max-width: 40rem) { padding: 0; margin-block: 0; }
  }
  :global { .dialog-form.tier-form { row-gap: 0; } }
  .page { .row { display: grid; } }
</style>
`
  );
  writeFixture('src/lib/styles/page.css', ".card[data-layout='grid'] {\n  display: grid;\n  &:hover { color: red; }\n}\n");

  assert.deepEqual(summary(scan()), []);
});

test('CATCHES the Dialog reached through a [class] test, an @scope prelude, a CSS escape, and its own data values', () => {
  writeFixture(
    'src/lib/styles/m3.css',
    [
      "div[class~='dialog-body'][class] { flex: none; }",
      "[class*='dialog-content'] { overflow: visible; }",
      "[class^='dialog-'] { display: block; }",
      '@scope (.dialog-body) {',
      '  :scope:not(#_) { flex: none; }',
      '}',
      '@scope (.page) to (.dialog-footer) {',
      '  .x { color: red; }',
      '}',
      '.dialog\\-body { flex: none; }',
      '.dialog\\2d footer { display: none; }',
      "[data-radius='lg'] .card { border-radius: 0; }",
      '[data-placement="top"] { top: 0; }',
      '[data-surface=glass] { box-shadow: none; }',
      '',
    ].join('\n')
  );
  writeFixture(
    'src/routes/m3/+page.svelte',
    `<p>x</p>

<style>
  :global(div[class~='dialog-body'][class]) { flex: none; }
  @scope (.dialog-content) {
    :global(:scope:not(#_)) { max-height: none; }
  }
  :global(.dialog\\-body) { flex: none; }
</style>
`
  );

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`).sort(),
    [
      'src/lib/styles/m3.css global-style@1',
      'src/lib/styles/m3.css global-style@10',
      'src/lib/styles/m3.css global-style@11',
      'src/lib/styles/m3.css global-style@12',
      'src/lib/styles/m3.css global-style@13',
      'src/lib/styles/m3.css global-style@14',
      'src/lib/styles/m3.css global-style@2',
      'src/lib/styles/m3.css global-style@3',
      // The @scope prelude, and its :scope rule.
      'src/lib/styles/m3.css global-style@4',
      'src/lib/styles/m3.css global-style@5',
      // A scope limit names the Dialog too.
      'src/lib/styles/m3.css global-style@7',
      'src/routes/m3/+page.svelte global-style@4',
      'src/routes/m3/+page.svelte global-style@5',
      'src/routes/m3/+page.svelte global-style@6',
      'src/routes/m3/+page.svelte global-style@8',
    ]
  );
  const at = (file, line) => result.violations.find((v) => v.file.endsWith(file) && v.line === line).detail;
  assert.match(at('m3.css', 2), /restyles the Dialog's \.dialog-content; style your own element inside the part/);
  // `:scope` reads as the scope's root.
  assert.match(at('m3.css', 5), /^\.dialog-body:not\(#_\) restyles/);
  assert.match(at('m3.css', 11), /restyles the Dialog's \.dialog-footer/);
});

test("ALLOWS org-brand's [class*='-title'], other escapes, another @scope, and generic data values", () => {
  writeFixture(
    'src/lib/styles/brand.css',
    [
      "[data-org-brand] [class*='__title'],",
      "[data-org-brand] [class*='-title'] { color: var(--color-text); }",
      '.sm\\:flex { display: flex; }',
      '@scope (.card) to (.slot) { img { width: 100%; } }',
      "[data-radius='round'] .card { border-radius: 9999px; }",
      "[data-placement='left'] .tip { left: 0; }",
      "[data-surface='raised'] { box-shadow: none; }",
      '[data-placement] .tooltip { z-index: 1; }',
      '',
    ].join('\n')
  );

  assert.deepEqual(summary(scan()), []);
});

test('CATCHES a class a page hands a Dialog part, restyled through :global', () => {
  writeFixture(
    'src/routes/drawer/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content class="my-drawer">
    <Dialog.Header class="my-head"><Dialog.Title>T</Dialog.Title></Dialog.Header>
    <Dialog.Body class="my-body {wide ? 'is-wide' : 'is-narrow'}"><p>x</p></Dialog.Body>
    <Dialog.Footer class={\`my-foot \${tone}\`}><p>y</p></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  :global(.my-drawer) { position: fixed; }
  .wrap :global(.my-head) { padding: 0; }
  :global(.is-narrow:hover) { overflow: hidden; }
  :global(.my-foot) { border: none; }
  :global {
    .my-body { gap: 0; }
  }
  .page {
    :global(.my-drawer > .my-body) { display: block; }
  }
</style>
`
  );

  const result = scan();
  // part-dynamic@9: `${tone}` makes the Footer's class unreadable (its own test below).
  assert.deepEqual(summary(result), [
    'part-dynamic@9',
    'part-class@14',
    'part-class@15',
    'part-class@16',
    'part-class@17',
    'part-class@19',
    'part-class@22',
  ]);
  assert.match(result.violations[1].detail, /restyles Dialog\.Content through its class \.my-drawer/);
  assert.match(result.violations[3].detail, /Dialog\.Body through its class \.is-narrow/);
  assert.match(result.violations[4].detail, /Dialog\.Footer through its class \.my-foot/);
});

test('ALLOWS a part class as an ancestor, a Title class, scoped CSS and the Form spacing case', () => {
  writeFixture(
    'src/routes/drawer/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content class="my-drawer">
    <Dialog.Header><Dialog.Title class="my-title">T</Dialog.Title></Dialog.Header>
    <Dialog.Form class="my-form"><Dialog.Body><p class="row">x</p></Dialog.Body></Dialog.Form>
  </Dialog.Content>
</Dialog.Root>
<p class="my-drawer">a page element of the same name</p>

<style>
  :global(.my-drawer .section-heading) { color: red; }
  .row :global(.my-title) { font-size: 2rem; }
  :global(.dialog-form.my-form) { gap: var(--space-4); }
  :global(.other:not(.my-drawer)) { color: red; }
  .my-drawer { color: red; }
</style>
`
  );

  assert.deepEqual(summary(scan()), []);
});

test('CATCHES a walk from a part class to an element no class names, and class:/object classes on a part', () => {
  writeFixture(
    'src/routes/walk/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content class="panel">
    <Dialog.Toolbar class="tools"><input /></Dialog.Toolbar>
    <Dialog.Body class:tall={true} class={{ roomy: true }}>b</Dialog.Body>
  </Dialog.Content>
</Dialog.Root>

<style>
  :global(.panel > div:not(.row):not(:last-child)) { flex: none; }
  :global(.tools.tools + *) { flex: none; }
  :global(.panel > [data-x]) { flex: none; }
  :global(.tall) { flex: none; }
  :global(.roomy) { flex: none; }
</style>
`
  );

  const result = scan();
  assert.deepEqual(summary(result), ['part-class@13', 'part-class@14', 'part-class@15', 'part-class@16', 'part-class@17']);
  assert.match(result.violations[0].detail, /walks from Dialog\.Content's class \.panel to an element no class names/);
  assert.match(result.violations[3].detail, /Dialog\.Body through its class \.tall/);
});

test('ALLOWS a walk from a part class to a classed element, a scoped subject, and a walk from a page class', () => {
  writeFixture(
    'src/routes/walk/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content class="panel"><Dialog.Body><div class="row">x</div></Dialog.Body></Dialog.Content>
</Dialog.Root>
<section class="other"><div>y</div></section>

<style>
  :global(.panel .row) { display: grid; }
  :global(.panel) div { color: red; }
  :global(.other > div) { flex: none; }
  .panel > div { color: red; }
</style>
`
  );

  assert.deepEqual(summary(scan()), []);
});

/** A page that hands its parts a class, an id, a test id and a role. */
const TIER_PAGE = `${IMPORT}
<Dialog.Root>
  <Dialog.Content class="tier-panel" data-testid="tier-dialog">
    <Dialog.Body class="studio-drawer__body" id="tier-body" role="listbox">b</Dialog.Body>
  </Dialog.Content>
</Dialog.Root>
`;

test("CATCHES a part's class, id or attribute restyled from ANOTHER file, and named inside :has/:is/:not", () => {
  writeFixture('src/routes/tier/+page.svelte', TIER_PAGE);
  writeFixture(
    'src/lib/styles/studio.css',
    [
      'div.studio-drawer__body.studio-drawer__body { flex: none; }',
      '#tier-body { flex: none; }',
      "div[data-testid='tier-dialog'][data-testid] { max-height: none; }",
      "[role='listbox'] { overflow: visible; }",
      '.tier-panel > :is(.x, div) { flex: none; }',
      'div:has(> .studio-drawer__body) { max-height: none; }',
      'div:not(:not(.studio-drawer__body)) { flex: none; }',
      "[class~='studio-drawer__body'] { flex: none; }",
      '@scope (.studio-drawer__body) { flex: none; }',
      '',
    ].join('\n')
  );
  writeFixture(
    'src/routes/+layout.svelte',
    `<script lang="ts">let { children } = $props();</script>
{@render children()}
<style>
  :global(div.tier-panel.tier-panel) { max-height: none; }
  :is(:global(.studio-drawer__body.studio-drawer__body)) { flex: none; }
  .wrap :is(:global(#tier-body)) { flex: none; }
</style>
`
  );

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`).sort(),
    [
      'src/lib/styles/studio.css part-class@1',
      'src/lib/styles/studio.css part-class@2',
      'src/lib/styles/studio.css part-class@3',
      'src/lib/styles/studio.css part-class@4',
      'src/lib/styles/studio.css part-class@5',
      'src/lib/styles/studio.css part-class@6',
      'src/lib/styles/studio.css part-class@7',
      'src/lib/styles/studio.css part-class@8',
      // Declarations straight in @scope style its root.
      'src/lib/styles/studio.css part-class@9',
      'src/routes/+layout.svelte part-class@4',
      'src/routes/+layout.svelte part-class@5',
      'src/routes/+layout.svelte part-class@6',
    ]
  );
  const at = (file, line) => result.violations.find((v) => v.file.endsWith(file) && v.line === line).detail;
  assert.match(at('studio.css', 1), /restyles Dialog\.Body through its class \.studio-drawer__body \(src\/routes\/tier\/\+page\.svelte hands it to Dialog\.Body\)/);
  assert.match(at('studio.css', 2), /through its id #tier-body/);
  assert.match(at('studio.css', 3), /Dialog\.Content through its attribute \[data-testid\]/);
  assert.match(at('studio.css', 5), /walks from Dialog\.Content's class \.tier-panel .* to an element no class names/);
  assert.match(at('studio.css', 6), /walks from Dialog\.Body's class \.studio-drawer__body/);
});

test("ALLOWS a part's handle as an ancestor of a classed element, another value, an own class, and a SCOPED compound naming it", () => {
  writeFixture('src/routes/tier/+page.svelte', TIER_PAGE);
  writeFixture(
    'src/lib/styles/page.css',
    [
      '.tier-panel .row { display: grid; }',
      '#tier-body .row { gap: 0; }',
      "[data-testid='tier-dialog'] .row { color: red; }",
      "[role='listbox'].menu { display: block; }",
      "[data-testid='other'] { flex: none; }",
      '.other:not(.tier-panel) { flex: none; }',
      ':is(.mine, .other) { flex: none; }',
      '',
    ].join('\n')
  );
  // A compound outside :global carries this file's scoping class, so it can
  // only be this file's element: GalleryBlock's `.gallery.lp-bleed > :global(*)`.
  writeFixture(
    'src/lib/components/Gallery.svelte',
    `<div class="studio-drawer__body lp"><p>x</p></div>
<style>
  .studio-drawer__body.lp > :global(*) { margin: 0; }
  div:has(:global(.studio-drawer__body)) { color: red; }
  /* Inside :global too, each :is() alternative is the page's own element. */
  :global(.tier-panel > :is(.row, .cell)) { gap: 0; }
</style>
`
  );

  assert.deepEqual(summary(scan()), []);
});

test('CATCHES the Form class without .dialog-form, and today\'s drawer patterns', () => {
  writeFixture(
    'src/routes/tier/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content><Dialog.Form class="tier-form"><Dialog.Body>x</Dialog.Body></Dialog.Form></Dialog.Content>
</Dialog.Root>

<style>
  :global(.tier-form) { gap: 0; }
</style>
`
  );
  // FilterDrawer before Codex-vlphc.3: its own classes on Header and Body.
  writeFixture(
    'src/lib/components/ui/FilterDrawer/FilterDrawer.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content class="filter-drawer">
    <Dialog.Header class="filter-drawer__head"><Dialog.Title>T</Dialog.Title></Dialog.Header>
    <Dialog.Body class="filter-drawer__body">x</Dialog.Body>
  </Dialog.Content>
</Dialog.Root>

<style>
  :global(.filter-drawer__head) { padding: var(--space-5) var(--space-6) var(--space-4); }
  :global(.filter-drawer__body) { flex: 1 1 auto; overflow-y: auto; display: flex; }
</style>
`
  );
  // A hand-built drawer with the Dialog class dropped from its override,
  // the one step that used to get it past global-style.
  writeFixture(
    'src/lib/components/studio/Drawer.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content class="drawer-content"><Dialog.Body>x</Dialog.Body></Dialog.Content>
</Dialog.Root>

<style>
  :global(.drawer-content) { position: fixed; overflow-y: auto; }
  @media (max-width: 1px) {
    :global(.drawer-content) { max-width: 100%; }
  }
</style>
`
  );

  assert.deepEqual(
    scan().violations.map((v) => `${v.file} ${v.rule}@${v.line}`),
    [
      'src/lib/components/studio/Drawer.svelte part-class@10',
      'src/lib/components/studio/Drawer.svelte part-class@12',
      'src/lib/components/ui/FilterDrawer/FilterDrawer.svelte part-class@13',
      'src/lib/components/ui/FilterDrawer/FilterDrawer.svelte part-class@14',
      'src/routes/tier/+page.svelte part-class@10',
    ]
  );
});

test('does NOT flag the Dialog styling itself inside ui/Dialog/', () => {
  writeFixture(
    'src/lib/components/ui/Dialog/DialogExtra.svelte',
    '<div class="dialog-body"></div>\n<style>\n  :global(.dialog-body) { gap: 0; }\n</style>\n'
  );

  assert.deepEqual(summary(scan()), []);
});

// --- part-style / part-dynamic / markup-style ----------------------------

test('CATCHES an inline style or style: directive on a part that draws the panel', () => {
  writeFixture(
    'src/routes/inline/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content style="overflow: visible">
    <Dialog.Header style:padding="0"><Dialog.Title>t</Dialog.Title></Dialog.Header>
    <Dialog.Body style="flex: none">b</Dialog.Body>
    <Dialog.Form style={css}><Dialog.Footer>f</Dialog.Footer></Dialog.Form>
  </Dialog.Content>
</Dialog.Root>
`
  );

  const result = scan();
  assert.deepEqual(summary(result), ['part-style@6', 'part-style@7', 'part-style@8', 'part-style@9']);
  assert.match(result.violations[2].detail, /<Dialog\.Body> takes an inline style/);
});

test("ALLOWS Content's size props, a styled Title, a styled page element, and the parts' own files", () => {
  writeFixture(
    'src/routes/inline/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content maxWidth="40rem" maxHeight="60vh">
    <Dialog.Header><Dialog.Title style="color: red">t</Dialog.Title></Dialog.Header>
    <Dialog.Body><p style="height: 100vh">a page element may</p></Dialog.Body>
  </Dialog.Content>
</Dialog.Root>
`
  );
  writeFixture(
    'src/lib/components/ui/Dialog/Dialog.stories.svelte',
    "<script lang=\"ts\">\n  import * as Dialog from './index';\n</script>\n<Dialog.Root><Dialog.Content><Dialog.Body style=\"min-height: 0\" {...{}}>story</Dialog.Body></Dialog.Content></Dialog.Root>\n"
  );

  assert.deepEqual(summary(scan()), []);
});

test('CATCHES a spread, or a class held in a variable, a prop or an interpolation, on a part', () => {
  writeFixture(
    'src/lib/components/Shell.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  let { bodyClass, ...rest } = $props();
  const formClass = 'tier-form';
  let tone = $state('warm');
</script>

<Dialog.Root>
  <Dialog.Content {...rest}>
    <Dialog.Form class={formClass}>
      <Dialog.Body class={bodyClass}>b</Dialog.Body>
      <Dialog.Footer class={\`foot \${tone}\`}>f</Dialog.Footer>
    </Dialog.Form>
  </Dialog.Content>
</Dialog.Root>
`
  );

  const result = scan();
  assert.deepEqual(summary(result), ['part-dynamic@9', 'part-dynamic@10', 'part-dynamic@11', 'part-dynamic@12']);
  assert.match(result.violations[0].detail, /takes a \{\.\.\.spread\}/);
  assert.match(result.violations[2].detail, /<Dialog\.Body>'s class is not a literal/);
});

test('ALLOWS literal classes in every spelling, a computed Title class, and a spread on a page element', () => {
  writeFixture(
    'src/routes/classes/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  let { titleClass, ...rest } = $props();
  let wide = $state(false);
</script>

<Dialog.Root>
  <Dialog.Content class="panel {wide ? 'is-wide' : 'is-narrow'}">
    <Dialog.Header><Dialog.Title class={titleClass}>t</Dialog.Title></Dialog.Header>
    <Dialog.Body class={['a', wide && 'b', { c: wide }]}><div {...rest}>x</div></Dialog.Body>
    <Dialog.Footer class={\`foot\`}>f</Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
`
  );

  assert.deepEqual(summary(scan()), []);
});

test('CATCHES a <style> element in markup and an {@html} that writes one', () => {
  writeFixture(
    'src/routes/markup/+page.svelte',
    `<svelte:head><style>.dialog-body { flex: none; }</style></svelte:head>
<div>{@html '<style>.dialog-footer{display:none}</style>'}</div>
<svelte:element this={'style'}>.dialog-body &#123; flex: none &#125;</svelte:element>
`
  );

  assert.deepEqual(summary(scan()), ['markup-style@1', 'markup-style@2', 'markup-style@3']);
});

test("ALLOWS the component's own <style>, other head tags, and {@html} without a <style>", () => {
  writeFixture(
    'src/routes/markup/+page.svelte',
    `<script lang="ts">
  let { html } = $props();
</script>

<svelte:head><title>T</title><meta name="x" content="y" /></svelte:head>
<div>{@html html}</div>

<style>
  .x { color: red; }
</style>
`
  );

  assert.deepEqual(summary(scan()), []);
});

test('CATCHES a class conditional or fallback that can hand a part a variable', () => {
  writeFixture(
    'src/routes/cond/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  let { cls, wide } = $props();
</script>

<Dialog.Root>
  <Dialog.Content class={wide ? cls : 'narrow'}>
    <Dialog.Body class={cls || 'body'}>b</Dialog.Body>
    <Dialog.Footer class={wide ? 'a' : cls}>f</Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
`
  );

  const result = scan();
  assert.deepEqual(summary(result), ['part-dynamic@7', 'part-dynamic@8', 'part-dynamic@9']);
  assert.match(result.violations[0].detail, /write the class as a literal, or a conditional of literals/);
});

test('ALLOWS undefined in a class: a conditional to undefined, and undefined itself', () => {
  writeFixture(
    'src/routes/cond-ok/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  let { wide } = $props();
</script>

<Dialog.Root>
  <Dialog.Content class={wide ? 'is-wide' : undefined}>
    <Dialog.Body class={undefined}>b</Dialog.Body>
    <Dialog.Footer class={wide && 'wide'}>f</Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
`
  );

  assert.deepEqual(summary(scan()), []);
});

test('CATCHES an {@attach} on a part that draws the panel', () => {
  writeFixture(
    'src/routes/attach/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content {@attach grow}>
    <Dialog.Body {@attach (n) => { n.style.flex = 'none'; }}>b</Dialog.Body>
  </Dialog.Content>
</Dialog.Root>
`
  );

  const result = scan();
  assert.deepEqual(summary(result), ['part-dynamic@6', 'part-dynamic@7']);
  assert.match(result.violations[1].detail, /takes an \{@attach\}, which gets the part's element/);
});

test('ALLOWS an {@attach} on the Title and on a page element inside a part', () => {
  writeFixture(
    'src/routes/attach-ok/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title {@attach focus}>t</Dialog.Title></Dialog.Header>
    <Dialog.Body><div {@attach measure}>b</div></Dialog.Body>
  </Dialog.Content>
</Dialog.Root>
`
  );

  assert.deepEqual(summary(scan()), []);
});

// --- part-attr -----------------------------------------------------------

test("CATCHES a page setting a part's own data attributes, or a dialog role / aria-modal on a part", () => {
  writeFixture(
    'src/routes/part-attr/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content role="alertdialog" aria-modal="true">
    <Dialog.Header data-flush><Dialog.Title>t</Dialog.Title></Dialog.Header>
    <Dialog.Toolbar data-direction="column"><input /></Dialog.Toolbar>
    <Dialog.Body data-layout="drawer">b</Dialog.Body>
    <Dialog.Footer data-align="between">f</Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
`
  );

  const result = scan();
  // The shared parts' role is part-attr's, not own-dialog's.
  assert.deepEqual(summary(result), ['part-attr@6', 'part-attr@6', 'part-attr@7', 'part-attr@8', 'part-attr@9', 'part-attr@10']);
  assert.match(result.violations[0].detail, /sets role="alertdialog"; .*for an alert dialog, use Dialog\.Root's role="alertdialog"/);
  assert.match(result.violations[4].detail, /<Dialog\.Body> sets data-layout, which the part sets itself and its CSS reads/);
});

test("ALLOWS Root's role, a test id and other roles on a part, a page element's data attributes, and Popover roles", () => {
  writeFixture(
    'src/routes/part-attr-ok/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  import * as Popover from '$lib/components/ui/Popover';
  import { Popover as P } from '$lib/components/ui';
</script>

<Dialog.Root role="alertdialog">
  <Dialog.Content data-testid="tier-dialog" aria-label="Tiers">
    <Dialog.Body id="palette-results" role="listbox" data-state="x"><div data-layout="drawer">a page element</div></Dialog.Body>
  </Dialog.Content>
</Dialog.Root>
<Popover.Content role="dialog" aria-modal="true">p</Popover.Content>
<P.Content role="dialog">q</P.Content>
`
  );

  assert.deepEqual(summary(scan()), []);
});

test('PART_DATA_ATTRS holds every data attribute the real parts set', () => {
  const dir = fileURLToPath(new URL('../src/lib/components/ui/Dialog/', import.meta.url));
  const set = new Set();
  for (const file of readdirSync(dir).filter((name) => /^Dialog\w*\.svelte$/.test(name))) {
    for (const m of readFileSync(join(dir, file), 'utf8').matchAll(/\s(data-[a-z-]+)=/g)) set.add(m[1]);
  }
  assert.ok(set.size >= 10, `read only ${set.size} data attributes from the parts`);
  assert.deepEqual([...set].filter((name) => !PART_DATA_ATTRS.has(name)), [], 'a part sets a data attribute part-attr does not know');
});

// --- own-dialog ----------------------------------------------------------

test('CATCHES role="dialog" and aria-modal outside ui/Dialog/ and ui/Popover/, and only there', () => {
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
  // Elsewhere in ui/ is no exemption: a hand-built modal there hides as well.
  writeFixture('src/lib/components/ui/Modal/Modal.svelte', '<div role="dialog" aria-modal="true"></div>\n');
  writeFixture('src/lib/components/ui/Popover/PopoverContent.svelte', '<div role="dialog" aria-modal="true"></div>\n');
  writeFixture('src/lib/components/ui/Dialog/DialogContent.svelte', '<div role="dialog" aria-modal="true"></div>\n');

  assert.deepEqual(
    scan().violations.map((v) => `${v.file} ${v.rule}@${v.line}`),
    [
      'src/lib/components/search/Palette.svelte own-dialog@5',
      'src/lib/components/search/Palette.svelte own-dialog@6',
      'src/lib/components/search/Palette.svelte own-dialog@7',
      'src/lib/components/ui/Modal/Modal.svelte own-dialog@1',
      'src/lib/components/ui/Modal/Modal.svelte own-dialog@1',
    ]
  );
});

test("CATCHES a native <dialog>, .showModal(), the popover attribute, Melt's own builders and a computed role", () => {
  writeFixture(
    'src/routes/native/+page.svelte',
    `<script lang="ts">
  import { createDialog, createPopover as pop, melt } from '@melt-ui/svelte';
  let el: HTMLDialogElement;
  let open = $state(false);
  const show = () => el.showModal();
</script>

<dialog bind:this={el}>x</dialog>
<div popover>p</div>
<div role={open ? 'dialog' : 'region'}></div>
<div role={\`alert\${'dialog'}\`}></div>
<button onclick={() => el?.showModal()}>open</button>
`
  );
  writeFixture(
    'src/lib/native.ts',
    "import { createDialog } from '@melt-ui/svelte';\nexport const open = () => document.querySelector('dialog')?.showModal();\n"
  );

  assert.deepEqual(
    scan().violations.map((v) => `${v.file} ${v.rule}@${v.line}`).sort(),
    [
      'src/lib/native.ts own-dialog@1',
      'src/lib/native.ts own-dialog@2',
      'src/routes/native/+page.svelte own-dialog@10',
      'src/routes/native/+page.svelte own-dialog@11',
      'src/routes/native/+page.svelte own-dialog@12',
      'src/routes/native/+page.svelte own-dialog@2',
      'src/routes/native/+page.svelte own-dialog@2',
      'src/routes/native/+page.svelte own-dialog@5',
      'src/routes/native/+page.svelte own-dialog@8',
      'src/routes/native/+page.svelte own-dialog@9',
    ]
  );
});

test('ALLOWS a showModal feature check, other roles, type-only and other Melt imports, and the shared parts themselves', () => {
  writeFixture(
    'src/routes/ok/+page.svelte',
    `<script lang="ts">
  import { createDropdownMenu, type CreateDialogProps, type createPopover } from '@melt-ui/svelte';
  import type { createDialog } from '@melt-ui/svelte';
  let x = $state(true);
  const supported = typeof HTMLDialogElement.prototype.showModal === 'function';
</script>

<div role={x ? 'menu' : 'listbox'} aria-label="m" popovertarget="p"></div>
`
  );
  writeFixture(
    'src/lib/ok.ts',
    "import type { CreateDialogProps, createDialog } from '@melt-ui/svelte';\nimport { type createPopover } from '@melt-ui/svelte';\nexport const can = typeof HTMLDialogElement.prototype.showModal === 'function';\n// el.showModal() in a comment is not a call\n"
  );
  writeFixture(
    'src/lib/components/ui/Popover/Popover.svelte',
    "<script lang=\"ts\">\n  import { createPopover } from '@melt-ui/svelte';\n</script>\n<div role=\"dialog\" popover></div>\n"
  );
  writeFixture(
    'src/lib/components/ui/Dialog/DialogNative.svelte',
    "<script lang=\"ts\">\n  import { createDialog } from '@melt-ui/svelte';\n  let d: HTMLDialogElement;\n</script>\n<dialog bind:this={d} onclick={() => d.showModal()}></dialog>\n"
  );

  assert.deepEqual(summary(scan()), []);
});

test('CATCHES a namespace Melt builder, a role object for a spread, {@html} and svelte:element dialogs, and an uncalled showModal', () => {
  writeFixture(
    'src/routes/own2/+page.svelte',
    `<script lang="ts">
  import * as Melt from '@melt-ui/svelte';
  let el = $state();
  const modal = { role: 'alertdialog', 'aria-modal': 'true' };
  const { elements } = Melt.createDialog();
  const open = () => HTMLDialogElement.prototype.showModal.call(el);
  const show = el?.['showModal'];
</script>

<div {...modal}>x</div>
{@html '<dialog open>x</dialog>'}
<svelte:element this={'dialog'} bind:this={el}>y</svelte:element>
<div popover="manual" role="status">Saved</div>
`
  );
  writeFixture(
    'src/lib/native2.ts',
    "import * as M from '@melt-ui/svelte';\nexport const p = M['createPopover']();\nexport const attrs = { role: 'dialog' };\nexport const fn = (d: HTMLDialogElement) => d.showModal;\n"
  );

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`).sort(),
    [
      'src/lib/native2.ts own-dialog@2',
      'src/lib/native2.ts own-dialog@3',
      'src/lib/native2.ts own-dialog@4',
      'src/routes/own2/+page.svelte own-dialog@11',
      'src/routes/own2/+page.svelte own-dialog@12',
      'src/routes/own2/+page.svelte own-dialog@13',
      'src/routes/own2/+page.svelte own-dialog@4',
      'src/routes/own2/+page.svelte own-dialog@4',
      'src/routes/own2/+page.svelte own-dialog@5',
      'src/routes/own2/+page.svelte own-dialog@6',
      'src/routes/own2/+page.svelte own-dialog@7',
    ]
  );
  assert.match(result.violations.find((v) => v.line === 13).detail, /sets the popover attribute, a hand-built popover; use the shared Popover/);
});

test("ALLOWS another Melt builder, typeof and 'in' feature checks, a role whose TEST names dialog, and other roles in objects and types", () => {
  writeFixture(
    'src/routes/own-ok/+page.svelte',
    `<script lang="ts">
  import * as Melt from '@melt-ui/svelte';
  let { mode = 'inline' } = $props();
  const { elements } = Melt.createDropdownMenu();
  const supported = typeof HTMLDialogElement.prototype.showModal === 'function';
  const alsoSupported = 'showModal' in HTMLDialogElement.prototype;
  const menu = { role: 'menu' };
</script>

<section role={mode === 'dialog' ? 'region' : 'group'} aria-label="x" {...menu}>x</section>
{@html '<p>dialog</p>'}
<svelte:element this={mode === 'dialog' ? 'section' : 'div'}>z</svelte:element>
`
  );
  writeFixture(
    'src/lib/ok2.ts',
    "export const can = typeof HTMLDialogElement.prototype.showModal === 'function';\nexport const role = { role: 'menu' };\nexport type Role = { role: 'dialog' | 'region' };\n"
  );

  assert.deepEqual(summary(scan()), []);
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
    { file: 'src/routes/known/+page.svelte', rule: 'content-child', expect: 1, reason: 'known' },
    { file: 'src/routes/fixed/+page.svelte', rule: 'content-child', expect: 1, reason: 'already fixed' },
  ];
  const result = scan(allowlist);

  assert.deepEqual(summary(result), ['own-dialog@8']);
  assert.equal(result.allowlisted, 1);
  assert.deepEqual(result.miscounted, []);
  assert.deepEqual(
    result.stale.map((a) => a.file),
    ['src/routes/fixed/+page.svelte']
  );
});

test('an ALLOWLIST entry waives exactly its `expect` count: more, fewer or unpinned fails as miscounted', () => {
  writeFixture(
    'src/routes/known/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content><form></form><section></section></Dialog.Content>
</Dialog.Root>
`
  );
  const entry = { file: 'src/routes/known/+page.svelte', rule: 'content-child', reason: 'known' };
  const miscount = (expect) => scan([{ ...entry, expect }]).miscounted.map((a) => `${a.expect}->${a.found}`);

  const exact = scan([{ ...entry, expect: 2 }]);
  assert.deepEqual([exact.violations, exact.stale, exact.miscounted, exact.allowlisted], [[], [], [], 2]);
  assert.deepEqual(miscount(1), ['1->2'], 'a new violation must not hide behind a known one');
  assert.deepEqual(miscount(3), ['3->2'], 'a fixed violation must not keep its waiver');
  assert.deepEqual(miscount(undefined), ['undefined->2'], 'an entry must state its count');
});

test('every real ALLOWLIST entry is pinned to a count and gives a reason', () => {
  for (const a of ALLOWLIST) {
    assert.ok(Number.isInteger(a.expect) && a.expect > 0, `${a.file} ${a.rule}: expect must be a positive integer`);
    assert.ok(a.reason.trim().length > 20, `${a.file} ${a.rule}: give an owner-visible reason`);
  }
});

// --- CLI -----------------------------------------------------------------

const runGate = (...args) => spawnSync(process.execPath, args, { encoding: 'utf8' });

test('the CLI exits 1 on a tree with a violation and 0 on a clean one (--root)', () => {
  writeFixture('src/routes/bad/+page.svelte', `${IMPORT}<Dialog.Root><Dialog.Content><div><Dialog.Body>x</Dialog.Body></div></Dialog.Content></Dialog.Root>\n`);
  const bad = runGate(GATE, '--root', root);
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stderr, /src\/routes\/bad\/\+page\.svelte:4 content-child: <div> is a direct child of Dialog\.Content/);

  rmSync(join(root, 'src/routes/bad'), { recursive: true });
  writeFixture('src/routes/good/+page.svelte', `${IMPORT}<Dialog.Root><Dialog.Content><Dialog.Body>x</Dialog.Body></Dialog.Content></Dialog.Root>\n`);
  const good = runGate(GATE, '--root', root);
  assert.equal(good.status, 0, good.stderr);
  // The fixture tree has none of the real tree's known exceptions.
  assert.match(good.stdout, /^OK: every Dialog in 2 file\(s\) .*\(0 known violation\(s\) allowlisted, in 0 entries\)/);

  const missing = runGate(GATE, '--root');
  assert.equal(missing.status, 2, missing.stderr);
});

test('runs main() when started through a symlinked path', () => {
  const link = join(root, 'gate-link.mjs');
  symlinkSync(GATE, link);
  writeFixture('src/routes/good/+page.svelte', `${IMPORT}<Dialog.Root><Dialog.Content><Dialog.Body>x</Dialog.Body></Dialog.Content></Dialog.Root>\n`);
  const run = runGate(link, '--root', root);

  // main() ran and passed, rather than exiting 0 unchecked with no output.
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^OK: every Dialog in 2 file\(s\)/);
});
