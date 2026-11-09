<!--
  @component WentLiveNotice

  A draft's editor whose piece went live under it (Codex-a6ofh.2, owner
  2026-11-09). Its schedule fired, an admin published it, or another tab
  did, and the server refused the draft's save. Nothing more is sent from
  this editor. The notice says so, and its one button opens the piece in the
  live editor, carrying the changes not on it yet, to wait for Update.

  Always mounted: the alert is in the page before its words come, so they
  are heard when they do. Write and Publish both show it. A press that could
  not open it is said in the same alert, by why (signed out, gone, or a
  failure a try again can help); the changes stay. The step freezes around
  it (owner, 2026-11-09), so focus that was in the frozen part comes to its
  button, and comes back to it after a press that failed. The button carries
  the notice's words as its description, so they are heard even when the
  focus move cuts the alert off.

  @prop {DraftSession} session - The editor's draft session
  @prop {string | null} [waitFor] - Something still on its way (a cover, a file) that the hand-off would miss: Open waits, saying why where it is seen
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { Alert, Button } from '$lib/components/ui';
  import { focusIfLost } from '$lib/utils/focus-if-lost';
  import * as m from '$paraglide/messages';
  import type { DraftSession, OpenLiveProblem } from './draft-session.svelte';

  interface Props {
    session: DraftSession;
    waitFor?: string | null;
  }

  const { session, waitFor = null }: Props = $props();

  let opening = $state(false);
  let noticeEl = $state<HTMLElement | null>(null);
  const id = $props.id();
  const wordsId = `${id}-words`;
  const hintId = `${id}-wait`;
  const failedId = `${id}-failed`;

  const FAILED_WORDS: Record<OpenLiveProblem, () => string> = {
    'signed-out': m.studio_content_draft_signed_out,
    gone: m.studio_editor_not_found,
    outage: m.studio_editor_open_live_failed,
    slow: m.studio_editor_open_live_save_slow,
  };
  const problem = $derived(opening ? null : session.openLiveProblem);
  const describedBy = $derived(
    [wordsId, waitFor === null ? null : hintId, problem === null ? null : failedId]
      .filter((part) => part !== null)
      .join(' ')
  );

  // The step froze under the creator: focus that was in it comes here, once
  // the button can take it (it waits while something is on its way).
  $effect(() => {
    if (!session.wentLiveElsewhere || waitFor !== null) return;
    void tick().then(() => focusIfLost(noticeEl?.querySelector('button')));
  });

  async function open() {
    if (opening || waitFor !== null) return;
    opening = true;
    try {
      await session.openLive();
    } finally {
      opening = false;
    }
    // Still here, it did not open: the button went busy, which dropped
    // focus, so it comes back for the next try. Moved on, there is no button.
    await tick();
    focusIfLost(noticeEl?.querySelector('button'));
  }
</script>

<div class="went-live" role="alert" bind:this={noticeEl}>
  {#if session.wentLiveElsewhere}
    <Alert variant="warning" role="presentation" class="went-live-alert">
      <p id={wordsId} class="went-live-words">{m.studio_editor_went_live_elsewhere({ title: session.savedTitle })}</p>
      <Button
        type="button"
        size="sm"
        loading={opening}
        disabled={waitFor !== null}
        aria-describedby={describedBy}
        onclick={open}
      >
        {m.studio_editor_open_live()}
      </Button>
      <!-- In the freeze nothing else says why Open waits: said where it is seen. -->
      {#if waitFor !== null}
        <p id={hintId} class="went-live-wait">{waitFor}</p>
      {/if}
      {#if problem !== null}
        <p id={failedId} class="went-live-failed">{FAILED_WORDS[problem]()}</p>
      {/if}
    </Alert>
  {/if}
</div>

<style>
  .went-live {
    max-inline-size: var(--container-content);
    margin: var(--space-4) auto 0;
    padding-inline: var(--space-4);
  }

  /* Empty, out of the flow but still in the tree, so its words are heard when they come. */
  .went-live:empty {
    position: absolute;
    margin: 0;
    padding: 0;
  }

  .went-live :global(.went-live-alert) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .went-live-words {
    flex: 1;
    margin: 0;
  }

  .went-live-wait,
  .went-live-failed {
    flex-basis: 100%;
    margin: 0;
  }

  .went-live-wait {
    color: var(--color-text-secondary);
  }

  .went-live-failed {
    color: var(--color-status-error-text);
  }
</style>
