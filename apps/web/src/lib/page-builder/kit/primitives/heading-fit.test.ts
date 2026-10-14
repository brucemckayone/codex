// @vitest-environment node
/**
 * A heading's size at each of its sizes (03 X66, X71, X62): the rules
 * `Heading.svelte` writes, evaluated as the browser computes them, from the
 * custom properties a page and its layout give it.
 *
 * The browser sweep that proves the fit on real words (`e2e/page-kit/
 * louder-fit.spec.ts`) is opt-in and local, so CI holds the rule here. Every
 * way it breaks is silent: a cap dropped grows a heading past its Style, a
 * floor dropped lets a room that came to nothing draw it at no size, a hold
 * dropped fits a head to a room nobody can see, and a `max()` mixing a number
 * with a length is invalid, which leaves the heading at its parent's size.
 * So the rule's own text is read and computed, units and all; and every place
 * a layout holds its head (`--lp-heading-hold`), names its room, or names a
 * card's room for its title (`--lp-title-column`) is counted.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELECTORS = {
  display: ".lp-heading[data-size='display']",
  heading: ".lp-heading[data-size='heading']",
  title: ".lp-heading[data-size='title']",
} as const;
type Size = keyof typeof SELECTORS;

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

/** Every component's styles and every stylesheet in the kit, a Style's included. */
function kitComponents(dir = KIT): { file: string; source: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return kitComponents(path);
    const file = relative(KIT, path);
    if (entry.name.endsWith('.svelte'))
      return [{ file, source: readFileSync(path, 'utf8') }];
    // A stylesheet is read as a component's styles, by the same parser.
    if (entry.name.endsWith('.css'))
      return [{ file, source: `<style>${readFileSync(path, 'utf8')}</style>` }];
    return [];
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
/** A size's declarations: the base rule's, then its own, as both apply. */
const RULES = Object.fromEntries(
  Object.entries(SELECTORS).map(([which, selector]) => [
    which,
    new Map(
      HEADING.filter(
        (d) =>
          d.at === '' &&
          (d.selector === '.lp-heading' || d.selector === selector)
      ).map((d) => [d.property, d.value])
    ),
  ])
) as Record<Size, Map<string, string>>;

/** The page's own tokens, as the gallery's Clean draws them at 1440. */
const PAGE = {
  '--lp-size-display': '72px',
  '--lp-size-heading': '48px',
  '--lp-size-title': '24px',
  '--lp-size-body': '18px',
  '--lp-column': '600px',
  '--lp-face-text': '0.5',
  '--lp-face-caps': '0.7',
  '--_track': '0',
};

/**
 * The heading's size in px, at a section heading's size unless `of` says
 * otherwise. `run` is its widest run's weight as written, `caps` in capitals,
 * `chars` its letters (`widestRun`); the rest are the properties the page,
 * the type dial and a layout give it.
 */
function size(
  given: { run?: number; caps?: number; chars?: number } & Record<
    string,
    string | number | undefined
  > = {},
  of: Size = 'heading'
) {
  const { run, caps, chars, ...props } = given;
  const set: Record<string, string> = { ...PAGE };
  if (run !== undefined) set['--lp-heading-run-text'] = String(run);
  if (caps !== undefined) set['--lp-heading-run-caps'] = String(caps);
  if (chars !== undefined) set['--lp-heading-run-chars'] = String(chars);
  for (const [name, value] of Object.entries(props))
    if (value !== undefined) set[name] = String(value);
  const rule = RULES[of];
  const font = rule.get('font-size');
  if (!font) throw new Error(`${SELECTORS[of]} declares no font-size`);
  // A custom property the rule declares is the element's own; the rest inherit.
  const value = evaluate(
    parseMath(font),
    (name) => rule.get(name) ?? set[name]
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

describe("a display statement's size (03 X71)", () => {
  const display = (given: Parameters<typeof size>[0] = {}) =>
    size(given, 'display');

  it("is the Style's own, at its layout's scale, wherever its widest run fits", () => {
    // 10 units at 0.5em each: 5em, 360px at 72px, in a 600px column.
    expect(display({ run: 10 })).toBe(72);
    expect(display({ run: 10, '--lp-display-scale': 0.5 })).toBe(36);
  });

  it('is only as much smaller as a long word needs, in the room its layout names', () => {
    const fitted = display({ run: 20 });
    expect(fitted).toBeLessThan(72);
    expect(fitted * 20 * 0.5).toBeCloseTo(600);
    const named = display({ run: 20, '--lp-heading-column': '300px' });
    expect(named * 20 * 0.5).toBeCloseTo(300);
  });

  it('is never smaller than a title', () => {
    expect(display({ run: 200 })).toBe(24);
  });

  it('weighs the run in capitals where a Style draws them', () => {
    const caps = {
      run: 20,
      caps: 30,
      '--lp-heading-run': 'var(--lp-heading-run-caps)',
      '--lp-heading-face': 'var(--lp-face-caps)',
    };
    expect(display(caps) * 30 * 0.7).toBeCloseTo(600);
  });

  it('is drawn at its size when it has no words, or is held', () => {
    expect(display()).toBe(72);
    expect(display({ run: 200, '--lp-heading-hold': 1 })).toBe(72);
  });
});

describe("a title's size (03 X71)", () => {
  const title = (given: Parameters<typeof size>[0] = {}) =>
    size(given, 'title');
  /** A title lifted all the way, to the heading's size (the bento's lead). */
  const lifted = { '--lp-title-lift': 1 };

  it("is the Style's own, lifted as its layout lifts it, wherever its widest run fits", () => {
    expect(title({ run: 10 })).toBe(24);
    // Halfway from the title's 24px to the heading's 48px.
    expect(title({ run: 10, '--lp-title-lift': 0.5 })).toBe(36);
  });

  it('is fitted to the room its card names', () => {
    // 20 units, 10em: 240px at 24px, so a 300px card holds it and a 200px
    // one fits it at 20px.
    expect(title({ run: 20, '--lp-title-column': '300px' })).toBe(24);
    const fitted = title({ run: 20, '--lp-title-column': '200px' });
    expect(fitted * 20 * 0.5).toBeCloseTo(200);
  });

  it('is fitted to no more than the column, or the room its head names', () => {
    // 40 units, 20em: a 48px title fits the 600px column at 30px.
    const wide = title({ run: 40, ...lifted, '--lp-title-column': '900px' });
    expect(wide * 40 * 0.5).toBeCloseTo(600);
    const headed = title({
      run: 40,
      ...lifted,
      '--lp-heading-column': '450px',
    });
    expect(headed * 40 * 0.5).toBeCloseTo(450);
  });

  it('is never smaller than the body, so it stays a title', () => {
    expect(title({ run: 200, '--lp-title-column': '200px' })).toBe(18);
  });

  it("does not grow at louder: a lifted one lifts toward the heading's own size", () => {
    expect(title({ run: 10, ...lifted, ...LOUDER })).toBeCloseTo(48);
    expect(title({ run: 10, ...LOUDER })).toBe(24);
  });

  it('is drawn at its size when it has no words, or is held', () => {
    expect(title()).toBe(24);
    expect(title({ run: 200, '--lp-heading-hold': 1 })).toBe(24);
  });
});

/** Every declaration in the kit, with its file. */
const kit = kitComponents().flatMap(({ file, source }) =>
  declarations(source).map((d) => ({ file, ...d }))
);

describe('where a layout holds its head, or names its room', () => {
  // A held head is drawn at the Style's size whatever its words, so a long
  // word runs past its line. The pricing band held its head until X70; a new
  // hold is counted here so it is a decision. The hero's headline is held
  // only where it is wide, where its layouts size it for its words (X34,
  // X60, X74); on a phone it is fitted, and a long word ran off the screen
  // before it was (03 X74).
  it("holds no head but the hero's headline, where it is wide", () => {
    const holds = kit.filter((d) => d.property === '--lp-heading-hold');
    expect(
      holds.map((d) => `${d.file} ${d.at} ${d.selector}: ${d.value}`)
    ).toEqual([
      'blocks/hero/HeroBlock.svelte @container (min-width: 56rem) .hero__headline :global(.lp-heading): 1',
    ]);
  });

  // X70: the band's head shares its row with the price only where its widest
  // word fits beside it. The head grows from nothing, so its narrowest is its
  // own longest word (a flex item's automatic minimum), and the row wraps
  // before that word could run into the price. A minimum of the head's own,
  // or an overflow that is not visible (which zeroes that minimum), would let
  // the row keep a word that does not fit; so would a grid head, whose
  // narrowest drops a child with a minimum of 0 (the sweep, louder-fit, sets
  // one on every heading it reads).
  it("puts the pricing band's price under a head whose widest word does not fit beside it", () => {
    const pricing = kit.filter(
      (d) => d.file === 'blocks/pricing/PricingBlock.svelte'
    );
    const rule = (selector: string) =>
      Object.fromEntries(
        pricing
          .filter(
            (d) =>
              d.at === '@container (min-width: 60rem)' &&
              d.selector === selector
          )
          .map((d) => [d.property, d.value])
      );
    expect(rule(".pricing[data-layout='band']")).toMatchObject({
      display: 'flex',
      'flex-wrap': 'wrap',
    });
    expect(rule(".pricing[data-layout='band'] > .pricing__head")).toEqual({
      display: 'flex',
      'flex-direction': 'column',
      flex: '1 1 0',
    });
    expect(
      pricing
        .filter(
          (d) =>
            d.selector.includes('pricing__head') &&
            /^(min-inline-size|min-width|overflow(-x|-inline)?|contain)$/.test(
              d.property
            )
        )
        .map((d) => `${d.at} ${d.selector}: ${d.property}`)
    ).toEqual([]);
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

/**
 * The layouts whose titles the sweep found cut at the Style's own size
 * (Codex-61zsk.62): the rule that names each card's room for its title, and
 * how its card is found in a selector, its own file's or a Style's.
 */
const CARDS = [
  {
    file: 'blocks/benefits/BenefitsBlock.svelte',
    room: '.benefits-grid li',
    card: /\.benefits-grid li(?![\w-])/,
  },
  {
    file: 'blocks/benefits/BenefitsBento.svelte',
    room: '.benefits-bento__tile',
    card: /\.benefits-bento__tile(?![\w-])/,
  },
  {
    file: 'blocks/curriculum/StageCards.svelte',
    room: '.card',
    card: /(^|[^\w-])\.card(?![\w-])/,
  },
];
const TIMELINE = 'blocks/curriculum/StageTimeline.svelte';
const MAP = 'blocks/curriculum/StageMap.svelte';

describe("where a card names its title's room (03 X71)", () => {
  it('names it in each layout whose titles were cut', () => {
    for (const { file, room } of CARDS)
      expect(
        kit.some(
          (d) =>
            d.file === file &&
            d.at === '' &&
            d.selector === room &&
            d.property === '--lp-title-column'
        ),
        `${file} ${room}`
      ).toBe(true);
    // The timeline's name has the row past its marker, and wide its 5/12.
    expect(
      kit
        .filter(
          (d) =>
            d.file === TIMELINE &&
            d.selector === '.timeline' &&
            d.property === '--lp-title-column'
        )
        .map((d) => d.at)
    ).toEqual(['', '@container (min-width: 52rem)']);
  });

  // A card's room is its share of the column less its inset, its padding and
  // border across. A Style that boxes or opens a card and leaves its inset
  // as it was misstates the room: too wide, and a word still runs past its
  // line; too narrow, and a name that fits is drawn smaller. So each Style
  // that sets a card's inline padding or border states its inset there too.
  it('states its inset wherever a Style pads, borders or opens a card', () => {
    const INLINE =
      /^(padding|padding-inline(-start|-end)?|padding-(left|right)|border|border-inline(-start|-end)?(-width)?|border-(left|right)(-width)?|border-width)$/;
    const styleOf = (selector: string) =>
      selector.match(/data-lp-style='(\w+)'/)?.[1] ?? 'every Style';
    for (const { file, card } of CARDS) {
      const own = kit.filter(
        (d) =>
          (d.file === file || d.file.startsWith('styles/')) &&
          card.test(d.selector)
      );
      const key = (d: (typeof own)[number]) =>
        `${d.file} ${d.at} (${styleOf(d.selector)})`;
      const inset = new Set(
        own.filter((d) => d.property === '--_inset').map(key)
      );
      expect(
        [
          ...new Set(own.filter((d) => INLINE.test(d.property)).map(key)),
        ].filter((boxed) => !inset.has(boxed)),
        `${file}: a card boxed with no inset`
      ).toEqual([]);
    }
  });

  // Path reaches its timeline past the column's start to sit its markers on
  // the page's route; the names' room counts that reach only when the reach
  // is the timeline's own `--_reach`, which its margin is drawn from.
  it('widens the timeline and the map past their column only by their own reach', () => {
    for (const [file, list] of [
      [TIMELINE, 'timeline'],
      [MAP, 'map'],
    ])
      expect(
        kit
          .filter(
            (d) =>
              new RegExp(`\\.${list}$`).test(d.selector) &&
              /^margin(-inline(-start|-end)?|-left|-right)?$/.test(d.property)
          )
          .map((d) => `${d.file} ${d.selector}: ${d.property}: ${d.value}`)
      ).toEqual([
        `${file} .${list}: margin: 0`,
        `${file} .${list}: margin-inline-start: calc(-1 * var(--_reach))`,
      ]);
  });

  // The map's name shares its stop's row with the marker and the sign (its
  // count stands within the name's track, 03 X71). Its room is the stop less
  // every other track and a gap beside each, so a track added or resized
  // without its room fails here.
  it("states the map's room as its stop less the tracks beside the name", () => {
    const own = (selector: string, property: string) =>
      kit.find(
        (d) =>
          d.file === MAP &&
          d.at === '' &&
          d.selector === selector &&
          d.property === property
      )?.value;
    for (const summary of ['.map__summary', 'div.map__summary']) {
      const tracks = own(summary, 'grid-template-columns')?.split(
        /\s+(?![^(]*\))/
      );
      const room = own(summary, '--lp-title-column');
      expect(
        tracks?.filter((t) => t === 'minmax(0, 1fr)'),
        summary
      ).toHaveLength(1);
      const beside = (tracks ?? []).filter((t) => t !== 'minmax(0, 1fr)');
      const gaps = beside.length === 1 ? '' : `${beside.length} * `;
      expect(room, summary).toBe(
        `calc(var(--_stop) - ${beside.join(' - ')} - ${gaps}var(--_beside))`
      );
    }
    expect(own('.map__summary', 'column-gap')).toBe('var(--_beside)');
  });

  // Where the stops step, each is drawn at a share of the list; the stop its
  // name's room reads is the same share.
  it("steps the map's stop by the share its stops are drawn at", () => {
    const at = '@container (min-width: 48rem)';
    const drawn = kit.find(
      (d) =>
        d.file === MAP &&
        d.at === at &&
        d.selector === '.map__stage' &&
        d.property === 'inline-size'
    )?.value;
    const stop = kit.find(
      (d) =>
        d.file === MAP &&
        d.at === at &&
        d.selector === '.map' &&
        d.property === '--_stop'
    )?.value;
    expect(drawn).toMatch(/^\d+%$/);
    expect(stop).toBe(
      `calc((var(--lp-column) + var(--_reach)) * ${Number.parseFloat(drawn ?? '') / 100})`
    );
  });

  // The count goes under a name whose longest word needs the whole track only
  // while the row wraps and the name's narrowest is that word, capped at the
  // track. Unwrapped, the name keeps its width and the count runs into the
  // sign, which the sweep's check of a heading against its line cannot see.
  it("wraps the map's count under a name whose longest word needs its track", () => {
    const own = kit.filter((d) => d.file === MAP);
    const rule = (selector: string) =>
      Object.fromEntries(
        own
          .filter((d) => d.at === '' && d.selector === selector)
          .map((d) => [d.property, d.value])
      );
    expect(rule('.map__head')).toMatchObject({
      display: 'flex',
      'flex-wrap': 'wrap',
    });
    expect(rule('.map__head > :global(.map__name)')).toMatchObject({
      flex: '1 1 0',
      'max-inline-size': '100%',
    });
    expect(rule('.map__count')).toMatchObject({ flex: 'none' });
    expect(
      own
        .filter(
          (d) =>
            /map__(head|name)/.test(d.selector) &&
            /^(min-inline-size|min-width|overflow(-x|-inline)?|contain|flex-wrap)$/.test(
              d.property
            ) &&
            !(d.selector === '.map__head' && d.property === 'flex-wrap')
        )
        .map((d) => `${d.at} ${d.selector}: ${d.property}`)
    ).toEqual([]);
  });

  it('never names a room of nothing', () => {
    const rooms = kit.filter((d) => d.property === '--lp-title-column');
    expect(rooms.length).toBeGreaterThanOrEqual(5);
    expect(
      rooms
        .filter((d) => /^-?0(px|rem|cqi|%)?$/.test(d.value))
        .map((d) => `${d.file} ${d.selector}: ${d.value}`)
    ).toEqual([]);
  });
});

const STRIP = 'primitives/ScrollStrip.svelte';

describe('a row’s own heading beside its buttons (Codex-61zsk.55)', () => {
  // A strip's heading shares its line with the two buttons, so its room is
  // the line (the column) less the buttons, the two gaps on the line and its
  // own margin. Evaluated with distinct sizes, so a term dropped, doubled or
  // read from the wrong rule is a wrong number.
  it('names its room as the line less what stands beside it', () => {
    const own = (selector: string, property: string) => {
      const value = kit.find(
        (d) =>
          d.file === STRIP &&
          d.at === '' &&
          d.selector === selector &&
          d.property === property
      )?.value;
      if (value === undefined)
        throw new Error(`${selector} sets no ${property}`);
      return value;
    };
    const tokens: Record<string, string> = {
      '--lp-column': '1000px',
      '--tap-target-min': '44px',
      '--space-2': '8px',
      '--space-4': '16px',
    };
    const px = (text: string) =>
      evaluate(parseMath(text), (name) => tokens[name]).n;
    const move = px(own('.lp-strip__move', 'inline-size'));
    const gap = px(own('.lp-strip__nav', 'gap'));
    const margin = px(own('.lp-strip__head', 'margin-inline-end'));
    expect(px(own('.lp-strip__head', '--lp-heading-column'))).toBe(
      1000 - 2 * move - 2 * gap - margin
    );
    expect(1000 - 2 * move - 2 * gap - margin).toBe(1000 - 88 - 16 - 8);
  });
});
