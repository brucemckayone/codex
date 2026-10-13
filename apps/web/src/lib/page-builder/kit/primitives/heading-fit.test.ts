// @vitest-environment node
/**
 * A section heading's size (03 X66, X62): the rule `Heading.svelte` writes,
 * evaluated as the browser computes it, from the custom properties a page and
 * its layout give it.
 *
 * The browser sweep that proves the fit on real words (`e2e/page-kit/
 * louder-fit.spec.ts`) is opt-in and local, so CI holds the rule here. Every
 * way it breaks is silent: a cap dropped grows a heading past its Style, a
 * floor dropped lets a room that came to nothing draw it at no size, a hold
 * dropped fits a head to a room nobody can see, and a `max()` mixing a number
 * with a length is invalid, which leaves the heading at its parent's size.
 * So the rule's own text is read and computed, units and all; and every place
 * a layout holds its head (`--lp-heading-hold`) or names its room is counted.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELECTOR = ".lp-heading[data-size='heading']";

type CssNode = {
  type: string;
  property?: string;
  value?: string;
  name?: string;
  prelude?: string | { start: number; end: number };
  block?: { children: CssNode[] } | null;
};

const squash = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Each declaration in a component's styles, with its selector and the at-rules around it. */
function declarations(source: string) {
  const found: {
    at: string;
    selector: string;
    property: string;
    value: string;
  }[] = [];
  const visit = (nodes: CssNode[], at: string[]) => {
    for (const node of nodes) {
      const children = node.block?.children ?? [];
      if (node.type === 'Atrule')
        visit(children, [
          ...at,
          `@${node.name} ${squash(String(node.prelude))}`,
        ]);
      else if (node.type === 'Rule' && typeof node.prelude === 'object') {
        const selector = squash(
          source.slice(node.prelude.start, node.prelude.end)
        );
        for (const d of children)
          if (d.type === 'Declaration')
            found.push({
              at: at.join(' '),
              selector,
              property: d.property ?? '',
              value: squash(d.value ?? ''),
            });
      }
    }
  };
  visit((parse(source, { modern: true }).css?.children ?? []) as CssNode[], []);
  return found;
}

/** Every kit component, by path from the kit. */
function kitComponents(dir = KIT): { file: string; source: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return kitComponents(path);
    return entry.name.endsWith('.svelte')
      ? [{ file: relative(KIT, path), source: readFileSync(path, 'utf8') }]
      : [];
  });
}

// ── A CSS math evaluator: calc, min, max and var, with lengths in px ─────────
// A value carries its length's power (0 a number, 1 a length), so a sum or a
// comparison of a number with a length fails as the browser fails it.
type Value = { n: number; length: number };
type Node =
  | { k: 'num'; n: number; unit: string }
  | { k: 'var'; name: string; fallback?: Node }
  | { k: 'fn'; name: string; args: Node[] }
  | { k: 'op'; op: string; a: Node; b: Node }
  | { k: 'neg'; a: Node };

function parseMath(text: string): Node {
  const tokens = [
    ...text.matchAll(
      /(\d*\.?\d+(?:e-?\d+)?)([a-z%]*)|(--[\w-]+)|([a-z-]+)\(|([()+\-*/,])|(\S)/g
    ),
  ];
  let i = 0;
  const peek = () => tokens[i];
  const take = (punct?: string) => {
    const token = tokens[i++];
    if (!token || (punct && token[5] !== punct))
      throw new Error(`expected ${punct ?? 'a token'} in ${text}`);
    return token;
  };
  const sum = (): Node => {
    let node = product();
    while (peek()?.[5] === '+' || peek()?.[5] === '-')
      node = { k: 'op', op: take()[5], a: node, b: product() };
    return node;
  };
  const product = (): Node => {
    let node = unit();
    while (peek()?.[5] === '*' || peek()?.[5] === '/')
      node = { k: 'op', op: take()[5], a: node, b: unit() };
    return node;
  };
  const unit = (): Node => {
    const token = take();
    if (token[6]) throw new Error(`unexpected ${token[6]} in ${text}`);
    if (token[1]) return { k: 'num', n: Number(token[1]), unit: token[2] };
    if (token[5] === '-') return { k: 'neg', a: unit() };
    if (token[5] === '(') {
      const inner = sum();
      take(')');
      return inner;
    }
    if (token[4] === 'var') {
      const name = take()[3];
      if (!name) throw new Error(`var() without a name in ${text}`);
      let fallback: Node | undefined;
      if (peek()?.[5] === ',') {
        take(',');
        fallback = sum();
      }
      take(')');
      return { k: 'var', name, fallback };
    }
    if (token[4]) {
      const args = [sum()];
      while (peek()?.[5] === ',') {
        take(',');
        args.push(sum());
      }
      take(')');
      return { k: 'fn', name: token[4], args };
    }
    throw new Error(`unexpected ${token[0]} in ${text}`);
  };
  const node = sum();
  if (i !== tokens.length) throw new Error(`trailing text in ${text}`);
  return node;
}

function evaluate(
  node: Node,
  lookup: (name: string) => string | undefined
): Value {
  const same = (a: Value, b: Value, what: string) => {
    if (a.length !== b.length)
      throw new Error(`${what} mixes a number with a length`);
  };
  switch (node.k) {
    case 'num':
      if (node.unit !== '' && node.unit !== 'px')
        throw new Error(`no ${node.unit} here: give the property in px`);
      return { n: node.n, length: node.unit === 'px' ? 1 : 0 };
    case 'neg': {
      const a = evaluate(node.a, lookup);
      return { n: -a.n, length: a.length };
    }
    case 'var': {
      const value = lookup(node.name);
      if (value !== undefined) return evaluate(parseMath(value), lookup);
      if (node.fallback) return evaluate(node.fallback, lookup);
      throw new Error(`${node.name} is not set and has no fallback`);
    }
    case 'op': {
      const a = evaluate(node.a, lookup);
      const b = evaluate(node.b, lookup);
      if (node.op === '+' || node.op === '-') {
        same(a, b, node.op);
        return { n: node.op === '+' ? a.n + b.n : a.n - b.n, length: a.length };
      }
      return node.op === '*'
        ? { n: a.n * b.n, length: a.length + b.length }
        : { n: a.n / b.n, length: a.length - b.length };
    }
    case 'fn': {
      const args = node.args.map((arg) => evaluate(arg, lookup));
      for (const arg of args.slice(1)) same(args[0], arg, `${node.name}()`);
      if (node.name === 'calc' && args.length === 1) return args[0];
      if (node.name === 'min' || node.name === 'max')
        return {
          n: Math[node.name](...args.map((arg) => arg.n)),
          length: args[0].length,
        };
      throw new Error(`no ${node.name}() here`);
    }
  }
}

// ── The rule ────────────────────────────────────────────────────────────────
const HEADING = declarations(
  readFileSync(join(KIT, 'primitives', 'Heading.svelte'), 'utf8')
);
const RULE = new Map(
  HEADING.filter((d) => d.at === '' && d.selector === SELECTOR).map((d) => [
    d.property,
    d.value,
  ])
);

/** The page's own tokens, as the gallery's Clean draws them at 1440. */
const PAGE = {
  '--lp-size-heading': '48px',
  '--lp-size-title': '24px',
  '--lp-column': '600px',
  '--lp-face-text': '0.5',
  '--lp-face-caps': '0.7',
  '--_track': '0',
};

/**
 * The heading's size in px. `run` is its widest run's weight as written,
 * `caps` in capitals, `chars` its letters (`widestRun`); the rest are the
 * properties the page, the type dial and a layout give it.
 */
function size(
  given: { run?: number; caps?: number; chars?: number } & Record<
    string,
    string | number | undefined
  > = {}
) {
  const { run, caps, chars, ...props } = given;
  const set: Record<string, string> = { ...PAGE };
  if (run !== undefined) set['--lp-heading-run-text'] = String(run);
  if (caps !== undefined) set['--lp-heading-run-caps'] = String(caps);
  if (chars !== undefined) set['--lp-heading-run-chars'] = String(chars);
  for (const [name, value] of Object.entries(props))
    if (value !== undefined) set[name] = String(value);
  const font = RULE.get('font-size');
  if (!font) throw new Error(`${SELECTOR} declares no font-size`);
  // A custom property the rule declares is the element's own; the rest inherit.
  const value = evaluate(
    parseMath(font),
    (name) => RULE.get(name) ?? set[name]
  );
  expect(value.length, 'font-size is a length').toBe(1);
  return value.n;
}

/** louder: the heading's size a step up, and the factor that holds it back (`kit.css`). */
const LOUDER = { '--lp-size-heading': '55.2px', '--lp-drama-held': 1 / 1.15 };

describe("a section heading's size", () => {
  it('is the Style’s own wherever its widest run fits', () => {
    // 10 units at 0.5em each: 5em, 240px at 48px, in a 600px column.
    expect(size({ run: 10 })).toBe(48);
  });

  it('is only as much smaller as a long word needs', () => {
    // 20 units: 10em, so up to 60px would fit; 40 units, 20em, fit at 30px.
    expect(size({ run: 20 })).toBe(48);
    const fitted = size({ run: 40 });
    expect(fitted).toBeLessThan(48);
    expect(fitted * 40 * 0.5).toBeCloseTo(600);
  });

  it('is never smaller than a title, so it stays a head', () => {
    expect(size({ run: 200 })).toBe(24);
    expect(size({ run: 20, '--lp-column': '0px' })).toBe(24);
  });

  it('is fitted to the room a layout names when it is less than the column', () => {
    const named = size({ run: 20, '--lp-heading-column': '300px' });
    expect(named * 20 * 0.5).toBeCloseTo(300);
    // A room named wider than the column is still the column.
    expect(size({ run: 40, '--lp-heading-column': '900px' })).toBe(30);
  });

  it('weighs the run in capitals where a Style draws them', () => {
    const caps = {
      run: 20,
      caps: 30,
      '--lp-heading-run': 'var(--lp-heading-run-caps)',
      '--lp-heading-face': 'var(--lp-face-caps)',
    };
    expect(size(caps) * 30 * 0.7).toBeCloseTo(600);
  });

  it("counts the Style's tracking per letter", () => {
    const tracked = size({ run: 40, chars: 20, '--_track': -0.05 });
    expect(tracked * (40 * 0.5 - 20 * 0.05)).toBeCloseTo(600);
    expect(tracked).toBeGreaterThan(size({ run: 40 }));
  });

  it('is drawn at the size the dial gives it when it has no words', () => {
    expect(size()).toBe(48);
    expect(size(LOUDER)).toBe(55.2);
  });

  it('grows at louder only as far as its widest run still fits', () => {
    expect(size({ run: 10, ...LOUDER })).toBe(55.2);
    const between = size({ run: 23, ...LOUDER });
    expect(between).toBeGreaterThan(48);
    expect(between).toBeLessThan(55.2);
    expect(between * 23 * 0.5).toBeCloseTo(600);
  });

  it('comes down at calmer, wherever its words fit', () => {
    expect(size({ run: 10, '--lp-size-heading': '40.8px' })).toBe(40.8);
  });

  it("is held at the Style's size where its room is not known", () => {
    const held = { '--lp-heading-hold': 1 };
    expect(size({ run: 200, ...held })).toBe(48);
    // louder grows no held head: its step is taken back.
    expect(size({ run: 10, ...held, ...LOUDER })).toBeCloseTo(48);
    // calmer still takes it down.
    expect(size({ run: 200, ...held, '--lp-size-heading': '40.8px' })).toBe(
      40.8
    );
  });
});

describe('where a layout holds its head, or names its room', () => {
  const kit = kitComponents().flatMap(({ file, source }) =>
    declarations(source).map((d) => ({ file, ...d }))
  );

  // The band draws its price at the price's own width beside the head, so the
  // head's room is not known (03 X66). A new hold is a heading drawn at the
  // Style's size whatever its words: it is counted here so it is a decision.
  it('holds only the pricing band, and only where it is a row', () => {
    const holds = kit.filter((d) => d.property === '--lp-heading-hold');
    expect(
      holds.map((d) => `${d.file} ${d.at} ${d.selector}: ${d.value}`)
    ).toEqual([
      "blocks/pricing/PricingBlock.svelte @container (min-width: 60rem) .pricing[data-layout='band'] > .pricing__head: 1",
    ]);
  });

  // The hold before X66 was a room of nothing (`--lp-heading-column: 0px`),
  // which now fits the heading to the title's size.
  it('never names a room of nothing', () => {
    const rooms = kit.filter((d) => d.property === '--lp-heading-column');
    expect(rooms.length).toBeGreaterThanOrEqual(5);
    expect(
      rooms
        .filter((d) => /^-?0(px|rem|cqi|%)?$/.test(d.value))
        .map((d) => `${d.file} ${d.selector}: ${d.value}`)
    ).toEqual([]);
  });
});
