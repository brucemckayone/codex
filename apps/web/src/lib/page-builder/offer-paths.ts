/**
 * Course offer paths — the ONE authoritative offer derivation (Codex-2pryk.2.4.3).
 *
 * Turns the authoritative {@link CourseOffer} (composed by
 * `CourseAccessService.getCourseOffer` from `courses.price_cents` +
 * `course_subscription_plans` + `course_tier_access ⋈ subscription_tiers`) into
 * the selectable cards BOTH conversion surfaces render:
 *
 *   - the journey checkout (`journeys/[journeySlug]/checkout`) — radio cards
 *   - the sell page's `invite` section — teaser cards deep-linking to the above
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  PROVENANCE — the whole point of this module
 * ═══════════════════════════════════════════════════════════════════════════
 * Before this existed, both surfaces derived their offers from AUTHORED
 * MARKETING COPY: the `invite` section's `props.offers` array, whose
 * `priceLabel` is free text a creator types into the page builder. A page could
 * (and in dev DID) advertise "Included with membership · £12 a month" while the
 * real tier cost £15 and the real course subscription cost £27. Worse, the
 * recurring cards were pure decoration — no plan or tier row stood behind them.
 *
 * So, invariant, enforced by construction:
 *
 *   EVERY returned path corresponds to a real entry in `offer.paths`, and EVERY
 *   price comes from `offer.purchase.priceCents` / `offer.subscription.*` /
 *   `offer.tiers[].price*`. Authored copy may DECORATE a real path (its name,
 *   who/blurb/bullets, and which one is badged) and may create NOTHING.
 *
 * An authored entry is matched to a real path by its `id` naming one of the
 * CANONICAL ids below — exactly, no fuzzy matching. Entries that match nothing
 * are dropped. Guessing (`per: 'month'` ⇒ "must mean the tier") is precisely
 * what produced the £12-vs-£15 lie, so it is deliberately not attempted; a
 * creator who wants to decorate a path authors its canonical id.
 *
 * Pure: no Svelte, no DOM, no server-only imports — unit-testable, Neon-free.
 * `PageSection.props` is org-authored jsonb and is NEVER trusted structurally;
 * every field is read through the `render/coerce` guards.
 */
import type { CourseOffer, PageSection, SectionProps } from '$lib/page-builder';
import {
  asObjectArray,
  fieldBool,
  fieldString,
} from '$lib/page-builder/render/coerce';
import { formatPrice, formatPriceCompact } from '$lib/utils/format';

/**
 * Which of the three SPEC §7 ways in a card represents. A STRING discriminant
 * (not a boolean pair) so it narrows under `apps/web`'s `strictNullChecks: false`
 * and so the submit step can `switch` on it without re-deriving anything.
 */
export type OfferPathKind = 'purchase' | 'subscription' | 'tier';

/**
 * Which price of a recurring path to bill.
 *
 * CAUTION for the submit step: this is the `CourseOffer` vocabulary
 * (`priceMonthly` / `priceAnnual`). BOTH checkout endpoints validate against
 * `billingIntervalEnum` = `'month' | 'year'`, so a caller must map, not forward.
 */
export type OfferBillingInterval = 'monthly' | 'annual';

/** One selectable way into the course — a radio card on checkout, a teaser on the sell page. */
export interface OfferPath {
  /**
   * Canonical, stable id — `purchase`, `subscription-monthly`,
   * `subscription-annual`, or `tier:<tierId>`. Doubles as the `?offer=` deep-link
   * token and as the key authored copy must use to decorate this path.
   */
  id: string;
  kind: OfferPathKind;
  name: string;
  /** Formatted headline price (`£27`, `£24.99`). GBP. Always derived, never authored. */
  priceLabel: string;
  /** The REAL amount this path charges, GBP integer pence. Never authored. */
  priceCents: number;
  /** Machine-readable cadence — drives the "per X" label + the fine print. */
  recurring: boolean;
  /** Human cadence label (`one-off`, `per month`, `per year`). */
  cadenceLabel: string;
  /** Scope × commitment micro-label ("explicit differences" between the paths). */
  who?: string;
  blurb?: string;
  bullets: string[];
  /** The recommended path — badged + pre-selected when the URL names nothing. */
  best: boolean;
  /** Only on `kind: 'tier'` — the org tier whose subscription unlocks the course. */
  tierId?: string;
  /** Only on the recurring kinds — which of the plan's two prices to bill. */
  billingInterval?: OfferBillingInterval;
}

/** The course fields the derivation needs for its DEFAULT copy (never for prices). */
export interface OfferCourseLike {
  title: string;
}

/** Whole-pound prices render clean (`£49`); pence render in full (`£49.50`). */
export function formatCleanPrice(cents: number): string {
  return cents % 100 === 0 ? formatPriceCompact(cents) : formatPrice(cents);
}

/** Authored DECORATION for one real path — copy only, no price, no existence. */
interface OfferDecoration {
  /** The canonical path id this entry decorates. */
  id: string;
  name?: string;
  who?: string;
  blurb?: string;
  bullets: string[];
  best: boolean;
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
export function findInviteSection(
  sections: PageSection[]
): PageSection | undefined {
  return sections.find((s) => s.type === 'invite' && s.enabled !== false);
}

/**
 * Read the authored `invite` offers as DECORATIONS, keyed by canonical path id.
 *
 * Note what is NOT read: `priceLabel` and `per`. A price is not the page
 * builder's to state, and the cadence follows from which canonical path the
 * entry names. An entry with no `id` decorates nothing and is dropped.
 */
function readDecorations(
  inviteProps: SectionProps | undefined
): Map<string, OfferDecoration> {
  if (!inviteProps) return new Map();

  const entries = asObjectArray<OfferDecoration>(
    inviteProps,
    'offers',
    (entry) => {
      const id = fieldString(entry, 'id');
      if (!id) return null;
      return {
        id,
        name: fieldString(entry, 'name'),
        who: fieldString(entry, 'who'),
        blurb: fieldString(entry, 'blurb'),
        bullets: fieldStringArray(entry, 'bullets'),
        best: fieldBool(entry, 'best'),
      };
    }
  );

  const byId = new Map<string, OfferDecoration>();
  for (const entry of entries ?? []) {
    // First authored entry for an id wins — a duplicate cannot silently
    // override the copy the creator sees first in the builder.
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return byId;
}

/** Apply an authored decoration over a derived path. Price fields are untouchable. */
function decorate(
  path: OfferPath,
  decoration: OfferDecoration | undefined
): OfferPath {
  if (!decoration) return path;
  return {
    ...path,
    name: decoration.name ?? path.name,
    who: decoration.who ?? path.who,
    blurb: decoration.blurb ?? path.blurb,
    bullets: decoration.bullets.length > 0 ? decoration.bullets : path.bullets,
    best: decoration.best || path.best,
  };
}

/** `tier:<tierId>` — the canonical id of a tier-access path. */
export function tierPathId(tierId: string): string {
  return `tier:${tierId}`;
}

/**
 * The selectable ways into the course, in `offer.paths` order (purchase →
 * subscription → tiers). Empty when the course has no available path at all —
 * the caller renders "not open for enrolment", never a fabricated price.
 *
 * A course subscription contributes TWO cards (monthly + annual): that plan
 * exists only for this course, so if this surface does not offer both intervals
 * the annual price the creator set is unreachable. A tier contributes ONE card
 * at its monthly price: a tier is a whole-org subscription and the org's own
 * pricing page owns its interval choice — here the card's job is to say "this
 * course is included in <Tier>".
 */
export function deriveOfferPaths(
  offer: CourseOffer | null,
  course: OfferCourseLike,
  inviteProps?: SectionProps
): OfferPath[] {
  if (!offer) return [];

  const decorations = readDecorations(inviteProps);
  const paths: OfferPath[] = [];

  for (const kind of offer.paths) {
    if (kind === 'purchase' && offer.purchase) {
      paths.push({
        id: 'purchase',
        kind: 'purchase',
        name: `Own ${course.title}`,
        priceLabel: formatCleanPrice(offer.purchase.priceCents),
        priceCents: offer.purchase.priceCents,
        recurring: false,
        cadenceLabel: 'one-off',
        who: 'Prefer to own, not subscribe',
        blurb: `Buy ${course.title} outright. Yours to return to, for good.`,
        bullets: ['Yours forever', 'No subscription', 'Lifetime access'],
        best: false,
      });
    }

    if (kind === 'subscription' && offer.subscription) {
      const { priceMonthly, priceAnnual } = offer.subscription;

      paths.push({
        id: 'subscription-monthly',
        kind: 'subscription',
        name: `${course.title} monthly`,
        priceLabel: formatCleanPrice(priceMonthly),
        priceCents: priceMonthly,
        recurring: true,
        cadenceLabel: 'per month',
        who: 'Just here for this course',
        blurb: `Full access to ${course.title} for as long as you subscribe.`,
        bullets: ['This course only', 'Cancel anytime'],
        best: false,
        billingInterval: 'monthly',
      });

      // The saving is COMPUTED from the two real prices, so the card can never
      // claim a discount the plan does not actually give. The plan schema
      // enforces annual ≤ 12 × monthly, so this is normally positive.
      const annualSaving = priceMonthly * 12 - priceAnnual;
      paths.push({
        id: 'subscription-annual',
        kind: 'subscription',
        name: `${course.title} yearly`,
        priceLabel: formatCleanPrice(priceAnnual),
        priceCents: priceAnnual,
        recurring: true,
        cadenceLabel: 'per year',
        who: 'Settling in for the long work',
        blurb: `A year of ${course.title}, paid once up front.`,
        bullets:
          annualSaving > 0
            ? [
                'This course only',
                `Save ${formatCleanPrice(annualSaving)} a year vs monthly`,
              ]
            : ['This course only', 'Billed once a year'],
        best: false,
        billingInterval: 'annual',
      });
    }

    if (kind === 'tier') {
      for (const tier of offer.tiers) {
        paths.push({
          id: tierPathId(tier.tierId),
          kind: 'tier',
          name: tier.tierName,
          priceLabel: formatCleanPrice(tier.priceMonthly),
          priceCents: tier.priceMonthly,
          recurring: true,
          cadenceLabel: 'per month',
          who: 'Everything, not just this course',
          blurb: `${course.title} is included with ${tier.tierName}.`,
          bullets: [
            `Includes ${course.title}`,
            'Plus everything else in the membership',
            'Cancel anytime',
          ],
          best: false,
          tierId: tier.tierId,
          billingInterval: 'monthly',
        });
      }
    }
  }

  const decorated = paths.map((path) =>
    decorate(path, decorations.get(path.id))
  );
  return applyRecommendation(decorated);
}

/**
 * {@link deriveOfferPaths} for a caller holding the whole page (the checkout
 * server load): locates the first enabled `invite` section itself. The section
 * component uses the core function directly — it already has its own props.
 */
export function deriveOfferPathsForPage(
  offer: CourseOffer | null,
  course: OfferCourseLike,
  sections: PageSection[]
): OfferPath[] {
  return deriveOfferPaths(offer, course, findInviteSection(sections)?.props);
}

/**
 * The checkout URL for one path — the sell page's teaser cards deep-link into
 * the pay surface with the SAME path pre-selected (`?offer=`), so choosing on
 * the sales page is not silently discarded on arrival.
 */
export function checkoutUrlForPath(
  checkoutUrl: string,
  pathId: string
): string {
  const separator = checkoutUrl.includes('?') ? '&' : '?';
  return `${checkoutUrl}${separator}offer=${encodeURIComponent(pathId)}`;
}

/**
 * Exactly ONE path carries the "best value" badge.
 *
 * An authored `best: true` on a canonical id wins (first one only — two badged
 * cards is a broken page, not a stronger recommendation). With nothing authored
 * the default upsell is the platform's own: the cheapest TIER (the membership
 * that also unlocks everything else), else the monthly course subscription,
 * else the one-off. Presentation only — no price or path depends on it.
 */
function applyRecommendation(paths: OfferPath[]): OfferPath[] {
  if (paths.length === 0) return paths;

  const authored = paths.find((p) => p.best);
  const fallback =
    paths
      .filter((p) => p.kind === 'tier')
      .sort((a, b) => a.priceCents - b.priceCents)[0] ??
    paths.find((p) => p.id === 'subscription-monthly') ??
    paths[0];
  const recommended = authored ?? fallback;

  return paths.map((p) => ({ ...p, best: p.id === recommended.id }));
}

/**
 * Which path starts selected. Honours `?offer=<id>` when it names a REAL path
 * (deep-link from the sell page's teaser cards) — a stale or tampered token
 * falls through to the recommendation rather than selecting nothing. Returns ''
 * only when there are no paths.
 */
export function resolvePreselectedOffer(
  paths: OfferPath[],
  wanted: string | null
): string {
  if (paths.length === 0) return '';
  if (wanted && paths.some((p) => p.id === wanted)) return wanted;
  return (paths.find((p) => p.best) ?? paths[0]).id;
}

/**
 * Head sub-line — "One course. Three ways in." (SPEC §7).
 *
 * Counts `offer.paths`, NOT the cards: a monthly and an annual course
 * subscription are one way in at two cadences, so counting cards would claim
 * four ways where there are three.
 */
export function buildHeadNote(offer: CourseOffer | null): string | undefined {
  const count = offer?.paths.length ?? 0;
  if (count < 2) return undefined;
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
  const n = words[count] ?? String(count);
  return `One course. ${n.charAt(0).toUpperCase() + n.slice(1)} ways in.`;
}
