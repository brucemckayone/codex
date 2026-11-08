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
  - The outcome is judged on the query the page holds once Retry has run,
    which is not always the one it refreshed (see `heldRead`). With no value
    and no error (the page let the query go), it claims nothing.
  - Focus moves only if it is still where Retry left it.

  MOUNT IT UNCONDITIONALLY, beside the list it stands in for. It renders
  nothing visible until `query` fails, and its status line has to persist for
  the "loaded" announcement to be heard. The page decides what to hide, from
  `connectQueryState(query).kind === 'failed'`. During a Retry that reads
  `loading`, because kit hands the page a new query (see `heldRead`). A page
  that keeps its failed layout until the Retry settles binds `retrying` and
  treats `failed || retrying` as failed.

  The raw error is never rendered: the page logs it.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import * as m from '$paraglide/messages';
  import { Alert, Button } from '$lib/components/ui';
  import type { QueryResult } from '$lib/remote/query-result';
  import { connectQueryState } from '$lib/utils/connect-readiness';

  interface Props {
    /**
     * The list's remote query. `null` while it isn't being made. A kit query
     * is a promise of its read, which `heldRead` awaits.
     */
    query:
      | (QueryResult<unknown> &
          PromiseLike<unknown> & { refresh: () => Promise<unknown> })
      | null;
    /** "We couldn't load your …." */
    message: string;
    /** "We still couldn't load your …." after a Retry that failed. */
    againMessage: string;
    /** "… loaded." for the status line a successful Retry focuses. */
    loadedMessage: string;
    /** True while a Retry runs. Bind it to keep a failed layout until then. */
    retrying?: boolean;
    'data-testid'?: string;
  }

  let {
    query,
    message,
    againMessage,
    loadedMessage,
    retrying = $bindable(false),
    'data-testid': testId,
  }: Props = $props();

  const failed = $derived(connectQueryState(query).kind === 'failed');

  /** Outcome of the last Retry, for the copy and for where focus goes. */
  let outcome = $state<'ok' | 'failed' | null>(null);
  /** Repeat failures announced without a focus move; keys the message. */
  let repeats = $state(0);
  let alertNode = $state<HTMLElement | null>(null);
  let statusNode = $state<HTMLElement | null>(null);

  /**
   * The outcome is read from the query the page holds, not from whether a
   * read rejected: a failure stays on that query's own `.error` (kit clears
   * it only on success).
   */
  async function retry() {
    if (retrying || !query) return;
    const before = outcome;
    retrying = true;
    try {
      await heldRead(query);
    } finally {
      retrying = false;
    }
    outcome = outcomeOf(connectQueryState(query).kind);
    await tick();
    if (focusUnmoved()) {
      if (outcome === 'ok') statusNode?.focus();
      if (outcome === 'failed') alertNode?.focus();
    } else if (outcome === 'failed' && before === 'failed') {
      // Focus stays where the creator moved it, and the text is unchanged, so
      // `role="alert"` would say nothing: re-insert it so it is read out.
      repeats += 1;
    }
  }

  /**
   * Refreshes `refreshed`, then waits for the read of the query the page holds.
   *
   * Pages derive their query (`$derived(getX(id))`), and kit drops a query
   * whose first read FAILED from its cache (2.55, `create_remote_function`).
   * So `refresh()` re-runs the page's derivation, which is handed a NEW query,
   * still loading, with a read of its own. The refreshed query fetches again
   * as well, and that result is discarded: a Retry sends two reads, which is
   * kit's doing. Waiting on the refreshed query judged the Retry on the wrong
   * read: a repeat failure counted as a success, and a slow stray fetch kept
   * "Retrying…" beside the page that had loaded (Codex-zskbp).
   */
  async function heldRead(refreshed: NonNullable<Props['query']>) {
    const reread = refreshed.refresh();
    // The page's derivation is read lazily, so this is already the new query.
    const held = query;
    if (held !== refreshed) {
      void reread.catch(() => {
        // The stray fetch of a query the page let go: nobody reads its result.
      });
    }
    try {
      await (held === refreshed ? reread : held);
    } catch {
      // Kept on the held query's `.error`, which the outcome reads.
    }
  }

  /**
   * "ok" only for a value and "failed" only for an error. With neither, the
   * page let the query go (a refused thread passes `null`) or it is still
   * loading, and a claim either way would be wrong.
   */
  function outcomeOf(
    kind: ReturnType<typeof connectQueryState>['kind']
  ): 'ok' | 'failed' | null {
    if (kind === 'ok') return 'ok';
    if (kind === 'failed') return 'failed';
    return null;
  }

  /**
   * Focus is where Retry left it: on its button, or on <body> after the
   * alert unmounted with it. Anywhere else, the creator has moved on.
   */
  function focusUnmoved(): boolean {
    const active = document.activeElement;
    if (active === null || active === document.body) return true;
    return alertNode?.contains(active) ?? false;
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
<!-- Kept while a Retry runs: the page can be handed a new query that is still
     loading (see heldRead), and unmounting would drop the focused button. -->
{#if failed || retrying}
  <div bind:this={alertNode} class="load-failed" tabindex="-1">
    <Alert variant="error" data-testid={testId} aria-busy={retrying}>
      <div class="load-failed__row">
        {#key repeats}
          <p class="load-failed__message">
            {outcome === 'failed' ? againMessage : message}
          </p>
        {/key}
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
