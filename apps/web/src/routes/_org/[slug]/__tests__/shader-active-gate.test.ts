// @vitest-environment node
/**
 * The org layout's `data-hero-shader-active` is the tokens' claim, corrected
 * by the fullpage shader's own report.
 *
 * About 25 page-kit and layout rules read it, so a claim that a shader runs
 * when none draws (a renderer that failed, a dark theme resolving to 'none')
 * made them see-through over nothing. The rule itself is `heroShaderActive`
 * (unit-tested in org-grounds.test.ts), and the reports are ShaderHero's
 * (`shaderLive`, pinned in ShaderHero.svelte.test.ts). This pins the wiring
 * between them: the attribute is the helper's answer for `orgShader` and the
 * store, and the store's writer is the layout's one `tone` shader.
 *
 * A SOURCE test: the layout has no render harness. Comments are stripped
 * first, so prose cannot satisfy it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const LAYOUT = join(import.meta.dirname, '..', '+layout.svelte');

const code = readFileSync(LAYOUT, 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
  .replace(/\s+/g, ' ');

/** A node of Svelte's modern AST, read structurally. */
interface AstNode {
  type?: string;
  [key: string]: unknown;
}
const isNode = (value: unknown): value is AstNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The local names a component's scripts import ShaderHero under: the named
 * export from any barrel (`{ ShaderHero }`, `{ ShaderHero as Hero }`) or the
 * default export of ShaderHero.svelte; and each namespace import of a module
 * that provides it, with the member that is ShaderHero (`* as UI` from the
 * barrel: `<UI.ShaderHero>`; of ShaderHero.svelte: `<UI.default>`). Only the
 * ShaderHero barrel re-exports it, so another module's namespace (paraglide's
 * `* as m`) is not one.
 */
function shaderHeroImports(root: AstNode): {
  names: Set<string>;
  namespaces: Map<string, string>;
} {
  const names = new Set<string>();
  const namespaces = new Map<string, string>();
  for (const script of [root.module, root.instance]) {
    if (!isNode(script) || !isNode(script.content)) continue;
    const body = script.content.body;
    for (const node of Array.isArray(body) ? body : []) {
      if (!isNode(node) || node.type !== 'ImportDeclaration') continue;
      const from = isNode(node.source) ? String(node.source.value) : '';
      const specifiers = Array.isArray(node.specifiers) ? node.specifiers : [];
      for (const spec of specifiers) {
        if (!isNode(spec) || !isNode(spec.local)) continue;
        const local = String(spec.local.name);
        const imported = isNode(spec.imported) ? spec.imported.name : null;
        if (spec.type === 'ImportSpecifier' && imported === 'ShaderHero')
          names.add(local);
        if (
          spec.type === 'ImportDefaultSpecifier' &&
          from.endsWith('ShaderHero.svelte')
        )
          names.add(local);
        if (
          spec.type === 'ImportNamespaceSpecifier' &&
          from.includes('ShaderHero')
        )
          namespaces.set(
            local,
            from.endsWith('ShaderHero.svelte') ? 'default' : 'ShaderHero'
          );
      }
    }
  }
  return { names, namespaces };
}

/** Type-only positions: a name there cannot mount anything. */
const TYPE_ONLY = new Set([
  'TSTypeAnnotation',
  'TSTypeReference',
  'TSTypeQuery',
]);

/**
 * Fail CLOSED on a ShaderHero this counter cannot see mount: any use of an
 * imported ShaderHero other than as a tag (`<svelte:component
 * this={ShaderHero}>`, `const C = ShaderHero`, a namespace's
 * `UI.ShaderHero` in script) and any dynamic `import()` that may load it. A
 * miss there would let a second `tone` writer through the one-writer check.
 */
function assertOnlyTagUses(
  root: AstNode,
  names: Set<string>,
  namespaces: Map<string, string>
): void {
  const seen = new Set<object>();
  const fail = (what: string): never => {
    throw new Error(
      `toneWriters cannot count a ShaderHero used ${what}: mount it as a tag, or count this file by hand`
    );
  };
  const visit = (value: unknown, parent: AstNode | null, key: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, parent, key);
      return;
    }
    if (!isNode(value) || seen.has(value)) return;
    seen.add(value);
    if (value.type === 'ImportDeclaration') return;
    if (value.type && TYPE_ONLY.has(value.type)) return;
    if (value.type === 'ImportExpression') {
      const source = isNode(value.source) ? value.source : null;
      const literal =
        source?.type === 'Literal' && typeof source.value === 'string';
      if (!literal || String(source?.value).includes('ShaderHero'))
        fail('through a dynamic import()');
    }
    if (value.type === 'Identifier') {
      const name = String(value.name);
      // A property key or a non-computed member is a name, not a use.
      const isKey =
        (parent?.type === 'MemberExpression' &&
          key === 'property' &&
          !parent.computed) ||
        (parent?.type === 'Property' &&
          key === 'key' &&
          !parent.computed &&
          !parent.shorthand);
      if (!isKey && names.has(name)) fail(`as a value (${name})`);
      if (!isKey && namespaces.has(name)) {
        const member =
          parent?.type === 'MemberExpression' && key === 'object'
            ? parent
            : null;
        const prop =
          member && !member.computed && isNode(member.property)
            ? String(member.property.name)
            : null;
        // Another member is another export; the ShaderHero member, `UI[x]`
        // or a bare `UI` may be ShaderHero.
        if (prop === null || prop === namespaces.get(name))
          fail(`through its namespace (${name})`);
      }
    }
    for (const [childKey, child] of Object.entries(value)) {
      visit(child, value, childKey);
    }
  };
  visit(root.instance, null, '');
  visit(root.module, null, '');
  visit(root.fragment, null, '');
}

/** An attribute value that is the literal `{false}`. */
function isLiteralFalse(value: unknown): boolean {
  const tag = Array.isArray(value) ? value[0] : value;
  return (
    isNode(tag) &&
    tag.type === 'ExpressionTag' &&
    isNode(tag.expression) &&
    tag.expression.type === 'Literal' &&
    tag.expression.value === false
  );
}

/**
 * How many ShaderHero mounts in a component may write the shader report: one
 * with a `tone` attribute in any form (`tone`, `tone={x}`, `{tone}`) other
 * than `tone={false}`, or with a spread, which may carry it. Read with
 * Svelte's own parser, so quoted values, handlers and renamed imports read as
 * Svelte reads them (a hand-written tag reader missed `class="a>b" tone`).
 */
function toneWriters(source: string): number {
  const root: unknown = parse(source, { modern: true });
  if (!isNode(root)) throw new Error('svelte/compiler parse returned no AST');
  const { names, namespaces } = shaderHeroImports(root);
  assertOnlyTagUses(root, names, namespaces);
  const isShaderHero = (name: string): boolean => {
    if (names.has(name)) return true;
    const [ns, member, ...rest] = name.split('.');
    return (
      rest.length === 0 && member !== undefined && namespaces.get(ns) === member
    );
  };
  let writers = 0;
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isNode(value) || seen.has(value)) return;
    seen.add(value);
    if (value.type === 'Component' && isShaderHero(String(value.name))) {
      const attributes = Array.isArray(value.attributes)
        ? value.attributes
        : [];
      const writes = attributes.some(
        (attr) =>
          isNode(attr) &&
          (attr.type === 'SpreadAttribute' ||
            (attr.type === 'Attribute' &&
              attr.name === 'tone' &&
              !isLiteralFalse(attr.value)))
      );
      if (writes) writers++;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(root.fragment);
  return writers;
}

describe('the org layout’s shader gate', () => {
  it('is the tokens’ claim corrected by what the fullpage shader reports', () => {
    const gate = /data-hero-shader-active=\{(\w+) \? '' : undefined\}/.exec(
      code
    );
    expect(gate).not.toBeNull();
    const name = gate?.[1] ?? '';
    expect(code).toContain(
      `const ${name} = $derived( heroShaderActive( orgShader(data.org, brandEditor.isOpen ? brandEditor.pending : null), shaderLive.state ) );`
    );
  });

  it('has one writer for that report: the layout’s `tone` shader', () => {
    const mounts = code.match(/<ShaderHero\b[^>]*\/>/g) ?? [];
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toMatch(/\stone[\s/]/);
  });

  it('is the only `tone` ShaderHero in the app, so no other one writes the report', () => {
    // `shaderLive` keeps the last report, so a second `tone` instance (the
    // auth pane's, a preview's) would overwrite the layout's.
    const src = join(import.meta.dirname, '..', '..', '..', '..');
    const found: Record<string, number> = {};
    for (const file of readdirSync(src, { recursive: true }).map(String)) {
      if (!file.endsWith('.svelte') || file.includes('paraglide')) continue;
      if (file.includes('__tests__')) continue;
      const source = readFileSync(join(src, file), 'utf8');
      if (!source.includes('ShaderHero')) continue;
      const writers = toneWriters(source);
      if (writers > 0) found[file] = writers;
    }
    expect(found).toEqual({
      [join('routes', '_org', '[slug]', '+layout.svelte')]: 1,
    });
  });
});

describe('toneWriters, which the one-writer check counts with', () => {
  const barrel = "import { ShaderHero } from '$lib/components/ui/ShaderHero';";
  const mount = (tag: string, script = barrel) =>
    `<script lang="ts">\n${script}\nlet tone = true; let props = {}; let a = 1; let b = 2;\n</script>\n${tag}\n`;

  it.each([
    ['a bare tone', mount('<ShaderHero tone />')],
    ['tone={true}', mount('<ShaderHero tone={true} />')],
    ['the {tone} shorthand', mount('<ShaderHero {tone} />')],
    ['a spread, which may carry it', mount('<ShaderHero {...props} />')],
    ['a quoted > before tone', mount('<ShaderHero class="a>b" tone />')],
    [
      'a handler with > before tone',
      mount('<ShaderHero onclick={() => a > b} tone />'),
    ],
    ['inside a block', mount('{#if a}<ShaderHero tone />{/if}')],
    [
      'a renamed import',
      mount(
        '<Hero tone />',
        "import { ShaderHero as Hero } from '$lib/components/ui/ShaderHero';"
      ),
    ],
    [
      'the .svelte default import',
      mount(
        '<Hero tone />',
        "import Hero from '$lib/components/ui/ShaderHero/ShaderHero.svelte';"
      ),
    ],
    [
      'a namespace import',
      mount(
        '<UI.ShaderHero tone />',
        "import * as UI from '$lib/components/ui/ShaderHero';"
      ),
    ],
    [
      'a namespace of the .svelte module',
      mount(
        '<UI.default tone />',
        "import * as UI from '$lib/components/ui/ShaderHero/ShaderHero.svelte';"
      ),
    ],
  ])('counts %s', (_name, source) => {
    expect(toneWriters(source)).toBe(1);
  });

  it.each([
    ['no tone', mount('<ShaderHero preset="flow" />')],
    ['tone={false}', mount('<ShaderHero tone={false} />')],
    [
      'another component called Hero',
      mount('<Hero tone />', "import Hero from './Hero.svelte';"),
    ],
    [
      'another member of the ShaderHero namespace',
      mount(
        '<UI.Other tone />',
        "import * as UI from '$lib/components/ui/ShaderHero';"
      ),
    ],
    // The real app's false alarm: paraglide's messages, read by key.
    [
      "another module's namespace, used by key",
      mount(
        '<p>{m[key]()}</p>',
        "import * as m from '$lib/paraglide/messages';\nconst key = 'x';"
      ),
    ],
    [
      'the .svelte module namespace, another member',
      mount(
        '<UI.Other tone />',
        "import * as UI from '$lib/components/ui/ShaderHero/ShaderHero.svelte';"
      ),
    ],
  ])('does not count %s', (_name, source) => {
    expect(toneWriters(source)).toBe(0);
  });

  // A ShaderHero it cannot see mount fails the check, rather than
  // counting 0 and letting a second `tone` writer through.
  it.each([
    [
      '<svelte:component this={ShaderHero}>',
      mount('<svelte:component this={ShaderHero} tone />'),
    ],
    [
      'a component held in a variable',
      mount('<C tone />', `${barrel}\nconst C = ShaderHero;`),
    ],
    [
      'a namespace member in script',
      mount(
        '<C tone />',
        "import * as UI from '$lib/components/ui/ShaderHero';\nconst C = UI.ShaderHero;"
      ),
    ],
    [
      'a dynamic import()',
      mount(
        "{#await import('$lib/components/ui/ShaderHero') then m}<m.ShaderHero tone />{/await}",
        ''
      ),
    ],
    [
      'a dynamic import() of a computed path',
      mount('<p>x</p>', 'const p = "./x"; const m = import(p);'),
    ],
  ])('fails closed on %s', (_name, source) => {
    expect(() => toneWriters(source)).toThrow(/cannot count a ShaderHero/);
  });
});
