<!--
  @component RailControl

  A single titled control block inside a rail group: a heading, the "Affects:"
  chips (which product surfaces the control touches), then the REUSED
  brand-editor field component projected via the `children` snippet. This
  component owns presentation + the search-jump anchor only — it never touches
  the store; the reused child does that.

  Epic: Codex-cijzb · WP-1.5.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { RailControlMeta } from './rail-model';

  interface Props {
    control: RailControlMeta;
    /** Hidden when a search query excludes this control. */
    hidden?: boolean;
    /** The reused field component(s) bound to the store. */
    children: Snippet;
  }

  const { control, hidden = false, children }: Props = $props();

  const anchorId = $derived(`rail-control-${control.id}`);
  const headingId = $derived(`rail-control-${control.id}-heading`);
</script>

<div
  id={anchorId}
  class="rail-control"
  class:rail-control--hidden={hidden}
  data-rail-control={control.id}
>
  <div class="rail-control__head">
    <span class="rail-control__icon" aria-hidden="true">{control.icon}</span>
    <h3 id={headingId} class="rail-control__title">{control.label}</h3>
  </div>

  {#if control.affects.length > 0}
    <ul class="rail-control__affects" aria-label="Affects">
      <li class="rail-control__affects-label" aria-hidden="true">Affects</li>
      {#each control.affects as surface (surface)}
        <li class="rail-control__chip">{surface}</li>
      {/each}
    </ul>
  {/if}

  <div class="rail-control__body" role="group" aria-labelledby={headingId}>
    {@render children()}
  </div>
</div>

<style>
  .rail-control {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .rail-control--hidden {
    display: none;
  }

  .rail-control__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .rail-control__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-5);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .rail-control__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .rail-control__affects {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1-5);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rail-control__affects-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .rail-control__chip {
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-full);
  }

  .rail-control__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
</style>
