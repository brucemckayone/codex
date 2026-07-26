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
  import SectionRenderer from './SectionRenderer.svelte';
  import { brandOverridesToStyleAttr } from './brand-overrides';
  import type { JourneySalesContext, SellPreview } from './types';
  import type { JourneyCoursePage } from '$lib/page-builder';

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
  }

  const { coursePage, sellPreview, enrolled = false }: Props = $props();

  const brandStyle = $derived(
    brandOverridesToStyleAttr(coursePage.page.brandOverrides)
  );

  const journeyTarget = $derived({
    slug: coursePage.course.slug,
    id: coursePage.course.id,
  });

  const checkoutUrl = $derived(
    buildJourneyUrl(page.url, journeyTarget, { surface: 'checkout' })
  );
  const dashboardUrl = $derived(
    buildJourneyUrl(page.url, journeyTarget, { surface: 'dashboard' })
  );

  const context: JourneySalesContext = $derived({
    course: coursePage.course,
    stages: coursePage.stages,
    testimonials: coursePage.testimonials,
    checkoutUrl,
    dashboardUrl,
    enrolled,
    sellPreview,
  });
</script>

<div
  class="journey-page"
  data-org-brand={brandStyle ? '' : undefined}
  style={brandStyle}
>
  <div class="journey-page__atmos" aria-hidden="true"></div>
  <SectionRenderer sections={coursePage.page.sections} {context} />
</div>

<style>
  /*
    IMMERSIVE, SELF-DERIVED PALETTE (D6 · the `.jp` pattern).

    The course sales page is a distinct, cinematic surface — deliberately darker
    and warmer than the org's everyday chrome, mirroring the prototype's
    candlelit reading. Rather than hardcode that mood, we DERIVE it from the org
    brand's own hue via OKLCH relative colour: every surface/text/border token is
    re-pointed to a warm, low-chroma value pulled from `--color-brand-primary`
    (its hue `h`, its chroma `c` softened). So the page reads warm/dark on ANY
    brand, and re-themes automatically with the org brand + any per-page
    `brandOverrides` — no hardcoded hex, no per-org branch.

    Re-pointing the SEMANTIC tokens here is also the fix for the org-brand.css
    heading override (`[data-org-brand] :is(h1..h6) { color: var(--color-heading) }`,
    spec 0,1,1): that rule reads the SAME custom property, so it inherits this
    subtree's re-pointed `--color-heading` and can't fight us on specificity.

    `--color-brand-primary` / `--color-text-on-brand` are left untouched — the
    warm brand accent + its on-accent text already read correctly on dark.
  */
  .journey-page {
    position: relative;
    isolation: isolate;

    /* Surfaces — deep, warm, ascending in lightness. */
    --color-background: oklch(from var(--color-brand-primary) 0.16 calc(c * 0.5) h);
    --color-surface: oklch(from var(--color-brand-primary) 0.21 calc(c * 0.45) h);
    --color-surface-secondary: oklch(
      from var(--color-brand-primary) 0.25 calc(c * 0.42) h
    );
    --color-surface-tertiary: oklch(
      from var(--color-brand-primary) 0.29 calc(c * 0.4) h
    );

    /* Text — warm bone → dim, high contrast on the deep surfaces. */
    --color-heading: oklch(from var(--color-brand-primary) 0.96 calc(c * 0.12) h);
    --color-text: oklch(from var(--color-brand-primary) 0.9 calc(c * 0.08) h);
    --color-text-secondary: oklch(
      from var(--color-brand-primary) 0.76 calc(c * 0.07) h
    );
    --color-text-tertiary: oklch(
      from var(--color-brand-primary) 0.62 calc(c * 0.07) h
    );

    /* Hairlines — faint warm embers stitching the sections together. */
    --color-border-subtle: oklch(
      from var(--color-brand-primary) 0.3 calc(c * 0.3) h
    );
    --color-border: oklch(from var(--color-brand-primary) 0.36 calc(c * 0.32) h);
    --color-border-strong: oklch(
      from var(--color-brand-primary) 0.44 calc(c * 0.34) h
    );
    --color-border-hover: oklch(
      from var(--color-brand-primary) 0.54 calc(c * 0.36) h
    );

    background: var(--color-background);
    color: var(--color-text);
    overflow: clip;
  }

  /*
    A single, page-wide atmosphere: a warm ember bloom near the top (behind the
    hero) fading into the deep body. Purely decorative, never load-bearing for
    legibility, and stilled under reduced motion (it doesn't animate anyway).
  */
  .journey-page__atmos {
    position: absolute;
    z-index: -1;
    inset: 0 0 auto 0;
    height: min(90svh, 60rem);
    pointer-events: none;
    background:
      radial-gradient(
        60% 50% at 50% 0%,
        color-mix(in oklab, var(--color-brand-primary) 22%, transparent),
        transparent 70%
      ),
      radial-gradient(
        40% 30% at 78% 12%,
        color-mix(in oklab, var(--color-brand-accent, var(--color-brand-primary)) 14%, transparent),
        transparent 68%
      );
  }
</style>
