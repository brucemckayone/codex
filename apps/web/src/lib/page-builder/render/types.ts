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
