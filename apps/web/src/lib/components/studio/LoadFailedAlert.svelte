<!--
  @component LoadFailedAlert

  "We couldn't load your …" with Retry, for a Studio list whose read FAILED
  (Codex-2hxff.74). A rejected remote query has `current: undefined`, and the
  pages used to cover that with `?? []`, so a failed read looked like an empty
  list: every creator read "No agreement" with a Propose button, and an owner
  with three tiers saw "No tiers yet" with Create Tier. The page now renders
  this in place of the list and hides what depends on it.

  The same alert, copy pattern and behaviour as Monetisation's payout-account
  alert (Codex-2hxff.45, `money_setup_load_failed*`):
  - Retry keeps the alert (and the focused button) in place while it runs: no
    `loading` on the Button, which would disable it and drop focus to <body>;
    the label reads "Retrying…" and a second click sends nothing.
  - A Retry that fails again says "We still couldn't…" and puts focus back on
    the alert, so a repeat of identical text is still read out.
  - A Retry that loads it moves focus to a status line that says so, because
    the alert unmounts with the focused button inside it.

  MOUNT IT UNCONDITIONALLY, beside the list it stands in for. It renders
  nothing visible until `query` fails, and its status line has to persist for
  the "loaded" announcement to be heard. The page decides what to hide, from
  `connectQueryState(query).kind === 'failed'`.

  The raw error is never rendered: the page logs it.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import * as m from '$paraglide/messages';
  import { Alert, Button } from '$lib/components/ui';
  import type { QueryResult } from '$lib/remote/query-result';
  import { connectQueryState } from '$lib/utils/connect-readiness';

  interface Props {
    /** The list's remote query. `null` while it isn't being made. */
    query: (QueryResult<unknown> & { refresh: () => Promise<unknown> }) | null;
    /** "We couldn't load your …." */
    message: string;
    /** "We still couldn't load your …." after a Retry that failed. */
    againMessage: string;
    /** "… loaded." for the status line a successful Retry focuses. */
    loadedMessage: string;
    'data-testid'?: string;
  }

  const {
    query,
    message,
    againMessage,
    loadedMessage,
    'data-testid': testId,
  }: Props = $props();

  const failed = $derived(connectQueryState(query).kind === 'failed');

  let retrying = $state(false);
  /** Outcome of the last Retry, for the copy and for where focus goes. */
  let outcome = $state<'ok' | 'failed' | null>(null);
  let alertNode = $state<HTMLElement | null>(null);
  let statusNode = $state<HTMLElement | null>(null);

  /**
   * The outcome is read from the query, not from whether `refresh()` threw:
   * a failure stays on the query's own `.error` (kit clears it only on
   * success), which keeps this alert mounted.
   */
  async function retry() {
    if (retrying || !query) return;
    retrying = true;
    try {
      await query.refresh();
    } catch {
      // Kept on `query.error`; see above.
    }
    outcome = failed ? 'failed' : 'ok';
    retrying = false;
    await tick();
    (outcome === 'ok' ? statusNode : alertNode)?.focus();
  }
</script>

<p
  bind:this={statusNode}
  class="sr-only"
  role="status"
  aria-live="polite"
  tabindex="-1"
>
  {outcome === 'ok' && !failed ? loadedMessage : ''}
</p>
{#if failed}
  <div bind:this={alertNode} class="load-failed" tabindex="-1">
    <Alert variant="error" data-testid={testId} aria-busy={retrying}>
      <div class="load-failed__row">
        <p class="load-failed__message">
          {outcome === 'failed' ? againMessage : message}
        </p>
        <Button variant="secondary" size="sm" onclick={retry}>
          {retrying
            ? m.money_setup_load_failed_retrying()
            : m.money_setup_load_failed_retry()}
        </Button>
      </div>
    </Alert>
  </div>
{/if}

<style>
  /* Takes focus after a Retry that failed again; shown for keyboard users. */
  .load-failed:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-md);
  }

  /* Text and Retry side by side, the button straight after the prose rather
     than at the far edge of the column (as Monetisation's `.return-alert`). */
  .load-failed__row {
    display: grid;
    gap: var(--space-3);
    align-items: start;
  }

  @media (--breakpoint-sm) {
    .load-failed__row {
      grid-template-columns: minmax(0, auto) auto;
      justify-content: start;
      align-items: center;
      column-gap: var(--space-5);
    }
  }

  .load-failed__message {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-normal);
    color: inherit;
    text-wrap: pretty;
  }
</style>
