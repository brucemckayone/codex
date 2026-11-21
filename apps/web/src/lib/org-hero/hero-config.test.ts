import { describe, expect, it } from 'vitest';
import {
  clearHeroSettings,
  contentKindForHero,
  contentKindFrom,
  defaultOptions,
  frameShapeFor,
  HERO_ALIGN_ALLOWED,
  HERO_OPTION_KEYS,
  HERO_OPTION_VALUES,
  HERO_PURPOSE_COPY,
  HERO_PURPOSES,
  type HeroFacts,
  type HeroOptions,
  type HeroPurpose,
  heroConsumeLabel,
  heroFacts,
  heroFreeNote,
  heroMayOfferJoin,
  parseHeroOverrides,
  pieceMeta,
  portalMeta,
  readHeroSettings,
  resolveHero,
  storedHeroChanges,
  writeHeroSetting,
} from './hero-config';

const FULL: HeroFacts = {
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
  hideTitle: false,
  hasReel: true,
};

/** An org with everything but a reel worth playing: today's frames. */
const NO_REEL: HeroFacts = { ...FULL, hasReel: false };

/** A brand-new org: one or two pieces, nothing set. */
const BARE: HeroFacts = {
  hasLogo: false,
  hasShader: false,
  hasFilm: false,
  hasFilmLoop: false,
  hasFeatured: false,
  hasLatest: false,
  hasFeaturedImage: false,
  hasLatestImage: false,
  hasFacts: false,
  hasDescription: false,
  canJoin: false,
  hideTitle: false,
  hasReel: false,
};

describe('readHeroSettings', () => {
  it('is the classic hero when no purpose is stored', () => {
    expect(readHeroSettings({ 'hero-hide-stats': '1' }).purpose).toBeNull();
    expect(readHeroSettings(null).purpose).toBeNull();
  });

  it('reads the purpose and only the valid options', () => {
    const s = readHeroSettings({
      'hero-opt-purpose': 'grow',
      'hero-opt-comp': 'split',
      'hero-opt-height': 'enormous',
      'hero-opt-unknown': 'x',
      'shader-preset': 'flow',
    });
    expect(s.purpose).toBe('grow');
    expect(s.options).toEqual({ comp: 'split' });
  });

  it('reads the words-over-footage choice, and drops a value it does not know (the shadow stays)', () => {
    expect(
      readHeroSettings({
        'hero-opt-purpose': 'consume',
        'hero-opt-reel-edge': 'outline',
      }).options
    ).toEqual({ 'reel-edge': 'outline' });
    const unknown = readHeroSettings({
      'hero-opt-purpose': 'consume',
      'hero-opt-reel-edge': 'glow',
    });
    expect(unknown.options).toEqual({});
    expect(resolveHero('consume', unknown.options, FULL)['reel-edge']).toBe(
      'shadow'
    );
  });

  it('ignores a purpose it does not know', () => {
    expect(
      readHeroSettings({ 'hero-opt-purpose': 'sell-hard' }).purpose
    ).toBeNull();
  });
});

describe('resolveHero', () => {
  it('every purpose resolves to valid values for a full org and a bare one', () => {
    for (const facts of [FULL, BARE]) {
      for (const purpose of HERO_PURPOSES) {
        const c = defaultOptions(purpose, facts);
        for (const key of HERO_OPTION_KEYS) {
          expect(HERO_OPTION_VALUES[key] as readonly string[]).toContain(
            c[key]
          );
        }
        expect(HERO_ALIGN_ALLOWED[c.comp]).toContain(c.align);
      }
    }
  });

  it('never makes a specific piece the main button by default', () => {
    for (const purpose of HERO_PURPOSES) {
      expect(['consume', 'explore', 'join', 'film', 'follow']).toContain(
        defaultOptions(purpose, FULL).main
      );
    }
    // the spotlight purpose shows its piece as a card, not as the button
    const spot = defaultOptions('spotlight', FULL);
    expect(spot.comp).toBe('showcase');
    expect(spot.spot).toBe('featured');
    expect(spot.main).toBe('explore');
  });

  it('an option the org cannot support falls back to one it can', () => {
    const c = resolveHero(
      'spotlight',
      {
        comp: 'billboard',
        bg: 'film',
        main: 'join',
        proof: 'facts',
        lead: 'logo',
      },
      BARE
    );
    expect(c.comp).toBe('statement'); // no piece to fill a billboard
    expect(c.spot).toBe('none');
    expect(c.bg).toBe('gradient'); // no film, no shader
    expect(c.main).toBe('explore'); // nothing to join
    expect(c.proof).toBe('none'); // no counts worth showing
    expect(c.lead).toBe('name'); // no logo
  });

  it('with no reel, leads with the intro film when it can loop, and never draws a film it lacks', () => {
    const withFilm = defaultOptions('consume', NO_REEL);
    expect(withFilm).toMatchObject({
      comp: 'showcase',
      spot: 'film',
      bg: 'shader',
      micro: 'off',
    });
    // no loopable film: the latest piece fills the frame instead
    const noLoop = defaultOptions('consume', {
      ...NO_REEL,
      hasFilmLoop: false,
    });
    expect(noLoop).toMatchObject({ comp: 'showcase', spot: 'latest' });
    // a film but no pieces: the film alone still makes a Showcase
    const filmOnly = defaultOptions('consume', {
      ...BARE,
      hasFilm: true,
      hasFilmLoop: true,
    });
    expect(filmOnly).toMatchObject({ comp: 'showcase', spot: 'film' });
    // the org asks for the film in a Split: a panel holds a picture, not the film
    expect(resolveHero('consume', { comp: 'split' }, FULL).spot).toBe(
      'featured'
    );
  });

  it('keeps the org’s own change when it is possible', () => {
    expect(
      resolveHero('grow', { comp: 'split', align: 'end' }, FULL)
    ).toMatchObject({
      comp: 'split',
      align: 'end',
    });
  });

  it('moves an alignment the composition cannot draw', () => {
    expect(resolveHero('spotlight', { align: 'center' }, FULL).align).toBe(
      'start'
    );
  });
});

describe('writing settings', () => {
  it('sets, clears to Auto, and resets', () => {
    let o: Record<string, string> = { 'shader-preset': 'flow' };
    o = writeHeroSetting(o, 'purpose', 'grow');
    o = writeHeroSetting(o, 'comp', 'split');
    expect(o).toEqual({
      'shader-preset': 'flow',
      'hero-opt-purpose': 'grow',
      'hero-opt-comp': 'split',
    });
    expect(writeHeroSetting(o, 'comp', null)).not.toHaveProperty(
      'hero-opt-comp'
    );
    expect(clearHeroSettings(o, { keepPurpose: true })).toEqual({
      'shader-preset': 'flow',
      'hero-opt-purpose': 'grow',
    });
    expect(clearHeroSettings(o, { keepPurpose: false })).toEqual({
      'shader-preset': 'flow',
    });
  });
});

describe('fallbacks decide on the piece the spot lands on', () => {
  // featured has a picture, the latest piece has none
  const SPLIT_PICTURE = { ...FULL, hasLatestImage: false };

  it('keeps a panel or billboard only when its own piece has a picture', () => {
    for (const comp of ['split', 'billboard'] as const) {
      expect(
        resolveHero('spotlight', { comp, spot: 'featured' }, SPLIT_PICTURE).comp
      ).toBe(comp);
      const latest = resolveHero(
        'spotlight',
        { comp, spot: 'latest' },
        SPLIT_PICTURE
      );
      expect(latest.comp).toBe('showcase');
      expect(latest.spot).toBe('latest');
      // the align the panel allowed is re-checked against the frame drawn
      expect(HERO_ALIGN_ALLOWED[latest.comp]).toContain(latest.align);
    }
  });

  it('fills a picture composition with no piece chosen featured-first', () => {
    expect(
      resolveHero('spotlight', { comp: 'split', spot: 'none' }, SPLIT_PICTURE)
        .comp
    ).toBe('split');
    const latestOnly = { ...FULL, hasFeatured: false, hasFeaturedImage: false };
    expect(
      resolveHero('spotlight', { comp: 'split', spot: 'featured' }, latestOnly)
    ).toMatchObject({
      comp: 'split',
      spot: 'latest',
    });
  });

  it('introduces the org with a panel only when that piece has a picture', () => {
    expect(resolveHero('intro', {}, FULL).comp).toBe('split');
    expect(
      resolveHero('intro', {}, { ...FULL, hasFeaturedImage: false }).comp
    ).toBe('centre');
  });

  it('never loops the film behind the words while it fills the frame', () => {
    const o = resolveHero('consume', { bg: 'film' }, NO_REEL);
    expect(o.spot).toBe('film');
    expect(o.bg).toBe('shader');
    expect(
      resolveHero('consume', { bg: 'film', comp: 'statement' }, FULL).bg
    ).toBe('film');
  });

  it("honours the classic hero's hide-the-name switch when there is a logo", () => {
    expect(resolveHero('grow', {}, { ...FULL, hideTitle: true }).lead).toBe(
      'logo'
    );
    expect(resolveHero('grow', {}, { ...BARE, hideTitle: true }).lead).toBe(
      'name'
    );
  });
});

describe('the Showreel', () => {
  const REEL_AXES = HERO_OPTION_KEYS.filter((key) => key.startsWith('reel-'));

  it('is the default for a consume org with a reel, every reel option at its first value', () => {
    expect(REEL_AXES).toHaveLength(11);
    const o = defaultOptions('consume', FULL);
    expect(o).toMatchObject({
      comp: 'showreel',
      bg: 'shader',
      spot: 'none',
      align: 'start',
      micro: 'off',
    });
    for (const axis of REEL_AXES) {
      // The opening's default hangs on the layout (below).
      if (axis === 'reel-opening') continue;
      expect(o[axis]).toBe(HERO_OPTION_VALUES[axis][0]);
    }
    // The owner's pick (2026-11-21, the WP-6 board's N): Corner, the default
    // layout, opens on its film.
    expect(o['reel-opening']).toBe('none');
    // The owner's pick (2026-11-20, V1): the film gives way at its foot.
    expect(o['reel-band']).toBe('fade');
    // The owner's pick (2026-11-20): no outline unless the creator asks.
    expect(o['reel-edge']).toBe('shadow');
    // The owner's picks (2026-11-21, the 5b board): the peek and the stills'
    // push-in on, no surface over the footage.
    expect(o['reel-peek']).toBe('on');
    expect(o['reel-push']).toBe('on');
    expect(o['reel-surface']).toBe('none');
  });

  it('is never the default for an org without a reel, shader or not: that org keeps today’s hero', () => {
    expect(defaultOptions('consume', NO_REEL)).toMatchObject({
      comp: 'showcase',
      spot: 'film',
      bg: 'shader',
    });
    expect(defaultOptions('consume', BARE).comp).toBe('statement');
  });

  it('plays on a plain ground for an org with a reel but no shader, without the shader’s surface or band', () => {
    const noShader = { ...FULL, hasShader: false };
    expect(defaultOptions('consume', noShader)).toMatchObject({
      comp: 'showreel',
      bg: 'plain',
      spot: 'none',
    });
    expect(
      resolveHero(
        'consume',
        { 'reel-surface': 'duotone', 'reel-band': 'under' },
        noShader
      )
    ).toMatchObject({ 'reel-surface': 'none', 'reel-band': 'none' });
    for (const band of ['fade', 'edges'] as const) {
      expect(
        resolveHero('consume', { 'reel-band': band }, noShader)['reel-band']
      ).toBe('none');
    }
    // every surface is drawn by the shader, on the footage (WP-5b)
    for (const surface of ['duotone', 'colour', 'grain'] as const) {
      expect(
        resolveHero('consume', { 'reel-surface': surface }, noShader)[
          'reel-surface'
        ]
      ).toBe('none');
    }
    // with a shader, both stay
    expect(
      resolveHero(
        'consume',
        { 'reel-surface': 'grain', 'reel-band': 'under' },
        FULL
      )
    ).toMatchObject({ 'reel-surface': 'grain', 'reel-band': 'under' });
  });

  it('is never the default for any other purpose', () => {
    for (const purpose of HERO_PURPOSES) {
      if (purpose === 'consume') continue;
      expect(defaultOptions(purpose, FULL).comp).not.toBe('showreel');
    }
  });

  it('can be chosen under any purpose, and keeps the org’s own reel options', () => {
    const chosen = {
      comp: 'showreel',
      'reel-layout': 'wide',
      'reel-peek': 'off',
      'reel-pointer': 'glitch',
      'reel-trans': 'liquid',
      'reel-surface': 'duotone',
      'reel-push': 'off',
      'reel-band': 'fade',
      'reel-edge': 'outline',
      'reel-opening': 'none',
      'reel-film': 'liquid',
      'reel-loop': 'off',
    } as const;
    const o = resolveHero('grow', chosen, FULL);
    expect(o).toMatchObject(chosen);
    // the reel's layout places the words
    expect(o.align).toBe('start');
  });

  it('offers the light leak between pieces, kept under every purpose and layout (owner’s WP-1b pick)', () => {
    for (const purpose of HERO_PURPOSES)
      for (const layout of ['corner', 'wide', 'name'] as const) {
        const o = resolveHero(
          purpose,
          {
            comp: 'showreel',
            'reel-layout': layout,
            'reel-trans': 'light-leak',
          },
          FULL
        );
        expect(o['reel-trans'], `${purpose} ${layout}`).toBe('light-leak');
      }
    // A logo that leads alone, or no reel's name in sight, never moves it.
    expect(
      resolveHero(
        'consume',
        { comp: 'showreel', 'reel-trans': 'light-leak', lead: 'logo' },
        FULL
      )['reel-trans']
    ).toBe('light-leak');
  });

  it('chosen with no reel to play, gives way to the purpose’s own hero', () => {
    // exactly the hero the org would have with no choice made, for every purpose
    for (const facts of [NO_REEL, BARE]) {
      for (const purpose of HERO_PURPOSES) {
        expect(resolveHero(purpose, { comp: 'showreel' }, facts)).toEqual(
          defaultOptions(purpose, facts)
        );
      }
    }
    expect(resolveHero('grow', { comp: 'showreel' }, NO_REEL)).toMatchObject({
      comp: 'centre',
      align: 'center',
    });
    expect(resolveHero('intro', { comp: 'showreel' }, NO_REEL).comp).toBe(
      'split'
    );
    expect(resolveHero('library', { comp: 'showreel' }, NO_REEL).comp).toBe(
      'statement'
    );
    expect(resolveHero('follow', { comp: 'showreel' }, NO_REEL).comp).toBe(
      'statement'
    );
    // a consume org whose only piece is a featured portal
    const onlyPortal = { ...BARE, hasFeatured: true, hasFeaturedImage: true };
    expect(resolveHero('consume', { comp: 'showreel' }, onlyPortal).comp).toBe(
      'statement'
    );
    // the org's other choices still hold
    expect(
      resolveHero('grow', { comp: 'showreel', height: 'compact' }, NO_REEL)
        .height
    ).toBe('compact');
    // no shader is no reason to give way
    expect(
      resolveHero('grow', { comp: 'showreel' }, { ...FULL, hasShader: false })
        .comp
    ).toBe('showreel');
  });

  it('draws no ground of its own, no spotlight, and no shelf beside its index', () => {
    const o = resolveHero(
      'consume',
      { bg: 'film', spot: 'featured', proof: 'shelf' },
      FULL
    );
    expect(o).toMatchObject({
      comp: 'showreel',
      bg: 'shader',
      spot: 'none',
      proof: 'facts',
    });
    expect(
      resolveHero('consume', { proof: 'shelf' }, { ...FULL, hasFacts: false })
        .proof
    ).toBe('none');
    // the shelf is the Statement's, and stays there
    expect(
      resolveHero('consume', { comp: 'statement', proof: 'shelf' }, FULL).proof
    ).toBe('shelf');
  });

  it('opens on its film on Corner and Wide, through the name on the Name window, unless the creator says otherwise (owner, 2026-11-21)', () => {
    const opening = (
      options: Partial<HeroOptions>,
      purpose: HeroPurpose = 'consume'
    ) =>
      resolveHero(purpose, { comp: 'showreel', ...options }, FULL)[
        'reel-opening'
      ];
    // Auto: no stored opening. The layout decides.
    expect(opening({})).toBe('none');
    expect(opening({ 'reel-layout': 'corner' })).toBe('none');
    expect(opening({ 'reel-layout': 'wide' })).toBe('none');
    expect(opening({ 'reel-layout': 'name' })).toBe('name');
    expect(opening({ 'reel-layout': 'wide' }, 'grow')).toBe('none');
    // A stored opening is the creator's, on every layout: a title opening
    // turned on plays (the board's A), and none stays none. No migration.
    for (const layout of HERO_OPTION_VALUES['reel-layout'])
      for (const stored of HERO_OPTION_VALUES['reel-opening'])
        expect(
          opening({ 'reel-layout': layout, 'reel-opening': stored }),
          `${layout} ${stored}`
        ).toBe(stored);
    // A logo leading alone still rules the name out, Auto or not.
    expect(opening({ 'reel-layout': 'name', lead: 'logo' })).toBe('none');
    // What Auto means, as the purpose's own defaults say it.
    expect(defaultOptions('consume', FULL)['reel-opening']).toBe('none');
  });

  it('never plays through a name that is out of sight', () => {
    const byName = {
      'reel-layout': 'name',
      'reel-opening': 'name',
      'reel-film': 'name',
    } as const;
    const hidden = {
      'reel-layout': 'corner',
      'reel-opening': 'none',
      'reel-film': 'smoke',
    };
    // the classic hide-the-name switch, and a logo the org lets lead alone
    expect(
      resolveHero('consume', byName, { ...FULL, hideTitle: true })
    ).toMatchObject(hidden);
    expect(
      resolveHero('consume', { ...byName, lead: 'logo' }, FULL)
    ).toMatchObject(hidden);
    // with no logo the name comes back, and so does the window
    expect(
      resolveHero('consume', byName, {
        ...FULL,
        hideTitle: true,
        hasLogo: false,
      })
    ).toMatchObject(byName);
  });

  it('peeks at the featured row only when there is one', () => {
    expect(
      resolveHero('consume', { 'reel-peek': 'on' }, FULL)['reel-peek']
    ).toBe('on');
    expect(
      resolveHero(
        'consume',
        { 'reel-peek': 'on' },
        { ...FULL, hasFeatured: false }
      )['reel-peek']
    ).toBe('off');
  });

  it('reads the reel options from storage, and ignores a value it does not know', () => {
    const s = readHeroSettings({
      'hero-opt-purpose': 'consume',
      'hero-opt-comp': 'showreel',
      'hero-opt-reel-layout': 'diagonal',
      'hero-opt-reel-loop': 'off',
      // a surface offered before the 5b board, never shipped: unknown now
      'hero-opt-reel-surface': 'halftone',
      'hero-opt-reel-push': 'off',
    });
    expect(s.options).toEqual({
      comp: 'showreel',
      'reel-loop': 'off',
      'reel-push': 'off',
    });
    expect(writeHeroSetting({}, 'reel-surface', 'grain')).toEqual({
      'hero-opt-reel-surface': 'grain',
    });
  });
});

describe('heroMayOfferJoin', () => {
  it('is true only where the hero can show Join', () => {
    expect(heroMayOfferJoin({ purpose: 'grow', options: {} })).toBe(true);
    expect(
      heroMayOfferJoin({ purpose: 'grow', options: { main: 'explore' } })
    ).toBe(false);
    expect(
      heroMayOfferJoin({ purpose: 'spotlight', options: { main: 'join' } })
    ).toBe(true);
    expect(heroMayOfferJoin({ purpose: 'consume', options: {} })).toBe(false);
    expect(heroMayOfferJoin({ purpose: null, options: { main: 'join' } })).toBe(
      false
    );
  });
});

describe('storedHeroChanges', () => {
  it('counts every stored setting beyond the purpose, a stale one too', () => {
    expect(
      storedHeroChanges({
        'hero-opt-purpose': 'grow',
        'hero-opt-comp': 'split',
        'hero-opt-retired': 'x',
        'hero-hide-logo': '1',
      })
    ).toBe(2);
    expect(storedHeroChanges({ 'hero-opt-purpose': 'grow' })).toBe(0);
  });
});

describe('stored values are a contract', () => {
  // Orgs store these strings. Renaming one silently reverts every org that
  // chose it, so a change here needs a migration of the stored keys too.
  it('pins the purposes and every option value', () => {
    expect(HERO_PURPOSES).toEqual([
      'consume',
      'grow',
      'intro',
      'library',
      'follow',
      'spotlight',
    ]);
    expect(HERO_OPTION_VALUES).toEqual({
      comp: [
        'statement',
        'centre',
        'showcase',
        'split',
        'billboard',
        'showreel',
      ],
      align: ['start', 'center', 'end'],
      height: ['full', 'tall', 'compact'],
      bg: ['shader', 'film', 'gradient', 'pattern', 'plain'],
      veil: ['auto', 'soft', 'strong'],
      ambient: ['drift', 'still'],
      grain: ['on', 'off'],
      lead: ['both', 'logo', 'name'],
      line: ['desc', 'none'],
      search: ['on', 'off'],
      main: ['consume', 'explore', 'join', 'film', 'follow'],
      second: ['auto', 'none'],
      micro: ['on', 'off'],
      bstyle: ['solid', 'outline', 'pill', 'link'],
      spot: ['featured', 'latest', 'film', 'none'],
      proof: ['facts', 'shelf', 'none'],
      type: ['classic', 'expressive', 'caps', 'oversized'],
      accent: ['none', 'underline', 'highlight'],
      entrance: ['rise', 'reveal', 'fade', 'none'],
      logo: ['s', 'm', 'l'],
      'reel-layout': ['corner', 'wide', 'name'],
      'reel-peek': ['on', 'off'],
      'reel-pointer': ['liquid', 'smoke', 'glitch', 'none'],
      'reel-trans': ['burn', 'liquid', 'glitch', 'light-leak'],
      'reel-surface': ['none', 'duotone', 'colour', 'grain'],
      'reel-push': ['on', 'off'],
      'reel-band': ['fade', 'under', 'edges', 'none'],
      'reel-edge': ['shadow', 'outline'],
      'reel-opening': ['name', 'none'],
      'reel-film': ['name', 'smoke', 'liquid'],
      'reel-loop': ['on', 'off'],
    });
  });
});

describe('parseHeroOverrides', () => {
  it('reads the stored JSON object', () => {
    expect(
      parseHeroOverrides('{"hero-opt-purpose":"grow","shader-preset":"flow"}')
    ).toEqual({
      'hero-opt-purpose': 'grow',
      'shader-preset': 'flow',
    });
  });

  it('reads nothing, so the classic hero renders, from anything but a JSON object', () => {
    for (const raw of [
      null,
      undefined,
      '',
      '{not json',
      '[1,2]',
      '"grow"',
      'null',
      '42',
    ]) {
      expect(parseHeroOverrides(raw)).toEqual({});
      expect(readHeroSettings(parseHeroOverrides(raw)).purpose).toBeNull();
    }
  });
});

describe('words', () => {
  it('drops counts that undersell and reads minutes as minutes', () => {
    expect(
      heroFacts({
        portals: 1,
        videos: 4,
        audio: 2,
        written: 0,
        totalSeconds: 42 * 60,
      })
    ).toEqual(['6 films & recordings', '42 minutes to watch']);
    expect(
      heroFacts({
        portals: 3,
        videos: 1,
        audio: 0,
        written: 0,
        totalSeconds: 300,
      })
    ).toEqual(['3 portals']);
    expect(
      heroFacts({
        portals: 0,
        videos: 0,
        audio: 0,
        written: 0,
        totalSeconds: 0,
      })
    ).toEqual([]);
    expect(
      heroFacts({
        portals: 0,
        videos: 30,
        audio: 0,
        written: 0,
        totalSeconds: 3.3 * 3600,
      })
    ).toEqual(['30 films', '3.5 hours to watch']);
  });

  it('picks the verbs from what the org mostly publishes', () => {
    expect(contentKindFrom({ video: 4, audio: 2 })).toBe('watch');
    expect(contentKindFrom({ audio: 48 })).toBe('listen');
    expect(contentKindFrom({ written: 34, audio: 6 })).toBe('read');
    expect(contentKindFrom(null)).toBe('watch');
  });

  it('follows the spotlighted piece, and the counts for a portal or none', () => {
    // OBB: 15 essays and 14 films, spotlighting a film
    const counts = { video: 14, written: 15 };
    expect(contentKindForHero({ kind: 'video' }, counts)).toBe('watch');
    expect(contentKindForHero({ kind: 'audio' }, counts)).toBe('listen');
    expect(contentKindForHero({ kind: 'article' }, { video: 9 })).toBe('read');
    expect(contentKindForHero({ kind: 'portal' }, counts)).toBe('read');
    expect(contentKindForHero(null, counts)).toBe('read');
  });

  it('says what a piece is in a plain sentence, singular when it is one', () => {
    expect(portalMeta(3, 4)).toBe('A portal in 3 stages, with 4 practices');
    expect(portalMeta(1, 1)).toBe('A portal in 1 stage, with 1 practice');
    expect(portalMeta(0, 0)).toBe('A portal');
    expect(pieceMeta('video', 12)).toBe('A 12-minute film');
    expect(pieceMeta('audio', null)).toBe('A recording');
    expect(pieceMeta('article', 8)).toBe('An essay');
    expect(portalMeta(2, 0)).toBe('A portal in 2 stages');
    expect(portalMeta(0, 1)).toBe('A portal, with 1 practice');
    expect(pieceMeta('audio', 7)).toBe('A 7-minute recording');
    expect(pieceMeta('video', null)).toBe('A film');
  });

  it('names the consume button and its free note by the content kind', () => {
    expect(heroConsumeLabel('watch')).toBe('Start watching');
    expect(heroConsumeLabel('listen')).toBe('Start listening');
    expect(heroConsumeLabel('read')).toBe('Start reading');
    expect(heroFreeNote('listen')).toBe('Some pieces are free to listen to');
    expect(heroFreeNote('read')).toBe('Some pieces are free to read');
  });

  it('gives every purpose a label and a hint', () => {
    for (const purpose of HERO_PURPOSES) {
      expect(HERO_PURPOSE_COPY[purpose].label('watch')).not.toBe('');
      expect(HERO_PURPOSE_COPY[purpose].hint()).not.toBe('');
    }
    expect(HERO_PURPOSE_COPY.consume.label('listen')).toBe(
      'Get people listening'
    );
  });

  it('shapes the spotlight frame by what it holds', () => {
    expect(frameShapeFor('portal')).toBe('arch');
    expect(frameShapeFor('video')).toBe('wide');
    expect(frameShapeFor('article')).toBe('page');
    expect(frameShapeFor('audio')).toBe('page');
  });
});
