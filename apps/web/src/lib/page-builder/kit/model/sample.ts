/**
 * Sample content for previews that have no real page: the dev route, gallery
 * thumbnails and the render tests.
 *
 * Every offer state the pricing and CTA blocks must design for is here, built
 * from the REAL `CourseOffer` shape so the blocks price themselves through the
 * same `deriveOfferPaths` the public page uses — a sample never gets a price
 * by any other route.
 */
import type {
  CourseOffer,
  JourneyCourseView,
  JourneyStageView,
  JourneyTestimonialView,
} from '$lib/page-builder';
import { deriveOfferPaths } from '../../offer-paths';
import type {
  JourneySalesContext,
  PreviewMedia,
  SellPreview,
} from '../../render/types';
import { DEFINITIONS } from './catalog';
import type { PageStyleId, SectionTypeId } from './ids';
import { STYLES } from './styles';
import type { KitPage } from './types';

export const SAMPLE_OFFER_STATES = [
  'buy',
  'sub',
  'tiers',
  'enrolled',
  'unavailable',
  'unknown',
] as const;
export type SampleOfferState = (typeof SAMPLE_OFFER_STATES)[number];

export const SAMPLE_COURSE: JourneyCourseView = {
  id: 'sample-course',
  slug: 'steady-ground',
  title: 'Steady Ground',
  kicker: 'A six-week practice',
  lede: 'A six-week practice for calmer mornings, clearer thinking and a body that feels like home.',
  status: 'published',
  priceCents: 4900,
  stageCount: 6,
  practiceCount: 24,
};

const STAGE_NAMES: readonly [string, string][] = [
  ['Arriving', 'Twenty quiet minutes before the day begins.'],
  ['Breath', 'Slow the breath and the mind follows.'],
  ['Body', 'Gentle movement for stiff mornings.'],
  ['Rhythm', 'Build a routine that survives a busy week.'],
  ['Rest', 'Evenings that actually let you switch off.'],
  ['Home', 'Keep the practice going on your own.'],
];

/**
 * Built on demand, never at module scope: the public renderer is imported
 * through the same barrel, and a module-scope call cannot be tree-shaken out
 * of its bundle.
 */
export function sampleStages(): JourneyStageView[] {
  return STAGE_NAMES.map(([name, gloss], stageIndex) => ({
    id: `sample-stage-${stageIndex + 1}`,
    name,
    gloss,
    sortOrder: stageIndex,
    practices: STAGE_PRACTICES[stageIndex].map(
      ([title, contentType], practiceIndex) => ({
        contentId: `sample-practice-${stageIndex + 1}-${practiceIndex + 1}`,
        slug: null,
        title,
        contentType,
        sortOrder: stageIndex * 4 + practiceIndex,
      })
    ),
  }));
}

type PracticeType = JourneyStageView['practices'][number]['contentType'];

/** Believable practices per stage (one film each) — thumbnails show them. */
const STAGE_PRACTICES: readonly (readonly (readonly [
  string,
  PracticeType,
])[])[] = [
  [
    ['Welcome, and how to use the course', 'video'],
    ['A first quiet twenty minutes', 'audio'],
    ['Setting up your morning corner', 'written'],
    ['The notebook page', 'written'],
  ],
  [
    ['The long exhale', 'video'],
    ['Box breathing for busy heads', 'audio'],
    ['Breath before the phone', 'audio'],
    ['Why slow breathing works', 'written'],
  ],
  [
    ['Waking the spine', 'video'],
    ['Five stretches before coffee', 'video'],
    ['A body scan in bed', 'audio'],
    ['Listening to stiffness', 'written'],
  ],
  [
    ['Anchoring the habit', 'video'],
    ['The two-minute version', 'audio'],
    ['When the week goes wrong', 'written'],
    ['Your rhythm check-in', 'written'],
  ],
  [
    ['Unwinding the day', 'video'],
    ['Evening breath', 'audio'],
    ['A sleep-ready body scan', 'audio'],
    ['Closing the notebook', 'written'],
  ],
  [
    ['Carrying it forward', 'video'],
    ['Your own twenty minutes', 'audio'],
    ['Practising without the course', 'written'],
    ['A letter to week one', 'written'],
  ],
];

const SAMPLE_TESTIMONIALS: JourneyTestimonialView[] = [
  {
    id: 'sample-t1',
    quote:
      'I finally have a morning that is mine. Six weeks in and I have not missed a day.',
    authorName: 'Hannah R.',
    authorContext: 'Teacher, Bristol',
    sortOrder: 0,
  },
  {
    id: 'sample-t2',
    quote: 'Calm, clear and never preachy. The breath work alone was worth it.',
    authorName: 'Dev P.',
    authorContext: 'Autumn group',
    sortOrder: 1,
  },
  {
    id: 'sample-t3',
    quote:
      'The first course I have finished. The short practices make it easy to keep going.',
    authorName: 'Sam O.',
    authorContext: 'Parent of two',
    sortOrder: 2,
  },
];

function offer(fields: Partial<CourseOffer>): CourseOffer {
  return {
    courseId: SAMPLE_COURSE.id,
    organizationId: 'sample-org',
    paths: [],
    purchase: null,
    subscription: null,
    tiers: [],
    entitled: false,
    ...fields,
  };
}

/** `null` is a FAILED offer read, distinct from an offer with no paths. */
export function sampleOffer(state: SampleOfferState): CourseOffer | null {
  switch (state) {
    case 'buy':
      return offer({ paths: ['purchase'], purchase: { priceCents: 4900 } });
    case 'sub':
      return offer({
        paths: ['subscription'],
        subscription: {
          planId: 'sample-plan',
          priceMonthly: 1200,
          priceAnnual: 12000,
        },
      });
    case 'tiers':
      return offer({
        paths: ['purchase', 'tier'],
        purchase: { priceCents: 4900 },
        tiers: [
          {
            tierId: 'studio',
            tierName: 'Studio membership',
            priceMonthly: 1500,
            priceAnnual: 15000,
          },
          {
            tierId: 'circle',
            tierName: 'Inner circle',
            priceMonthly: 3500,
            priceAnnual: 35000,
          },
        ],
      });
    case 'enrolled':
      return offer({
        paths: ['purchase'],
        purchase: { priceCents: 4900 },
        entitled: true,
      });
    case 'unavailable':
      return offer({});
    case 'unknown':
      return null;
  }
}

export interface SampleMedia {
  heroImageUrl?: string | null;
  heroClip?: PreviewMedia | null;
  guidePortraitUrl?: string | null;
  intro?: PreviewMedia | null;
  reel?: PreviewMedia | null;
}

export interface SampleContextOptions {
  offer?: SampleOfferState;
  media?: SampleMedia;
  course?: Partial<JourneyCourseView>;
  /**
   * The page-image CDN base (contract A3), for previewing a block that calls
   * `resolvePageImageUrl`. Null (the default) renders every page-image
   * block's designed empty state — the same as a real page with no
   * configured `R2_PUBLIC_URL_BASE`.
   */
  mediaBaseUrl?: string | null;
}

export function sampleContext(
  options: SampleContextOptions = {}
): JourneySalesContext {
  const state = options.offer ?? 'buy';
  const course = { ...SAMPLE_COURSE, ...options.course };
  const courseOffer = sampleOffer(state);
  const media = options.media ?? {};
  const preview: SellPreview = {
    intro: media.intro ?? null,
    reel: media.reel ?? null,
    heroImageUrl: media.heroImageUrl ?? null,
    heroClip: media.heroClip ?? null,
    guidePortraitUrl: media.guidePortraitUrl ?? null,
  };
  return {
    course,
    stages: sampleStages(),
    testimonials: SAMPLE_TESTIMONIALS.map((testimonial) => ({
      ...testimonial,
    })),
    checkoutUrl: `/journeys/${course.slug}/checkout`,
    dashboardUrl: `/journeys/${course.slug}/dashboard`,
    enrolled: state === 'enrolled',
    offer: courseOffer,
    // Derived exactly as the public renderer derives it: a failed read is TRUE.
    purchasable:
      courseOffer === null
        ? true
        : deriveOfferPaths(courseOffer, course).length > 0,
    sellPreview: Promise.resolve(preview),
    mediaBaseUrl: options.mediaBaseUrl ?? null,
  };
}

/** A page of every type (or `types`), in the Style's order, with sample copy. */
export function samplePage(
  style: PageStyleId,
  types: readonly SectionTypeId[] = STYLES[style].order
): KitPage {
  return {
    design: { style },
    sections: types.map((type) => ({
      id: `sample-${type}`,
      type,
      enabled: true,
      props: { ...DEFINITIONS[type].sample },
    })),
  };
}
