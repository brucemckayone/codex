// @vitest-environment node
/**
 * No `var()` without a fallback names a property nothing defines
 * (Codex-1g5lh.6). An undefined custom property is guaranteed-invalid, and a
 * declaration that reads one with no fallback is invalid at computed-value
 * time. `--_logo-base: var(--space-48)` made the logo-hero base invalid, so
 * `height: calc(var(--_logo-base) * …)` fell back to `height: auto` and the
 * desktop logo sat at its intrinsic 26px whatever the Scale dial said. A
 * `transition` naming `--duration-default` was dropped whole. No browser
 * reports either.
 *
 * Every region is read by its own parser, never by a regex over raw text:
 * CSS (stylesheets and `<style>`) by Svelte's CSS parser, markup and component
 * scripts by Svelte's, `.ts` by TypeScript's. So a `/*` in an HTML comment, a
 * glob or a URL hides nothing. A regex-stripped first version blanked 145
 * lines of PageHeader.svelte behind `studio/*` in its doc comment.
 *
 * Defined means one of: a custom-property declaration (but not
 * `--x: initial`, which is the invalid value) in CSS or an inline `style`,
 * `@property --x`, a Svelte `style:--x` directive or `--x=` component prop
 * (whose text value, like any attribute's, is read for bare references too),
 * an object key `'--x': …`, `setProperty('--x', …)`, or `--x:` written into a
 * string or template (an inline style built in script).
 *
 * A brand INPUT is a `--brand-*` name that no stylesheet or markup writes as
 * text, only script: the brand editor's runtime overrides (`--brand-{key}`
 * and `-dark` for BRAND_PREFIX_KEYS, written by built name) and the org
 * layout's inputs, which it sets only when the org has that setting. Inputs
 * are OPTIONAL: read bare, outside a custom property, one fails. A custom
 * property whose every definition reads an optional name bare is optional in
 * turn, so the rule follows an input through `style:` directives, `--x=`
 * props and declarations alike.
 *
 * Out of scope: WHERE a name is defined. A name declared only under
 * `[data-org-brand]` counts as defined even where a component reads it on a
 * platform route; no static check knows where a component renders.
 * spacing-lockstep.test.ts guards that for the spacing scale.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AST, parse, parseCss } from 'svelte/compiler';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';
import { BRAND_PREFIX_KEYS } from '$lib/brand-editor/css-injection';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../../..');

/** Tests, stories, harnesses and mocks set whatever properties they like. */
const TEST_ONLY =
  /\.(test|spec)\.ts$|\.d\.ts$|\.stories\.svelte$|\.test\.svelte$|\.test\.svelte\.ts$|\.mock\.svelte\.ts$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.'))
      return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (TEST_ONLY.test(name)) return [];
    return /\.(css|svelte|ts)$/.test(name) ? [path] : [];
  });
}

interface Scan {
  /** A null value: set from script, at runtime; a string: written as text. */
  definitions: { name: string; value: string | null }[];
  /** Bare reads, and the custom property whose value holds each, if any. */
  reads: { name: string; line: number; into: string | null }[];
}

/** The names a text reads with no fallback; an empty fallback is none. */
function bareVars(text: string): string[] {
  return [...text.matchAll(/\bvar\(\s*(--[\w-]+)\s*(?:,\s*)?/gi)]
    .filter((m) => text[(m.index ?? 0) + m[0].length] === ')')
    .map((m) => m[1]);
}

/** A declaration of `name` with `value`, and the bare reads in that value. */
function declare(name: string, raw: string, line: number, out: Scan) {
  const custom = name.startsWith('--');
  const value = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  if (custom && value.trim() !== 'initial')
    out.definitions.push({ name, value });
  for (const read of bareVars(value))
    out.reads.push({ name: read, line, into: custom ? name : null });
}

type CssNode = AST.CSS.Rule | AST.CSS.Atrule | AST.CSS.Declaration;

function scanCss(
  nodes: ReadonlyArray<CssNode>,
  lineAt: (offset: number) => number,
  out: Scan
): void {
  for (const node of nodes) {
    if (node.type === 'Declaration') {
      declare(node.property, node.value, lineAt(node.start), out);
    } else if (node.type === 'Atrule') {
      if (node.name === 'property')
        out.definitions.push({ name: node.prelude.trim(), value: null });
      if (node.block) scanCss(node.block.children, lineAt, out);
    } else {
      scanCss(node.block.children, lineAt, out);
    }
  }
}

/** An inline `style` text: `a: b; --c: d`. Interpolations stand in as `0`. */
function scanInlineStyle(text: string, line: number, out: Scan) {
  for (const part of text.split(';')) {
    const colon = part.indexOf(':');
    if (colon > 0)
      declare(part.slice(0, colon).trim(), part.slice(colon + 1), line, out);
  }
}

/** A string or template in script: bare reads, and `--x:` written into it. */
function scanScriptText(text: string, line: number, out: Scan) {
  for (const read of bareVars(text))
    out.reads.push({ name: read, line, into: null });
  for (const m of text.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g))
    out.definitions.push({ name: m[1], value: null });
}

type Node = { type: string; start: number } & Record<string, unknown>;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isNode = (value: unknown): value is Node =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof value.type === 'string' &&
  'start' in value &&
  typeof value.start === 'number';
const stringOf = (value: unknown) =>
  isNode(value) && value.type === 'Literal' && typeof value.value === 'string'
    ? value.value
    : null;
/** A template literal quasi's text. */
function cookedOf(quasi: unknown): string {
  if (!isNode(quasi)) return '';
  const { value } = quasi;
  if (typeof value !== 'object' || value === null || !('cooked' in value))
    return '';
  return typeof value.cooked === 'string' ? value.cooked : '';
}
/** Markup parts as text, interpolations as `0`; null for a lone expression. */
function textOf(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;
  return parts
    .map((p) =>
      isNode(p) && p.type === 'Text' && typeof p.data === 'string'
        ? p.data
        : '0'
    )
    .join('');
}

/** A markup attribute or directive: a property written as text, or set from script. */
function scanAttribute(name: string, value: unknown, line: number, out: Scan) {
  const text = textOf(value);
  if (text !== null) declare(name, text, line, out);
  else if (name.startsWith('--')) out.definitions.push({ name, value: null });
}

/** Svelte markup and its scripts (ESTree), at any depth. */
function scanTree(
  value: unknown,
  lineAt: (offset: number) => number,
  out: Scan
): void {
  if (typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) scanTree(item, lineAt, out);
    return;
  }
  if (isNode(value)) visit(value, lineAt, out);
  for (const [key, child] of Object.entries(value))
    if (key !== 'metadata') scanTree(child, lineAt, out);
}

function visit(node: Node, lineAt: (offset: number) => number, out: Scan) {
  const line = lineAt(node.start);
  const name = typeof node.name === 'string' ? node.name : '';
  switch (node.type) {
    case 'Attribute':
      if (name === 'style')
        scanInlineStyle(textOf(node.value) ?? '', line, out);
      else scanAttribute(name, node.value, line, out);
      break;
    case 'StyleDirective':
      scanAttribute(name, node.value, line, out);
      break;
    case 'RegularElement': {
      // A `<style>` inside markup (`<svelte:head>`, `<svg>`, `{#if}`).
      const nodes = isRecord(node.fragment) ? node.fragment.nodes : null;
      const first = Array.isArray(nodes) ? nodes[0] : null;
      if (name === 'style' && isNode(first)) {
        const base = first.start;
        scanCss(
          parseCss(textOf(nodes) ?? '').children,
          (offset) => lineAt(base + offset),
          out
        );
      }
      break;
    }
    case 'Literal':
      if (typeof node.value === 'string') scanScriptText(node.value, line, out);
      break;
    case 'TemplateLiteral':
      if (Array.isArray(node.quasis))
        scanScriptText(node.quasis.map(cookedOf).join('0'), line, out);
      break;
    case 'Property': {
      const key = stringOf(node.key);
      if (key?.startsWith('--'))
        out.definitions.push({ name: key, value: null });
      break;
    }
    case 'CallExpression': {
      const callee = node.callee;
      const first = Array.isArray(node.arguments) ? node.arguments[0] : null;
      const property =
        isNode(callee) && callee.type === 'MemberExpression'
          ? callee.property
          : null;
      const arg = stringOf(first);
      if (
        isNode(property) &&
        property.name === 'setProperty' &&
        arg?.startsWith('--')
      )
        out.definitions.push({ name: arg, value: null });
      break;
    }
  }
}

function scanTs(file: string, text: string, out: Scan) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
  const lineOf = (node: ts.Node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const walk = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      scanScriptText(node.text, lineOf(node), out);
    else if (ts.isTemplateExpression(node))
      scanScriptText(
        [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(
          '0'
        ),
        lineOf(node),
        out
      );
    if (
      ts.isPropertyAssignment(node) &&
      ts.isStringLiteral(node.name) &&
      node.name.text.startsWith('--')
    )
      out.definitions.push({ name: node.name.text, value: null });
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'setProperty'
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg) && arg.text.startsWith('--'))
        out.definitions.push({ name: arg.text, value: null });
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
}

function scanFile(file: string, text: string): Scan {
  const out: Scan = { definitions: [], reads: [] };
  // Line starts, so an offset's line is a binary search, not a re-split.
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1))
    starts.push(i + 1);
  const lineAt = (offset: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  try {
    if (file.endsWith('.css')) scanCss(parseCss(text).children, lineAt, out);
    else if (file.endsWith('.svelte')) {
      const ast = parse(text, { modern: true });
      if (ast.css) scanCss(ast.css.children, lineAt, out);
      for (const part of [ast.fragment, ast.instance, ast.module])
        scanTree(part, lineAt, out);
    } else scanTs(file, text, out);
  } catch (error) {
    throw new Error(`${file} did not parse: ${String(error)}`);
  }
  return out;
}

const RUNTIME_INPUTS = [...BRAND_PREFIX_KEYS].flatMap((key) => [
  `--brand-${key}`,
  `--brand-${key}-dark`,
]);

function violations(files: Record<string, string>): string[] {
  const scans = Object.entries(files).map(
    ([file, text]) => [file, scanFile(file, text)] as const
  );
  const definitions = new Map<string, (string | null)[]>();
  for (const [, scan] of scans)
    for (const { name, value } of scan.definitions)
      definitions.set(name, [...(definitions.get(name) ?? []), value]);
  // An input: a `--brand-*` name nothing writes as text, only script (or the
  // brand editor, by built name). Each is set only when the org has it.
  const written = (name: string) =>
    (definitions.get(name) ?? []).some((value) => value !== null);
  const optional = new Set(
    [...RUNTIME_INPUTS, ...definitions.keys()].filter(
      (name) => name.startsWith('--brand-') && !written(name)
    )
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, values] of definitions)
      if (
        !optional.has(name) &&
        values.every(
          (v) => v !== null && bareVars(v).some((r) => optional.has(r))
        )
      ) {
        optional.add(name);
        grew = true;
      }
  }
  return scans.flatMap(([file, scan]) =>
    scan.reads.flatMap(({ name, line, into }) => {
      if (optional.has(name))
        return into
          ? []
          : [`${file}:${line} ${name} is optional: read it with a fallback`];
      return definitions.has(name) ? [] : [`${file}:${line} ${name}`];
    })
  );
}

const KEY = [...BRAND_PREFIX_KEYS][0];

describe('custom property references', () => {
  test('the check flags an undefined name and nothing else', () => {
    expect(
      violations({
        'a.css': `a {
  --x: 1px;
  width: var(--x);
  height: var(--missing);
  top: var(--missing, 0);
  /* left: var(--in-a-comment); */
  margin: var(--x,);
  padding: VAR(--shouting);
}`,
      })
    ).toEqual(['a.css:4 --missing', 'a.css:8 --shouting']);
  });

  test('an empty fallback is no fallback', () => {
    expect(violations({ 'a.css': 'a { width: var(--gone, ); }' })).toEqual([
      'a.css:1 --gone',
    ]);
  });

  test('a definition counts in every form the codebase writes one', () => {
    const forms = {
      'a.svelte': `<div style:--a={v} style="--b: 1px"></div>
<Child --c="2px" />
<script lang="ts">el.style.setProperty('--d', v); const s = { '--e': v }; const t = \`--f: \${v}\`;</script>
<style>@property --g { syntax: '<length>'; inherits: false; initial-value: 0px; }</style>`,
      'b.ts': `el.style.setProperty('--h', v); export const s = { '--i': v };`,
      'c.css': `a { x: var(--a) var(--b) var(--c) var(--d) var(--e) var(--f) var(--g) var(--h) var(--i); }`,
    };
    expect(violations(forms)).toEqual([]);
  });

  test('text that only looks like a definition is not one', () => {
    const lookalikes = {
      'a.css': `@container style(--j: 1) { a { width: 0; } }
a { --k: initial; }
.logo--large:hover { width: 0; }`,
      'b.ts': `switch (p) { case '--l': break; }
const q = p ? '--m' : '';
type T = { '--n': string };`,
      'c.css':
        'b { x: var(--j) var(--k) var(--large) var(--l) var(--m) var(--n); }',
    };
    expect(violations(lookalikes)).toEqual(
      ['--j', '--k', '--large', '--l', '--m', '--n'].map((n) => `c.css:1 ${n}`)
    );
  });

  test('a comment marker inside other text hides nothing after it', () => {
    const traps = {
      'a.svelte': `<!-- @component studio/* layouts -->
<p>and // or</p>
<script lang="ts">const g = import.meta.glob('./blocks/*.svelte'); const h = '<!--';</script>
<style>a { background: url(/img/*.png); width: var(--after-traps); }</style>`,
    };
    expect(violations(traps)).toEqual(['a.svelte:4 --after-traps']);
  });

  test('a runtime brand input is optional: read bare, it needs a fallback, through every property built on it', () => {
    expect(
      violations({
        'a.css': `a {
  opacity: var(--brand-${KEY});
  --w: var(--brand-${KEY});
  width: var(--w);
  height: var(--w, 1px);
}`,
      })
    ).toEqual([
      `a.css:2 --brand-${KEY} is optional: read it with a fallback`,
      'a.css:4 --w is optional: read it with a fallback',
    ]);
  });

  test('an attribute’s text is read, and an input stays optional through a prop or directive', () => {
    const files = {
      'a.svelte': `<Icon height="var(--missing-attr)" />
<Child --y="var(--brand-${KEY})" />
<div style:--z="var(--brand-${KEY})"></div>
<style>a { width: var(--y); height: var(--z); }</style>`,
    };
    expect(violations(files).sort()).toEqual(
      [
        'a.svelte:1 --missing-attr',
        'a.svelte:4 --y is optional: read it with a fallback',
        'a.svelte:4 --z is optional: read it with a fallback',
      ].sort()
    );
  });

  test('a brand input the layout sets only from script is optional', () => {
    const files = {
      'a.svelte': `<script>const vars = { '--brand-from-script': v };</script>
<div style:--brand-from-directive={v}></div>
<style>a { color: var(--brand-from-script); top: var(--brand-from-directive); }</style>`,
    };
    expect(violations(files).sort()).toEqual(
      [
        'a.svelte:3 --brand-from-directive is optional: read it with a fallback',
        'a.svelte:3 --brand-from-script is optional: read it with a fallback',
      ].sort()
    );
  });

  test('a <style> inside markup is read, and a comment inside var() hides nothing', () => {
    const files = {
      'a.svelte':
        '<svelte:head><style>a { width: var(--in-head); }</style></svelte:head>',
      'b.css': 'a { width: var(--commented /* why */); }',
    };
    expect(violations(files).sort()).toEqual(
      ['a.svelte:1 --in-head', 'b.css:1 --commented'].sort()
    );
  });

  test('none is undefined, and no optional input is read bare, anywhere under src', () => {
    const files = sourceFiles(src);
    expect(files.length).toBeGreaterThan(500);
    const texts = Object.fromEntries(
      files.map((file) => [relative(src, file), readFileSync(file, 'utf8')])
    );
    // Parses every product file (~1,300) with its own parser.
    expect(violations(texts)).toEqual([]);
  }, 60_000);
});
