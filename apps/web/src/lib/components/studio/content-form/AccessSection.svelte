<!--
  @component AccessSection

  Access type (free / paid / subscribers / followers / team) + price + minimum tier.
  Laid out horizontally on wide screens — a row of access cards then price / tier
  revealed conditionally. Replaces the sidebar-stacked equivalent.

  @prop form             Active form instance
  @prop tiers            Available subscription tiers
  @prop accessTypeVal    Current access type
  @prop priceVal         Current price string
  @prop onAccessChange   Handler when access type changes
  @prop onTierChange     Handler when tier changes
  @prop selectedMinimumTierId
  @prop derivedVisibility
-->
<script lang="ts">
  import { Select } from '$lib/components/ui';
  import * as m from '$paraglide/messages';
  import type { createContentForm, updateContentForm } from '$lib/remote/content.remote';
  import type { SubscriptionTier } from '$lib/types';
  import { GlobeIcon, CreditCardIcon, CoinsIcon, UsersIcon, LockIcon } from '$lib/components/ui/Icon';

  type ContentForm = typeof createContentForm | typeof updateContentForm;

  interface Props {
    form: ContentForm;
    tiers: SubscriptionTier[];
    accessTypeVal: string;
    priceVal: string;
    selectedMinimumTierId: string;
    derivedVisibility: string;
    onAccessChange: (value: string) => void;
    onTierChange: (value: string | undefined) => void;
  }

  const {
    form,
    tiers,
    accessTypeVal,
    priceVal,
    selectedMinimumTierId,
    derivedVisibility,
    onAccessChange,
    onTierChange,
  }: Props = $props();

  const hasOrg = $derived(!!form.fields.organizationId?.value());
  const hasTiers = $derived(tiers.length > 0);

  interface AccessOption {
    value: string;
    label: string;
    description: string;
    icon: typeof GlobeIcon;
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
    if (hasTiers) {
      out.push({
        value: 'subscribers',
        label: m.studio_content_form_access_subscribers(),
        description: m.studio_content_form_access_subscribers_desc(),
        icon: CoinsIcon,
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

  const showPrice = $derived(accessTypeVal === 'paid' || accessTypeVal === 'subscribers');
  // Tier applies to two access modes:
  //   - 'subscribers': required (gates access entirely)
  //   - 'paid':        optional (hybrid — purchasable AND included for subscribers at tier)
  // Must be visible on the 'paid' card too, otherwise admins have no way to
  // remove a previously-set tier from hybrid content.
  const showTier = $derived(
    (accessTypeVal === 'subscribers' || accessTypeVal === 'paid') && hasTiers
  );
  const tierRequired = $derived(accessTypeVal === 'subscribers');

  const tierSelectOptions = $derived.by(() => {
    const first = tierRequired
      ? { value: '', label: 'Select a tier' }
      : { value: '', label: 'Not included in subscription' };
    return [first, ...tiers.map((t) => ({ value: t.id, label: t.name }))];
  });
</script>

<!-- Hidden inputs mirrored for form submit -->
<input type="hidden" name="accessType" value={accessTypeVal} />
<input type="hidden" name="visibility" value={derivedVisibility} />
<input type="hidden" name="minimumTierId" value={selectedMinimumTierId || ''} />
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
      <label class="access-card" data-selected={accessTypeVal === option.value || undefined}>
        <input
          type="radio"
          name="_accessTypeRadio"
          value={option.value}
          checked={accessTypeVal === option.value}
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
        {#if accessTypeVal === 'paid' && parseFloat(priceVal || '0') <= 0}
          <span class="field-warning">Paid content requires a price greater than &pound;0</span>
        {:else if accessTypeVal === 'subscribers'}
          <span class="field-hint">Optional. Leave at &pound;0 if only available via subscription.</span>
        {/if}
      </div>

      {#if showTier}
        <div class="cond-field">
          <span class="cond-label">
            {tierRequired ? 'Minimum tier' : 'Also included in subscription (optional)'}
          </span>
          <Select
            options={tierSelectOptions}
            value={selectedMinimumTierId}
            onValueChange={onTierChange}
            placeholder={tierRequired ? 'Select a minimum tier' : 'Not included in subscription'}
          />
          <span class="field-hint">
            {tierRequired
              ? 'Subscribers at or above this tier can access.'
              : 'Subscribers at or above this tier get it included with their subscription.'}
          </span>
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
    outline-offset: 2px;
  }

  .access-card[data-selected] {
    border-color: var(--color-interactive);
    background-color: color-mix(in srgb, var(--color-interactive) 5%, var(--color-surface));
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

  .field-input:focus {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -1px;
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
