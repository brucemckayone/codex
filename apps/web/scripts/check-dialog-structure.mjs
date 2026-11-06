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
 *   toolbar-body   A panel with a Dialog.Toolbar has a Dialog.Body. Toolbar
 *                  is `flex: none` and never scrolls, so fields stacked in it
 *                  with no Body clip the Footer.
 *   global-style   Outside ui/Dialog/, no global rule (a `:global(...)`
 *                  selector, a `:global {}` block, any rule in a .css file,
 *                  nested rules and nested at-rules included) names a class
 *                  or attribute the Dialog renders: its classes, Melt's
 *                  `data-melt-dialog-*`, `[role=dialog]`, `[aria-modal]` and
 *                  the parts' own data attributes. Restyling the primitive
 *                  from outside is how the four hand-built drawers forked it.
 *                  One exception: a rule whose selector is exactly
 *                  `.dialog-form` plus the page's own class
 *                  (`:global(.dialog-form.tier-form)`) may set spacing (gap,
 *                  padding*, margin*) and nothing else. Bare `.dialog-form`,
 *                  a combinator, or any other property (display, flex*,
 *                  overflow*, height, position…) fails.
 *   part-class     The same restyle through the page's own name: a class a
 *                  file hands Dialog.Content, Header, Toolbar, Body, Footer
 *                  or Form (`class="x"`, the literals in a `class={…}`,
 *                  `class:x`) may not be the subject of a global rule in that
 *                  file, as `:global(.x)` or `.wrap :global(.x)`. Nor may a
 *                  global rule walk from that class to an element it names
 *                  by no class (`:global(.x > div)`, `:global(.x + *)`): that
 *                  element is as likely a part as the page's own. The
 *                  `.dialog-form.<own>` spacing case above is allowed.
 *                  Title and Description are exempt: their type is the
 *                  page's choice. (They are NOT harmless: they sit in Header,
 *                  which doesn't scroll, so a Header taller than the panel
 *                  still clips. That is the panel's to absorb, not a rule a
 *                  source check can state.)
 *   part-style     Outside ui/Dialog/, no part that draws the panel takes an
 *                  inline `style=` or `style:` directive: it beats every
 *                  scoped rule the part keeps its scroll chain with.
 *                  Dialog.Content's maxWidth / maxHeight props are the
 *                  sanctioned size hatches.
 *   part-dynamic   Outside ui/Dialog/, a part that draws the panel takes no
 *                  {...spread}, and its class is literal (text, string
 *                  literals, a conditional or template of them, an
 *                  object's keys). A class held in a variable or a prop can't
 *                  be checked against part-class, which is how a wrapper
 *                  component would bring the forked drawer back.
 *   markup-style   Outside ui/Dialog/, no `<style>` element sits in markup
 *                  (`<svelte:head><style>`) and no {@html} writes one: their
 *                  rules are global and never reach this check.
 *   own-dialog     Outside ui/Dialog/ and ui/Popover/, nothing builds a modal
 *                  by hand: no role="dialog"/"alertdialog" (a conditional,
 *                  logical or template value included), no aria-modal, no
 *                  `popover` attribute, no `<dialog>` element, no
 *                  `.showModal()` call, no import of Melt's createDialog or
 *                  createPopover.
 *   alias          The Dialog parts are used as tags only. Reading a Dialog
 *                  binding as a value, in script or in markup
 *                  (`const C = Dialog.Content`, `{@const C = Content}`,
 *                  `<svelte:component this={Dialog.Content}>`), would hide a
 *                  part from this check, so it fails loudly instead. So do a
 *                  re-export of the module and, outside ui/, any .ts or .js
 *                  file that imports it (a barrel one step away would hand
 *                  its pages an alias this check can't resolve).
 *   parse          A .svelte or .css file that does not parse fails loudly.
 *
 * "Direct child" looks THROUGH {#if}/{#each}/{#key}/{#await}/{#snippet}
 * blocks and <svelte:boundary> (they render no element), and through a
 * `{@render s()}` of a snippet declared in the same file. A {@render} of
 * anything else (a `children` prop) cannot be proven and is a violation.
 *
 * AST-based (svelte/compiler `parse`, modern AST, its CSS parser for .css
 * too), not grep: blocks nest, and the alias is RESOLVED from the file's
 * imports (`* as Dialog`, `* as Modal`, `{ Content as C }`, a default import
 * of DialogContent.svelte, any $lib or relative spelling, a trailing slash),
 * so `Card.Content` or `Tabs.Content` is never confused with Dialog's. The
 * part names come from ui/Dialog/index.ts itself.
 *
 * ALLOWLIST holds the exceptions, each with its one-line, owner-visible
 * reason and the exact number of violations it waives (`expect`). An entry
 * whose count differs FAILS the gate: a new violation can't hide behind a
 * known one, and a fixed file can't keep its waiver.
 *
 * Exported (`collectViolations`) so the node:test suite can point the same
 * scan at fixture trees; `main()` runs only as the CLI entrypoint.
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
    expect: 1,
    reason: 'Permanent: the calibration control, the raw wrapper this gate bans; the scroll proof must read it CLIPPED',
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

// The attributes that reach the Dialog's elements as its classes do: Melt's,
// the dialog semantics, and the parts' own. `data-layout` and `data-variant`
// are common words (page-builder blocks, Button), so only the Dialog's values
// count for them; the other names are the Dialog's alone.
const DIALOG_ATTR_RE = new RegExp(
  String.raw`\[\s*(?:` +
    [
      String.raw`data-melt-dialog-[\w-]*`,
      String.raw`aria-modal`,
      String.raw`role\s*[~|^$*]?=\s*['"]?(?:alert)?dialog(?![\w-])`,
      String.raw`data-(?:flush|surface|placement|radius|sheet|floating)(?![\w-])`,
      String.raw`data-layout\s*[~|^$*]?=\s*['"]?(?:dialog|drawer|floating)(?![\w-])`,
      String.raw`data-variant\s*[~|^$*]?=\s*['"]?(?:dialog|drawer)(?![\w-])`,
    ].join('|') +
    ')'
);

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

/** The parts each container part may hold directly, and the rule's name. */
const CHILD_RULES = {
  Content: { rule: 'content-child', allowed: new Set(['Header', 'Toolbar', 'Body', 'Footer', 'Form']) },
  Form: { rule: 'form-child', allowed: new Set(['Toolbar', 'Body', 'Footer']) },
};

// The parts a Dialog.Body may sit directly in (body-place).
const BODY_HOLDERS = new Set(['Content', 'Form']);

// Melt's builders for a modal of one's own (own-dialog).
const MODAL_BUILDERS = new Set(['createDialog', 'createPopover']);

const SCANNED_EXTS = ['.svelte', '.css', '.ts', '.js'];

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

/**
 * Where an import specifier points, as a Dialog binding: the module itself
 * (`{ module: true }`), one part's file (`{ part }`), or null.
 */
function resolveSpecifier(importer, spec, ctx) {
  // A trailing separator names the same directory: '…/ui/Dialog/' is the module.
  const clean = spec.replace(/\/+$/, '');
  let target;
  if (clean === '$lib' || clean.startsWith('$lib/')) target = join(ctx.libRoot, clean.slice(4));
  else if (clean.startsWith('.')) target = resolve(dirname(importer), clean);
  else return null;
  target = target.replace(/\/index(\.(ts|js))?$/, '').replace(/\.(ts|js)$/, '');
  if (target === ctx.dialogDir) return { module: true };
  if (dirname(target) === ctx.dialogDir && target.endsWith('.svelte')) {
    const part = ctx.partFiles.get(target.slice(ctx.dialogDir.length + 1, -'.svelte'.length));
    return part ? { part } : null;
  }
  return null;
}

const reexportDetail = (spec) => `re-exports the Dialog module ('${spec}'), which hides it from this check`;

/** One import's bindings: local name -> { namespace: true } | { part }. */
function bindImport(stmt, target, bindings) {
  for (const s of stmt.specifiers) {
    if (s.type === 'ImportNamespaceSpecifier' && target.module) {
      bindings.set(s.local.name, { namespace: true });
    } else if (s.type === 'ImportSpecifier' && target.module) {
      bindings.set(s.local.name, { part: s.imported.name ?? s.imported.value });
    } else if (s.type === 'ImportDefaultSpecifier' && target.part) {
      bindings.set(s.local.name, { part: target.part });
    }
  }
}

/**
 * Local name -> Dialog binding for one file. Any other statement with a
 * `source` that reaches the Dialog is a re-export, which fails loudly.
 */
function collectBindings(file, programs, ctx, report) {
  const bindings = new Map();
  for (const stmt of programs.flatMap((program) => program.body)) {
    const target = stmt.source ? resolveSpecifier(file, stmt.source.value, ctx) : null;
    if (!target) continue;
    if (stmt.type === 'ImportDeclaration') bindImport(stmt, target, bindings);
    else report(stmt.start, 'alias', reexportDetail(stmt.source.value));
  }
  return bindings;
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
    } else if (node.type === 'RenderTag') {
      yield* renderedChildren(node, snippets, onUnknown, seen);
    } else if (rendersSomething(node)) {
      yield node;
    }
  }
}

/** A local snippet's top level, as if written in place of its {@render}. */
function* renderedChildren(tag, snippets, onUnknown, seen) {
  const name = renderCallee(tag);
  const snippet = name && snippets.get(name);
  if (!snippet) onUnknown(tag, name);
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
 * body-place: each Dialog.Body's nearest part ancestor is Content or Form.
 * A Body at a snippet's top level takes the parts its {@render}s sit in; a
 * snippet rendered nowhere in this file (passed to a component) can't be
 * proven. A raw element between Content and Body is content-child's.
 */
function checkBodyPlacement(fragment, { bindings, report }) {
  const renders = new Map();
  const bodies = [];
  const visit = (nodes, holder) => {
    for (const node of nodes ?? []) {
      if (node.type === 'SnippetBlock') {
        visit(node.body.nodes, { snippet: node.expression.name });
      } else if (TRANSPARENT_BLOCKS[node.type]) {
        for (const inner of TRANSPARENT_BLOCKS[node.type](node)) visit(inner?.nodes, holder);
      } else if (node.type === 'RenderTag') {
        const name = renderCallee(node);
        if (name) renders.set(name, [...(renders.get(name) ?? []), holder]);
      } else {
        const part = partOf(node, bindings);
        if (part === 'Body') bodies.push({ node, holder });
        if (node.fragment) visit(node.fragment.nodes, part ? { part } : holder);
      }
    }
  };
  visit(fragment.nodes, { top: true });

  const placed = (holder, seen) => {
    if (holder.part) return BODY_HOLDERS.has(holder.part);
    if (!holder.snippet) return false;
    if (seen.has(holder.snippet)) return true;
    const sites = renders.get(holder.snippet) ?? [];
    const next = new Set([...seen, holder.snippet]);
    return sites.length > 0 && sites.every((site) => placed(site, next));
  };
  const where = (holder) =>
    holder.part ? `in Dialog.${holder.part}` : holder.snippet ? `in snippet ${holder.snippet}()` : 'outside any Dialog.Content';
  for (const { node, holder } of bodies) {
    if (placed(holder, new Set())) continue;
    report(
      node.start,
      'body-place',
      `${describe(node)} sits ${where(holder)}; only Dialog.Content or Dialog.Form may hold it, the one part that scrolls`
    );
  }
}

function checkMarkup(ast, bindings, report) {
  const scope = { bindings, snippets: collectSnippets(ast.fragment), report };
  walk(ast.fragment, (node) => {
    const part = partOf(node, bindings);
    if (CHILD_RULES[part]) checkChildren(node, part, scope);
    if (part === 'Content') checkToolbarHasBody(node, scope);
  });
  checkBodyPlacement(ast.fragment, scope);
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

/** Each text an attribute can hold: its static text and every literal in its expressions. */
function attrStrings(attr) {
  if (attr.value === true) return [];
  const out = [];
  for (const part of Array.isArray(attr.value) ? attr.value : [attr.value]) {
    if (part.type === 'Text') out.push(part.data);
    else out.push(...literalStrings(part.expression));
  }
  return out;
}

/** What a hand-built modal attribute claims, or null. */
function ownDialogAttr(attr) {
  if (attr.type !== 'Attribute') return null;
  if (attr.name === 'aria-modal') return 'aria-modal';
  if (attr.name === 'popover') return 'the popover attribute';
  if (attr.name !== 'role') return null;
  return attrStrings(attr).some((s) => /\b(alert)?dialog\b/.test(s)) ? 'role="dialog"' : null;
}

/** `x.showModal()`, `x?.showModal()` or `x['showModal']()`. */
function isShowModalCall(node) {
  if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return false;
  const { property, computed } = node.callee;
  return computed ? property.type === 'Literal' && property.value === 'showModal' : property.name === 'showModal';
}

function checkOwnDialog(ast, programs, report) {
  walk(ast.fragment, (node) => {
    if (node.type === 'RegularElement' && node.name === 'dialog') {
      report(node.start, 'own-dialog', '<dialog> is a hand-built modal; build the modal from Dialog.Root/Content');
    }
    if (!Array.isArray(node.attributes)) return;
    for (const attr of node.attributes) {
      const claim = ownDialogAttr(attr);
      if (claim) report(attr.start, 'own-dialog', `${describe(node)} sets ${claim}; build the modal from Dialog.Root/Content`);
    }
  });
  for (const root of [...programs, ast.fragment]) {
    walk(root, (node) => {
      if (isShowModalCall(node)) {
        report(node.start, 'own-dialog', '.showModal() opens a hand-built native modal; build the modal from Dialog.Root/Content');
      }
      if (node.type !== 'ImportDeclaration' || node.source.value !== '@melt-ui/svelte' || node.importKind === 'type') return;
      for (const s of node.specifiers) {
        const name = s.imported?.name ?? s.imported?.value;
        if (s.type === 'ImportSpecifier' && s.importKind !== 'type' && MODAL_BUILDERS.has(name)) {
          report(s.start, 'own-dialog', `imports Melt's ${name}, a modal of its own; build it from the shared Dialog or Popover`);
        }
      }
    });
  }
}

/** part-style and part-dynamic: what a part that draws the panel may be handed. */
function checkPartAttributes(fragment, bindings, report) {
  walk(fragment, (node) => {
    const part = partOf(node, bindings);
    if (!BOX_PARTS.has(part)) return;
    for (const attr of node.attributes ?? []) {
      if ((attr.type === 'Attribute' && attr.name === 'style') || attr.type === 'StyleDirective') {
        report(
          attr.start,
          'part-style',
          `${describe(node)} takes an inline style, which beats the rules that keep its scroll chain; Content's maxWidth / maxHeight props are the sanctioned size hatches`
        );
      } else if (attr.type === 'SpreadAttribute') {
        report(attr.start, 'part-dynamic', `${describe(node)} takes a {...spread}, which can hand it a class or style this check cannot read`);
      } else if (attr.type === 'Attribute' && attr.name === 'class' && !isLiteralClass(attr)) {
        report(attr.start, 'part-dynamic', `${describe(node)}'s class is not a literal, so what it hands the part cannot be checked`);
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
      (node.type === 'SvelteElement' && literalStrings(node.tag).some((s) => s.trim() === 'style'));
    if (isStyle) {
      report(node.start, 'markup-style', "<style> in markup is global CSS this check never parses; use the component's own <style>");
    } else if (node.type === 'HtmlTag' && literalStrings(node.expression).some((s) => /<style\b/i.test(s))) {
      report(node.start, 'markup-style', '{@html} writes a <style> element, global CSS this check never parses');
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

/** One selector with `:global(...)` / `:global` unwrapped. */
function unwrapGlobal(selector) {
  return selector.replace(/:global\(((?:[^()]|\([^()]*\))*)\)/g, '$1').replace(/:global\b/g, ' ').trim();
}

/** Each selector in a list, with `:global(...)` / `:global` unwrapped. */
function selectors(prelude) {
  return selectorList(prelude).map(unwrapGlobal);
}

/**
 * Why a global rule breaks the Dialog, or null. Naming any Dialog class or
 * attribute is a restyle, except `.dialog-form.<own-class>` on its own,
 * with spacing only.
 */
function restyleDetail(prelude, properties) {
  const classes = [...prelude.matchAll(DIALOG_CLASS_RE)].map((m) => m[1]);
  const text = prelude.replace(/\s+/g, ' ').trim();
  const other = classes.find((c) => c !== 'dialog-form');
  if (other) return `${text} restyles the Dialog's .${other}`;
  const attr = prelude.match(DIALOG_ATTR_RE);
  if (attr) {
    const shown = prelude.slice(attr.index, prelude.indexOf(']', attr.index) + 1 || undefined);
    return `${text} reaches the Dialog's elements through ${shown}`;
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

/** class -> part, for every class this file hands a part that draws the panel. */
function partClasses(ast, bindings) {
  const owned = new Map();
  walk(ast.fragment, (node) => {
    const part = partOf(node, bindings);
    if (!BOX_PARTS.has(part)) return;
    for (const attr of node.attributes ?? []) {
      if (attr.type === 'ClassDirective') owned.set(attr.name, part);
      if (attr.type !== 'Attribute' || attr.name !== 'class') continue;
      for (const name of classNames(attr)) owned.set(name, part);
    }
  });
  return owned;
}

// `:not()` and `:has()` only qualify a compound: what they name isn't styled.
const stripQualifiers = (compound) => compound.replace(/:(?:not|has)\((?:[^()]|\([^()]*\))*\)/g, '');

/**
 * A selector's subject (its last compound, unwrapped) and whether that
 * subject is global. A subject outside `:global` is scoped: it styles only
 * this file's own elements, never a part's.
 */
function selectorShape(raw, inGlobalBlock) {
  const rawCompounds = compounds(raw);
  const last = rawCompounds.at(-1) ?? '';
  const global = inGlobalBlock || last.startsWith(':global') || rawCompounds.slice(0, -1).includes(':global');
  const unwrapped = compounds(unwrapGlobal(raw));
  return { global, subject: unwrapped.at(-1) ?? '', all: unwrapped };
}

/**
 * Why a global rule restyles a part through the page's own class on it, or
 * null: the class as the subject, or a walk from it to an element no class
 * names. A `.dialog-form.<own>` compound is restyleDetail's to judge.
 */
function partClassDetail(prelude, owned, inGlobalBlock) {
  const text = prelude.replace(/\s+/g, ' ').trim();
  for (const raw of selectorList(prelude)) {
    const { global, subject, all } = selectorShape(raw, inGlobalBlock);
    if (!global) continue;
    const compound = stripQualifiers(subject);
    if (/\.dialog-form(?![\w-])/.test(compound)) continue;
    for (const [, name] of compound.matchAll(/\.([\w-]+)/g)) {
      const part = owned.get(name);
      if (part) return `${text} restyles Dialog.${part} through its class .${name}`;
    }
    if (/\.[\w-]/.test(compound)) continue;
    for (const c of all.slice(0, -1)) {
      for (const [, name] of stripQualifiers(c).matchAll(/\.([\w-]+)/g)) {
        const part = owned.get(name);
        if (part) return `${text} walks from Dialog.${part}'s class .${name} to an element no class names, which may be a part; give that element a class of its own`;
      }
    }
  }
  return null;
}

/** global-style, then part-class, for one global rule. */
function globalRuleViolation(rule, owned) {
  const restyle = restyleDetail(rule.prelude, rule.properties);
  if (restyle) return ['global-style', restyle];
  const own = partClassDetail(rule.prelude, owned, rule.block);
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

/**
 * Every rule of a style sheet, nesting resolved: a nested rule takes its
 * parent's selector (`&` included), and a nested at-rule's declarations are
 * its parent rule's. `global` is whether the rule reaches outside this file;
 * `block` whether everything in it does (a .css file). A `:global { … }`
 * block needs no flag of its own: its `:global` stays in each nested selector.
 */
function cssRules(stylesheet, source, inFile) {
  const rules = [];
  const visit = (node, ctx) => {
    if (node.type === 'Atrule') {
      const children = node.block?.children ?? [];
      const properties = children.filter((c) => c.type === 'Declaration').map((c) => c.property);
      if (ctx.prelude && properties.length) rules.push({ ...ctx, properties, start: node.start });
      for (const child of children) if (child.type !== 'Declaration') visit(child, ctx);
      return;
    }
    if (node.type !== 'Rule') return;
    const own = source.slice(node.prelude.start, node.prelude.end).trim();
    const children = node.block.children;
    const prelude = ctx.prelude ? nestSelectors(ctx.prelude, own) : own;
    const next = { prelude, global: ctx.global || own.includes(':global'), block: ctx.block };
    const properties = children.filter((c) => c.type === 'Declaration').map((c) => c.property);
    rules.push({ ...next, properties, start: node.start });
    for (const child of children) if (child.type !== 'Declaration') visit(child, next);
  };
  for (const node of stylesheet.children) visit(node, { prelude: null, global: inFile, block: inFile });
  return rules;
}

function checkSvelteCss(css, source, owned, report) {
  for (const rule of cssRules(css, source, false)) {
    const found = rule.global && globalRuleViolation(rule, owned);
    if (found) report(rule.start, ...found);
  }
}

/** A .css file is global through and through, parsed with svelte's own CSS parser. */
function checkCssFile(source, report) {
  const wrapped = `<style>${source}</style>`;
  const at = (offset) => Math.max(0, offset - '<style>'.length);
  let ast;
  try {
    ast = parse(wrapped, { modern: true });
  } catch (error) {
    report(at(error.position?.[0] ?? 0), 'parse', `does not parse, so it cannot be checked: ${error.message.split('\n')[0]}`);
    return;
  }
  if (!ast.css) return;
  for (const rule of cssRules(ast.css, wrapped, true)) {
    const found = globalRuleViolation(rule, new Map());
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

/** Each module specifier a script names: static imports and exports, side effects, import(). */
function* moduleSpecifiers(code) {
  const patterns = [
    [/\b(import|export)\b[^;'"`]*?\bfrom\s*(['"])([^'"]+)\2/g, (m) => [m[1], m[3]]],
    [/\bimport\s*(['"])([^'"]+)\1/g, (m) => ['import', m[2]]],
    [/\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g, (m) => ['import', m[2]]],
  ];
  for (const [re, read] of patterns) {
    for (const m of code.matchAll(re)) {
      const [kind, spec] = read(m);
      yield { kind, spec, index: m.index };
    }
  }
}

/**
 * .ts/.js. Outside ui/: any import of the Dialog module is an alias a page
 * could take one step away. In ui/: a re-export is. Outside ui/Dialog/ and
 * ui/Popover/: a showModal() call or a Melt modal builder is own-dialog.
 */
function checkScriptFile(file, source, ctx, report) {
  const code = blankComments(source);
  const inUi = isInside(ctx.uiDir, file);
  for (const { kind, spec, index } of moduleSpecifiers(code)) {
    if (!resolveSpecifier(file, spec, ctx)) continue;
    if (!inUi) {
      report(index, 'alias', `a .ts/.js file outside ui/ imports the Dialog module ('${spec}'); its parts are tags in .svelte files only`);
    } else if (kind === 'export') {
      report(index, 'alias', reexportDetail(spec));
    }
  }
  if (!ctx.ownDialogExempt(file)) {
    for (const m of code.matchAll(/\.showModal\s*(?:\?\.\s*)?\(/g)) {
      report(m.index, 'own-dialog', '.showModal() opens a hand-built native modal; build the modal from Dialog.Root/Content');
    }
    for (const m of code.matchAll(/\bimport\s*(type\s+)?\{([^}]*)\}\s*from\s*(['"])@melt-ui\/svelte\3/g)) {
      if (m[1]) continue;
      for (const spec of m[2].split(',')) {
        const [name, ...rest] = spec.trim().split(/\s+/);
        if (name === 'type' || !MODAL_BUILDERS.has(name) || rest.includes('type')) continue;
        report(m.index, 'own-dialog', `imports Melt's ${name}, a modal of its own; build it from the shared Dialog or Popover`);
      }
    }
  }
}

function checkSvelteFile(file, source, ctx, report) {
  let ast;
  try {
    ast = parse(source, { modern: true, filename: file });
  } catch (error) {
    report(error.position?.[0] ?? 0, 'parse', `does not parse, so it cannot be checked: ${error.message.split('\n')[0]}`);
    return;
  }
  const programs = [ast.module?.content, ast.instance?.content].filter(Boolean);
  const bindings = collectBindings(file, programs, ctx, report);
  checkValueReads([...programs, ast.fragment], bindings, report);
  checkMarkup(ast, bindings, report);
  if (!isInside(ctx.dialogDir, file)) {
    checkPartAttributes(ast.fragment, bindings, report);
    checkMarkupStyle(ast.fragment, report);
    if (ast.css) checkSvelteCss(ast.css, source, partClasses(ast, bindings), report);
  }
  if (!ctx.ownDialogExempt(file)) checkOwnDialog(ast, programs, report);
}

/** Every rule that applies to one file, by its kind and where it lives. */
function scanFile(file, source, ctx, report) {
  if (file.endsWith('.svelte')) checkSvelteFile(file, source, ctx, report);
  else if (isInside(ctx.dialogDir, file)) return;
  else if (file.endsWith('.css')) checkCssFile(source, report);
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
    partFiles: readPartFiles(dialogDir),
    // The shared Dialog and Popover are the only modals built by hand.
    ownDialogExempt: (file) => isInside(dialogDir, file) || isInside(popoverDir, file),
  };

  const found = [];
  const files = walkFiles(srcRoot, SCANNED_EXTS);
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const name = relative(cwd, file).split(sep).join('/');
    scanFile(file, source, ctx, (offset, rule, detail) =>
      found.push({ file: name, line: lineOf(source, offset), rule, detail })
    );
  }
  return { ...applyAllowlist(found, allowlist), filesScanned: files.length };
}

function main() {
  const { violations, allowlisted, stale, miscounted, filesScanned } = collectViolations();

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
        'See the header of apps/web/scripts/check-dialog-structure.mjs.'
    );
    process.exit(1);
  }

  console.log(
    `OK: every Dialog in ${filesScanned} file(s) is built from the shared parts ` +
      `(${allowlisted} known violation(s) allowlisted, in ${ALLOWLIST.length} entries).`
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
