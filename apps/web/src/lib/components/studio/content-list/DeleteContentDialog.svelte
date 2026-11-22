<!--
  @component DeleteContentDialog

  Delete… from the content list and the live editor (Codex-a6ofh.6, mockup
  leaving-notice.html LN1, LN2). One dialog, so the row menu and the editor
  say the same.

  - One (the row menu, the editor): a piece nobody owns is deleted at once,
    and the dialog says it can't be undone. A piece people own says how many,
    that it goes off sale now and leaves on its date, that they are emailed
    today, and that the creator can keep it any time before; Unpublish
    instead is offered where unpublishing keeps it for them. Its Delete reads
    "Delete in 30 days".
  - Many (the bulk bar): how many are deleted now, and a banner naming the
    ones that leave. One Delete for all of them.
  - Too (the row line, its menu, the editor, owner 2026-11-20): a piece only
    the org's delete holds, already leaving. "Delete it too" adds the
    creator's delete, so it leaves even if the org keeps it; its owners were
    already told, and nobody is emailed again. No Unpublish: it is off sale.

  "Own" is bought or given, through the piece or a course that holds it. The
  counts are the list's (`holderCount`); the server counts for itself. A
  delete it refuses as too soon after the last notice (`refusal`) is said
  here, and the dialog stays open with Unpublish instead still offered.

  A piece whose owners are not known (`holderCount` absent: a content-api
  older than the studio's) says what a delete does either way, never that
  nobody owns it.

  @prop target   What is being deleted; null closes it
  @prop busy     The delete or the unpublish is under way
  @prop refusal  Why the last Delete was refused, in words; null when it wasn't
  @prop note     One more line for the one piece (an unsaved change it does not send); null for none
-->
<script lang="ts" module>
  import type { DeletePiece } from './delete-words';

  export type DeleteTarget =
    | { mode: 'many'; pieces: DeletePiece[] }
    | { mode: 'one'; piece: DeletePiece }
    | { mode: 'too'; piece: DeletePiece; leavesAt: string };
</script>

<script lang="ts">
  import { LEAVING_NOTICE_DAYS } from '@codex/constants';
  import { Alert, Button } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { ClockIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import { manyNotice, oneNotice, tooWords, unknownWords } from './delete-words';
  import { leaveDayFrom } from './leaving-words';

  interface Props {
    target: DeleteTarget | null;
    busy: boolean;
    refusal?: string | null;
    note?: string | null;
    /** Delete it, or them: the ones people own leave on their date. */
    onDelete: () => void;
    /** Unpublish the one piece instead: offered where its owners keep it. */
    onUnpublish: () => void;
    onClose: () => void;
  }

  const { target, busy, refusal = null, note = null, onDelete, onUnpublish, onClose }: Props =
    $props();

  // The day a delete now would leave on, read as the dialog opens.
  const leavesOn = $derived(target === null ? null : leaveDayFrom());
  const one = $derived(
    target?.mode === 'one' && leavesOn ? oneNotice(target.piece, leavesOn) : null
  );
  const many = $derived(
    target?.mode === 'many' && leavesOn ? manyNotice(target.pieces, leavesOn) : null
  );
  // Cancel, Unpublish instead and Delete in 30 days need about 32rem in one
  // row, as mockup LN1 draws them, and `sm` is 28rem (owner, 2026-11-22);
  // 34rem leaves room for a wider font. The footer wraps rather than clip,
  // but the mockup's row is the layout.
  const wide = $derived(Boolean(one?.unpublish));
</script>

{#snippet leaveBanner(title: string, body: string)}
  <Alert variant="info">
    <p class="delete-alert">
      <ClockIcon size={16} />
      <span><b>{title}</b> {body}</span>
    </p>
  </Alert>
{/snippet}

<Dialog.Root
  open={target !== null}
  onOpenChange={(open) => {
    if (!open) onClose();
  }}
  dismissible={!busy}
  role="alertdialog"
>
  <Dialog.Content size="sm" maxWidth={wide ? '34rem' : undefined}>
    <Dialog.Header>
      <Dialog.Title>
        {#if target?.mode === 'one'}
          {m.studio_content_delete_one_title({ title: target.piece.title })}
        {:else if target?.mode === 'too'}
          {m.studio_leaving_delete_too_title({ title: target.piece.title })}
        {:else if target?.mode === 'many'}
          {m.studio_content_delete_many_title({ count: target.pieces.length })}
        {/if}
      </Dialog.Title>
    </Dialog.Header>
    <Dialog.Body>
      <div class="delete-body">
        {#if target?.mode === 'one'}
          {#if one}
            {@render leaveBanner(one.title, one.body)}
            <p class="delete-aside">{one.aside}</p>
          {:else if target.piece.holderCount === undefined && leavesOn}
            <p class="delete-text">{unknownWords(leavesOn)}</p>
          {:else}
            <p class="delete-text">{m.studio_content_delete_one_body()}</p>
          {/if}
          {#if note}
            <p class="delete-aside">{note}</p>
          {/if}
        {:else if target?.mode === 'too'}
          <p class="delete-text">{tooWords(target.leavesAt)}</p>
        {:else if many}
          {#if many.going}
            <p class="delete-text">{many.going}</p>
          {/if}
          {#if many.leaving}
            {@render leaveBanner(many.leaving.title, many.leaving.body)}
          {/if}
        {/if}
        {#if refusal}
          <Alert variant="error">{refusal}</Alert>
        {/if}
      </div>
    </Dialog.Body>
    <Dialog.Footer>
      <Button variant="ghost" disabled={busy} onclick={onClose}>{m.common_cancel()}</Button>
      <span class="delete-gap"></span>
      {#if target?.mode === 'one'}
        {#if one?.unpublish}
          <Button variant="secondary" disabled={busy} onclick={onUnpublish}>
            {m.studio_content_delete_unpublish_instead()}
          </Button>
        {/if}
        <Button variant="destructive" loading={busy} disabled={busy} onclick={onDelete}>
          {one
            ? m.studio_leaving_delete_in_days({ days: LEAVING_NOTICE_DAYS })
            : m.studio_content_delete_confirm()}
        </Button>
      {:else if target?.mode === 'too'}
        <Button variant="destructive" loading={busy} disabled={busy} onclick={onDelete}>
          {m.studio_leaving_delete_too_confirm()}
        </Button>
      {:else if target?.mode === 'many'}
        <Button variant="destructive" loading={busy} disabled={busy} onclick={onDelete}>
          {m.studio_content_delete_count({ count: target.pieces.length })}
        </Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .delete-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .delete-text {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .delete-aside {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .delete-alert {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-sm);
  }

  .delete-alert :global(svg) {
    flex-shrink: 0;
    margin-top: var(--space-0-5);
  }

  .delete-gap {
    flex: 1;
  }
</style>
