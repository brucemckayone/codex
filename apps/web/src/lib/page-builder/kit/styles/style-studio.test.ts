// @vitest-environment node
/**
 * Studio's pen (03 §4.1, X24): every mark the Style draws is painted in the
 * kit's decorative grade, `--lp-mark-ink` — 3:1 against its sheet, so a bright
 * brand keeps its colour — never the text-grade accent, which moves it as far
 * as a line of text needs (a teal brand's marks drew in rgb(1 78 72), 9.2:1
 * on the page's own ground).
 *
 * A mark is recognised the way the page draws it: a rule masked with one of
 * the kit's hand-drawn shapes (`--lp-mark-*`, motion.css). Its paint must be
 * named in that same rule and come to exactly `var(--lp-mark-ink)` — followed
 * through any custom property this sheet declares, so a helper cannot hide
 * the grade one `var()` away. A tint of the ink is not the ink: it could fall
 * under 3:1.
 *
 * Read with svelte's own CSS parser, comments stripped first.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseCss } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import { isLongFigure } from '../blocks/stats/figures';
import { FACE_ZERO } from '../model/faces';

type CssNode = {
  type: string;
  name?: string;
  property?: string;
  value?: string;
  prelude?: { start: number; end: number } | string;
  block?: { children: CssNode[] } | null;
};

const STYLES = dirname(fileURLToPath(import.meta.url));
const SHEET = join(STYLES, 'style-studio.css');

interface Mark {
  selector: string;
  shape: string;
  /** What its paint finally reads; undefined when the rule names none. */
  paint: string | undefined;
}

const MARK_INK = 'var(--lp-mark-ink)';

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const uncomment = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every rule, at any depth, with its selector, its own declarations and the
 * container query it sits in (`source` is what the parser's offsets index).
 */
function rulesIn(nodes: CssNode[], source: string) {
  const rules: {
    selector: string;
    decls: Map<string, string>;
    query: string;
  }[] = [];
  const visit = (children: CssNode[], query: string) => {
    for (const node of children) {
      if (node.type === 'Rule' && typeof node.prelude === 'object') {
        const decls = new Map<string, string>();
        for (const d of node.block?.children ?? [])
          if (d.type === 'Declaration')
            decls.set(d.property ?? '', squash(d.value ?? ''));
        rules.push({
          selector: squash(source.slice(node.prelude.start, node.prelude.end)),
          decls,
          query,
        });
      }
      visit(
        node.block?.children ?? [],
        node.type === 'Atrule' && node.name === 'container'
          ? squash(String(node.prelude))
          : query
      );
    }
  };
  visit(nodes, '');
  return rules;
}

const rulesOf = (css: string) =>
  rulesIn(parseCss(css).children as unknown as CssNode[], css);

/** A paint followed through the sheet's own declarations of what it reads. */
function resolve(
  value: string,
  declared: Map<string, string[]>,
  seen = new Set<string>()
): string[] {
  const hop = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (!hop || seen.has(hop[1]) || !declared.has(hop[1])) return [value];
  seen.add(hop[1]);
  return declared.get(hop[1])!.flatMap((v) => resolve(v, declared, seen));
}

function marksOf(source: string): Mark[] {
  const rules = rulesOf(uncomment(source));
  const declared = new Map<string, string[]>();
  for (const { decls } of rules)
    for (const [property, value] of decls)
      if (property.startsWith('--'))
        declared.set(property, [...(declared.get(property) ?? []), value]);
  return rules.flatMap(({ selector, decls }) => {
    const mask = decls.get('mask') ?? decls.get('mask-image');
    const shape = mask?.match(/var\(\s*(--lp-mark-[\w-]+)/)?.[1];
    if (!shape) return [];
    const paint = decls.get('background') ?? decls.get('background-color');
    return [
      {
        selector,
        shape,
        paint:
          paint === undefined
            ? undefined
            : [...new Set(resolve(paint, declared))].join(' | '),
      },
    ];
  });
}

describe("Studio's pen marks", () => {
  const marks = marksOf(readFileSync(SHEET, 'utf8'));

  it('finds the pen: the underlines, the circles, the pill, the frame and the dashes', () => {
    expect(new Set(marks.map((m) => m.shape))).toEqual(
      new Set([
        '--lp-mark-underline',
        '--lp-mark-circle',
        '--lp-mark-pill',
        '--lp-mark-scribble',
      ])
    );
    // A section heading's underline, the hero's, the circle round a number,
    // the pill round a long one, the portrait's frame and the problem's dashes.
    expect(marks.length).toBeGreaterThanOrEqual(6);
  });

  it('paints every mark in the mark ink, never the text-grade accent', () => {
    expect(marks.filter((m) => m.paint !== MARK_INK)).toEqual([]);
  });
});

describe('reading a mark', () => {
  const paints = (css: string) => marksOf(css).map((m) => m.paint);

  it('follows its paint through a custom property the sheet declares', () => {
    const pen = (to: string) =>
      `.a { --_studio-pen: ${to}; } .b::after { background: var(--_studio-pen); mask: var(--lp-mark-circle) center / 100% 100% no-repeat; }`;
    expect(paints(pen('var(--lp-mark-ink)'))).toEqual([MARK_INK]);
    expect(paints(pen('var(--lp-accent)'))).toEqual(['var(--lp-accent)']);
  });

  it('holds to account a mark that names no paint, or a tint of the ink', () => {
    expect(paints('.b { mask: var(--lp-mark-underline); }')).toEqual([
      undefined,
    ]);
    expect(
      paints(
        '.b { background: color-mix(in oklab, var(--lp-mark-ink) 60%, transparent); mask: var(--lp-mark-underline); }'
      )
    ).not.toEqual([MARK_INK]);
  });

  it('reads no commented-out paint', () => {
    expect(
      paints(
        '.b::after { /* background: var(--lp-mark-ink); */ background: var(--lp-accent); mask: var(--lp-mark-scribble); }'
      )
    ).toEqual(['var(--lp-accent)']);
  });
});

describe("the portrait frame's room (Codex-61zsk.31)", () => {
  it('keeps the frame clear of the words exactly where the guide stacks its portrait over them', () => {
    // The guide sets its words beside the portrait from its split width;
    // under it the portrait stacks over them, and Studio makes room below
    // the print for the frame's foot. Where the stroke lands only a browser
    // can see; that the two widths are one is what this pins.
    const source = readFileSync(
      join(STYLES, '..', 'blocks', 'instructor', 'InstructorBlock.svelte'),
      'utf8'
    );
    const split = rulesIn(
      (parse(source, { modern: true }).css?.children ?? []) as CssNode[],
      source
    ).find(
      (r) =>
        r.selector === '.guide-split:has(> .guide__portrait)' &&
        r.decls.has('grid-template-columns')
    );
    const room = rulesOf(uncomment(readFileSync(SHEET, 'utf8'))).find(
      (r) =>
        r.selector.endsWith('.guide-split > .guide__portrait') &&
        r.decls.has('margin-block-end')
    );
    const width = split?.query.match(/^\(min-width: ([\d.]+rem)\)$/)?.[1];
    expect(width, `the guide's split: ${split?.query}`).toBeDefined();
    expect(room?.query).toBe(`(width < ${width})`);
  });
});

/**
 * A CSS length in em, as the browser computes it on one figure: `calc()`,
 * `min()`, `max()`, `clamp()` and `var()` (from `vars`, else its fallback).
 */
function em(css: string, vars: Record<string, string> = {}): number {
  const tokens =
    css.match(/\d*\.?\d+[a-z]*|--[\w-]+|[a-z-]+\(|[()+\-*/,]|\S/g) ?? [];
  let i = 0;
  const next = () => {
    const token = tokens[i++];
    if (token === undefined) throw new Error(`${css} ends early`);
    return token;
  };
  const args = (): number[] => {
    const list = [sum()];
    while (tokens[i] === ',') {
      i++;
      list.push(sum());
    }
    if (next() !== ')') throw new Error(`unclosed in ${css}`);
    return list;
  };
  const atom = (): number => {
    const token = next();
    if (token === '-') return -atom();
    if (token === '(' || token === 'calc(') return args()[0];
    if (token === 'min(') return Math.min(...args());
    if (token === 'max(') return Math.max(...args());
    if (token === 'clamp(') {
      const [low, value, high] = args();
      return Math.max(low, Math.min(value, high));
    }
    if (token === 'var(') {
      const name = next();
      let fallback: number | undefined;
      if (tokens[i] === ',') {
        i++;
        fallback = sum();
      }
      if (next() !== ')') throw new Error(`unclosed var() in ${css}`);
      const value = vars[name];
      if (value !== undefined) return em(value, vars);
      if (fallback === undefined) throw new Error(`${name} is not set`);
      return fallback;
    }
    const [, n] = token.match(/^(\d*\.?\d+)(em)?$/) ?? [];
    if (n === undefined) throw new Error(`no ${token} here, in ${css}`);
    return Number(n);
  };
  const product = (): number => {
    let value = atom();
    while (tokens[i] === '*' || tokens[i] === '/') {
      const by = next() === '*' ? atom() : 1 / atom();
      value *= by;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (tokens[i] === '+' || tokens[i] === '-') {
      const sign = next() === '+' ? 1 : -1;
      value += sign * product();
    }
    return value;
  };
  const value = sum();
  if (i !== tokens.length) throw new Error(`trailing text in ${css}`);
  return value;
}

/** The least a circle is: a numeral and the pen's air. */
const FLOOR = 1.7;

describe("the numbers' circles and pills", () => {
  const STUDIO = ":is(.lp, #lp-style)[data-lp-style='studio']";
  const rules = rulesOf(uncomment(readFileSync(SHEET, 'utf8')));
  const decls = (selector: string) =>
    rules.find((r) => r.selector === `${STUDIO} ${selector}`)?.decls;

  it('rings a short figure in a true circle, drawn on its own square box', () => {
    expect(decls('.stat__value')?.get('aspect-ratio')).toBe('1');
    expect(decls('.stat__value::after')?.get('inset')).toBe('0');
  });

  // An ellipse stretched round "4,000+" flattened into a smear.
  it('rings a long figure in a pill, on a box that hugs it, never a stretched circle', () => {
    expect(decls('.stat__value[data-long]')?.get('aspect-ratio')).toBe('auto');
    const pill = decls('.stat__value[data-long]::after');
    expect(pill?.get('mask')).toMatch(/^var\(--lp-mark-pill\)/);
    expect(pill?.get('background')).toBe(MARK_INK);
  });

  // "6", "24" and "100" drew three circles of three sizes, each hugging its
  // figure, so the labels under them sat at three heights (Codex-61zsk.73).
  it('draws every short figure in a block on one circle, its longest figure’s own', () => {
    const box = decls('.stat__value');
    const min = box?.get('min-inline-size');
    const short = box?.get('--_studio-short');
    const padding = box?.get('padding');
    const tracking = rules
      .find((r) => r.selector === ".lp[data-lp-type-facet='studio']")
      ?.decls.get('--lp-tracking-display');
    if (!min || !short || !padding || !tracking)
      throw new Error('the circle’s rule or the Type’s tracking is missing');
    // Studio's own faces and the kit's default, at 700, each by its measured
    // zero (`--lp-zero-display`, as `styles/faces.css` sets it).
    for (const face of ['Bitter', 'Figtree', 'Inter'] as const) {
      const zero = FACE_ZERO[face][1];
      /** A figure of `n` zeros, hugged: its characters, tracked, and its padding. */
      const own = (n: number) => n * (zero + em(tracking)) + 2 * em(padding);
      /** Its box, in a block whose longest figure has `longest` characters. */
      const drawn = (n: number, longest: number) =>
        Math.max(
          own(n),
          em(min, {
            '--_chars': String(longest),
            '--_studio-short': short,
            '--lp-zero-display': `${zero}em`,
            '--lp-tracking-display': tracking,
          })
        );
      for (let longest = 1; longest <= 8; longest++) {
        const circles = Array.from({ length: Math.min(longest, 4) }, (_, i) =>
          drawn(i + 1, longest)
        );
        if (isLongFigure('0'.repeat(longest))) {
          // A block that pills one: each circle hugs its own figure.
          expect(circles, `${face}, a pill in the block`).toEqual(
            circles.map((_, i) => Math.max(own(i + 1), FLOOR))
          );
        } else {
          // Never past the longest's own circle, which fits its cell.
          const one = Math.max(own(longest), FLOOR);
          for (const circle of circles)
            expect(circle, `${face}, longest ${longest}`).toBeCloseTo(one, 6);
        }
      }
    }
  });

  it('keys the pill on the mark the numbers block sets on a long figure', () => {
    const block = readFileSync(
      join(STYLES, '..', 'blocks', 'stats', 'StatsBlock.svelte'),
      'utf8'
    );
    expect(block).toMatch(
      /class="stat__value"[^>]*data-long=\{isLongFigure\(figure\.value\)/
    );
  });
});
