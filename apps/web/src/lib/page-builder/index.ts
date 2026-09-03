/**
 * `$lib/page-builder` — the FE public/inert contract surface for the
 * Landing-Page-Builder & Guided-Journeys build (Codex-2pryk · WP-0).
 *
 * INERT by design: types + pure helpers only. It re-exports the cross-worker
 * journey contracts from `@codex/shared-types` (so the FE has ONE import surface,
 * the same pattern as `$lib/utils/subdomain` re-exporting `@codex/urls`) and adds
 * the FE-only inert helpers (section catalogue, preview protocol, remote-function
 * contracts).
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
// Section model — the catalogue + ordering + search + variants + design axes +
// factories. `resolveDesign` / `SECTION_DESIGN_*` are the design-language half
// (`docs/design/journey-sections/02-axis-contract.md`); they sit beside
// `resolveVariant` because both are pure, DOM-free and public-bundle safe.
export {
  createDefaultSections,
  createSection,
  defaultSectionOrder,
  findSectionDefinition,
  firstSectionMatch,
  listSectionDefinitions,
  resolveDesign,
  resolveVariant,
  SECTION_CATALOG,
  SECTION_DESIGN_AXES,
  SECTION_DESIGN_DEFAULTS,
  SECTION_DESIGN_VALUES,
  type SectionDefinition,
  type SectionDesignAxis,
  type SectionVariant,
  type SeededSection,
  sectionMatchesQuery,
  // The unauthored-copy check (Codex-maf0y), with its `SeededSection` row above.
  // Re-exported HERE and not only from `section-catalog` because its one intended
  // consumer is the studio PUBLISH path, which imports this barrel: while it was
  // absent from here, the only file in the repo that reached it was its own unit
  // test, and a pure advisory function nothing calls is indistinguishable from an
  // unfinished one — its docstring described a confirm that did not exist.
  seededSections,
  variantsForType,
} from './section-catalog';
