<!--
  @component DangerZone

  Collapsed-by-default destructive action surface. Delete-content CTA lives
  here so it sits apart from the primary editing flow.

  @prop formPending   True while main form submit is in flight
  @prop deleting      True while delete is in flight
  @prop onDelete      Delete handler
-->
<script lang="ts">
  import { Button } from '$lib/components/ui';
  import * as m from '$paraglide/messages';
  import { ChevronDownIcon } from '$lib/components/ui/Icon';

  interface Props {
    formPending: boolean;
    deleting: boolean;
    onDelete: () => void;
  }

  const { formPending, deleting, onDelete }: Props = $props();

  let expanded = $state(false);
</script>

<div class="danger-zone" data-expanded={expanded || undefined}>
  <button
    type="button"
    class="danger-trigger"
    onclick={() => (expanded = !expanded)}
    aria-expanded={expanded}
    aria-controls="danger-body"
  >
    <span class="trigger-eyebrow">Danger zone</span>
    <span class="trigger-caption">Irreversible actions for this content</span>
    <span class="trigger-chevron" aria-hidden="true">
      <ChevronDownIcon size={16} />
    </span>
  </button>

  {#if expanded}
    <div class="danger-body" id="danger-body">
      <div class="danger-row">
        <div class="danger-text">
          <span class="danger-title">Delete this content</span>
          <p class="danger-desc">
            The content will be soft-deleted. Purchases and watch history will be preserved,
            but the item will no longer be accessible to viewers.
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          disabled={deleting || formPending}
          onclick={onDelete}
          loading={deleting}
        >
          {deleting ? 'Deleting…' : m.studio_content_form_delete()}
        </Button>
      </div>
    </div>
  {/if}
</div>

<style>
  .danger-zone {
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-error-500) 25%, var(--color-border));
    border-radius: var(--radius-lg);
    background-color: color-mix(in srgb, var(--color-error-500) 2%, var(--color-surface));
    overflow: hidden;
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .danger-zone[data-expanded] {
    border-color: color-mix(in srgb, var(--color-error-500) 50%, var(--color-border));
  }

  .danger-trigger {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: baseline;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-4) var(--space-5);
    border: 0;
    background: transparent;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
  }

  .danger-trigger:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -2px;
    border-radius: var(--radius-lg);
  }

  .trigger-eyebrow {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-error-600);
  }

  .trigger-caption {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .trigger-chevron {
    display: inline-flex;
    color: var(--color-text-muted);
    transition: transform var(--duration-normal) var(--ease-out);
  }

  .danger-zone[data-expanded] .trigger-chevron {
    transform: rotate(180deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .trigger-chevron { transition: none; }
  }

  .danger-body {
    padding: 0 var(--space-5) var(--space-5);
    border-top: var(--border-width) dashed
      color-mix(in srgb, var(--color-error-500) 25%, var(--color-border));
    animation: reveal var(--duration-normal) var(--ease-out);
  }

  @keyframes reveal {
    from {
      opacity: 0;
      transform: translateY(calc(-1 * var(--space-1)));
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .danger-body { animation: none; }
  }

  .danger-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-4);
  }

  @media (--breakpoint-md) {
    .danger-row {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-5);
    }
  }

  .danger-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .danger-title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .danger-desc {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-relaxed);
  }
</style>
