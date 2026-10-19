// @vitest-environment node
/**
 * A token that can be a bare `0` or a keyword must not meet CSS math it cannot
 * take part in (Codex-3kqqp, Codex-61zsk.67).
 *
 * A unitless `0` is a <number>, not a <length>. `min()`, `max()` and `clamp()`
 * need one type across their arguments, so `max(var(--space-0), 1lh)` with
 * `--space-0: 0` is invalid at computed-value time: the WHOLE declaration falls
 * to its initial value, and nothing errors or warns, because the sheet still
 * parses. A keyword (`none`, `auto`, …) is never a value of any math function.
 * Both have shipped: the journey cards' `max(var(--jp-edge-width), …)` border
 * (painted none at `edge: none`), and the course timeline's and map's names,
 * whose `max(var(--space-0), …)` padding never centred them on their markers.
 *
 * So, across every stylesheet and component `<style>` in the app, read with
 * svelte's own CSS parser, comments stripped:
 *   - a token declared anywhere as a bare `0` is not an argument of `min()`,
 *     `max()` or `clamp()` beside a length (a literal one, or a token that is
 *     one). Inside `calc()` it may multiply or divide, so `calc()` is left out;
 *   - a token declared anywhere as a keyword is not inside any math function.
 * Inline `style` attributes are not read.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseCss } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../..');

type CssNode = {
  type: string;
  property?: string;
  value?: string;
  block?: { children: CssNode[] } | null;
  children?: CssNode[];
};

interface Declaration {
  file: string;
  property: string;
  value: string;
}

const KEYWORDS = new Set([
  'none',
  'auto',
  'normal',
  'min-content',
  'max-content',
  'fit-content',
]);
const TYPED = new Set(['min', 'max', 'clamp']);
const MATH = new Set([...TYPED, 'calc']);
const DIMENSION =
  /\d(?:px|r?em|r?lh|%|vw|vh|vmin|vmax|[sdl]vh|[sdl]vw|ch|ex|cq[iwhb]|cqmin|cqmax|pt|cm|mm|in)\b|\d%/;

const uncomment = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '');

function declarationsOf(
  nodes: CssNode[],
  file: string,
  into: Declaration[] = []
): Declaration[] {
  for (const node of nodes) {
    if (
      node.type === 'Declaration' &&
      node.property &&
      node.value !== undefined
    )
      into.push({ file, property: node.property, value: node.value.trim() });
    declarationsOf(node.block?.children ?? node.children ?? [], file, into);
  }
  return into;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === 'paraglide' ? [] : walk(path);
    return /\.(css|svelte)$/.test(entry.name) ? [path] : [];
  });
}

function appDeclarations(): Declaration[] {
  return walk(SRC).flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    const file = relative(SRC, path);
    const nodes = path.endsWith('.svelte')
      ? parse(source, { modern: true }).css?.children
      : parseCss(uncomment(source)).children;
    return declarationsOf((nodes ?? []) as unknown as CssNode[], file);
  });
}

/** Each token's declared values, and which tokens are lengths (a dimension, or a length token, in any value). */
function tokensOf(declarations: readonly Declaration[]) {
  const values = new Map<string, string[]>();
  for (const { property, value } of declarations)
    if (property.startsWith('--'))
      values.set(property, [...(values.get(property) ?? []), value]);
  const lengths = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, list] of values) {
      if (lengths.has(name)) continue;
      const refs = list.flatMap((v) =>
        [...v.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1])
      );
      if (
        list.some((v) => DIMENSION.test(v)) ||
        refs.some((ref) => lengths.has(ref))
      ) {
        lengths.add(name);
        grew = true;
      }
    }
  }
  const zero = new Set(
    [...values].filter(([, list]) => list.includes('0')).map(([name]) => name)
  );
  const keyword = new Set(
    [...values]
      .filter(([, list]) => list.some((v) => KEYWORDS.has(v)))
      .map(([name]) => name)
  );
  return { lengths, zero, keyword };
}

interface Call {
  name: string;
  /** Its arguments so far, split at its own top-level commas. */
  args: string[];
}

/**
 * The tokens a value reads inside math it cannot take part in. Walks the value
 * once, keeping the stack of open functions and each one's arguments.
 */
function misuses(value: string, tokens: ReturnType<typeof tokensOf>): string[] {
  const found: string[] = [];
  const stack: Call[] = [];
  const isLength = (text: string) =>
    DIMENSION.test(text) ||
    [...text.matchAll(/var\(\s*(--[\w-]+)/g)].some(
      (m) => tokens.lengths.has(m[1]) && !tokens.zero.has(m[1])
    );
  const close = (call: Call) => {
    if (!TYPED.has(call.name)) return;
    // A bare-zero token as a whole argument, beside an argument that is a length.
    const bare = call.args.map(
      (arg) => arg.trim().match(/^var\(\s*(--[\w-]+)\s*\)$/)?.[1]
    );
    bare.forEach((name, index) => {
      if (
        name &&
        tokens.zero.has(name) &&
        call.args.some((other, j) => j !== index && isLength(other))
      )
        found.push(`${name} in ${call.name}()`);
    });
  };
  for (let i = 0; i < value.length; i++) {
    const rest = value.slice(i);
    const open = rest.match(/^([a-z-]+)\(/i);
    if (open) {
      const name = open[1].toLowerCase();
      if (name === 'var') {
        const token = rest.match(/^var\(\s*(--[\w-]+)/)?.[1];
        if (
          token &&
          tokens.keyword.has(token) &&
          stack.some((call) => MATH.has(call.name))
        )
          found.push(
            `${token} (a keyword) in ${stack.findLast((call) => MATH.has(call.name))?.name}()`
          );
      }
      for (const call of stack) call.args[call.args.length - 1] += open[0];
      stack.push({ name, args: [''] });
      i += open[0].length - 1;
      continue;
    }
    const char = value[i];
    if (char === ')') {
      const call = stack.pop();
      if (call) close(call);
      for (const outer of stack) outer.args[outer.args.length - 1] += char;
      continue;
    }
    const top = stack.at(-1);
    if (char === ',' && top) {
      for (const outer of stack.slice(0, -1))
        outer.args[outer.args.length - 1] += char;
      top.args.push('');
      continue;
    }
    for (const call of stack) call.args[call.args.length - 1] += char;
  }
  return found;
}

const tokensFrom = (sheet: string) =>
  tokensOf(
    declarationsOf(parseCss(sheet).children as unknown as CssNode[], 'fixture')
  );

describe('the probe, on the two shapes that shipped and on what is fine', () => {
  const tokens = tokensFrom(`
    :root { --space-0: 0; --space-2: 0.5rem; --border-width: 1px; --edge: 0; --_n: 0; --shadow: none; }
    .other { --edge: 2px; }
  `);
  it('sees a zero token beside a length in max(), min() and clamp(), however the length is written', () => {
    expect(
      misuses('max(var(--space-0), calc((var(--_marker) - 1lh) / 2))', tokens)
    ).toEqual(['--space-0 in max()']);
    expect(
      misuses('max(var(--edge), var(--border-width)) solid red', tokens)
    ).toEqual(['--edge in max()']);
    expect(
      misuses('clamp(var(--space-0), 2vw, var(--space-2))', tokens)
    ).toEqual(['--space-0 in clamp()']);
  });
  it('sees a keyword token inside any math', () => {
    expect(misuses('calc(var(--shadow) + 1px)', tokens)).toEqual([
      '--shadow (a keyword) in calc()',
    ]);
  });
  it('leaves alone a zero that multiplies, numbers beside numbers, and tokens outside math', () => {
    expect(misuses('calc(var(--_n) * 1px)', tokens)).toEqual([]);
    expect(misuses('max(var(--_n), 1)', tokens)).toEqual([]);
    expect(misuses('var(--space-0)', tokens)).toEqual([]);
    expect(misuses('var(--shadow)', tokens)).toEqual([]);
    expect(misuses('max(0px, calc((var(--_dot) - 1lh) / 2))', tokens)).toEqual(
      []
    );
  });
});

describe('the app’s stylesheets', () => {
  it('put no zero or keyword token into math it cannot take part in', () => {
    const declarations = appDeclarations();
    // The walk reached the app: the spacing tokens and the kit's blocks are in it.
    expect(
      declarations.some((d) => d.file === 'lib/styles/tokens/spacing.css')
    ).toBe(true);
    expect(
      declarations.some((d) =>
        d.file.startsWith('lib/page-builder/kit/blocks/')
      )
    ).toBe(true);
    const tokens = tokensOf(declarations);
    const found = declarations.flatMap(({ file, property, value }) =>
      misuses(value, tokens).map(
        (what) => `${file}: ${property}: ${value}: ${what}`
      )
    );
    expect(found).toEqual([]);
  });

  it('declares every spacing token as a length: a spacing token is never a bare 0', () => {
    const spacing = parseCss(
      uncomment(
        readFileSync(join(SRC, 'lib/styles/tokens/spacing.css'), 'utf8')
      )
    );
    const zero = declarationsOf(
      spacing.children as unknown as CssNode[],
      'spacing.css'
    )
      .filter((d) => d.property.startsWith('--space-') && d.value === '0')
      .map((d) => d.property);
    expect(zero).toEqual([]);
  });
});
