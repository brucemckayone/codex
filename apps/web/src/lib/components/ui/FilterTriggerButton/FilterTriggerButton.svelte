<!--
  @component FilterTriggerButton

  Compact circular icon button used to open a filter drawer. When any
  filter is active, the button picks up an interactive-coloured border
  and a small brand-coloured indicator dot in the top-right corner.

  Single canonical implementation — replaces the bespoke
  `.lt__filter-btn` and `.explore__filter-btn` rules.
-->
<script lang="ts">
  import { SlidersIcon } from '$lib/components/ui/Icon';

  interface Props {
    activeCount: number;
    onClick: () => void;
    ariaLabel: string;
    expanded?: boolean;
    title?: string;
    iconSize?: number;
  }

  const {
    activeCount,
    onClick,
    ariaLabel,
    expanded = false,
    title,
    iconSize = 16,
  }: Props = $props();

  const isActive = $derived(activeCount > 0);
  const badgeLabel = $derived(activeCount > 9 ? '9+' : String(activeCount));

  /**
   * Return focus to this trigger when the panel it opened closes — WCAG 2.4.3.
   *
   * Melt's own `closeFocus` cannot do it: this is a plain `<button>` calling the
   * parent's open setter rather than Melt's `$trigger`, so the dialog has no
   * element to restore focus to. All three close paths (Esc, overlay click, the
   * X) left `document.activeElement` on `<body>`, so a keyboard user had to Tab
   * from the top of the page again.
   *
   * The trigger is the right owner: it already receives `expanded`, so a
   * true→false transition IS the close event, and every consumer gets the fix
   * without the drawer having to guess which element invoked it.
   *
   * `wasExpanded` is a plain variable, not `$state` — it is a comparison key
   * read inside the effect, and making it reactive would re-trigger the effect
   * on its own write.
   */
  let btnEl: HTMLButtonElement | undefined = $state();
  let wasExpanded = false;
  $effect(() => {
    if (wasExpanded && !expanded) btnEl?.focus();
    wasExpanded = expanded;
  });
</script>

<button
  bind:this={btnEl}
  type="button"
  class="filter-trigger"
  class:filter-trigger--active={isActive}
  data-testid="filter-trigger"
  onclick={onClick}
  aria-haspopup="dialog"
  aria-expanded={expanded}
  aria-label={ariaLabel}
  {title}
>
  <SlidersIcon size={iconSize} />
  {#if isActive}
    <span class="filter-trigger__count" aria-hidden="true">{badgeLabel}</span>
  {/if}
</button>

<style>
  .filter-trigger {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    flex: 0 0 auto;
    box-sizing: border-box;
    width: var(--space-9);
    height: var(--space-9);
    padding: 0;
    line-height: 1;
    background: var(--color-surface);
    color: var(--color-text-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    cursor: pointer;
    transition:
      var(--transition-colors),
      var(--transition-shadow);
  }

  .filter-trigger:hover {
    color: var(--color-text);
    border-color: var(--color-border-strong);
    background: var(--color-surface-secondary);
  }

  .filter-trigger[aria-expanded='true'] {
    color: var(--color-text);
    border-color: var(--color-border-strong);
    background: var(--color-surface-secondary);
  }

  .filter-trigger:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset, 1px);
  }

  .filter-trigger--active {
    color: var(--color-interactive);
    border-color: var(--color-interactive);
  }

  .filter-trigger--active:hover {
    color: var(--color-interactive-hover);
    border-color: var(--color-interactive-hover);
  }

  /* Ring of --color-surface lifts the badge off any backing colour
     (panel hover, org branding) the trigger sits on. */
  .filter-trigger__count {
    position: absolute;
    top: calc(var(--space-0-5) * -1);
    right: calc(var(--space-0-5) * -1);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--space-4);
    height: var(--space-4);
    padding: 0 var(--space-1);
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
    border: var(--border-width) var(--border-style) var(--color-surface);
    border-radius: var(--radius-full);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    line-height: 1;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
</style>
