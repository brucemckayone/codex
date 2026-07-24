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
   * primary CTA here.
   */
  checkoutUrl: string;
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

/** `turn` — the pivot from pain to promise. */
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
}

/** `proof` — testimonials; renders from context.testimonials. */
export interface ProofSectionProps {
  eyebrow?: string;
  heading?: string;
}

/** `guide` — the maker's bio. */
export interface GuideSectionProps {
  eyebrow?: string;
  heading?: string;
  name?: string;
  bio?: string[];
  portraitUrl?: string;
  credentials?: string[];
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
 * One offer path shown on the `invite` section (SPEC §7 — the 3-path model:
 * tier / course-subscription / course-purchase). CONTRACT GAP: the frozen
 * {@link JourneyCoursePage} carries only `course.priceCents` (the one-off), not
 * the full offer set — the tier/subscription paths are owned by WP-6
 * monetization and surfaced on the checkout route. This optional prop lets the
 * builder tease paths on the sell page; when absent the invite renders the
 * one-off price + a CTA to `/journeys/[slug]/checkout`.
 */
export interface InviteOffer {
  id: string;
  name: string;
  priceLabel: string;
  cadenceLabel?: string;
  blurb?: string;
  best?: boolean;
}

/** `invite` — the offer and pricing (the primary conversion moment). */
export interface InviteSectionProps {
  eyebrow?: string;
  heading?: string;
  sub?: string;
  ctaLabel?: string;
  priceNote?: string;
  offers?: InviteOffer[];
}

/** Re-export the envelope for section-component prop typing convenience. */
export type { JourneyCoursePage };
