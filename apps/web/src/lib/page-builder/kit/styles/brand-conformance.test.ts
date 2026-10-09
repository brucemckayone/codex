// @vitest-environment node
/**
 * Brand conformance (03-expressive-contract §1, §11): no kit stylesheet names
 * a colour or a font family of its own. Colours come from tokens and the
 * relative-colour / `color-mix()` recipes over them; families only from the
 * brand's font tokens. A Style decides how the brand is used, never which.
 *
 * Comments are stripped FIRST — prose may name a colour, and a check on raw
 * source cannot tell a live rule from a commented-out one. Only DECLARATIONS
 * are judged (a selector's `#lp-style` or an `@supports (… red …)` test is not
 * a colour anyone sees), and data-URI SVGs are decoded and judged too: an
 * image can carry a colour as easily as a declaration can.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = dirname(fileURLToPath(import.meta.url));
const FILES = readdirSync(DIR)
  .filter((file) => file.endsWith('.css'))
  .sort();

// CSS Color 4 named colours, plus the system colours.
const NAMED = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
    'yellowgreen accentcolor accentcolortext activetext buttonborder buttonface buttontext ' +
    'canvas canvastext field fieldtext graytext highlight highlighttext linktext mark marktext ' +
    'selecteditem selecteditemtext visitedtext'
  ).split(' ')
);

/** The channel keywords each colour function's relative form binds. */
const CHANNELS: Record<string, readonly string[]> = {
  rgb: ['r', 'g', 'b'],
  rgba: ['r', 'g', 'b'],
  hsl: ['h', 's', 'l'],
  hsla: ['h', 's', 'l'],
  hwb: ['h', 'w', 'b'],
  lab: ['l', 'a', 'b'],
  oklab: ['l', 'a', 'b'],
  lch: ['l', 'c', 'h'],
  oklch: ['l', 'c', 'h'],
  color: ['r', 'g', 'b', 'x', 'y', 'z'],
};

/** Comments out, strings and brackets respected. */
function stripComments(css: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      out += ch;
      if (ch === '\\') out += css[++i] ?? '';
      else if (ch === quote) quote = '';
    } else if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
      out += ' ';
    } else {
      if (ch === '"' || ch === "'") quote = ch;
      out += ch;
    }
  }
  return out;
}

interface Declaration {
  property: string;
  value: string;
}

/** Every `property: value` inside a block; preludes (selectors, at-rules) are skipped. */
function declarations(code: string): Declaration[] {
  const out: Declaration[] = [];
  let buffer = '';
  let quote = '';
  let depth = 0;
  const flush = () => {
    const colon = buffer.indexOf(':');
    if (colon > 0) {
      const property = buffer.slice(0, colon).trim();
      if (/^-{0,2}[a-zA-Z_][\w-]*$/.test(property))
        out.push({ property, value: buffer.slice(colon + 1).trim() });
    }
    buffer = '';
  };
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      buffer += ch;
      if (ch === '\\') buffer += code[++i] ?? '';
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && ch === '{') buffer = '';
    else if (depth === 0 && (ch === ';' || ch === '}')) flush();
    else buffer += ch;
  }
  return out;
}

/** The text between `open` (an index just past a `(`) and its matching `)`. */
function inside(text: string, open: number): string {
  let depth = 1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')' && --depth === 0) return text.slice(open, i);
  }
  return text.slice(open);
}

const URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g;

function svgViolations(svg: string): string[] {
  const out: string[] = [];
  for (const match of svg.matchAll(
    /\b(?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*['"]([^'"]*)['"]/g
  )) {
    if (!/^(none|currentcolor|transparent|inherit)$/i.test(match[1].trim()))
      out.push(`svg colour attribute "${match[1]}"`);
  }
  for (const match of svg.matchAll(
    /\b(?:fill|stroke|stop-color|flood-color|color)\s*:\s*([^;'"]+)/g
  )) {
    if (!/^(none|currentcolor|transparent|inherit)$/i.test(match[1].trim()))
      out.push(`svg colour style "${match[1].trim()}"`);
  }
  for (const match of svg.matchAll(/#[0-9a-fA-F]{3,8}(?![\w-])/g))
    out.push(`svg hex ${match[0]}`);
  if (/\b(?:rgba?|hsla?)\(/.test(svg)) out.push('svg colour function');
  return out;
}

interface Scan {
  violations: string[];
  declarations: number;
  svgs: number;
}

function scan(css: string): Scan {
  const violations: string[] = [];
  let svgs = 0;
  const found = declarations(stripComments(css));
  for (const { property, value } of found) {
    const where = `${property}: ${value.slice(0, 80)}`;

    // Images first: decode any SVG, then take urls and strings out of play.
    for (const match of value.matchAll(URL)) {
      const url = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (!url.startsWith('data:image/svg+xml')) continue;
      svgs++;
      const payload = url.slice(url.indexOf(',') + 1);
      const svg = /;base64,/.test(url.slice(0, url.indexOf(',') + 1))
        ? Buffer.from(payload, 'base64').toString('utf8')
        : decodeURIComponent(payload);
      for (const v of svgViolations(svg))
        violations.push(`${v} in ${property}`);
    }
    const bare = value.replace(URL, ' ').replace(/"[^"]*"|'[^']*'/g, ' ');

    for (const match of bare.matchAll(/#[0-9a-fA-F]{3,8}(?![\w-])/g))
      violations.push(`hex ${match[0]} — ${where}`);

    for (const match of bare.matchAll(
      /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi
    )) {
      const fn = match[1].toLowerCase();
      const args = inside(bare, (match.index ?? 0) + match[0].length).trim();
      if (!/^from\s/i.test(args)) {
        violations.push(`literal ${fn}() — ${where}`);
        continue;
      }
      // Relative colour: past the origin, a channel must come from it (or a token).
      const rest = args.replace(/^from\s+/i, '');
      const origin = /^[\w-]+\(/.test(rest)
        ? rest.slice(0, rest.indexOf('(') + 1) +
          inside(rest, rest.indexOf('(') + 1) +
          ')'
        : (rest.split(/\s/)[0] ?? '');
      const channels = rest.slice(origin.length);
      const bound = CHANNELS[fn].some((c) =>
        new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(channels)
      );
      if (!bound && !/var\(/.test(channels))
        violations.push(`constant ${fn}(from …) — ${where}`);
    }

    // Identifiers that are not function names.
    for (const match of bare.matchAll(
      /(?<![\w#-])([a-zA-Z][\w-]*)(?![\w(-])/g
    )) {
      if (NAMED.has(match[1].toLowerCase()))
        violations.push(`named colour ${match[1]} — ${where}`);
    }

    const familyLike =
      property === 'font-family' ||
      property === 'font' ||
      (/^--.*(font|family)/.test(property) &&
        !/(size|weight|scale|synthesis|feature|variant|stretch|style|optical|smooth)/.test(
          property
        ));
    if (familyLike && !isFamilyToken(value))
      violations.push(`font family — ${where}`);
  }
  return { violations, declarations: found.length, svgs };
}

/** `inherit`, or `var(--font-*)` / `var(--lp-font-*)` with fallbacks of the same. */
function isFamilyToken(value: string): boolean {
  const v = value.trim();
  if (v === 'inherit') return true;
  if (!v.startsWith('var(') || !v.endsWith(')')) return false;
  const body = inside(v, 4);
  if (body.length !== v.length - 5) return false;
  const comma = body.indexOf(',');
  const name = (comma < 0 ? body : body.slice(0, comma)).trim();
  if (!/^--(lp-)?font-[\w-]+$/.test(name)) return false;
  return comma < 0 || isFamilyToken(body.slice(comma + 1));
}

const svg = (markup: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;

describe('the conformance scanner (calibration)', () => {
  it('finds each kind of literal', () => {
    const cases: [string, number][] = [
      ['.a { color: #fff; }', 1],
      ['.a { background: rgb(0 0 0 / 50%); }', 1],
      ['.a { color: hsla(0, 0%, 0%, 0.5); }', 1],
      ['.a { --x: oklch(0.5 0.1 200); }', 1],
      ['.a { border-color: Red; }', 1],
      ['.a { --x: color-mix(in oklab, var(--a) 55%, white); }', 1],
      ['.a { --x: oklch(from var(--a) 0.2 0 0); }', 1],
      // A private token is still a declaration (the kit's recipes are `--_*`).
      ['.a { --_x: #000; }', 1],
      ['.a { font-family: Georgia, serif; }', 1],
      ['.a { font: 1rem "Inter"; }', 1],
      [".a { --lp-font-display: 'Syne', sans-serif; }", 1],
      [`.a { mask: ${svg("<svg><path fill='#c24129' d='M0 0'/></svg>")}; }`, 2],
      [`.a { mask: ${svg("<svg><path stroke='red' d='M0 0'/></svg>")}; }`, 1],
    ];
    for (const [css, count] of cases)
      expect(scan(css).violations, css).toHaveLength(count);
  });

  it('passes the recipes and structure the kit is allowed', () => {
    const css = `
      /* a note that names #fafafa, white and rgb(0 0 0) */
      :is(.lp, #lp-style)[data-lp-style='bold'] .x { color: var(--lp-ink); }
      @supports (color: rgb(from red r g b / 0.5)) {
        .a { --v: rgb(from var(--lp-ground) r g b / var(--s)); }
      }
      @container lp-page style(--lp-texture: grain) { .b { --t: 1; } }
      .c {
        --i: oklch(
          from var(--lp-bg) clamp(0.16, (0.62 - l) * 1000, 0.97) calc(c * 0.2) h
        );
        --m: color-mix(in oklab, var(--lp-ink) 16%, transparent);
        --w: color-mix(in oklch, var(--lp-brand) 55%, var(--color-neutral-0) 45%);
        background: linear-gradient(currentColor 0 0);
        rotate: calc(tan(45deg) * 1deg);
        animation: lp-drift 1s infinite alternate;
        mask: ${svg("<svg><filter id='n'><feTurbulence/></filter><rect filter='url(#n)'/></svg>")};
        font-family: var(--lp-font-body);
        --lp-font-body: var(--font-body, var(--font-sans));
        font: inherit;
      }`;
    expect(scan(css).violations).toEqual([]);
  });
});

describe('every kit stylesheet conforms to the brand', () => {
  const scans = Object.fromEntries(
    FILES.map((file) => [file, scan(readFileSync(join(DIR, file), 'utf8'))])
  );

  it('reads the Style sheets, the surfaces and the schemes', () => {
    expect(FILES).toEqual(
      expect.arrayContaining([
        'kit.css',
        'schemes.css',
        'surfaces.css',
        'style-bold.css',
        'style-clean.css',
        'style-soft.css',
        'style-cinematic.css',
        'style-path.css',
        'style-poster.css',
        'style-studio.css',
        'style-quiet.css',
      ])
    );
    // Not vacuous: every file yields declarations, and the SVGs were opened.
    for (const file of FILES)
      expect(scans[file].declarations, file).toBeGreaterThan(0);
    expect(scans['schemes.css'].declarations).toBeGreaterThan(150);
    expect(scans['surfaces.css'].svgs).toBeGreaterThanOrEqual(10);
  });

  it.each(FILES)('%s names no colour and no font family of its own', (file) => {
    expect(scans[file].violations).toEqual([]);
  });
});
