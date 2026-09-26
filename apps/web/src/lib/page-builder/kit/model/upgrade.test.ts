/**
 * `upgradePage` conformance tests (docs/design/landing-builder/01-contract.md
 * §3, BINDING). Fixtures in the first block are copied verbatim from three
 * real `landing_pages` rows (read-only DB query, 2026-09-26) — `bone-deep`
 * (two rows: with and without `seed-journey-content.ts`'s copy pass) and
 * `tending-the-grief`. All three carry an identical page-level Candlelit
 * bundle and current (non-retired) section variants, so the hand-built
 * fixtures further down are what exercise retired ids, garbage input, and
 * the axis→SectionStyle conversion — none of which any sampled real row uses.
 */
import { describe, expect, it } from 'vitest';
import { upgradePage } from './upgrade';

describe('upgradePage · real stored rows', () => {
  // `of-blood-and-bones/bone-deep`, AFTER `seed-journey-content.ts` — the
  // richest real row: hero carries every optional field, ache carries body
  // + points (recovered content the old renderer never read at all).
  const BONE_DEEP = {
    design: {
      edge: 'none',
      type: 'monumental',
      align: 'center',
      media: 'bleed',
      width: 'narrow',
      accent: 'glow',
      motion: 'drift',
      density: 'airy',
      surface: 'media',
    },
    sections: [
      {
        id: '673c640d-6dbf-4156-9aa5-b3fac070fa16',
        name: 'Hero',
        type: 'hero',
        props: {
          bg: 'ember',
          sub: 'Where the body keeps what the mind has agreed to forget. Slow work, close to the bone.',
          felt: 'No fixing. No performance. Just contact.',
          trust: 'Free to start · leave whenever you need to',
          accent: 'at the pace it sets',
          button: 'Begin',
          eyebrow: 'A four-practice descent',
          headline: 'Bone Deep',
        },
        enabled: true,
        variant: 'stage',
      },
      {
        id: 'f8731bdb-f7ec-4cb4-8b1d-d23420e358bd',
        name: 'The ache',
        type: 'ache',
        props: {
          sub: 'Where the body keeps what the mind has agreed to forget. Slow work, close to the bone.',
          body: 'You have done the reading. You can explain your own patterns to anyone who asks. And still, at the end of the day, the jaw is set and nothing has moved.',
          points: [
            'You understand it perfectly and feel it not at all',
            'Rest is something you believe you have to earn',
            'You leave your body to get through the day',
          ],
          eyebrow: 'Why this',
          heading: 'You already know the shape of it.',
        },
        enabled: true,
        variant: 'column',
      },
      {
        id: 'dfd808c7-cdf7-4f35-834c-9f512fdb31e7',
        name: 'The map',
        type: 'map',
        props: {
          sub: 'Arriving · Listening · Staying',
          note: 'The first ground is already open.',
          eyebrow: 'The whole path',
          heading: "Everything you'll walk.",
        },
        enabled: true,
        variant: 'spine',
      },
      {
        id: '15f8df31-408b-442c-bb93-557002b21302',
        name: 'The invite',
        type: 'invite',
        props: {
          sub: 'One key opens everything that grows from here.',
          risk: 'Cancel anytime',
          accent: 'is waiting.',
          button: 'Begin',
          eyebrow: 'Begin',
          heading: 'Bone Deep',
        },
        enabled: true,
        variant: 'pool',
      },
    ],
  };

  it('reads the real bundle as Style "bold" — it is NOT actually an exact Candlelit match', () => {
    // Surprising, and real: `seed-portals.ts` `reconcilePage()` hardcodes
    // `width: 'narrow'` for what its own comment calls "CANDLELIT (research
    // §4.1)", but `design-vocabulary.ts`'s real Candlelit preset — and its
    // own pinned test, `design-vocabulary.test.ts` "Candlelit matches the
    // bundle migration 0084 backfilled" — uses `width: 'text'`. Since
    // `findDesignPreset()`'s own precedent (which `matchLegacyLook` mirrors)
    // requires an EXACT nine-axis match, every page `seed-portals.ts` writes
    // ALREADY reads as "Custom" in today's existing look picker, not
    // Candlelit — this is a pre-existing drift between the two files, not
    // something `upgrade.ts` introduces. "Unrecognised → bold" is therefore
    // the honest, correct answer for these real rows.
    expect(BONE_DEEP.design.width).toBe('narrow'); // NOT 'text' — see above.
    expect(upgradePage(BONE_DEEP).design).toEqual({ style: 'bold' });
  });

  it('upgrades the hero: heading/body compose, ctaLabel drops (button is a seed-portals default)', () => {
    const [hero] = upgradePage(BONE_DEEP).sections;
    expect(hero).toMatchObject({
      id: '673c640d-6dbf-4156-9aa5-b3fac070fa16',
      type: 'hero',
      enabled: true,
      variant: 'statement',
      name: 'Hero',
    });
    // `eyebrow`/`headline`/`sub` are this PORTAL's own copy (seed-portals.ts
    // writes them from `spec.kicker`/`title`/`lede`, which vary per portal)
    // and `felt`/`trust`/`accent` are `seed-journey-content.ts`'s specific
    // prose — none of those are seed defaults, so all five survive. `button:
    // 'Begin'` IS a seed-portals default (identical on every portal) and
    // drops, leaving no `ctaLabel` at all.
    expect(hero!.props).toEqual({
      eyebrow: 'A four-practice descent',
      heading: 'Bone Deep\nat the pace it sets', // headline + accent, on its own line.
      body: 'Where the body keeps what the mind has agreed to forget. Slow work, close to the bone.\n\nNo fixing. No performance. Just contact.', // sub + felt, as two paragraphs.
      note: 'Free to start · leave whenever you need to', // trust → note.
    });
    expect(hero!.props).not.toHaveProperty('ctaLabel');
    // `bg` never appears — it has no v2 destination.
    expect(hero!.props).not.toHaveProperty('bg');
  });

  it('upgrades the ache: eyebrow/heading drop (seed-portals defaults), body/points survive', () => {
    const [, ache] = upgradePage(BONE_DEEP).sections;
    expect(ache).toMatchObject({ type: 'problem', variant: 'statement' });
    // `eyebrow: 'Why this'` and `heading: 'You already know the shape of
    // it.'` are `seed-portals.ts`'s FIXED literals — identical on every
    // portal, never derived from this specific one — so BOTH drop. `body`
    // (`seed-journey-content.ts`'s specific prose, not a seed default) and
    // `points` (never seed-filtered) survive.
    expect(ache!.props).toEqual({
      body: 'You have done the reading. You can explain your own patterns to anyone who asks. And still, at the end of the day, the jaw is set and nothing has moved.',
      points: [
        'You understand it perfectly and feel it not at all',
        'Rest is something you believe you have to earn',
        'You leave your body to get through the day',
      ],
    });
    expect(ache!.props).not.toHaveProperty('eyebrow');
    expect(ache!.props).not.toHaveProperty('heading');
  });

  it('upgrades the map: eyebrow/heading/note all drop — every one is a seed-portals default', () => {
    const [, , map] = upgradePage(BONE_DEEP).sections;
    expect(map).toMatchObject({ type: 'curriculum', variant: 'timeline' });
    // Every legacy key on this real row's map section is one of
    // `seed-portals.ts`'s fixed literals EXCEPT `sub` (`spec.stages.map(s =>
    // s.name).join(' · ')` — genuinely portal-specific). Curriculum's real
    // content (stages, practices) is live data, not props (contract §2), so
    // an all-but-`body` empty bag here is the honest, intended outcome, not
    // a bug — a v2 creator who wants their own eyebrow/heading types one in.
    expect(map!.props).toEqual({ body: 'Arriving · Listening · Staying' });
  });

  it('upgrades the invite: everything but heading drops — the whole bag is seed-portals defaults', () => {
    const [, , , invite] = upgradePage(BONE_DEEP).sections;
    expect(invite).toMatchObject({ type: 'pricing', variant: 'focus' });
    // `eyebrow`/`accent`/`sub`/`risk`/`button` are ALL `seed-portals.ts`
    // fixed literals (or shared with the catalogue's own defaults) on this
    // row — only `heading` (← `headline`, which seed-portals sets to
    // `spec.title`, this portal's own course name) is portal-specific and
    // survives. Real prices/paths still come from `context.offer` at render
    // time regardless (contract §1: "Honest offer copy"), so an
    // almost-empty bag here loses no PRICE information, only decoration.
    expect(invite!.props).toEqual({ heading: 'Bone Deep' });
  });

  it('upgrades the OTHER bone-deep row (before the copy pass) — hero body/heading from sub/headline alone', () => {
    const BEFORE_COPY_PASS = {
      ...BONE_DEEP,
      sections: [
        {
          ...BONE_DEEP.sections[0],
          props: {
            bg: 'ember',
            sub: 'Where the body keeps what the mind has agreed to forget. Slow work, close to the bone.',
            button: 'Begin',
            eyebrow: 'A four-practice descent',
            headline: 'Bone Deep',
          },
        },
        {
          ...BONE_DEEP.sections[1],
          props: {
            sub: 'Where the body keeps what the mind has agreed to forget. Slow work, close to the bone.',
            eyebrow: 'Why this',
            heading: 'You already know the shape of it.',
          },
        },
      ],
    };
    const [hero, ache] = upgradePage(BEFORE_COPY_PASS).sections;
    // No `felt`/`trust`/`accent` on the raw row → no second body paragraph,
    // no note, plain heading. `button: 'Begin'` still drops.
    expect(hero!.props).toEqual({
      eyebrow: 'A four-practice descent',
      heading: 'Bone Deep',
      body: 'Where the body keeps what the mind has agreed to forget. Slow work, close to the bone.',
    });
    // No `body` on the raw row (this row predates the copy pass) → body ←
    // `sub` (this portal's own lede) — and `eyebrow`/`heading` still drop,
    // exactly as on the copy-pass row, since they never depended on it.
    expect(ache!.props).toEqual({
      body: 'Where the body keeps what the mind has agreed to forget. Slow work, close to the bone.',
    });
  });

  it('upgrades `tending-the-grief` (a different portal) consistently — its OWN kicker/title/lede', () => {
    const TENDING_THE_GRIEF = {
      design: BONE_DEEP.design,
      sections: [
        {
          id: 'bcd94d82-856e-4d73-988a-f3f509ec1617',
          name: 'Hero',
          type: 'hero',
          props: {
            bg: 'ember',
            sub: 'Grief is not a problem to be solved. These practices make room for it to move.',
            button: 'Begin',
            eyebrow: 'For the weight you carry',
            headline: 'Tending the Grief',
          },
          enabled: true,
          variant: 'stage',
        },
      ],
    };
    const [hero] = upgradePage(TENDING_THE_GRIEF).sections;
    expect(hero!.props).toEqual({
      eyebrow: 'For the weight you carry',
      heading: 'Tending the Grief',
      body: 'Grief is not a problem to be solved. These practices make room for it to move.',
    });
  });
});

describe('upgradePage · every legacy type, hand-built', () => {
  function page(type: string, variant: string, props: Record<string, unknown>) {
    return {
      sections: [{ id: 's1', type, enabled: true, variant, props }],
    };
  }

  it('introVideo → video: eyebrow alias, body ← sub, caption ← clip, duration dropped', () => {
    const [section] = upgradePage(
      page('introVideo', 'theatre', {
        kicker: 'The film',
        heading: 'A real intro',
        sub: 'A real sub-line.',
        clip: 'Watch this',
        duration: '2:00',
      })
    ).sections;
    expect(section).toMatchObject({ type: 'video', variant: 'theatre' });
    expect(section!.props).toEqual({
      heading: 'A real intro',
      body: 'A real sub-line.',
      caption: 'Watch this',
    });
    // `kicker` was a catalogue seed default for introVideo eyebrow — dropped,
    // so no `eyebrow` at all (nothing else authored it).
    expect(section!.props).not.toHaveProperty('eyebrow');
  });

  it('turn → transformation: statement/lede aliases, from/to → before/after paragraphs, points dropped', () => {
    const [section] = upgradePage(
      page('turn', 'arc', {
        kicker: 'A real kicker',
        statement: 'A real statement',
        lede: 'A real lede.',
        from: 'Line one.\nLine two.',
        to: 'Destination line.',
        points: ['Should not survive — no v2 slot'],
      })
    ).sections;
    expect(section).toMatchObject({ type: 'transformation', variant: 'steps' });
    expect(section!.props).toEqual({
      eyebrow: 'A real kicker',
      heading: 'A real statement',
      body: 'A real lede.',
      before: ['Line one.', 'Line two.'],
      after: ['Destination line.'],
    });
    expect(section!.props).not.toHaveProperty('points');
  });

  it('feel → benefits: inclusions → items (label→title), preview* dropped', () => {
    const [section] = upgradePage(
      page('feel', 'grid', {
        kicker: 'A real kicker',
        heading: 'A real heading',
        body: 'A real body.',
        inclusions: [
          { label: 'Weekly calls', detail: 'Every Thursday' },
          { label: 'No detail here' },
          { label: '' }, // dropped — no title.
        ],
        previewTitle: 'Should not survive',
        previewDuration: 480,
      })
    ).sections;
    expect(section!.props.items).toEqual([
      { title: 'Weekly calls', detail: 'Every Thursday' },
      { title: 'No detail here' },
    ]);
    expect(section!.props).not.toHaveProperty('previewTitle');
    expect(section!.props).not.toHaveProperty('previewDuration');
  });

  it('reel → preview: eyebrow alias, first `captions[]` entry wins over singular `caption`', () => {
    const [section] = upgradePage(
      page('reel', 'split', {
        kicker: 'A real kicker',
        heading: 'A real heading',
        sub: 'A real sub.',
        captions: ['First whisper', 'Second whisper'],
        caption: 'Should lose to captions[0]',
        clip: 'Should not survive — no v2 slot',
      })
    ).sections;
    expect(section).toMatchObject({ type: 'preview', variant: 'split' });
    expect(section!.props).toEqual({
      eyebrow: 'A real kicker',
      heading: 'A real heading',
      body: 'A real sub.',
      caption: 'First whisper',
    });
  });

  it('reel falls back to the singular `caption` when `captions[]` is absent', () => {
    const [section] = upgradePage(
      page('reel', 'theatre', { caption: 'Only this whisper' })
    ).sections;
    expect(section!.props.caption).toBe('Only this whisper');
  });

  it('guide → instructor: role → v2 `role` (not eyebrow), bio/body alias, facts → credentials', () => {
    const [section] = upgradePage(
      page('guide', 'quote', {
        role: 'Twelve years teaching',
        name: 'Rowan',
        heading: 'Who holds this, really',
        body: 'A real bio, in their own words.',
        quote: 'A real pull-quote.',
        facts: [
          { label: '12 years practising', detail: 'certified 2014' },
          { label: 'Trained 400+ students' },
        ],
        clip: 'Should not survive',
      })
    ).sections;
    expect(section).toMatchObject({ type: 'instructor', variant: 'quote' });
    expect(section!.props).toEqual({
      role: 'Twelve years teaching',
      heading: 'Who holds this, really',
      body: 'A real bio, in their own words.',
      name: 'Rowan',
      quote: 'A real pull-quote.',
      credentials: [
        '12 years practising: certified 2014',
        'Trained 400+ students',
      ],
    });
    expect(section!.props).not.toHaveProperty('eyebrow');
  });

  it('proof → testimonials: q/n/c numbered triples recovered into items[], trust → note', () => {
    const [section] = upgradePage(
      page('proof', 'wall', {
        eyebrow: 'A real eyebrow',
        heading: 'A real heading',
        trust: 'A real aggregate trust line',
        q1: 'A real first quote.',
        n1: 'Real Name',
        c1: 'real context',
        q2: 'A real second quote.',
        // n2/c2 omitted — a half-filled group still produces an item (only
        // `quote` is required).
      })
    ).sections;
    expect(section).toMatchObject({ type: 'testimonials', variant: 'grid' });
    expect(section!.props.note).toBe('A real aggregate trust line');
    expect(section!.props.items).toEqual([
      {
        quote: 'A real first quote.',
        name: 'Real Name',
        detail: 'real context',
      },
      { quote: 'A real second quote.' },
    ]);
  });

  it('proof drops a numbered group whose quote is a seed default', () => {
    const [section] = upgradePage(
      page('proof', 'grid', {
        q1: 'A short, specific testimonial in their words.', // catalogue seed default
        n1: 'First L.',
        q2: 'A real, specific quote nobody templated.',
        n2: 'Real Name',
      })
    ).sections;
    expect(section!.props.items).toEqual([
      { quote: 'A real, specific quote nobody templated.', name: 'Real Name' },
    ]);
  });

  it('invite offers[] carry across (minus `who`), never seed-filtered', () => {
    const [section] = upgradePage(
      page('invite', 'tiers', {
        heading: 'Rootwork',
        offers: [
          {
            id: 'purchase',
            name: 'Own it',
            who: 'Should not survive — no v2 offers[] field',
            blurb: 'A real blurb.',
            bullets: ['One', 'Two'],
            best: true,
          },
          { id: 'subscription-monthly', name: 'Monthly' },
        ],
      })
    ).sections;
    expect(section!.props.offers).toEqual([
      {
        id: 'purchase',
        name: 'Own it',
        blurb: 'A real blurb.',
        bullets: ['One', 'Two'],
        best: true,
      },
      { id: 'subscription-monthly', name: 'Monthly' },
    ]);
  });
});

describe('upgradePage · the `hero`/`faq` identity-mapped collision', () => {
  it('treats `type: "hero"` with `headline` as LEGACY, mapping it', () => {
    const [section] = upgradePage({
      sections: [
        {
          id: 's1',
          type: 'hero',
          enabled: true,
          props: { headline: 'Legacy headline', sub: 'Legacy sub' },
        },
      ],
    }).sections;
    expect(section!.props).toEqual({
      heading: 'Legacy headline',
      body: 'Legacy sub',
    });
  });

  it('treats `type: "hero"` with `heading` (no `headline`) as v2, passing through', () => {
    const [section] = upgradePage({
      sections: [
        {
          id: 's1',
          type: 'hero',
          enabled: true,
          props: { heading: 'Already v2', media: 'image', watchLabel: 'Watch' },
        },
      ],
    }).sections;
    expect(section!.props).toEqual({
      heading: 'Already v2',
      media: 'image',
      watchLabel: 'Watch',
    });
  });

  it('treats `type: "faq"` with no `items` array as LEGACY, mapping q1/a1…', () => {
    const [section] = upgradePage({
      sections: [
        {
          id: 's1',
          type: 'faq',
          enabled: true,
          props: { q1: 'Real question?', a1: 'Real answer.' },
        },
      ],
    }).sections;
    expect(section!.props).toEqual({
      items: [{ question: 'Real question?', answer: 'Real answer.' }],
    });
  });

  it('treats `type: "faq"` with an `items` array as v2, passing through unchanged', () => {
    const v2Props = {
      heading: 'Questions',
      items: [{ question: 'Q?', answer: 'A.' }],
      contactLabel: 'Email us',
      contactHref: 'mailto:hi@example.com',
    };
    const [section] = upgradePage({
      sections: [{ id: 's1', type: 'faq', enabled: true, props: v2Props }],
    }).sections;
    expect(section!.props).toEqual(v2Props);
  });

  it('on a v2 page (valid `design.style`), a faq with NO `items` is still v2 — provenance beats the shape tell', () => {
    const v2Props = {
      heading: 'Questions',
      contactLabel: 'Email us',
      contactHref: 'mailto:hi@example.com',
    };
    const upgraded = upgradePage({
      design: { style: 'soft' },
      sections: [{ id: 's1', type: 'faq', enabled: true, props: v2Props }],
    });
    expect(upgraded.sections[0]!.props).toEqual(v2Props);
    expect(upgradePage(upgraded)).toEqual(upgraded);
  });

  it('on a v2 page, a hero that happens to carry `headline` is not re-mapped', () => {
    const v2Props = { heading: 'Real heading', headline: 'stray key' };
    const [section] = upgradePage({
      design: { style: 'bold' },
      sections: [{ id: 'h1', type: 'hero', enabled: true, props: v2Props }],
    }).sections;
    expect(section!.props).toEqual(v2Props);
  });
});

describe('upgradePage · idempotence', () => {
  const LEGACY_PAGE = {
    design: {
      width: 'wide',
      density: 'regular',
      surface: 'invert',
      edge: 'heavy',
      align: 'center',
      type: 'expressive',
      accent: 'fill',
      motion: 'stagger',
      media: 'mask',
    }, // Full Send.
    sections: [
      {
        id: 's1',
        type: 'hero',
        enabled: true,
        variant: 'split-media',
        design: { surface: 'panel', density: 'vast' },
        props: {
          eyebrow: 'E',
          headline: 'H',
          accent: 'A',
          sub: 'S',
          felt: 'F',
          button: 'B',
          quiet: 'Q',
          secondaryHref: '/about',
          trust: 'T',
          bg: 'blood',
          mediaMode: 'loop',
        },
      },
      {
        id: 's2',
        type: 'faq',
        enabled: false,
        variant: 'grouped',
        props: { heading: 'FAQ', q1: 'Q1?', a1: 'A1.', g1: 'Group' },
      },
      {
        id: 's3',
        type: 'invite',
        enabled: true,
        variant: 'descent', // retired id.
        props: {
          heading: 'Buy',
          accent: 'is waiting.',
          offers: [{ id: 'purchase' }],
        },
      },
    ],
  };

  it('a full legacy page settles to a fixed point: f(f(x)) deep-equals f(x)', () => {
    const once = upgradePage(LEGACY_PAGE);
    const twice = upgradePage(
      once as unknown as { design: unknown; sections: unknown }
    );
    expect(twice).toEqual(once);
  });

  it('resolves the Full Send bundle to Style "bold"', () => {
    expect(upgradePage(LEGACY_PAGE).design).toEqual({ style: 'bold' });
  });

  it('resolves the retired `invite: descent` id to its current mapping ("focus")', () => {
    const [, , invite] = upgradePage(LEGACY_PAGE).sections;
    expect(invite!.variant).toBe('focus');
  });

  it('converts a section design override (surface/density) to a v2 SectionStyle', () => {
    const [hero] = upgradePage(LEGACY_PAGE).sections;
    // `panel` → `soft`, `vast` → `spacious` — independent of the page's own
    // Full Send bundle, and independent of the hero's OWN retired-id-free
    // variant (a plain rename, `split-media` → `split`, carries no axes).
    expect(hero!.design).toEqual({ scheme: 'soft', spacing: 'spacious' });
  });

  it('a genuinely v2-shaped page passes through with only invalid ids coerced to absent', () => {
    const v2 = {
      design: { style: 'clean' },
      sections: [
        {
          id: 's1',
          type: 'text',
          enabled: true,
          variant: 'not-a-real-layout',
          design: { scheme: 'brand', spacing: 'not-a-real-spacing' },
          props: { heading: 'A v2 page' },
        },
      ],
    };
    const upgraded = upgradePage(v2);
    expect(upgraded.design).toEqual({ style: 'clean' });
    expect(upgraded.sections[0]!.variant).toBeUndefined(); // invalid → absent, not the type's default.
    expect(upgraded.sections[0]!.design).toEqual({ scheme: 'brand' }); // invalid spacing → absent.
    expect(upgraded.sections[0]!.props).toEqual({ heading: 'A v2 page' });
    expect(
      upgradePage(upgraded as unknown as { design: unknown; sections: unknown })
    ).toEqual(upgraded);
  });
});

describe('upgradePage · garbage input, never throws', () => {
  it.each([
    null,
    undefined,
    {},
    { design: null, sections: null },
    { design: 'a string', sections: 'a string' },
    { design: 42, sections: [42, 'x', null, [], true] },
    { sections: [{ id: 's1' }] }, // no `type` at all.
    { sections: [{ id: 's1', type: 'not-a-real-type', props: {} }] },
    { sections: [{ type: 'hero', enabled: true, props: {} }] }, // no `id`.
    { sections: [null, 'x', 42, [], { id: 's1', type: 'hero', props: null }] },
  ] as const)('survives %#', (input) => {
    expect(() =>
      upgradePage(input as { design?: unknown; sections?: unknown })
    ).not.toThrow();
  });

  it('drops every garbage entry and keeps the one real section', () => {
    const upgraded = upgradePage({
      sections: [
        null,
        'not an object',
        42,
        { id: 's1', type: 'unknown-type-nobody-declared', props: {} },
        { type: 'hero', enabled: true, props: {} }, // no id.
        { id: 's2', type: 'hero', enabled: true, props: { headline: 'Real' } },
      ],
    });
    expect(upgraded.sections).toHaveLength(1);
    expect(upgraded.sections[0]!.id).toBe('s2');
  });

  it('defaults to Style "bold" for a page with no design at all', () => {
    expect(upgradePage({}).design).toEqual({ style: 'bold' });
  });
});

describe('upgradePage · look → Style, all eight presets + unrecognised', () => {
  it.each([
    [
      'candlelit',
      'cinematic',
      {
        width: 'text',
        density: 'airy',
        surface: 'media',
        edge: 'none',
        align: 'center',
        type: 'monumental',
        accent: 'glow',
        motion: 'drift',
        media: 'bleed',
      },
    ],
    [
      'quiet-studio',
      'clean',
      {
        width: 'narrow',
        density: 'vast',
        surface: 'bare',
        edge: 'hairline',
        align: 'center',
        type: 'monumental',
        accent: 'none',
        motion: 'fade',
        media: 'inset',
      },
    ],
    [
      'long-read',
      'clean',
      {
        width: 'text',
        density: 'regular',
        surface: 'bare',
        edge: 'hairline',
        align: 'start',
        type: 'balanced',
        accent: 'text',
        motion: 'rise',
        media: 'frame',
      },
    ],
    [
      'open-air',
      'soft',
      {
        width: 'text',
        density: 'airy',
        surface: 'tint',
        edge: 'soft',
        align: 'center',
        type: 'expressive',
        accent: 'text',
        motion: 'drift',
        media: 'mask',
      },
    ],
    [
      'plain-facts',
      'clean',
      {
        width: 'wide',
        density: 'compact',
        surface: 'panel',
        edge: 'offset',
        align: 'start',
        type: 'monumental',
        accent: 'fill',
        motion: 'none',
        media: 'none',
      },
    ],
    [
      'syllabus',
      'clean',
      {
        width: 'wide',
        density: 'compact',
        surface: 'panel',
        edge: 'hairline',
        align: 'start',
        type: 'restrained',
        accent: 'edge',
        motion: 'none',
        media: 'frame',
      },
    ],
    [
      'full-send',
      'bold',
      {
        width: 'wide',
        density: 'regular',
        surface: 'invert',
        edge: 'heavy',
        align: 'center',
        type: 'expressive',
        accent: 'fill',
        motion: 'stagger',
        media: 'mask',
      },
    ],
    [
      'signal',
      'bold',
      {
        width: 'wide',
        density: 'regular',
        surface: 'panel',
        edge: 'hairline',
        align: 'start',
        type: 'balanced',
        accent: 'fill',
        motion: 'rise',
        media: 'frame',
      },
    ],
  ] as const)('%s bundle → Style "%s"', (_name, style, design) => {
    expect(upgradePage({ design }).design).toEqual({ style });
  });

  it('an eight-axis near-miss (not an exact match) is "unrecognised" → bold', () => {
    const nearCandlelit = {
      width: 'text',
      density: 'airy',
      surface: 'media',
      edge: 'none',
      align: 'center',
      type: 'monumental',
      accent: 'glow',
      motion: 'drift',
      media: 'frame', // Candlelit's real value is 'bleed'.
    };
    expect(upgradePage({ design: nearCandlelit }).design).toEqual({
      style: 'bold',
    });
  });

  it('a page-level `style` key wins outright over the axis bundle', () => {
    const candlelitAxesButV2Style = {
      style: 'soft',
      width: 'text',
      density: 'airy',
      surface: 'media',
      edge: 'none',
      align: 'center',
      type: 'monumental',
      accent: 'glow',
      motion: 'drift',
      media: 'bleed',
    };
    expect(upgradePage({ design: candlelitAxesButV2Style }).design).toEqual({
      style: 'soft',
    });
  });
});
