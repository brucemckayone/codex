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
    the label reads "Retrying…" and a second click sends nothing (unless a
    load read's refresh settled with nothing changed: see `createLoadRetry`).
  - A Retry that fails again says "We still couldn't…" and puts focus back on
    the alert, so a repeat of identical text is still read out.
  - A Retry that loads it moves focus to a status line that says so, because
    the alert unmounts with the focused button inside it.
  - The outcome is judged on the query the page holds once Retry has run,
    which is not always the one it refreshed (`createLoadRetry`, in
    `./load-retry.svelte`). With no value and no error (the page let the
    query go), it claims nothing.
  - A list read from the page's load (`loadRead`), not a remote query, works
    too: its Retry ends when the page's data changes, and a refresh that
    settles with nothing changed offers Retry again (`createLoadRetry`).
  - Focus moves only if it is still where Retry left it, or nowhere
    (`focusIsFree`, the rule the studio's other Try agains share).

  The judgement is `createLoadRetry`'s; this is its error-alert rendering. A
  failure UI with a design of its own uses `createLoadRetry` directly.

  MOUNT IT UNCONDITIONALLY, beside the list it stands in for. It renders
  nothing visible until `query` fails, and its status line has to persist for
  the "loaded" announcement to be heard. The page decides what to hide, from
  `connectQueryState(query).kind === 'failed'`. During a Retry that reads
  `loading`, because kit hands the page a new query (`createLoadRetry`). A
  page that keeps its failed layout until the Retry settles binds `retrying`
  and treats `failed || retrying` as failed.

  The raw error is never rendered: the page logs it.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { Alert, Button } from '$lib/components/ui';
  import { connectQueryState } from '$lib/utils/connect-readiness';
  import type { AlertRead } from './alert-read';
  import { createLoadRetry } from './load-retry.svelte';

  interface Props {
    /**
     * The list's read. `null` while it isn't being made. Either the page's
     * remote query as it is (a promise of its read, which `createLoadRetry`
     * awaits), or a read of the page's load made by `loadRead`
     * (`./alert-read`).
     */
    query: AlertRead | null;
    /** "We couldn't load your …." */
    message: string;
    /** "We still couldn't load your …." after a Retry that failed. */
    againMessage: string;
    /** "… loaded." for the status line a successful Retry focuses. */
    loadedMessage: string;
    /**
     * True while a Retry runs, including a load read's that waits with Retry
     * offered again. Bind it to keep a failed layout until then.
     */
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

  const kind = $derived(connectQueryState(query).kind);
  const failed = $derived(kind === 'failed');

  /** Outcome of the last Retry, for the copy and for where focus goes. */
  let outcome = $state<'ok' | 'failed' | null>(null);
  /** Repeat failures announced without a focus move; keys the message. */
  let repeats = $state(0);
  let alertNode = $state<HTMLElement | null>(null);
  let statusNode = $state<HTMLElement | null>(null);

  // The judgement (which read, `retrying`/`busy`, whether focus may move)
  // is the shared core's. `retrying` is told at once, so a page that binds
  // it keeps its failed layout through kit's swap.
  const core = createLoadRetry(() => query, {
    onretrying: (value) => {
      retrying = value;
    },
  });

  /**
   * The outcome is read from the query the page holds, not from whether a
   * read rejected: a failure stays on that query's own `.error` (kit clears
   * it only on success).
   */
  async function retry() {
    const before = outcome;
    const result = await core.retry({
      from: () => alertNode,
      settled: (read) => {
        outcome = outcomeOf(connectQueryState(read).kind);
        return () =>
          outcome === 'ok' ? statusNode : outcome === 'failed' ? alertNode : null;
      },
    });
    if (result === null) {
      // Superseded: the page let the query go mid-Retry (or moved to another
      // one). Claim nothing, so no stale "still" is left behind. A press that
      // sent nothing (`busy`) leaves the running Retry's outcome alone.
      if (!core.retrying) outcome = null;
      return;
    }
    if (!result.focusFree && outcome === 'failed' && before === 'failed') {
      // Focus stays where the creator moved it, and the text is unchanged, so
      // `role="alert"` would say nothing: re-insert it so it is read out.
      repeats += 1;
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
     loading (see createLoadRetry), and unmounting would drop the focused
     button. -->
{#if failed || retrying}
  <div bind:this={alertNode} class="load-failed" tabindex="-1">
    <Alert variant="error" data-testid={testId} aria-busy={core.busy}>
      <div class="load-failed__row">
        {#key repeats}
          <p class="load-failed__message">
            {outcome === 'failed' ? againMessage : message}
          </p>
        {/key}
        <Button variant="secondary" size="sm" onclick={retry}>
          {core.busy
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
