<!--
  @component LiveBar

  The top bar of a piece that has been live (Codex-a6ofh.2.5, mockup W5b):
  back, its state (Live, or Unpublished: its buyers keep it), the Page and
  Settings tabs, how many changes are not live yet (or that a move is waiting
  for what is on its way, with Stay and Leave now), and Discard and Update.
  Its changes wait for Update (owner 3A), so nothing half-finished goes out.
  The tabs are the editor's (`Tabs.Root` is the host's), so a switch keeps
  every change.

  @prop {DraftSession} session - The editor's draft session
  @prop {boolean} published - On sale now; false once unpublished
  @prop {() => void} onupdate - Send the changes
  @prop {() => void} ondiscard - Put every field back as it is live
  @prop {boolean} [updating] - Update was pressed and is sending
  @prop {string | null} [updateHint] - Why Update can't go yet; null when it can
  @prop {boolean} [waiting] - Something is on its way (a cover, an upload, a category): Discard waits for it
-->
<script lang="ts">
  import { Badge, Button } from '$lib/components/ui';
  import * as Tabs from '$lib/components/ui/Tabs';
  import * as m from '$paraglide/messages';
  import type { DraftSession } from './draft-session.svelte';
  import EditorBackLink from './EditorBackLink.svelte';
  import { CONTENT_LIST_HREF } from './editor-url';

  interface Props {
    session: DraftSession;
    published: boolean;
    onupdate: () => void;
    ondiscard: () => void;
    updating?: boolean;
    updateHint?: string | null;
    waiting?: boolean;
  }

  const {
    session,
    published,
    onupdate,
    ondiscard,
    updating = false,
    updateHint = null,
    waiting = false,
  }: Props = $props();

  const count = $derived(session.changeCount);
  /** A failed Update, while its changes are still here: Discard clears it. */
  const failed = $derived(session.status === 'error' && session.isDirty);
  /** A move waits for what is on its way: said here, and the creator can stay instead. */
  const leaving = $derived(session.leavingWhenSent);
  const changesWords = $derived.by(() => {
    if (leaving) return m.studio_live_leaving_held();
    if (updating) return m.studio_live_updating();
    if (count === 0) return m.studio_live_no_changes();
    return count === 1 ? m.studio_live_changes_one() : m.studio_live_changes({ count });
  });
  const hintId = $props.id();
</script>

<header class="live-bar">
  <EditorBackLink href={CONTENT_LIST_HREF} label={m.studio_editor_back()} />

  <div class="live-state">
    <Badge variant={published ? 'success' : 'neutral'} class="live-pill">
      {published ? m.studio_live_badge() : m.studio_live_badge_unpublished()}
    </Badge>
  </div>

  <Tabs.List class="live-tabs" variant="bare" aria-label={m.studio_live_tabs_label()}>
    <Tabs.Trigger value="page">{m.studio_live_tab_page()}</Tabs.Trigger>
    <Tabs.Trigger value="settings">{m.studio_live_tab_settings()}</Tabs.Trigger>
  </Tabs.List>

  <div class="live-actions">
    {#if failed}
      <span class="live-error" role="alert">{session.errorMessage ?? m.studio_content_draft_save_failed()}</span>
    {/if}
    <span class={['live-changes', { 'live-changes--some': count > 0 }]} role="status">{changesWords}</span>
    {#if leaving}
      <Button type="button" size="sm" variant="ghost" onclick={() => session.stay()}>
        {m.studio_live_leave_stay()}
      </Button>
      <Button type="button" size="sm" variant="ghost" onclick={() => void session.leaveNow()}>
        {m.studio_live_leave_now()}
      </Button>
    {/if}
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={count === 0 || updating || waiting}
      aria-describedby={waiting && updateHint !== null ? hintId : undefined}
      onclick={ondiscard}
    >
      {m.studio_live_discard()}
    </Button>
    <Button
      type="button"
      size="sm"
      disabled={count === 0 || updateHint !== null}
      loading={updating}
      aria-describedby={updateHint === null ? undefined : hintId}
      onclick={onupdate}
    >
      {m.studio_live_update()}
    </Button>
    {#if updateHint !== null}
      <span id={hintId} class="sr-only">{updateHint}</span>
    {/if}
  </div>
</header>

<style>
  .live-bar {
    position: sticky;
    inset-block-start: 0;
    z-index: var(--z-sticky);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-block-end: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface);
  }

  .live-state {
    display: flex;
    align-items: center;
  }

  /* Centred in the bar; the list is bare, so it brings no rule or gap of its own. */
  .live-bar :global(.live-tabs) {
    margin-inline: auto;
  }

  .live-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .live-changes {
    color: var(--color-text-secondary);
  }

  .live-changes--some {
    color: var(--color-text);
    font-weight: var(--font-medium);
  }

  .live-error {
    color: var(--color-error-700);
  }

  /* Phone (W8): the tabs take their own row (the back link hides its words itself). */
  @media (--below-md) {
    .live-bar :global(.live-tabs) {
      order: 3;
      flex-basis: 100%;
    }

    .live-actions {
      margin-inline-start: auto;
    }
  }
</style>
