import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AST, parse } from 'svelte/compiler';
import { describe, expect, test } from 'vitest';

/**
 * The org home hero takes the org's PAGE ink unless a shader is painting
 * behind it. (Codex-okfrf)
 *
 * Every `--brand-hero-*` colour, and the `white` each falls back to, is
 * authored for the dark ground a shader paints. On an org with no shader the
 * ground is the page itself, and the hero drew white text on it: 1.14:1 on
 * of-blood-and-bones' parchment, 1.04:1 on studio-beta. An org WITH a shader
 * showed the same white on the light page from first paint until its
 * renderer loaded, and for good if WebGL was unavailable.
 *
 * So the ink is a function of ONE state — is ShaderHero's canvas visible? —
 * and this file pins both halves of that:
 *   - page state: every hero text colour resolves to the org's page tokens,
 *     never white and never a `--brand-hero-*` input;
 *   - painting state: every hero text colour resolves to EXACTLY the
 *     expression it had before the fix, so orgs with a shader are unchanged.
 *
 * WHY RESOLVE, NOT GREP. The consumers read private `--_hero-*` properties
 * that `.hero` defines, so a string check on `.hero__description { color }`
 * would stop at the first `var()` hop and pass whatever that property holds.
 * The resolver below substitutes every `--_hero-*` reference through the
 * rules of the state under test and asserts what the consumer ends up
 * reading. An undefined private property throws, so a typo cannot pass.
 *
 * WHY A SOURCE TEST. There is no render harness for the org landing page
 * (remote functions, collections, the layout's brand injection), and jsdom
 * neither loads Svelte component CSS nor resolves `var()`. The rendered
 * contrast was measured in a real browser for Codex-okfrf; this is the
 * regression guard for the CSS contract that measurement depends on. The
 * stylesheet is parsed by Svelte's own compiler, which drops comments, so
 * prose and commented-out code cannot satisfy it.
 */

const SPACE_DIR = join(import.meta.dirname, '..');
const WEB_SRC = join(SPACE_DIR, '..', '..', '..', '..');
const PAGE = join(SPACE_DIR, '+page.svelte');
const LAYOUT = join(SPACE_DIR, '..', '+layout.svelte');
const SHADER_HERO = join(
  WEB_SRC,
  'lib',
  'components',
  'ui',
  'ShaderHero',
  'ShaderHero.svelte'
);

const pageSource = readFileSync(PAGE, 'utf8');

interface CssRule {
  selector: string;
  decls: Map<string, string>;
}

const declsOf = (
  children: ReadonlyArray<AST.CSS.Rule | AST.CSS.Atrule | AST.CSS.Declaration>
) => {
  const decls = new Map<string, string>();
  for (const child of children)
    if (child.type === 'Declaration')
      decls.set(child.property, child.value.trim());
  return decls;
};

function readStylesheet(source: string) {
  const css = parse(source, { modern: true }).css;
  if (!css) throw new Error('component has no <style> block');
  return css;
}

/** Every style rule in a component, flattened out of @media / @keyframes. */
function readRules(source: string): CssRule[] {
  const rules: CssRule[] = [];
  const walk = (
    nodes: ReadonlyArray<AST.CSS.Rule | AST.CSS.Atrule | AST.CSS.Declaration>
  ) => {
    for (const node of nodes) {
      if (node.type === 'Atrule') {
        if (node.block) walk(node.block.children);
      } else if (node.type === 'Rule') {
        const selector = source
          .slice(node.prelude.start, node.prelude.end)
          .replace(/\s+/g, ' ')
          .trim();
        rules.push({ selector, decls: declsOf(node.block.children) });
        walk(node.block.children.filter((c) => c.type !== 'Declaration'));
      }
    }
  };
  walk(readStylesheet(source).children);
  return rules;
}

const rules = readRules(pageSource);

/** `@property` registrations, by property name. */
const registered = new Map(
  readStylesheet(pageSource)
    .children.filter(
      (n): n is AST.CSS.Atrule => n.type === 'Atrule' && n.name === 'property'
    )
    .map((n) => [n.prelude.trim(), declsOf(n.block?.children ?? [])] as const)
);

/** The painting-shader state: the rule(s) keyed on the canvas being visible. */
const isLive = (r: CssRule) =>
  r.selector.includes(':has(') && r.selector.includes('canvas[style');
const declaresInk = (r: CssRule) =>
  [...r.decls.keys()].some((p) => p.startsWith('--_hero-'));
const liveHero = rules.filter(
  (r) => isLive(r) && r.selector.endsWith(' .hero') && declaresInk(r)
);
// `.hero` also has a responsive min-height rule; only the one defining the ink counts.
const baseHero = rules.filter((r) => r.selector === '.hero' && declaresInk(r));

/** The private `--_hero-*` properties in force for a state, in cascade order. */
function propsFor(state: 'page' | 'painting'): Map<string, string> {
  const props = new Map<string, string>();
  const layers = state === 'page' ? baseHero : [...baseHero, ...liveHero];
  for (const rule of layers) {
    for (const [prop, value] of rule.decls)
      if (prop.startsWith('--_hero-')) props.set(prop, value);
  }
  return props;
}

function resolveInk(
  value: string,
  props: Map<string, string>,
  depth = 0
): string {
  if (depth > 8) throw new Error(`--_hero-* reference cycle in: ${value}`);
  return value.replace(/var\(\s*(--_hero-[\w-]+)\s*\)/g, (_, name: string) => {
    const def = props.get(name);
    if (def === undefined)
      throw new Error(`${name} is read but never defined on .hero`);
    return resolveInk(def, props, depth + 1);
  });
}

/** The single base (non-state) rule for a selector — throws if it is not exactly one. */
function declOf(selector: string, property: string): string {
  const hits = rules.filter(
    (r) => r.selector === selector && r.decls.has(property)
  );
  if (hits.length !== 1)
    throw new Error(
      `expected exactly one \`${selector} { ${property} }\`, found ${hits.length}`
    );
  return hits[0].decls.get(property) as string;
}

/**
 * Each hero text role, the value it must resolve to with NO shader painting,
 * and the value it had before Codex-okfrf, which it must keep while one is.
 */
const TEXT_ROLES: ReadonlyArray<{
  selector: string;
  property: string;
  page: string;
  painting: string;
}> = [
  {
    selector: '.hero',
    property: 'color',
    page: 'var(--color-text)',
    painting: 'var(--brand-hero-text, white)',
  },
  {
    selector: '.hero__title',
    property: 'color',
    page: 'var(--color-heading, var(--color-text))',
    painting: 'var(--brand-hero-title-color, white)',
  },
  {
    selector: '.hero__title',
    property: 'mix-blend-mode',
    page: 'normal',
    painting: 'var(--brand-hero-title-blend, difference)',
  },
  {
    selector: '.hero__description',
    property: 'color',
    page: 'color-mix(in srgb, var(--color-text) 80%, transparent)',
    painting:
      'color-mix(in srgb, var(--brand-hero-text, white) 80%, transparent)',
  },
  {
    selector: '.hero__pill',
    property: 'color',
    page: 'var(--color-text)',
    painting: 'var(--brand-hero-text, white)',
  },
  {
    selector: '.hero__pill--category',
    property: 'color',
    page: 'color-mix(in srgb, var(--color-text) 75%, transparent)',
    painting:
      'color-mix(in srgb, var(--brand-hero-text-muted, white) 75%, transparent)',
  },
  {
    selector: '.hero__cta--glass',
    property: 'color',
    page: 'var(--color-text)',
    painting: 'var(--brand-hero-glass-text, white)',
  },
  {
    selector: '.hero__stat-number',
    property: 'color',
    page: 'var(--color-text)',
    painting: 'var(--brand-hero-text, white)',
  },
  {
    selector: '.hero__stat-label',
    property: 'color',
    page: 'color-mix(in srgb, var(--color-text) 62%, transparent)',
    painting:
      'color-mix(in srgb, var(--brand-hero-text-muted, white) 62%, transparent)',
  },
];

describe('org home hero ink (Codex-okfrf)', () => {
  test('the ink is defined by one base rule on .hero and overridden by one painting-shader rule', () => {
    expect(baseHero).toHaveLength(1);
    expect(liveHero).toHaveLength(1);
    // Both states define the same set of private properties, so no role can
    // silently keep the other state's value.
    const names = (r: CssRule) =>
      [...r.decls.keys()].filter((p) => p.startsWith('--_hero-')).sort();
    expect(names(liveHero[0])).toEqual(names(baseHero[0]));
  });

  test('every ink role swaps halfway through the canvas fade, not on its first frame', () => {
    // The swap is a discrete transition on the painting rule, which Chromium
    // runs only for a REGISTERED custom property. A role missing from either
    // list snaps to white while the canvas is still at opacity 0.
    const roles = [...baseHero[0].decls.keys()]
      .filter((p) => p.startsWith('--_hero-'))
      .sort();
    const live = liveHero[0].decls;
    const transitioned = (live.get('transition-property') ?? '')
      .split(',')
      .map((p) => p.trim())
      .sort();
    expect(transitioned).toEqual(roles);
    expect(live.get('transition-behavior')).toBe('allow-discrete');
    // Same duration and easing as ShaderHero's `--transition-opacity`, so the
    // eased 50% flip lands exactly when the canvas crosses half opacity.
    expect(live.get('transition-duration')).toBe('var(--duration-normal)');
    expect(live.get('transition-timing-function')).toBe('var(--ease-default)');
    for (const role of roles) {
      // `inherits: false` would cut every hero child off from the ink.
      expect(registered.get(role)?.get('inherits'), role).toBe('true');
      expect(registered.get(role)?.get('syntax'), role).toBe("'*'");
    }
    // Only the painting rule transitions: a theme switch without a shader is instant.
    expect(baseHero[0].decls.has('transition-property')).toBe(false);
  });

  test.each(
    TEXT_ROLES
  )('with no shader painting, $selector { $property } is the org page ink', (role) => {
    expect(
      resolveInk(declOf(role.selector, role.property), propsFor('page'))
    ).toBe(role.page);
  });

  test.each(
    TEXT_ROLES
  )('with a shader painting, $selector { $property } is unchanged', (role) => {
    expect(
      resolveInk(declOf(role.selector, role.property), propsFor('painting'))
    ).toBe(role.painting);
  });

  test('no hero colour anywhere falls back to white or reads a --brand-hero-* input without a shader', () => {
    // Every colour-bearing declaration on a hero element (layout variants and
    // hover states included), plus the hero keyframes. The primary CTA is the
    // one exception: it paints its own opaque ground, so its authored pair is
    // legible whatever is behind the hero.
    const COLOUR_PROPS =
      /^(color|background(-color)?|border(-(top|right|bottom|left))?(-color)?|box-shadow|outline(-color)?|fill|stroke|mix-blend-mode)$/;
    const heroRule = (r: CssRule) =>
      /\.hero(__|\b)/.test(r.selector) || /^\d+%/.test(r.selector);
    const offenders: string[] = [];
    let checked = 0;
    for (const rule of rules) {
      if (
        isLive(rule) ||
        !heroRule(rule) ||
        rule.selector.includes('hero__cta--primary')
      )
        continue;
      for (const [prop, value] of rule.decls) {
        if (!COLOUR_PROPS.test(prop)) continue;
        checked += 1;
        const ink = resolveInk(value, propsFor('page'));
        if (/\bwhite\b/.test(ink) || ink.includes('--brand-hero-'))
          offenders.push(`${rule.selector} { ${prop}: ${ink} }`);
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  test('the dark gradient under the hero content exists only while a shader is painting', () => {
    const gradients = rules.filter(
      (r) =>
        r.selector.endsWith('.hero::after') &&
        r.decls.get('background')?.includes('linear-gradient')
    );
    expect(gradients).toHaveLength(1);
    expect(isLive(gradients[0])).toBe(true);
  });
});

describe('the painting-shader selector reads what ShaderHero writes', () => {
  // `?? ''` keeps a MISSING rule a failed assertion below rather than a crash
  // while the suite is being collected.
  const liveSelector = (liveHero[0]?.selector ?? '').replace(
    /^:global\((.*)\) \.hero$/,
    '$1 .hero'
  );

  test('it matches the hero only while the fullpage canvas is at opacity 1', () => {
    expect(liveSelector).toMatch(
      /:has\(.*canvas\[style\*='opacity: 1'\]\) \.hero$/
    );
    // The layout's structure: ShaderHero's root is a direct child of
    // .org-layout and the canvas is a direct child of that root.
    document.body.innerHTML = `
      <div class="org-layout">
        <div class="shader-hero shader-hero--fullpage"><canvas class="shader-hero__canvas"></canvas></div>
        <main><section class="hero"></section></main>
      </div>`;
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const hero = document.querySelector('.hero');

    expect(document.querySelector(liveSelector)).toBeNull(); // SSR / before mount: no inline opacity
    canvas.style.opacity = '0'; // preset 'none', or a renderer that failed
    expect(document.querySelector(liveSelector)).toBeNull();
    canvas.style.opacity = '1'; // a renderer initialised
    expect(document.querySelector(liveSelector)).toBe(hero);
    canvas.style.opacity = '0'; // the editor switched the shader off again
    expect(document.querySelector(liveSelector)).toBeNull();
    canvas.remove(); // `hasWebGL = false` drops the canvas entirely
    expect(document.querySelector(liveSelector)).toBeNull();
  });

  test('ShaderHero shows its canvas only by setting opacity 1, and the layout mounts it as the fullpage shader', () => {
    const stripComments = (s: string) =>
      s
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const shader = stripComments(readFileSync(SHADER_HERO, 'utf8'));
    // Hidden by default, shown by the inline `opacity: 1` the selector matches.
    expect(
      readRules(readFileSync(SHADER_HERO, 'utf8'))
        .find((r) => r.selector === '.shader-hero__canvas')
        ?.decls.get('opacity')
    ).toBe('0');
    expect(shader.match(/\.style\.opacity = '1'/g)).toHaveLength(1);
    expect(shader).toMatch(/\.style\.opacity = '0'/);
    expect(stripComments(readFileSync(LAYOUT, 'utf8'))).toMatch(
      /<ShaderHero class="shader-hero--fullpage" \/>/
    );
  });
});
