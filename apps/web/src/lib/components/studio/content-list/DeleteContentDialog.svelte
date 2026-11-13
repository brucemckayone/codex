<!--
  @component DeleteContentDialog

  Delete… from the content list (Codex-a6ofh.3.5, owner D-b4, mockup L2c).

  - Many (the bulk bar): says how many go. A piece people have is left
    alone, since deleting it would end their playback; the dialog names it
    (or counts them) and offers Unpublish instead, which keeps their playback.
    The server judges each piece again, and the result line says what it did.
  - One (the row menu): a piece people have says by how many, with
    Unpublish instead first. Deleting it one at a time stays possible.

  "Have" is bought or given, through the piece or a course that holds it.
  The counts are the list's (`holderCount`); the server counts for itself.

  @prop target   What is being deleted; null closes it
  @prop busy     The delete or the unpublish is under way
-->
<script lang="ts" module>
  import type { ContentWithRelations } from '$lib/types';

  export type DeletePiece = Pick<ContentWithRelations, 'id' | 'title' | 'status' | 'holderCount'>;

  export type DeleteTarget =
    | { mode: 'many'; pieces: DeletePiece[] }
    | { mode: 'one'; piece: DeletePiece };
</script>

<script lang="ts">
  import { CONTENT_STATUS } from '@codex/constants';
  import { Alert, Button } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { AlertTriangleIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import { isHeld } from './row-facts';

  interface Props {
    target: DeleteTarget | null;
    busy: boolean;
    /** Delete them all: the server leaves each bought piece alone. */
    onDelete: () => void;
    /** Unpublish these instead: the bought pieces that are live. */
    onUnpublish: (ids: string[]) => void;
    onClose: () => void;
  }

  const { target, busy, onDelete, onUnpublish, onClose }: Props = $props();

  const live = (piece: DeletePiece) => piece.status === CONTENT_STATUS.PUBLISHED;

  const pieces = $derived(
    target === null ? [] : target.mode === 'many' ? target.pieces : [target.piece]
  );
  const kept = $derived(pieces.filter(isHeld));
  const going = $derived(pieces.length - kept.length);
  const keptLive = $derived(kept.filter(live).map((piece) => piece.id));
  const [onlyKept] = $derived(kept);
</script>

<Dialog.Root
  open={target !== null}
  onOpenChange={(open) => {
    if (!open) onClose();
  }}
  dismissible={!busy}
  role="alertdialog"
>
  <Dialog.Content size="sm">
    <Dialog.Header>
      <Dialog.Title>
        {#if target?.mode === 'one'}
          {m.studio_content_delete_one_title({ title: target.piece.title })}
        {:else}
          {m.studio_content_delete_many_title({ count: pieces.length })}
        {/if}
      </Dialog.Title>
    </Dialog.Header>
    <Dialog.Body>
      <div class="delete-body">
        {#if target?.mode === 'one'}
          {#if onlyKept}
            {@const buyers = onlyKept.holderCount ?? 0}
            <Alert variant="warning">
              <p class="delete-alert">
                <AlertTriangleIcon size={16} />
                <span>
                  <b>
                    {buyers === 1
                      ? m.studio_content_delete_bought_title_one()
                      : m.studio_content_delete_bought_title({ count: buyers })}
                  </b>
                  {m.studio_content_delete_bought_body()}
                </span>
              </p>
            </Alert>
          {:else}
            <p class="delete-text">{m.studio_content_delete_one_body()}</p>
          {/if}
        {:else if target?.mode === 'many'}
          {#if going > 0}
            <p class="delete-text">
              {going === 1
                ? m.studio_content_delete_many_body_one()
                : m.studio_content_delete_many_body({ count: going })}
            </p>
          {/if}
          {#if onlyKept}
            <Alert variant="warning">
              <p class="delete-alert">
                <AlertTriangleIcon size={16} />
                <span>
                  {#if kept.length === 1}
                    {@const buyers = onlyKept.holderCount ?? 0}
                    <b>{m.studio_content_delete_kept_one_title({ title: onlyKept.title })}</b>
                    {buyers === 1
                      ? m.studio_content_delete_kept_one_body_single()
                      : m.studio_content_delete_kept_one_body({ count: buyers })}
                  {:else}
                    <b>{m.studio_content_delete_kept_title({ count: kept.length })}</b>
                    {m.studio_content_delete_kept_body()}
                  {/if}
                </span>
              </p>
            </Alert>
          {/if}
        {/if}
      </div>
    </Dialog.Body>
    <Dialog.Footer>
      <Button variant="ghost" disabled={busy} onclick={onClose}>{m.common_cancel()}</Button>
      <span class="delete-gap"></span>
      {#if target?.mode === 'one'}
        {#if onlyKept && keptLive.length > 0}
          <Button variant="primary" disabled={busy} onclick={() => onUnpublish(keptLive)}>
            {m.studio_content_delete_unpublish_instead()}
          </Button>
        {/if}
        <Button variant="destructive" loading={busy} disabled={busy} onclick={onDelete}>
          {m.studio_content_delete_confirm()}
        </Button>
      {:else}
        {#if keptLive.length > 0}
          <Button variant="secondary" disabled={busy} onclick={() => onUnpublish(keptLive)}>
            {keptLive.length === 1
              ? m.studio_content_delete_unpublish_it()
              : m.studio_content_delete_unpublish_them()}
          </Button>
        {/if}
        {#if going > 0}
          <Button variant="destructive" loading={busy} disabled={busy} onclick={onDelete}>
            {m.studio_content_delete_count({ count: going })}
          </Button>
        {/if}
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
