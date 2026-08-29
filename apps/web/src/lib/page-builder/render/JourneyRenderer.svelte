<!--
  @component JourneyRenderer

  Top-level inert entry for a public journey sales page (SPEC §8.2). Assembles
  the read-only render context from the awaited {@link JourneyCoursePage} plus
  the streamed sell-preview promise, applies per-page brand overrides, and hands
  off to `SectionRenderer`.

  Brand model (D6 — inherit + override): when the page carries `brandOverrides`
  this renders inside a NESTED `[data-org-brand]` element whose inline `--brand-*`
  inputs re-derive the palette for the subtree; unset inputs inherit the org
  brand from the outer `.org-layout`. With no overrides it renders a plain
  wrapper that inherits the org brand wholesale. No JS in the override path.

  Reused by both the public route (`+page.svelte`) and WP-5's live-preview
  iframe, so it takes plain data + a promise and owns no data-fetching.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { buildJourneyUrl } from '@codex/urls';
  import * as m from '$paraglide/messages';
  import { deriveOfferPaths, findInviteSection } from '$lib/page-builder/offer-paths';
  import FloatingCta from './FloatingCta.svelte';
  import SectionRenderer from './SectionRenderer.svelte';
  import '../journey-palette.css';
  import { brandOverridesToStyleAttr } from './brand-overrides';
  import { aliasKeys, asStringFrom } from './coerce';
  import type { JourneySalesContext, SellPreview } from './types';
  import type {
    CourseOffer,
    JourneyCoursePage,
    SectionProps,
  } from '$lib/page-builder';

  interface Props {
    coursePage: JourneyCoursePage;
    /** Streamed public sell previews (30s preview.m3u8). May resolve to null. */
    sellPreview: Promise<SellPreview | null>;
    /**
     * Whether the current viewer is already enrolled — re-targets the CTA to the
     * dashboard. Optional so the studio builder preview (which never knows about
     * a viewer) renders the pre-purchase state by default.
     */
    enrolled?: boolean;
    /**
     * The authoritative offer (SPEC §7) the `invite` section prices itself from.
     * Optional + `null`-defaulted so a preview host that has no offer read still
     * renders — sections degrade to a price-less CTA rather than showing authored
     * numbers (Codex-2pryk.2.4.3).
     */
    offer?: CourseOffer | null;
  }

  const {
    coursePage,
    sellPreview,
    enrolled = false,
    offer = null,
  }: Props = $props();

  const brandStyle = $derived(
    brandOverridesToStyleAttr(coursePage.page.brandOverrides)
  );

  /*
    TWO TARGETS, TWO KEY-SPACES — and they are NOT interchangeable.

    This used to build ONE `journeyTarget` from `coursePage.course.slug` and hand
    it to both surfaces. But `/journeys/<slug>/checkout` resolves
    `landing_pages.slug` (`getCoursePage` → `GET /api/journeys/pages/by-slug`,
    whose own docstring says "here `slug` is the org-scoped LANDING-PAGE slug",
    filtering `eq(landingPages.slug, slug)`), while `/journeys/<slug>/dashboard`
    resolves `courses.slug` (`resolveCourseBySlug` → `api.access.courseBySlug`).

    The service layer states the hazard outright: "The public journey URL resolves
    `landing_pages.slug`, so a caller linking by `courses.slug` builds a DIFFERENT
    url than the org-landing rail … Callers building a sales-page link MUST prefer
    `pageSlug`/`pageId`" (`course-journey-service.ts`). The sell load beside this
    file already honours it in the other direction, and says why the mirror is not
    symmetric: "the key changes (page slug → course slug), so the mirrored
    fallback would build a URL that resolves to nothing" (`+page.server.ts`).

    The two slugs are independently authored. They agree on all seven seeded
    pages today, so the bug is latent rather than live — but it becomes live the
    moment a creator renames a course, or a second published page sells one course
    (">1 published page selling one course" is, per the same service, "the create
    path's convention, not a constraint"). When they drift, every primary CTA and
    the floating pill 404 with "This portal could not be found."
  */
  const checkoutUrl = $derived(
    buildJourneyUrl(
      page.url,
      { slug: coursePage.page.slug, id: coursePage.page.id },
      { surface: 'checkout' }
    )
  );
  const dashboardUrl = $derived(
    buildJourneyUrl(
      page.url,
      { slug: coursePage.course.slug, id: coursePage.course.id },
      { surface: 'dashboard' }
    )
  );

  /**
   * Whether the checkout can actually sell this course — see
   * {@link JourneySalesContext.purchasable} for the full reasoning.
   *
   * `offer === null` is checked FIRST and answers TRUE: null is a FAILED (or
   * absent) offer read, not an empty offer, and `deriveOfferPaths` returns `[]`
   * for both. Collapsing them would strip the buy button off a perfectly
   * purchasable page whenever the `.catch(() => null)`-guarded pricing read
   * hiccuped — the opposite defect, on the same element.
   *
   * The authored `invite` decorations are deliberately NOT passed: a decoration
   * may only rename a real path, never create one, so it cannot change the count.
   */
  const purchasable = $derived(
    offer === null
      ? true
      : deriveOfferPaths(offer, coursePage.course).length > 0
  );

  const context: JourneySalesContext = $derived({
    course: coursePage.course,
    stages: coursePage.stages,
    testimonials: coursePage.testimonials,
    checkoutUrl,
    dashboardUrl,
    enrolled,
    offer,
    purchasable,
    sellPreview,
  });

  /**
   * The floating pill's label — THE CREATOR'S OWN WORDS, not hardcoded English.
   *
   * It read `enrolled ? 'Continue →' : 'Begin →'`: two literals on a page whose
   * every section routes its chrome through `$paraglide/messages`, and which
   * ignored the `invite.ctaLabel` / `hero.ctaLabel` the creator typed. Measured
   * on studio-beta/bone-deep before this change: the invite CTA read the authored
   * "Begin" while the pill three inches below it read "Begin →" — the same button,
   * two labels, one of them untranslatable.
   *
   * The preference order is the pill's job, not a section's: the pill is the
   * page's standing conversion affordance, so the INVITE's label (the page's
   * actual offer) wins over the hero's opening label, and both are read through
   * `aliasKeys` so the builder's stored `button` key is honoured — that alias is
   * the `Codex-tqr51` fix, and skipping it is exactly how the hero used to
   * publish hardcoded English over a stored label.
   *
   * Resolved HERE and passed as a prop rather than added to
   * {@link JourneySalesContext}: no section reads it, and a field on the shared
   * context that only its own assembler consumes is a contract widened for
   * nothing.
   */
  const inviteProps: SectionProps = $derived(
    findInviteSection(coursePage.page.sections)?.props ?? {}
  );
  const heroProps: SectionProps = $derived(
    coursePage.page.sections.find(
      (s) => s.type === 'hero' && s.enabled !== false
    )?.props ?? {}
  );
  const pillLabel = $derived(
    enrolled
      ? m.journey_hero_cta_enrolled()
      : (asStringFrom(inviteProps, aliasKeys('invite', 'ctaLabel')) ??
        asStringFrom(heroProps, aliasKeys('hero', 'ctaLabel')) ??
        m.journey_invite_cta_default())
  );
</script>

<div
  class="journey-page journey-palette"
  data-org-brand={brandStyle ? '' : undefined}
  style={brandStyle}
>
  <div class="journey-page__atmos" aria-hidden="true"></div>
  <!--
    `journey-palette--page` MUST sit on this inner element, not on `.journey-page`
    itself: `--jp-ink` falls back to `--color-background`, so re-pointing
    `--color-background` on the same element that derives the ladder would be a
    custom-property cycle and both would be invalid at computed-value time. Here
    it inherits an already-resolved `--jp-ink`. See `../journey-palette.css`.
  -->
  <div class="journey-palette--page">
    <SectionRenderer
      sections={coursePage.page.sections}
      {context}
      pageDesign={coursePage.page.design}
    />
    <!--
      NO PILL WHERE THERE IS NOTHING TO BUY. An enrolled member always keeps it
      (it points at their dashboard, which exists), and a visitor keeps it only
      while the course has a real way in — otherwise the page's most persistent
      affordance is a fixed pill that follows the reader down the whole page to
      deliver them to "isn't open for enrolment just now".
    -->
    {#if enrolled || purchasable}
      <FloatingCta
        href={enrolled ? dashboardUrl : checkoutUrl}
        label={coursePage.course.title}
        ctaText={pillLabel}
      />
    {/if}
  </div>
</div>

<style>
  /*
    The palette itself lives in `../journey-palette.css` — ONE derivation shared
    with the builder canvas and the checkout. This block is layout only.

    It used to declare its own ~15-token palette derived from
    `--color-brand-primary` at a HARDCODED dark lightness with no light branch,
    which overwrote the per-page `brandOverrides` background one level up and gave
    a creator with a light theme a dark red live page (Codex-gfg50). A course
    sales page is a browsing surface, not an immersive player surface: it now
    follows the background the creator actually chose, and the candlelit reading
    is what you get by choosing a dark background.
  */
  .journey-page {
    position: relative;
    isolation: isolate;
    background: var(--jp-ink);
    color: var(--jp-text);
    overflow: clip;
  }

  /*
    A single, page-wide atmosphere: a warm ember bloom near the top (behind the
    hero) fading into the body. Purely decorative, never load-bearing for
    legibility, and stilled under reduced motion (it doesn't animate anyway).

    The bloom is a FIXED-strength gradient; `--jp-atmos-veil` is what makes its
    apparent strength track the ink's darkness. The veil is painted FIRST, which
    in the `background` shorthand means topmost, and is the ink's own colour — so
    outside the bloom it is ink-over-ink and invisible, while over the bloom it
    washes it back to a faint tint on a light page and leaves it untouched on a
    dark one. See `../journey-palette.css` for the alpha curve.
  */
  .journey-page__atmos {
    position: absolute;
    z-index: -1;
    inset: 0 0 auto 0;
    height: min(90svh, 60rem);
    pointer-events: none;
    background:
      linear-gradient(var(--jp-atmos-veil), var(--jp-atmos-veil)),
      radial-gradient(
        60% 50% at 50% 0%,
        color-mix(in oklab, var(--jp-ember) 22%, transparent),
        transparent 70%
      ),
      radial-gradient(
        40% 30% at 78% 12%,
        color-mix(in oklab, var(--jp-rose) 14%, transparent),
        transparent 68%
      );
  }
</style>
