<!--
  @component LiveSettings

  A live piece's Settings tab (Codex-a6ofh.2.5, mockup W5): the Publish
  step's sections (`PublishSettings`), whose changes wait for Update like
  the page's, then what only a live piece has. An audio piece's full-screen
  background goes with Update too. Unpublish (or Publish again) and Delete
  act at once: they are not changes to the piece. Both are the editor's
  (`LiveEditor`), so its bar's Delete it too and the Delete dialog's
  Unpublish instead do the same as these.

  While it leaves (Codex-a6ofh.6, mockup LN4), Publish again gives way to
  Keep it, since its leave refuses a publish, and there is no Delete: it is
  already going. A leave only the org's delete holds is a note with Delete
  it too, the creator's own delete beside the org's; held by both, Keep it
  withdraws only the creator's (owner 2026-11-20).

  Mounted the first time Settings opens, so its reads wait for that.

  @prop {DraftSession} session - The editor's draft session
  @prop {ContentWithRelations} content - The piece as read on arriving
  @prop {EditorContentType} contentType - The piece's type
  @prop {string | null} organizationId - The org it is filed in; null in the personal studio
  @prop {string | null} orgSlug - The org's slug, for its address
  @prop {string | null} [creatorUsername] - A personal piece's address
  @prop {string} authorName - Who it is by, on the card
  @prop {boolean} published - On sale now
  @prop {boolean} toggling - Unpublish, or Publish again, is sending
  @prop {() => Promise<void>} ontoggle - Unpublish, or publish again; it says how it went
  @prop {Leave | null} leavesOn - Its own leave; null when it isn't leaving
  @prop {boolean} keeping - Keep it is sending
  @prop {() => void} onkeep - Keep it
  @prop {boolean} deleting - A delete is sending
  @prop {() => void} ondelete - Delete…, or Delete it too: the editor's dialog asks
  @prop {(busy: boolean, failed: boolean) => void} [oncoverbusy] - A cover is being readied; failed once that ended in a problem
  @prop {(busy: boolean) => void} [oncategorybusy] - A category made here is on its way
  @prop {(invalid: boolean) => void} [onslugcheck] - What is typed in the link is not one
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Button } from '$lib/components/ui';
  import { focusIfLost } from '$lib/utils/focus-if-lost';
  import { formatSentenceDate } from '$lib/utils/format';
  import type { ContentWithRelations } from '$lib/types';
  import * as m from '$paraglide/messages';
  import ShaderPicker from '../content-form/ShaderPicker.svelte';
  import { canKeep, downloadLockedWords, type Leave } from '../content-list/leaving-words';
  import type { DraftSession, DraftValues } from './draft-session.svelte';
  import EditorSection from './EditorSection.svelte';
  import type { EditorContentType } from './editor-url';
  import { createPublishReads } from './publish-reads.svelte';
  import PublishSettings from './PublishSettings.svelte';

  interface Props {
    session: DraftSession;
    content: ContentWithRelations;
    contentType: EditorContentType;
    organizationId: string | null;
    orgSlug: string | null;
    creatorUsername?: string | null;
    authorName: string;
    published: boolean;
    toggling: boolean;
    ontoggle: () => Promise<void>;
    leavesOn: Leave | null;
    keeping: boolean;
    onkeep: () => void;
    deleting: boolean;
    ondelete: () => void;
    oncoverbusy?: (busy: boolean, failed: boolean) => void;
    oncategorybusy?: (busy: boolean) => void;
    onslugcheck?: (invalid: boolean) => void;
  }

  const {
    session,
    content,
    contentType,
    organizationId,
    orgSlug,
    creatorUsername = null,
    authorName,
    published,
    toggling,
    ontoggle,
    leavesOn,
    keeping,
    onkeep,
    deleting,
    ondelete,
    oncoverbusy,
    oncategorybusy,
    onslugcheck,
  }: Props = $props();

  const reads = createPublishReads({
    // The session's own values, the same object for its life.
    values: untrack(() => session.values),
    content: () => content,
    organizationId: () => organizationId,
  });

  function change<K extends keyof DraftValues>(key: K, value: DraftValues[K]) {
    session.set(key, value);
  }

  /** The cover is the session's, staged for Update (a staging cover line hands no undefined). */
  function setCover(next: string | null | undefined) {
    if (next !== undefined) change('thumbnailUrl', next);
  }

  const ids = $props.id();

  // ── Unpublish, or publish again ────────────────────────────────────────
  let toggleRow = $state<HTMLElement | null>(null);
  /**
   * The toggle says how it went (a toast either way); a failure leaves it as
   * it was. Busy while it goes, the pressed toggle loses focus: it has it
   * back once settled (the epic review).
   */
  async function togglePublished() {
    await ontoggle();
    await tick();
    focusIfLost(toggleRow?.querySelector('button'));
  }

  /**
   * While it leaves, the download switch holds as its owners were told when
   * it was deleted (owner 2026-11-21), until a Keep.
   */
  const downloadLocked = $derived(
    leavesOn === null ? null : downloadLockedWords(leavesOn.heldBy)
  );

  const lastOrdinal = $derived(contentType === 'audio' ? 5 : 4);
</script>

<div class="settings">
  <PublishSettings
    {session}
    {reads}
    {content}
    {contentType}
    {organizationId}
    {orgSlug}
    {creatorUsername}
    {authorName}
    onchange={change}
    savedCover={session.values.thumbnailUrl}
    oncoverchange={setCover}
    live
    {downloadLocked}
    {oncoverbusy}
    {oncategorybusy}
    {onslugcheck}
  />

  {#if contentType === 'audio'}
    <EditorSection headingId="{ids}-shader" ordinal={4} title={m.studio_live_shader()}>
      <p class="settings-hint">{m.studio_live_shader_hint()}</p>
      <ShaderPicker value={session.values.shaderPreset} onchange={(preset) => change('shaderPreset', preset)} />
    </EditorSection>
  {/if}

  <EditorSection headingId="{ids}-off" ordinal={lastOrdinal} title={m.studio_live_off()}>
    {#if leavesOn}
      {@const date = formatSentenceDate(leavesOn.leavesAt)}
      <div class="settings-off">
        {#if canKeep(leavesOn)}
          <p class="settings-hint">
            {leavesOn.heldBy === 'both'
              ? `${m.studio_leaving_bar_title({ date })} ${m.studio_leaving_bar_org_too()}`
              : m.studio_leaving_keep_hint({ date })}
          </p>
          <Button type="button" size="sm" variant="secondary" loading={keeping} onclick={onkeep}>
            {m.studio_leaving_keep()}
          </Button>
        {:else}
          <p class="settings-hint">{m.studio_leaving_org_note({ date })}</p>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            class="settings-delete-too"
            loading={deleting}
            onclick={ondelete}
          >
            {m.studio_leaving_delete_too()}
          </Button>
        {/if}
      </div>
    {:else}
      <div class="settings-off" bind:this={toggleRow}>
        <p class="settings-hint">{published ? m.studio_live_unpublish_hint() : m.studio_live_republish_hint()}</p>
        <Button type="button" size="sm" variant="secondary" loading={toggling} onclick={togglePublished}>
          {published ? m.studio_content_form_unpublish() : m.studio_live_republish()}
        </Button>
      </div>
      <div class="settings-off">
        <p class="settings-hint">{m.studio_live_delete_hint()}</p>
        <Button type="button" size="sm" variant="destructive" loading={deleting} onclick={ondelete}>
          {m.studio_live_delete()}
        </Button>
      </div>
    {/if}
  </EditorSection>
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    inline-size: 100%;
    max-inline-size: var(--container-settings);
    margin: 0 auto;
    padding: var(--space-8) var(--space-4) var(--space-12);
  }

  .settings-hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .settings-off {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
  }

  /* A sentence of a label: it wraps on a phone rather than run off the page. */
  .settings-off :global(.settings-delete-too) {
    white-space: normal;
    text-align: start;
  }
</style>
