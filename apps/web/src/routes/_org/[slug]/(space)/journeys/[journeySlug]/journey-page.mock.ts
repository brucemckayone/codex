/**
 * AGGRESSIVE-MODE mock for the public journey sales page (Codex-2pryk.3.1 · WP-3).
 *
 * WP-3 (FE) is built concurrently with the BE spine (WP-1 schema / WP-2 resolver)
 * against the FROZEN WP-0 contracts. Until the real remote functions exist, this
 * module returns contract-shaped fixtures so the renderer + shell/stream load can
 * be built and visually verified now. It is the ONLY fixture source; the seam
 * that swaps it for the real remote functions is `journey-data.ts`.
 *
 * Copy + structure are grounded in the prototype
 * (`docs/design/course-journeys/prototype/course-sell.html` + `course-data.js`)
 * so the mock exercises every section with realistic content. Currency GBP.
 *
 * DELETE-ON-INTEGRATION: once `journey-data.ts` points at the real
 * `$lib/remote/journeys.remote.ts`, this file (and its import) should be removed.
 */
import type {
  JourneyCoursePage,
  JourneyStageView,
  JourneyTestimonialView,
} from '$lib/page-builder';
import type { SellPreview } from '$lib/page-builder/render';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const COURSE_ID = '00000000-0000-4000-8000-0000000000c0';
const PAGE_ID = '00000000-0000-4000-8000-0000000000a0';

const STAGES: JourneyStageView[] = [
  {
    id: 'stage-1',
    name: 'Regulation',
    gloss: 'Finding the ground. Teaching the body it is safe enough to soften.',
    sortOrder: 0,
    practices: [
      {
        contentId: 'p-1',
        slug: 'orienting',
        title: 'Orienting',
        contentType: 'video',
        sortOrder: 0,
      },
      {
        contentId: 'p-2',
        slug: 'long-exhale',
        title: 'The long exhale',
        contentType: 'audio',
        sortOrder: 1,
      },
      {
        contentId: 'p-3',
        slug: 'feet-earth',
        title: 'Feet on the earth',
        contentType: 'video',
        sortOrder: 2,
      },
    ],
  },
  {
    id: 'stage-2',
    name: 'Embodiment',
    gloss: 'Coming back into sensation — feeling what is actually here.',
    sortOrder: 1,
    practices: [
      {
        contentId: 'p-4',
        slug: 'body-scan',
        title: 'Body scan',
        contentType: 'video',
        sortOrder: 0,
      },
      {
        contentId: 'p-5',
        slug: 'holding',
        title: 'Where am I holding?',
        contentType: 'written',
        sortOrder: 1,
      },
      {
        contentId: 'p-6',
        slug: 'weight-support',
        title: 'Weight & support',
        contentType: 'video',
        sortOrder: 2,
      },
    ],
  },
  {
    id: 'stage-3',
    name: 'Attunement',
    gloss: 'Listening inward; letting need and impulse be known.',
    sortOrder: 2,
    practices: [
      {
        contentId: 'p-7',
        slug: 'felt-sense',
        title: 'The felt sense',
        contentType: 'audio',
        sortOrder: 0,
      },
      {
        contentId: 'p-8',
        slug: 'naming-need',
        title: 'Naming need',
        contentType: 'written',
        sortOrder: 1,
      },
      {
        contentId: 'p-9',
        slug: 'small-yes',
        title: 'Small yes, small no',
        contentType: 'video',
        sortOrder: 2,
      },
    ],
  },
  {
    id: 'stage-4',
    name: 'Co-regulation',
    gloss: 'Being met by another. The body settling in company.',
    sortOrder: 3,
    practices: [
      {
        contentId: 'p-10',
        slug: 'safe-eyes',
        title: 'Safe eyes',
        contentType: 'video',
        sortOrder: 0,
      },
      {
        contentId: 'p-11',
        slug: 'borrowing-calm',
        title: 'Borrowing calm',
        contentType: 'audio',
        sortOrder: 1,
      },
    ],
  },
  {
    id: 'stage-5',
    name: 'Reclamation',
    gloss: 'Living from wholeness — taking back what was held away.',
    sortOrder: 4,
    practices: [
      {
        contentId: 'p-12',
        slug: 'standing-in-it',
        title: 'Standing in it',
        contentType: 'video',
        sortOrder: 0,
      },
      {
        contentId: 'p-13',
        slug: 'mine-to-keep',
        title: 'What is mine to keep',
        contentType: 'written',
        sortOrder: 1,
      },
      {
        contentId: 'p-14',
        slug: 'closing-circle',
        title: 'Closing the circle',
        contentType: 'audio',
        sortOrder: 2,
      },
    ],
  },
];

const TESTIMONIALS: JourneyTestimonialView[] = [
  {
    id: 't-1',
    quote:
      'I stopped bracing for the first time in years. My shoulders came down and stayed down.',
    authorName: 'Wren',
    authorContext: 'Three months in',
    sortOrder: 0,
  },
  {
    id: 't-2',
    quote:
      'It never once felt clinical. It felt like being taught to come home.',
    authorName: 'Mara',
    authorContext: 'Completed Rootwork',
    sortOrder: 1,
  },
  {
    id: 't-3',
    quote:
      'The short practices are the whole point. Ten minutes I could actually keep.',
    authorName: 'Idris',
    authorContext: 'Member since 2025',
    sortOrder: 2,
  },
];

/** The full sales-page envelope for the "Rootwork" example course. */
export const MOCK_COURSE_PAGE: JourneyCoursePage = {
  page: {
    id: PAGE_ID,
    organizationId: ORG_ID,
    publishedAt: '2026-05-01T09:00:00.000Z',
    pageType: 'course',
    slug: 'rootwork',
    title: 'Rootwork — Of Blood and Bones',
    status: 'published',
    subjectType: 'course',
    subjectId: COURSE_ID,
    // Inherit the org brand wholesale (the common case). Per-page overrides are
    // exercised directly in brand-overrides.test.ts.
    brandOverrides: null,
    sections: [
      {
        id: 'sec-hero',
        type: 'hero',
        enabled: true,
        props: {
          eyebrow: 'Of Blood and Bones',
          headline: 'Come home to your body.',
          subheadline:
            'Rootwork is the foundation course — fourteen guided practices through a felt five-stage arc, from finding the ground to living from wholeness.',
          ctaLabel: 'Begin the descent',
        },
      },
      {
        id: 'sec-intro',
        type: 'introVideo',
        enabled: true,
        props: {
          eyebrow: 'The invitation',
          heading: 'Ninety seconds inside the work.',
          sub: 'A candlelit look at what a practice actually feels like — no jargon, no performance.',
        },
      },
      {
        id: 'sec-ache',
        type: 'ache',
        enabled: true,
        props: {
          eyebrow: 'the ache',
          beats: [
            'You have read the books.',
            'You understand your patterns.',
            'And still the body holds what the mind has already forgiven.',
          ],
        },
      },
      {
        id: 'sec-turn',
        type: 'turn',
        enabled: true,
        props: {
          eyebrow: 'the turn',
          statement: 'Insight was never the missing piece. Safety was.',
          lede: 'Rootwork does not ask you to think differently. It teaches the body, slowly, that it is safe enough to soften — and everything else grows from there.',
          points: [
            'Ten-minute practices you can actually keep',
            'A felt arc, not a syllabus',
            'Return to any practice whenever you need it',
          ],
        },
      },
      {
        id: 'sec-reel',
        type: 'reel',
        enabled: true,
        props: {
          eyebrow: 'in motion',
          heading: 'This is what a descent looks like.',
          sub: 'A short, unhurried clip from inside the third stage.',
        },
      },
      {
        id: 'sec-map',
        type: 'map',
        enabled: true,
        props: {
          eyebrow: 'the descent',
          title: "Everything you'll walk.",
          sub: 'Five gated depths, each a small pool of practices. Move at the pace your body sets.',
          foot: 'Start anywhere in the first stage — the rest opens as you go.',
        },
      },
      {
        id: 'sec-feel',
        type: 'feel',
        enabled: true,
        props: {
          eyebrow: 'what it is',
          heading: 'Ten minutes. A voice. Your own weight.',
          body: 'No screens to perform for, no postures to get right. Just a guided settling you can do lying down, in the dark, at the end of a hard day.',
          inclusions: [
            {
              label: '14 guided practices',
              detail: 'Audio and short video, 5–12 minutes each',
            },
            {
              label: 'A felt five-stage arc',
              detail: 'Regulation through Reclamation',
            },
            {
              label: 'Yours at your pace',
              detail: 'Revisit any practice, any time',
            },
          ],
        },
      },
      {
        id: 'sec-proof',
        type: 'proof',
        enabled: true,
        props: {
          eyebrow: 'in their words',
          heading: 'What the ground gives back.',
        },
      },
      {
        id: 'sec-guide',
        type: 'guide',
        enabled: true,
        props: {
          eyebrow: 'your guide',
          heading: 'Made by someone who had to find the ground first.',
          name: 'Sena Okoro',
          bio: [
            'Sena spent a decade teaching the nervous system to strangers before she learned to trust her own.',
            'Rootwork is the course she wished someone had handed her at the start — plain, patient, and made for the body, not the idea of it.',
          ],
          credentials: [
            'Somatic Experiencing',
            '10 years teaching',
            'Trauma-informed',
          ],
        },
      },
      {
        id: 'sec-faq',
        type: 'faq',
        enabled: true,
        props: {
          eyebrow: 'before you begin',
          heading: 'The honest answers.',
          items: [
            {
              question: 'Do I need any experience?',
              answer:
                'None. Rootwork assumes nothing and starts with the most basic practice — orienting to the room you are in.',
            },
            {
              question: 'How much time does it take?',
              answer:
                'Most practices are five to twelve minutes. You set the pace; there is no schedule to fall behind on.',
            },
            {
              question: 'Can I cancel anytime?',
              answer:
                'Yes. Membership is monthly and you can cancel from your account whenever you like.',
            },
          ],
        },
      },
      {
        id: 'sec-invite',
        type: 'invite',
        enabled: true,
        props: {
          eyebrow: 'the invite',
          heading: 'Begin the work.',
          sub: 'Three ways in. Every one opens the whole of Rootwork.',
          ctaLabel: 'Join now',
          priceNote: 'Included with membership · £12 a month',
          offers: [
            {
              id: 'membership',
              name: 'Full membership',
              priceLabel: '£12',
              cadenceLabel: 'per month',
              blurb:
                'Every journey and practice — Rootwork and everything that grows from it.',
              best: true,
            },
            {
              id: 'course-sub',
              name: 'Rootwork monthly',
              priceLabel: '£6',
              cadenceLabel: 'per month',
              blurb:
                'Just this course — a gentler way in. Upgrade to full membership whenever.',
            },
            {
              id: 'one-off',
              name: 'Own Rootwork',
              priceLabel: '£45',
              cadenceLabel: 'once',
              blurb: 'Buy the course outright. Yours to keep, no subscription.',
            },
          ],
        },
      },
    ],
  },
  course: {
    id: COURSE_ID,
    slug: 'rootwork',
    title: 'Rootwork',
    kicker: 'The foundation course',
    lede: 'Before any journey, the ground. Rootwork teaches the body the basics of safety and settling — the practices everything else grows from.',
    status: 'published',
    priceCents: 4500,
    stageCount: STAGES.length,
    practiceCount: STAGES.reduce((sum, s) => sum + s.practices.length, 0),
  },
  stages: STAGES,
  testimonials: TESTIMONIALS,
};

/**
 * The streamed public sell previews (30s `preview.m3u8`, no auth). Dev-CDN-style
 * URLs — real media is wired at integration. On mocks a missing manifest simply
 * surfaces the player's error state (the section text still renders).
 */
export const MOCK_SELL_PREVIEW: SellPreview = {
  intro: {
    playlistUrl: '/cdn/preview/rootwork-intro/preview.m3u8',
    posterUrl: null,
    durationSeconds: 90,
  },
  reel: {
    playlistUrl: '/cdn/preview/rootwork-reel/preview.m3u8',
    posterUrl: null,
    durationSeconds: 30,
  },
};
