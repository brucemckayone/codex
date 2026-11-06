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

import { ALLOWLIST, collectViolations, LENGTH_UNITS, MATH_FUNCTIONS, PART_DATA_ATTRS } from './check-dialog-structure.mjs';

const GATE = fileURLToPath(new URL('./check-dialog-structure.mjs', import.meta.url));
// The real parts, for the tests that pin the gate's tables to them.
const REAL_DIALOG_DIR = fileURLToPath(new URL('../src/lib/components/ui/Dialog/', import.meta.url));

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
  :global(.dialog-form.faq-form) { padding-block: calc(var(--space-4) * 2) 0; margin-top: calc(-1 * var(--space-2)); gap: var(--space-2) !important; }
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

test('CATCHES a spacing value on .dialog-form.<own-class> other than 0, a space token or a calc() of those', () => {
  writeFixture(
    'src/routes/tier/+page.svelte',
    `<p>x</p>

<style>
  :global(.dialog-form.tier-form) { margin-block-end: -100dvh; }
  :global(.dialog-form.tier-form) { margin: auto; }
  :global(.dialog-form.tier-form) { padding: 10px var(--space-2); }
  :global(.dialog-form.tier-form) { gap: calc(100% - var(--space-2)); }
</style>
`
  );
  writeFixture('src/lib/styles/forms.css', '.dialog-form.x { margin-top: var(--other-token); }\n');

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`),
    [
      'src/lib/styles/forms.css global-style@1',
      'src/routes/tier/+page.svelte global-style@4',
      'src/routes/tier/+page.svelte global-style@5',
      'src/routes/tier/+page.svelte global-style@6',
      'src/routes/tier/+page.svelte global-style@7',
    ]
  );
  assert.match(
    result.violations[1].detail,
    /sets margin-block-end: -100dvh on \.dialog-form; spacing takes 0, var\(--space-\*\) or a calc\(\) of those/
  );
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

test("CATCHES a component's svelte-<hash> scoping class in a global selector, in a .svelte and a .css", () => {
  writeFixture(
    'src/routes/hash/+page.svelte',
    `<div class="x">x</div>
<style>
  :global(div.svelte-1vhe744.svelte-1vhe744) { flex: none; }
  .x :global(.svelte-abcdef) { color: red; }
</style>
`
  );
  writeFixture('src/lib/styles/hash.css', '.svelte-1vhe744 > div { overflow: visible; }\n');

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`),
    ['src/lib/styles/hash.css global-style@1', 'src/routes/hash/+page.svelte global-style@3', 'src/routes/hash/+page.svelte global-style@4']
  );
  assert.match(result.violations[1].detail, /names \.svelte-1vhe744, another component's scoping class/);
});

test('ALLOWS a class that only contains svelte-, a hyphenated svelte- name, and the hash inside ui/Dialog/', () => {
  writeFixture(
    'src/routes/hash/+page.svelte',
    `<div class="x">x</div>
<style>
  :global(.my-svelte-1vhe744) { color: red; }
  :global(.svelte-virtual-list) { height: 100%; }
</style>
`
  );
  writeFixture('src/lib/components/ui/Dialog/DialogBody.svelte', '<div class="dialog-body"><slot /></div>\n<style>\n  :global(.svelte-1vhe744) { flex: none; }\n</style>\n');

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
  :global(.wrap .my-head) { padding: 0; }
  :global(.is-narrow:hover) { overflow: hidden; }
  :global(.my-foot) { border: none; }
  :global {
    .my-body { gap: 0; }
  }
  :global(.page) {
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
  // A same-file hit names the page's own fix, and Footer's own prop.
  assert.match(
    result.violations[4].detail,
    /Dialog\.Footer through its class \.my-foot; put it on your own element inside Dialog\.Footer \(a part takes props, not utility classes; Footer's align="end" \| "between"\)/
  );
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
  /* A scoped ancestor is this file's own element; the Dialog renders in a
     portal under <body>, never inside it. */
  .wrap :global(.my-drawer) { position: fixed; }
  .page {
    :global(.my-drawer > div) { flex: none; }
  }
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
  assert.match(result.violations[1].detail, /inside Dialog\.Toolbar \(a part takes props, not utility classes; Toolbar's direction="row" \| "column"\)/);
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

test("CATCHES an expression-valued handle under ANY value test, a div/form/* subject, and a sibling walk from any part", () => {
  writeFixture(
    'src/routes/state/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content class="panel">
    <Dialog.Header class="my-head"><Dialog.Title>T</Dialog.Title></Dialog.Header>
    <Dialog.Form class="my-form">
      <Dialog.Body data-x={view} data-state={status}>b</Dialog.Body>
      <Dialog.Footer hidden={!dirty}>f</Dialog.Footer>
    </Dialog.Form>
  </Dialog.Content>
</Dialog.Root>

<style>
  :global([data-x='a']) { flex: none; }
  :global(div[data-state='open']) { overflow: visible; }
  :global(div[hidden]) { display: flex; }
  :global(.my-head + div) { flex: none; }
  :global(.my-head ~ *) { flex: none; }
  :global(form.my-form) { display: block; }
  :global(.my-form > div) { flex: none; }
  :global(div:has(> .my-head) > div) { flex: none; }
</style>
`
  );

  const result = scan();
  // An {expression} value is unknown, so it may be whatever a rule tests: 'a', 'open'.
  // @23: the parent of a Header is Content, whatever part names it.
  assert.deepEqual(summary(result), [
    'part-class@16',
    'part-class@17',
    'part-class@18',
    'part-class@19',
    'part-class@20',
    'part-class@21',
    'part-class@22',
    'part-class@23',
  ]);
  assert.match(result.violations[0].detail, /restyles Dialog\.Body through its attribute \[data-x\]/);
  assert.match(result.violations[3].detail, /walks from Dialog\.Header's class \.my-head to an element no class names/);
  assert.match(result.violations[6].detail, /walks from Dialog\.Form's class \.my-form/);
});

test('ALLOWS a subject of an element type no part renders, and a child or descendant walk from a Body, Header, Footer or Toolbar', () => {
  writeFixture(
    'src/routes/palette/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content aria-label={label}>
    <Dialog.Header class="my-head"><Dialog.Title>T</Dialog.Title></Dialog.Header>
    <Dialog.Toolbar class="tools"><input /></Dialog.Toolbar>
    <Dialog.Body class="gallery picker" role="listbox" data-state={status}>b</Dialog.Body>
    <Dialog.Footer class="my-foot" hidden={!dirty}>f</Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  :global(.gallery > div) { display: grid; }
</style>
`
  );
  // Today's rules elsewhere, each beside a plausible handle (review c3, G3-L1).
  // Below a Body, Header, Footer or Toolbar sit only the page's own elements.
  writeFixture(
    'src/lib/styles/app.css',
    [
      'media-controller[hidden] { display: none; }',
      "button[data-state='open'] { color: red; }",
      'nav[aria-label] ol { display: flex; }',
      'button[aria-label] svg { width: 1rem; }',
      '.gallery img { width: 100%; }',
      '.picker li + li { margin-top: 0; }',
      "[role='listbox'] [role='option'] { padding: 0; }",
      '.my-head > div { display: flex; }',
      '.tools div { gap: 0; }',
      '.my-foot > * { margin: 0; }',
      'section.my-foot { display: none; }',
      '',
    ].join('\n')
  );

  assert.deepEqual(summary(scan()), []);
});

/** A page whose part classes are decided by expressions with literals in every position. */
const CLASS_EXPR_PAGE = (rules) => `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  let { mode, layout, tone } = $props();
</script>

<Dialog.Root>
  <Dialog.Content class={mode === 'grid' ? 'is-grid' : 'is-list'}>
    <Dialog.Body class={{ roomy: layout === 'flex' }}>b</Dialog.Body>
    <Dialog.Footer class={['foot', tone === 'warm' && 'toned']}>f</Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
${rules}
</style>
`;

test("CATCHES a class a part's class expression can result in: a branch, an object's key, &&'s right side", () => {
  writeFixture(
    'src/routes/classes/+page.svelte',
    CLASS_EXPR_PAGE(['  :global(.is-list) { flex: none; }', '  :global(.roomy) { flex: none; }', '  :global(.toned) { flex: none; }'].join('\n'))
  );

  assert.deepEqual(summary(scan()), ['part-class@14', 'part-class@15', 'part-class@16']);
});

test("ALLOWS a literal no part's class can result in: a conditional's test, an object's value, &&'s left side", () => {
  writeFixture(
    'src/routes/classes/+page.svelte',
    CLASS_EXPR_PAGE(['  :global(.grid) { display: grid; }', '  :global(.flex) { display: flex; }', '  :global(.warm) { color: red; }'].join('\n'))
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
  :global(.wrap) :is(:global(#tier-body)) { flex: none; }
</style>
`
  );

  const result = scan();
  const tier = 'src/routes/tier/+page.svelte';
  assert.deepEqual(
    result.violations
      .filter((v) => v.file !== tier)
      .map((v) => `${v.file} ${v.rule}@${v.line}`)
      .sort(),
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
  // Each cross-file hit is told to the page that handed the part its handle, at that line.
  const echoes = result.violations.filter((v) => v.file === tier);
  assert.deepEqual(echoes.map((v) => `${v.rule}@${v.line}`).sort(), [
    ...Array(3).fill('part-class@6'),
    ...Array(9).fill('part-class@7'),
  ]);
  assert.match(
    echoes.find((v) => v.detail.includes('studio.css:1 ')).detail,
    /^Dialog\.Body's class \.studio-drawer__body is restyled from src\/lib\/styles\/studio\.css:1 \(.*\); put it on your own element inside Dialog\.Body .*, or rename it$/
  );
  // An attribute can't be renamed out of the rule's way; an id can.
  const attrEcho = echoes.find((v) => v.detail.includes('studio.css:3 ')).detail;
  assert.match(attrEcho, /\(a part takes props, not hooks for page CSS; Content's props/);
  assert.doesNotMatch(attrEcho, /rename/);
  assert.match(echoes.find((v) => v.detail.includes('studio.css:2 ')).detail, /not hooks for page CSS\), or rename it$/);
  const at = (file, line) => result.violations.find((v) => v.file.endsWith(file) && v.line === line).detail;
  assert.match(
    at('studio.css', 1),
    /restyles Dialog\.Body through its class \.studio-drawer__body \(src\/routes\/tier\/\+page\.svelte:7 hands it to Dialog\.Body\); in src\/routes\/tier\/\+page\.svelte, put it on your own element inside Dialog\.Body .*, or here give this selector's subject a class of its own$/
  );
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
      // An id no part takes makes the subject the page's own, whatever else it tests.
      "#hero[data-testid='tier-dialog'] { flex: none; }",
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

/** A page whose Body's id is built by an expression: known only by its leading text. */
const BUILT_ID_PAGE = `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  let { tier } = $props();
</script>
<Dialog.Root>
  <Dialog.Content><Dialog.Body id="tier-body-{tier.id}">b</Dialog.Body></Dialog.Content>
</Dialog.Root>
`;

test('CATCHES an id an expression builds, under any test its leading text can meet', () => {
  writeFixture('src/routes/tier/+page.svelte', BUILT_ID_PAGE);
  writeFixture(
    'src/lib/styles/tier.css',
    [
      "[id^='tier-body-'] { flex: none; }",
      '#tier-body-3 { flex: none; }',
      "[id^='tier'] { flex: none; }",
      "[id$='-3'] { flex: none; }",
      "[id*='body'] { flex: none; }",
      '',
    ].join('\n')
  );

  const result = scan();
  assert.deepEqual(
    result.violations.filter((v) => v.file.endsWith('tier.css')).map((v) => `${v.rule}@${v.line}`),
    ['part-class@1', 'part-class@2', 'part-class@3', 'part-class@4', 'part-class@5']
  );
  assert.match(result.violations[0].detail, /restyles Dialog\.Body through its id tier-body-…/);
});

test('ALLOWS an id test that leading text can never meet, and another id', () => {
  writeFixture('src/routes/tier/+page.svelte', BUILT_ID_PAGE);
  writeFixture(
    'src/lib/styles/tier.css',
    ["[id^='tier-head-'] { flex: none; }", '#tier-head-3 { flex: none; }', "[id='tier-body'] { flex: none; }", ''].join('\n')
  );

  assert.deepEqual(summary(scan()), []);
});

test('CATCHES an id known by its trailing text, and an id of literals or same-file consts', () => {
  writeFixture(
    'src/routes/palette/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  const uid = $props.id();
  const BODY_ID = 'tier-body';
  const HEAD = 'x';
  const NESTED_ID = \`\${HEAD}-body\`;
</script>
<Dialog.Root><Dialog.Content><Dialog.Body id="{uid}-results" role="listbox">a</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content><Dialog.Body id={BODY_ID}>b</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content><Dialog.Body id={'lit-body'}>c</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content><Dialog.Body id={\`tpl-body\`}>d</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content><Dialog.Body id={NESTED_ID}>e</Dialog.Body></Dialog.Content></Dialog.Root>
`
  );
  // Review c5 (G5-G-L1): the c4 fix dropped these with the empty prefix.
  writeFixture(
    'src/lib/styles/layout.css',
    [
      "[id$='-results'] { overflow: visible; }",
      "[id$='results'] { overflow: visible; }",
      "[id$='x-results'] { overflow: visible; }",
      "[id*='result'] { flex: none; }",
      '#palette-results { flex: none; }',
      "[id='a-results'] { flex: none; }",
      '#tier-body { overflow: visible; }',
      '#lit-body { overflow: visible; }',
      '#tpl-body { overflow: visible; }',
      '#x-body { overflow: visible; }',
      '',
    ].join('\n')
  );

  const result = scan();
  assert.deepEqual(
    result.violations.filter((v) => v.file.endsWith('layout.css')).map((v) => `${v.rule}@${v.line}`),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((line) => `part-class@${line}`)
  );
  assert.match(result.violations[0].detail, /restyles Dialog\.Body through its id …-results/);
});

test('CATCHES an id built inside one expression: a template, a string +, a const of either, its prefix side', () => {
  // Review c6 (G6-G-L2): an id built inside ONE expression, or a const of one.
  writeFixture(
    'src/routes/built/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  let { kind, tier }: { kind: string; tier: { id: string } } = $props();
  const uid = $props.id();
  const KILO_ID = \`\${uid}-kilo\`;
</script>
<Dialog.Root><Dialog.Content><Dialog.Body id={\`\${uid}-alpha\`}>a</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content><Dialog.Body id={uid + '-bravo'}>b</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content><Dialog.Body id={KILO_ID}>c</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content><Dialog.Body id={\`india-\${tier.id}\`}>d</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content><Dialog.Body id="{kind}-delta">e</Dialog.Body></Dialog.Content></Dialog.Root>
`
  );
  writeFixture(
    'src/lib/styles/built.css',
    [
      "[id$='-alpha'] { overflow: visible; }",
      '#tier-bravo { flex: none; }',
      '#a-kilo { flex: none; }',
      '#india-1 { flex: none; }',
      // `*=` across the unknown head (G6-G-N5): `{kind}-delta` can hold both.
      "[id*='tier-delta'] { flex: none; }",
      "[id*='r-del'] { flex: none; }",
      '',
    ].join('\n')
  );

  const result = scan();
  assert.deepEqual(
    result.violations.filter((v) => v.file.endsWith('built.css')).map((v) => `${v.rule}@${v.line}`),
    [1, 2, 3, 4, 5, 6].map((line) => `part-class@${line}`)
  );
});

test('ALLOWS an id known by its trailing text under a test of its head, and an id that is all expression', () => {
  writeFixture(
    'src/routes/palette/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  const uid = $props.id();
</script>
<Dialog.Root>
  <Dialog.Content><Dialog.Body id="{uid}-results" role="listbox">b</Dialog.Body></Dialog.Content>
</Dialog.Root>
`
  );
  writeFixture(
    'src/routes/list/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  let { listId } = $props();
</script>
<Dialog.Root>
  <Dialog.Content><Dialog.Body id={listId}>c</Dialog.Body></Dialog.Content>
</Dialog.Root>
`
  );
  // Review c4 (G4-L7): an empty leading text matched EVERY id.
  writeFixture(
    'src/lib/styles/layout.css',
    [
      '#main-content { scroll-margin-top: var(--space-16); }',
      "[id^='x'] { flex: none; }",
      "[id|='x'] { flex: none; }",
      '#x-result { flex: none; }',
      "[id*='zz'] { flex: none; }",
      "[id$=''] { flex: none; }",
      '',
    ].join('\n')
  );

  assert.deepEqual(summary(scan()), []);
});

test("CATCHES an @scope in a .svelte whose root is a part's handle, through a global rule inside it", () => {
  writeFixture(
    'src/routes/scope/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content class="tier-panel"><Dialog.Body>b</Dialog.Body></Dialog.Content>
</Dialog.Root>

<style>
  @scope (.tier-panel) {
    :global(div:not(#_)) { flex: none; }
  }
</style>
`
  );

  const result = scan();
  // Svelte emits an @scope prelude as written, unscoped: its root is global.
  assert.deepEqual(summary(result), ['part-class@11']);
  assert.match(result.violations[0].detail, /walks from Dialog\.Content's class \.tier-panel to an element no class names/);
});

test("ALLOWS a scoped rule inside a part's @scope, and a global rule inside a page's", () => {
  writeFixture(
    'src/routes/scope/+page.svelte',
    `${IMPORT}
<Dialog.Root>
  <Dialog.Content class="tier-panel"><Dialog.Body><p class="row">b</p></Dialog.Body></Dialog.Content>
</Dialog.Root>

<style>
  @scope (.tier-panel) {
    .row { gap: 0; }
    div { color: red; }
  }
  @scope (.page) {
    :global(div) { flex: none; }
  }
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
<Dialog.Root><Dialog.Content maxWidth="min(35rem, 90vw)" maxHeight="var(--container-sm)"><Dialog.Body>b</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxWidth={wide && '60rem'} maxHeight={wide ? '80dvh' : 'calc(100dvh - 4rem)'}><Dialog.Body>c</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxWidth={\`\${wide ? 60 : 40}rem\`} maxHeight="{tall ? '80dvh' : '60dvh'}"><Dialog.Body>d</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxHeight={\`\${tall ? 48 : 32}rem\`} maxWidth={undefined}><Dialog.Body>e</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxHeight={\`calc(100dvh - \${(tall ? '4rem' : '2rem') as string})\`} maxWidth={null}><Dialog.Body>f</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxHeight="{tall ? 48 : 32}rem"><Dialog.Body>g</Dialog.Body></Dialog.Content></Dialog.Root>
`
  );
  // A wrapper inside ui/Dialog/ may forward the props: its own file is the part's.
  writeFixture(
    'src/lib/components/ui/Dialog/DialogHarness.svelte',
    "<script lang=\"ts\">\n  import * as Dialog from './index';\n  let { maxHeight, maxWidth } = $props();\n</script>\n<Dialog.Root><Dialog.Content {maxHeight} {maxWidth}><Dialog.Body>h</Dialog.Body></Dialog.Content></Dialog.Root>\n"
  );
  writeFixture(
    'src/lib/components/ui/Dialog/Dialog.stories.svelte',
    "<script lang=\"ts\">\n  import * as Dialog from './index';\n</script>\n<Dialog.Root><Dialog.Content><Dialog.Body style=\"min-height: 0\" {...{}}>story</Dialog.Body></Dialog.Content></Dialog.Root>\n"
  );

  assert.deepEqual(summary(scan()), []);
});

test("CATCHES a maxHeight or maxWidth on Content that is not a CSS length: a keyword, a unitless number, a bare prop", () => {
  writeFixture(
    'src/routes/size/+page.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  let { wide } = $props();
</script>
<Dialog.Root><Dialog.Content maxHeight="none"><Dialog.Body>a</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxWidth="auto"><Dialog.Body>b</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxHeight="90"><Dialog.Body>c</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxHeight={90}><Dialog.Body>d</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxWidth={wide ? 'none' : '40rem'}><Dialog.Body>e</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxHeight><Dialog.Body>f</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxWidth={\`\${cols}\`}><Dialog.Body>g</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxHeight="{rows} none"><Dialog.Body>h</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxWidth={wide ? 'none' : width}><Dialog.Body>i</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxHeight={true}><Dialog.Body>j</Dialog.Body></Dialog.Content></Dialog.Root>
`
  );

  const result = scan();
  // @13: a known bad branch is reported as the bad value, before the unknown one.
  assert.deepEqual(summary(result), [
    'part-style@5',
    'part-style@6',
    'part-style@7',
    'part-style@8',
    'part-style@9',
    'part-style@10',
    'part-style@11',
    'part-style@12',
    'part-style@13',
    'part-style@14',
  ]);
  assert.match(result.violations[9].detail, /maxHeight="true" is not a CSS length/);
  assert.match(result.violations[0].detail, /<Dialog\.Content> maxHeight="none" is not a CSS length, so the panel loses its cap/);
  assert.match(result.violations[3].detail, /maxHeight="90" is not a CSS length/);
  assert.match(result.violations[4].detail, /maxWidth="none" is not a CSS length/);
  // A template is shown as written, its expressions as {…}.
  assert.match(result.violations[6].detail, /maxWidth="\{…\}" is not a CSS length/);
  assert.match(result.violations[7].detail, /maxHeight="\{…\} none" is not a CSS length/);
});

test("CATCHES a maxHeight or maxWidth on Content with no literal: a wrapper's forwarded prop, a variable, a member, a call", () => {
  // The review c4 case: a wrapper typed `maxHeight?: string`, used as maxHeight="none".
  writeFixture(
    'src/lib/components/BigDialog.svelte',
    `<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  let { maxHeight, size, wide, rows, offset } = $props();
  const width = '40rem';
</script>
<Dialog.Root><Dialog.Content {maxHeight}><Dialog.Body>a</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxWidth={width}><Dialog.Body>b</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxHeight={size.h}><Dialog.Body>c</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxHeight={pick(size)}><Dialog.Body>d</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxWidth={wide ? '60rem' : size.w}><Dialog.Body>e</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxHeight={size.h ?? '60dvh'}><Dialog.Body>f</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxHeight={\`\${rows * 3}rem\`}><Dialog.Body>g</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxHeight="{rows * 3}rem"><Dialog.Body>h</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxHeight={\`calc(100dvh - \${offset})\`}><Dialog.Body>i</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxWidth={\`\${size.w}rem\`}><Dialog.Body>j</Dialog.Body></Dialog.Content></Dialog.Root>
<Dialog.Root><Dialog.Content maxWidth={\`\${wide && 60}rem\`}><Dialog.Body>k</Dialog.Body></Dialog.Content></Dialog.Root>
`
  );
  writeFixture('src/routes/big/+page.svelte', `<script lang="ts">\n  import BigDialog from '$lib/components/BigDialog.svelte';\n</script>\n<BigDialog maxHeight="none" />\n`);

  const result = scan();
  // @12-16: a template whose `${}` is no literal is "NaNrem" while its prop is unset (review c5).
  assert.deepEqual(
    summary(result),
    [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((line) => `part-dynamic@${line}`)
  );
  assert.match(
    result.violations[0].detail,
    /<Dialog\.Content>'s maxHeight is not a literal, so nothing in CI can see it is a CSS length .*; write a literal length, or a conditional of literal lengths$/
  );
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

test("CATCHES an {@html} of a same-file const that holds a <style> or a <dialog>", () => {
  writeFixture(
    'src/routes/markup/+page.svelte',
    `<script lang="ts">
  const css = '<style>p { color: red; }</style>';
  const modal = \`<dialog open>x</dialog>\`;
</script>

<div>{@html css}</div>
<div>{@html modal}</div>
`
  );

  assert.deepEqual(summary(scan()), ['markup-style@6', 'own-dialog@7']);
});

test('ALLOWS an {@html} of a same-file const with neither, and a const <style> never written', () => {
  writeFixture(
    'src/routes/markup/+page.svelte',
    `<script lang="ts">
  const note = '<p>style</p>';
  const unused = '<style>p { color: red; }</style>';
</script>

<div>{@html note}</div>
`
  );

  assert.deepEqual(summary(scan()), []);
});

test('CATCHES a string naming a Dialog class as a selector: in script, a markup expression, a template, a .ts', () => {
  writeFixture(
    'src/routes/script/+page.svelte',
    `<script lang="ts">
  const body = document.querySelector('.dialog-body');
  const foot = () => document.querySelector(\`.dialog-footer > button\`);
</script>

<div {@attach (node) => { node.closest('.dialog-content').style.maxHeight = 'none'; }}>x</div>
`
  );
  writeFixture('src/lib/dom/find.ts', "export const findBody = () => document.querySelector('.dialog-body');\n");

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`),
    ['src/lib/dom/find.ts script-select@1', 'src/routes/script/+page.svelte script-select@2', 'src/routes/script/+page.svelte script-select@3', 'src/routes/script/+page.svelte script-select@6']
  );
  assert.match(result.violations[3].detail, /a string names the Dialog's \.dialog-content as a selector, so script can find the part/);
});

test("ALLOWS a Dialog class name without its dot, a longer class, a comment, page text, and the parts' own files", () => {
  writeFixture(
    'src/routes/script/+page.svelte',
    `<script lang="ts">
  // document.querySelector('.dialog-body') would find the part
  const name = 'dialog-body';
  const mine = '.my-dialog-body, .dialog-body-wrapper';
</script>

<p>Style .dialog-body only in ui/Dialog.</p>
`
  );
  writeFixture('src/lib/dom/find.ts', "/* querySelector('.dialog-body') */\nexport const cls = 'dialog-body';\n");
  writeFixture('src/lib/components/ui/Dialog/scroll-lock.ts', "export const find = (n: Element) => n.closest('.dialog-body');\n");
  writeFixture(
    'src/lib/components/ui/Dialog/DialogBody.svelte',
    "<script lang=\"ts\">\n  const sel = '.dialog-footer';\n</script>\n<div class=\"dialog-body\"><slot /></div>\n"
  );

  assert.deepEqual(summary(scan()), []);
});

test("CATCHES a selector string in a tests folder other than src/tests/, and a page's scroll through a part", () => {
  writeFixture('src/lib/tests/find.ts', "export const body = () => document.querySelector('.dialog-body');\n");
  writeFixture(
    'src/routes/err/+page.svelte',
    `<script lang="ts">
  let errorEl = $state();
  const showError = () => errorEl?.closest('.dialog-body')?.scrollTo({ top: 0 });
</script>
<div bind:this={errorEl}>x</div>
`
  );

  const result = scan();
  assert.deepEqual(
    result.violations.map((v) => `${v.file} ${v.rule}@${v.line}`),
    ['src/lib/tests/find.ts script-select@1', 'src/routes/err/+page.svelte script-select@3']
  );
  assert.match(result.violations[1].detail, /\(to bring something into view, call scrollIntoView\(\) on your own element\)$/);
});

test('ALLOWS a selector string in src/tests/ and in a story, which drive the parts and never ship', () => {
  writeFixture('src/tests/utils/dialog.ts', "export const dialogBody = () => document.querySelector<HTMLElement>('.dialog-body');\n");
  writeFixture(
    'src/tests/fixtures/Dialogs.svelte',
    "<script lang=\"ts\">\n  const body = () => document.querySelector('.dialog-body');\n</script>\n<p>x</p>\n"
  );
  writeFixture(
    'src/lib/components/studio/Thing.stories.svelte',
    `<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  const { Story } = defineMeta({ title: 'x' });
</script>
<Story name="a" play={async ({ canvasElement }) => { canvasElement.ownerDocument.querySelector('.dialog-footer button')?.click(); }} />
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
  // Each names the prop that replaces it.
  assert.match(result.violations[3].detail, /data-direction, .*Toolbar's direction="row" \| "column"/);
  assert.match(result.violations[5].detail, /data-align, .*Footer's align="end" \| "between"/);
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
<Popover.Content role="dialog" aria-modal="true" aria-label="Pick">p</Popover.Content>
<P.Content role="dialog" aria-label="Pick">q</P.Content>
`
  );

  assert.deepEqual(summary(scan()), []);
});

test('PART_DATA_ATTRS holds every data attribute the real parts set', () => {
  const dir = REAL_DIALOG_DIR;
  const set = new Set();
  for (const file of readdirSync(dir).filter((name) => /^Dialog\w*\.svelte$/.test(name))) {
    for (const m of readFileSync(join(dir, file), 'utf8').matchAll(/\s(data-[a-z-]+)=/g)) set.add(m[1]);
  }
  assert.ok(set.size >= 10, `read only ${set.size} data attributes from the parts`);
  assert.deepEqual([...set].filter((name) => !PART_DATA_ATTRS.has(name)), [], 'a part sets a data attribute part-attr does not know');
});

test("LENGTH_UNITS and MATH_FUNCTIONS are the CssLength type's own lists (ui/Dialog/css-length.ts)", () => {
  const source = readFileSync(join(REAL_DIALOG_DIR, 'css-length.ts'), 'utf8');
  const union = (name) => {
    const body = source.match(new RegExp(`type ${name} =([^;]*);`))?.[1];
    assert.ok(body, `css-length.ts has no type ${name}`);
    return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  };
  assert.deepEqual([...LENGTH_UNITS].sort(), union('LengthUnit'));
  assert.deepEqual([...MATH_FUNCTIONS].sort(), union('MathFunction'));
  // And CssLength is built from those lists, in the forms CSS_LENGTH takes:
  // a number with a unit, a math function, and a token (var(--…), never var(x)).
  assert.match(source, /`\$\{number\}\$\{LengthUnit\}`/);
  assert.match(source, /`\$\{MathFunction\}\(\$\{string\}\)`/);
  assert.match(source, /`var\(--\$\{string\}\)`/);
});

/** One Dialog per maxHeight value, a line each from line 5. */
const sizesPage = (values) =>
  `${IMPORT}\n${values.map((v) => `<Dialog.Root><Dialog.Content maxHeight="${v}"><Dialog.Body>x</Dialog.Body></Dialog.Content></Dialog.Root>`).join('\n')}\n`;

test('ALLOWS every unit and math function the CssLength type takes, and a token', () => {
  writeFixture(
    'src/routes/units/+page.svelte',
    sizesPage([...LENGTH_UNITS.map((u) => `12${u}`), '0.5rem', ...MATH_FUNCTIONS.map((f) => `${f}(100dvh - 2rem)`), 'var(--container-sm)'])
  );

  assert.deepEqual(summary(scan()), []);
});

test('CATCHES a unit, a spelling or a function the CssLength type does not take', () => {
  writeFixture('src/routes/units/+page.svelte', sizesPage(['30lh', '2in', '10PX', 'var(x)', 'fit-content(20rem)', 'attr(data-h)']));

  assert.deepEqual(summary(scan()), ['part-style@5', 'part-style@6', 'part-style@7', 'part-style@8', 'part-style@9', 'part-style@10']);
});

// --- popover-name --------------------------------------------------------

test('CATCHES a Popover.Content with no name: bare, an empty label, through the ui barrel, a named or default import, a spread', () => {
  writeFixture(
    'src/lib/components/Picker.svelte',
    `<script lang="ts">
  import * as Popover from '$lib/components/ui/Popover';
  import { Popover as P } from '$lib/components/ui';
  import { Content as PC, PopoverContent } from '$lib/components/ui/Popover';
  import Panel from '$lib/components/ui/Popover/PopoverContent.svelte';
  let { rest } = $props();
</script>
<Popover.Root>
  <Popover.Trigger>Open</Popover.Trigger>
  <Popover.Content><p>Pick a range</p></Popover.Content>
</Popover.Root>
<Popover.Content aria-label="">a</Popover.Content>
<Popover.Content aria-labelledby>b</Popover.Content>
<P.Content>c</P.Content>
<PC>d</PC>
<PopoverContent>e</PopoverContent>
<Panel>f</Panel>
<Popover.Content {...rest}>g</Popover.Content>
`
  );

  const result = scan();
  assert.deepEqual(summary(result), [
    'popover-name@10',
    'popover-name@12',
    'popover-name@13',
    'popover-name@14',
    'popover-name@15',
    'popover-name@16',
    'popover-name@17',
    'popover-name@18',
  ]);
  assert.match(result.violations[0].detail, /^<Popover\.Content> has no name: .*; give it aria-label, or aria-labelledby pointing at its heading$/);
  assert.match(result.violations[7].detail, /; a \{\.\.\.spread\} cannot be read, so write it on the tag$/);
});

test("CATCHES a Popover.Content whose name can be unset: a prop with no default, undefined, null or '', and the panel through UI.Popover or an alias", () => {
  writeFixture(
    'src/lib/components/InfoPopover.svelte',
    `<script lang="ts">
  import * as Popover from '$lib/components/ui/Popover';
  import * as UI from '$lib/components/ui';
  let { label, labelledby, wide, title = '', heading = undefined, hint = null }: Props = $props();
  const Alias = Popover.Content;
  const Panel = UI.Popover;
</script>
<Popover.Content aria-label={label}>a</Popover.Content>
<Popover.Content aria-labelledby={labelledby}>b</Popover.Content>
<Popover.Content aria-label={wide ? label : 'Info'}>c</Popover.Content>
<Popover.Content aria-label={undefined}>d</Popover.Content>
<Popover.Content aria-label={null}>e</Popover.Content>
<Popover.Content aria-label={''}>f</Popover.Content>
<Popover.Content aria-label={wide ? 'Info' : undefined}>g</Popover.Content>
<UI.Popover.Content>h</UI.Popover.Content>
<Popover.Content aria-label={title}>i</Popover.Content>
<Popover.Content aria-label={heading}>j</Popover.Content>
<Popover.Content aria-label={hint}>k</Popover.Content>
<Popover.Content aria-label={label && 'Info'}>l</Popover.Content>
<Popover.Content aria-label={label ?? ''}>m</Popover.Content>
<Popover.Content aria-label={\`\${label}\`}>n</Popover.Content>
<Popover.Content aria-label={label as string}>o</Popover.Content>
`
  );

  const result = scan();
  // @16-18: an empty default is no name either (review c6, G6-G-L1).
  // @5-6: the alias rule, so a panel can't leave the tags popover-name reads.
  assert.deepEqual(summary(result), [
    ...[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map((line) => `popover-name@${line}`),
    'alias@5',
    'alias@6',
  ]);
  assert.match(
    result.violations[0].detail,
    /^<Popover\.Content>'s name comes from a prop with no default or an empty one, .*; give the prop a non-empty default, or write the name on the tag$/
  );
  assert.match(result.violations[3].detail, /^<Popover\.Content> has no name/);
  assert.match(result.violations[16].detail, /'UI\.Popover' is read as a value; use the Popover's parts as tags only/);
});

test("ALLOWS a named Popover.Content (text, a call, a member, a prop with a default), the other Popover parts, another Content, and ui/Popover's own files", () => {
  writeFixture(
    'src/lib/components/Picker.svelte',
    `<script lang="ts">
  import * as Popover from '$lib/components/ui/Popover';
  import * as Card from '$lib/components/ui/Card';
  import * as Dialog from '$lib/components/ui/Dialog';
  import * as UI from '$lib/components/ui';
  import { m } from '$lib/paraglide/messages';
  let { label = 'Details', copy, wide, title, empty = '' } = $props();
  let open = $state(true);
  const Btn = UI.Button;
</script>
<Popover.Root>
  <Popover.Trigger>Open</Popover.Trigger>
  <Popover.Content aria-label="Pick a range"><Popover.Arrow /><Popover.Close>x</Popover.Close></Popover.Content>
</Popover.Root>
<Popover.Content aria-labelledby="range-heading"><h3 id="range-heading">Range</h3></Popover.Content>
<Popover.Content aria-label={label}>c</Popover.Content>
<Popover.Content aria-label={m.media_uses_where_title()}>d</Popover.Content>
<Popover.Content aria-label={copy.title}>e</Popover.Content>
<Popover.Content aria-label={wide ? 'Wide' : 'Narrow'}>f</Popover.Content>
<Popover.Content aria-label="Uses of {title}">g</Popover.Content>
<Popover.Content aria-label={title ?? 'Info'}>h</Popover.Content>
<Popover.Content aria-label={\`Uses of \${title}\`}>h2</Popover.Content>
<Popover.Content aria-label={empty || 'Info'}>h3</Popover.Content>
<Popover.Content aria-label={open && 'Info'}>h4</Popover.Content>
<UI.Popover.Content aria-label="Pick">i</UI.Popover.Content>
<UI.Button>j</UI.Button>
<UI.Card.Content>j2</UI.Card.Content>
<Card.Content>k</Card.Content>
<Dialog.Root><Dialog.Content><Dialog.Body>l</Dialog.Body></Dialog.Content></Dialog.Root>
`
  );
  writeFixture(
    'src/lib/components/ui/Popover/Popover.stories.svelte',
    "<script lang=\"ts\">\n  import * as Popover from './index';\n</script>\n<Popover.Content>story</Popover.Content>\n"
  );

  assert.deepEqual(summary(scan()), []);
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

test('the CLI takes --root=<dir>, and exits 2 on an empty --root= or any unknown argument', () => {
  writeFixture('src/routes/bad/+page.svelte', `${IMPORT}<Dialog.Root><Dialog.Content><div><Dialog.Body>x</Dialog.Body></div></Dialog.Content></Dialog.Root>\n`);
  const bad = runGate(GATE, `--root=${root}`);
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stderr, /src\/routes\/bad\/\+page\.svelte:4 content-child/);

  // A mistyped flag must not fall back to scanning the real tree.
  const typo = runGate(GATE, '--rot', root);
  assert.equal(typo.status, 2, typo.stderr);
  assert.match(typo.stderr, /unknown argument '--rot'/);
  const empty = runGate(GATE, '--root=');
  assert.equal(empty.status, 2, empty.stderr);
  assert.match(empty.stderr, /--root needs a directory/);
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
