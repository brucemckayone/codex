// @vitest-environment node
/**
 * A token that can be a bare `0` or a keyword must not meet CSS math it cannot
 * take part in (Codex-3kqqp, Codex-61zsk.67).
 *
 * A unitless `0` is a <number>, not a <length>. `min()`, `max()`, `clamp()` and
 * the other functions that compare their arguments need one type across them,
 * and a sum (`+`, `-`) needs one type across its terms, so
 * `max(var(--space-0), 1lh)` or `calc(var(--space-0) + 1px)` with
 * `--space-0: 0` is invalid at computed-value time: the WHOLE declaration falls
 * to its initial value, and nothing errors or warns, because the sheet still
 * parses. A keyword (`none`, `auto`, …) is never a value of any math function.
 * Both have shipped: the journey cards' `max(var(--jp-edge-width), …)` border
 * (painted none at `edge: none`), and the course timeline's and map's names,
 * whose `max(var(--space-0), …)` padding never centred them on their markers.
 *
 * So, across every stylesheet and component `<style>` in the app, read with
 * svelte's own CSS parser, comments stripped (from values too):
 *   - a token that can be a bare `0` is not a whole argument of a comparing
 *     function beside a length, nor a term of a sum beside a length. It may
 *     multiply or divide, so a product is left alone;
 *   - a token that can be a keyword is not inside any math function.
 * A token "can be" `0` or a keyword when any declaration of it is one, or is
 * a `var()` of such a token, or falls back to one. A length is a dimension, or
 * a token that is one. Inline `style` attributes are not read.
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
/** The functions that compare their arguments, so need one type across them. */
const COMPARING = new Set([
  'min',
  'max',
  'clamp',
  'round',
  'mod',
  'rem',
  'hypot',
  'atan2',
]);
const MATH = new Set([
  ...COMPARING,
  'calc',
  'abs',
  'sign',
  'pow',
  'sqrt',
  'exp',
  'log',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
]);
const DIMENSION =
  /\d(?:px|r?em|r?lh|r?ex|r?ch|r?cap|r?ic|[sdl]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max)|pt|pc|cm|mm|q|in)\b|\d%/i;

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
      // svelte's parser keeps a comment inside a value, so strip it here too.
      into.push({
        file,
        property: node.property,
        value: uncomment(node.value).trim(),
      });
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

/** Split `text` at its top-level occurrences of `at`, parentheses balanced. */
function splitTop(text: string, at: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (depth === 0) {
      const hit = text.slice(i).match(at);
      if (hit?.index === 0) {
        parts.push(text.slice(start, i));
        i += hit[0].length - 1;
        start = i + 1;
      }
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim());
}

/** `var(--name)` or `var(--name, fallback)` as the WHOLE of `text`, or null. */
function asVar(text: string): { name: string; fallback: string | null } | null {
  const t = text.trim();
  const head = t.match(/^var\(\s*(--[\w-]+)\s*/i);
  if (!head) return null;
  // Its own closing parenthesis must be the last character.
  let depth = 0;
  for (let i = 3; i < t.length; i++) {
    if (t[i] === '(') depth++;
    else if (t[i] === ')' && --depth === 0 && i !== t.length - 1) return null;
  }
  const inner = t.slice(head[0].length, -1).trim();
  return {
    name: head[1],
    fallback: inner.startsWith(',') ? inner.slice(1).trim() : null,
  };
}

/**
 * Which tokens are lengths, and which can be a bare 0 or a keyword where a
 * file reads them.
 *
 * A declaration in a `.css` sheet counts everywhere; one in a component's
 * `<style>` counts only in that component, as it reaches only that
 * component's elements. Without that, two components' private `--_track`s
 * (a tracking number in one, a column width in another) read as one token.
 * So a zero a parent component sets, read in a child's math, is not seen.
 */
function tokensOf(declarations: readonly Declaration[]) {
  const byName = new Map<string, Declaration[]>();
  for (const declaration of declarations)
    if (declaration.property.startsWith('--'))
      byName.set(declaration.property, [
        ...(byName.get(declaration.property) ?? []),
        declaration,
      ]);
  const visible = (name: string, file: string) =>
    (byName.get(name) ?? []).filter(
      (d) => d.file === file || d.file.endsWith('.css')
    );

  const lengths = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, list] of byName) {
      if (lengths.has(name)) continue;
      const refs = list.flatMap((d) =>
        [...d.value.matchAll(/var\(\s*(--[\w-]+)/gi)].map((m) => m[1])
      );
      if (
        list.some((d) => DIMENSION.test(d.value)) ||
        refs.some((ref) => lengths.has(ref))
      ) {
        lengths.add(name);
        grew = true;
      }
    }
  }

  /** Whether `name` can be what `literal` accepts where `file` reads it: directly, through an alias, or a fallback. */
  const can = (literal: (v: string) => boolean) => {
    const value = (text: string, file: string, seen: Set<string>): boolean => {
      if (literal(text.trim())) return true;
      const v = asVar(text);
      return (
        !!v &&
        (token(v.name, file, seen) ||
          (v.fallback !== null && value(v.fallback, file, seen)))
      );
    };
    const token = (
      name: string,
      file: string,
      seen = new Set<string>()
    ): boolean => {
      if (seen.has(name)) return false;
      seen.add(name);
      return visible(name, file).some((d) => value(d.value, file, seen));
    };
    return token;
  };
  return {
    lengths,
    zero: can((v) => v === '0'),
    keyword: can((v) => KEYWORDS.has(v.toLowerCase())),
  };
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
function misuses(
  value: string,
  tokens: ReturnType<typeof tokensOf>,
  file: string
): string[] {
  const found: string[] = [];
  const stack: Call[] = [];
  const zeroToken = (text: string) => {
    const v = asVar(text);
    return v && tokens.zero(v.name, file) ? v.name : null;
  };
  const isLength = (text: string) =>
    DIMENSION.test(text) ||
    [...text.matchAll(/var\(\s*(--[\w-]+)/gi)].some(
      (m) => tokens.lengths.has(m[1]) && !tokens.zero(m[1], file)
    );
  const close = (call: Call) => {
    if (!MATH.has(call.name)) return;
    // A zero token as a whole argument of a comparing function, beside a length.
    if (COMPARING.has(call.name))
      call.args.forEach((arg, index) => {
        const name = zeroToken(arg);
        if (
          name &&
          call.args.some((other, j) => j !== index && isLength(other))
        )
          found.push(`${name} in ${call.name}()`);
      });
    // A zero token as a term of a sum, beside a length term.
    for (const arg of call.args) {
      const terms = splitTop(arg, /^\s[+-]\s/);
      if (terms.length < 2) continue;
      terms.forEach((term, index) => {
        const name = zeroToken(term);
        if (name && terms.some((other, j) => j !== index && isLength(other)))
          found.push(`${name} in a sum in ${call.name}()`);
      });
    }
  };
  for (let i = 0; i < value.length; i++) {
    const rest = value.slice(i);
    const open = rest.match(/^([a-z][a-z0-9-]*)\(/i);
    if (open) {
      const name = open[1].toLowerCase();
      if (name === 'var') {
        const token = rest.match(/^var\(\s*(--[\w-]+)/i)?.[1];
        if (
          token &&
          tokens.keyword(token, file) &&
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
    declarationsOf(
      parseCss(sheet).children as unknown as CssNode[],
      'fixture.css'
    )
  );

describe('the probe, on the two shapes that shipped and on what is fine', () => {
  const F = 'fixture.css';
  const tokens = tokensFrom(`
    :root { --space-0: 0; --space-2: 0.5rem; --border-width: 1px; --edge: 0; --_n: 0; --shadow: none; --kz: auto; }
    .other { --edge: 2px; }
    .alias { --alias: var(--space-0); --lp: 0; --_clear: var(--lp, var(--space-2)); --_safe: var(--space-2, 1px); }
  `);
  it('sees a zero token beside a length in a comparing function, however the length is written', () => {
    expect(
      misuses(
        'max(var(--space-0), calc((var(--_marker) - 1lh) / 2))',
        tokens,
        F
      )
    ).toEqual(['--space-0 in max()']);
    expect(
      misuses('max(var(--edge), var(--border-width)) solid red', tokens, F)
    ).toEqual(['--edge in max()']);
    expect(
      misuses('clamp(var(--space-0), 2vw, var(--space-2))', tokens, F)
    ).toEqual(['--space-0 in clamp()']);
    expect(misuses('MAX(var(--space-0), 1PX)', tokens, F)).toEqual([
      '--space-0 in max()',
    ]);
    expect(misuses('max(var(--space-0), 1vi)', tokens, F)).toEqual([
      '--space-0 in max()',
    ]);
    expect(misuses('round(var(--space-0), 1px)', tokens, F)).toEqual([
      '--space-0 in round()',
    ]);
  });
  it('sees it with a fallback, through an alias, and through an alias’s fallback', () => {
    expect(misuses('max(var(--space-0, 0px), 1px)', tokens, F)).toEqual([
      '--space-0 in max()',
    ]);
    expect(misuses('max(var(--alias), 1px)', tokens, F)).toEqual([
      '--alias in max()',
    ]);
    expect(
      misuses('max(calc(var(--_clear) + var(--space-2)), 1px)', tokens, F)
    ).toEqual(['--_clear in a sum in calc()']);
  });
  it('sees a zero token as a term of a sum beside a length', () => {
    expect(misuses('calc(var(--space-0) + 1px)', tokens, F)).toEqual([
      '--space-0 in a sum in calc()',
    ]);
    expect(
      misuses('max(calc(var(--space-0) + var(--space-2)), 1px)', tokens, F)
    ).toEqual(['--space-0 in a sum in calc()']);
  });
  it('sees a keyword token inside any math', () => {
    expect(misuses('calc(var(--shadow) + 1px)', tokens, F)).toEqual([
      '--shadow (a keyword) in calc()',
    ]);
    expect(misuses('round(var(--kz), 1px)', tokens, F)).toEqual([
      '--kz (a keyword) in round()',
    ]);
  });
  it('reads a component’s values with their comments taken out', () => {
    const svelte = tokensOf(
      declarationsOf(
        (parse('<style>.a { --cz: 0 /* a note */; }</style>', { modern: true })
          .css?.children ?? []) as unknown as CssNode[],
        'fixture.svelte'
      )
    );
    expect(svelte.zero('--cz', 'fixture.svelte')).toBe(true);
  });
  it('counts a component’s own declaration only in that component, and a sheet’s everywhere', () => {
    const scoped = tokensOf([
      { file: 'A.svelte', property: '--_t', value: '0' },
      { file: 'B.svelte', property: '--_t', value: 'calc(1px * 2)' },
      { file: 'tokens.css', property: '--z', value: '0' },
    ]);
    expect(misuses('calc(var(--_t) + 1px)', scoped, 'A.svelte')).toEqual([
      '--_t in a sum in calc()',
    ]);
    expect(misuses('calc(var(--_t) + 1px)', scoped, 'B.svelte')).toEqual([]);
    expect(misuses('max(var(--z), 1px)', scoped, 'B.svelte')).toEqual([
      '--z in max()',
    ]);
  });
  it('leaves alone a zero that multiplies, numbers beside numbers, lengths beside lengths, and tokens outside math', () => {
    expect(misuses('calc(var(--_n) * 1px)', tokens, F)).toEqual([]);
    expect(misuses('max(var(--_n), 1)', tokens, F)).toEqual([]);
    expect(misuses('calc(var(--space-2) + var(--_safe))', tokens, F)).toEqual(
      []
    );
    expect(misuses('calc(100% - var(--space-2))', tokens, F)).toEqual([]);
    expect(misuses('calc(var(--a, 1px) + var(--b, 2px))', tokens, F)).toEqual(
      []
    );
    expect(misuses('var(--space-0)', tokens, F)).toEqual([]);
    expect(misuses('var(--shadow)', tokens, F)).toEqual([]);
    expect(
      misuses('max(0px, calc((var(--_dot) - 1lh) / 2))', tokens, F)
    ).toEqual([]);
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
      misuses(value, tokens, file).map(
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
