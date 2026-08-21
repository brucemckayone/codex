/**
 * Course offer paths — the provenance contract (Codex-2pryk.2.4.3).
 *
 * What these tests exist to prevent is one specific regression: a price or a way
 * in that came from AUTHORED MARKETING COPY rather than from the authoritative
 * `CourseOffer`. That was the live bug — a dev sell page advertised "Included
 * with membership · £12 a month" while the real tier cost £15 and the real
 * course subscription cost £27, because both conversion surfaces built their
 * catalogue out of `invite.props.offers[].priceLabel`.
 *
 * So every assertion below is anchored on one of:
 *   - a path exists ⟺ it is in `offer.paths`;
 *   - a price equals the real pence from `offer.*`, never an authored string;
 *   - authored copy that names no real path changes nothing.
 *
 * Fixtures mirror the dev course exactly (£24.99 one-off, £27/mo + £270/yr
 * course subscription, Soul Path tier £15/mo) so a failure here reads against
 * something verifiable in the browser.
 */
import { describe, expect, it } from 'vitest';
import type { CourseOffer, SectionProps } from '$lib/page-builder';
import {
  buildHeadNote,
  checkoutUrlForPath,
  deriveOfferPaths,
  deriveOfferPathsForPage,
  formatCleanPrice,
  resolveOfferTarget,
  resolvePreselectedOffer,
  toWireInterval,
} from './offer-paths';

const TIER_ID = '33f6c1a1-bb69-4902-b24a-4365170c022c';
const COURSE = { title: 'Rootwork' };

const FULL_OFFER: CourseOffer = {
  courseId: '408f94d0-5442-43d3-a56a-3491110962eb',
  organizationId: 'ddea4b84-64d1-451c-a8f5-4c28956e5fb2',
  paths: ['purchase', 'subscription', 'tier'],
  purchase: { priceCents: 2499 },
  subscription: {
    planId: 'b8341535-fd97-4976-81a9-6f218e151388',
    priceMonthly: 2700,
    priceAnnual: 27000,
  },
  tiers: [
    {
      tierId: TIER_ID,
      tierName: 'Soul Path',
      priceMonthly: 1500,
      priceAnnual: 14400,
    },
  ],
  entitled: false,
};

/**
 * The copy the seed data actually authored — three cards with hand-typed prices
 * and ids that name no real path. Every one of them must be dropped.
 */
const LEGACY_AUTHORED: SectionProps = {
  priceNote: 'VAT included',
  offers: [
    {
      id: 'membership',
      name: 'Full membership',
      priceLabel: '£12',
      per: 'month',
      best: true,
      blurb: 'Every journey, every practice.',
    },
    {
      id: 'course-sub',
      name: 'Rootwork monthly',
      priceLabel: '£6',
      per: 'month',
    },
    { id: 'one-off', name: 'Own Rootwork', per: 'once' },
  ],
};

function offerWith(patch: Partial<CourseOffer>): CourseOffer {
  return { ...FULL_OFFER, ...patch };
}

describe('deriveOfferPaths · every path traces to offer.paths', () => {
  it('expands all three ways in, priced from the real rows', () => {
    const paths = deriveOfferPaths(FULL_OFFER, COURSE);

    expect(paths.map((p) => p.id)).toEqual([
      'purchase',
      'subscription-monthly',
      'subscription-annual',
      `tier:${TIER_ID}`,
    ]);
    // Prices in PENCE, straight off the offer — asserted numerically so a
    // formatting change cannot mask a wrong amount.
    expect(paths.map((p) => p.priceCents)).toEqual([2499, 2700, 27000, 1500]);
    expect(paths.map((p) => p.priceLabel)).toEqual([
      '£24.99', // pence render in full
      '£27', // whole pounds render clean
      '£270',
      '£15',
    ]);
    expect(paths.map((p) => p.kind)).toEqual([
      'purchase',
      'subscription',
      'subscription',
      'tier',
    ]);
  });

  it('carries the submit payload each path needs (no re-derivation downstream)', () => {
    const paths = deriveOfferPaths(FULL_OFFER, COURSE);
    const [purchase, monthly, annual, tier] = paths;

    expect(purchase.billingInterval).toBeUndefined();
    expect(purchase.recurring).toBe(false);
    expect(purchase.cadenceLabel).toBe('one-off');

    expect(monthly.billingInterval).toBe('monthly');
    expect(annual.billingInterval).toBe('annual');
    expect(monthly.recurring).toBe(true);
    expect(annual.cadenceLabel).toBe('per year');

    // The tier path is the only one that needs a tier id to charge.
    expect(tier.tierId).toBe(TIER_ID);
    expect(tier.billingInterval).toBe('monthly');
    expect(purchase.tierId).toBeUndefined();
    expect(monthly.tierId).toBeUndefined();
  });

  it('offers only the purchase when only the purchase exists', () => {
    const paths = deriveOfferPaths(
      offerWith({ paths: ['purchase'], subscription: null, tiers: [] }),
      COURSE
    );
    expect(paths.map((p) => p.id)).toEqual(['purchase']);
    expect(paths[0].priceCents).toBe(2499);
  });

  it('offers only the subscription (both cadences) when only a plan exists', () => {
    const paths = deriveOfferPaths(
      offerWith({ paths: ['subscription'], purchase: null, tiers: [] }),
      COURSE
    );
    expect(paths.map((p) => p.id)).toEqual([
      'subscription-monthly',
      'subscription-annual',
    ]);
  });

  it('offers one card per tier when only tier access exists', () => {
    const paths = deriveOfferPaths(
      offerWith({
        paths: ['tier'],
        purchase: null,
        subscription: null,
        tiers: [
          ...FULL_OFFER.tiers,
          {
            tierId: 'tier-inner',
            tierName: 'Inner Circle',
            priceMonthly: 4500,
            priceAnnual: 43200,
          },
        ],
      }),
      COURSE
    );
    expect(paths.map((p) => p.id)).toEqual([
      `tier:${TIER_ID}`,
      'tier:tier-inner',
    ]);
    expect(paths.map((p) => p.priceCents)).toEqual([1500, 4500]);
  });

  it('is empty when the course is not sold at all', () => {
    expect(
      deriveOfferPaths(
        offerWith({ paths: [], purchase: null, subscription: null, tiers: [] }),
        COURSE
      )
    ).toEqual([]);
  });

  it('is empty — never a fabricated price — when the offer read was unavailable', () => {
    // The sell page `.catch(() => null)`s the read. Degrading to "no paths" is
    // the whole point: the section then shows a price-less CTA.
    expect(deriveOfferPaths(null, COURSE, LEGACY_AUTHORED)).toEqual([]);
  });

  it('ignores a path claimed in `paths` with no row behind it', () => {
    // `getCourseOffer` cannot emit this, but the bag is a wire type — a
    // subscription path with a null plan must not produce a priceless card.
    const paths = deriveOfferPaths(
      offerWith({
        paths: ['purchase', 'subscription'],
        subscription: null,
        tiers: [],
      }),
      COURSE
    );
    expect(paths.map((p) => p.id)).toEqual(['purchase']);
  });
});

describe('deriveOfferPaths · authored copy decorates, never creates or prices', () => {
  it('drops every legacy authored entry, because none names a canonical path', () => {
    const paths = deriveOfferPaths(FULL_OFFER, COURSE, LEGACY_AUTHORED);

    // The exact strings from the live bug must appear nowhere.
    const rendered = JSON.stringify(paths);
    expect(rendered).not.toContain('£12');
    expect(rendered).not.toContain('£6');
    expect(rendered).not.toContain('Full membership');
    expect(paths.map((p) => p.name)).toEqual([
      'Own Rootwork',
      'Rootwork monthly',
      'Rootwork yearly',
      'Soul Path',
    ]);
  });

  it('applies authored copy to the path whose canonical id it names', () => {
    const authored: SectionProps = {
      offers: [
        {
          id: `tier:${TIER_ID}`,
          name: 'The Soul Path',
          who: 'For the whole road',
          blurb: 'Everything we make, including this.',
          bullets: ['All journeys', 'All practices'],
        },
      ],
    };

    const tier = deriveOfferPaths(FULL_OFFER, COURSE, authored).find(
      (p) => p.kind === 'tier'
    );

    expect(tier?.name).toBe('The Soul Path');
    expect(tier?.who).toBe('For the whole road');
    expect(tier?.blurb).toBe('Everything we make, including this.');
    expect(tier?.bullets).toEqual(['All journeys', 'All practices']);
  });

  it('never lets an authored priceLabel override the real price', () => {
    // THE regression test. An authored entry that names a real path and tries to
    // restate its price: the copy lands, the price does not move.
    const authored: SectionProps = {
      offers: [
        {
          id: 'subscription-monthly',
          name: 'Rootwork, monthly',
          priceLabel: '£1',
          cadenceLabel: 'per decade',
          per: 'decade',
        },
      ],
    };

    const monthly = deriveOfferPaths(FULL_OFFER, COURSE, authored).find(
      (p) => p.id === 'subscription-monthly'
    );

    expect(monthly?.name).toBe('Rootwork, monthly');
    expect(monthly?.priceCents).toBe(2700);
    expect(monthly?.priceLabel).toBe('£27');
    // The cadence follows the canonical path, not the authored string.
    expect(monthly?.cadenceLabel).toBe('per month');
  });

  it('cannot create a path that the offer does not contain', () => {
    const authored: SectionProps = {
      offers: [
        { id: 'subscription-monthly', name: 'Ghost subscription', best: true },
        { id: 'tier:tier-that-does-not-exist', name: 'Ghost tier', best: true },
      ],
    };

    const paths = deriveOfferPaths(
      offerWith({ paths: ['purchase'], subscription: null, tiers: [] }),
      COURSE,
      authored
    );

    expect(paths.map((p) => p.id)).toEqual(['purchase']);
    expect(JSON.stringify(paths)).not.toContain('Ghost');
  });

  it('ignores a malformed authored entry rather than throwing during SSR', () => {
    // `props` is org-authored jsonb; every field goes through the coerce guards.
    const authored = {
      offers: [
        null,
        'not an object',
        { name: 'no id at all' },
        { id: 42 },
        { id: 'purchase', name: 77, bullets: ['keep', 5, '  ', ' trim '] },
      ],
    } as unknown as SectionProps;

    const purchase = deriveOfferPaths(FULL_OFFER, COURSE, authored)[0];

    expect(purchase.id).toBe('purchase');
    expect(purchase.name).toBe('Own Rootwork'); // non-string name ignored
    expect(purchase.bullets).toEqual(['keep', 'trim']); // filtered + trimmed
  });

  it('lets the FIRST authored entry for an id win over a duplicate', () => {
    const authored: SectionProps = {
      offers: [
        { id: 'purchase', name: 'First' },
        { id: 'purchase', name: 'Second' },
      ],
    };
    expect(deriveOfferPaths(FULL_OFFER, COURSE, authored)[0].name).toBe(
      'First'
    );
  });
});

describe('deriveOfferPaths · exactly one recommendation', () => {
  it('recommends the cheapest tier by default (the membership upsell)', () => {
    const paths = deriveOfferPaths(
      offerWith({
        tiers: [
          {
            tierId: 'tier-inner',
            tierName: 'Inner Circle',
            priceMonthly: 4500,
            priceAnnual: 43200,
          },
          ...FULL_OFFER.tiers,
        ],
      }),
      COURSE
    );

    expect(paths.filter((p) => p.best).map((p) => p.id)).toEqual([
      `tier:${TIER_ID}`,
    ]);
  });

  it('recommends the monthly subscription when there is no tier', () => {
    const paths = deriveOfferPaths(
      offerWith({ paths: ['purchase', 'subscription'], tiers: [] }),
      COURSE
    );
    expect(paths.filter((p) => p.best).map((p) => p.id)).toEqual([
      'subscription-monthly',
    ]);
  });

  it('recommends the only path when there is only one', () => {
    const paths = deriveOfferPaths(
      offerWith({ paths: ['purchase'], subscription: null, tiers: [] }),
      COURSE
    );
    expect(paths[0].best).toBe(true);
  });

  it('honours an authored `best` — and still badges exactly one card', () => {
    const authored: SectionProps = {
      offers: [
        { id: 'purchase', best: true },
        { id: 'subscription-annual', best: true },
      ],
    };

    const paths = deriveOfferPaths(FULL_OFFER, COURSE, authored);

    // Two authored `best: true` is a broken page, not a stronger recommendation.
    expect(paths.filter((p) => p.best).map((p) => p.id)).toEqual(['purchase']);
  });
});

describe('deriveOfferPaths · derived annual saving', () => {
  it('states the real saving, computed from the two real prices', () => {
    // £27 × 12 = £324 vs £270 → £54.
    const annual = deriveOfferPaths(FULL_OFFER, COURSE).find(
      (p) => p.id === 'subscription-annual'
    );
    expect(annual?.bullets).toContain('Save £54 a year vs monthly');
  });

  it('claims no saving when the annual price gives none', () => {
    const annual = deriveOfferPaths(
      offerWith({
        subscription: { planId: 'p1', priceMonthly: 2700, priceAnnual: 32400 },
      }),
      COURSE
    ).find((p) => p.id === 'subscription-annual');

    expect(annual?.bullets).toEqual(['This course only', 'Billed once a year']);
    expect(JSON.stringify(annual)).not.toContain('Save');
  });
});

describe('deriveOfferPathsForPage', () => {
  const invite = {
    id: 'sec-invite',
    type: 'invite' as const,
    enabled: true,
    props: { offers: [{ id: 'purchase', name: 'From the page' }] },
  };

  it('reads the first ENABLED invite section on the page', () => {
    const paths = deriveOfferPathsForPage(FULL_OFFER, COURSE, [
      {
        ...invite,
        id: 'sec-off',
        enabled: false,
        props: { offers: [{ id: 'purchase', name: 'Disabled' }] },
      },
      invite,
    ]);
    expect(paths[0].name).toBe('From the page');
  });

  it('still derives the real paths when the page has no invite section', () => {
    const paths = deriveOfferPathsForPage(FULL_OFFER, COURSE, []);
    expect(paths.map((p) => p.id)).toEqual([
      'purchase',
      'subscription-monthly',
      'subscription-annual',
      `tier:${TIER_ID}`,
    ]);
  });
});

describe('resolvePreselectedOffer', () => {
  const paths = deriveOfferPaths(FULL_OFFER, COURSE);

  it('honours ?offer= when it names a real path', () => {
    expect(resolvePreselectedOffer(paths, 'subscription-annual')).toBe(
      'subscription-annual'
    );
    expect(resolvePreselectedOffer(paths, `tier:${TIER_ID}`)).toBe(
      `tier:${TIER_ID}`
    );
  });

  it('falls back to the recommendation for a stale or tampered token', () => {
    expect(resolvePreselectedOffer(paths, 'tier:deleted-tier')).toBe(
      `tier:${TIER_ID}`
    );
    expect(resolvePreselectedOffer(paths, null)).toBe(`tier:${TIER_ID}`);
  });

  it('is empty when there are no paths', () => {
    expect(resolvePreselectedOffer([], 'purchase')).toBe('');
  });
});

describe('buildHeadNote', () => {
  it('counts WAYS IN, not cards', () => {
    // Three paths expand to four cards (the subscription has two cadences).
    expect(deriveOfferPaths(FULL_OFFER, COURSE)).toHaveLength(4);
    expect(buildHeadNote(FULL_OFFER)).toBe('One course. Three ways in.');
  });

  it('is undefined for a single way in, and for no offer at all', () => {
    expect(
      buildHeadNote(
        offerWith({ paths: ['purchase'], subscription: null, tiers: [] })
      )
    ).toBeUndefined();
    expect(buildHeadNote(null)).toBeUndefined();
  });
});

describe('resolveOfferTarget · the pay step gate', () => {
  it('projects the payload the submit needs for each kind', () => {
    expect(resolveOfferTarget(FULL_OFFER, 'purchase')).toEqual({
      id: 'purchase',
      kind: 'purchase',
      priceCents: 2499,
      tierId: undefined,
      billingInterval: undefined,
    });
    expect(resolveOfferTarget(FULL_OFFER, 'subscription-annual')).toEqual({
      id: 'subscription-annual',
      kind: 'subscription',
      priceCents: 27000,
      tierId: undefined,
      billingInterval: 'annual',
    });
    expect(resolveOfferTarget(FULL_OFFER, `tier:${TIER_ID}`)).toEqual({
      id: `tier:${TIER_ID}`,
      kind: 'tier',
      priceCents: 1500,
      tierId: TIER_ID,
      billingInterval: 'monthly',
    });
  });

  it('accepts exactly the ids the cards offer — no more, no fewer', () => {
    // The submit gate and the display derivation MUST agree, or a card could be
    // selectable but unbuyable (or an unlisted path quietly chargeable).
    const cardIds = deriveOfferPaths(FULL_OFFER, COURSE).map((p) => p.id);
    for (const id of cardIds) {
      expect(resolveOfferTarget(FULL_OFFER, id), id).not.toBeNull();
    }
    expect(cardIds).toHaveLength(4);
  });

  it('refuses an id for a path that does not exist', () => {
    expect(resolveOfferTarget(FULL_OFFER, 'tier:nope')).toBeNull();
    expect(resolveOfferTarget(FULL_OFFER, 'subscription-weekly')).toBeNull();
    expect(resolveOfferTarget(FULL_OFFER, '')).toBeNull();
  });

  it('refuses a WITHDRAWN path whose id is still well-formed', () => {
    // The buyer's page was rendered while the plan existed. Between render and
    // submit the creator withdrew it — the stale id must not start a checkout.
    const withdrawn = offerWith({
      paths: ['purchase'],
      subscription: null,
      tiers: [],
    });
    expect(resolveOfferTarget(withdrawn, 'subscription-monthly')).toBeNull();
    expect(resolveOfferTarget(withdrawn, `tier:${TIER_ID}`)).toBeNull();
    expect(resolveOfferTarget(withdrawn, 'purchase')).not.toBeNull();
  });

  it('refuses everything when there is no offer to check against', () => {
    expect(resolveOfferTarget(null, 'purchase')).toBeNull();
  });
});

describe('toWireInterval', () => {
  it('maps the plan-row vocabulary to the vocabulary the routes validate', () => {
    // Every checkout schema is `billingIntervalEnum = z.enum(['month','year'])`,
    // while the columns are price_monthly / price_annual. Forwarding is a 400.
    expect(toWireInterval('monthly')).toBe('month');
    expect(toWireInterval('annual')).toBe('year');
  });
});

describe('checkoutUrlForPath', () => {
  it('deep-links the selection into the checkout', () => {
    expect(
      checkoutUrlForPath(
        'http://acme.lvh.me:3000/journeys/rootwork/checkout',
        'purchase'
      )
    ).toBe('http://acme.lvh.me:3000/journeys/rootwork/checkout?offer=purchase');
  });

  it('appends to an existing query string and encodes the token', () => {
    const href = checkoutUrlForPath(
      '/journeys/rootwork/checkout?ref=hero',
      `tier:${TIER_ID}`
    );
    expect(href).toBe(
      `/journeys/rootwork/checkout?ref=hero&offer=tier%3A${TIER_ID}`
    );
    // Round-trips through the server's `url.searchParams.get('offer')`.
    expect(
      new URL(href, 'http://acme.lvh.me:3000').searchParams.get('offer')
    ).toBe(`tier:${TIER_ID}`);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE INVITE SECTION'S NEW COMPOSITIONS — the data half of their contract.

   `tiers`, `table` and `sticky` (WT-7) are the first surfaces on the PUBLIC sell
   page to render `who` and `bullets`, and `sticky` is the first to pick a single
   path out of the list and put a price beside a pinned CTA. Each of those is a
   fresh way for the £12-vs-£15 bug to come back, so each gets a guard here
   rather than in the component: the component can only render what this module
   returns, so the invariant is cheaper and stronger to pin at the derivation.

   These EXTEND the suite above and weaken nothing — every existing assertion is
   untouched.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Every offer shape a real page can be in, including the two empty ones. */
const ALL_SHAPES: ReadonlyArray<readonly [string, CourseOffer | null]> = [
  ['full (purchase + subscription + tier)', FULL_OFFER],
  [
    'purchase only',
    offerWith({ paths: ['purchase'], subscription: null, tiers: [] }),
  ],
  [
    'subscription only',
    offerWith({ paths: ['subscription'], purchase: null, tiers: [] }),
  ],
  [
    'tier only',
    offerWith({ paths: ['tier'], purchase: null, subscription: null }),
  ],
  [
    'nothing for sale',
    offerWith({ paths: [], purchase: null, subscription: null, tiers: [] }),
  ],
  ['offer read unavailable', null],
];

describe('the pricing invariant, swept across every offer shape', () => {
  it.each(
    ALL_SHAPES
  )('%s — every priceLabel is a pure function of its own priceCents', (_label, offer) => {
    // THE structural guard. If any authored string ever reaches `priceLabel`
    // again, it stops equalling the formatting of the real pence and this
    // fails — regardless of which composition renders it, and regardless of
    // whether anyone remembered to write a test for that composition.
    for (const path of deriveOfferPaths(offer, COURSE, LEGACY_AUTHORED)) {
      expect(path.priceLabel).toBe(formatCleanPrice(path.priceCents));
      expect(Number.isInteger(path.priceCents)).toBe(true);
      expect(path.priceCents).toBeGreaterThan(0);
    }
  });

  it.each(
    ALL_SHAPES
  )('%s — the cadence label follows the KIND, never authored copy', (_label, offer) => {
    const expected = {
      purchase: 'one-off',
      monthly: 'per month',
      annual: 'per year',
    };
    for (const path of deriveOfferPaths(offer, COURSE, LEGACY_AUTHORED)) {
      expect(path.cadenceLabel).toBe(
        path.recurring
          ? expected[path.billingInterval ?? 'monthly']
          : expected.purchase
      );
      // `recurring` and `billingInterval` must agree, because `sticky` renders
      // one path's cadence beside its amount with nothing else to cross-check.
      expect(path.recurring).toBe(path.billingInterval !== undefined);
    }
  });

  it.each(
    ALL_SHAPES
  )('%s — EXACTLY ONE path is recommended whenever any path exists', (_label, offer) => {
    const paths = deriveOfferPaths(offer, COURSE);
    if (paths.length === 0) return;
    // `tiers` and `table` badge this one column; `sticky` renders THIS path in
    // its bar via `paths.find(p => p.best)`. Two badged paths is a broken page
    // and zero would leave the sticky bar falling back silently.
    expect(paths.filter((p) => p.best)).toHaveLength(1);
  });

  it('renders NO path — and therefore no price — when there is nothing to sell', () => {
    // The price-less CTA, at the data layer. This is the live state on four of
    // the seven published pages carrying an invite section, so it is a real
    // runtime branch rather than a defensive one.
    for (const [, offer] of ALL_SHAPES.slice(-2)) {
      expect(deriveOfferPaths(offer, COURSE, LEGACY_AUTHORED)).toEqual([]);
    }
  });

  it('authored copy cannot resurrect a path when the offer read failed', () => {
    // A creator who has authored four decorations still gets an empty list, so
    // every composition falls through to its price-less CTA rather than
    // rendering four cards with no prices in them.
    const authored: SectionProps = {
      offers: [
        { id: 'purchase', name: 'Own it', bullets: ['Yours forever'] },
        {
          id: 'subscription-monthly',
          name: 'Monthly',
          who: 'Just this course',
        },
        { id: 'subscription-annual', name: 'Yearly' },
        { id: `tier:${TIER_ID}`, name: 'Membership', best: true },
      ],
    };
    expect(deriveOfferPaths(null, COURSE, authored)).toEqual([]);
  });
});

describe('`who` and `bullets` — decoration only, and now rendered', () => {
  it('overlays authored `who` and `bullets` without touching a price field', () => {
    const authored: SectionProps = {
      offers: [
        {
          id: 'purchase',
          who: 'For the archivists',
          bullets: ['One payment', 'No renewal'],
          // Every price-shaped key the old authored shape had, all ignored.
          priceLabel: '£3',
          price: '£3 once',
          per: 'once',
          cadenceLabel: 'per fortnight',
          priceCents: 300,
        },
      ],
    } as unknown as SectionProps;

    const purchase = deriveOfferPaths(FULL_OFFER, COURSE, authored)[0];

    expect(purchase.who).toBe('For the archivists');
    expect(purchase.bullets).toEqual(['One payment', 'No renewal']);
    expect(purchase.priceCents).toBe(2499);
    expect(purchase.priceLabel).toBe('£24.99');
    expect(purchase.cadenceLabel).toBe('one-off');
  });

  it('keeps the derived bullets when the authored list is EMPTY, and replaces them when it is not', () => {
    // Pinned because `tiers` and `table` are the first surfaces to render this
    // list, so which of the two wins is now visible to a buyer. An empty
    // repeater must read as "I have not authored these" rather than as "show
    // nothing" — otherwise adding then clearing one bullet blanks the column.
    const empty = deriveOfferPaths(FULL_OFFER, COURSE, {
      offers: [{ id: 'purchase', bullets: [] }],
    } as unknown as SectionProps)[0];
    expect(empty.bullets).toEqual([
      'Yours forever',
      'No subscription',
      'Lifetime access',
    ]);

    const filled = deriveOfferPaths(FULL_OFFER, COURSE, {
      offers: [{ id: 'purchase', bullets: ['Only this'] }],
    } as unknown as SectionProps)[0];
    expect(filled.bullets).toEqual(['Only this']);
  });

  it('falls back to the derived `who` when the authored one is blank', () => {
    // `fieldString` trims and rejects empty, so a creator who clears the field
    // gets the derived micro-label back rather than an empty row in the table.
    const blank = deriveOfferPaths(FULL_OFFER, COURSE, {
      offers: [{ id: 'purchase', who: '   ' }],
    } as unknown as SectionProps)[0];
    expect(blank.who).toBe('Prefer to own, not subscribe');
  });

  it('drops `who` and `bullets` authored against a path the offer does not contain', () => {
    const paths = deriveOfferPaths(
      offerWith({ paths: ['purchase'], subscription: null, tiers: [] }),
      COURSE,
      {
        offers: [
          {
            id: 'subscription-annual',
            who: 'Ghost audience',
            bullets: ['Ghost benefit'],
          },
        ],
      } as unknown as SectionProps
    );
    expect(paths).toHaveLength(1);
    expect(JSON.stringify(paths)).not.toContain('Ghost');
  });

  it('gives every path a bullets ARRAY, so a composition can iterate unguarded', () => {
    for (const [, offer] of ALL_SHAPES) {
      for (const path of deriveOfferPaths(offer, COURSE, LEGACY_AUTHORED)) {
        expect(Array.isArray(path.bullets)).toBe(true);
        for (const bullet of path.bullets) expect(typeof bullet).toBe('string');
      }
    }
  });
});

describe('the sticky bar picks a path that always exists', () => {
  it.each(
    ALL_SHAPES
  )('%s — `find(best) ?? paths[0]` is defined for every non-empty list', (_label, offer) => {
    const paths = deriveOfferPaths(offer, COURSE);
    if (paths.length === 0) return;
    const chosen = paths.find((p) => p.best) ?? paths[0];
    expect(chosen).toBeDefined();
    expect(chosen.priceLabel).toBe(formatCleanPrice(chosen.priceCents));
    // And it deep-links with its OWN id, so the bar's choice survives the nav.
    expect(checkoutUrlForPath('/checkout', chosen.id)).toContain(
      `offer=${encodeURIComponent(chosen.id)}`
    );
  });
});
