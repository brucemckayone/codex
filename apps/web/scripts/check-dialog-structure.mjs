#!/usr/bin/env node
/**
 * Dialog structure gate (Codex-vlphc.1, epic Codex-2yvc8: "Modals can't
 * break: every modal goes through the shared Dialog").
 *
 * The defect class. Dialog.Content is a flex column capped at 85vh with
 * `overflow: hidden`; only Dialog.Body scrolls (`flex: 1; min-height: 0`).
 * Anything a page puts BETWEEN Content and Body breaks that chain unless it
 * repeats those two lines, and the panel then clips its own footer on a short
 * screen. The tier and FAQ dialogs shipped that way. e2e never saw it:
 * Playwright's click()/fill() scroll in code, and code scrolls through
 * `overflow: hidden`. So the rule is enforced on the SOURCE, not the screen:
 *
 *   content-child  A Dialog.Content's direct child is Dialog.Header, Toolbar,
 *                  Body, Footer or Form. Nothing else.
 *   form-child     A Dialog.Form's direct child is Dialog.Toolbar, Body or
 *                  Footer.
 *   body-place     Dialog.Body sits directly in Dialog.Content or Dialog.Form.
 *                  It is the one part that scrolls; inside Toolbar, Header,
 *                  Footer or another Body it can't, and the panel clips.
 *   form-place     Dialog.Form sits directly in Dialog.Content. In Header,
 *                  Toolbar or Footer it would carry its Body out of the
 *                  scroll chain with it.
 *   toolbar-body   A panel with a Dialog.Toolbar has a Dialog.Body. Toolbar
 *                  is `flex: none` and never scrolls, so fields stacked in it
 *                  with no Body clip the Footer.
 *   snippet-name   In a file that uses the Dialog, a snippet that is
 *                  {@render}ed has a name nothing else in the file binds
 *                  (another snippet, a snippet parameter, an {#each} or
 *                  {#await} name, a script binding). The {@render} is
 *                  resolved by name, so a shadowing name would hide what it
 *                  draws.
 *   global-style   Outside ui/Dialog/, no global rule (a `:global(...)`
 *                  selector, a `:global {}` block, any rule in a .css file,
 *                  nested rules and at-rules included, an `@scope` prelude
 *                  included) names a class or attribute the Dialog renders:
 *                  its classes (a `[class~=…]` / `[class*=…]` test that can
 *                  match a part's class counts, and CSS escapes are read
 *                  through), Melt's `data-melt-dialog-*`, `[role=dialog]`,
 *                  `[aria-modal]` and the parts' own data attributes with the
 *                  values the parts give them. Restyling the primitive from
 *                  outside is how the four hand-built drawers forked it.
 *                  One exception: a rule whose selector is exactly
 *                  `.dialog-form` plus the page's own class
 *                  (`:global(.dialog-form.tier-form)`) may set spacing (gap,
 *                  padding*, margin*) and nothing else. Bare `.dialog-form`,
 *                  a combinator, or any other property (display, flex*,
 *                  overflow*, height, position…) fails.
 *   part-class     The same restyle through a page's own handle on a part.
 *                  Every class, id and attribute ANY file hands Dialog.Content,
 *                  Header, Toolbar, Body, Footer or Form is collected first.
 *                  A global rule in any .svelte or .css file then fails when
 *                  its selector names one of those handles anywhere (inside
 *                  `:has()`, `:is()` and `:not()` too) and its subject could
 *                  be that part: the subject carries no class or id that no
 *                  part takes. So `:global(.my-body)`, `:global(#tier-body)`
 *                  and `:global(.panel > div)` fail; `:global(.panel .row)`
 *                  does not. The `.dialog-form.<own>` spacing case above is
 *                  allowed. Title and Description are exempt: their type is
 *                  the page's choice. (They are NOT harmless: they sit in
 *                  Header, which doesn't scroll, so a Header taller than the
 *                  panel still clips. That is the panel's to absorb, not a
 *                  rule a source check can state.)
 *   part-style     Outside ui/Dialog/, no part that draws the panel takes an
 *                  inline `style=` or `style:` directive: it beats every
 *                  scoped rule the part keeps its scroll chain with.
 *                  Dialog.Content's maxWidth / maxHeight props are the
 *                  sanctioned size hatches.
 *   part-dynamic   Outside ui/Dialog/, a part that draws the panel takes no
 *                  {...spread} and no {@attach}, and its class is literal
 *                  (text, string literals, a conditional or template of them,
 *                  an object's keys). A class held in a variable or a prop
 *                  can't be checked against part-class, which is how a
 *                  wrapper component would bring the forked drawer back.
 *   part-attr      Outside ui/Dialog/, no page sets a part's own attributes:
 *                  the data attributes the parts set themselves (their CSS
 *                  reads them: `data-layout="drawer"` on Body is
 *                  `display: contents`), nor role="dialog"/"alertdialog" or
 *                  aria-modal on a part (Dialog.Root's role does that).
 *   markup-style   Outside ui/Dialog/, no `<style>` element sits in markup
 *                  (`<svelte:head><style>`) and no {@html} writes one: their
 *                  rules are global and never reach this check.
 *   own-dialog     Outside ui/Dialog/ and ui/Popover/, nothing builds a modal
 *                  by hand: no role="dialog"/"alertdialog" (a conditional,
 *                  logical or template result included; the shared Dialog
 *                  and Popover parts are part-attr's), no aria-modal, no
 *                  object literal holding either for a spread, no `popover`
 *                  attribute, no `<dialog>` (as an element,
 *                  `<svelte:element>` or {@html}), no read of `showModal`
 *                  other than a `typeof` feature check, no Melt
 *                  createDialog or createPopover (named or through a
 *                  namespace import).
 *   alias          The Dialog parts are used as tags only. Reading a Dialog
 *                  binding as a value, in script or in markup
 *                  (`const C = Dialog.Content`, `{@const C = Content}`,
 *                  `<svelte:component this={Dialog.Content}>`), would hide a
 *                  part from this check, so it fails loudly instead. So do a
 *                  re-export of the module, an `import()` of it in a .svelte,
 *                  and any .ts or .js file outside ui/Dialog/ (ui/ included)
 *                  that imports it: a barrel one step away would hand its
 *                  pages an alias this check can't resolve. Type-only imports
 *                  read no value and pass.
 *   parse          A .svelte or .css file that does not parse fails loudly.
 *
 * "Direct child" looks THROUGH {#if}/{#each}/{#key}/{#await}/{#snippet}
 * blocks and <svelte:boundary> (they render no element, and a boundary's
 * `failed`/`pending` snippets render in its place), and through a
 * `{@render s()}` of a snippet declared in the same file. A {@render} of
 * anything else (a `children` prop) cannot be proven and is a violation.
 *
 * AST-based (svelte/compiler `parse`, modern AST, its CSS parser for .css
 * too), not grep: blocks nest, and the alias is RESOLVED from the file's
 * imports (`* as Dialog`, `* as Modal`, `{ Content as C }`, a default import
 * of DialogContent.svelte or `{ default as X }` from it, any $lib or
 * relative spelling, a trailing slash), so `Card.Content` or `Tabs.Content`
 * is never confused with Dialog's. The part names come from
 * ui/Dialog/index.ts itself. Tests (*.test.ts, *.spec.ts) are not shipped
 * and are not scanned.
 *
 * ALLOWLIST holds the exceptions, each with its one-line, owner-visible
 * reason and the exact number of violations it waives (`expect`). An entry
 * whose count differs FAILS the gate: a new violation can't hide behind a
 * known one, and a fixed file can't keep its waiver.
 *
 * Exported (`collectViolations`) so the node:test suite can point the same
 * scan at fixture trees; `main()` runs only as the CLI entrypoint.
 * `--root <dir>` scans `<dir>/src` instead of apps/web/src, without the
 * real tree's ALLOWLIST (the tests pin the exit status that way).
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * The exceptions. `file` is relative to apps/web; `expect` is the exact
 * number of violations of `rule` the entry waives in that file.
 */
export const ALLOWLIST = [
  {
    file: 'src/lib/components/ui/Dialog/DialogScrollControl.stories.svelte',
    rule: 'content-child',
    expect: 2,
    reason:
      'Permanent: the two calibration controls (a legacy wrapper and a raw sibling); the scroll proof must read the raw sibling CLIPPED',
  },
  {
    file: 'src/lib/page-builder/kit/blocks/gallery/GalleryLightbox.svelte',
    rule: 'own-dialog',
    expect: 2,
    reason: 'Permanent: a full-screen lightbox, a native modal that is correct as built (the model the immersive player follows)',
  },
  {
    file: 'src/lib/components/AudioPlayer/ImmersiveShaderPlayer.svelte',
    rule: 'own-dialog',
    expect: 2,
    reason: "Permanent: a full-screen player, outside the Dialog by the owner's decision",
  },
  {
    file: 'src/lib/components/ui/IntroVideoModal/IntroVideoModal.svelte',
    rule: 'own-dialog',
    expect: 2,
    reason: "Permanent: a full-screen video player, outside the Dialog by the owner's decision",
  },
];

/** Classes the Dialog family renders. Outside ui/Dialog/ none is restyled. */
const DIALOG_CLASSES = [
  'dialog-overlay',
  'dialog-content-wrapper',
  'dialog-content',
  'dialog-close',
  'dialog-header',
  'dialog-title',
  'dialog-description',
  'dialog-toolbar',
  'dialog-body',
  'dialog-form',
  'dialog-footer',
];
// A class token, not a prefix: `.dialog-content` must not match inside
// `.dialog-content-wrapper`, which is listed on its own.
const DIALOG_CLASS_RE = new RegExp(`\\.(${DIALOG_CLASSES.join('|')})(?![\\w-])`, 'g');

// The classes of the elements that draw the panel. A `[class*='-title']`
// test (org-brand.css colours headings that way) reaches only Title, whose
// type is the page's choice, so only these count for a `[class…]` test.
// The first a test matches is the one its message names.
const BOX_CLASSES = [
  'dialog-content',
  'dialog-content-wrapper',
  'dialog-header',
  'dialog-toolbar',
  'dialog-body',
  'dialog-form',
  'dialog-footer',
];

// A data attribute with the values the parts give it. `data-layout`,
// `data-variant`, `data-placement`, `data-radius` and `data-surface` are
// common words (page-builder blocks, Button, floating UI, theme tokens), so
// only the Dialog's own values count for them.
const valued = (name, values) => String.raw`${name}\s*[~|^$*]?=\s*['"]?(?:${values})(?![\w-])`;

// The attributes that reach the Dialog's elements as its classes do: Melt's,
// the dialog semantics, and the parts' own.
const DIALOG_ATTR_RE = new RegExp(
  String.raw`\[\s*(?:` +
    [
      String.raw`data-melt-dialog-[\w-]*`,
      String.raw`aria-modal`,
      String.raw`role\s*[~|^$*]?=\s*['"]?(?:alert)?dialog(?![\w-])`,
      String.raw`data-(?:flush|sheet|floating)(?![\w-])`,
      valued('data-layout', 'dialog|drawer|floating'),
      valued('data-variant', 'dialog|drawer'),
      valued('data-placement', 'top|bottom'),
      valued('data-radius', 'lg'),
      valued('data-surface', 'elevated|base|glass'),
    ].join('|') +
    ')'
);

/**
 * The data attributes the parts set on their own elements (part-attr).
 * Their CSS reads them, so a page that sets one switches on a variant.
 * Pinned against the real parts by the test suite.
 */
export const PART_DATA_ATTRS = new Set([
  'data-align',
  'data-direction',
  'data-flush',
  'data-floating',
  'data-layout',
  'data-motion',
  'data-overlay',
  'data-placement',
  'data-radius',
  'data-sheet',
  'data-size',
  'data-surface',
  'data-variant',
]);

// What a page writes instead of restyling a part from outside.
const INSTEAD =
  "style your own element inside the part, or use Content's props " +
  '(size, variant, placement, surface, radius, flush, maxWidth, maxHeight)';

// All a page may set on its own Dialog.Form class. Anything else could
// decide whether the form passes the panel's column down to Body.
const SPACING_PROP = /^(gap|row-gap|column-gap|padding(-[a-z]+)*|margin(-[a-z]+)*)$/;
// Two or more classes and nothing else: `.dialog-form` plus the page's own.
const OWN_FORM_COMPOUND = /^(?:\.[\w-]+){2,}$/;

// The parts that draw the panel, and so may not be restyled through the
// page's own class on them either (part-class), take an inline style
// (part-style) or a class this check can't read (part-dynamic). Title and
// Description are text inside a part; their type is the page's choice.
const BOX_PARTS = new Set(['Content', 'Header', 'Toolbar', 'Body', 'Footer', 'Form']);

// Attribute names that land on a part's element as written, and so are a
// handle a global rule can reach it through (part-class). The parts' own
// props (size, variant, align, direction…) are single words they consume.
const HTML_GLOBAL_ATTRS = new Set([
  'role',
  'title',
  'tabindex',
  'lang',
  'dir',
  'hidden',
  'inert',
  'translate',
  'draggable',
  'spellcheck',
  'contenteditable',
  'accesskey',
]);

/** The parts each container part may hold directly, and the rule's name. */
const CHILD_RULES = {
  Content: { rule: 'content-child', allowed: new Set(['Header', 'Toolbar', 'Body', 'Footer', 'Form']) },
  Form: { rule: 'form-child', allowed: new Set(['Toolbar', 'Body', 'Footer']) },
};

/** Where a Body and a Form may sit: their nearest part ancestor (body-place, form-place). */
const PLACEMENT = {
  Body: {
    rule: 'body-place',
    holders: new Set(['Content', 'Form']),
    why: 'only Dialog.Content or Dialog.Form may hold it, the one part that scrolls',
  },
  Form: {
    rule: 'form-place',
    holders: new Set(['Content']),
    why: 'only Dialog.Content may hold it, so its Body stays in the scroll chain',
  },
};

// Melt's builders for a modal of one's own (own-dialog).
const MODAL_BUILDERS = new Set(['createDialog', 'createPopover']);

const SCANNED_EXTS = ['.svelte', '.css', '.ts', '.js', '.mts', '.mjs', '.cts', '.cjs'];

// Tests are not shipped: what they import reaches no page.
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]s$/;

// Nodes that render no element of their own: look through to their children.
const TRANSPARENT_BLOCKS = {
  IfBlock: (n) => [n.consequent, n.alternate],
  EachBlock: (n) => [n.body, n.fallback],
  KeyBlock: (n) => [n.fragment],
  AwaitBlock: (n) => [n.pending, n.then, n.catch],
  SnippetBlock: (n) => [n.body],
  SvelteBoundary: (n) => [n.fragment],
};
// Nodes that render nothing at all.
const SILENT_NODES = new Set(['Comment', 'ConstTag', 'DebugTag', 'DeclareTag']);

// TypeScript nodes that hold a runtime expression beside a type: only that
// expression is read. Every other TS node is a type and reads no value.
const TS_VALUE_HOLDERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression',
]);

/**
 * Depth-first over a Svelte or ESTree AST. `enter(node)` returning false
 * skips that node's children.
 */
function walk(node, enter) {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, enter);
  } else if (node && typeof node.type === 'string' && enter(node) !== false) {
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'metadata' && value && typeof value === 'object') walk(value, enter);
    }
  }
}

function walkFiles(dir, exts, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'paraglide') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, exts, files);
    else if (exts.some((ext) => entry.name.endsWith(ext))) files.push(full);
  }
  return files;
}

/** Is `candidate` the directory `dir` itself, or anything beneath it? */
function isInside(dir, candidate) {
  const rel = relative(dir, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function lineOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** `./DialogContent.svelte` -> `Content`, read from ui/Dialog/index.ts. */
function readPartFiles(dialogDir) {
  const index = join(dialogDir, 'index.ts');
  if (!existsSync(index)) {
    throw new Error(`Dialog structure gate: ${index} does not exist, so the Dialog parts are unknown.`);
  }
  const parts = new Map();
  for (const m of readFileSync(index, 'utf8').matchAll(/import\s+(\w+)\s+from\s+['"]\.\/(\w+)\.svelte['"]/g)) {
    parts.set(m[2], m[1]);
  }
  if (parts.size === 0) throw new Error(`Dialog structure gate: no parts found in ${index}.`);
  return parts;
}

/** The file or directory an import specifier names, without index/extension, or null. */
function specifierTarget(importer, spec, ctx) {
  // A trailing separator names the same directory: '…/ui/Dialog/' is the module.
  const clean = spec.replace(/\/+$/, '');
  let target;
  if (clean === '$lib' || clean.startsWith('$lib/')) target = join(ctx.libRoot, clean.slice(4));
  else if (clean.startsWith('.')) target = resolve(dirname(importer), clean);
  else return null;
  return target.replace(/\/index(\.(ts|js))?$/, '').replace(/\.(ts|js)$/, '');
}

/**
 * Where an import specifier points, as a Dialog binding: the module itself
 * (`{ module: true }`), one part's file (`{ part }`), or null.
 */
function resolveSpecifier(importer, spec, ctx) {
  const target = specifierTarget(importer, spec, ctx);
  if (!target) return null;
  if (target === ctx.dialogDir) return { module: true };
  if (dirname(target) === ctx.dialogDir && target.endsWith('.svelte')) {
    const part = ctx.partFiles.get(target.slice(ctx.dialogDir.length + 1, -'.svelte'.length));
    return part ? { part } : null;
  }
  return null;
}

const reexportDetail = (spec) =>
  `re-exports the Dialog module ('${spec}'), which hides it from this check; import it from $lib/components/ui/Dialog directly`;

/** One import's bindings: local name -> { namespace: true } | { part }. */
function bindImport(stmt, target, bindings) {
  for (const s of stmt.specifiers) {
    if (s.importKind === 'type') continue;
    const imported = s.imported?.name ?? s.imported?.value;
    if (s.type === 'ImportNamespaceSpecifier' && target.module) {
      bindings.set(s.local.name, { namespace: true });
    } else if (s.type === 'ImportSpecifier' && target.module) {
      bindings.set(s.local.name, { part: imported });
    } else if (target.part && (s.type === 'ImportDefaultSpecifier' || imported === 'default')) {
      bindings.set(s.local.name, { part: target.part });
    }
  }
}

/**
 * Local name -> Dialog binding for one file. Any other statement with a
 * `source` that reaches the Dialog is a re-export, which fails loudly.
 * Type-only statements bind no value and are skipped.
 */
function collectBindings(file, programs, ctx, report) {
  const bindings = new Map();
  for (const stmt of programs.flatMap((program) => program.body)) {
    if (stmt.importKind === 'type' || stmt.exportKind === 'type') continue;
    const target = stmt.source ? resolveSpecifier(file, stmt.source.value, ctx) : null;
    if (!target) continue;
    if (stmt.type === 'ImportDeclaration') bindImport(stmt, target, bindings);
    else report(stmt.start, 'alias', reexportDetail(stmt.source.value));
  }
  return bindings;
}

/** The local names a file binds to the shared Popover: namespaces and parts. */
function collectPopoverNames(file, programs, ctx) {
  const names = { namespaces: new Set(), parts: new Set() };
  for (const stmt of programs.flatMap((program) => program.body)) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const target = specifierTarget(file, stmt.source.value, ctx);
    if (!target) continue;
    const popover = target === ctx.popoverDir || dirname(target) === ctx.popoverDir;
    for (const s of stmt.specifiers) {
      const imported = s.imported?.name ?? s.imported?.value;
      if (popover) (s.type === 'ImportNamespaceSpecifier' ? names.namespaces : names.parts).add(s.local.name);
      // The ui barrel re-exports the module as `Popover`.
      else if (target === ctx.uiDir && imported === 'Popover') names.namespaces.add(s.local.name);
    }
  }
  return names;
}

function isPopoverPart(node, popover) {
  if (node.type !== 'Component') return false;
  const dot = node.name.indexOf('.');
  return dot === -1 ? popover.parts.has(node.name) : popover.namespaces.has(node.name.slice(0, dot));
}

/** Whether an Identifier under `parent[key]` names something, rather than reads it. */
function isNameOnly(parent, key) {
  if (!parent) return false;
  if (parent.type === 'MemberExpression' && key === 'property') return !parent.computed;
  const keyed = parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition';
  return keyed && key === 'key' && !parent.computed && !parent.shorthand;
}

/**
 * alias: a read of a Dialog binding as a VALUE, in script or in a markup
 * expression, can hand a part to something this check cannot see. Type
 * positions read no value; tag names are not expressions.
 */
function checkValueReads(roots, bindings, report) {
  if (bindings.size === 0) return;
  const visit = (node, parent, key) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parent, key);
      return;
    }
    if (!node || typeof node.type !== 'string' || node.type === 'ImportDeclaration') return;
    if (node.type.startsWith('TS')) {
      if (TS_VALUE_HOLDERS.has(node.type)) visit(node.expression, node, 'expression');
      return;
    }
    if (node.type === 'Identifier' && bindings.has(node.name) && !isNameOnly(parent, key)) {
      report(node.start, 'alias', `'${node.name}' is read as a value; use the Dialog's parts as tags only`);
    }
    for (const [k, value] of Object.entries(node)) {
      if (k !== 'metadata' && value && typeof value === 'object') visit(value, node, k);
    }
  };
  for (const root of roots) visit(root, null, null);
}

/** alias: an `import()` of the Dialog in a .svelte hands back parts no import resolves. */
function checkDynamicImports(roots, file, ctx, report) {
  walk(roots, (node) => {
    if (node.type !== 'ImportExpression') return;
    const { source } = node;
    const spec =
      source.type === 'Literal'
        ? source.value
        : source.type === 'TemplateLiteral' && source.expressions.length === 0
          ? source.quasis[0].value.cooked
          : null;
    if (typeof spec === 'string' && resolveSpecifier(file, spec, ctx)) {
      report(
        node.start,
        'alias',
        `import('${spec}') loads the Dialog at run time, and what it hands back this check cannot follow; import it statically from $lib/components/ui/Dialog`
      );
    }
  });
}

/** The Dialog part an expression names (`Dialog.Content`, a named `Content`), or null. */
function partOfExpression(expr, bindings) {
  if (expr?.type === 'Identifier') return bindings.get(expr.name)?.part ?? null;
  if (expr?.type !== 'MemberExpression' || expr.computed || expr.object.type !== 'Identifier') return null;
  return bindings.get(expr.object.name)?.namespace ? expr.property.name : null;
}

/** The Dialog part a markup node renders, or null. */
function partOf(node, bindings) {
  if (node.type === 'SvelteComponent') return partOfExpression(node.expression, bindings);
  if (node.type !== 'Component') return null;
  const dot = node.name.indexOf('.');
  if (dot === -1) return bindings.get(node.name)?.part ?? null;
  const ns = bindings.get(node.name.slice(0, dot));
  return ns?.namespace ? node.name.slice(dot + 1) : null;
}

function collectSnippets(fragment) {
  const snippets = new Map();
  walk(fragment, (node) => {
    if (node.type === 'SnippetBlock' && !snippets.has(node.expression.name)) {
      snippets.set(node.expression.name, node);
    }
  });
  return snippets;
}

function renderCallee(tag) {
  let call = tag.expression;
  if (call.type === 'ChainExpression') call = call.expression;
  return call.type === 'CallExpression' && call.callee.type === 'Identifier' ? call.callee.name : null;
}

/**
 * The snippets a <svelte:boundary> renders in its own place: its `failed`
 * and `pending` attributes, by name when they name one.
 */
function boundaryRenders(node) {
  const sites = [];
  for (const attr of node.attributes ?? []) {
    if (attr.type !== 'Attribute' || (attr.name !== 'failed' && attr.name !== 'pending')) continue;
    const value = Array.isArray(attr.value) ? attr.value[0] : attr.value;
    const expr = value?.type === 'ExpressionTag' ? value.expression : null;
    sites.push({ name: expr?.type === 'Identifier' ? expr.name : null, at: attr });
  }
  return sites;
}

/**
 * Every node a parent renders as a direct child, looking through blocks and
 * through `{@render}` of a local snippet. Calls `onUnknown` for a render it
 * cannot follow.
 */
function* directChildren(fragment, snippets, onUnknown, seen = new Set()) {
  for (const node of fragment?.nodes ?? []) {
    if (TRANSPARENT_BLOCKS[node.type]) {
      for (const inner of TRANSPARENT_BLOCKS[node.type](node)) {
        yield* directChildren(inner, snippets, onUnknown, seen);
      }
      if (node.type === 'SvelteBoundary') {
        for (const { name, at } of boundaryRenders(node)) yield* renderedChildren(name, at, snippets, onUnknown, seen);
      }
    } else if (node.type === 'RenderTag') {
      yield* renderedChildren(renderCallee(node), node, snippets, onUnknown, seen);
    } else if (rendersSomething(node)) {
      yield node;
    }
  }
}

/** A local snippet's top level, as if written in place of its render site `at`. */
function* renderedChildren(name, at, snippets, onUnknown, seen) {
  const snippet = name && snippets.get(name);
  if (!snippet) onUnknown(at, name);
  else if (!seen.has(snippet)) {
    yield* directChildren(snippet.body, snippets, onUnknown, new Set([...seen, snippet]));
  }
}

function rendersSomething(node) {
  if (node.type === 'Text') return node.data.trim() !== '';
  return !SILENT_NODES.has(node.type);
}

function describe(node) {
  if (node.type === 'Text') return 'text';
  if (node.type === 'ExpressionTag') return '{expression}';
  if (node.type === 'HtmlTag') return '{@html}';
  return node.name ? `<${node.name}>` : node.type;
}

/** content-child / form-child for one Dialog.Content or Dialog.Form node. */
function checkChildren(node, part, { bindings, snippets, report }) {
  const { rule, allowed } = CHILD_RULES[part];
  const want = [...allowed].map((p) => `Dialog.${p}`).join(' / ');
  const onUnknown = (tag, name) =>
    report(tag.start, rule, `{@render ${name ?? '…'}()} directly in Dialog.${part} renders what this check cannot see`);
  for (const child of directChildren(node.fragment, snippets, onUnknown)) {
    if (allowed.has(partOf(child, bindings))) continue;
    // A Text node starts at the whitespace before its words.
    const at = child.type === 'Text' ? child.start + child.data.search(/\S/) : child.start;
    report(at, rule, `${describe(child)} is a direct child of Dialog.${part}; only ${want}`);
  }
}

/**
 * toolbar-body for one Dialog.Content: a Toolbar there, or in its Form,
 * needs a Body beside it. A render this check can't follow may hold the
 * Body; content-child reports that render already.
 */
function checkToolbarHasBody(node, { bindings, snippets, report }) {
  const parts = [];
  let unknown = false;
  const collect = (fragment) => {
    for (const child of directChildren(fragment, snippets, () => (unknown = true))) {
      const part = partOf(child, bindings);
      parts.push({ part, child });
      if (part === 'Form') collect(child.fragment);
    }
  };
  collect(node.fragment);
  const toolbar = parts.find((p) => p.part === 'Toolbar');
  if (toolbar && !unknown && !parts.some((p) => p.part === 'Body')) {
    report(
      toolbar.child.start,
      'toolbar-body',
      'Dialog.Toolbar never scrolls (flex: none) and this panel has no Dialog.Body to scroll instead; put the content in a Body'
    );
  }
}

/**
 * body-place and form-place: each Dialog.Body's (Form's) nearest part
 * ancestor is one PLACEMENT allows. A part at a snippet's top level takes
 * the parts its render sites sit in; a snippet rendered nowhere in this
 * file (passed to a component) can't be proven. A raw element between
 * Content and Body is content-child's.
 */
function checkPlacement(fragment, { bindings, report }) {
  const renders = new Map();
  const placed = [];
  const addRender = (name, holder) => renders.set(name, [...(renders.get(name) ?? []), holder]);
  const visit = (nodes, holder) => {
    for (const node of nodes ?? []) {
      if (node.type === 'SnippetBlock') {
        visit(node.body.nodes, { snippet: node.expression.name });
      } else if (TRANSPARENT_BLOCKS[node.type]) {
        for (const inner of TRANSPARENT_BLOCKS[node.type](node)) visit(inner?.nodes, holder);
        if (node.type === 'SvelteBoundary') {
          for (const { name } of boundaryRenders(node)) if (name) addRender(name, holder);
          // `{#snippet failed()}` / `{#snippet pending()}` inside it render in its place too.
          for (const child of node.fragment.nodes) {
            if (child.type === 'SnippetBlock' && /^(failed|pending)$/.test(child.expression.name)) {
              addRender(child.expression.name, holder);
            }
          }
        }
      } else if (node.type === 'RenderTag') {
        const name = renderCallee(node);
        if (name) addRender(name, holder);
      } else {
        const part = partOf(node, bindings);
        if (PLACEMENT[part]) placed.push({ node, part, holder });
        if (node.fragment) visit(node.fragment.nodes, part ? { part } : holder);
      }
    }
  };
  visit(fragment.nodes, { top: true });

  const allowed = (holders, holder, seen) => {
    if (holder.part) return holders.has(holder.part);
    if (!holder.snippet) return false;
    if (seen.has(holder.snippet)) return true;
    const sites = renders.get(holder.snippet) ?? [];
    const next = new Set([...seen, holder.snippet]);
    return sites.length > 0 && sites.every((site) => allowed(holders, site, next));
  };
  const where = (holder) =>
    holder.part ? `in Dialog.${holder.part}` : holder.snippet ? `in snippet ${holder.snippet}()` : 'outside any Dialog.Content';
  for (const { node, part, holder } of placed) {
    const { rule, holders, why } = PLACEMENT[part];
    if (!allowed(holders, holder, new Set())) report(node.start, rule, `${describe(node)} sits ${where(holder)}; ${why}`);
  }
}

/** The identifiers a binding pattern declares. */
function patternNames(pattern) {
  switch (pattern?.type) {
    case 'Identifier':
      return [pattern.name];
    case 'ObjectPattern':
      return pattern.properties.flatMap((p) => patternNames(p.type === 'RestElement' ? p.argument : p.value));
    case 'ArrayPattern':
      return pattern.elements.flatMap(patternNames);
    case 'RestElement':
      return patternNames(pattern.argument);
    case 'AssignmentPattern':
      return patternNames(pattern.left);
    default:
      return [];
  }
}

/** The names a script statement declares at its top level. */
function declaredNames(stmt) {
  switch (stmt?.type) {
    case 'ImportDeclaration':
      return stmt.specifiers.map((s) => s.local.name);
    case 'VariableDeclaration':
      return stmt.declarations.flatMap((d) => patternNames(d.id));
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      return stmt.id ? [stmt.id.name] : [];
    case 'ExportNamedDeclaration':
    case 'ExportDefaultDeclaration':
      return declaredNames(stmt.declaration);
    default:
      return [];
  }
}

/**
 * snippet-name: a {@render}ed snippet's name is bound once in the file.
 * The check resolves `{@render body()}` by name, so a second `body` (a
 * snippet, a parameter, an each/await/const name, a script binding) could
 * be what actually renders.
 */
function checkSnippetNames(ast, programs, report) {
  const rendered = new Set();
  const bound = new Map();
  const bind = (names) => {
    for (const name of names) bound.set(name, (bound.get(name) ?? 0) + 1);
  };
  bind(programs.flatMap((program) => program.body.flatMap(declaredNames)));
  walk(ast.fragment, (node) => {
    if (node.type === 'RenderTag' && renderCallee(node)) rendered.add(renderCallee(node));
    if (node.type === 'SvelteBoundary') for (const { name } of boundaryRenders(node)) if (name) rendered.add(name);
    if (node.type === 'SnippetBlock') bind([node.expression.name, ...node.parameters.flatMap(patternNames)]);
    if (node.type === 'EachBlock') bind([...patternNames(node.context), ...(node.index ? [node.index] : [])]);
    if (node.type === 'AwaitBlock') bind([...patternNames(node.value), ...patternNames(node.error)]);
    if (node.type === 'ConstTag') bind(node.declaration.declarations.flatMap((d) => patternNames(d.id)));
  });
  walk(ast.fragment, (node) => {
    if (node.type !== 'SnippetBlock') return;
    const { name } = node.expression;
    if (rendered.has(name) && bound.get(name) > 1) {
      report(
        node.start,
        'snippet-name',
        `{#snippet ${name}()} shares its name with another binding in this file, so which one {@render ${name}()} draws can't be read; give the snippet a name of its own`
      );
    }
  });
}

function checkMarkup(ast, programs, bindings, report) {
  const scope = { bindings, snippets: collectSnippets(ast.fragment), report };
  walk(ast.fragment, (node) => {
    const part = partOf(node, bindings);
    if (CHILD_RULES[part]) checkChildren(node, part, scope);
    if (part === 'Content') checkToolbarHasBody(node, scope);
  });
  checkPlacement(ast.fragment, scope);
  if (bindings.size > 0) checkSnippetNames(ast, programs, report);
}

/** Every string literal and template text in an expression. */
function literalStrings(expr) {
  const out = [];
  walk(expr, (node) => {
    if (node.type === 'Literal' && typeof node.value === 'string') out.push(node.value);
    if (node.type === 'TemplateElement') out.push(node.value.cooked ?? node.value.raw);
  });
  return out;
}

/**
 * The strings an expression can evaluate to, as far as its literals show:
 * a conditional's branches and a logical's operands, never a test or an
 * argument. A template contributes its text joined, and its parts.
 */
function resultStrings(expr) {
  switch (expr?.type) {
    case 'Literal':
      return typeof expr.value === 'string' ? [expr.value] : [];
    case 'TemplateLiteral':
      return [expr.quasis.map((q) => q.value.cooked ?? q.value.raw).join(''), ...expr.expressions.flatMap(resultStrings)];
    case 'ConditionalExpression':
      return [...resultStrings(expr.consequent), ...resultStrings(expr.alternate)];
    case 'LogicalExpression':
      return [...resultStrings(expr.left), ...resultStrings(expr.right)];
    default:
      return TS_VALUE_HOLDERS.has(expr?.type) ? resultStrings(expr.expression) : [];
  }
}

/** Each text an attribute can hold: its static text and each result of its expressions. */
function attrStrings(attr) {
  if (attr.value === true) return [];
  const out = [];
  for (const part of Array.isArray(attr.value) ? attr.value : [attr.value]) {
    if (part.type === 'Text') out.push(part.data);
    else out.push(...resultStrings(part.expression));
  }
  return out;
}

const dialogRole = (strings) => strings.map((s) => s.match(/\b(?:alert)?dialog\b/)?.[0]).find(Boolean);

/** What a hand-built modal attribute claims, or null. */
function ownDialogAttr(attr) {
  if (attr.type !== 'Attribute') return null;
  if (attr.name === 'aria-modal') return 'aria-modal';
  if (attr.name === 'popover') return 'the popover attribute';
  if (attr.name !== 'role') return null;
  const role = dialogRole(attrStrings(attr));
  return role ? `role="${role}"` : null;
}

/** What an object literal property claims for a spread onto an element, or null. */
function ownDialogProperty(prop) {
  if (prop.type !== 'Property' || (prop.computed && prop.key.type !== 'Literal')) return null;
  const key = prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value);
  if (key === 'aria-modal') return 'aria-modal';
  const role = key === 'role' ? dialogRole(resultStrings(prop.value)) : null;
  return role ? `role: '${role}'` : null;
}

/** `x.showModal`, `x?.showModal` or `x['showModal']`: called, or handed on. */
function isShowModalRead(node) {
  if (node.type !== 'MemberExpression') return false;
  const { property, computed } = node;
  return computed ? property.type === 'Literal' && property.value === 'showModal' : property.name === 'showModal';
}

const SHOW_MODAL_DETAIL =
  'reads showModal, which opens a hand-built native modal; build the modal from Dialog.Root/Content ' +
  "(a feature check is `typeof … .showModal === 'function'`)";
const meltDetail = (name) => `uses Melt's ${name}, a modal of its own; build it from the shared Dialog or Popover`;

function checkOwnDialog(ast, programs, bindings, popover, report) {
  walk(ast.fragment, (node) => {
    if (node.type === 'RegularElement' && node.name === 'dialog') {
      report(node.start, 'own-dialog', '<dialog> is a hand-built modal; build the modal from Dialog.Root/Content');
    }
    if (node.type === 'SvelteElement' && resultStrings(node.tag).some((s) => s.trim() === 'dialog')) {
      report(node.start, 'own-dialog', '<svelte:element this="dialog"> is a hand-built modal; build the modal from Dialog.Root/Content');
    }
    if (node.type === 'HtmlTag' && literalStrings(node.expression).some((s) => /<dialog\b/i.test(s))) {
      report(node.start, 'own-dialog', '{@html} writes a <dialog>, a hand-built modal; build the modal from Dialog.Root/Content');
    }
    // The shared parts are part-attr's to judge.
    if (!Array.isArray(node.attributes) || partOf(node, bindings) || isPopoverPart(node, popover)) return;
    for (const attr of node.attributes) {
      const claim = ownDialogAttr(attr);
      if (!claim) continue;
      const instead =
        claim === 'the popover attribute' ? ', a hand-built popover; use the shared Popover' : '; build the modal from Dialog.Root/Content';
      report(attr.start, 'own-dialog', `${describe(node)} sets ${claim}${instead}`);
    }
  });

  const meltNamespaces = new Set();
  const typeofArgs = new Set();
  for (const root of [...programs, ast.fragment]) {
    walk(root, (node) => {
      if (node.type === 'UnaryExpression' && node.operator === 'typeof') typeofArgs.add(node.argument);
      if (node.type !== 'ImportDeclaration' || node.source.value !== '@melt-ui/svelte' || node.importKind === 'type') return;
      for (const s of node.specifiers) {
        const name = s.imported?.name ?? s.imported?.value;
        if (s.type === 'ImportNamespaceSpecifier') meltNamespaces.add(s.local.name);
        if (s.type === 'ImportSpecifier' && s.importKind !== 'type' && MODAL_BUILDERS.has(name)) {
          report(s.start, 'own-dialog', meltDetail(name));
        }
      }
    });
  }
  for (const root of [...programs, ast.fragment]) {
    walk(root, (node) => {
      if (isShowModalRead(node) && !typeofArgs.has(node)) report(node.start, 'own-dialog', SHOW_MODAL_DETAIL);
      if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && meltNamespaces.has(node.object.name)) {
        const name = node.computed ? node.property.value : node.property.name;
        if (MODAL_BUILDERS.has(name)) report(node.start, 'own-dialog', meltDetail(name));
      }
      if (node.type === 'ObjectExpression') {
        for (const prop of node.properties) {
          const claim = ownDialogProperty(prop);
          if (claim) {
            report(prop.start, 'own-dialog', `an object sets ${claim}, a hand-built modal once spread; build the modal from Dialog.Root/Content`);
          }
        }
      }
    });
  }
}

/** part-style, part-dynamic and part-attr: what a part may be handed. */
function checkPartAttributes(fragment, bindings, report) {
  walk(fragment, (node) => {
    const part = partOf(node, bindings);
    if (!part || part === 'Root') return;
    for (const attr of node.attributes ?? []) {
      const role = attr.type === 'Attribute' && attr.name === 'role' ? dialogRole(attrStrings(attr)) : null;
      if (role || (attr.type === 'Attribute' && attr.name === 'aria-modal')) {
        report(
          attr.start,
          'part-attr',
          `${describe(node)} sets ${role ? `role="${role}"` : 'aria-modal'}; the shared Dialog sets its role and aria-modal itself: for an alert dialog, use Dialog.Root's role="alertdialog"`
        );
      }
      if (!BOX_PARTS.has(part)) continue;
      if (attr.type === 'Attribute' && PART_DATA_ATTRS.has(attr.name)) {
        report(
          attr.start,
          'part-attr',
          `${describe(node)} sets ${attr.name}, which the part sets itself and its CSS reads; use Content's props (variant, flush, placement…) instead`
        );
      } else if ((attr.type === 'Attribute' && attr.name === 'style') || attr.type === 'StyleDirective') {
        report(
          attr.start,
          'part-style',
          `${describe(node)} takes an inline style, which beats the rules that keep its scroll chain; Content's maxWidth / maxHeight props are the sanctioned size hatches`
        );
      } else if (attr.type === 'SpreadAttribute') {
        report(
          attr.start,
          'part-dynamic',
          `${describe(node)} takes a {...spread}, which can hand it a class or style this check cannot read; write each attribute out`
        );
      } else if (attr.type === 'AttachTag') {
        report(
          attr.start,
          'part-dynamic',
          `${describe(node)} takes an {@attach}, which gets the part's element and can restyle it; attach to your own element inside the part`
        );
      } else if (attr.type === 'Attribute' && attr.name === 'class' && !isLiteralClass(attr)) {
        report(
          attr.start,
          'part-dynamic',
          `${describe(node)}'s class is not a literal, so what it hands the part cannot be checked; write the class as a literal, or a conditional of literals`
        );
      }
    }
  });
}

function isLiteralClass(attr) {
  if (attr.value === true) return true;
  const parts = Array.isArray(attr.value) ? attr.value : [attr.value];
  return parts.every((part) => part.type === 'Text' || literalClassValue(part.expression));
}

/** Whether a class expression can produce only classes written in it. */
function literalClassValue(expr) {
  switch (expr?.type) {
    case 'Literal':
      return expr.value === null || typeof expr.value === 'string' || typeof expr.value === 'boolean';
    case 'Identifier':
      return expr.name === 'undefined';
    case 'TemplateLiteral':
      return expr.expressions.every(literalClassValue);
    case 'ConditionalExpression':
      return literalClassValue(expr.consequent) && literalClassValue(expr.alternate);
    case 'LogicalExpression':
      return expr.operator === '&&' ? literalClassValue(expr.right) : literalClassValue(expr.left) && literalClassValue(expr.right);
    case 'ArrayExpression':
      return expr.elements.every((e) => e && e.type !== 'SpreadElement' && literalClassValue(e));
    case 'ObjectExpression':
      return expr.properties.every((p) => p.type === 'Property' && !p.computed);
    default:
      return false;
  }
}

/** markup-style: global CSS written where this check never parses it. */
function checkMarkupStyle(fragment, report) {
  walk(fragment, (node) => {
    const isStyle =
      (node.type === 'RegularElement' && node.name === 'style') ||
      (node.type === 'SvelteElement' && resultStrings(node.tag).some((s) => s.trim() === 'style'));
    if (isStyle) {
      report(node.start, 'markup-style', "<style> in markup is global CSS this check never parses; use the component's own <style>");
    } else if (node.type === 'HtmlTag' && literalStrings(node.expression).some((s) => /<style\b/i.test(s))) {
      report(node.start, 'markup-style', "{@html} writes a <style> element, global CSS this check never parses; use the component's own <style>");
    }
  });
}

/**
 * Split at the top level of a selector: never inside (), [] or a string.
 * `isSplit(char)` names the separators; runs of them yield no empty parts.
 */
function splitTop(text, isSplit) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && isSplit(c)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const selectorList = (prelude) => splitTop(prelude, (c) => c === ',');
const compounds = (selector) => splitTop(selector, (c) => /[\s>+~]/.test(c));
const squash = (text) => text.replace(/\s+/g, ' ').trim();

/** The index just past the `)` that closes the `(` at `open`, or -1. */
function closeParen(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

/** One selector with `:global(...)` / `:global` unwrapped, at any depth. */
function unwrapGlobal(selector) {
  let out = selector;
  for (let at = out.indexOf(':global('); at !== -1; at = out.indexOf(':global(')) {
    const end = closeParen(out, at + ':global'.length);
    if (end === -1) break;
    out = out.slice(0, at) + out.slice(at + ':global('.length, end - 1) + out.slice(end);
  }
  return out.replace(/:global\b/g, ' ').trim();
}

/** Each selector in a list, with `:global(...)` / `:global` unwrapped. */
function selectors(prelude) {
  return selectorList(prelude).map(unwrapGlobal);
}

/** A compound without its functional pseudo-classes (`:not(…)`, `:has(…)`, `:nth-child(… of …)`). */
function withoutFunctional(compound) {
  let out = compound;
  for (let m = out.match(/::?[\w-]+\(/); m; m = out.match(/::?[\w-]+\(/)) {
    const end = closeParen(out, m.index + m[0].length - 1);
    if (end === -1) break;
    out = out.slice(0, m.index) + out.slice(end);
  }
  return out;
}

/**
 * A selector with each top-level `:is()` / `:where()` replaced by each of
 * its alternatives, so `.x > :is(.a, div)` is judged as `.x > .a` and
 * `.x > div`. Inside `:global(…)` they are not top level; unwrap first.
 */
function alternatives(selector, budget = 64) {
  for (const m of selector.matchAll(/:(?:is|where|matches|any|-webkit-any)\(/g)) {
    // Only at the top level: not inside another function's parentheses.
    let depth = 0;
    for (let i = 0; i < m.index; i++) depth += selector[i] === '(' ? 1 : selector[i] === ')' ? -1 : 0;
    if (depth !== 0) continue;
    const open = m.index + m[0].length - 1;
    const end = closeParen(selector, open);
    const options = end === -1 ? [] : selectorList(selector.slice(open + 1, end - 1));
    if (options.length === 0) return [selector];
    const out = [];
    for (const option of options) {
      for (const variant of alternatives(`${selector.slice(0, m.index)}${option}${selector.slice(end)}`, budget)) {
        if (out.length >= budget) return [selector, ...out];
        out.push(variant);
      }
    }
    return out;
  }
  return [selector];
}

/** A CSS text with its escapes resolved, so `.dialog\-body` reads as `.dialog-body`. */
function cssUnescape(text) {
  return text.replace(/\\([0-9a-fA-F]{1,6})\s?|\\([^\n])/g, (_, hex, char) => {
    if (char !== undefined) return char;
    const point = Number.parseInt(hex, 16);
    return point === 0 || point > 0x10ffff ? '�' : String.fromCodePoint(point);
  });
}

const ATTR_SELECTOR = /\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([\w-]+)))?\s*(?:[iIsS]\s*)?\]/g;

/** The classes, ids and attribute tests a selector text names. */
function selectorNames(text) {
  const attrs = [...text.matchAll(ATTR_SELECTOR)].map((m) => ({
    name: m[1].toLowerCase(),
    op: m[2] ?? null,
    value: m[2] ? (m[3] ?? m[4] ?? m[5]) : null,
  }));
  // Attribute values may hold dots and hashes: read classes and ids without them.
  const bare = text.replace(ATTR_SELECTOR, ' ');
  return {
    classes: [...bare.matchAll(/\.([\w-]+)/g)].map((m) => m[1]),
    ids: [...bare.matchAll(/#([\w-]+)/g)].map((m) => m[1]),
    attrs,
  };
}

/** Whether an attribute test `[x OP v]` matches a value (null: unknown, so it may). */
function attrTestMatches({ op, value }, actual) {
  if (op === null || actual === null) return true;
  const v = value.toLowerCase();
  const a = actual.toLowerCase();
  switch (op) {
    case '=':
      return a === v;
    case '~=':
      return a.split(/\s+/).includes(v);
    case '|=':
      return a === v || a.startsWith(`${v}-`);
    case '^=':
      return v !== '' && a.startsWith(v);
    case '$=':
      return v !== '' && a.endsWith(v);
    default:
      return v !== '' && a.includes(v);
  }
}

/**
 * Whether a `[class OP v]` test can match an element carrying `name`. The
 * class attribute holds other tokens too, so every operator but `=`/`~=`
 * reads as a substring of the class.
 */
function classTestMatches({ op, value }, name) {
  if (op === null) return false;
  const v = value.toLowerCase();
  return op === '=' || op === '~=' ? name.toLowerCase() === v : v !== '' && name.toLowerCase().includes(v);
}

/** The first Dialog box class a `[class…]` test in the prelude can match, or null. */
function classTestBoxClass(prelude) {
  for (const test of selectorNames(prelude).attrs.filter((a) => a.name === 'class')) {
    const hit = BOX_CLASSES.find((name) => classTestMatches(test, name));
    if (hit) return hit;
  }
  return null;
}

/**
 * Why a global rule breaks the Dialog, or null. Naming any Dialog class or
 * attribute is a restyle, except `.dialog-form.<own-class>` on its own,
 * with spacing only.
 */
function restyleDetail(prelude, properties) {
  const classes = [...prelude.matchAll(DIALOG_CLASS_RE)].map((m) => m[1]);
  const text = squash(prelude);
  const other = classes.find((c) => c !== 'dialog-form') ?? classTestBoxClass(prelude);
  if (other) return `${text} restyles the Dialog's .${other}; ${INSTEAD}`;
  const attr = prelude.match(DIALOG_ATTR_RE);
  if (attr) {
    const shown = prelude.slice(attr.index, prelude.indexOf(']', attr.index) + 1 || undefined);
    return `${text} reaches the Dialog's elements through ${shown}; ${INSTEAD}`;
  }
  if (classes.length === 0) return null;
  const loose = selectors(prelude).find((s) => /\.dialog-form(?![\w-])/.test(s) && !OWN_FORM_COMPOUND.test(s));
  if (loose !== undefined) return `${text}: style a Dialog.Form only as .dialog-form.<your-class>, with nothing around it`;
  const notSpacing = properties.filter((p) => !SPACING_PROP.test(p));
  if (notSpacing.length === 0) return null;
  return `${text} sets ${notSpacing.join(', ')} on .dialog-form; only gap, padding and margin may change`;
}

/** Each class a `class` value can hold: its text, its string literals, an object's keys. */
function classNames(attr) {
  const names = [];
  const add = (text) => names.push(...text.split(/\s+/).filter(Boolean));
  for (const part of Array.isArray(attr.value) ? attr.value : [attr.value]) {
    if (part === true) continue;
    if (part.type === 'Text') add(part.data);
    walk(part.expression, (node) => {
      if (node.type === 'Literal' && typeof node.value === 'string') add(node.value);
      if (node.type === 'TemplateElement') add(node.value.cooked ?? '');
      if (node.type === 'Property' && !node.computed && node.key.type === 'Identifier') add(node.key.name);
    });
  }
  return names;
}

/** An attribute's static value: its text, '' when bare, null when an expression decides it. */
function staticValue(attr) {
  if (attr.value === true) return '';
  const parts = Array.isArray(attr.value) ? attr.value : [attr.value];
  return parts.every((p) => p.type === 'Text') ? parts.map((p) => p.data).join('') : null;
}

/** An attribute that lands on a part's element as written (not a part prop, not a handler). */
const landsOnElement = (name) => name.includes('-') || HTML_GLOBAL_ATTRS.has(name);

/**
 * Pass one of part-class: every handle this file hands a part that draws
 * the panel, added to `handles` (class/id -> {part, file}; attribute name ->
 * [{value, part, file}]).
 */
function collectHandles(ast, bindings, file, handles) {
  walk(ast.fragment, (node) => {
    const part = partOf(node, bindings);
    if (!BOX_PARTS.has(part)) return;
    const owner = { part, file };
    for (const attr of node.attributes ?? []) {
      if (attr.type === 'ClassDirective') handles.classes.set(attr.name, owner);
      if (attr.type !== 'Attribute') continue;
      if (attr.name === 'class') {
        for (const name of classNames(attr)) handles.classes.set(name, owner);
      } else if (attr.name === 'id') {
        // An id an expression decides can't be matched by name; part-dynamic is classes' only.
        const id = staticValue(attr);
        if (id) handles.ids.set(id, owner);
      } else if (landsOnElement(attr.name)) {
        const list = handles.attrs.get(attr.name) ?? [];
        list.push({ value: staticValue(attr), ...owner });
        handles.attrs.set(attr.name, list);
      }
    }
  });
}

/** The first handle a part took that this selector text names, or null. */
function namedHandle(text, handles) {
  const { classes, ids, attrs } = selectorNames(text);
  for (const name of classes) {
    const owner = handles.classes.get(name);
    if (owner) return { ...owner, shown: `its class .${name}` };
  }
  for (const id of ids) {
    const owner = handles.ids.get(id);
    if (owner) return { ...owner, shown: `its id #${id}` };
  }
  for (const test of attrs) {
    if (test.name === 'class') {
      for (const [name, owner] of handles.classes) {
        if (classTestMatches(test, name)) return { ...owner, shown: `its class .${name}` };
      }
    } else if (test.name === 'id') {
      for (const [id, owner] of handles.ids) {
        if (attrTestMatches(test, id)) return { ...owner, shown: `its id #${id}` };
      }
    } else {
      const owner = (handles.attrs.get(test.name) ?? []).find((h) => attrTestMatches(test, h.value));
      if (owner) return { ...owner, shown: `its attribute [${test.name}]` };
    }
  }
  return null;
}

/**
 * Whether a subject compound is the page's own element: it carries a class
 * or id that no part takes (nor the Dialog's own), so no part can match it.
 */
function isOwnElement(compound, handles) {
  const { classes, ids } = selectorNames(withoutFunctional(compound));
  return (
    classes.some((name) => !handles.classes.has(name) && !DIALOG_CLASSES.includes(name)) ||
    ids.some((id) => !handles.ids.has(id))
  );
}

/**
 * The part of a selector that reaches outside its file, unwrapped, or null
 * when its subject is scoped. A compound outside `:global` carries the
 * file's scoping class, so it matches only the file's own elements, never
 * a part's (a part's element is another component's): a handle named there
 * is the page's own element. In a .css file or a `:global {}` block,
 * everything reaches.
 */
function globalReach(selector, inGlobalBlock) {
  const tokens = compounds(selector);
  const isGlobal = (token, i) => inGlobalBlock || token.startsWith(':global') || tokens.slice(0, i).includes(':global');
  if (!isGlobal(tokens.at(-1) ?? '', tokens.length - 1)) return null;
  return tokens
    .filter((token, i) => token !== ':global' && isGlobal(token, i))
    .map(unwrapGlobal)
    .join(' ');
}

/**
 * part-class: why a global rule reaches a part through a handle a page gave
 * it, or null. It does when the selector's global reach names that handle
 * anywhere and its subject could be the part. A `.dialog-form.<own>`
 * compound is restyleDetail's to judge.
 */
function partHandleDetail(prelude, handles, inGlobalBlock, file) {
  const text = squash(prelude);
  // Another file's handle names that file: the rule and the part are apart.
  const via = (hit) => (hit.file !== file ? ` (${hit.file} hands it to Dialog.${hit.part})` : '');
  for (const outer of selectorList(prelude).flatMap((s) => alternatives(s))) {
    const reach = globalReach(outer, inGlobalBlock);
    if (reach === null) continue;
    for (const selector of alternatives(reach)) {
      const subject = compounds(selector).at(-1) ?? '';
      if (/\.dialog-form(?![\w-])/.test(subject) || isOwnElement(subject, handles)) continue;
      const inSubject = namedHandle(withoutFunctional(subject), handles);
      if (inSubject) return `${text} restyles Dialog.${inSubject.part} through ${inSubject.shown}${via(inSubject)}; ${INSTEAD}`;
      const walked = namedHandle(selector, handles);
      if (walked) {
        return (
          `${text} walks from Dialog.${walked.part}'s ${walked.shown.replace(/^its /, '')}${via(walked)} to an element ` +
          'no class names, which may be a part; give that element a class of its own'
        );
      }
    }
  }
  return null;
}

/** global-style, then part-class, for one global rule. */
function globalRuleViolation(rule, handles, file) {
  const prelude = cssUnescape(rule.prelude);
  const restyle = restyleDetail(prelude, rule.properties);
  if (restyle) return ['global-style', restyle];
  if (rule.preludeOnly) return null;
  const own = partHandleDetail(prelude, handles, rule.block, file);
  return own ? ['part-class', own] : null;
}

/** Selector lists `parent` and `child` as one: `&` takes the parent's place, or the child descends from it. */
function nestSelectors(parent, child) {
  const out = [];
  for (const c of selectorList(child)) {
    for (const p of selectorList(parent)) out.push(c.includes('&') ? c.replaceAll('&', p) : `${p} ${c}`);
  }
  return out.join(', ');
}

/** An `@scope` prelude's root `(X)` and limit `to (Y)` selectors, either null. */
function scopePrelude(text) {
  const read = (from) => {
    const open = text.indexOf('(', from);
    const end = open === -1 ? -1 : closeParen(text, open);
    return end === -1 ? null : { selector: text.slice(open + 1, end - 1).trim(), end };
  };
  const trimmed = text.trimStart();
  const offset = text.length - trimmed.length;
  const root = trimmed.startsWith('(') ? read(offset) : null;
  const to = text.slice(root?.end ?? 0).match(/^\s*to\s*\(/);
  const limit = to ? read((root?.end ?? 0) + to[0].length - 1) : null;
  return { root: root?.selector || null, limit: limit?.selector || null };
}

/**
 * Every rule of a style sheet, nesting resolved: a nested rule takes its
 * parent's selector (`&` included), and a nested at-rule's declarations are
 * its parent rule's. `global` is whether the rule reaches outside this file;
 * `block` whether everything in it does (a .css file). A `:global { … }`
 * block needs no flag of its own: its `:global` stays in each nested selector.
 * An `@scope (X) to (Y)` prelude is emitted as written, so it is a global
 * rule of its own (`preludeOnly`: only the Dialog's names count there), and
 * its rules are nested in X, `:scope` standing for it.
 */
function cssRules(stylesheet, source, inFile) {
  const rules = [];
  const visit = (node, ctx) => {
    if (node.type === 'Atrule') {
      const children = node.block?.children ?? [];
      if (node.name === 'scope') {
        const { root, limit } = scopePrelude(node.prelude ?? '');
        const scope = root ? (ctx.prelude ? nestSelectors(ctx.prelude, root) : root) : ctx.prelude;
        const named = [scope, limit].filter(Boolean).join(', ');
        if (named) rules.push({ prelude: named, global: true, block: ctx.block, preludeOnly: true, properties: [], start: node.start });
        // Declarations straight in @scope style the root itself.
        const properties = children.filter((c) => c.type === 'Declaration').map((c) => c.property);
        if (scope && properties.length) rules.push({ prelude: scope, global: true, block: ctx.block, properties, start: node.start });
        for (const child of children) visit(child, { ...ctx, prelude: scope, scope, scopeDirect: true });
        return;
      }
      const properties = children.filter((c) => c.type === 'Declaration').map((c) => c.property);
      if (ctx.prelude && properties.length) rules.push({ ...ctx, properties, start: node.start });
      for (const child of children) if (child.type !== 'Declaration') visit(child, ctx);
      return;
    }
    if (node.type !== 'Rule') return;
    let own = source.slice(node.prelude.start, node.prelude.end).trim();
    // In @scope, `:scope` is the root: in place for a direct rule, by name below it.
    if (ctx.scope) own = own.replace(/:scope\b/g, ctx.scopeDirect ? '&' : `:is(${ctx.scope})`);
    const children = node.block.children;
    const prelude = ctx.prelude ? nestSelectors(ctx.prelude, own) : own;
    const next = { prelude, global: ctx.global || own.includes(':global'), block: ctx.block, scope: ctx.scope };
    const properties = children.filter((c) => c.type === 'Declaration').map((c) => c.property);
    rules.push({ ...next, properties, start: node.start });
    for (const child of children) if (child.type !== 'Declaration') visit(child, next);
  };
  for (const node of stylesheet.children) visit(node, { prelude: null, global: inFile, block: inFile });
  return rules;
}

function checkSvelteCss(css, source, handles, name, report) {
  for (const rule of cssRules(css, source, false)) {
    const found = rule.global && globalRuleViolation(rule, handles, name);
    if (found) report(rule.start, ...found);
  }
}

/** A .css file is global through and through, parsed with svelte's own CSS parser. */
function checkCssFile(source, handles, name, report) {
  const wrapped = `<style>${source}</style>`;
  const at = (offset) => Math.max(0, offset - '<style>'.length);
  let ast;
  try {
    ast = parse(wrapped, { modern: true });
  } catch (error) {
    report(
      at(error.position?.[0] ?? 0),
      'parse',
      `svelte's CSS parser rejects this (${error.message.split('\n')[0]}), so it cannot be checked; ` +
        'rewrite the construct in a form svelte reads (e.g. :lang(en), not :lang("en")), as a component <style> would need'
    );
    return;
  }
  if (!ast.css) return;
  for (const rule of cssRules(ast.css, wrapped, true)) {
    const found = globalRuleViolation(rule, handles, name);
    if (found) report(at(rule.start), ...found);
  }
}

/**
 * A script's comments blanked, offsets kept, so a commented-out import is
 * not read. Strings stay: the specifiers live in them.
 */
function blankComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && (next === '/' || next === '*')) {
      const end = next === '/' ? source.indexOf('\n', i) : source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : next === '/' ? end : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** `{ type A, type B }`: an import or export clause that names only types. */
function namesOnlyTypes(clause) {
  const braces = clause.match(/\{([^}]*)\}/);
  if (!braces || clause.replace(braces[0], '').trim() !== '') return false;
  const items = braces[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 && items.every((s) => /^type\s/.test(s));
}

/**
 * Each module specifier a script names: static imports and exports, side
 * effects, import(). `typeOnly` marks `import type`, `export type`, an
 * all-`type` clause and `typeof import()`, which read no value.
 */
function* moduleSpecifiers(code) {
  for (const m of code.matchAll(/\b(import|export)\b(\s+type\b)?([^;'"`]*?)\bfrom\s*(['"])([^'"]+)\4/g)) {
    yield { kind: m[1], spec: m[5], index: m.index, typeOnly: Boolean(m[2]) || namesOnlyTypes(m[3]) };
  }
  for (const m of code.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) {
    yield { kind: 'import', spec: m[2], index: m.index, typeOnly: false };
  }
  for (const m of code.matchAll(/\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g)) {
    const typeOnly = /\btypeof\s*$/.test(code.slice(Math.max(0, m.index - 40), m.index));
    yield { kind: 'import', spec: m[2], index: m.index, typeOnly };
  }
}

const escapeRegExp = (text) => text.replace(/[$.*+?^()[\]{}|\\]/g, '\\$&');

/**
 * .ts/.js outside ui/Dialog/. Any import of the Dialog module is an alias
 * a page could take one step away; a type-only one reads no value. Outside
 * ui/Popover/ too: a read of showModal, a Melt modal builder, or an object
 * literal claiming a dialog role is own-dialog.
 */
function checkScriptFile(file, source, ctx, report) {
  const code = blankComments(source);
  for (const { kind, spec, index, typeOnly } of moduleSpecifiers(code)) {
    if (typeOnly || !resolveSpecifier(file, spec, ctx)) continue;
    report(
      index,
      'alias',
      kind === 'export'
        ? reexportDetail(spec)
        : `a .ts/.js file imports the Dialog module ('${spec}'), which can hand its parts on as values this check can't follow; import the parts in the .svelte that renders them`
    );
  }
  if (ctx.ownDialogExempt(file)) return;
  for (const m of code.matchAll(/(?:\?\.|\.)\s*showModal\b|\[\s*(['"`])showModal\1\s*\]/g)) {
    const line = code.slice(code.lastIndexOf('\n', m.index) + 1, m.index);
    if (/\btypeof\s+[\w$.?\s[\]'"`]*$/.test(line)) continue;
    report(m.index, 'own-dialog', SHOW_MODAL_DETAIL);
  }
  for (const m of code.matchAll(/\bimport\s*(type\s+)?\{([^}]*)\}\s*from\s*(['"])@melt-ui\/svelte\3/g)) {
    if (m[1]) continue;
    for (const spec of m[2].split(',')) {
      const [name, ...rest] = spec.trim().split(/\s+/);
      if (name === 'type' || !MODAL_BUILDERS.has(name) || rest.includes('type')) continue;
      report(m.index, 'own-dialog', meltDetail(name));
    }
  }
  for (const m of code.matchAll(/\bimport\s*\*\s*as\s+([\w$]+)\s+from\s*(['"])@melt-ui\/svelte\2/g)) {
    const ns = escapeRegExp(m[1]);
    const read = new RegExp(String.raw`(?<![\w$])${ns}\s*(?:\??\.\s*(createDialog|createPopover)\b|\[\s*(['"\`])(createDialog|createPopover)\2\s*\])`, 'g');
    for (const r of code.matchAll(read)) report(r.index, 'own-dialog', meltDetail(r[1] ?? r[3]));
  }
  // `role: 'dialog' | 'region'` is a union type, not a value to spread.
  for (const m of code.matchAll(/\brole\s*:\s*(['"`])((?:alert)?dialog)\1(?!\s*\|)|(['"])aria-modal\3\s*:/g)) {
    const claim = m[2] ? `role: '${m[2]}'` : 'aria-modal';
    report(m.index, 'own-dialog', `an object sets ${claim}, a hand-built modal once spread; build the modal from Dialog.Root/Content`);
  }
}

/** One .svelte file parsed, or the error that stopped it. */
function parseSvelte(file, source) {
  try {
    const ast = parse(source, { modern: true, filename: file });
    return { ast, programs: [ast.module?.content, ast.instance?.content].filter(Boolean) };
  } catch (error) {
    return { error };
  }
}

function checkSvelteFile(file, source, unit, ctx, report) {
  if (unit.error) {
    report(unit.error.position?.[0] ?? 0, 'parse', `does not parse, so it cannot be checked: ${unit.error.message.split('\n')[0]}`);
    return;
  }
  const { ast, programs } = unit;
  const bindings = collectBindings(file, programs, ctx, report);
  checkDynamicImports([...programs, ast.fragment], file, ctx, report);
  checkValueReads([...programs, ast.fragment], bindings, report);
  checkMarkup(ast, programs, bindings, report);
  if (!isInside(ctx.dialogDir, file)) {
    checkPartAttributes(ast.fragment, bindings, report);
    checkMarkupStyle(ast.fragment, report);
    if (ast.css) checkSvelteCss(ast.css, source, ctx.handles, ctx.nameOf(file), report);
  }
  if (!ctx.ownDialogExempt(file)) {
    checkOwnDialog(ast, programs, bindings, collectPopoverNames(file, programs, ctx), report);
  }
}

/** Every rule that applies to one file, by its kind and where it lives. */
function scanFile(file, source, unit, ctx, report) {
  if (file.endsWith('.svelte')) checkSvelteFile(file, source, unit, ctx, report);
  else if (isInside(ctx.dialogDir, file) || TEST_FILE.test(file)) return;
  else if (file.endsWith('.css')) checkCssFile(source, ctx.handles, ctx.nameOf(file), report);
  else checkScriptFile(file, source, ctx, report);
}

/**
 * Waive what the allowlist names, exactly as many times as each entry
 * expects. An entry that waives nothing is stale; one that waives a
 * different number is miscounted. Both fail.
 */
function applyAllowlist(found, allowlist) {
  const counts = new Map(allowlist.map((a) => [a, 0]));
  const violations = found.filter((v) => {
    const entry = allowlist.find((a) => a.file === v.file && a.rule === v.rule);
    if (entry) counts.set(entry, counts.get(entry) + 1);
    return !entry;
  });
  const stale = allowlist.filter((a) => counts.get(a) === 0);
  const miscounted = allowlist
    .filter((a) => counts.get(a) > 0 && counts.get(a) !== a.expect)
    .map((a) => ({ ...a, found: counts.get(a) }));
  return { violations, allowlisted: found.length - violations.length, stale, miscounted };
}

/**
 * Core scan, pure over the tree it is pointed at. Paths in the result are
 * relative to `cwd`, with forward slashes, as the allowlist spells them.
 * Two passes: every handle a .svelte outside ui/Dialog/ hands a part is
 * collected first, so a global rule in any file is judged against all of
 * them (part-class).
 *
 * @returns {{ violations: {file:string,line:number,rule:string,detail:string}[],
 *   allowlisted: number, stale: typeof ALLOWLIST,
 *   miscounted: (typeof ALLOWLIST[number] & { found: number })[], filesScanned: number }}
 */
export function collectViolations({ srcRoot = join(WEB_ROOT, 'src'), cwd = WEB_ROOT, allowlist = ALLOWLIST } = {}) {
  if (!existsSync(srcRoot)) throw new Error(`Dialog structure gate: scan root does not exist: ${srcRoot}`);
  const libRoot = join(srcRoot, 'lib');
  const uiDir = join(libRoot, 'components', 'ui');
  const dialogDir = join(uiDir, 'Dialog');
  const popoverDir = join(uiDir, 'Popover');
  const ctx = {
    libRoot,
    uiDir,
    dialogDir,
    popoverDir,
    partFiles: readPartFiles(dialogDir),
    // The shared Dialog and Popover are the only modals built by hand.
    ownDialogExempt: (file) => isInside(dialogDir, file) || isInside(popoverDir, file),
    handles: { classes: new Map(), ids: new Map(), attrs: new Map() },
    nameOf: (file) => relative(cwd, file).split(sep).join('/'),
  };
  const { nameOf } = ctx;

  const files = walkFiles(srcRoot, SCANNED_EXTS);
  const sources = new Map();
  const units = new Map();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    sources.set(file, source);
    if (!file.endsWith('.svelte')) continue;
    const unit = parseSvelte(file, source);
    units.set(file, unit);
    if (unit.ast && !isInside(dialogDir, file)) {
      collectHandles(unit.ast, collectBindings(file, unit.programs, ctx, () => {}), nameOf(file), ctx.handles);
    }
  }

  const found = [];
  for (const file of files) {
    const source = sources.get(file);
    const name = nameOf(file);
    scanFile(file, source, units.get(file), ctx, (offset, rule, detail) =>
      found.push({ file: name, line: lineOf(source, offset), rule, detail })
    );
  }
  return { ...applyAllowlist(found, allowlist), filesScanned: files.length };
}

/** `--root <dir>`: the tree to scan instead of apps/web, with no allowlist. */
function optionsFrom(argv) {
  const at = argv.indexOf('--root');
  if (at === -1) return { allowlist: ALLOWLIST };
  if (!argv[at + 1]) {
    console.error('Dialog structure gate: --root needs a directory.');
    process.exit(2);
  }
  const root = resolve(argv[at + 1]);
  return { srcRoot: join(root, 'src'), cwd: root, allowlist: [] };
}

function main(argv = process.argv.slice(2)) {
  const options = optionsFrom(argv);
  const { violations, allowlisted, stale, miscounted, filesScanned } = collectViolations(options);

  if (filesScanned === 0) {
    console.error('Dialog structure gate scanned 0 files: the scan root is misconfigured. Failing closed.');
    process.exit(1);
  }

  for (const v of violations) console.error(`${v.file}:${v.line} ${v.rule}: ${v.detail}`);
  for (const a of stale) {
    console.error(`${a.file} ${a.rule}: allowlisted but no longer violates. Delete its ALLOWLIST entry.`);
  }
  for (const a of miscounted) {
    console.error(
      `${a.file} ${a.rule}: allowlisted for ${a.expect ?? 'no stated'} violation(s) but has ${a.found}. ` +
        'Fix a new one; re-pin `expect` only when one was removed.'
    );
  }

  const failures = violations.length + stale.length + miscounted.length;
  if (failures > 0) {
    console.error(
      `\n${violations.length} violation(s), ${stale.length} stale and ${miscounted.length} miscounted allowlist entr${
        stale.length + miscounted.length === 1 ? 'y' : 'ies'
      }. ` +
        'Every modal is Dialog.Root > Dialog.Content > Dialog.Header / Toolbar / Body / Footer, with Dialog.Form ' +
        '(> Toolbar / Body / Footer) when they submit together; a drawer is <Dialog.Content variant="drawer">. ' +
        'Each line above says what to write instead. See the header of apps/web/scripts/check-dialog-structure.mjs.'
    );
    process.exit(1);
  }

  console.log(
    `OK: every Dialog in ${filesScanned} file(s) is built from the shared parts ` +
      `(${allowlisted} known violation(s) allowlisted, in ${options.allowlist.length} entries).`
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
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) main();
