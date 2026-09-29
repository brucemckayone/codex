/**
 * Public sales-page render-context builder (Codex-61zsk.6 · WP-6).
 *
 * MOVED OUT of `render/JourneyRenderer.svelte`, same semantics: assembles the
 * `JourneySalesContext` every kit block renders against, from the awaited
 * envelope, the streamed sell-preview, the viewer's entitlement and the
 * authoritative offer. `+page.svelte` calls this instead of rendering
 * `JourneyRenderer` (which built the same shape inline); `JourneyRenderer`
 * itself is untouched — it stays live for checkout and the studio canvas
 * until WP-9 retires it.
 *
 * PURE + CE-4 SAFE: data in, data out, no DOM. `buildJourneyUrl` needs the
 * current request URL to decide same-org (root-relative) vs cross-org
 * (absolute) routing, so `url` is taken as an explicit parameter rather than
 * read from `$app/state` internally — the same reason `builder-context.ts`
 * takes its pieces as plain data instead of reading a store. That is also
 * what makes this testable with a plain `new URL(...)`, no SvelteKit runtime.
 */
import { buildJourneyUrl } from '@codex/urls';
import type { CourseOffer, JourneyCoursePage } from '$lib/page-builder';
import { deriveOfferPaths } from './offer-paths';
import type { JourneySalesContext, SellPreview } from './render/types';

export interface PublicContextInput {
  coursePage: JourneyCoursePage;
  /** Streamed public sell previews (30s preview.m3u8). May resolve to null. */
  sellPreview: Promise<SellPreview | null>;
  /**
   * Whether THIS RENDER should show the enrolled state. The caller resolves
   * the `?preview`-as-visitor override (letting a manager preview their own
   * buy button) — that decision reads `$app/state` and stays in `+page.svelte`,
   * exactly as its own long comment explains staying out of the load. This
   * function only ever sees the final answer.
   */
  enrolled: boolean;
  /** The authoritative offer (SPEC §7), or null when the read failed/was skipped. */
  offer: CourseOffer | null;
  /**
   * `R2_PUBLIC_URL_BASE`, echoed onto the envelope by `getCoursePage` /
   * `getCoursePagePreview`. Null with no configured base or an older worker
   * deployment that omits the field.
   */
  mediaBaseUrl: string | null;
  /** The current request URL, for `buildJourneyUrl`'s same-org/cross-org test. */
  url: URL;
}

/**
 * Build the visitor `JourneySalesContext` for the public sales page.
 *
 * TWO TARGETS, TWO KEY-SPACES — and they are NOT interchangeable.
 *
 * `/journeys/<slug>/checkout` resolves `landing_pages.slug` (the PAGE), while
 * `/journeys/<slug>/dashboard` resolves `courses.slug` (the COURSE) —
 * independently authored, and only accidentally equal on today's seeded
 * pages. `checkoutUrl` MUST key off `coursePage.page`; `dashboardUrl` MUST key
 * off `coursePage.course`. See `course-journey-service.ts`'s own docstring
 * ("Callers building a sales-page link MUST prefer `pageSlug`/`pageId`") and
 * this same file's `getCoursePage` for the full hazard — merging the two here
 * would 404 every primary CTA the moment a creator renames a course, or a
 * second page sells the same one.
 */
export function buildPublicContext(
  input: PublicContextInput
): JourneySalesContext {
  const { coursePage, sellPreview, enrolled, offer, mediaBaseUrl, url } = input;

  const checkoutUrl = buildJourneyUrl(
    url,
    { slug: coursePage.page.slug, id: coursePage.page.id },
    { surface: 'checkout' }
  );
  const dashboardUrl = buildJourneyUrl(
    url,
    { slug: coursePage.course.slug, id: coursePage.course.id },
    { surface: 'dashboard' }
  );

  /**
   * Whether the checkout can actually sell this course — see
   * {@link JourneySalesContext.purchasable} for the full reasoning.
   * `offer === null` is a FAILED read, not an empty offer, and answers TRUE so
   * a pricing hiccup never strips the buy button off an otherwise-purchasable
   * page. The authored `pricing`/`invite` decorations are deliberately not
   * passed: a decoration may only rename a real path, never create one, so it
   * cannot change this count.
   */
  const purchasable =
    offer === null
      ? true
      : deriveOfferPaths(offer, coursePage.course).length > 0;

  return {
    course: coursePage.course,
    stages: coursePage.stages,
    testimonials: coursePage.testimonials,
    checkoutUrl,
    dashboardUrl,
    enrolled,
    offer,
    purchasable,
    sellPreview,
    mediaBaseUrl,
  };
}

/**
 * The offer as a VISITOR's read would return it: `entitled` cleared.
 *
 * For the `?preview`-as-visitor override, which has to reach BOTH signals the
 * kit reads. `isEnrolled` ORs `context.enrolled` with `offer.entitled`, so
 * clearing only the flag still showed an entitled creator the member state —
 * "Continue", and no prices — on the preview meant to show them their buy
 * button (Codex-61zsk review). The studio canvas strips `entitled` for the
 * same reason.
 */
export function offerAsVisitor(offer: CourseOffer | null): CourseOffer | null {
  return offer ? { ...offer, entitled: false } : offer;
}
