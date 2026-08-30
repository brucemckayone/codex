<!--
  @component PagePricingPanel

  The "Access & pricing" page-mode panel (Codex-2pryk.3.3 · WP-5, rewired by
  Codex-2pryk.2.4.2). Presents the journey's three ways-in — membership tiers, a
  course subscription, a one-off purchase. Prices are GBP (£), stored in pence.

  WHAT CHANGED AND WHY (Codex-2pryk.2.4.2): every control here used to write into
  `PageBuilderState.offer` — the page's jsonb PRESENTATION bag — and nothing else.
  No authoritative read consults that bag, so turning "Membership tiers" or
  "Course subscription" on had NO effect on what a buyer could purchase: the
  checkout composes its offer from `course_subscription_plans` and
  `course_tier_access`, and nothing could write either table. The panel validated
  the price, said "Page saved", and changed nothing about the product.

  So the two course-owned paths now edit the `monetisation` store, whose baseline
  is READ BACK from those tables — "on" means a plan row exists, "off" means it
  does not. The offer bag is still written, but DERIVED from that state by
  `builder-save`, so the sales page's teaser can no longer contradict the product.

  The one-off price stays on the page-builder store: `updateJourneyOffer` writes
  the authoritative `courses.price_cents` in the same transaction as the bag, so
  for that path the bag genuinely IS the presentation of its own authority.

  MEMBERSHIP TIERS ARE A PICKER, NOT A TOGGLE. Tier access is an exact set (SPEC
  §7, "not just min-tier"), so a boolean could never express which tiers include
  the course — it was unrepresentable state, which is the deeper reason the old
  toggle could not have worked even if it had been wired up.

  NOTE: the AUTHORITATIVE access RULE (who may enter) still lives on the
  course/content policy (SPEC §6.1) — this panel owns what the journey COSTS.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { monetisation } from '$lib/page-builder/monetisation-store.svelte';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';

  const offer = $derived(pageBuilder.pending?.offer ?? {});
  const isCoursePage = $derived(pageBuilder.pending?.subjectType === 'course');

  const draft = $derived(monetisation.draft);
  const tierOptions = $derived(monetisation.tierOptions);
  // A course page whose authoritative state failed to read must not offer edits:
  // the store reports `loaded: false` rather than an empty draft precisely so a
  // save cannot withdraw a live plan the panel never managed to see.
  const locked = $derived(isCoursePage && !monetisation.loaded);

  const poundsOf = (cents: number | null | undefined): string =>
    cents == null ? '' : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);

  // Price fields hold a LOCAL draft string while focused. Binding the input
  // straight to `poundsOf(cents)` made decimals untypeable: "12." parses to 12 →
  // 1200 pence → re-derives "12", so the DOM value snapped back and ate the ".".
  // The draft is authoritative during editing; blur clears it so the field falls
  // back to the canonical (normalised) pence value.
  type PriceKey = 'monthly' | 'annual' | 'oneOff';
  let drafts = $state<Partial<Record<PriceKey, string>>>({});

  const centsFor = (key: PriceKey): number | null => {
    if (key === 'monthly') return draft.priceMonthlyCents;
    if (key === 'annual') return draft.priceAnnualCents;
    return offer.oneOffPriceCents ?? null;
  };

  const shown = (key: PriceKey): string => drafts[key] ?? poundsOf(centsFor(key));

  function setPounds(key: PriceKey, value: string): void {
    drafts[key] = value;
    const pounds = Number.parseFloat(value);
    // Round to whole pence — a price is an integer of the smallest unit, and
    // fractional pence would fail the service's integer validation.
    const cents = Number.isFinite(pounds) ? Math.round(pounds * 100) : null;
    if (key === 'monthly') monetisation.setPriceMonthly(cents);
    else if (key === 'annual') monetisation.setPriceAnnual(cents);
    else pageBuilder.updateOffer({ oneOffPriceCents: cents });
  }

  function commitPounds(key: PriceKey): void {
    delete drafts[key];
  }

  /**
   * Everything that would make the save fail, checked here so the creator sees it
   * before spending a rate-limited commerce mutation. Each rule MIRRORS a server
   * rule (the worker remains the authority): `min(100)` and
   * `priceAnnual <= priceMonthly * 12` come from `upsertCourseSubscriptionPlanSchema`,
   * the enabled-needs-a-price rule from the monetisation command.
   */
  const problems = $derived.by<string[]>(() => {
    const out: string[] = [];
    if (draft.subscriptionEnabled) {
      if (draft.priceMonthlyCents == null)
        out.push(m.studio_builder_pricing_problem_monthly_required());
      if (draft.priceAnnualCents == null)
        out.push(m.studio_builder_pricing_problem_annual_required());
      if (draft.priceMonthlyCents != null && draft.priceMonthlyCents < 100)
        out.push(m.studio_builder_pricing_problem_monthly_min());
      if (draft.priceAnnualCents != null && draft.priceAnnualCents < 100)
        out.push(m.studio_builder_pricing_problem_annual_min());
      if (
        draft.priceMonthlyCents != null &&
        draft.priceAnnualCents != null &&
        draft.priceAnnualCents > draft.priceMonthlyCents * 12
      )
        out.push(m.studio_builder_pricing_problem_annual_cap());
    }
    if (offer.oneOffEnabled && offer.oneOffPriceCents == null)
      out.push(m.studio_builder_pricing_problem_oneoff_required());
    return out;
  });
</script>

<div class="panel">
  <header class="panel__head">
    <h2 class="panel__title">{m.studio_builder_pricing_title()}</h2>
    <p class="panel__sub">{m.studio_builder_pricing_sub()}</p>
  </header>

  <p class="panel__callout">
    {m.studio_builder_pricing_callout_before()} <b>{m.studio_builder_pricing_callout_offer()}</b> {m.studio_builder_pricing_callout_after()}
  </p>

  {#if monetisation.loadError}
    <p class="panel__warn" role="alert">{monetisation.loadError}</p>
  {:else if monetisation.loading}
    <p class="panel__callout" role="status">{m.studio_builder_pricing_loading()}</p>
  {/if}

  <p class="panel__group">{m.studio_builder_pricing_ways_in()}</p>

  <!-- ── Membership tiers: an exact SET, so a picker rather than a toggle ──── -->
  <div class="way way--stacked" class:way--on={draft.tierIds.length > 0}>
    <div class="way__row">
      <span class="way__copy">
        {m.studio_builder_pricing_tiers()}
        <small>
          {#if draft.tierIds.length > 0}
            {m.studio_builder_pricing_tiers_count({
              count: draft.tierIds.length,
              total: tierOptions.length,
            })}
          {:else}
            {m.studio_builder_pricing_tiers_pick()}
          {/if}
        </small>
      </span>
      <span class="way__price">{m.studio_builder_pricing_included()}</span>
    </div>

    {#if !isCoursePage}
      <p class="way__note">{m.studio_builder_pricing_tiers_course_only()}</p>
    {:else if tierOptions.length === 0 && monetisation.loaded}
      <p class="way__note">
        {m.studio_builder_pricing_tiers_none()}
      </p>
    {:else}
      <ul class="tiers">
        {#each tierOptions as tier (tier.id)}
          {@const checked = draft.tierIds.includes(tier.id)}
          <li>
            <button
              type="button"
              class="tier"
              class:tier--on={checked}
              aria-pressed={checked}
              disabled={locked}
              onclick={() => monetisation.toggleTier(tier.id)}
            >
              <span class="tier__box" aria-hidden="true"></span>
              <span class="tier__name">{tier.name}</span>
              <span class="tier__price">{m.studio_builder_pricing_tier_price({ price: poundsOf(tier.priceMonthly) })}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- ── Course subscription: a real Stripe plan, monthly + annual ─────────── -->
  <div class="way way--stacked" class:way--on={draft.subscriptionEnabled}>
    <div class="way__row">
      <button
        type="button"
        class="way__sw"
        aria-pressed={draft.subscriptionEnabled}
        aria-label={m.studio_builder_pricing_subscription_toggle()}
        disabled={locked || !isCoursePage}
        onclick={() => monetisation.setSubscriptionEnabled(!draft.subscriptionEnabled)}
      ></button>
      <span class="way__copy">{m.studio_builder_pricing_subscription()}<small>{m.studio_builder_pricing_subscription_note()}</small></span>
    </div>

    {#if !isCoursePage}
      <p class="way__note">{m.studio_builder_pricing_subscription_course_only()}</p>
    {:else}
      <div class="way__fields">
        <label class="field">
          <span class="field__label">{m.studio_builder_pricing_monthly()}</span>
          <span class="field__input">
            £<input
              inputmode="decimal"
              aria-label={m.studio_builder_pricing_monthly_aria()}
              disabled={locked}
              value={shown('monthly')}
              oninput={(e) => setPounds('monthly', e.currentTarget.value)}
              onblur={() => commitPounds('monthly')}
            />
          </span>
        </label>
        <label class="field">
          <span class="field__label">{m.studio_builder_pricing_annual()}</span>
          <span class="field__input">
            £<input
              inputmode="decimal"
              aria-label={m.studio_builder_pricing_annual_aria()}
              disabled={locked}
              value={shown('annual')}
              oninput={(e) => setPounds('annual', e.currentTarget.value)}
              onblur={() => commitPounds('annual')}
            />
          </span>
        </label>
      </div>
      <p class="way__note">
        {m.studio_builder_pricing_stripe_note()}
        <a href="/studio/monetisation">{m.studio_builder_pricing_payout_link()}</a>.
      </p>
    {/if}
  </div>

  <!-- ── One-off: `courses.price_cents`, written by the offer endpoint ─────── -->
  <div class="way" class:way--on={offer.oneOffEnabled}>
    <button
      type="button"
      class="way__sw"
      aria-pressed={!!offer.oneOffEnabled}
      aria-label={m.studio_builder_pricing_oneoff_toggle()}
      onclick={() => pageBuilder.updateOffer({ oneOffEnabled: !offer.oneOffEnabled })}
    ></button>
    <span class="way__copy">{m.studio_builder_pricing_oneoff()}<small>{m.studio_builder_pricing_oneoff_note()}</small></span>
    <span class="way__price">
      £<input
        class="way__input"
        inputmode="decimal"
        aria-label={m.studio_builder_pricing_oneoff_aria()}
        value={shown('oneOff')}
        oninput={(e) => setPounds('oneOff', e.currentTarget.value)}
        onblur={() => commitPounds('oneOff')}
      />
    </span>
  </div>

  {#if problems.length > 0}
    <ul class="panel__warn" role="status">
      {#each problems as problem (problem)}
        <li>{problem}</li>
      {/each}
    </ul>
  {/if}

  {#if offer.oneOffEnabled && !isCoursePage}
    <p class="panel__warn" role="status">
      {m.studio_builder_pricing_oneoff_course_only()}
    </p>
  {/if}

  <p class="panel__callout">
    <b>{m.studio_builder_pricing_membership_word()}</b> {m.studio_builder_pricing_membership_note()}
  </p>

  <p class="panel__callout">
    {m.studio_builder_pricing_save_note_before()} <b>{m.studio_builder_save()}</b>. {m.studio_builder_pricing_save_note_after()}
  </p>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .panel__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .panel__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  /* NO `--color-text-muted` in this panel, deliberately, and the guard in
     `page-builder/journey-palette.test.ts` now enforces it (Codex-6nb7i).
     Measured on the studio panel surface by canvas readback: muted at
     `--text-xs` is 2.52:1 light / 3.19:1 dark, under the 4.5 floor, and 13px is
     not WCAG "large text". This is a COMMERCE panel — the strings that were
     muted included a real field label ("Monthly"/"Annual"), a tier's price, the
     tier picker's only state read-out ("{n} of {m} include this journey") and
     the callout that explains what Save does to a price. None of those is
     decoration. `.way__sw::after` moved too: it is the toggle's only off-state
     indicator, so WCAG 1.4.11's 3:1 non-text floor applies to it.
     NOTE the ratio is a function of the ORG's brand background, not a constant:
     under `[data-org-brand]`, `--color-text-muted` derives from `--brand-bg`
     (tokens/org-brand.css) while `--color-text-secondary` mixes back from
     `--color-text` — which is what makes the swap safe on every brand rather
     than lucky on one. */
  .panel__sub {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .panel__group {
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .panel__callout {
    margin: 0;
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .panel__callout b {
    color: var(--color-text-secondary);
  }

  .panel__warn {
    margin: 0;
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-warning-200);
    border-radius: var(--radius-md);
    background-color: var(--color-warning-50);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-warning-700);
  }

  ul.panel__warn {
    padding-inline-start: var(--space-6);
    list-style: disc;
  }

  .way {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .way--stacked {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2-5);
  }

  .way__row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .way--on {
    border-color: color-mix(in oklab, var(--color-interactive) 40%, var(--color-border));
  }

  .way__sw {
    position: relative;
    flex: none;
    width: 34px;
    height: 20px;
    border: 0;
    border-radius: var(--radius-full);
    background-color: var(--color-surface-tertiary, var(--color-surface-secondary));
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .way__sw:disabled {
    cursor: not-allowed;
    opacity: var(--opacity-50);
  }

  .way__sw::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background-color: var(--color-text-secondary);
    transition: transform var(--duration-fast) var(--ease-default), background-color var(--duration-fast) var(--ease-default);
  }

  .way--on .way__sw {
    background-color: color-mix(in oklab, var(--color-interactive) 55%, var(--color-surface-secondary));
  }

  .way--on .way__sw::after {
    transform: translateX(14px);
    background-color: var(--color-interactive);
  }

  .way__sw:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .way__copy {
    flex: 1;
    display: flex;
    flex-direction: column;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .way__copy small {
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
  }

  .way__price {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .way__note {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .way__note a {
    color: var(--color-interactive);
  }

  .way__fields {
    display: flex;
    gap: var(--space-3);
  }

  .field {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field__label {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .field__input {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .way__input,
  .field__input input {
    width: 100%;
    min-width: 0;
    padding: var(--space-1) var(--space-1-5);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    text-align: right;
  }

  .way__input {
    width: 3.4rem;
  }

  .way__input:focus-visible,
  .field__input input:focus-visible {
    outline: none;
    border-color: var(--color-interactive);
  }

  .tiers {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tier {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    width: 100%;
    padding: var(--space-2) var(--space-2-5);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface);
    cursor: pointer;
    text-align: left;
    transition: var(--transition-colors);
  }

  .tier:disabled {
    cursor: not-allowed;
    opacity: var(--opacity-50);
  }

  .tier--on {
    border-color: color-mix(in oklab, var(--color-interactive) 45%, var(--color-border));
    background-color: color-mix(in oklab, var(--color-interactive) 8%, var(--color-surface));
  }

  .tier:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .tier__box {
    position: relative;
    flex: none;
    width: 16px;
    height: 16px;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-xs);
    background-color: var(--color-surface);
  }

  .tier--on .tier__box {
    border-color: var(--color-interactive);
    background-color: var(--color-interactive);
  }

  .tier--on .tier__box::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 5px;
    width: 4px;
    height: 8px;
    border: solid var(--color-surface);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  .tier__name {
    flex: 1;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .tier__price {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
</style>
