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
import type { CourseDisputeHold } from '$lib/journeys/types';
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
 * is a plain HLS manifest URL, played in place by the kit's `InlineFilm` or in
 * the theatre (`IntroVideoModal`), both on `PreviewPlayerCore`.
 */
export interface PreviewMedia {
  /** HLS manifest URL for the 30s public preview clip. */
  playlistUrl: string;
  /** Optional decorative poster shown before play. */
  posterUrl?: string | null;
  /** Advisory duration (seconds) for a "N sec preview" affordance. */
  durationSeconds?: number | null;
  /**
   * The server says the FULL film may be asked for (owner P10, "Full film
   * unless it's paid"): the media sits in a sell slot of a published course
   * and no content item that is anything but free uses it. A press then asks
   * through the page's `requestFilm` (`kit/page-context.ts`) and plays what
   * comes back. Absent or false: the 30s preview plays, as before.
   *
   * OPTIONAL-additive: an older worker deployment omits it, and every film
   * stays the preview.
   */
  fullFilm?: boolean;
}

/**
 * The course films a sales page can ask for in full (`requestFilm`), named
 * for the slots that hold them: the intro film (`SellPreview.intro`), the
 * practice reel (`reel`, which the Button block's preview action plays too)
 * and the guide's talking-head clip (`guideClip`).
 */
export type SalesFilm = 'intro' | 'reel' | 'guide';

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
 * per page, by `buildPublicContext` (`public-context.ts`) from the awaited
 * {@link JourneyCoursePage} plus the streamed preview promise, or by
 * `builderSalesContext` for the studio canvas, so a section reads
 * course/stage/testimonial data without re-threading props through the
 * catalogue loop.
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
   * Set while an open payment dispute on this viewer's course purchase or
   * course subscription holds back their entry (Codex-2hxff.60), from the
   * refused can-enter read. Every Buy and Join slot then shows the dispute
   * notice instead (`'paused'`, `kit/model/cta.ts`): the owner's "no Buy
   * while disputed". `null` for anyone else, for an anonymous visitor, under
   * `?preview`, and on the studio canvas.
   */
  disputeHold: CourseDisputeHold | null;
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
   * can actually sell it. Derived once by `buildPublicContext` from
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
   * REQUIRED, and it was not always. It shipped as `purchasable?: boolean` with
   * "`undefined` means TRUE" — so that a preview harness or a test fixture could
   * not silently lose the page's conversion affordance. The cost of that kindness
   * is that the CORRECT read is `context.purchasable !== false` and the obvious
   * one, `!context.purchasable`, is wrong in the one direction that matters: it
   * strips the buy button off every host that has not opted in. Nothing in the
   * type system said so; only this comment did.
   *
   * Making it required moves that from a comment to a compile error. Every host
   * now states its answer — `buildPublicContext` derives it, `builderSalesContext`
   * pins `true` for the canvas (and says why), and each test fixture declares the
   * state it is testing. `!context.purchasable` and `purchasable !== false` are
   * then the same predicate, so a new section cannot get it subtly wrong.
   *
   * Consumers should still prefer `context.purchasable !== false`: it keeps
   * reading correctly if a future host ever widens this again.
   */
  purchasable: boolean;
  /**
   * The streamed sell-preview. Sections consume it via `{#await}` with a
   * poster skeleton so a slow/failed media resolution degrades gracefully and
   * never blocks the section's text (SEO-critical) from rendering.
   */
  sellPreview: Promise<SellPreview | null>;
  /**
   * The CDN base a kit block resolves a page-image `ImageRef` against
   * (contract amendment A3, Codex-61zsk.10) — `resolvePageImageUrl(ref,
   * variant, context.mediaBaseUrl)`. The SAME `R2_PUBLIC_URL_BASE` every other
   * still on this page already resolves against; echoed onto the envelope by
   * `getCoursePage`/`getCoursePagePreview` so the web never needs its own copy
   * of the value. Null with no configured base.
   *
   * OPTIONAL, not just nullable: the studio canvas's context
   * (`render/builder-context.ts` defaults it there) and every existing
   * block-test fixture across
   * `kit/blocks/**` build a `JourneySalesContext` with no opinion on page
   * images at all. Fifty-plus call sites constructed this object before this
   * field existed (`grep -rl JourneySalesContext apps/web/src` at the time of
   * writing); requiring the key would have made every one of them a type
   * error for a field they have nothing to say about. A host that DOES have a
   * page-image reader (the public route, `builderSalesContext`) always sets
   * it explicitly rather than relying on the missing-key case.
   */
  mediaBaseUrl?: string | null;
}
