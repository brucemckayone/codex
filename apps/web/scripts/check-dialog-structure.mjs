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
 *   content-child  A Dialog.Content's direct child is Dialog.Header, Body,
 *                  Footer or Form. Nothing else.
 *   form-child     A Dialog.Form's direct child is Dialog.Body or Footer.
 *   global-style   Outside ui/Dialog/, no `:global(...)` selector (and no
 *                  rule in a .css file) names a class the Dialog renders:
 *                  restyling the primitive from outside is how the three
 *                  hand-built drawers forked it.
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
    file: 'src/routes/_org/[slug]/studio/monetisation/+page.svelte',
    rule: 'content-child',
    reason: 'M2: the tier dialog wraps Body in a raw .tier-form; it moves to Dialog.Form',
  },
  {
    file: 'src/routes/_org/[slug]/studio/monetisation/pricing-faq/+page.svelte',
    rule: 'content-child',
    reason: 'M2: the FAQ dialog has a raw .faq-edit-form and no Body; it moves to Dialog.Form',
  },
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
    reason: 'UNOWNED: a fourth drawer (floating glass rail) the audit missed; restyles .dialog-content/.dialog-footer/.dialog-title',
  },
  {
    file: 'src/lib/components/studio/media-library/MediaPickerDialog.svelte',
    rule: 'content-child',
    reason: 'UNOWNED: a working hand-written .picker-form (Header inside it); moves to Dialog.Form, Header outside',
  },
  {
    file: 'src/lib/components/studio/ownership/OwnershipOfferDialog.svelte',
    rule: 'content-child',
    reason: 'UNOWNED: a working display:contents form (Header inside it); moves to Dialog.Form, Header outside',
  },
  {
    file: 'src/routes/_org/[slug]/studio/journeys/[id]/curriculum/+page.svelte',
    rule: 'content-child',
    reason: 'UNOWNED: the picker search bar sits between Header and Body; works today, belongs in Header or Body',
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
    file: 'src/lib/components/editor/EditorToolbar.svelte',
    rule: 'own-dialog',
    reason: 'M4: the link popover sets role="dialog"; M4 decides Dialog or a non-modal popover',
  },
  {
    file: 'src/lib/components/AudioPlayer/ImmersiveShaderPlayer.svelte',
    rule: 'own-dialog',
    reason: 'M4 (report-only): a full-screen player, not a panel; M4 classifies it',
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
  'dialog-body',
  'dialog-form',
  'dialog-footer',
];
// A class token, not a prefix: `.dialog-content` must not match inside
// `.dialog-content-wrapper`, which is listed on its own.
const DIALOG_CLASS_RE = new RegExp(`\\.(${DIALOG_CLASSES.join('|')})(?![\\w-])`);

const CONTENT_CHILDREN = new Set(['Header', 'Body', 'Footer', 'Form']);
const FORM_CHILDREN = new Set(['Body', 'Footer']);

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

/** Local name -> { namespace: true } | { part: 'Content' } for one file. */
function collectBindings(file, programs, ctx, report) {
  const bindings = new Map();
  for (const program of programs) {
    for (const stmt of program.body) {
      const isReexport =
        (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportAllDeclaration') && stmt.source;
      if (isReexport && resolveSpecifier(file, stmt.source.value, ctx)) {
        report(stmt.start, 'alias', `re-exports the Dialog module ('${stmt.source.value}'), which hides it from this check`);
      }
      if (stmt.type !== 'ImportDeclaration') continue;
      const target = resolveSpecifier(file, stmt.source.value, ctx);
      if (!target) continue;
      for (const s of stmt.specifiers) {
        if (target.part) {
          if (s.type === 'ImportDefaultSpecifier') bindings.set(s.local.name, { part: target.part });
        } else if (s.type === 'ImportNamespaceSpecifier') {
          bindings.set(s.local.name, { namespace: true });
        } else if (s.type === 'ImportSpecifier') {
          bindings.set(s.local.name, { part: s.imported.name ?? s.imported.value });
        }
      }
    }
  }
  return bindings;
}

/** A script that reads a Dialog binding as a value can rename a part. */
function checkScriptReferences(programs, bindings, report) {
  const namespaces = new Set([...bindings].filter(([, b]) => b.namespace).map(([name]) => name));
  if (namespaces.size === 0) return;
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'ImportDeclaration') return;
    if (node.type === 'Identifier' && namespaces.has(node.name)) {
      report(node.start, 'alias', `'${node.name}' is read in script; use its parts as <${node.name}.X> tags only`);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  programs.forEach(visit);
}

/** The Dialog part a markup node renders, or null. */
function partOf(node, bindings) {
  if (node.type !== 'Component') return null;
  const dot = node.name.indexOf('.');
  if (dot === -1) return bindings.get(node.name)?.part ?? null;
  const ns = bindings.get(node.name.slice(0, dot));
  return ns?.namespace ? node.name.slice(dot + 1) : null;
}

function collectSnippets(fragment, snippets = new Map()) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === 'SnippetBlock' && !snippets.has(node.expression.name)) {
      snippets.set(node.expression.name, node);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'type' || key === 'metadata') continue;
      if (value && typeof value === 'object') visit(value);
    }
  };
  visit(fragment);
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
  if (!fragment) return;
  for (const node of fragment.nodes) {
    if (node.type === 'Text') {
      if (node.data.trim() !== '') yield node;
    } else if (SILENT_NODES.has(node.type)) {
      // renders nothing
    } else if (TRANSPARENT_BLOCKS[node.type]) {
      for (const inner of TRANSPARENT_BLOCKS[node.type](node)) {
        yield* directChildren(inner, snippets, onUnknown, seen);
      }
    } else if (node.type === 'RenderTag') {
      const name = renderCallee(node);
      const snippet = name && snippets.get(name);
      if (!snippet) onUnknown(node, name);
      else if (!seen.has(snippet)) {
        yield* directChildren(snippet.body, snippets, onUnknown, new Set([...seen, snippet]));
      }
    } else {
      yield node;
    }
  }
}

function describe(node) {
  if (node.type === 'Text') return 'text';
  if (node.type === 'ExpressionTag') return '{expression}';
  if (node.type === 'HtmlTag') return '{@html}';
  return node.name ? `<${node.name}>` : node.type;
}

function checkMarkup(ast, bindings, report) {
  const snippets = collectSnippets(ast.fragment);
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const part = partOf(node, bindings);
    const allowed = part === 'Content' ? CONTENT_CHILDREN : part === 'Form' ? FORM_CHILDREN : null;
    if (allowed) {
      const rule = part === 'Content' ? 'content-child' : 'form-child';
      const onUnknown = (tag, name) =>
        report(tag.start, rule, `{@render ${name ?? '…'}()} directly in Dialog.${part} renders what this check cannot see`);
      for (const child of directChildren(node.fragment, snippets, onUnknown)) {
        const childPart = partOf(child, bindings);
        if (!allowed.has(childPart)) {
          const want = [...allowed].map((p) => `Dialog.${p}`).join(' / ');
          // A Text node starts at the whitespace before its words.
          const at = child.type === 'Text' ? child.start + child.data.search(/\S/) : child.start;
          report(at, rule, `${describe(child)} is a direct child of Dialog.${part}; only ${want}`);
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'type' || key === 'metadata') continue;
      if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast.fragment);
}

function staticAttrValue(attr) {
  if (attr.value === true) return '';
  const parts = Array.isArray(attr.value) ? attr.value : [attr.value];
  return parts
    .map((p) => (p.type === 'Text' ? p.data : typeof p.expression?.value === 'string' ? p.expression.value : ''))
    .join('');
}

function checkOwnDialog(ast, report) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (Array.isArray(node.attributes) && node.fragment) {
      for (const attr of node.attributes) {
        if (attr.type !== 'Attribute') continue;
        if (attr.name === 'aria-modal') {
          report(attr.start, 'own-dialog', `${describe(node)} sets aria-modal; build the modal from Dialog.Root/Content`);
        } else if (attr.name === 'role' && /\b(alert)?dialog\b/.test(staticAttrValue(attr))) {
          report(attr.start, 'own-dialog', `${describe(node)} sets role="dialog"; build the modal from Dialog.Root/Content`);
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'type' || key === 'metadata' || key === 'attributes') continue;
      if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast.fragment);
}

function checkSvelteCss(css, source, report) {
  const visit = (node, inGlobal) => {
    if (node.type === 'Rule') {
      const prelude = source.slice(node.prelude.start, node.prelude.end);
      const global = inGlobal || prelude.includes(':global');
      const hit = global && prelude.match(DIALOG_CLASS_RE);
      if (hit) report(node.start, 'global-style', `${prelude.replace(/\s+/g, ' ').trim()} restyles the Dialog's .${hit[1]}`);
      for (const child of node.block.children) visit(child, global);
    } else if (node.type === 'Atrule' && node.block) {
      for (const child of node.block.children) visit(child, inGlobal);
    }
  };
  for (const node of css.children) visit(node, false);
}

/** A .css file is global through and through: any rule naming the classes. */
function checkCssFile(source, report) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  for (const m of stripped.matchAll(/([^{}]+)\{/g)) {
    const hit = m[1].match(DIALOG_CLASS_RE);
    if (hit && !m[1].trim().startsWith('@')) {
      const offset = m.index + m[1].search(/\S/);
      report(offset, 'global-style', `${m[1].replace(/\s+/g, ' ').trim()} restyles the Dialog's .${hit[1]}`);
    }
  }
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
  const ctx = { libRoot, dialogDir, partFiles: readPartFiles(dialogDir) };

  const found = [];
  let filesScanned = 0;
  const rel = (file) => relative(cwd, file).split(sep).join('/');

  for (const file of walkFiles(srcRoot, ['.svelte', '.css', '.ts', '.js'])) {
    filesScanned += 1;
    const source = readFileSync(file, 'utf8');
    const report = (offset, rule, detail) => found.push({ file: rel(file), line: lineOf(source, offset), rule, detail });
    const inDialogDir = isInside(dialogDir, file);

    if (file.endsWith('.css')) {
      if (!inDialogDir) checkCssFile(source, report);
      continue;
    }
    if (!file.endsWith('.svelte')) {
      // .ts/.js: only a re-export can smuggle the module past the check.
      if (!inDialogDir && /\bexport\b[^;]*\bfrom\b/.test(source)) {
        for (const m of source.matchAll(/export\s+[^'";]*?\s+from\s+(['"])([^'"]+)\1/g)) {
          if (resolveSpecifier(file, m[2], ctx)) {
            report(m.index, 'alias', `re-exports the Dialog module ('${m[2]}'), which hides it from this check`);
          }
        }
      }
      continue;
    }

    let ast;
    try {
      ast = parse(source, { modern: true, filename: file });
    } catch (error) {
      report(error.position?.[0] ?? 0, 'parse', `does not parse, so it cannot be checked: ${error.message.split('\n')[0]}`);
      continue;
    }
    const programs = [ast.module?.content, ast.instance?.content].filter(Boolean);
    const bindings = collectBindings(file, programs, ctx, report);
    checkScriptReferences(programs, bindings, report);
    checkMarkup(ast, bindings, report);
    if (ast.css && !inDialogDir) checkSvelteCss(ast.css, source, report);
    if (!isInside(uiDir, file)) checkOwnDialog(ast, report);
  }

  const used = new Set();
  const violations = found.filter((v) => {
    const entry = allowlist.find((a) => a.file === v.file && a.rule === v.rule);
    if (entry) used.add(entry);
    return !entry;
  });
  const stale = allowlist.filter((a) => !used.has(a));
  return { violations, allowlisted: found.length - violations.length, stale, filesScanned };
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
