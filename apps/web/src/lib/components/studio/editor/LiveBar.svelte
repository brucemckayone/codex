<!--
  @component LiveBar

  The top bar of a piece that has been live (Codex-a6ofh.2.5, mockup W5b):
  back, its state (Live, or Unpublished: its buyers keep it), the Page and
  Settings tabs, how many changes are not live yet (or that a move is waiting
  for what is on its way, with Stay and Leave now), and Discard and Update.
  Its changes wait for Update (owner 3A), so nothing half-finished goes out.
  The tabs are the editor's (`Tabs.Root` is the host's), so a switch keeps
  every change.

  A piece leaving (Codex-a6ofh.6, mockup LN4) reads "Leaving", and a banner
  under the bar says when it goes and that its owners keep it until then,
  with Keep it: publishing is refused while it leaves, so Keep comes first.
  Edits still go with Update. A leave only the org's delete holds is a note
  with no Keep, and Delete it too: the creator's own delete beside the org's,
  so it leaves even if the org keeps it. Held by both, Keep it withdraws only
  the creator's, and a line says the org deleted it too (owner 2026-11-20).
  (`leaving`, here, is the other thing: a move off the page waiting for what
  is on its way.)

  @prop {DraftSession} session - The editor's draft session
  @prop {boolean} published - On sale now; false once unpublished
  @prop {() => Promise<unknown> | void} onupdate - Send the changes; focus goes to the changes line once it settles
  @prop {() => void} ondiscard - Put every field back as it is live
  @prop {boolean} [updating] - Update was pressed and is sending
  @prop {string | null} [updateHint] - Why Update can't go yet; null when it can
  @prop {boolean} [waiting] - Something is on its way (a cover, an upload, a category): Discard waits for it
  @prop {Leave | null} [leavesOn] - The piece's own leave: when, and whose delete holds it; null when it isn't leaving
  @prop {number} [owners] - How many people own it
  @prop {boolean} [ownersCanDownload] - They can download it until it goes
  @prop {boolean} [keeping] - Keep it was pressed and is sending
  @prop {() => void} [onkeep] - Keep it
  @prop {() => void} [ondeletetoo] - Delete it too, for a leave only the org's delete holds
  @prop {boolean} [deleting] - A delete is sending
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { Alert, Badge, Button } from '$lib/components/ui';
  import { ClockIcon } from '$lib/components/ui/Icon';
  import { focusIfLost } from '$lib/utils/focus-if-lost';
  import { formatSentenceDate } from '$lib/utils/format';
  import * as Tabs from '$lib/components/ui/Tabs';
  import * as m from '$paraglide/messages';
  import { canKeep, type Leave } from '../content-list/leaving-words';
  import type { DraftSession } from './draft-session.svelte';
  import EditorBarLink from './EditorBarLink.svelte';
  import { CONTENT_LIST_HREF } from './editor-url';

  interface Props {
    session: DraftSession;
    published: boolean;
    onupdate: () => Promise<unknown> | void;
    ondiscard: () => void;
    updating?: boolean;
    updateHint?: string | null;
    waiting?: boolean;
    leavesOn?: Leave | null;
    owners?: number;
    ownersCanDownload?: boolean;
    keeping?: boolean;
    onkeep?: () => void;
    ondeletetoo?: () => void;
    deleting?: boolean;
  }

  const {
    session,
    published,
    onupdate,
    ondiscard,
    updating = false,
    updateHint = null,
    waiting = false,
    leavesOn = null,
    owners = 0,
    ownersCanDownload = true,
    keeping = false,
    onkeep,
    ondeletetoo,
    deleting = false,
  }: Props = $props();

  /** The leave's day, in a sentence: "17 December". */
  const leaveDate = $derived(leavesOn ? formatSentenceDate(leavesOn.leavesAt) : '');
  /** Who owns it, and what they can do until then (LN4). */
  const ownersWords = $derived.by(() => {
    if (owners === 0) return m.studio_leaving_bar_off_sale();
    if (ownersCanDownload) {
      return owners === 1
        ? m.studio_leaving_bar_download_one()
        : m.studio_leaving_bar_download({ count: owners });
    }
    return owners === 1
      ? m.studio_leaving_bar_watch_one()
      : m.studio_leaving_bar_watch({ count: owners });
  });

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

  let changesEl = $state<HTMLElement | null>(null);
  /**
   * Update and Discard each disable themselves once pressed (busy, or with
   * nothing left), which drops focus: it goes to the line that says how it
   * went (the epic review).
   */
  async function settled(action: () => Promise<unknown> | void) {
    await action();
    await tick();
    focusIfLost(changesEl);
  }
</script>

<header class="live-bar">
  <EditorBarLink href={CONTENT_LIST_HREF} label={m.studio_editor_back()} />

  <div class="live-state">
    <Badge variant={leavesOn ? 'warning' : published ? 'success' : 'neutral'} class="live-pill">
      {leavesOn
        ? m.studio_leaving_status()
        : published
          ? m.studio_live_badge()
          : m.studio_live_badge_unpublished()}
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
    <span
      class={['live-changes', { 'live-changes--some': count > 0 }]}
      role="status"
      tabindex="-1"
      bind:this={changesEl}
    >{changesWords}</span>
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
      onclick={() => settled(ondiscard)}
    >
      {m.studio_live_discard()}
    </Button>
    <Button
      type="button"
      size="sm"
      disabled={count === 0 || updateHint !== null}
      loading={updating}
      aria-describedby={updateHint === null ? undefined : hintId}
      onclick={() => settled(onupdate)}
    >
      {m.studio_live_update()}
    </Button>
    {#if updateHint !== null}
      <span id={hintId} class="sr-only">{updateHint}</span>
    {/if}
  </div>

  {#if leavesOn}
    <!-- Furniture while it leaves, not news: Keep it's own toast says how that went. -->
    <Alert variant="warning" role="presentation" class="live-leaving">
      <span class="live-leaving-row">
        <ClockIcon size={16} />
        {#if canKeep(leavesOn)}
          <span class="live-leaving-words">
            <b>{m.studio_leaving_bar_title({ date: leaveDate })}</b>
            {ownersWords}
          </span>
          {#if onkeep}
            <Button type="button" size="sm" variant="secondary" loading={keeping} onclick={onkeep}>
              {m.studio_leaving_keep()}
            </Button>
          {/if}
          {#if leavesOn.heldBy === 'both'}
            <span class="live-leaving-also">{m.studio_leaving_bar_org_too()}</span>
          {/if}
        {:else}
          <span class="live-leaving-words">{m.studio_leaving_org_note({ date: leaveDate })}</span>
          {#if ondeletetoo}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              class="live-delete-too"
              loading={deleting}
              onclick={ondeletetoo}
            >
              {m.studio_leaving_delete_too()}
            </Button>
          {/if}
        {/if}
      </span>
    </Alert>
  {/if}
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

  .live-changes:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .live-changes--some {
    color: var(--color-text);
    font-weight: var(--font-medium);
  }

  .live-error {
    color: var(--color-status-error-text);
  }

  /* The banner (LN4): the bar's full width, under its controls. */
  .live-bar :global(.live-leaving) {
    flex-basis: 100%;
    order: 4;
  }

  .live-leaving-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
  }

  .live-leaving-row :global(svg) {
    flex-shrink: 0;
  }

  .live-leaving-words {
    flex: 1;
    min-width: 0;
  }

  /* Under the words and the Keep, on its own line. */
  .live-leaving-also {
    flex-basis: 100%;
    color: var(--color-text-secondary);
  }

  /* A sentence of a label: it wraps on a phone rather than run off the bar. */
  .live-bar :global(.live-delete-too) {
    white-space: normal;
    text-align: start;
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
