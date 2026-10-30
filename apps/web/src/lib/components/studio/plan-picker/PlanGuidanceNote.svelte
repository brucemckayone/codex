<!--
  @component PlanGuidanceNote

  The ONE guidance note (Codex-2hxff.91, owner decision 2): "Pro doesn't
  include 2 items Basic has." It says that a dearer tier lacks something a
  cheaper tier has, by monthly price. Bundles are allowed, so it informs and
  never blocks: info tone, no dismiss, and it goes away as soon as the gap is
  closed. Warning amber stays for states that lock people out (the closed
  film).

  Every Studio placement renders this component: the film editor and the
  course builder (per item), the tier row and the tier checklist (per tier),
  and the create and delete dialogs (previews).

  @prop {Snippet} children - The sentence. Wrap its lead in <b>.
  @prop {GuidanceAction[]} [actions] - At most two: a button or a link.
  @prop {'default' | 'compact'} [size] - `compact` for hosts set in --text-xs.
-->
<script lang="ts" module>
  export interface GuidanceAction {
    label: string;
    /** A link when set; otherwise a button calling `onclick`. */
    href?: string;
    onclick?: () => void;
    /** An accessible name when the label alone is ambiguous. */
    ariaLabel?: string;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { AlertCircleIcon } from '$lib/components/ui/Icon';

  interface Props {
    children: Snippet;
    actions?: GuidanceAction[];
    size?: 'default' | 'compact';
    'data-testid'?: string;
  }

  const {
    children,
    actions = [],
    size = 'default',
    'data-testid': testId,
  }: Props = $props();
</script>

<div
  class="plan-gap-note"
  role="note"
  data-size={size === 'compact' ? 'compact' : undefined}
  data-testid={testId}
>
  <span class="plan-gap-note__icon" aria-hidden="true"><AlertCircleIcon size="1em" /></span>
  <p class="plan-gap-note__text">{@render children()}</p>
  {#if actions.length > 0}
    <div class="plan-gap-note__actions">
      {#each actions as action (action.label)}
        {#if action.href}
          <a class="plan-gap-note__action" href={action.href} aria-label={action.ariaLabel}>
            {action.label}
          </a>
        {:else}
          <button
            type="button"
            class="plan-gap-note__action"
            aria-label={action.ariaLabel}
            onclick={action.onclick}
          >
            {action.label}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  /* The tokens and shape of ui/Alert variant="info", plus a leading icon and
     the actions. */
  .plan-gap-note {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    column-gap: var(--space-2);
    row-gap: var(--space-1-5);
    align-items: start;
    margin: 0;
    padding: var(--space-2-5) var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    background-color: var(--color-status-info-surface);
    border: var(--border-width) var(--border-style) var(--color-status-info-border);
    color: var(--color-status-info-text);
  }

  .plan-gap-note[data-size='compact'] {
    font-size: var(--text-xs);
    padding: var(--space-2) var(--space-2-5);
  }

  .plan-gap-note__icon {
    display: inline-flex;
    margin-top: var(--space-0-5);
  }

  .plan-gap-note__text {
    margin: 0;
    min-width: 0;
    text-wrap: pretty;
  }

  .plan-gap-note__text :global(b) {
    font-weight: var(--font-semibold);
  }

  .plan-gap-note__actions {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
  }

  .plan-gap-note__action {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-weight: var(--font-semibold);
    color: inherit;
    text-decoration: underline;
    text-underline-offset: var(--space-0-5);
    cursor: pointer;
    white-space: nowrap;
  }

  .plan-gap-note__action:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-xs);
  }
</style>
