<!--
  @component FacetSheetUnread

  A phone sheet facet whose choices could not be read (Codex-a6ofh.3.3,
  owner): what failed, and a Try again, after the pills it can offer. The
  words are the desktop menu's (`createFacetRetry`).
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { createFacetRetry } from './facet-retry.svelte';
  import type { FacetUnread } from './list-option';

  interface Props {
    unread: FacetUnread;
  }

  const { unread }: Props = $props();

  const facetRetry = createFacetRetry(() => unread);
</script>

<div class="facet-unread">
  <p class="facet-unread-words" role="status">{facetRetry.words}</p>
  <button
    type="button"
    class="facet-unread-retry"
    aria-busy={facetRetry.retrying}
    onclick={() => void facetRetry.retry()}
  >
    {m.common_try_again()}
  </button>
</div>

<style>
  .facet-unread {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .facet-unread-words {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .facet-unread-retry {
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    cursor: pointer;
  }

  .facet-unread-retry:hover {
    text-decoration: underline;
  }

  .facet-unread-retry:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
