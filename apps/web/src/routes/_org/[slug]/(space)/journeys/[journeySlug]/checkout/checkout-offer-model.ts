/**
 * Journey checkout — pure offer + summary derivation (Codex-2pryk.3.6).
 *
 * The checkout is the offer/pay SHELL (SPEC §7 "one course, three ways in").
 * This module turns the awaited {@link JourneyCoursePage} into the presentational
 * offer catalogue + order summary the page renders — no Svelte, no DOM, no
 * server-only imports, so it is unit-testable in isolation (Neon-free).
 *
 * DATA PROVENANCE (the WP-6 boundary — read carefully):
 *   - The ONE-OFF price is SERVER-AUTHORITATIVE: it is always re-derived from
 *     the frozen `course.priceCents`, never trusted from authored copy.
 *   - The recurring paths (membership / course-subscription) are PAGE-BUILDER
 *     AUTHORED teasers read out of the landing page's `invite` section
 *     (`props.offers`, the SAME {@link InviteOffer}-shaped bag the sell page
 *     reads). Their prices are presentational until WP-6 monetization resolves
 *     them against real tiers / `course_subscription_plans` + Stripe. When the
 *     builder teases no offers, the checkout degrades to the single one-off
 *     offer built from `course.priceCents`.
 *
 * `PageSection.props` is org-authored jsonb — NEVER trusted structurally; every
 * field is pulled through the `render/coerce` guards so a malformed entry
 * degrades to a fallback instead of throwing during SSR.
 */
import type {
  JourneyCourseView,
  JourneyPageRecord,
  PageSection,
} from '$lib/page-builder';
import {
  asObjectArray,
  fieldBool,
  fieldString,
} from '$lib/page-builder/render/coerce';
import { formatPrice, formatPriceCompact } from '$lib/utils/format';

/** One selectable way into the course, shown as a radio-card on the checkout. */
export interface CheckoutOffer {
  id: string;
  name: string;
  /** Formatted headline price (e.g. `£49`, `£12`). GBP. */
  priceLabel: string;
  /** Machine-readable cadence — drives the "per X" label + the fine print. */
  recurring: boolean;
  /** Human cadence label (`one-off`, `per month`, …). */
  cadenceLabel: string;
  /** Scope × commitment micro-label (NN/g "explicit differences"). */
  who?: string;
  blurb?: string;
  bullets: string[];
  /** The recommended path — badged + pre-selected when the URL names nothing. */
  best: boolean;
}

/** The left-hand "what you're getting" summary card. */
export interface CheckoutSummary {
  /** Cover kicker — the course's own kicker, else a neutral fallback. */
  kicker: string;
  title: string;
  /** Factual, DB-derived "what's inside" lines. */
  bullets: string[];
}

/** Minimal shape the derivation reads off a stage (public sales projection). */
interface StageLike {
  practices: { contentType: string }[];
}

/** Whole-pound prices render clean (`£49`); pence render in full (`£49.50`). */
function formatCleanPrice(cents: number): string {
  return cents % 100 === 0 ? formatPriceCompact(cents) : formatPrice(cents);
}

/** Field-level string-array reader (coerce has only prop-level `asStringArray`). */
function fieldStringArray(
  record: Record<string, unknown>,
  key: string
): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** The first enabled `invite` section, or undefined. */
function findInviteSection(sections: PageSection[]): PageSection | undefined {
  return sections.find((s) => s.type === 'invite' && s.enabled !== false);
}

/**
 * Map one authored offer entry → a {@link CheckoutOffer}. Requires an `id` +
 * `name`, and a resolvable price: an authored `priceLabel`, or the real
 * `course.priceCents` for a non-recurring (one-off) path. Returns null (dropped)
 * when neither is present, so a half-authored entry never shows a blank price.
 */
function mapOffer(
  entry: Record<string, unknown>,
  course: JourneyCourseView
): CheckoutOffer | null {
  const id = fieldString(entry, 'id');
  const name = fieldString(entry, 'name');
  if (!id || !name) return null;

  const per = fieldString(entry, 'per');
  const recurring = per !== undefined && per !== 'once';
  const cadenceLabel = recurring ? `per ${per}` : 'one-off';

  const authoredPrice = fieldString(entry, 'priceLabel');
  const priceLabel =
    authoredPrice ??
    (!recurring && course.priceCents !== null
      ? formatCleanPrice(course.priceCents)
      : undefined);
  if (!priceLabel) return null;

  return {
    id,
    name,
    priceLabel,
    recurring,
    cadenceLabel,
    who: fieldString(entry, 'who'),
    blurb: fieldString(entry, 'blurb'),
    bullets: fieldStringArray(entry, 'bullets'),
    best: fieldBool(entry, 'best'),
  };
}

/**
 * The selectable offers. Reads the `invite` section's authored `offers` bag;
 * when none is teased, degrades to a single one-off offer built from the
 * server-authoritative `course.priceCents`. Empty only when the course is not
 * sold standalone AND no offers are authored.
 */
export function deriveCheckoutOffers(
  page: JourneyPageRecord,
  course: JourneyCourseView
): CheckoutOffer[] {
  const invite = findInviteSection(page.sections);
  const authored = invite
    ? asObjectArray<CheckoutOffer>(invite.props, 'offers', (entry) =>
        mapOffer(entry, course)
      )
    : undefined;
  if (authored && authored.length > 0) return authored;

  if (course.priceCents !== null) {
    return [
      {
        id: 'one-off',
        name: `Own ${course.title}`,
        priceLabel: formatCleanPrice(course.priceCents),
        recurring: false,
        cadenceLabel: 'one-off',
        who: 'Prefer to own, not subscribe',
        blurb: `Buy ${course.title} outright. Yours to return to, for good.`,
        bullets: ['Yours forever', 'No subscription', 'Lifetime access'],
        best: true,
      },
    ];
  }

  return [];
}

/**
 * Which offer starts selected. Honours `?offer=<id>` when it names a real path
 * (deep-links from the sell page's teased paths), else the `best` path, else the
 * first. Returns '' only when there are no offers.
 */
export function resolvePreselectedOffer(
  offers: CheckoutOffer[],
  wanted: string | null
): string {
  if (offers.length === 0) return '';
  if (wanted && offers.some((o) => o.id === wanted)) return wanted;
  return (offers.find((o) => o.best) ?? offers[0]).id;
}

/** Title-case a content-type token for the "what's inside" mix line. */
function contentTypeLabel(type: string): string {
  if (type === 'written') return 'written';
  return type; // 'video' | 'audio' — already lower, joined into a sentence
}

/** "Video, audio & written practice" from the real practice content types. */
function formatContentMix(stages: StageLike[]): string | undefined {
  const seen: string[] = [];
  for (const stage of stages) {
    for (const practice of stage.practices) {
      const label = contentTypeLabel(practice.contentType);
      if (label && !seen.includes(label)) seen.push(label);
    }
  }
  if (seen.length === 0) return undefined;
  const capped = seen[0].charAt(0).toUpperCase() + seen[0].slice(1);
  const rest = seen.slice(1);
  const tail =
    rest.length === 0
      ? ''
      : rest.length === 1
        ? ` & ${rest[0]}`
        : `, ${rest.slice(0, -1).join(', ')} & ${rest[rest.length - 1]}`;
  return `${capped}${tail} practice`;
}

/**
 * The left-hand order summary. Every factual line is DB-derived — the practice/
 * stage counts and the content-type mix come straight off the awaited course +
 * stages, so the card can never claim more than the course actually holds.
 */
export function deriveCourseSummary(
  course: JourneyCourseView,
  stages: StageLike[]
): CheckoutSummary {
  const bullets: string[] = [];

  if (course.practiceCount > 0 && course.stageCount > 0) {
    const practices = `${course.practiceCount} ${course.practiceCount === 1 ? 'practice' : 'practices'}`;
    const stagesLabel = `${course.stageCount} ${course.stageCount === 1 ? 'stage' : 'stages'}`;
    bullets.push(`${practices} across ${stagesLabel}`);
  }

  const mix = formatContentMix(stages);
  if (mix) bullets.push(mix);

  bullets.push('Yours to return to, as often as you need');

  return {
    kicker: course.kicker ?? 'The course',
    title: course.title,
    bullets,
  };
}

/** Head sub-line — "One course. N ways in." when more than one path is offered. */
export function buildHeadNote(offers: CheckoutOffer[]): string | undefined {
  if (offers.length < 2) return undefined;
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
  const n = words[offers.length] ?? String(offers.length);
  return `One course. ${n.charAt(0).toUpperCase() + n.slice(1)} ways in.`;
}
