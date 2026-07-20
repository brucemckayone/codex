<!--
  @component ChangeLedger

  Lists the fields whose PENDING value differs from SAVED (pending ≠ saved) and
  offers a per-field Reset that reverts that ONE field to its saved value via
  `brandEditor.resetField` — every other in-flight edit is preserved. The diff
  itself is the pure `diffBrandState` helper; this component is the disclosure +
  the reset wiring.

  Object-valued fields (the override maps) surface as a single ledger entry;
  resetting one reverts the whole map, matching resetField's top-level contract.

  Epic: Codex-cijzb · WP-1.5.
-->
<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import { diffBrandState } from './rail-model';

  let open = $state(false);

  const changes = $derived(diffBrandState(brandEditor.saved, brandEditor.pending));
  const count = $derived(changes.length);

  function reset(field: (typeof changes)[number]['field']) {
    brandEditor.resetField(field);
  }
</script>

<div class="ledger" data-change-count={count}>
  {#if count === 0}
    <p class="ledger__empty">No unsaved changes</p>
  {:else}
    <button
      type="button"
      class="ledger__summary"
      aria-expanded={open}
      aria-controls="change-ledger-list"
      onclick={() => (open = !open)}
    >
      <span class="ledger__dot" aria-hidden="true"></span>
      <span class="ledger__count">
        {count}
        {count === 1 ? 'change' : 'changes'}
      </span>
      <span class="ledger__review">{open ? 'Hide' : 'Review & reset'}</span>
    </button>

    <ul id="change-ledger-list" class="ledger__list" hidden={!open}>
      {#each changes as change (change.field)}
        <li class="ledger__item">
          <span class="ledger__label">{change.label}</span>
          <button
            type="button"
            class="ledger__reset"
            onclick={() => reset(change.field)}
          >
            Reset
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .ledger {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .ledger__empty {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .ledger__summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .ledger__summary:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .ledger__dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-interactive);
    flex-shrink: 0;
  }

  .ledger__count {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .ledger__review {
    margin-left: auto;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-interactive);
  }

  .ledger__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ledger__list[hidden] {
    display: none;
  }

  .ledger__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-surface-secondary);
  }

  .ledger__label {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .ledger__reset {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-sm);
  }

  .ledger__reset:hover {
    color: var(--color-interactive-hover);
    text-decoration: underline;
  }

  .ledger__reset:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }
</style>
