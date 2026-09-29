/**
 * `buildPublicContext` — the public sales-page render-context builder
 * (Codex-61zsk.6 · WP-6).
 *
 * What matters here is exactly what mattered in `JourneyRenderer.svelte`
 * before this moved out of it (same semantics, new home):
 *   - `checkoutUrl` keys off the PAGE, `dashboardUrl` off the COURSE — two
 *     independently-authored slugs that only accidentally agree today.
 *   - `purchasable` is a CONFIDENT NEGATIVE ONLY: a failed offer read
 *     (`null`) must never remove the buy button.
 *   - `enrolled` / `mediaBaseUrl` are the caller's answer, passed straight
 *     through — this function does not re-derive either.
 */
import { describe, expect, it } from 'vitest';
import type { CourseOffer, JourneyCoursePage } from '$lib/page-builder';
import { isEnrolled } from './kit/model/cta';
import { buildPublicContext, offerAsVisitor } from './public-context';

const URL_ = new URL('http://acme.lvh.me:3000/journeys/rootwork');

function coursePage(
  overrides: Partial<{
    pageSlug: string;
    pageId: string;
    courseSlug: string;
    courseId: string;
  }> = {}
): JourneyCoursePage {
  const pageSlug = overrides.pageSlug ?? 'rootwork';
  const pageId = overrides.pageId ?? 'page-1';
  const courseSlug = overrides.courseSlug ?? 'rootwork';
  const courseId = overrides.courseId ?? 'course-1';

  return {
    page: {
      id: pageId,
      organizationId: 'org-1',
      publishedAt: null,
      pageType: 'course',
      slug: pageSlug,
      title: 'Rootwork',
      status: 'published',
      subjectType: 'course',
      subjectId: courseId,
      brandOverrides: null,
      sections: [],
    },
    course: {
      id: courseId,
      slug: courseSlug,
      title: 'Rootwork',
      kicker: null,
      lede: null,
      status: 'published',
      priceCents: 4900,
      stageCount: 6,
      practiceCount: 24,
    },
    stages: [],
    testimonials: [],
  };
}

function offer(fields: Partial<CourseOffer> = {}): CourseOffer {
  return {
    courseId: 'course-1',
    organizationId: 'org-1',
    paths: [],
    purchase: null,
    subscription: null,
    tiers: [],
    entitled: false,
    ...fields,
  };
}

const SELL_PREVIEW = Promise.resolve(null);

describe('buildPublicContext — checkout vs dashboard key-spaces', () => {
  it('builds checkoutUrl from the PAGE slug, not the course slug', () => {
    const context = buildPublicContext({
      coursePage: coursePage({
        pageSlug: 'page-slug',
        courseSlug: 'course-slug',
      }),
      sellPreview: SELL_PREVIEW,
      enrolled: false,
      offer: null,
      mediaBaseUrl: null,
      url: URL_,
    });

    expect(context.checkoutUrl).toBe('/journeys/page-slug/checkout');
  });

  it('builds dashboardUrl from the COURSE slug, not the page slug', () => {
    const context = buildPublicContext({
      coursePage: coursePage({
        pageSlug: 'page-slug',
        courseSlug: 'course-slug',
      }),
      sellPreview: SELL_PREVIEW,
      enrolled: false,
      offer: null,
      mediaBaseUrl: null,
      url: URL_,
    });

    expect(context.dashboardUrl).toBe('/journeys/course-slug/dashboard');
  });

  it('falls back to the id when a slug is absent from its own key-space', () => {
    // `courses.slug` is `.notNull()` in production (see `public-context.ts`'s
    // own header on the sibling fallback this mirrors), but the DTO is not
    // narrowed at this boundary — built by hand rather than through the
    // `coursePage()` helper, whose `??` defaulting cannot express "explicitly
    // absent" for this one case.
    const page = coursePage({ courseId: 'course-9' });
    page.course.slug = null as unknown as string;

    const context = buildPublicContext({
      coursePage: page,
      sellPreview: SELL_PREVIEW,
      enrolled: false,
      offer: null,
      mediaBaseUrl: null,
      url: URL_,
    });

    expect(context.dashboardUrl).toBe('/journeys/course-9/dashboard');
  });
});

describe('buildPublicContext — purchasable is a confident negative only', () => {
  it('is true when the offer read failed (null)', () => {
    const context = buildPublicContext({
      coursePage: coursePage(),
      sellPreview: SELL_PREVIEW,
      enrolled: false,
      offer: null,
      mediaBaseUrl: null,
      url: URL_,
    });

    expect(context.purchasable).toBe(true);
  });

  it('is true when the offer has at least one real path', () => {
    const context = buildPublicContext({
      coursePage: coursePage(),
      sellPreview: SELL_PREVIEW,
      enrolled: false,
      offer: offer({ paths: ['purchase'], purchase: { priceCents: 4900 } }),
      mediaBaseUrl: null,
      url: URL_,
    });

    expect(context.purchasable).toBe(true);
  });

  it('is false when the offer resolved with no available path', () => {
    const context = buildPublicContext({
      coursePage: coursePage(),
      sellPreview: SELL_PREVIEW,
      enrolled: false,
      offer: offer(),
      mediaBaseUrl: null,
      url: URL_,
    });

    expect(context.purchasable).toBe(false);
  });
});

describe('buildPublicContext — passthrough fields', () => {
  it('passes enrolled straight through', () => {
    const context = buildPublicContext({
      coursePage: coursePage(),
      sellPreview: SELL_PREVIEW,
      enrolled: true,
      offer: null,
      mediaBaseUrl: null,
      url: URL_,
    });

    expect(context.enrolled).toBe(true);
  });

  it('passes mediaBaseUrl straight through, including null', () => {
    const withBase = buildPublicContext({
      coursePage: coursePage(),
      sellPreview: SELL_PREVIEW,
      enrolled: false,
      offer: null,
      mediaBaseUrl: 'https://cdn.example.test',
      url: URL_,
    });
    const withoutBase = buildPublicContext({
      coursePage: coursePage(),
      sellPreview: SELL_PREVIEW,
      enrolled: false,
      offer: null,
      mediaBaseUrl: null,
      url: URL_,
    });

    expect(withBase.mediaBaseUrl).toBe('https://cdn.example.test');
    expect(withoutBase.mediaBaseUrl).toBeNull();
  });

  it('passes course/stages/testimonials/sellPreview straight through', () => {
    const page = coursePage();
    const context = buildPublicContext({
      coursePage: page,
      sellPreview: SELL_PREVIEW,
      enrolled: false,
      offer: null,
      mediaBaseUrl: null,
      url: URL_,
    });

    expect(context.course).toBe(page.course);
    expect(context.stages).toBe(page.stages);
    expect(context.testimonials).toBe(page.testimonials);
    expect(context.sellPreview).toBe(SELL_PREVIEW);
  });
});

describe('offerAsVisitor — the ?preview override reaches the offer too', () => {
  function contextFor(previewOffer: CourseOffer | null) {
    return buildPublicContext({
      coursePage: coursePage(),
      sellPreview: SELL_PREVIEW,
      enrolled: false,
      offer: previewOffer,
      mediaBaseUrl: null,
      url: URL_,
    });
  }

  it('shows an entitled creator the buy state, not the member state', () => {
    const entitled = offer({ entitled: true });

    // The bug: clearing the flag alone is not enough, because the kit also
    // reads the offer's own entitlement.
    expect(isEnrolled(contextFor(entitled))).toBe(true);
    expect(isEnrolled(contextFor(offerAsVisitor(entitled)))).toBe(false);
  });

  it('leaves the rest of the offer alone, and a failed read null', () => {
    const entitled = offer({ entitled: true, courseId: 'course-9' });
    expect(offerAsVisitor(entitled)).toEqual({ ...entitled, entitled: false });
    expect(offerAsVisitor(null)).toBeNull();
  });
});
