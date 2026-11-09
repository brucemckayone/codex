<!--
  @component WentLiveNotice

  A draft's editor whose piece went live under it (Codex-a6ofh.2, owner
  2026-11-09). Its schedule fired, an admin published it, or another tab
  did, and the server refused the draft's save. Nothing more is sent from
  this editor. The notice says so, and its one button opens the piece in the
  live editor, carrying the changes not on it yet, to wait for Update.

  Always mounted: the alert is in the page before its words come, so they
  are heard when they do. Write and Publish both show it.

  @prop {DraftSession} session - The editor's draft session
-->
<script lang="ts">
  import { Alert, Button } from '$lib/components/ui';
  import * as m from '$paraglide/messages';
  import type { DraftSession } from './draft-session.svelte';

  interface Props {
    session: DraftSession;
  }

  const { session }: Props = $props();

  let opening = $state(false);

  async function open() {
    if (opening) return;
    opening = true;
    try {
      await session.openLive();
    } finally {
      opening = false;
    }
  }
</script>

<div class="went-live" role="alert">
  {#if session.wentLiveElsewhere}
    <Alert variant="warning" role="presentation" class="went-live-alert">
      <p class="went-live-words">{m.studio_editor_went_live_elsewhere({ title: session.savedTitle })}</p>
      <Button type="button" size="sm" loading={opening} onclick={open}>
        {m.studio_editor_open_live()}
      </Button>
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
</style>
