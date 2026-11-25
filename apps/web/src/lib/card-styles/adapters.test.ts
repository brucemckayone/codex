/**
 * The adapters: every fact Today's ContentCard and JourneyEntryCard show
 * lands in a slot of the card styles' one card (Codex-7104r, WP2), in the
 * same words. One case per Today feature.
 */
import { describe, expect, test } from 'vitest';
import {
  courseSummaryEntry,
  enrolledCoursePortalStripEntry,
  enrolledCourseRowEntry,
  journeyViewEntry,
} from '$lib/components/journeys/journey-entry-card';
import type {
  CourseCardSummary,
  EnrolledCourseSummary,
} from '$lib/journeys/types';
import type { JourneyCardView } from '$lib/page-builder';
import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import {
  type ContentCardInput,
  contentAccessAction,
  contentToCard,
  journeyToCard,
} from './adapters';

const SIZED =
  'http://localhost:4100/org/content-thumbnails/c1/1385x1846-bc84c352/lg.webp';
const UNSIZED = 'http://localhost:4100/org/content-thumbnails/c1/lg.webp';

function content(overrides: Partial<ContentCardInput> = {}): ContentCardInput {
  return {
    title: 'Morning breath',
    href: '/content/morning-breath',
    contentType: 'video',
    ...overrides,
  };
}

describe('contentToCard: the slot', () => {
  test.each([
    [{ variant: 'grid' }, 'tile'],
    [{ variant: 'featured' }, 'featured'],
    [{ variant: 'resume' }, 'row'],
    [{ variant: 'compact' }, 'row'],
    [{ variant: 'grid', layout: 'row' }, 'row'],
    [{ variant: 'grid', autoPromoteAudio: true, contentType: 'audio' }, 'row'],
    [{ variant: 'grid', autoPromoteAudio: true, contentType: 'video' }, 'tile'],
  ] as [
    Partial<ContentCardInput>,
    string,
  ][])('%o draws a %s', (props, layout) => {
    expect(contentToCard(content(props)).layout).toBe(layout);
  });

  test('the kind is the content type; the link is the card', () => {
    const card = contentToCard(content({ contentType: 'audio' }));
    expect(card.kind).toBe('audio');
    expect(card.title).toBe('Morning breath');
    expect(card.action).toEqual({ href: '/content/morning-breath' });
  });
});

describe('contentToCard: price and access', () => {
  test('a price: the badge and the foot, coloured paid', () => {
    const card = contentToCard(
      content({
        price: { amount: 1000, currency: 'GBP' },
        contentAccessType: 'paid',
      })
    );
    expect(card.badge).toEqual({ label: formatPrice(1000) });
    expect(card.price).toBe(formatPrice(1000));
    expect(card.access).toBe('paid');
    expect(card.owned).toBe(false);
  });

  test('bought: the badge says so and the foot drops the price', () => {
    const card = contentToCard(
      content({ price: { amount: 1000, currency: 'GBP' }, purchased: true })
    );
    expect(card.badge).toEqual({ label: m.content_price_purchased() });
    expect(card.price).toBeNull();
    expect(card.owned).toBe(true);
  });

  test('on a plan the viewer has: included', () => {
    const card = contentToCard(
      content({ contentAccessType: 'subscribers', included: true })
    );
    expect(card.badge).toEqual({ label: m.content_price_included() });
    expect(card.owned).toBe(true);
    expect(card.access).toBe('members');
  });

  test('followers content the viewer follows is owned', () => {
    const card = contentToCard(
      content({ contentAccessType: 'followers', isFollower: true })
    );
    expect(card.owned).toBe(true);
    expect(card.access).toBe('followers');
  });

  test('bought outright OR on a plan: the foot names both', () => {
    const card = contentToCard(
      content({
        price: { amount: 1000, currency: 'GBP' },
        contentAccessType: 'paid',
        tierName: 'Basic and above',
      })
    );
    expect(card.price).toBe(
      m.card_price_or_plan({
        price: formatPrice(1000),
        plan: 'Basic and above',
      })
    );
  });

  test.each([
    ['free', 'free'],
    ['team', 'members'],
    ['subscribers', 'members'],
  ] as const)('access type %s is coloured %s', (accessType, access) => {
    expect(
      contentToCard(content({ contentAccessType: accessType })).access
    ).toBe(access);
  });

  test('no access type: a zero price is free, any other paid, none unset', () => {
    expect(
      contentToCard(content({ price: { amount: 0, currency: 'GBP' } })).access
    ).toBe('free');
    expect(
      contentToCard(content({ price: { amount: 500, currency: 'GBP' } })).access
    ).toBe('paid');
    expect(contentToCard(content()).access).toBeUndefined();
  });

  test('compact and resume cards carry no price, as Today hides its badge', () => {
    for (const variant of ['compact', 'resume'] as const) {
      const card = contentToCard(
        content({ variant, price: { amount: 1000, currency: 'GBP' } })
      );
      expect(card.badge).toBeNull();
      expect(card.price).toBeNull();
    }
  });
});

describe('contentToCard: featured', () => {
  test('a featured grid tile wears the Featured chip; its price moves to the foot', () => {
    const card = contentToCard(
      content({ featured: true, price: { amount: 1000, currency: 'GBP' } })
    );
    expect(card.badge).toEqual({ label: m.content_featured_label() });
    expect(card.price).toBe(formatPrice(1000));
  });

  test('not on the hero, a row or a resume card', () => {
    for (const props of [
      { variant: 'featured' },
      { variant: 'resume' },
      { layout: 'row' },
    ] as Partial<ContentCardInput>[]) {
      expect(
        contentToCard(content({ featured: true, ...props })).badge
      ).toBeNull();
    }
  });
});

describe('contentToCard: access state', () => {
  test('revoked: paused, with the reason and the way back', () => {
    const props = content({
      accessState: 'revoked',
      price: { amount: 1000, currency: 'GBP' },
      featured: true,
    });
    const card = contentToCard(props);
    expect(card.dimmed).toBe(true);
    expect(card.badge).toEqual({ label: m.card_badge_paused(), paused: true });
    expect(card.note).toBe(m.card_note_subscription_ended());
    expect(contentAccessAction(props)).toEqual({
      href: '/account/subscriptions',
      label: m.card_access_reactivate(),
    });
    expect(
      contentAccessAction({
        ...props,
        accessStateActionHref: '/account/billing',
      })?.href
    ).toBe('/account/billing');
  });

  test('disputed: paused, and its control opens the card own page, which explains', () => {
    const props = content({ accessState: 'disputed' });
    const card = contentToCard(props);
    expect(card.dimmed).toBe(true);
    expect(card.note).toBe(m.card_note_payment_dispute());
    expect(contentAccessAction(props)).toEqual({
      href: '/content/morning-breath',
      label: m.card_access_details(),
    });
  });

  test('past due: a note, still open, no control', () => {
    const props = content({ accessState: 'past_due' });
    const card = contentToCard(props);
    expect(card.dimmed).toBe(false);
    expect(card.note).toBe(m.library_access_payment_failed());
    expect(contentAccessAction(props)).toBeUndefined();
  });

  test('cancelling: the end date, when there is a valid one', () => {
    const end = '2026-12-12T00:00:00.000Z';
    const date = new Date(end).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
    expect(
      contentToCard(
        content({ accessState: 'cancelling', accessStatePeriodEnd: end })
      ).note
    ).toBe(m.library_access_ends_on({ date }));
    expect(
      contentToCard(
        content({ accessState: 'cancelling', accessStatePeriodEnd: 'soon' })
      ).note
    ).toBeNull();
    expect(contentToCard(content({ accessState: 'active' })).note).toBeNull();
  });
});

describe('contentToCard: progress and resume', () => {
  test('a started grid card: a bar and no status', () => {
    const card = contentToCard(
      content({ progress: { positionSeconds: 30, durationSeconds: 120 } })
    );
    expect(card.progress).toEqual({ percent: 25, label: undefined });
    expect(card.cta).toBe(m.card_cta_watch());
  });

  test('completed reads 100', () => {
    expect(
      contentToCard(content({ progress: { completed: true } })).progress
        ?.percent
    ).toBe(100);
  });

  test('unstarted: no track', () => {
    expect(
      contentToCard(content({ progress: { positionSeconds: 0 } })).progress
    ).toBeNull();
  });

  test.each([
    [
      'video',
      () => m.library_resume_from({ time: '1:23' }),
      () => m.library_resume(),
    ],
    [
      'audio',
      () => m.library_resume_listen_from({ time: '1:23' }),
      () => m.library_resume_listening(),
    ],
  ] as const)('a %s resume card: the resume line is the status, the verb the CTA', (type, status, cta) => {
    const card = contentToCard(
      content({
        variant: 'resume',
        contentType: type,
        progress: { positionSeconds: 83, durationSeconds: 166 },
      })
    );
    expect(card.progress?.label).toBe(status());
    expect(card.cta).toBe(cta());
  });

  test('an article resume card reads from a percent', () => {
    const card = contentToCard(
      content({
        variant: 'resume',
        contentType: 'article',
        progress: { percentComplete: 40 },
      })
    );
    expect(card.progress?.label).toBe(
      m.library_resume_read_from({ percent: '40' })
    );
    expect(card.cta).toBe(m.library_resume_reading());
  });
});

describe('contentToCard: words', () => {
  test('the kicker is the type word, with the category when there is one', () => {
    expect(contentToCard(content()).kicker).toBe(m.content_type_video());
    expect(contentToCard(content({ category: 'Breathwork' })).kicker).toBe(
      m.card_kicker_category({
        kind: m.content_type_video(),
        category: 'Breathwork',
      })
    );
  });

  test.each([
    ['video', () => m.card_cta_watch()],
    ['audio', () => m.card_cta_listen()],
    ['article', () => m.card_cta_read()],
  ] as const)('a %s card has its own verb', (type, cta) => {
    expect(contentToCard(content({ contentType: type })).cta).toBe(cta());
  });

  test('the description, as plain text, where Today shows it', () => {
    // A TipTap document, as content descriptions are stored.
    const description = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Slow down.' }],
        },
      ],
    });
    expect(contentToCard(content({ description })).desc).toBe('Slow down.');
    expect(
      contentToCard(content({ description, variant: 'compact' })).desc
    ).toBeNull();
    expect(
      contentToCard(
        content({ description, variant: 'compact', contentType: 'article' })
      ).desc
    ).toBe('Slow down.');
  });

  test('duration, read time and creator are meta; the creator is plain text', () => {
    const video = contentToCard(
      content({
        duration: 300,
        creator: { username: 'luz', displayName: 'Luzura' },
      })
    );
    expect(video.meta).toEqual([
      { key: 'duration', text: '5m' },
      { key: 'creator', text: 'Luzura' },
    ]);
    const article = contentToCard(
      content({
        contentType: 'article',
        duration: 360,
        creator: { username: 'luz' },
      })
    );
    expect(article.meta).toEqual([
      { key: 'read', text: m.card_meta_read_minutes({ minutes: 6 }) },
      { key: 'creator', text: 'luz' },
    ]);
    expect(
      contentToCard(content({ contentType: 'article', duration: 3600 })).meta
    ).toEqual([{ key: 'read', text: m.card_meta_read_hours({ hours: 1 }) }]);
    expect(
      contentToCard(content({ contentType: 'article', duration: 4200 })).meta
    ).toEqual([
      {
        key: 'read',
        text: m.card_meta_read_hours_minutes({ hours: 1, minutes: 10 }),
      },
    ]);
  });

  test('a resume card drops the duration, as Today does', () => {
    expect(
      contentToCard(content({ variant: 'resume', duration: 300 })).meta
    ).toEqual([]);
  });
});

describe('contentToCard: image', () => {
  test('a picture that records its size gives its ratio, srcset and the card width', () => {
    const card = contentToCard(content({ thumbnail: SIZED, sizes: '20rem' }));
    expect(card.image?.src).toBe(SIZED);
    expect(card.image?.ratio).toBe('1385 / 1846');
    expect(card.image?.srcset).toContain('sm.webp');
    expect(card.image?.sizes).toBe('20rem');
  });

  test('one that does not: no ratio (the style cover ratio applies)', () => {
    expect(
      contentToCard(content({ thumbnail: UNSIZED })).image?.ratio
    ).toBeUndefined();
  });

  test('no picture: no image', () => {
    expect(contentToCard(content({ thumbnail: null })).image).toBeNull();
  });
});

// ── JourneyEntryCard ────────────────────────────────────────────────────

function view(overrides: Partial<JourneyCardView> = {}): JourneyCardView {
  return {
    pageId: '11111111-1111-4111-8111-111111111111',
    slug: 'stillness',
    title: 'The Practice of Stillness',
    kicker: 'Foundation course',
    tagline: 'Eight weeks of sitting, slowly.',
    courseId: '22222222-2222-4222-8222-222222222222',
    courseSlug: 'stillness-course',
    priceCents: 4800,
    stageCount: 4,
    practiceCount: 24,
    featured: false,
    coverImageUrl: null,
    ...overrides,
  };
}

function enrolled(
  overrides: Partial<EnrolledCourseSummary['progress']> = {}
): EnrolledCourseSummary {
  return {
    course: {
      id: 'c-1',
      slug: 'rootwork',
      title: 'Rootwork',
      organizationSlug: 'of-blood-and-bones',
      kicker: null,
      lede: 'Bone, breath and smoke.',
      guideName: 'Luzura',
      coverImageUrl: SIZED,
    },
    enrollment: {
      courseId: 'c-1',
      enrolledAt: '2026-07-01T00:00:00.000Z',
      lastActivityAt: null,
      completedAt: null,
    },
    enrollmentSource: 'course_purchase',
    progress: {
      done: 5,
      total: 11,
      percent: 45,
      status: 'in-progress',
      lastCompletedAt: null,
      nextPracticeSlug: 'threshold-breath',
      nextPracticeTitle: 'The Threshold Breath',
      ...overrides,
    },
    disputeHold: null,
  };
}

describe('journeyToCard: a portal to discover', () => {
  test('the type word kicks it, the tagline describes it, its curriculum is meta', () => {
    const card = journeyToCard(journeyViewEntry(view(), '/journeys/stillness'));
    expect(card.kind).toBe('portal');
    expect(card.layout).toBe('tile');
    expect(card.kicker).toBe(m.card_kind_portal());
    expect(card.desc).toBe('Eight weeks of sitting, slowly.');
    expect(card.meta).toEqual([
      { key: 'stages', text: m.card_meta_stages({ count: 4 }) },
      { key: 'practices', text: m.card_meta_practices({ count: 24 }) },
    ]);
    expect(card.action).toEqual({ href: '/journeys/stillness' });
    expect(card.cta).toBe('View portal');
  });

  test('singular counts', () => {
    const card = journeyToCard(
      journeyViewEntry(view({ stageCount: 1, practiceCount: 1 }), '/j')
    );
    expect(card.meta?.map((item) => item.text)).toEqual([
      m.card_meta_stages_one({ count: 1 }),
      m.card_meta_practices_one({ count: 1 }),
    ]);
  });

  test('un-started: its stages are a decorative preview track', () => {
    const card = journeyToCard(journeyViewEntry(view(), '/j'));
    expect(card.preview).toEqual({ stages: 4 });
    expect(card.progress).toBeNull();
  });

  test('a price: badge and foot, coloured paid', () => {
    const card = journeyToCard(journeyViewEntry(view(), '/j'));
    expect(card.badge).toEqual({ label: formatPrice(4800) });
    expect(card.price).toBe(formatPrice(4800));
    expect(card.access).toBe('paid');
    expect(card.owned).toBe(false);
  });

  test('no price: the membership line, coloured members', () => {
    const card = journeyToCard(
      journeyViewEntry(view({ priceCents: null }), '/j')
    );
    expect(card.price).toBe('Membership');
    expect(card.badge).toEqual({ label: 'Membership' });
    expect(card.access).toBe('members');
  });

  test('the explore rail: the guide is the creator, free when unpriced', () => {
    const summary: CourseCardSummary = {
      id: 'c-2',
      slug: 'rootwork',
      title: 'Rootwork',
      kicker: null,
      lede: 'Bone, breath and smoke.',
      guideName: 'Luzura',
      priceCents: null,
      pageId: null,
      pageSlug: null,
      coverImageUrl: null,
    };
    const card = journeyToCard(
      courseSummaryEntry(summary, '/journeys/rootwork')
    );
    expect(card.meta).toEqual([{ key: 'creator', text: 'Luzura' }]);
    expect(card.access).toBe('free');
    expect(card.price).toBe('Free');
    expect(card.desc).toBe('Bone, breath and smoke.');
  });

  test('an editorial kicker stands in for a missing tagline', () => {
    const card = journeyToCard(journeyViewEntry(view({ tagline: null }), '/j'));
    expect(card.kicker).toBe(m.card_kind_portal());
    expect(card.desc).toBe('Foundation course');
  });
});

describe('journeyToCard: an enrolled portal', () => {
  test('a tile with progress: a segment per practice, the status, no price', () => {
    const card = journeyToCard(
      journeyViewEntry(view(), '/j', {
        percent: 45,
        status: 'in-progress',
        completedPractices: 5,
        totalPractices: 11,
      })
    );
    expect(card.owned).toBe(true);
    expect(card.price).toBeNull();
    expect(card.badge).toBeNull();
    expect(card.preview).toBeNull();
    expect(card.progress).toEqual({
      percent: 45,
      done: 5,
      total: 11,
      label: '5 of 11 practices',
    });
    expect(card.cta).toBe('Continue');
  });

  test('the library strip: a row, its next practice, its access chip', () => {
    const card = journeyToCard(
      enrolledCoursePortalStripEntry(
        enrolled(),
        '/journeys/rootwork/dashboard',
        {
          accessLabel: 'Purchased',
        }
      )
    );
    expect(card.layout).toBe('row');
    expect(card.meta).toEqual([
      {
        key: 'next',
        text: m.card_meta_next({ title: 'The Threshold Breath' }),
      },
    ]);
    expect(card.badge).toEqual({ label: 'Purchased' });
    expect(card.image?.ratio).toBe('1385 / 1846');
    expect(card.image?.srcset).toContain('sm.webp');
    expect(card.progress).toMatchObject({ done: 5, total: 11 });
  });

  test('every slot declares how wide its picture is drawn (a srcset needs its sizes)', () => {
    const cover = { coverImageUrl: SIZED, href: '/j', title: 'Rootwork' };
    const sizes = [
      journeyToCard({ ...cover, layout: 'tile' }),
      journeyToCard({ ...cover, layout: 'row' }),
      journeyToCard({ ...cover, layout: 'row', featured: true }),
    ].map((card) => card.image?.sizes);
    for (const value of sizes) expect(value).toMatch(/rem/);
    expect(new Set(sizes).size).toBe(3);
  });

  test('paused by a dispute: the Paused chip, and the access label is the reason', () => {
    const card = journeyToCard(
      enrolledCourseRowEntry(enrolled(), '/j', {
        accessLabel: m.access_paused_dispute_label(),
        dimmed: true,
      })
    );
    expect(card.dimmed).toBe(true);
    expect(card.badge).toEqual({ label: m.card_badge_paused(), paused: true });
    expect(card.note).toBe(m.access_paused_dispute_label());
  });

  test('a row with no next practice keeps Today meta line', () => {
    const card = journeyToCard(
      enrolledCourseRowEntry(enrolled({ nextPracticeTitle: null }), '/j')
    );
    expect(card.meta).toEqual([{ key: 'position', text: 'Next · Continue' }]);
  });

  test('the dashboard threshold (a featured row) is the featured card', () => {
    const card = journeyToCard({
      href: '/j/practice',
      title: 'The Threshold Breath',
      kicker: 'Continue where you left off',
      meta: 'Stage II · Descent · Video · 5 min',
      layout: 'row',
      featured: true,
      cta: 'Resume',
      progress: { percent: 45, label: null },
    });
    expect(card.layout).toBe('featured');
    expect(card.kind).toBe('portal');
    expect(card.desc).toBe('Continue where you left off');
    expect(card.meta).toEqual([
      { key: 'position', text: 'Stage II · Descent · Video · 5 min' },
    ]);
    expect(card.progress).toEqual({
      percent: 45,
      done: undefined,
      total: undefined,
      label: undefined,
    });
    expect(card.owned).toBe(true);
  });
});

describe('journeyToCard: a standalone practice in the resume rail', () => {
  test('its type-label kicker names the kind; the position is meta', () => {
    const card = journeyToCard({
      href: '/content/morning-breath',
      title: 'Morning breath',
      kicker: 'video',
      meta: '1:23 of 4:56',
      layout: 'row',
      cta: 'Resume',
      progress: { percent: 28, label: null },
    });
    expect(card.kind).toBe('video');
    expect(card.kicker).toBe(m.content_type_video());
    expect(card.desc).toBeNull();
    expect(card.meta).toEqual([{ key: 'position', text: '1:23 of 4:56' }]);
    expect(card.preview).toBeNull();
  });

  test('a percent that is not a number reads 0, never NaN', () => {
    const card = journeyToCard({
      href: '/x',
      title: 'X',
      progress: { percent: Number.NaN, label: null },
    });
    expect(card.progress?.percent).toBe(0);
  });
});
