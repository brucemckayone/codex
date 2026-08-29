/**
 * Builder → public render-context adapter (Codex-eckbx W1–W3).
 *
 * The public section components render against a {@link JourneySalesContext}:
 * the real course, its curriculum, its testimonials, its offer and its streamed
 * sell-preview. The studio canvas has the same information in a different shape
 * — a page draft in the `pageBuilder` store plus the ADMIN curriculum read — so
 * something has to translate. This is that translation, and it is the last piece
 * the canvas needed in order to drop its duplicate component set.
 *
 * PURE + CE-4 SAFE. Data in, data out: no store import, no DOM, no editor UI.
 * It lives under `$lib/page-builder` (the scanned PUBLIC_LIB_ROOT) and the
 * caller — which does know about the store — passes the pieces in.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is invent data. Every field is either real
 * or an explicit, documented stand-in, because a canvas that quietly fabricates
 * a price or a testimonial teaches the author something false about their page.
 * Where there is nothing real to show, the context carries the same empty/null
 * the public page would carry, and the sections' own degradation paths handle it.
 */
import type {
  CourseOffer,
  EditorStageView,
  JourneyCourseView,
  JourneyPracticeView,
  JourneyStageView,
  JourneyTestimonialView,
} from '$lib/page-builder';
import type { JourneySalesContext, SellPreview } from './types';

/**
 * What the studio canvas can supply. Everything except `course` is optional so
 * the canvas renders from the first paint, before the curriculum / offer reads
 * have resolved — the sections already degrade on empty collections and a null
 * offer, so a partially-loaded context is a legitimate state rather than a bug.
 */
export interface BuilderContextInput {
  /**
   * The course being sold. `stageCount`/`practiceCount` are derived from
   * `stages` when omitted, so the caller does not have to keep two counts
   * consistent.
   */
  course: Pick<JourneyCourseView, 'id' | 'slug' | 'title'> &
    Partial<Omit<JourneyCourseView, 'id' | 'slug' | 'title'>>;
  /**
   * The ADMIN curriculum read (`getCourseCurriculum`), which is what the studio
   * already loads. Mapped down to the public `JourneyStageView` the `map`
   * section reads — `EditorStageView` is a superset, so this is a field pick and
   * never a fabrication. Draft-content practices are included: the author is
   * looking at their own unpublished work and should see it.
   */
  stages?: readonly EditorStageView[];
  /** Real testimonials when loaded; empty renders the section's own empty state. */
  testimonials?: readonly JourneyTestimonialView[];
  /** The journey's public checkout URL, for the sections' primary CTA. */
  checkoutUrl?: string;
  /** The journey's member-dashboard URL (unused while `enrolled` is false). */
  dashboardUrl?: string;
  /**
   * The authoritative offer when the studio has read it. `null`/omitted makes
   * the sections draw a PRICE-LESS CTA, which is the same thing the public page
   * does when the offer read fails — never authored numbers (SPEC §7).
   */
  offer?: CourseOffer | null;
  /** Resolved sell-preview media, when the studio has it. */
  sellPreview?: SellPreview | null;
}

/** `EditorPracticeView` → the public `JourneyPracticeView` it is a superset of. */
function toPracticeView(
  practice: EditorStageView['practices'][number],
  sortOrder: number
): JourneyPracticeView {
  return {
    contentId: practice.contentId,
    slug: practice.slug,
    title: practice.title,
    contentType: practice.contentType,
    sortOrder,
  };
}

/**
 * Map the admin curriculum to the public stage view.
 *
 * `sortOrder` on a practice is the FLAT index across the whole course
 * (`stage.sortOrder ⋈ practice.sortOrder`), not the index within its stage — the
 * public read defines it that way and the `map` section numbers practices from
 * it, so a per-stage index here would renumber every stage from 1 in the canvas
 * and disagree with the published page.
 */
function toStageViews(stages: readonly EditorStageView[]): JourneyStageView[] {
  let flat = 0;
  return stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    gloss: stage.gloss,
    sortOrder: stage.sortOrder,
    practices: stage.practices.map((practice) =>
      toPracticeView(practice, flat++)
    ),
  }));
}

/**
 * Assemble the render context the public section components expect, from what
 * the studio builder has.
 *
 * `enrolled` is always FALSE. That is not a simplification — the contract on
 * {@link JourneySalesContext.enrolled} specifies it ("Defaults to `false` so the
 * studio builder's live preview always shows the pre-purchase state"). The flag
 * only re-targets the conversion CTA, and an author needs to see the page a
 * prospective member sees, not the enrolled variant of it.
 *
 * `sellPreview` is returned already-resolved. The public page streams it so
 * first paint never blocks on media resolution; in the canvas there is nothing
 * to stream — the studio has the media or it does not — but the sections consume
 * it through `{#await}`, so the shape stays a promise and their await branches
 * keep exercising the same code path as production.
 */
export function builderSalesContext(
  input: BuilderContextInput
): JourneySalesContext {
  const stages = toStageViews(input.stages ?? []);
  const practiceCount = stages.reduce(
    (n, stage) => n + stage.practices.length,
    0
  );

  return {
    course: {
      id: input.course.id,
      slug: input.course.slug,
      title: input.course.title,
      kicker: input.course.kicker ?? null,
      lede: input.course.lede ?? null,
      status: input.course.status ?? 'draft',
      priceCents: input.course.priceCents ?? null,
      stageCount: input.course.stageCount ?? stages.length,
      practiceCount: input.course.practiceCount ?? practiceCount,
    },
    stages,
    testimonials: [...(input.testimonials ?? [])],
    checkoutUrl: input.checkoutUrl ?? '',
    dashboardUrl: input.dashboardUrl ?? '',
    enrolled: false,
    offer: input.offer ?? null,
    // ALWAYS TRUE, and pinned explicitly rather than left to the field's default.
    //
    // `purchasable: false` is what suppresses the public page's conversion
    // affordances, and an author must never lose sight of the button they are
    // designing around: the canvas exists to show the SELL state (the same reason
    // `enrolled` is hard-`false` two lines up). The studio also commonly has no
    // offer read at all, so deriving it here would blank the hero's CTA in the
    // canvas for a course that sells perfectly well.
    //
    // The consequence is a KNOWN, deliberate canvas↔public divergence — the one
    // case where the canvas shows an affordance the published page withholds —
    // and it is the same trade the `enrolled` flag already makes. The honest
    // surface for "this course has no way in yet" is the builder's Pricing panel,
    // not a silently missing button on the canvas.
    purchasable: true,
    sellPreview: Promise.resolve(input.sellPreview ?? null),
  };
}
