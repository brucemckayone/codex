<!--
  @component UnreadNote

  A list read that could not be read (owner, Codex-a6ofh.3.3): what failed,
  and a Try again. A phone sheet facet shows it after the pills it can offer;
  the content list's "Needs you" shows it in place of its chips. Its state is
  the caller's (`createFacetRetry`), so a sheet closed mid-retry reopens on it.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import type { FacetUnread } from './list-option';

  interface Props {
    unread: FacetUnread;
  }

  const { unread }: Props = $props();
</script>

<div class="unread-note">
  <p class="unread-note-words" role="status">{unread.words}</p>
  <button
    type="button"
    class="unread-note-retry"
    aria-busy={unread.retrying}
    onclick={() => void unread.retry()}
  >
    {m.common_try_again()}
  </button>
</div>

<style>
  .unread-note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .unread-note-words {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .unread-note-retry {
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    cursor: pointer;
  }

  .unread-note-retry:hover {
    text-decoration: underline;
  }

  .unread-note-retry:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
