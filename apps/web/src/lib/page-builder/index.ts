/**
 * `$lib/page-builder` — the FE public/inert contract surface for the
 * Landing-Page-Builder & Guided-Journeys build (Codex-2pryk · WP-0).
 *
 * INERT by design: types + pure helpers only. It re-exports the cross-worker
 * journey contracts from `@codex/shared-types` (so the FE has ONE import surface,
 * the same pattern as `$lib/utils/subdomain` re-exporting `@codex/urls`) and adds
 * the FE-only inert helpers (preview protocol, remote-function contracts).
 *
 * IMPORT BOUNDARY (CE-4 gate): this module is a scanned PUBLIC_LIB_ROOT — it must
 * NEVER statically import the heavy editor UI (`$lib/components/page-builder`).
 * The WP-3 public section renderer will live alongside this module; the WP-5
 * editor UI stays in `$lib/components/page-builder`.
 */

// Cross-worker journey model (page model + entitlements + resolver signature),
// re-exported from @codex/shared-types so FE code imports one surface.
export type {
  BrandTokenOverrides,
  ContentAccessPolicy,
  CourseAccessPath,
  CourseOffer,
  CourseSectionType,
  CourseTierOffer,
  Entitlement,
  EntitlementResolver,
  EntitlementSource,
  PageBuilderState,
  PageOffer,
  PageSection,
  PageSeo,
  PageStatus,
  ResolvedSectionDesign,
  ResourceType,
  SectionDesign,
  SectionProps,
  StoredEntitlementSource,
} from '@codex/shared-types';
// Remote-function contracts — signatures + read-model return types.
export type {
  CurriculumContentOption,
  EditorCurriculum,
  EditorPracticeView,
  EditorStageView,
  EnrolledJourneyCard,
  GetCourseDashboardQuery,
  GetCoursePageQuery,
  GetJourneyForBuilderQuery,
  GetJourneyLibraryQuery,
  JourneyCardView,
  JourneyContentType,
  JourneyCoursePage,
  JourneyCourseView,
  JourneyDashboardData,
  JourneyLibrary,
  JourneyLibraryContentItem,
  JourneyLibraryCourse,
  JourneyListItem,
  JourneyMonetisation,
  JourneyPageRecord,
  JourneyPracticeView,
  JourneyProgress,
  JourneyProgressStatus,
  JourneySellMedia,
  JourneyStageView,
  JourneyTestimonialView,
  JourneyTierOption,
  LibraryAccessSource,
  ListJourneysQuery,
} from './journey-queries';
