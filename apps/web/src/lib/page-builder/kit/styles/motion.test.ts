// @vitest-environment node
/**
 * Motion safety (03-expressive-contract §6, §11): under reduced motion and on
 * a still page (`.lp[data-lp-still]` — the canvas, thumbnails) nothing in the
 * kit animates, and `motion.css` keeps its own contract.
 *
 * A jsdom render cannot answer this: it runs no CSS, so every animation
 * "stops" there. The gate reads the CSS instead — parsed by svelte's own CSS
 * parser, each declaration with the at-rules around it and every selector of
 * its rule — across every kit stylesheet and every kit component's <style>.
 * The one animation the kit starts from script, the count-up, is held by
 * `motion/count-up.test.ts` and the stats block's tests.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseCss } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import { BUILD_SIZES, BUILDS, DEPTHS, REVEALS } from '../motion/attributes';

const STYLES = dirname(fileURLToPath(import.meta.url));
const KIT = dirname(STYLES);
const MOTION = readFileSync(join(STYLES, 'motion.css'), 'utf8');

interface Declared {
  property: string;
  value: string;
  /** Every selector of the rule, as written (nested rules joined to their parents). */
  selectors: string[];
  /** The at-rules around it, outermost first, e.g. `@media screen and (…)`. */
  conditions: string[];
}

interface Keyframes {
  name: string;
  properties: string[];
}

interface Sheet {
  declared: Declared[];
  keyframes: Keyframes[];
  atrules: string[];
}

type CssNode = {
  type: string;
  start: number;
  end: number;
  name?: string;
  prelude?: string | { children: { start: number; end: number }[] };
  property?: string;
  value?: string;
  block?: { children: CssNode[] } | null;
};

function read(nodes: CssNode[], source: string): Sheet {
  const sheet: Sheet = { declared: [], keyframes: [], atrules: [] };
  const walk = (list: CssNode[], conditions: string[], parents: string[]) => {
    for (const node of list) {
      if (node.type === 'Atrule') {
        sheet.atrules.push(node.name ?? '');
        if (node.name === 'keyframes') {
          const properties = new Set<string>();
          for (const frame of node.block?.children ?? [])
            for (const child of frame.block?.children ?? [])
              if (child.type === 'Declaration')
                properties.add(child.property ?? '');
          sheet.keyframes.push({
            name: String(node.prelude),
            properties: [...properties],
          });
          continue;
        }
        walk(
          node.block?.children ?? [],
          [...conditions, `@${node.name} ${node.prelude}`],
          parents
        );
      } else if (
        node.type === 'Rule' &&
        typeof node.prelude === 'object' &&
        node.prelude
      ) {
        const own = node.prelude.children.map((part) =>
          source.slice(part.start, part.end).replace(/\s+/g, ' ').trim()
        );
        const selectors = parents.length
          ? parents.flatMap((parent) =>
              own.map((part) =>
                part.includes('&')
                  ? part.replaceAll('&', parent)
                  : `${parent} ${part}`
              )
            )
          : own;
        for (const child of node.block?.children ?? []) {
          if (child.type === 'Declaration')
            sheet.declared.push({
              property: child.property ?? '',
              value: child.value ?? '',
              selectors,
              conditions,
            });
          else walk([child], conditions, selectors);
        }
      }
    }
  };
  walk(nodes, [], []);
  return sheet;
}

const readCss = (source: string) =>
  read(parseCss(source).children as unknown as CssNode[], source);

function readSvelte(source: string): Sheet {
  const css = parse(source, { modern: true }).css;
  return css
    ? read(css.children as unknown as CssNode[], source)
    : { declared: [], keyframes: [], atrules: [] };
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(css|svelte)$/.test(entry.name) ? [path] : [];
  });
}

// ── the kit-wide gate ─────────────────────────────────────────────────────
const REDUCED_OFF = /prefers-reduced-motion:\s*no-preference/;
const STILL_OFF = /\.lp(?:\[[^\]]*\])*:not\(\[data-lp-still\]\)/;

/** Declarations that start an animation (a named one, or a scroll-driven one). */
function animates({ property, value }: Declared): boolean {
  const v = value.trim();
  if (property === 'animation' || property === 'animation-name')
    return v !== 'none';
  if (property === 'animation-timeline') return v !== 'auto' && v !== 'none';
  return false;
}

/** Every way an animation here could run under reduced motion or when still. */
function ungated(sheet: Sheet): string[] {
  return sheet.declared.filter(animates).flatMap((d) => {
    const where = `${d.property}: ${d.value}`;
    const out: string[] = [];
    if (!d.conditions.some((c) => REDUCED_OFF.test(c)))
      out.push(`runs under reduced motion — ${where}`);
    for (const selector of d.selectors)
      if (!STILL_OFF.test(selector))
        out.push(`runs on a still page — ${selector} { ${where} }`);
    return out;
  });
}

// ── motion.css's own contract ─────────────────────────────────────────────
const MOTION_GATES = [
  /^@media screen and \(prefers-reduced-motion: no-preference\)$/,
  /^@supports \(animation-timeline: view\(\)\)$/,
];
const ROOT_GATE = ':root[data-theme] .lp:not([data-lp-still])';

/** What may sit outside the gates: the marks (images) and counting's layout. */
const UNGATED: Record<string, RegExp> = {
  '.lp': /^--lp-mark-(underline|circle|scribble|arrow)$/,
  '[data-lp-counting]': /^(position|-webkit-text-fill-color)$/,
  '.lp-count':
    /^(position|inset|-webkit-text-fill-color|pointer-events|display)$/,
};

/** Only these move; the two paint properties are the documented exceptions. */
const COMPOSITED = new Set([
  'opacity',
  'translate',
  'scale',
  'rotate',
  'transform',
  'clip-path',
]);
const PAINTED: Record<string, string> = {
  'lp-readalong': 'color',
  'lp-draw-stroke': 'stroke-dashoffset',
};

function motionViolations(source: string): string[] {
  const sheet = readCss(source);
  const out: string[] = [];
  if (sheet.atrules.includes('property'))
    out.push('@property is not adopted in this repo');
  for (const d of sheet.declared) {
    const where = `${d.selectors.join(', ')} { ${d.property}: ${d.value} }`;
    const inPrint = d.conditions.includes('@media print');
    const allowed = d.selectors.every((s) => UNGATED[s]?.test(d.property));
    const gated =
      MOTION_GATES.every((gate, i) => gate.test(d.conditions[i] ?? '')) &&
      d.selectors.every((s) => s.startsWith(ROOT_GATE));
    if (!gated && !allowed && !inPrint)
      out.push(`outside the gates — ${where}`);
    if (/(?<![\w.-])\d*\.?\d+m?s(?![\w-])/.test(d.value))
      out.push(`a literal duration — ${where}`);
    if (
      /cubic-bezier\(|steps\(|(?<![\w-])ease(-in|-out|-in-out)?(?![\w-])/.test(
        d.value
      )
    )
      out.push(`a literal easing — ${where}`);
  }
  for (const { name, properties } of sheet.keyframes)
    for (const property of properties)
      if (!COMPOSITED.has(property) && PAINTED[name] !== property)
        out.push(`@keyframes ${name} animates ${property}`);
  return out;
}

/** The selector of each rule that handles a value, for the vocabulary check. */
function handles(
  source: string
): { selectors: string[]; conditions: string[] }[] {
  return readCss(source).declared.filter(animates);
}

describe('the motion gates (calibration)', () => {
  it('finds an animation that would run under reduced motion or when still', () => {
    const bad = [
      '.lp .a { animation: lp-fade 1s; }',
      '@media (prefers-reduced-motion: no-preference) { .a { animation: lp-fade 1s; } }',
      '@media (prefers-reduced-motion: no-preference) { .lp:not([data-lp-still]) .a, .b { animation-name: x; } }',
      '@media (prefers-reduced-motion: no-preference) { .a { animation-timeline: view(); } }',
    ];
    for (const css of bad) expect(ungated(readCss(css)), css).not.toEqual([]);
    const good = [
      '.a { animation: none; }',
      '@media (prefers-reduced-motion: no-preference) { .lp:not([data-lp-still]) .a { animation: x 1s; } }',
      '@media (prefers-reduced-motion: no-preference) { .lp[data-lp-atmosphere]:not([data-lp-still]) .a { animation: x; } }',
    ];
    for (const css of good) expect(ungated(readCss(css)), css).toEqual([]);
  });

  it('reads a component’s <style>, :global and nesting included', () => {
    const component = `<div class="x"></div>
      <style>
        @media (prefers-reduced-motion: no-preference) {
          :global(:root[data-theme] .lp:not([data-lp-still])) .x { animation: a 1s; }
          .y { & .z { animation: b 1s; } }
        }
      </style>`;
    expect(ungated(readSvelte(component))).toEqual([
      'runs on a still page — .y .z { animation: b 1s }',
    ]);
  });

  it('holds motion.css to its own contract', () => {
    const gated = (rule: string) =>
      `@media screen and (prefers-reduced-motion: no-preference) { @supports (animation-timeline: view()) { ${rule} } }`;
    const cases: [string, number][] = [
      [gated(`${ROOT_GATE} .a { animation: lp-x var(--_lp-enter); }`), 0],
      [gated('.lp:not([data-lp-still]) .a { animation: lp-x both; }'), 1],
      [`${ROOT_GATE} .a { animation: lp-x both; }`, 1],
      [gated(`${ROOT_GATE} .a { animation: lp-x 300ms both; }`), 1],
      [gated(`${ROOT_GATE} .a { animation: lp-x ease-out both; }`), 1],
      [
        gated(`${ROOT_GATE} .a { animation: lp-x cubic-bezier(0, 0, 1, 1); }`),
        1,
      ],
      [
        '@property --x { syntax: "<number>"; inherits: false; initial-value: 0; }',
        1,
      ],
      ['@keyframes lp-grow { from { width: 0; } }', 1],
      ['@keyframes lp-readalong { from { color: var(--a); } }', 0],
      ['.lp { --lp-mark-circle: url(x); }', 0],
      ['.lp { --lp-mark-draw: lp-wipe both; }', 1],
      ['.lp-count { translate: 0 1em; }', 1],
      ['@media print { .lp-count { display: none; } }', 0],
    ];
    for (const [css, count] of cases)
      expect(motionViolations(css), css).toHaveLength(count);
  });
});

describe('nothing in the kit animates under reduced motion or on a still page', () => {
  const sources = files(KIT).map((path) => {
    const source = readFileSync(path, 'utf8');
    return {
      file: relative(KIT, path),
      sheet: path.endsWith('.css') ? readCss(source) : readSvelte(source),
    };
  });

  it('reads every stylesheet and component, and finds the animations', () => {
    expect(sources.length).toBeGreaterThan(60);
    const found = sources.flatMap(({ sheet }) =>
      sheet.declared.filter(animates)
    );
    // Not vacuous: the hero entrance, the glows' drift, and motion.css's own.
    expect(found.length).toBeGreaterThan(30);
    expect(
      sources
        .find((s) => s.file === 'blocks/hero/HeroBlock.svelte')
        ?.sheet.declared.filter(animates)
    ).toHaveLength(3);
  });

  it.each(files(KIT).map((path) => relative(KIT, path)))('%s', (file) => {
    const { sheet } = sources.find((s) => s.file === file)!;
    expect(ungated(sheet)).toEqual([]);
  });
});

describe('motion.css', () => {
  it('keeps its contract: gated, tokens only, compositor only, no @property', () => {
    expect(motionViolations(MOTION)).toEqual([]);
  });

  it('gives every value of the attribute API a rule', () => {
    const rules = handles(MOTION)
      .flatMap((d) => d.selectors)
      .join('\n');
    for (const value of REVEALS)
      expect(rules).toContain(`[data-lp-reveal='${value}']`);
    for (const value of BUILDS)
      expect(rules).toContain(`[data-lp-build='${value}']`);
    expect(rules).toContain('[data-lp-parallax]');
    expect(rules).toContain('svg[data-lp-draw]');
    expect(rules).toContain('[data-lp-draw]:not(svg)');
    expect(rules).toContain("svg[data-lp-draw='stroke']");
    expect(rules).toContain('[data-lp-readalong]');
    const depth = readCss(MOTION).declared.filter(
      (d) =>
        d.property === '--_lp-drift' &&
        d.selectors.some((s) => s.endsWith("[data-lp-parallax='2']"))
    );
    expect(depth).toHaveLength(1);
  });

  it('answers every value of every hook a Style can set', () => {
    const queries = handles(MOTION)
      .flatMap((d) => d.conditions)
      .join('\n');
    for (const size of BUILD_SIZES)
      for (const value of BUILDS)
        expect(queries).toContain(`style(--lp-build-${size}: ${value})`);
    for (const value of REVEALS)
      expect(queries).toContain(`style(--lp-media-reveal: ${value})`);
    for (const depth of DEPTHS)
      expect(queries).toContain(`style(--lp-media-parallax: ${depth})`);
    expect(queries).toContain('style(--lp-text-readalong: on)');
  });

  it('never moves the hero, which has its own entrance', () => {
    const hooks = readCss(MOTION).declared.filter(
      (d) =>
        d.property === 'animation' &&
        d.conditions.some((c) => c.startsWith('@container'))
    );
    // Nine builds, four reveals, the drift, the read-along.
    expect(hooks).toHaveLength(15);
    for (const { selectors } of hooks)
      for (const selector of selectors)
        expect(selector).toContain(".lp-section:not([data-lp-type='hero'])");
  });

  it('offers the four marks as colourless masks a pen of one width draws', () => {
    const marks = readCss(MOTION).declared.filter(
      (d) => d.property.startsWith('--lp-mark-') && d.value.startsWith('url(')
    );
    expect(marks.map((d) => d.property).sort()).toEqual([
      '--lp-mark-arrow',
      '--lp-mark-circle',
      '--lp-mark-scribble',
      '--lp-mark-underline',
    ]);
    for (const { property, value } of marks) {
      const svg = decodeURIComponent(
        value.slice(value.indexOf(',') + 1, value.lastIndexOf('"'))
      );
      expect(svg, property).toMatch(
        /^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg'/
      );
      expect(svg, property).toContain("stroke='currentColor'");
      // Stretched to any box, a stroke would thicken with it: the pen holds.
      if (property !== '--lp-mark-arrow')
        for (const path of svg.match(/<path [^>]*>/g) ?? [])
          expect(path, property).toContain(
            "vector-effect='non-scaling-stroke'"
          );
    }
  });
});
