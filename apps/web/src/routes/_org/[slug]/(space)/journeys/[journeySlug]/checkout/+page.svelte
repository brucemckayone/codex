<!--
  @component JourneyCheckout

  The offer/pay step — "one course, three ways in" (SPEC §7, FRONTEND-MAP §1
  checkout; prototype `docs/design/course-journeys/prototype/checkout.html`).

  An order-summary + payment SHELL over REAL data: the course and its order
  summary come from the frozen `getCoursePage` seam, and every offer — which
  ways in exist and what each one charges — comes from the authoritative
  `GET /courses/:id/offer` read (Codex-2pryk.2.4.3). Authored page-builder copy
  can only decorate a path that read returns; it can never invent one or set a
  price. The offer selection is fully interactive (radio-group → live fine print).

  The one thing this shell does NOT do yet is settle a payment: the Stripe
  session + the `entitlements` write on success are Codex-2pryk.2.4.4. Clicking
  "Continue" therefore surfaces the honest connect-in-progress seam rather than
  faking a purchase confirmation.

  IMMERSIVE PALETTE (D6 · the `.jp` pattern): this surface mirrors the sales
  page's candlelit reading — the semantic `--color-*` tokens are re-pointed to
  warm, low-chroma values DERIVED from the org's own `--color-brand-primary` via
  OKLCH relative colour, so it reads warm/dark on ANY brand and re-themes with
  the org brand + any per-page `brandOverrides`. Re-pointing `--color-heading`
  here is also what tames org-brand.css's heading override (it reads the same
  custom property). No hardcoded hex/px. Kept in sync with `JourneyRenderer`.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { buildJourneyUrl } from '@codex/urls';
  import { brandOverridesToStyleAttr } from '$lib/page-builder/render/brand-overrides';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const course = $derived(data.course);
  const offers = $derived(data.offers);
  const summary = $derived(data.summary);

  // Per-page brand overrides re-derive the palette for this subtree so the
  // checkout stays visually coherent with the sales page it continues.
  const brandStyle = $derived(brandOverridesToStyleAttr(data.brandOverrides));

  const salesUrl = $derived(
    buildJourneyUrl(
      page.url,
      { slug: course.slug, id: course.id },
      { surface: 'sales' }
    )
  );
  const dashboardUrl = $derived(
    buildJourneyUrl(
      page.url,
      { slug: course.slug, id: course.id },
      { surface: 'dashboard' }
    )
  );

  // The selected way in — deep-linkable via `?offer=`, then user-driven. `data`
  // seeds the preselection; a user pick (`override`) then wins. Deriving rather
  // than snapshotting `data` avoids capturing a stale server value and keeps the
  // selection correct if the loader re-runs with a different `?offer=`.
  let override = $state<string | null>(null);
  const selectedId = $derived(override ?? data.preselectedOfferId);
  const selectedOffer = $derived(
    offers.find((offer) => offer.id === selectedId) ?? offers[0]
  );

  // Live fine print follows the chosen path's KIND, not just its cadence — a
  // tier is a whole-org membership that happens to include this course, so
  // describing it as a course subscription would misstate what is being bought.
  const fineText = $derived.by(() => {
    if (!selectedOffer) return '';
    switch (selectedOffer.kind) {
      case 'tier':
        return `Billed ${selectedOffer.priceLabel} ${selectedOffer.cadenceLabel} for ${selectedOffer.name} — ${course.title} plus everything else it includes. Cancel anytime from your account.`;
      case 'subscription':
        return `Billed ${selectedOffer.priceLabel} ${selectedOffer.cadenceLabel} for ${course.title}. Cancel anytime from your account.`;
      default:
        return `One payment. ${course.title} stays in your library for good.`;
    }
  });

  // The pay CTA is wired only up to the WP-6 seam: clicking it reveals the
  // honest connect-in-progress note (no fake settlement). An already-enrolled
  // viewer skips it entirely — they're linked straight to the journey.
  let initiated = $state(false);
</script>

<svelte:head>
  <title>Choose your way into {course.title}</title>
  <!-- A per-user pay step is never a search target. -->
  <meta name="robots" content="noindex" />
</svelte:head>

{#snippet spark()}
  <svg
    class="mark"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6L8 1z"
      fill="currentColor"
    />
  </svg>
{/snippet}

<section
  class="checkout"
  data-org-brand={brandStyle ? '' : undefined}
  style={brandStyle}
>
  <div class="checkout__atmos" aria-hidden="true"></div>

  <div class="checkout__inner">
    <a class="checkout__back" href={salesUrl}>← Back to {course.title}</a>

    <header class="co-head">
      {#if course.kicker}
        <p class="co-head__kicker">{course.kicker}</p>
      {/if}
      <h1 class="co-head__title">Choose your way in</h1>
      {#if data.headNote}
        <p class="co-head__note">{data.headNote}</p>
      {/if}
    </header>

    <div class="co-grid">
      <!-- LEFT: what you're getting -->
      <aside class="summary">
        <div class="summary__cover">
          <span class="summary__cover-kicker">{summary.kicker}</span>
          <h2 class="summary__cover-title">{summary.title}</h2>
        </div>
        <div class="summary__body">
          <ul class="summary__list">
            {#each summary.bullets as bullet (bullet)}
              <li class="summary__item">
                <span class="summary__mark">{@render spark()}</span>
                <span>{bullet}</span>
              </li>
            {/each}
          </ul>
          <p class="summary__taste">
            Meet the practice before you decide.
            <a href={salesUrl}>Watch the intro →</a>
          </p>
        </div>
      </aside>

      <!-- RIGHT: the ways in -->
      <div class="ways">
        {#if offers.length > 0}
          <div
            class="offers"
            role="radiogroup"
            aria-label="Choose how to join {course.title}"
          >
            {#each offers as offer (offer.id)}
              <label class="offer" class:offer--selected={selectedId === offer.id}>
                <input
                  class="offer__input"
                  type="radio"
                  name="offer"
                  value={offer.id}
                  checked={selectedId === offer.id}
                  onchange={() => (override = offer.id)}
                />
                {#if offer.best}
                  <span class="offer__best">Best value</span>
                {/if}
                <span class="offer__radio" aria-hidden="true"></span>
                <div class="offer__body">
                  <h3 class="offer__name">{offer.name}</h3>
                  {#if offer.who}
                    <p class="offer__who">{offer.who}</p>
                  {/if}
                  {#if offer.blurb}
                    <p class="offer__blurb">{offer.blurb}</p>
                  {/if}
                  {#if offer.bullets.length > 0}
                    <ul class="offer__bullets">
                      {#each offer.bullets as item (item)}
                        <li>{item}</li>
                      {/each}
                    </ul>
                  {/if}
                </div>
                <div class="offer__price">
                  <span class="offer__price-amount">{offer.priceLabel}</span>
                  <span class="offer__price-cadence">{offer.cadenceLabel}</span>
                </div>
              </label>
            {/each}
          </div>

          <div class="co-actions">
            {#if data.enrolled}
              <a class="co-cta" href={dashboardUrl}>
                Enter the journey <span aria-hidden="true">→</span>
              </a>
              <span class="co-actions__fine">
                You already have access to {course.title}.
              </span>
            {:else}
              <button
                type="button"
                class="co-cta"
                onclick={() => (initiated = true)}
              >
                Continue <span aria-hidden="true">→</span>
              </button>
              <span class="co-actions__fine">{fineText}</span>
            {/if}
          </div>

          {#if initiated && !data.enrolled}
            <p class="co-seam" role="status">
              Secure checkout is being connected. Your choice — <b
                >{selectedOffer?.name}</b
              >
              ({selectedOffer?.priceLabel}) — is ready; payment goes live with the
              monetization release.
            </p>
          {/if}

          {#if data.priceNote}
            <p class="co-note">{data.priceNote}</p>
          {/if}

          <div class="co-trust">
            <span class="co-trust__item">
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M8 1a3 3 0 0 0-3 3v2H4.5A1.5 1.5 0 0 0 3 7.5v6A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 11.5 6H11V4a3 3 0 0 0-3-3zm0 1.4A1.6 1.6 0 0 1 9.6 4v2H6.4V4A1.6 1.6 0 0 1 8 2.4z"
                  fill="currentColor"
                />
              </svg>
              Secure checkout
            </span>
            <span class="co-trust__sep" aria-hidden="true">·</span>
            <span class="co-trust__item">No hidden fees — VAT included</span>
            <span class="co-trust__sep" aria-hidden="true">·</span>
            <span class="co-trust__item">Cancel anytime, from your account</span>
          </div>
        {:else}
          <p class="co-note">
            {course.title} isn't open for enrolment just now.
            <a href={salesUrl}>Back to the journey →</a>
          </p>
        {/if}

        {#if data.testimonial}
          <figure class="co-proof">
            <blockquote class="co-proof__quote">
              “{data.testimonial.quote}”
            </blockquote>
            <figcaption class="co-proof__by">
              — {data.testimonial.authorName}{#if data.testimonial.authorContext}, {data
                  .testimonial.authorContext}{/if}
            </figcaption>
          </figure>
        {/if}
      </div>
    </div>
  </div>
</section>

<style>
  /* ── Candlelit palette (mirrors JourneyRenderer `.journey-page`) ─────────── */
  .checkout {
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

    /* Hairlines — faint warm embers. */
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

    min-height: 100%;
    padding-block: var(--space-16) var(--space-24);
    padding-inline: var(--space-5);
    background: var(--color-background);
    color: var(--color-text);
    overflow: clip;
  }

  /* A single warm ember bloom near the top, fading into the deep body. */
  .checkout__atmos {
    position: absolute;
    z-index: -1;
    inset: 0 0 auto 0;
    height: min(70svh, 44rem);
    pointer-events: none;
    background: radial-gradient(
      60% 50% at 50% 0%,
      color-mix(in oklab, var(--color-brand-primary) 20%, transparent),
      transparent 70%
    );
  }

  .checkout__inner {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 68rem;
    margin-inline: auto;
  }

  .checkout__back {
    align-self: flex-start;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: color var(--duration-fast) var(--ease-default);
  }

  .checkout__back:hover {
    color: var(--color-text);
    text-decoration: underline;
  }

  /* ── Head ────────────────────────────────────────────────────────────────── */
  .co-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    text-align: center;
    margin-block-end: var(--space-4);
  }

  .co-head__kicker {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--color-brand-primary);
  }

  .co-head__title {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-4xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.01em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .co-head__note {
    margin: 0;
    font-size: var(--text-base);
    color: var(--color-text-secondary);
  }

  /* ── Grid ────────────────────────────────────────────────────────────────── */
  .co-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-8);
    align-items: start;
  }

  @media (--breakpoint-md) {
    .co-grid {
      grid-template-columns: 1fr 1.5fr;
    }
  }

  /* ── Left: the summary ─────────────────────────────────────────────────────*/
  .summary {
    border-radius: var(--radius-card);
    overflow: hidden;
    border: var(--border-width) solid var(--color-border-subtle);
    background: color-mix(in oklab, var(--color-surface) 70%, transparent);
  }

  @media (--breakpoint-md) {
    .summary {
      position: sticky;
      top: var(--space-20);
    }
  }

  .summary__cover {
    display: grid;
    align-content: end;
    gap: var(--space-1);
    min-height: 7rem;
    padding: var(--space-4) var(--space-5);
    background: radial-gradient(
      120% 130% at 30% 0%,
      color-mix(in oklab, var(--color-brand-primary) 48%, var(--color-surface)),
      var(--color-background)
    );
  }

  .summary__cover-kicker {
    font-size: var(--text-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: color-mix(in oklab, var(--color-heading) 80%, transparent);
  }

  .summary__cover-title {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-2xl);
    line-height: var(--leading-tight);
    color: var(--color-heading);
  }

  .summary__body {
    padding: var(--space-5);
  }

  .summary__list {
    display: grid;
    gap: var(--space-2-5);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .summary__item {
    display: flex;
    gap: var(--space-2-5);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .summary__mark {
    flex-shrink: 0;
    display: inline-flex;
    color: var(--color-brand-primary);
  }

  .summary__taste {
    margin: var(--space-4) 0 0;
    padding-block-start: var(--space-4);
    border-block-start: var(--border-width) solid var(--color-border-subtle);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--color-text-tertiary);
  }

  .summary__taste a {
    color: var(--color-brand-primary);
    text-decoration: none;
    white-space: nowrap;
  }

  .summary__taste a:hover {
    text-decoration: underline;
  }

  /* ── Right: the ways in ─────────────────────────────────────────────────────*/
  .ways {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .offers {
    display: grid;
    gap: var(--space-4);
  }

  .offer {
    position: relative;
    display: grid;
    grid-template-columns: var(--space-6) 1fr auto;
    gap: var(--space-4);
    align-items: start;
    padding: var(--space-5) var(--space-5-5);
    border-radius: var(--radius-card);
    border: var(--border-width) solid var(--color-border-subtle);
    background: color-mix(in oklab, var(--color-surface) 65%, transparent);
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease-default),
      background-color var(--duration-fast) var(--ease-default),
      transform var(--duration-fast) var(--ease-default);
  }

  .offer:hover {
    transform: translateY(-2px);
    border-color: var(--color-border-hover);
  }

  .offer--selected {
    border-color: var(--color-brand-primary);
    background: color-mix(in oklab, var(--color-brand-primary) 10%, transparent);
    box-shadow: inset 0 0 0 var(--border-width) var(--color-brand-primary);
  }

  /* The native radio drives selection + keyboard nav; it is visually replaced
     by `.offer__radio`, but stays focusable — the ring lands on the card. */
  .offer__input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .offer:has(.offer__input:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .offer__radio {
    inline-size: var(--space-5);
    block-size: var(--space-5);
    margin-block-start: var(--space-0-5);
    border-radius: var(--radius-full);
    border: var(--border-width-thick) solid var(--color-border-strong);
    display: grid;
    place-items: center;
    transition: border-color var(--duration-fast) var(--ease-default);
  }

  .offer--selected .offer__radio {
    border-color: var(--color-brand-primary);
  }

  .offer--selected .offer__radio::after {
    content: '';
    inline-size: var(--space-2-5);
    block-size: var(--space-2-5);
    border-radius: var(--radius-full);
    background: var(--color-brand-primary);
  }

  .offer__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
  }

  .offer__name {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-xl);
    color: var(--color-heading);
  }

  .offer__who {
    margin: 0;
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    color: var(--color-brand-primary);
  }

  .offer__blurb {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .offer__bullets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin: var(--space-1) 0 0;
    padding: 0;
    list-style: none;
  }

  .offer__bullets li {
    display: flex;
    gap: var(--space-1-5);
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  .offer__bullets li::before {
    content: '·';
    color: var(--color-brand-primary);
  }

  .offer__price {
    text-align: end;
    white-space: nowrap;
  }

  /* Narrow screens: drop the price onto its own row under the body (mirrors the
     prototype's < ~780px reflow) so a long price never crushes the columns. */
  @media (--below-md) {
    .offer {
      grid-template-columns: var(--space-5) 1fr;
    }

    .offer__price {
      grid-column: 2;
      text-align: start;
    }
  }

  .offer__price-amount {
    display: block;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    color: var(--color-heading);
  }

  .offer__price-cadence {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  .offer__best {
    position: absolute;
    top: 0;
    left: var(--space-5-5);
    transform: translateY(-50%);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    font-size: var(--text-2xs, var(--text-xs));
    font-weight: var(--font-bold);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-text-on-brand);
    background: var(--color-brand-primary);
  }

  /* ── Actions ────────────────────────────────────────────────────────────── */
  .co-actions {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    flex-wrap: wrap;
  }

  .co-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-8);
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-button);
    font-family: var(--font-body);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    line-height: var(--leading-none);
    text-decoration: none;
    color: var(--color-text-on-brand);
    background: var(--color-brand-primary);
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-default),
      transform var(--duration-fast) var(--ease-default);
  }

  .co-cta:hover {
    background: var(--color-brand-primary-hover);
  }

  .co-cta:active {
    transform: translateY(1px);
  }

  .co-cta:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .co-actions__fine {
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    max-width: 34ch;
  }

  .co-seam {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    border: var(--border-width) solid var(--color-border-subtle);
    background: color-mix(in oklab, var(--color-surface) 60%, transparent);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .co-seam b {
    color: var(--color-text);
    font-weight: var(--font-semibold);
  }

  .co-note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }

  .co-note a {
    color: var(--color-brand-primary);
    text-decoration: none;
  }

  .co-note a:hover {
    text-decoration: underline;
  }

  /* ── Trust cues ─────────────────────────────────────────────────────────── */
  .co-trust {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  .co-trust__item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
  }

  .co-trust__sep {
    opacity: 0.4;
  }

  /* ── Social proof ───────────────────────────────────────────────────────── */
  .co-proof {
    margin: 0;
    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-md);
    border: var(--border-width) solid var(--color-border-subtle);
    background: color-mix(in oklab, var(--color-surface) 55%, transparent);
  }

  .co-proof__quote {
    margin: 0;
    font-family: var(--font-heading);
    font-style: italic;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .co-proof__by {
    margin-block-start: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  @media (prefers-reduced-motion: reduce) {
    .checkout__back,
    .offer,
    .co-cta {
      transition: none;
    }

    .offer:hover {
      transform: none;
    }
  }
</style>
