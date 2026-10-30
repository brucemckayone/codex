<!--
  @component AccessSection

  Access type (free / paid / subscribers / followers / team) + price + the
  tiers that include the item. Laid out horizontally on wide screens — a row
  of access cards then price / tiers revealed conditionally.

  THE TIERS (Codex-2hxff.91). The Subscribers card IS the subscribers-only
  switch; the shared PlanPicker says which tiers. With the card on and no
  tier ticked the item is CLOSED, never free, and the "Closed to subscribers"
  warning says so; the save is allowed (owner decision U2) and the publish
  readiness check asks for a tier. On One-time purchase the same picker is
  optional: in no tier the item is simply for sale.

  NOT LOADED IS NOT EMPTY. While the org's tier list is loading or after it
  failed, or when the item's own ticks never arrived, the picker is disabled
  and the hidden `includedTierIds` input is not rendered, so a save leaves the
  stored ticks exactly as they are (the course builder's rule, F7 in the
  mockup). A new item cannot pick Subscribers until the list loads. The host
  decides when the input is rendered at all (`sendTierIds`, owner decision
  U4); this component never sends a set it was not given.

  @prop form               Active form instance
  @prop tiers              The org's ACTIVE tiers (the options); `[]` until loaded
  @prop tiersState         Whether the options AND the item's ticks are loaded
  @prop selectedTierIds    The item's whole set, inactive tiers included
  @prop sendTierIds        Render the hidden `includedTierIds` input
-->
<script lang="ts">
  import { PRICE_LIMITS } from '@codex/constants';
  import { Alert, Button } from '$lib/components/ui';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import * as m from '$paraglide/messages';
  import type { createContentForm, updateContentForm } from '$lib/remote/content.remote';
  import type { SubscriptionTier } from '$lib/types';
  import { GlobeIcon, CreditCardIcon, CoinsIcon, UsersIcon, LockIcon } from '$lib/components/ui/Icon';
  import PlanPicker from '$lib/components/studio/plan-picker/PlanPicker.svelte';
  import PlanGuidanceNote from '$lib/components/studio/plan-picker/PlanGuidanceNote.svelte';
  import { itemGaps, joinNames } from '$lib/components/studio/plan-picker/select-from-tier';

  type ContentForm = typeof createContentForm | typeof updateContentForm;

  interface Props {
    form: ContentForm;
    tiers: SubscriptionTier[];
    /**
     * `loaded` only when the org's tier list AND the item's own ticks are
     * in hand. Anything else disables the picker and sends no set.
     */
    tiersState: 'loading' | 'loaded' | 'failed';
    /** Re-read the tier list (the failed state's Retry). */
    onRetryTiers?: () => void;
    /** A new item (create mode): a failed list keeps Subscribers unavailable. */
    isNew?: boolean;
    accessTypeVal: string;
    priceVal: string;
    selectedTierIds: readonly string[];
    /** Render the hidden `includedTierIds` input (the full set). */
    sendTierIds: boolean;
    derivedVisibility: string;
    onAccessChange: (value: string) => void;
    onTierToggle: (tierId: string) => void;
    onSelectFromTier: (tierId: string) => void;
    /**
     * Whether the creator's Stripe Connect account can receive money. When
     * false, the monetised access options (paid / subscribers) are disabled
     * with a "set up payouts" prompt — mirroring the authoritative backend
     * gate (ContentService.publish throws for monetised content without a
     * payout-ready account). Defaults true so the form never blocks before
     * status resolves.
     */
    connectReady?: boolean;
  }

  const {
    form,
    tiers,
    tiersState,
    onRetryTiers,
    isNew = false,
    accessTypeVal,
    priceVal,
    selectedTierIds,
    sendTierIds,
    derivedVisibility,
    onAccessChange,
    onTierToggle,
    onSelectFromTier,
    connectReady = true,
  }: Props = $props();

  // The worker refuses 1p–99p (Codex-2hxff.32); warn before the save does.
  const priceNum = $derived(parseFloat(priceVal || '0') || 0);
  const belowMinimum = $derived(Math.round(priceNum * 100) < PRICE_LIMITS.MIN_CENTS);

  const hasOrg = $derived(!!form.fields.organizationId?.value());
  const tiersLoaded = $derived(tiersState === 'loaded');
  const hasTiers = $derived(tiersLoaded && tiers.length > 0);
  const isSubscribers = $derived(accessTypeVal === 'subscribers');
  /**
   * The Subscribers card shows when the org has tiers, and ALSO for an item
   * that already is subscribers-only (a failed read must not hide the card
   * from a subscriber film, mockup F7) or while the list failed (so the
   * creator is told why it can't be picked). It can be newly picked only once
   * the list has loaded.
   */
  const showSubscribersCard = $derived(
    hasTiers || isSubscribers || (hasOrg && tiersState === 'failed')
  );
  const subscribersUnavailable = $derived(!tiersLoaded && !isSubscribers);

  // Org content routes payout setup to the monetisation hub; personal creator
  // content routes to the creator earnings page. Both are root-relative studio
  // paths (slug is in the subdomain).
  const payoutSetupHref = $derived(
    hasOrg ? '/studio/monetisation' : '/studio/earnings'
  );

  interface AccessOption {
    value: string;
    label: string;
    description: string;
    icon: typeof GlobeIcon;
    disabled?: boolean;
  }

  const options = $derived.by((): AccessOption[] => {
    const out: AccessOption[] = [
      {
        value: 'free',
        label: m.studio_content_form_access_free(),
        description: m.studio_content_form_access_free_desc(),
        icon: GlobeIcon,
      },
      {
        value: 'paid',
        label: m.studio_content_form_access_paid(),
        description: m.studio_content_form_access_paid_desc(),
        icon: CreditCardIcon,
        // Monetised — requires a payout-ready Connect account.
        disabled: !connectReady,
      },
    ];
    if (hasOrg) {
      out.push({
        value: 'followers',
        label: m.studio_content_form_access_followers(),
        description: m.studio_content_form_access_followers_desc(),
        icon: UsersIcon,
      });
    }
    if (showSubscribersCard) {
      out.push({
        value: 'subscribers',
        label: m.studio_content_form_access_subscribers(),
        description: m.studio_content_form_access_subscribers_desc(),
        icon: CoinsIcon,
        // Monetised — requires a payout-ready Connect account. And it can't
        // be newly picked over a tier list that didn't load.
        disabled: !connectReady || subscribersUnavailable,
      });
    }
    if (hasOrg) {
      out.push({
        value: 'team',
        label: m.studio_content_form_access_team(),
        description: m.studio_content_form_access_team_desc(),
        icon: LockIcon,
      });
    }
    return out;
  });

  // Show the payouts prompt when a monetised option is present but blocked.
  const showPayoutsHint = $derived(!connectReady);

  const showPrice = $derived(accessTypeVal === 'paid' || accessTypeVal === 'subscribers');
  // The tiers apply to two access modes:
  //   - 'subscribers': the switch is on; no tier ticked = CLOSED
  //   - 'paid':        optional (hybrid — purchasable AND included in tiers)
  // Visible on the 'paid' card too, otherwise a creator has no way to take a
  // hybrid item out of its tiers. Shown for a paid item that has ticks, or
  // whose list failed, even if the org has no active tier left.
  const showTier = $derived(
    isSubscribers ||
      (accessTypeVal === 'paid' &&
        (hasTiers || selectedTierIds.length > 0 || tiersState === 'failed'))
  );

  const visibleTicked = $derived(
    tiers.filter((t) => selectedTierIds.includes(t.id)).length
  );
  const closed = $derived(isSubscribers && tiersLoaded && selectedTierIds.length === 0);

  /** "Pro doesn't include this film, but Basic does." — one per dearer tier. */
  const gaps = $derived(tiersLoaded ? itemGaps(selectedTierIds, tiers) : []);

  /** The "Tiers that include this" value, for the hidden input. */
  const tierIdsValue = $derived(JSON.stringify([...selectedTierIds]));
</script>

<!-- Hidden inputs mirrored for form submit -->
<input type="hidden" name="accessType" value={accessTypeVal} />
<input type="hidden" name="visibility" value={derivedVisibility} />
<!-- Only when the host says the set may be sent (touched this session, and
     loaded): an absent field leaves the stored ticks alone. -->
{#if sendTierIds && tiersLoaded && showPrice}
  <input type="hidden" name="includedTierIds" value={tierIdsValue} />
{/if}
{#if !showPrice}
  <input type="hidden" name="price" value={priceVal} />
{/if}

<div class="access-root">
  <div
    class="access-grid"
    role="radiogroup"
    aria-label={m.studio_content_form_access_label()}
  >
    {#each options as option (option.value)}
      {@const Icon = option.icon}
      <label
        class="access-card"
        data-selected={accessTypeVal === option.value || undefined}
        data-disabled={option.disabled || undefined}
      >
        <input
          type="radio"
          name="_accessTypeRadio"
          value={option.value}
          checked={accessTypeVal === option.value}
          disabled={option.disabled}
          onchange={() => onAccessChange(option.value)}
          class="sr-only"
        />
        <span class="access-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        <span class="access-text">
          <span class="access-label">{option.label}</span>
          <span class="access-desc">{option.description}</span>
        </span>
        <span class="access-check" aria-hidden="true"></span>
      </label>
    {/each}
  </div>

  {#if showPayoutsHint}
    <p class="payouts-hint">
      {m.studio_content_form_access_payouts_hint()}
      <a href={payoutSetupHref} class="payouts-link">
        {m.studio_content_form_access_payouts_link()}
      </a>
    </p>
  {/if}

  {#if hasOrg && tiersState === 'failed' && !showTier}
    <!-- The Subscribers card is disabled above; say why, with Retry. -->
    <Alert variant="error" data-testid="tiers-failed-new">
      <span class="alert-row">
        <span>{isNew ? m.plan_picker_load_failed_new() : m.plan_picker_load_failed()}</span>
        {#if onRetryTiers}
          <Button variant="secondary" size="sm" type="button" onclick={onRetryTiers}>
            {m.plan_picker_retry()}
          </Button>
        {/if}
      </span>
    </Alert>
  {/if}

  {#if showPrice}
    <div class="conditional-row">
      <div class="cond-field">
        <label for="price" class="cond-label">
          {accessTypeVal === 'subscribers'
            ? m.studio_content_form_access_also_purchasable()
            : m.studio_content_form_price_label()}
        </label>
        <div class="price-wrapper">
          <span class="price-prefix" aria-hidden="true">&pound;</span>
          <input
            {...form.fields.price.as('text')}
            id="price"
            class="field-input price-input"
            min="0"
            step="0.01"
            placeholder={m.studio_content_form_price_placeholder()}
          />
        </div>
        {#if accessTypeVal === 'paid' && belowMinimum}
          <span class="field-warning">Paid content requires a price of at least &pound;1.00</span>
        {:else if accessTypeVal === 'subscribers' && priceNum > 0 && belowMinimum}
          <span class="field-warning">A price must be at least &pound;1.00, or &pound;0 if only available via subscription.</span>
        {:else if accessTypeVal === 'subscribers'}
          <span class="field-hint">Optional. Leave at &pound;0 if only available via subscription.</span>
        {/if}
      </div>

      {#if showTier}
        {@const fieldLabel = isSubscribers
          ? m.studio_content_form_access_tiers_label()
          : m.studio_content_form_access_tiers_optional_label()}
        <div class="cond-field" data-testid="tier-field">
          <span class="cond-label" id="tier-field-label">{fieldLabel}</span>
          {#if tiersState === 'failed'}
            <Alert variant="error" data-testid="tiers-failed">
              <span class="alert-row">
                <span>{m.plan_picker_load_failed()}</span>
                {#if onRetryTiers}
                  <Button variant="secondary" size="sm" type="button" onclick={onRetryTiers}>
                    {m.plan_picker_retry()}
                  </Button>
                {/if}
              </span>
            </Alert>
          {:else if tiersState === 'loading'}
            <div class="tier-skeleton" aria-hidden="true">
              <Skeleton width="100%" height="var(--space-9)" />
              <Skeleton width="100%" height="var(--space-9)" />
            </div>
          {:else}
            <PlanPicker
              {tiers}
              selected={selectedTierIds}
              label={fieldLabel}
              onToggle={onTierToggle}
              {onSelectFromTier}
            />
            <span class="field-hint picker-summary">
              {#if isSubscribers}
                {m.plan_picker_count_film({ count: visibleTicked, total: tiers.length })}{tiers.length > 1
                  ? ` ${m.plan_picker_shortcut_hint()}`
                  : ''}
              {:else if selectedTierIds.length > 0}
                {m.plan_picker_count_paid({ count: visibleTicked, total: tiers.length })}
              {:else}
                {m.plan_picker_none_paid()}
              {/if}
            </span>
            {#each gaps as gap (gap.dearer.id)}
              {@const cheaper = joinNames(gap.cheaper.map((t) => t.name))}
              <PlanGuidanceNote
                actions={[
                  {
                    label: m.plan_gap_tick({ tierName: gap.dearer.name }),
                    onclick: () => onTierToggle(gap.dearer.id),
                  },
                ]}
              >
                <b>
                  {gap.cheaper.length > 1
                    ? m.plan_gap_film_many({ dearer: gap.dearer.name, cheaper })
                    : m.plan_gap_film({ dearer: gap.dearer.name, cheaper })}
                </b>
                {m.plan_gap_film_body({ dearer: gap.dearer.name })}
              </PlanGuidanceNote>
            {/each}
            {#if closed}
              <Alert variant="warning" data-testid="tier-closed">
                <span class="alert-icon-row">
                  <LockIcon size={16} aria-hidden="true" />
                  <span>
                    <b>{m.plan_picker_closed_title()}</b>
                    {m.plan_picker_closed_body()}
                  </span>
                </span>
              </Alert>
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .access-root {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .access-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }

  @media (--breakpoint-sm) {
    .access-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (--breakpoint-xl) {
    .access-grid { grid-template-columns: repeat(3, 1fr); }
  }

  .access-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--space-3);
    align-items: flex-start;
    padding: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    background-color: var(--color-surface);
    transition:
      border-color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out),
      transform var(--duration-normal) var(--ease-out);
  }

  .access-card:hover {
    border-color: color-mix(in srgb, var(--color-interactive) 50%, var(--color-border));
    transform: translateY(calc(-1 * var(--border-width)));
  }

  @media (prefers-reduced-motion: reduce) {
    .access-card:hover { transform: none; }
  }

  .access-card:focus-within {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .access-card[data-selected] {
    border-color: var(--color-interactive);
    background-color: color-mix(in srgb, var(--color-interactive) 5%, var(--color-surface));
  }

  /* Monetised option blocked until payouts are set up. */
  .access-card[data-disabled] {
    cursor: not-allowed;
    opacity: var(--opacity-disabled, 0.5);
  }

  .access-card[data-disabled]:hover {
    border-color: var(--color-border);
    transform: none;
  }

  .payouts-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin: 0;
  }

  .payouts-link {
    color: var(--color-interactive);
    font-weight: var(--font-medium);
    text-decoration: underline;
  }

  .access-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    transition: var(--transition-colors);
  }

  .access-card[data-selected] .access-icon {
    background-color: color-mix(in srgb, var(--color-interactive) 15%, transparent);
    color: var(--color-interactive);
  }

  .access-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .access-label {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    letter-spacing: var(--tracking-tight);
  }

  .access-desc {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-relaxed);
  }

  .access-check {
    width: var(--space-4);
    height: var(--space-4);
    border-radius: var(--radius-full, 9999px);
    border: var(--border-width-thick) var(--border-style) var(--color-border);
    background: var(--color-surface);
    margin-top: var(--space-1);
    transition: border-color var(--duration-fast) var(--ease-out),
                background-color var(--duration-fast) var(--ease-out);
  }

  .access-card[data-selected] .access-check {
    border-color: var(--color-interactive);
    background-color: var(--color-interactive);
    box-shadow: inset 0 0 0 var(--space-1) var(--color-surface);
  }

  /* ── Conditional row ─────────────────────────────────────────── */
  .conditional-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    border: var(--border-width) dashed
      color-mix(in srgb, var(--color-interactive) 35%, var(--color-border));
  }

  @media (--breakpoint-md) {
    .conditional-row { grid-template-columns: minmax(0, 24rem) minmax(0, 1fr); }
  }

  .cond-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    min-width: 0;
  }

  .cond-label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-secondary);
  }

  .price-wrapper {
    display: flex;
    align-items: stretch;
  }

  .price-prefix {
    display: flex;
    align-items: center;
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-right: none;
    border-radius: var(--radius-md) 0 0 var(--radius-md);
  }

  .price-input {
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
  }

  .field-input {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-background);
    color: var(--color-text);
    transition: var(--transition-colors);
    width: 100%;
    font-family: inherit;
  }

  .field-input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset-inset);
    border-color: var(--color-border-focus, var(--color-focus));
  }

  .field-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .field-warning {
    font-size: var(--text-xs);
    color: var(--color-warning-600);
  }

  .picker-summary {
    color: var(--color-text-secondary);
  }

  .tier-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
  }

  /* A failed read: the sentence, then its Retry. */
  .alert-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
  }

  /* The closed warning: a leading lock, then the sentence. */
  .alert-icon-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    column-gap: var(--space-2);
    align-items: start;
    line-height: var(--leading-normal);
  }

  .alert-icon-row :global(svg) {
    margin-top: var(--space-0-5);
  }

  .alert-icon-row b {
    font-weight: var(--font-semibold);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
