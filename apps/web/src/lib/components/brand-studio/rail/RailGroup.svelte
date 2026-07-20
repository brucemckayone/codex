<!--
  @component RailGroup

  One collapsible group in the control rail (Foundations / Identity / Hero).
  A controlled WAI-ARIA disclosure: a header button (`aria-expanded` +
  `aria-controls`) toggles a labelled region. Controlled — never owns its open
  state — so the rail's search can programmatically expand a group to reveal a
  jump target, and the change of state can't echo (no Melt controlled-value
  round-trip; see feedback_melt_controlled_components).

  Collapse uses the `hidden` attribute (display:none) rather than `{#if}` so the
  REUSED field components inside stay mounted and keep their local UI state
  (e.g. which colour accordion is open) across collapses and searches.

  Epic: Codex-cijzb · WP-1.5.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronDownIcon } from '$lib/components/ui/Icon';
  import type { RailGroupMeta } from './rail-model';

  interface Props {
    group: RailGroupMeta;
    /** Whether the region is expanded. Owned by the parent rail. */
    expanded: boolean;
    /** Whether this group is the current breadcrumb target. */
    active?: boolean;
    /** Hidden entirely when a search excludes every control it holds. */
    hidden?: boolean;
    /** Toggle request from the header button. */
    ontoggle: () => void;
    /** Fired when the header gains focus — lets the rail track the active group. */
    onactivate?: () => void;
    /** Roving arrow-key handler supplied by the parent for group-to-group jump. */
    onheaderkeydown?: (event: KeyboardEvent) => void;
    /** The group body — reused control blocks. */
    children: Snippet;
  }

  const {
    group,
    expanded,
    active = false,
    hidden = false,
    ontoggle,
    onactivate,
    onheaderkeydown,
    children,
  }: Props = $props();

  const regionId = $derived(`rail-group-${group.id}`);
</script>

<section class="rail-group" class:rail-group--hidden={hidden} data-rail-group={group.id}>
  <button
    type="button"
    class="rail-group__header"
    class:rail-group__header--active={active}
    aria-expanded={expanded}
    aria-controls={regionId}
    data-rail-group-header={group.id}
    onclick={ontoggle}
    onfocus={onactivate}
    onkeydown={onheaderkeydown}
  >
    <span class="rail-group__icon" aria-hidden="true">{group.icon}</span>
    <span class="rail-group__label">{group.label}</span>
    <span class="rail-group__chevron" class:rail-group__chevron--open={expanded} aria-hidden="true">
      <ChevronDownIcon size={16} />
    </span>
  </button>

  <div
    id={regionId}
    class="rail-group__region"
    role="region"
    aria-label={group.label}
    hidden={!expanded}
  >
    {@render children()}
  </div>
</section>

<style>
  .rail-group {
    display: flex;
    flex-direction: column;
    border-bottom: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .rail-group--hidden {
    display: none;
  }

  .rail-group__header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--color-text);
    transition: var(--transition-colors);
  }

  .rail-group__header:hover {
    background: var(--color-surface-secondary);
  }

  .rail-group__header:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: calc(-1 * var(--border-width-thick));
  }

  .rail-group__header--active {
    background: var(--color-surface-secondary);
  }

  .rail-group__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }

  .rail-group__label {
    flex: 1;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .rail-group__chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-muted);
    flex-shrink: 0;
    transition: transform var(--duration-normal) var(--ease-default);
  }

  .rail-group__chevron--open {
    transform: rotate(180deg);
  }

  .rail-group__region {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-2) var(--space-4) var(--space-5);
  }

  .rail-group__region[hidden] {
    display: none;
  }
</style>
