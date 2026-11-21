/**
 * Characterisation of the hero's fallbacks, written BEFORE applyFallbacks was
 * split into per-composition steps (Codex-1yd58 WP-11: it had grown past
 * fallow's complexity limit). `frozenBeforeSplit`, at the foot of this file, is
 * hero-config.ts's resolution pipeline exactly as it stood at 61d2dfe83
 * (baseOptions to applyFallbacks), copied verbatim. Every case below runs
 * through that copy and through the live module and must come out the same, so
 * a split that moves one rule past another it depends on fails here.
 *
 * Each table is exhaustive over what it varies:
 *   A. every composition (and Auto) x every purpose x every combination of the
 *      13 facts: the media the org has, its words and its settings;
 *   B. the frame: composition x spot x ground x alignment x small print, over
 *      the facts the frame is decided from;
 *   C. the words, the lead and the reel's own keys, over the facts each reads;
 *   D. a seeded sweep of whole option sets, for the rules the tables keep apart.
 *
 * The frozen copy is never edited to match the live code. When a fallback
 * changes on purpose, this file has done its job (proving the split) and is
 * deleted. One exception, landed with the split (WP-5b, Codex-1yd58.6): the
 * owner's own 2026-11-21 changes are carried into the copy, marked `5b:` at
 * each of its three places, and WP-6's opening default by layout (Codex-
 * 1yd58.7, the same day), marked `WP-6:`, and nothing else.
 */
import { describe, expect, it } from 'vitest';
import {
  defaultOptions,
  HERO_ALIGN_ALLOWED,
  HERO_OPTION_KEYS,
  HERO_OPTION_VALUES,
  HERO_PURPOSES,
  type HeroFacts,
  type HeroOptionKey,
  type HeroOptions,
  type HeroPurpose,
  resolveHero,
} from './hero-config';

const before = frozenBeforeSplit();

/** Every fact on. Typed as HeroFacts, so a new fact has to be added here. */
const ALL_ON: HeroFacts = {
  hasLogo: true,
  hasShader: true,
  hasFilm: true,
  hasFilmLoop: true,
  hasFeatured: true,
  hasLatest: true,
  hasFeaturedImage: true,
  hasLatestImage: true,
  hasFacts: true,
  hasDescription: true,
  canJoin: true,
  hideTitle: true,
  hasReel: true,
};
type FactKey = keyof HeroFacts;
const FACT_KEYS = Object.keys(ALL_ON) as FactKey[];
/** The facts a table does not vary: an org with everything, its name shown. */
const REST: HeroFacts = { ...ALL_ON, hideTitle: false };

/** Every combination of `keys`, the other facts as in `rest`. */
function factCombos(
  keys: readonly FactKey[],
  rest: HeroFacts = REST
): HeroFacts[] {
  const combos: HeroFacts[] = [];
  for (let bits = 0; bits < 2 ** keys.length; bits++) {
    const facts = { ...rest };
    for (let i = 0; i < keys.length; i++) {
      facts[keys[i]] = (bits & (1 << i)) !== 0;
    }
    combos.push(facts);
  }
  return combos;
}

type Axes = { readonly [K in HeroOptionKey]?: readonly HeroOptions[K][] };

/** Every combination of the axes' values, as the options an org chose. */
function optionCombos(axes: Axes): Partial<HeroOptions>[] {
  let combos: Partial<HeroOptions>[] = [{}];
  for (const key of HERO_OPTION_KEYS) {
    const values: readonly string[] | undefined = axes[key];
    if (!values) continue;
    combos = combos.flatMap((options) =>
      values.map((value) => {
        const next: Partial<HeroOptions> = { ...options };
        (next as Record<string, string>)[key] = value;
        return next;
      })
    );
  }
  return combos;
}

/** `options: null` is the purpose's defaults (defaultOptions), not a choice. */
interface Case {
  readonly purpose: HeroPurpose;
  readonly options: Partial<HeroOptions> | null;
  readonly facts: HeroFacts;
}

function* table(
  purposes: readonly HeroPurpose[],
  choices: readonly (Partial<HeroOptions> | null)[],
  facts: readonly HeroFacts[]
): Generator<Case> {
  for (const purpose of purposes) {
    for (const options of choices) {
      for (const f of facts) yield { purpose, options, facts: f };
    }
  }
}

interface Sweep {
  checked: number;
  differing: number;
  /** The first few differing cases, each with what changed. */
  examples: string[];
  /** Every composition the live code drew, so a table can't pass by drawing one. */
  comps: Set<HeroOptions['comp']>;
}

function differences(was: HeroOptions, now: HeroOptions): string[] {
  const changed: string[] = HERO_OPTION_KEYS.filter(
    (key) => was[key] !== now[key]
  ).map((key) => `${key}: ${was[key]} -> ${now[key]}`);
  if (Object.keys(now).length !== Object.keys(was).length) {
    changed.push('a different set of keys');
  }
  return changed;
}

/** Each case through the frozen pipeline and the live one. */
function sweep(cases: Iterable<Case>): Sweep {
  const result: Sweep = {
    checked: 0,
    differing: 0,
    examples: [],
    comps: new Set(),
  };
  for (const item of cases) {
    const was = item.options
      ? before.resolveHero(item.purpose, item.options, item.facts)
      : before.defaultOptions(item.purpose, item.facts);
    const now = item.options
      ? resolveHero(item.purpose, item.options, item.facts)
      : defaultOptions(item.purpose, item.facts);
    result.checked++;
    result.comps.add(now.comp);
    const changed = differences(was, now);
    if (changed.length === 0) continue;
    result.differing++;
    if (result.examples.length < 5) {
      result.examples.push(JSON.stringify({ ...item, changed }));
    }
  }
  return result;
}

function expectSame(result: Sweep, cases: number): void {
  expect(result.examples).toEqual([]);
  expect(result.differing).toBe(0);
  expect(result.checked).toBe(cases);
}

const COMPS = HERO_OPTION_VALUES.comp;
const ALL_FACTS = factCombos(FACT_KEYS);

describe('A. every composition x purpose x the facts', () => {
  const choices: Partial<HeroOptions>[] = [
    {},
    ...optionCombos({ comp: COMPS }),
  ];

  it('enumerates all 13 facts', () => {
    expect(FACT_KEYS).toHaveLength(13);
    expect(ALL_FACTS).toHaveLength(2 ** 13);
  });

  for (const purpose of HERO_PURPOSES) {
    it(`${purpose}: Auto and each composition chosen, over every fact`, () => {
      const result = sweep(table([purpose], choices, ALL_FACTS));
      expectSame(result, 7 * 2 ** 13);
      expect([...result.comps].sort()).toEqual([...COMPS].sort());
    });

    it(`${purpose}: the purpose's defaults, over every fact`, () => {
      expectSame(sweep(table([purpose], [null], ALL_FACTS)), 2 ** 13);
    });
  }
});

describe('B. the frame', () => {
  const frameFacts = factCombos([
    'hasShader',
    'hasFilmLoop',
    'hasFeatured',
    'hasLatest',
    'hasFeaturedImage',
    'hasLatestImage',
    'hasReel',
    'hasFacts',
  ]);

  for (const comp of COMPS) {
    it(`${comp} x spot x ground x alignment x small print`, () => {
      const choices = optionCombos({
        comp: [comp],
        spot: HERO_OPTION_VALUES.spot,
        bg: HERO_OPTION_VALUES.bg,
        align: HERO_OPTION_VALUES.align,
        proof: HERO_OPTION_VALUES.proof,
      });
      const result = sweep(table(['consume'], choices, frameFacts));
      expectSame(result, 4 * 5 * 3 * 3 * 2 ** 8);
      expect(result.comps.has(comp)).toBe(true);
    });
  }
});

describe('C. the words, the lead and the reel', () => {
  it('the call to action, the small print and the line', () => {
    const choices = optionCombos({
      comp: ['statement', 'showreel'],
      main: HERO_OPTION_VALUES.main,
      proof: HERO_OPTION_VALUES.proof,
      line: HERO_OPTION_VALUES.line,
    });
    const facts = factCombos([
      'hasFilm',
      'canJoin',
      'hasFacts',
      'hasLatest',
      'hasDescription',
      'hasReel',
      'hasShader',
    ]);
    expectSame(
      sweep(table(HERO_PURPOSES, choices, facts)),
      6 * (2 * 5 * 3 * 2) * 2 ** 7
    );
  });

  it('the lead, and the reel keys that play through the name', () => {
    const choices = optionCombos({
      lead: HERO_OPTION_VALUES.lead,
      'reel-layout': HERO_OPTION_VALUES['reel-layout'],
      'reel-opening': HERO_OPTION_VALUES['reel-opening'],
      'reel-film': HERO_OPTION_VALUES['reel-film'],
      'reel-peek': HERO_OPTION_VALUES['reel-peek'],
    });
    const facts = factCombos(['hideTitle', 'hasLogo', 'hasFeatured']);
    expectSame(
      sweep(table(HERO_PURPOSES, choices, facts)),
      6 * (3 * 3 * 2 * 3 * 2) * 2 ** 3
    );
  });

  it('the ground, the reel surface and the reel band', () => {
    const choices = optionCombos({
      comp: ['statement', 'showcase', 'showreel'],
      bg: HERO_OPTION_VALUES.bg,
      spot: ['film', 'none'],
      'reel-surface': HERO_OPTION_VALUES['reel-surface'],
      'reel-band': HERO_OPTION_VALUES['reel-band'],
    });
    const facts = factCombos([
      'hasShader',
      'hasFilmLoop',
      'hasReel',
      'hasLatest',
    ]);
    expectSame(
      sweep(table(HERO_PURPOSES, choices, facts)),
      // 5b: four surfaces (none, duotone, colour, grain), not six
      6 * (3 * 5 * 2 * 4 * 4) * 2 ** 4
    );
  });
});

/** A small seeded generator (mulberry32), so the sweep is the same every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function* randomCases(seed: number, count: number): Generator<Case> {
  const random = seeded(seed);
  const pick = <T>(values: readonly T[]): T =>
    values[Math.floor(random() * values.length)];
  for (let n = 0; n < count; n++) {
    const options: Partial<HeroOptions> = {};
    for (const key of HERO_OPTION_KEYS) {
      // three keys in four chosen; the rest come from the purpose
      if (random() < 0.75) {
        const values: readonly string[] = HERO_OPTION_VALUES[key];
        (options as Record<string, string>)[key] = pick(values);
      }
    }
    const facts = { ...ALL_ON };
    for (const key of FACT_KEYS) facts[key] = random() < 0.5;
    yield { purpose: pick(HERO_PURPOSES), options, facts };
  }
}

describe('D. whole option sets', () => {
  it('30,000 seeded cases: every key, chosen or not, over random facts', () => {
    const result = sweep(randomCases(20261121, 30_000));
    expectSame(result, 30_000);
    expect([...result.comps].sort()).toEqual([...COMPS].sort());
  });
});

/**
 * hero-config.ts at 61d2dfe83, from baseOptions to the end of applyFallbacks,
 * verbatim but for two `export` keywords, the owner's three 5b changes
 * (marked `5b:`) and WP-6's opening default (marked `WP-6:`), inside a
 * function so its names stay out of this module's
 * scope. Never edit it to match the live code.
 */
function frozenBeforeSplit() {
  /** The org's own starting point, before any purpose. */
  function baseOptions(facts: HeroFacts): HeroOptions {
    return {
      comp: 'statement',
      align: 'start',
      height: 'tall',
      bg: facts.hasShader ? 'shader' : 'gradient',
      veil: 'auto',
      ambient: 'drift',
      grain: 'off',
      lead: facts.hasLogo ? 'both' : 'name',
      line: facts.hasDescription ? 'desc' : 'none',
      search: 'off',
      main: 'consume',
      second: 'auto',
      micro: 'on',
      bstyle: 'solid',
      spot: 'none',
      proof: facts.hasFacts ? 'facts' : 'none',
      type: 'classic',
      accent: 'none',
      entrance: 'rise',
      logo: 'm',
      'reel-layout': 'corner',
      // 5b: the peek on by default (owner, 2026-11-21)
      'reel-peek': 'on',
      'reel-pointer': 'liquid',
      'reel-trans': 'burn',
      'reel-surface': 'none',
      // 5b: the stills' push-in, a new axis, on by default
      'reel-push': 'on',
      'reel-band': 'fade',
      'reel-edge': 'shadow',
      'reel-opening': 'name',
      'reel-film': 'name',
      'reel-loop': 'on',
    };
  }

  /**
   * What each purpose changes from the base, given what the org has. Only the
   * changes: a value the base already sets is not repeated here.
   */
  function purposeDefaults(
    purpose: HeroPurpose,
    facts: HeroFacts
  ): Partial<HeroOptions> {
    switch (purpose) {
      case 'consume': {
        // Media first: the Showreel plays the org's film and pieces when it has
        // a reel, shader or not. Else the film fills the Showcase frame when it
        // can loop, else the latest piece does: in the FRAME, never behind the
        // words. No small print.
        const frame =
          facts.hasFilmLoop || facts.hasLatest ? 'showcase' : 'statement';
        return {
          comp: facts.hasReel ? 'showreel' : frame,
          spot: facts.hasFilmLoop ? 'film' : 'latest',
          micro: 'off',
        };
      }
      case 'grow':
        return {
          comp: 'centre',
          align: 'center',
          height: 'full',
          main: 'join',
        };
      case 'intro': {
        const picture = pictureFor(spotPiece('featured', facts), facts);
        return {
          comp: picture ? 'split' : 'centre',
          align: picture ? 'start' : 'center',
          height: 'full',
          main: facts.hasFilm ? 'film' : 'explore',
          spot: facts.hasFeatured ? 'featured' : 'latest',
          proof: 'none',
        };
      }
      case 'library':
        return {
          height: 'compact',
          search: 'on',
          main: 'explore',
          line: 'none',
          proof: 'none',
        };
      case 'follow':
        return {
          main: 'follow',
          proof: facts.hasLatest ? 'shelf' : 'none',
        };
      case 'spotlight':
        return {
          comp: facts.hasFeatured || facts.hasLatest ? 'showcase' : 'statement',
          height: 'full',
          spot: facts.hasFeatured ? 'featured' : 'latest',
          main: 'explore',
        };
    }
  }

  // WP-6: the opening's default hangs on the layout (owner, 2026-11-21): the
  // Name window opens through the name, Corner and Wide on their film, unless
  // the purpose or the org set it.
  function openingByLayout(
    options: HeroOptions,
    set: Partial<HeroOptions>
  ): HeroOptions {
    if (set['reel-opening'] !== undefined) return options;
    return {
      ...options,
      'reel-opening': options['reel-layout'] === 'name' ? 'name' : 'none',
    };
  }

  /** The purpose's defaults with nothing changed: what an "Auto" choice means. */
  function defaultOptions(purpose: HeroPurpose, facts: HeroFacts): HeroOptions {
    return applyFallbacks(
      // WP-6: through openingByLayout
      openingByLayout(
        { ...baseOptions(facts), ...purposeDefaults(purpose, facts) },
        purposeDefaults(purpose, facts)
      ),
      facts
    );
  }

  /** Base → purpose → the org's own changes → fallbacks. */
  function resolveHero(
    purpose: HeroPurpose,
    options: Partial<HeroOptions>,
    facts: HeroFacts
  ): HeroOptions {
    // A chosen Showreel with nothing to play is set aside, so the purpose's own
    // hero draws: what an org saw before the Showreel existed. This is the
    // Showreel's only fallback; applyFallbacks has none.
    const { comp, ...rest } = options;
    const chosen = comp === 'showreel' && !facts.hasReel ? rest : options;
    return applyFallbacks(
      // WP-6: through openingByLayout
      openingByLayout(
        {
          ...baseOptions(facts),
          ...purposeDefaults(purpose, facts),
          ...chosen,
        },
        { ...purposeDefaults(purpose, facts), ...chosen }
      ),
      facts
    );
  }

  /**
   * The piece a spot lands on once the fallbacks have run: the chosen one when
   * it exists, else the other. A picture composition with no piece chosen
   * ('none', or the film it cannot hold) is filled featured-first.
   */
  function spotPiece(
    spot: HeroOptions['spot'],
    facts: HeroFacts
  ): 'featured' | 'latest' | null {
    if (spot === 'latest') {
      if (facts.hasLatest) return 'latest';
      return facts.hasFeatured ? 'featured' : null;
    }
    if (facts.hasFeatured) return 'featured';
    return facts.hasLatest ? 'latest' : null;
  }

  function pictureFor(
    piece: 'featured' | 'latest' | null,
    facts: HeroFacts
  ): boolean {
    if (piece === 'featured') return facts.hasFeaturedImage;
    if (piece === 'latest') return facts.hasLatestImage;
    return false;
  }

  /**
   * Whatever the org can't support falls back to the nearest thing it can, so
   * no combination draws an empty frame or a dead button.
   */
  function applyFallbacks(input: HeroOptions, facts: HeroFacts): HeroOptions {
    const c = { ...input };
    // A Showreel reaching here has a reel: the consume default asks for one,
    // and resolveHero sets aside a chosen Showreel without one, so the
    // purpose's own hero draws instead.
    if (c.comp === 'showreel') {
      // The reel plays in the brand shader's ground, or on a plain one when the
      // org has no shader (owner, 2026-11-19). It takes the spotlight's place:
      // no spotlight, and no shelf repeating the pieces its index lists.
      c.bg = facts.hasShader ? 'shader' : 'plain';
      c.spot = 'none';
      if (c.proof === 'shelf') c.proof = 'facts';
    }
    // the shader surface and the shader band are drawn by the shader
    if (!facts.hasShader) {
      // 5b: the surfaces are now duotone, colour and grain, every one drawn
      // by the shader (the 'shader' surface is gone), so all give way
      c['reel-surface'] = 'none';
      c['reel-band'] = 'none';
    }
    if (c.bg === 'shader' && !facts.hasShader) c.bg = 'gradient';
    if (c.bg === 'film' && !facts.hasFilmLoop)
      c.bg = facts.hasShader ? 'shader' : 'gradient';
    // The composition first (what can this org fill?), then which piece fills it:
    // the other order handed a bare org a spotlight on a piece it doesn't have.
    const anyPiece = facts.hasFeatured || facts.hasLatest;
    if (c.spot === 'film' && !facts.hasFilmLoop) c.spot = 'none';
    // A billboard or a panel draws ONE piece's picture: check the piece the spot
    // lands on, not whichever piece happens to have one.
    if (
      (c.comp === 'billboard' || c.comp === 'split') &&
      !pictureFor(spotPiece(c.spot, facts), facts)
    ) {
      c.comp = anyPiece ? 'showcase' : 'statement';
    }
    if (c.comp === 'showcase' && !anyPiece && c.spot !== 'film')
      c.comp = 'statement';
    // only a Showcase frame can hold the film; a panel or billboard wants a picture
    if (c.spot === 'film' && c.comp !== 'showcase') c.spot = 'none';
    // the film fills the frame, so it never also loops behind the words
    if (c.bg === 'film' && c.comp === 'showcase' && c.spot === 'film')
      c.bg = facts.hasShader ? 'shader' : 'gradient';
    if (c.spot === 'featured' && !facts.hasFeatured)
      c.spot = facts.hasLatest ? 'latest' : 'none';
    if (c.spot === 'latest' && !facts.hasLatest)
      c.spot = facts.hasFeatured ? 'featured' : 'none';
    // showcase, split and billboard are drawn around a piece; one exists by now
    if (
      (c.comp === 'showcase' || c.comp === 'split' || c.comp === 'billboard') &&
      c.spot === 'none'
    ) {
      c.spot = facts.hasFeatured ? 'featured' : 'latest';
    }
    if (c.main === 'film' && !facts.hasFilm) c.main = 'explore';
    if (c.main === 'join' && !facts.canJoin) c.main = 'explore';
    if (c.proof === 'facts' && !facts.hasFacts) c.proof = 'none';
    if (c.proof === 'shelf' && !facts.hasLatest) c.proof = 'none';
    if (c.line === 'desc' && !facts.hasDescription) c.line = 'none';
    // the classic hero's "hide the name" switch: the logo leads alone, and the
    // name stays in the page for screen readers
    if (facts.hideTitle) c.lead = 'logo';
    if (c.lead !== 'name' && !facts.hasLogo) c.lead = 'name';
    // With the logo leading alone the name is out of sight, so the reel never
    // plays through it: no name window, no opening or way into the film by it.
    if (c.lead === 'logo') {
      if (c['reel-layout'] === 'name') c['reel-layout'] = 'corner';
      if (c['reel-opening'] === 'name') c['reel-opening'] = 'none';
      if (c['reel-film'] === 'name') c['reel-film'] = 'smoke';
    }
    // the peek lifts the featured row, so it needs one
    if (c['reel-peek'] === 'on' && !facts.hasFeatured) c['reel-peek'] = 'off';
    if (!HERO_ALIGN_ALLOWED[c.comp].includes(c.align))
      c.align = HERO_ALIGN_ALLOWED[c.comp][0];
    return c;
  }

  return { defaultOptions, resolveHero };
}
