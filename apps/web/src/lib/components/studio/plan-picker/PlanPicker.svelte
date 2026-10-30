<!--
  @component PlanPicker

  The ONE tier picker (Codex-2hxff.91): the film editor's Access & price, the
  course builder's Membership tiers, and the delete dialog's "Move them to
  other tiers" all render this list. Each row ticks one tier; "and above" on a
  row ticks that tier and every dearer one and unticks the cheaper ones
  (owner decision U1: dearer by MONTHLY price, the guidance note's yardstick).
  The shortcut whose set equals the ticks is drawn in the accent colour,
  without its underline, and carries `aria-current`, so the shape is seen at
  a glance and heard, never colour alone. It is a snapshot, not a rule: a
  tier created later is not added.

  The group (role + name) sits on the wrapper, not the `<ul>`: a role on the
  list would strip its list semantics from the rows.

  Rows are sorted by monthly price, cheapest first. Ticks on tiers that are
  not options (an inactive tier, kept for its existing subscribers) are never
  shown as rows and never dropped: the host keeps them in `selected`, and the
  picker says "Also in 1 hidden tier".

  The host owns the set (`selected`) and applies each change; this component
  only reports which row was pressed. It renders no summary, note or warning:
  those are worded per host.

  @prop {PickerTier[]} tiers - The tiers that can be ticked here.
  @prop {readonly string[]} selected - The item's whole set, hidden ticks included.
  @prop {(tierId: string) => void} onToggle - A row was pressed.
  @prop {(tierId: string) => void} [onSelectFromTier] - "and above" was pressed. Omit to hide the shortcut.
  @prop {boolean} [disabled] - Nothing can be changed (a read failed, or a save is out).
  @prop {string} [label] - The group's accessible name.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import {
    hiddenTierIds,
    isAndAboveSelection,
    offersAndAbove,
    type PickerTier,
    tiersByPrice,
  } from './select-from-tier';

  interface Props {
    tiers: readonly PickerTier[];
    selected: readonly string[];
    onToggle: (tierId: string) => void;
    onSelectFromTier?: (tierId: string) => void;
    disabled?: boolean;
    label?: string;
  }

  const {
    tiers,
    selected,
    onToggle,
    onSelectFromTier,
    disabled = false,
    label,
  }: Props = $props();

  const rows = $derived(tiersByPrice(tiers));
  const hiddenCount = $derived(hiddenTierIds(selected, tiers).length);

  /** "£12/mo", or "£4.99/mo" for an odd price: the course builder's own format. */
  function priceLabel(pence: number): string {
    const pounds = (pence / 100).toFixed(pence % 100 === 0 ? 0 : 2);
    return m.studio_builder_pricing_tier_price({ price: pounds });
  }
</script>

<div class="plan-picker" role="group" aria-label={label}>
  <ul class="tiers">
    {#each rows as tier (tier.id)}
      {@const on = selected.includes(tier.id)}
      {@const shortcut = onSelectFromTier && offersAndAbove(tier.id, tiers)}
      <li>
        <div class="tier-row" class:tier-row--on={on} class:tier-row--locked={disabled}>
          <button
            type="button"
            class="tier"
            aria-pressed={on}
            {disabled}
            onclick={() => onToggle(tier.id)}
          >
            <span class="tier__box" aria-hidden="true"></span>
            <span class="tier__name">{tier.name}</span>
            <span class="tier__price">{priceLabel(tier.priceMonthly)}</span>
          </button>
          {#if shortcut}
            <button
              type="button"
              class="tier__above"
              aria-current={isAndAboveSelection(selected, tier.id, tiers) ? 'true' : undefined}
              aria-label={m.plan_picker_and_above_aria({ tierName: tier.name })}
              {disabled}
              onclick={() => onSelectFromTier?.(tier.id)}
            >
              {m.plan_picker_and_above()}
            </button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
  {#if hiddenCount > 0}
    <p class="plan-picker__hidden">
      {hiddenCount === 1
        ? m.plan_picker_hidden_one()
        : m.plan_picker_hidden_other({ count: hiddenCount })}
    </p>
  {/if}
</div>

<style>
  .plan-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    min-width: 0;
  }

  .tiers {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tiers li {
    margin: 0;
  }

  /* The row carries the border and tint (they used to sit on the toggle), so
     "and above" can sit inside it. --color-border, not --color-border-subtle:
     an unticked row's edge all but vanished on the dark panel surface, and it
     is the control's boundary. */
  .tier-row {
    display: flex;
    align-items: stretch;
    min-width: 0;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface);
    transition: var(--transition-colors);
  }

  .tier-row--on {
    border-color: color-mix(in oklab, var(--color-interactive) 45%, var(--color-border));
    background-color: color-mix(in oklab, var(--color-interactive) 8%, var(--color-surface));
  }

  .tier-row--locked {
    opacity: var(--opacity-50);
  }

  .tier {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-2-5);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .tier:disabled,
  .tier__above:disabled {
    cursor: not-allowed;
  }

  .tier:focus-visible,
  .tier__above:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .tier__box {
    position: relative;
    flex: none;
    width: var(--space-4);
    height: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-xs);
    background-color: var(--color-surface);
  }

  .tier-row--on .tier__box {
    border-color: var(--color-interactive);
    background-color: var(--color-interactive);
  }

  .tier-row--on .tier__box::after {
    content: '';
    position: absolute;
    top: 18%;
    left: 32%;
    width: 25%;
    height: 50%;
    border: solid var(--color-surface);
    border-width: 0 var(--border-width-thick) var(--border-width-thick) 0;
    transform: rotate(45deg);
  }

  .tier__name {
    flex: 1;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .tier__price {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  /* The shortcut: ticks this tier and every dearer one. */
  .tier__above {
    flex: none;
    display: inline-flex;
    align-items: center;
    min-height: var(--space-6);
    padding: 0 var(--space-2-5);
    border: 0;
    border-inline-start: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: transparent;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    white-space: nowrap;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
    text-underline-offset: var(--space-0-5);
  }

  .tier-row--on .tier__above {
    border-inline-start-color: color-mix(in oklab, var(--color-interactive) 30%, var(--color-border-subtle));
  }

  .tier__above[aria-current='true'] {
    color: var(--color-interactive);
    text-decoration: none;
  }

  .plan-picker__hidden {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
</style>
