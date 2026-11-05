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
 *   global-style   Outside ui/Dialog/, no `:global(...)` selector (and no
 *                  rule in a .css file) names a class the Dialog renders:
 *                  restyling the primitive from outside is how the four
 *                  hand-built drawers forked it. One exception: a rule whose
 *                  selector is exactly `.dialog-form` plus the page's own
 *                  class (`:global(.dialog-form.tier-form)`) may set spacing
 *                  (gap, padding*, margin*) and nothing else. Bare
 *                  `.dialog-form`, a combinator, or any other property
 *                  (display, flex*, overflow*, height, position…) fails.
 *   own-dialog     Outside lib/components/ui/, no element sets
 *                  role="dialog"/"alertdialog" or aria-modal: a modal is
 *                  built from the shared parts, not by hand.
 *   alias          The Dialog parts are used as tags only. A script-side
 *                  reference to the namespace (`const C = Dialog.Content`)
 *                  or a re-export of the module would hide a part from this
 *                  check, so either fails loudly instead.
 *   parse          A .svelte file that does not parse fails loudly.
 *
 * "Direct child" looks THROUGH {#if}/{#each}/{#key}/{#await}/{#snippet}
 * blocks and <svelte:boundary> (they render no element), and through a
 * `{@render s()}` of a snippet declared in the same file. A {@render} of
 * anything else (a `children` prop) cannot be proven and is a violation.
 *
 * AST-based (svelte/compiler `parse`, modern AST), not grep: blocks nest, and
 * the alias is RESOLVED from the file's imports (`* as Dialog`, `* as Modal`,
 * `{ Content as C }`, a default import of DialogContent.svelte, any $lib or
 * relative spelling), so `Card.Content` or `Tabs.Content` is never confused
 * with Dialog's. The part names come from ui/Dialog/index.ts itself.
 *
 * ALLOWLIST holds the offenders known when the gate landed, each with its
 * one-line reason. M2-M4 of the epic empty it. An entry that no longer
 * matches anything FAILS the gate, so a fixed file cannot keep its waiver.
 *
 * Exported (`collectViolations`) so the node:test suite can point the same
 * scan at fixture trees; `main()` runs only as the CLI entrypoint.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'svelte/compiler';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Known offenders at dev 86d928af0. `file` is relative to apps/web.
 * Every entry names the work package that removes it.
 */
export const ALLOWLIST = [
  {
    file: 'src/lib/components/studio/CustomerDetailDrawer.svelte',
    rule: 'content-child',
    reason: 'M3: hand-built drawer, sections straight in Content; moves to variant="drawer"',
  },
  {
    file: 'src/lib/components/studio/CustomerDetailDrawer.svelte',
    rule: 'global-style',
    reason: 'M3: overrides .dialog-content/.dialog-footer; replaced by variant="drawer"',
  },
  {
    file: 'src/lib/components/studio/media-library/MediaDrawer.svelte',
    rule: 'content-child',
    reason: 'M3: hand-built drawer, sections straight in Content; moves to variant="drawer" sheet',
  },
  {
    file: 'src/lib/components/studio/media-library/MediaDrawer.svelte',
    rule: 'global-style',
    reason: 'M3: overrides .dialog-content; replaced by variant="drawer" sheet',
  },
  {
    file: 'src/lib/components/ui/CreatorCard/CreatorProfileDrawer.svelte',
    rule: 'content-child',
    reason: 'M3: hand-built drawer, sections straight in Content; moves to variant="drawer"',
  },
  {
    file: 'src/lib/components/ui/CreatorCard/CreatorProfileDrawer.svelte',
    rule: 'global-style',
    reason: 'M3: overrides .dialog-content/.dialog-close/.dialog-overlay; replaced by the variant props',
  },
  {
    file: 'src/lib/components/ui/FilterDrawer/FilterDrawer.svelte',
    rule: 'global-style',
    reason: 'M3: the fourth drawer (glass rail); moves to variant="drawer" floating sheet + Footer align="between"',
  },
  {
    file: 'src/lib/components/command-palette/CommandPalette.svelte',
    rule: 'own-dialog',
    reason: 'M4: hand-built overlay; moves to the shared Dialog',
  },
  {
    file: 'src/lib/components/search/CommandPaletteSearch.svelte',
    rule: 'own-dialog',
    reason: 'M4: hand-built overlay; moves to the shared Dialog',
  },
  {
    file: 'src/lib/components/layout/MobileNav/MobileBottomSheet.svelte',
    rule: 'own-dialog',
    reason: 'M4: hand-built bottom sheet; moves to variant="drawer" sheet or keeps a reason',
  },
  {
    file: 'src/lib/components/ui/Dialog/DialogScrollControl.stories.svelte',
    rule: 'content-child',
    reason: 'Permanent: the calibration control, the raw wrapper this gate bans; the scroll proof must read it CLIPPED',
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

// All a page may set on its own Dialog.Form class. Anything else could
// decide whether the form passes the panel's column down to Body.
const SPACING_PROP = /^(gap|row-gap|column-gap|padding(-[a-z]+)*|margin(-[a-z]+)*)$/;
// Two or more classes and nothing else: `.dialog-form` plus the page's own.
const OWN_FORM_COMPOUND = /^(?:\.[\w-]+){2,}$/;

/** The parts each container part may hold directly, and the rule's name. */
const CHILD_RULES = {
  Content: { rule: 'content-child', allowed: new Set(['Header', 'Toolbar', 'Body', 'Footer', 'Form']) },
  Form: { rule: 'form-child', allowed: new Set(['Toolbar', 'Body', 'Footer']) },
};

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
  let target;
  if (spec === '$lib' || spec.startsWith('$lib/')) target = join(ctx.libRoot, spec.slice(4));
  else if (spec.startsWith('.')) target = resolve(dirname(importer), spec);
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

/** A script that reads a Dialog binding as a value can rename a part. */
function checkScriptReferences(programs, bindings, report) {
  const namespaces = new Set([...bindings].filter(([, b]) => b.namespace).map(([name]) => name));
  if (namespaces.size === 0) return;
  walk(programs, (node) => {
    if (node.type === 'ImportDeclaration') return false;
    if (node.type === 'Identifier' && namespaces.has(node.name)) {
      report(node.start, 'alias', `'${node.name}' is read in script; use its parts as <${node.name}.X> tags only`);
    }
  });
}

/** The Dialog part a markup node renders, or null. */
function partOf(node, bindings) {
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

function checkMarkup(ast, bindings, report) {
  const scope = { bindings, snippets: collectSnippets(ast.fragment), report };
  walk(ast.fragment, (node) => {
    const part = partOf(node, bindings);
    if (CHILD_RULES[part]) checkChildren(node, part, scope);
  });
}

function staticAttrValue(attr) {
  if (attr.value === true) return '';
  const parts = Array.isArray(attr.value) ? attr.value : [attr.value];
  return parts
    .map((p) => (p.type === 'Text' ? p.data : typeof p.expression?.value === 'string' ? p.expression.value : ''))
    .join('');
}

/** What a hand-built modal attribute claims, or null. */
function ownDialogAttr(attr) {
  if (attr.type !== 'Attribute') return null;
  if (attr.name === 'aria-modal') return 'aria-modal';
  return attr.name === 'role' && /\b(alert)?dialog\b/.test(staticAttrValue(attr)) ? 'role="dialog"' : null;
}

function checkOwnDialog(ast, report) {
  walk(ast.fragment, (node) => {
    if (!Array.isArray(node.attributes) || !node.fragment) return;
    for (const attr of node.attributes) {
      const claim = ownDialogAttr(attr);
      if (claim) report(attr.start, 'own-dialog', `${describe(node)} sets ${claim}; build the modal from Dialog.Root/Content`);
    }
  });
}

/** Each selector in a list, with `:global(...)` / `:global` unwrapped. */
function selectors(prelude) {
  const plain = prelude.replace(/:global\(((?:[^()]|\([^()]*\))*)\)/g, '$1').replace(/:global\b/g, '');
  return plain.split(',').map((selector) => selector.trim());
}

/**
 * Why a global rule breaks the Dialog, or null. Naming any Dialog class is a
 * restyle, except `.dialog-form.<own-class>` on its own, with spacing only.
 */
function restyleDetail(prelude, properties) {
  const classes = [...prelude.matchAll(DIALOG_CLASS_RE)].map((m) => m[1]);
  const text = prelude.replace(/\s+/g, ' ').trim();
  const other = classes.find((c) => c !== 'dialog-form');
  if (other) return `${text} restyles the Dialog's .${other}`;
  if (classes.length === 0) return null;
  const loose = selectors(prelude).find((s) => /\.dialog-form(?![\w-])/.test(s) && !OWN_FORM_COMPOUND.test(s));
  if (loose !== undefined) return `${text}: style a Dialog.Form only as .dialog-form.<your-class>, with nothing around it`;
  const notSpacing = properties.filter((p) => !SPACING_PROP.test(p));
  if (notSpacing.length === 0) return null;
  return `${text} sets ${notSpacing.join(', ')} on .dialog-form; only gap, padding and margin may change`;
}

function checkSvelteCss(css, source, report) {
  const visit = (node, inGlobal) => {
    if (node.type === 'Atrule') {
      for (const child of node.block?.children ?? []) visit(child, inGlobal);
      return;
    }
    if (node.type !== 'Rule') return;
    const prelude = source.slice(node.prelude.start, node.prelude.end);
    const global = inGlobal || prelude.includes(':global');
    const properties = node.block.children.filter((c) => c.type === 'Declaration').map((c) => c.property);
    const detail = global && restyleDetail(prelude, properties);
    if (detail) report(node.start, 'global-style', detail);
    for (const child of node.block.children) visit(child, global);
  };
  for (const node of css.children) visit(node, false);
}

/** A .css file is global through and through: every innermost rule counts. */
function checkCssFile(source, report) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const properties = m[2].split(';').map((d) => d.split(':')[0].trim().toLowerCase()).filter(Boolean);
    const detail = restyleDetail(m[1], properties);
    if (detail) report(m.index + m[1].search(/\S/), 'global-style', detail);
  }
}

/** .ts/.js: only a re-export can smuggle the module past the check. */
function checkReexports(file, source, ctx, report) {
  for (const m of source.matchAll(/export\s+[^'";]*?\s+from\s+(['"])([^'"]+)\1/g)) {
    if (resolveSpecifier(file, m[2], ctx)) report(m.index, 'alias', reexportDetail(m[2]));
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
  checkScriptReferences(programs, bindings, report);
  checkMarkup(ast, bindings, report);
  if (ast.css && !isInside(ctx.dialogDir, file)) checkSvelteCss(ast.css, source, report);
  if (!isInside(ctx.uiDir, file)) checkOwnDialog(ast, report);
}

/** Every rule that applies to one file, by its kind and where it lives. */
function scanFile(file, source, ctx, report) {
  if (file.endsWith('.svelte')) checkSvelteFile(file, source, ctx, report);
  else if (isInside(ctx.dialogDir, file)) return;
  else if (file.endsWith('.css')) checkCssFile(source, report);
  else checkReexports(file, source, ctx, report);
}

/** Waive what the allowlist names; an entry that waives nothing is stale. */
function applyAllowlist(found, allowlist) {
  const used = new Set();
  const violations = found.filter((v) => {
    const entry = allowlist.find((a) => a.file === v.file && a.rule === v.rule);
    if (entry) used.add(entry);
    return !entry;
  });
  const stale = allowlist.filter((a) => !used.has(a));
  return { violations, allowlisted: found.length - violations.length, stale };
}

/**
 * Core scan, pure over the tree it is pointed at. Paths in the result are
 * relative to `cwd`, with forward slashes, as the allowlist spells them.
 *
 * @returns {{ violations: {file:string,line:number,rule:string,detail:string}[],
 *   allowlisted: number, stale: typeof ALLOWLIST, filesScanned: number }}
 */
export function collectViolations({ srcRoot = join(WEB_ROOT, 'src'), cwd = WEB_ROOT, allowlist = ALLOWLIST } = {}) {
  if (!existsSync(srcRoot)) throw new Error(`Dialog structure gate: scan root does not exist: ${srcRoot}`);
  const libRoot = join(srcRoot, 'lib');
  const uiDir = join(libRoot, 'components', 'ui');
  const dialogDir = join(uiDir, 'Dialog');
  const ctx = { libRoot, uiDir, dialogDir, partFiles: readPartFiles(dialogDir) };

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
  const { violations, allowlisted, stale, filesScanned } = collectViolations();

  if (filesScanned === 0) {
    console.error('Dialog structure gate scanned 0 files: the scan root is misconfigured. Failing closed.');
    process.exit(1);
  }

  for (const v of violations) console.error(`${v.file}:${v.line} ${v.rule}: ${v.detail}`);
  for (const a of stale) {
    console.error(`${a.file} ${a.rule}: allowlisted but no longer violates. Delete its ALLOWLIST entry.`);
  }

  if (violations.length > 0 || stale.length > 0) {
    console.error(
      `\n${violations.length} violation(s), ${stale.length} stale allowlist entr${stale.length === 1 ? 'y' : 'ies'}. ` +
        'Every modal is Dialog.Root > Dialog.Content > Dialog.Header / Body / Footer, with Dialog.Form ' +
        '(> Body / Footer) when they submit together; a drawer is <Dialog.Content variant="drawer">. ' +
        'See the header of apps/web/scripts/check-dialog-structure.mjs.'
    );
    process.exit(1);
  }

  console.log(
    `OK: every Dialog in ${filesScanned} file(s) is built from the shared parts ` +
      `(${allowlisted} known violation(s) allowlisted, in ${ALLOWLIST.length} entries).`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
