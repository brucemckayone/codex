import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
 * So the ink is a function of ONE state: has the fullpage ShaderHero drawn
 * the frame its canvas shows (its root's `data-live`)? This
 * file pins both halves of that:
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
const ORG_HERO = join(
  WEB_SRC,
  'lib',
  'components',
  'org-hero',
  'OrgHero.svelte'
);
const HERO_SPOT = join(
  WEB_SRC,
  'lib',
  'components',
  'org-hero',
  'HeroSpot.svelte'
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

/** The painting-shader state: the rule(s) keyed on ShaderHero's `data-live`. */
const isLive = (r: CssRule) =>
  r.selector.includes(':has(') && r.selector.includes('[data-live]');
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

  test("it matches the hero only while the fullpage shader's root is `data-live`", () => {
    expect(liveSelector).toBe(
      '.org-layout:has(> .shader-hero--fullpage[data-live]) .hero'
    );
    // The layout's structure: ShaderHero's root is a direct child of
    // .org-layout.
    document.body.innerHTML = `
      <div class="org-layout">
        <div class="shader-hero shader-hero--fullpage"><canvas class="shader-hero__canvas"></canvas></div>
        <main><section class="hero"></section></main>
      </div>`;
    const root = document.querySelector('.shader-hero') as HTMLElement;
    const hero = document.querySelector('.hero');

    // SSR, before mount, loading, preset 'none', a renderer that failed.
    expect(document.querySelector(liveSelector)).toBeNull();
    // An inline opacity is not the signal any more.
    (root.firstElementChild as HTMLElement).style.opacity = '1';
    expect(document.querySelector(liveSelector)).toBeNull();
    root.toggleAttribute('data-live', true); // a renderer drew a frame
    expect(document.querySelector(liveSelector)).toBe(hero);
    root.toggleAttribute('data-live', false); // switched off, failed, or lost
    expect(document.querySelector(liveSelector)).toBeNull();
    // Only the fullpage one: another live ShaderHero on the page is not it.
    const other = document.createElement('div');
    other.className = 'shader-hero';
    other.toggleAttribute('data-live', true);
    document.querySelector('main')?.appendChild(other);
    expect(document.querySelector(liveSelector)).toBeNull();
  });

  test('OrgHero keys its shader ink on the same state, and nothing reads the canvas style', () => {
    const orgHero = readFileSync(ORG_HERO, 'utf8');
    const prefix = (liveHero[0]?.selector ?? '').replace(/ \.hero$/, '');
    const shaderInk = readRules(orgHero).filter(
      (r) => isLive(r) && r.selector.endsWith(".org-hero[data-bg='shader']")
    );
    expect(shaderInk.map((r) => r.selector)).toEqual([
      `${prefix} .org-hero[data-bg='shader']`,
    ]);
    for (const [file, source] of [
      ['page', pageSource],
      ['OrgHero', orgHero],
      ['HeroSpot', readFileSync(HERO_SPOT, 'utf8')],
    ])
      expect(
        readRules(source).filter((r) => r.selector.includes('canvas[style')),
        file
      ).toEqual([]);
  });

  test('ShaderHero publishes `data-live` on its root, and the layout mounts it as the fullpage shader', () => {
    // WHEN it is set (after a drawn frame, never at init) and cleared ('none',
    // a failure, a lost context) is pinned by ShaderHero.svelte.test.ts's
    // "ShaderHero live" block, which drives the real component.
    const source = readFileSync(SHADER_HERO, 'utf8');
    const root = parse(source, { modern: true }).fragment.nodes.find(
      (n): n is AST.RegularElement => n.type === 'RegularElement'
    );
    const attribute = (name: string) =>
      root?.attributes.find(
        (a): a is AST.Attribute => a.type === 'Attribute' && a.name === name
      );
    expect(
      source.slice(attribute('class')?.start, attribute('class')?.end)
    ).toContain('shader-hero');
    expect(attribute('data-live')).toBeDefined();
    // Hidden until it is live, so the fade the ink is timed to exists.
    expect(
      readRules(source)
        .find((r) => r.selector === '.shader-hero__canvas')
        ?.decls.get('opacity')
    ).toBe('0');
    // One mount, as the fullpage shader. Its other props (`still`, held in
    // the studio) do not change where the canvas sits, so they are not pinned.
    const stripComments = (s: string) =>
      s
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const mounts =
      stripComments(readFileSync(LAYOUT, 'utf8')).match(
        /<ShaderHero\b[^>]*\/>/g
      ) ?? [];
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toMatch(/\sclass="shader-hero--fullpage"[\s/]/);
  });
});

/**
 * A hero picture that fails keeps its box (#677 → #679, owner-approved): a
 * load failure may hide a picture, never take it, or what it sits in, away.
 * Removing one after first paint is a layout shift, and it is always after
 * first paint: an error the browser saw before hydration is replayed at
 * hydration (Svelte's SSR `onerror="this.__e=event"`), and CI, with no dev
 * CDN, fails every seeded org's pictures that way. Cover pictures go through
 * FallbackImage, which hides one in its box; a bespoke `<img onerror>` (a
 * logo) hides itself with `style:visibility`. So no picture may sit inside an
 * `{#if}` on a failure state, and no prop may blank one on failure.
 *
 * Read from every org-hero component's template, parsed by Svelte's own
 * compiler (comments dropped), so prose cannot satisfy it.
 */
describe('a hero picture that fails keeps its box', () => {
  const ORG_HERO_DIR = dirname(ORG_HERO);
  /** A failure state: the hero's `shows()`, or a failed, broken or dead flag. */
  const FAILURE = /\bshows\(|failed|broken|\bdead\b/i;
  /** A prop that reads one to choose its value (a handler's name is no read). */
  const READS_FAILURE =
    /\bshows\(|\bfailed\.has\(|\b\w*(?:failed|broken)\b\s*(?:\?|&&|\|\|)/i;

  type Node = {
    type?: string;
    start?: number;
    end?: number;
    [key: string]: unknown;
  };
  /** Every node under `node`, depth first (ESTree expressions included). */
  function* nodes(node: unknown): Generator<Node> {
    if (Array.isArray(node)) {
      for (const child of node) yield* nodes(child);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const n = node as Node;
    if (typeof n.type === 'string') yield n;
    for (const [key, value] of Object.entries(n))
      if (
        key !== 'parent' &&
        key !== 'metadata' &&
        value &&
        typeof value === 'object'
      )
        yield* nodes(value);
  }
  const isPicture = (n: Node) =>
    (n.type === 'RegularElement' && n.name === 'img') ||
    (n.type === 'Component' && n.name === 'FallbackImage');

  /** What breaks the rule in one component's template, worded per finding. */
  function findings(file: string, source: string): string[] {
    const out: string[] = [];
    const ast = parse(source, { modern: true });
    const text = (n: Node) => source.slice(n.start, n.end);
    // The script's names that carry a failure state (`const showLogo =
    // $derived(… shows(logoUrl))`), to a fixed point: a name read from one
    // carries it too.
    const carriers = new Set<string>();
    const declarators = [...nodes(ast.instance?.content)].filter(
      (n) => n.type === 'VariableDeclarator'
    );
    const reads = (expr: string) =>
      FAILURE.test(expr) ||
      [...carriers].some((c) => new RegExp(`\\b${c}\\b`).test(expr));
    for (let grew = true; grew; ) {
      grew = false;
      for (const d of declarators) {
        const id = d.id as Node;
        const name = id.type === 'Identifier' ? String(id.name) : null;
        if (
          name &&
          !carriers.has(name) &&
          d.init &&
          reads(text(d.init as Node))
        ) {
          carriers.add(name);
          grew = true;
        }
      }
    }
    for (const n of nodes(ast.fragment)) {
      // {#if shows(url)}<img …>: the picture is taken away when it fails
      if (n.type === 'IfBlock' && reads(text(n.test as Node))) {
        const holds = [...nodes(n.consequent)].some(isPicture);
        if (holds)
          out.push(`${file}: {#if ${text(n.test as Node)}} holds a picture`);
      }
      // a picture blanked through a prop (`logoUrl={shows(url) ? url : ''}`)
      if (n.type === 'Component')
        for (const a of (n.attributes ?? []) as Node[])
          if (
            a.type === 'Attribute' &&
            !Array.isArray(a.value) &&
            a.value &&
            READS_FAILURE.test(text(a.value as Node))
          )
            out.push(`${file}: <${n.name}> ${a.name} reads a failure state`);
    }
    return out;
  }

  /**
   * Awaiting their fixes, each with its own owner. Each must still be found,
   * so this list cannot outlive a fix: delete an entry as it lands.
   * - The stage's still (Showreel stage): a failed one is dropped. Its box is
   *   the stage item's (absolute, inset 0), so it moves nothing, but it is
   *   still a picture taken away.
   */
  const PENDING = [
    'showreel/ReelStage.svelte: {#if item.still && !brokenStill[k]} holds a picture',
  ];

  /**
   * A failure flag handed to a child that keeps the picture's box itself, so
   * no removal: `<file>: <Child> attribute`, and why. The child is an org-hero
   * component, so this same guard holds it to the rule. Each must still be
   * found, so an entry cannot outlive the prop it names.
   */
  const KEEPS_THE_BOX: Record<string, string> = {
    'OrgHero.svelte: <Showreel> logoFailed':
      'the Showreel keeps its top-bar logo in place, unseen, the name standing in over it',
  };
  const accepted = (finding: string) =>
    Object.keys(KEEPS_THE_BOX).some(
      (key) => finding === `${key} reads a failure state`
    );

  const found = () =>
    readdirSync(ORG_HERO_DIR, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.svelte') && !f.endsWith('.test.svelte'))
      .sort()
      .flatMap((f) => findings(f, readFileSync(join(ORG_HERO_DIR, f), 'utf8')));

  test('no org-hero component takes a failed picture away, or blanks one through a prop', () => {
    expect(found().filter((f) => !PENDING.includes(f) && !accepted(f))).toEqual(
      []
    );
  });

  test('each pending exception is still there to fix, and each child that keeps the box is still handed its flag', () => {
    const now = found();
    expect(PENDING.filter((p) => !now.includes(p))).toEqual([]);
    expect(
      Object.keys(KEEPS_THE_BOX).filter(
        (key) => !now.includes(`${key} reads a failure state`)
      )
    ).toEqual([]);
  });

  test('the guard sees each kind of removal (planted)', () => {
    const planted = `<script>
  let { url, shows, failed, broken, markFailed } = $props();
  const showIt = $derived(!!url && shows(url));
</script>
{#if shows(url)}<img src={url} alt="" />{/if}
{#if !failed}<FallbackImage src={url} srcset={undefined} sizes={undefined}>{#snippet fallback()}{/snippet}</FallbackImage>{/if}
{#if url && !broken[0]}<span><img src={url} alt="" /></span>{/if}
<img src={url} alt="" onerror={markFailed} style:visibility={failed ? 'hidden' : undefined} />
{#if failed}<span>the name</span>{/if}
<Child logoUrl={shows(url) ? url : ''} onfail={markFailed} />
<Child src={broken ? '' : url} />
{#if showIt}<img src={url} alt="" />{/if}`;
    // kept: the img hidden in place, a name drawn on failure, a handler passed on
    expect(findings('planted.svelte', planted)).toEqual([
      'planted.svelte: {#if shows(url)} holds a picture',
      'planted.svelte: {#if !failed} holds a picture',
      'planted.svelte: {#if url && !broken[0]} holds a picture',
      'planted.svelte: <Child> logoUrl reads a failure state',
      'planted.svelte: <Child> src reads a failure state',
      'planted.svelte: {#if showIt} holds a picture',
    ]);
  });
});
