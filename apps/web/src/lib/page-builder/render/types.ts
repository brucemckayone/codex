/**
 * Public journey sales renderer — render-context + per-section prop contracts
 * (Codex-2pryk.3.1 · WP-3).
 *
 * This module is INERT + public-bundle safe (types only, no component imports,
 * no DOM). It lives under `$lib/page-builder` — the CE-4-scanned PUBLIC_LIB_ROOT
 * — and must NEVER import the studio editor UI (`$lib/components/page-builder`).
 *
 * The frozen cross-worker contract (`@codex/shared-types` → `$lib/page-builder`)
 * fixes the ENVELOPE: `PageSection.props` is a `Record<string, unknown>` config
 * bag whose per-type shape is "owned by the WP-3 renderer + WP-5 editor". The
 * shapes below ARE that ownership: they name the copy/config each section
 * component reads out of `props`. They are grounded in the prototype
 * (`docs/design/course-journeys/prototype/sections/*`) and are ADDITIVE-ONLY
 * against the WP-0 freeze — every field is optional and the renderer falls back
 * to the awaited course/stage/testimonial data when a prop is absent.
 */
import type {
  CourseOffer,
  JourneyCoursePage,
  JourneyCourseView,
  JourneyStageView,
  JourneyTestimonialView,
} from '$lib/page-builder';

// ─────────────────────────────────────────────────────────────────────────────
// Streamed sell-preview (HARDENING §E course-sell row)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One public preview clip. The public sales page shows the existing 30s
 * `preview.m3u8` (SPEC §10) — NO `canView` on the shell, no auth. `playlistUrl`
 * is a plain HLS manifest URL consumed by `IntroVideoModal` / `HeroInlineVideo`.
 */
export interface PreviewMedia {
  /** HLS manifest URL for the 30s public preview clip. */
  playlistUrl: string;
  /** Optional decorative poster shown before play. */
  posterUrl?: string | null;
  /** Advisory duration (seconds) for a "N sec preview" affordance. */
  durationSeconds?: number | null;
}

/**
 * The STREAMED secondary payload of the sales page (shell+stream): the public
 * sell previews for the intro-film and reel sections. Resolved off the critical
 * path so first paint / SEO never blocks on media resolution. Either clip may be
 * null (not configured, or a resolution error `.catch()`-ed to null).
 */
export interface SellPreview {
  /** The intro-film clip (the `introVideo` section). */
  intro: PreviewMedia | null;
  /** The practice-preview clip (the `reel` section). */
  reel: PreviewMedia | null;
  /**
   * The guide's PORTRAIT still — a public CDN URL, or null when the creator has
   * picked no portrait (contract amendment A15). FE mirror of
   * `CourseSellPreview.guidePortraitUrl`.
   *
   * `GuideSection` reads a `portraitUrl` PROP that no builder field and no query
   * could ever fill, so the published guide could only render its letter
   * monogram. The picker wrote `courses.guide.portraitMediaId` and nothing public
   * read it. This is the projection; WT-6 is what consumes it.
   *
   * OPTIONAL-additive: an older worker deployment omits it and the section keeps
   * falling back to the monogram.
   */
  guidePortraitUrl?: string | null;
  /**
   * The guide's talking-head clip (the second builder-written, publicly-unread
   * media slot A15 closes). The public `guide` section has no video affordance at
   * all today — adding one is WT-6's composition work.
   */
  guideClip?: PreviewMedia | null;
  /**
   * The HERO still — a public CDN URL, or null when the creator has picked no
   * hero media (contract amendment A27). FE mirror of
   * `CourseSellPreview.heroImageUrl`.
   *
   * Until A27 the `courses` table had NO hero image slot, so every hero
   * composition drew a synthetic radial-gradient plate and the `media` design
   * axis (`bleed`/`frame`/`mask`/`inset`) had no real image to shape. This is the
   * projection; the hero compositions in WT-3 are what consume it.
   *
   * OPTIONAL-additive: an older worker deployment omits it and the hero keeps
   * falling back to its synthetic plate.
   */
  heroImageUrl?: string | null;
  /**
   * The HERO clip — the same `courses.heroMediaId` item as `heroImageUrl`, but
   * resolved through `toClip` so the hero can PLAY it. FE mirror of
   * `CourseSellPreview.heroClip`.
   *
   * `heroImageUrl` remains the poster for the playing modes and the whole picture
   * for the still ones, so a hero reads BOTH: the clip decides whether playback is
   * possible, the still decides what shows before and instead of it.
   *
   * OPTIONAL-additive: an older worker deployment omits it and the hero degrades
   * to the still, then to its synthetic plate.
   */
  heroClip?: PreviewMedia | null;
  /**
   * The guide's SIGNATURE mark — a public CDN URL, or null when unset (A27).
   * `guide.letter` signs off with it; WT-6 owns that composition.
   */
  signatureUrl?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render context — passed down to every section component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The read-only context every section component renders against. Assembled once
 * by `JourneyRenderer` from the awaited {@link JourneyCoursePage} plus the
 * streamed preview promise, so a section reads course/stage/testimonial data
 * without re-threading props through the catalogue loop.
 */
export interface JourneySalesContext {
  course: JourneyCourseView;
  stages: JourneyStageView[];
  testimonials: JourneyTestimonialView[];
  /**
   * Absolute URL of the offer/checkout surface for this journey
   * (`buildJourneyUrl(..., { surface: 'checkout' })`). Sections link their
   * primary CTA here for a visitor who has not yet joined.
   */
  checkoutUrl: string;
  /**
   * Absolute URL of the member dashboard surface
   * (`buildJourneyUrl(..., { surface: 'dashboard' })`). The primary CTA points
   * here instead of `checkoutUrl` for a viewer who is already enrolled.
   */
  dashboardUrl: string;
  /**
   * Whether the current viewer is already enrolled in this course. The public
   * sales page is fully public (no `canView`); this flag ONLY re-targets the
   * conversion CTA — anonymous / not-enrolled → "join" (→ `checkoutUrl`);
   * enrolled → "go to your dashboard" (→ `dashboardUrl`). Defaults to `false`
   * so the studio builder's live preview always shows the pre-purchase state.
   */
  enrolled: boolean;
  /**
   * The AUTHORITATIVE monetization offer for this course (SPEC §7) — which ways
   * in exist and what each charges, composed from real plan/tier/price rows by
   * `getCourseOffer`. The `invite` section renders THIS, decorated by authored
   * copy; before Codex-2pryk.2.4.3 it rendered the authored copy's own
   * `priceLabel`, so a page could advertise a price and a path that did not
   * exist.
   *
   * `null` when the offer read was unavailable (it is `.catch()`-guarded — the
   * sales page is SEO-critical and must not 500 over a pricing hiccup). Sections
   * MUST degrade to a price-less CTA on null and never fall back to authored
   * numbers.
   */
  offer: CourseOffer | null;
  /**
   * Whether this course has AT LEAST ONE real way in — i.e. whether the checkout
   * can actually sell it. Derived once by `JourneyRenderer` from
   * `deriveOfferPaths(offer, course).length > 0`, so every section shares one
   * answer instead of each re-deriving it (and only `invite` ever did).
   *
   * WHY IT EXISTS. Three "Begin" affordances — the hero CTA, the floating pill
   * and the invite CTA — pointed at `/journeys/<slug>/checkout` regardless, and
   * checkout answers "<Course> isn't open for enrolment just now. Back to the
   * journey →". Measured in this dev database: FIVE of the seven published
   * journey pages have `price_cents IS NULL`, zero `course_subscription_plans`
   * rows and zero `course_tier_access` rows, so on the majority of real pages the
   * whole funnel terminated in a bounce back to where the visitor started.
   *
   * A CONFIDENT NEGATIVE ONLY. `false` means "the offer resolved and it has no
   * paths"; a FAILED offer read is `offer: null` and leaves this TRUE. That
   * asymmetry is deliberate and mirrors the loop-safety invariant the sell load
   * states for its own redirect ("NEVER REDIRECT ON UNCERTAINTY" — on doubt,
   * render where you are): the offer read is `.catch(() => null)`-guarded
   * precisely so a pricing hiccup cannot break an SEO-critical page, and removing
   * the buy button on a transient hiccup would be a worse failure than the dead
   * end this closes.
   *
   * OPTIONAL-ADDITIVE, and `undefined` means TRUE — the pre-purchase sell state,
   * exactly as `enrolled` defaults to `false` and `offer` to `null`. A host that
   * cannot know (a preview harness, a test fixture) must not silently lose the
   * page's conversion affordance. Both real hosts set it explicitly:
   * `JourneyRenderer` derives it, `builderSalesContext` pins it to `true`.
   * Consumers MUST therefore test `context.purchasable !== false`, never
   * `!context.purchasable`.
   */
  purchasable?: boolean;
  /**
   * The streamed sell-preview. Sections consume it via `{#await}` with a
   * poster skeleton so a slow/failed media resolution degrades gracefully and
   * never blocks the section's text (SEO-critical) from rendering.
   */
  sellPreview: Promise<SellPreview | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-section prop shapes (all fields optional — renderer falls back)
// ─────────────────────────────────────────────────────────────────────────────

/** `hero` — opening headline, kicker and primary CTA (SPEC §4.1). */
export interface HeroSectionProps {
  eyebrow?: string;
  headline?: string;
  subheadline?: string;
  ctaLabel?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  /** A quiet trust line under the CTAs ("Practised by 2,400+ …"). */
  trust?: string;
  /**
   * The three keys the builder has always written and the renderer never read
   * (`Codex-tqr51`; they were `OWED_READS.hero` until the WT-3 pilot wired them).
   * They are not aliases of an existing prop — each needs its own markup, which is
   * why the bridge in `coerce.ts` could not close them.
   *
   * `accent` — an emphasised ending to the headline, set on its own line.
   * `felt` — a short emphasis line between the sub-line and the CTAs.
   * `bg` — the atmosphere recipe (`ember` | `blood` | `still`). Note this is an
   * AXIS IN DISGUISE and a candidate for a later collapse: `still` is
   * `motion: none` plus a dimmer accent, and `ember`/`blood` are two accent
   * recipes. It is kept as a prop for now because retiring it would need its own
   * forward-map entry and stored-data migration; it is scoped to the glow's own
   * recipe and still gated by `--jp-sec-atmos`, so it composes with the axes
   * rather than fighting them.
   */
  accent?: string;
  felt?: string;
  bg?: string;
}

/** `introVideo` — the 90-second sell film (streamed preview). */
export interface IntroVideoSectionProps {
  eyebrow?: string;
  heading?: string;
  sub?: string;
  posterUrl?: string;
}

/** `ache` — names the held pain as a sequence of beats before hope is offered. */
export interface AcheSectionProps {
  eyebrow?: string;
  beats?: string[];
}

/**
 * `turn` — the pivot from pain to promise.
 *
 * NOTE: there is deliberately no `stages` field. `TurnSection` derives its roman
 * -numeralled stage list FROM `points` by splitting each entry on an en/em dash
 * ("Regulation — finding the ground"), so the authored shape stays one flat string
 * array. A separate `stages` prop would be a second, divergent source for the same
 * list.
 */
export interface TurnSectionProps {
  eyebrow?: string;
  statement?: string;
  lede?: string;
  points?: string[];
}

/** `reel` — a cinematic practice-preview clip (streamed preview). */
export interface ReelSectionProps {
  eyebrow?: string;
  heading?: string;
  sub?: string;
  posterUrl?: string;
  /**
   * The whispered caption under the letterboxed frame. `captions` takes
   * precedence and cross-fades on a slow cycle; `caption` is the single-line
   * form. Absent ⇒ no caption line renders.
   */
  caption?: string;
  captions?: string[];
  /** Corner tag label above the frame. Defaults to `Preview` when absent. */
  tag?: string;
}

/** `map` — the descent map (public, no progress); renders from context.stages. */
export interface MapSectionProps {
  eyebrow?: string;
  title?: string;
  sub?: string;
  foot?: string;
}

/** One "what's inside" row for the `feel` section. */
export interface FeelInclusion {
  label: string;
  detail?: string;
}

/** `feel` — what it feels like (left) + what's inside (right). */
export interface FeelSectionProps {
  eyebrow?: string;
  heading?: string;
  body?: string;
  inclusions?: FeelInclusion[];
  /**
   * The "free-taste" preview player. `previewTitle` is the switch — absent ⇒ the
   * player self-hides. `previewDuration` is in seconds and drives the playhead.
   *
   * The transport is currently a VISUAL taste (an animated equaliser + playhead),
   * not real playback: it is not yet wired to `context.sellPreview.reel`'s HLS
   * manifest. These props describe the authored copy either way.
   */
  previewTitle?: string;
  previewSub?: string;
  previewDuration?: number;
}

/** `proof` — testimonials; renders from context.testimonials. */
export interface ProofSectionProps {
  eyebrow?: string;
  heading?: string;
  /**
   * The quiet aggregate trust line beside the testimonials ("2,400+ practising").
   * `ProofSection` also accepts the legacy key `trust` for pages authored before
   * this name settled, so both are declared.
   */
  trustLabel?: string;
  trust?: string;
}

/** `guide` — the maker's bio. */
export interface GuideSectionProps {
  eyebrow?: string;
  heading?: string;
  name?: string;
  bio?: string[];
  portraitUrl?: string;
  credentials?: string[];
  /** The pull-quote climax under the bio. Omitted entirely when absent. */
  quote?: string;
}

/** One FAQ entry. */
export interface FaqEntry {
  question: string;
  answer: string;
}

/** `faq` — the honest answers (accordion). */
export interface FaqSectionProps {
  eyebrow?: string;
  heading?: string;
  items?: FaqEntry[];
}

/**
 * Authored DECORATION for one offer path on the `invite` section (SPEC §7 —
 * tier / course-subscription / course-purchase).
 *
 * `id` must name a CANONICAL path id (`purchase`, `subscription-monthly`,
 * `subscription-annual`, `tier:<tierId>`); an entry naming anything else
 * decorates nothing and is dropped. The rest is copy.
 *
 * NOTE the field that is gone: `priceLabel`. Until Codex-2pryk.2.4.3 the invite
 * section (and the checkout) took its prices from this authored string, so a
 * page could advertise "£12 a month" for a tier that cost £15 and for a course
 * subscription that did not exist at all. Prices now come only from
 * {@link JourneySalesContext.offer}. `cadenceLabel` is likewise derived — it
 * follows from which canonical path the entry names.
 */
export interface InviteOffer {
  id: string;
  name?: string;
  who?: string;
  blurb?: string;
  bullets?: string[];
  best?: boolean;
}

/** `invite` — the offer and pricing (the primary conversion moment). */
export interface InviteSectionProps {
  eyebrow?: string;
  heading?: string;
  sub?: string;
  ctaLabel?: string;
  priceNote?: string;
  /** Authored copy that DECORATES real paths — never creates or prices one. */
  offers?: InviteOffer[];
}

/** Re-export the envelope for section-component prop typing convenience. */
export type { JourneyCoursePage };
