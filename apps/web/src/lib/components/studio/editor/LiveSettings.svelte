<!--
  @component LiveSettings

  A live piece's Settings tab (Codex-a6ofh.2.5, mockup W5): the Publish
  step's sections (`PublishSettings`), whose changes wait for Update like
  the page's, then what only a live piece has. An audio piece's full-screen
  background goes with Update too. Unpublish (or Publish again) and Delete
  act at once: they are not changes to the piece.

  Mounted the first time Settings opens, so its reads wait for that.

  @prop {DraftSession} session - The editor's draft session
  @prop {ContentWithRelations} content - The piece as read on arriving
  @prop {EditorContentType} contentType - The piece's type
  @prop {string | null} organizationId - The org it is filed in; null in the personal studio
  @prop {string | null} orgSlug - The org's slug, for its address
  @prop {string | null} [creatorUsername] - A personal piece's address
  @prop {string} authorName - Who it is by, on the card
  @prop {boolean} published - On sale now
  @prop {(published: boolean) => void} onpublishedchange - Unpublished, or published again
  @prop {(busy: boolean, failed: boolean) => void} [oncoverbusy] - A cover is being readied; failed once that ended in a problem
  @prop {(busy: boolean) => void} [oncategorybusy] - A category made here is on its way
  @prop {(invalid: boolean) => void} [onslugcheck] - What is typed in the link is not one
-->
<script lang="ts">
  import { ERROR_CODES } from '@codex/constants';
  import { tick, untrack } from 'svelte';
  import { Button, ConfirmDialog } from '$lib/components/ui';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { describeThrown } from '$lib/client-log';
  import { logger } from '$lib/observability';
  import { focusIfLost } from '$lib/utils/focus-if-lost';
  import { deleteContent } from '$lib/remote/content.remote';
  import { queryErrorMessage, remoteErrorCode, remoteErrorStatus } from '$lib/remote/query-result';
  import type { ContentWithRelations } from '$lib/types';
  import * as m from '$paraglide/messages';
  import ShaderPicker from '../content-form/ShaderPicker.svelte';
  import { logReadFailure } from '../media-library/log-read-failure';
  import { togglePublishStatus } from '../publish-toggle';
  import type { DraftSession, DraftValues } from './draft-session.svelte';
  import EditorSection from './EditorSection.svelte';
  import { CONTENT_LIST_HREF, type EditorContentType } from './editor-url';
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
    onpublishedchange: (published: boolean) => void;
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
    onpublishedchange,
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
  let toggling = $state(false);
  /** The toggle says how it went (a toast either way); a failure leaves it as it was. */
  /** Busy while it goes, the pressed toggle loses focus: it has it back once settled (the epic review). */
  let toggleRow = $state<HTMLElement | null>(null);
  async function togglePublished() {
    toggling = true;
    try {
      const next = await togglePublishStatus(content.id, published ? 'published' : 'draft');
      onpublishedchange(next === 'published');
    } catch (err) {
      // Said in the toggle's own toast, which keeps a refusal's words; the
      // toggle logs nothing, so it is logged here, by the studio's one rule.
      logReadFailure('studio_live.publish_toggle_failed', err, { contentId: content.id, published });
    } finally {
      toggling = false;
    }
    await tick();
    focusIfLost(toggleRow?.querySelector('button'));
  }

  // ── Delete ─────────────────────────────────────────────────────────────
  let confirmingDelete = $state(false);
  let deleting = $state(false);
  async function deletePiece() {
    deleting = true;
    try {
      await deleteContent(content.id);
    } catch (err) {
      // Gone already (deleted in another tab): what this delete was for. By
      // the piece's own code: any other 404 (a route, a stale build) is not.
      if (remoteErrorCode(err) === ERROR_CODES.CONTENT_NOT_FOUND) {
        logger.warn('studio_live.delete_already_gone', { contentId: content.id });
      } else {
        logReadFailure('studio_live.delete_failed', err, { contentId: content.id });
        const status = remoteErrorStatus(err);
        // A lapsed sign-in says what to do, as Update's does; a refusal (a
        // rule) keeps its words. Any 404 but the piece's own is the
        // platform's, not the creator's to read.
        const refused = status !== undefined && status >= 400 && status < 500 && status !== 404;
        toast.error(
          status === 401
            ? m.studio_content_draft_signed_out()
            : (refused && queryErrorMessage(err)) || m.studio_content_form_delete_error()
        );
        deleting = false;
        return;
      }
    }
    // Nothing is left to update: the move away neither asks nor waits.
    toast.success(m.studio_content_form_delete_success());
    await session
      .leave(CONTENT_LIST_HREF)
      .catch((err) => logger.warn('studio_live.leave_after_delete_failed', describeThrown(err)));
    deleting = false;
  }

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
    <div class="settings-off" bind:this={toggleRow}>
      <p class="settings-hint">{published ? m.studio_live_unpublish_hint() : m.studio_live_republish_hint()}</p>
      <Button type="button" size="sm" variant="secondary" loading={toggling} onclick={togglePublished}>
        {published ? m.studio_content_form_unpublish() : m.studio_live_republish()}
      </Button>
    </div>
    <div class="settings-off">
      <p class="settings-hint">{m.studio_live_delete_hint()}</p>
      <Button type="button" size="sm" variant="destructive" loading={deleting} onclick={() => (confirmingDelete = true)}>
        {m.studio_live_delete()}
      </Button>
    </div>
  </EditorSection>
</div>

<ConfirmDialog
  bind:open={confirmingDelete}
  title={m.studio_content_form_delete_confirm_title()}
  description={m.studio_content_form_delete_confirm_description()}
  confirmText={m.studio_live_delete()}
  cancelText={m.common_cancel()}
  variant="destructive"
  onConfirm={deletePiece}
/>

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
</style>
