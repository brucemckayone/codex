<!--
  @component DeleteContentDialog

  Delete… from the content list (Codex-a6ofh.3.5, owner D-b4, mockup L2c).

  - Many (the bulk bar): says how many go. A piece people have is left
    alone, since deleting it would end their playback; the dialog names it
    (or counts them) and offers Unpublish instead where that keeps their
    playback. The server judges each piece again, and the result line says
    what it did.
  - One (the row menu): a piece people have says by how many, with
    Unpublish instead first where it keeps their playback. Deleting it one
    at a time stays possible.

  "Have" is bought or given, through the piece or a course that holds it.
  The counts are the list's (`holderCount`); the server counts for itself.
  Unpublishing a Free piece ends it for them too (Codex-dz997), so the
  dialog says that, and does not offer it (`unpublishOffer`).

  @prop target   What is being deleted; null closes it
  @prop busy     The delete or the unpublish is under way
-->
<script lang="ts" module>
  import type { DeletePiece } from './delete-words';

  export type DeleteTarget =
    | { mode: 'many'; pieces: DeletePiece[] }
    | { mode: 'one'; piece: DeletePiece };
</script>

<script lang="ts">
  import { Alert, Button } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { AlertTriangleIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import { type HeldNotice, heldNotice, unpublishOffer } from './delete-words';
  import { isHeld } from './row-facts';

  interface Props {
    target: DeleteTarget | null;
    busy: boolean;
    /** Delete them all: the server leaves each bought piece alone. */
    onDelete: () => void;
    /** Unpublish these instead: the live pieces left alone whose people keep them. */
    onUnpublish: (ids: string[]) => void;
    onClose: () => void;
  }

  const { target, busy, onDelete, onUnpublish, onClose }: Props = $props();

  const pieces = $derived(
    target === null ? [] : target.mode === 'many' ? target.pieces : [target.piece]
  );
  const kept = $derived(pieces.filter(isHeld));
  const going = $derived(pieces.length - kept.length);
  const offer = $derived(unpublishOffer(kept));
  const notice = $derived(heldNotice(target?.mode ?? 'many', kept, offer.words));
</script>

{#snippet heldAlert(held: HeldNotice)}
  <Alert variant="warning">
    <p class="delete-alert">
      <AlertTriangleIcon size={16} />
      <span><b>{held.title}</b> {held.body}</span>
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
          {#if notice}
            {@render heldAlert(notice)}
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
          {#if notice}
            {@render heldAlert(notice)}
          {/if}
        {/if}
      </div>
    </Dialog.Body>
    <Dialog.Footer>
      <Button variant="ghost" disabled={busy} onclick={onClose}>{m.common_cancel()}</Button>
      <span class="delete-gap"></span>
      {#if target?.mode === 'one'}
        {#if offer.ids.length > 0}
          <Button variant="primary" disabled={busy} onclick={() => onUnpublish(offer.ids)}>
            {m.studio_content_delete_unpublish_instead()}
          </Button>
        {/if}
        <Button variant="destructive" loading={busy} disabled={busy} onclick={onDelete}>
          {m.studio_content_delete_confirm()}
        </Button>
      {:else}
        {#if offer.ids.length > 0}
          <Button variant="secondary" disabled={busy} onclick={() => onUnpublish(offer.ids)}>
            {offer.ids.length === 1
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
