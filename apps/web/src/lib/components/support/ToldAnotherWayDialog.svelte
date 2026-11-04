<!--
  @component ToldAnotherWayDialog

  Mark a person told about a fee rise another way, for example on the phone
  (Codex-2hxff.33 F4; batch C1 Part B page 5, F3-F6). The same shape as the
  Owed to creators dialogs: the person in the title, the rise as the
  description, one field, and the action named in full.

  - The note is required: it is the only record of how they were told, and
    the payout terms promise notice. The mark counts as their notice from
    now; the dialog says what follows (the last person dates the rise).
  - The mark couldn't be saved (a 5xx, a dropped connection): the dialog
    stays open with the note kept, says nothing changed, and Try again sends
    the same mark. A second mark of the same person is refused, so a retry
    after a lost answer is safe (F5).
  - Nothing to mark (409): the rise was called off or has started, they were
    told meanwhile, or no longer need telling. The dialog closes with a
    notice and the list is refreshed (F6).

  While its request runs the dialog can't be dismissed, and the answer names
  the person that was sent, captured then.

  @prop {FeeNoticeItem | null} item
  @prop {FeeChangeCard | undefined} card - The rise, for its words and date.
  @prop {boolean} open - Bindable.
  @prop {(notice: SettleNotice) => void} onFinished
  @prop {() => HTMLElement | null} [closeFocus] - Where focus goes on close.
-->
<script lang="ts">
  import type { FeeChangeCard, FeeNoticeItem } from '@codex/admin';
  import type { CreateDialogProps } from '@melt-ui/svelte';
  import { SUPPORT_NOTE_MAX_LENGTH } from '@codex/validation';
  import { tick, untrack } from 'svelte';
  import * as m from '$paraglide/messages';
  import { Alert, Button, Label } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import { markToldAnotherWay } from '$lib/remote/support.remote';
  import {
    DATE_MARK,
    markedNotice,
    markRefusalNotice,
    markWords,
  } from './fee-notices-view';
  import { isSessionEnded } from './session';
  import type { SettleNotice } from './settle-notice';

  interface Props {
    item: FeeNoticeItem | null;
    card: FeeChangeCard | undefined;
    open: boolean;
    onFinished: (notice: SettleNotice) => void;
    closeFocus?: CreateDialogProps['closeFocus'];
  }

  let { item, card, open = $bindable(false), onFinished, closeFocus }: Props = $props();

  let note = $state('');
  let busy = $state(false);
  let problem = $state<'session_ended' | 'failed' | null>(null);
  let noteMissing = $state(false);

  const uid = $props.id();
  const noteId = `${uid}-note`;

  // A new person starts clean.
  $effect(() => {
    void item?.noticeId;
    note = '';
    problem = null;
    noteMissing = false;
  });

  $effect(() => {
    if (note.trim() !== '') noteMissing = false;
  });

  // "From now" is when the dialog opened, captured as it opens. The words
  // hang on the person only, never on `open`: gating the dialog on `open`
  // unmounted it in the same flush that closed it, before Melt saw the close,
  // so `closeFocus` never ran and focus fell to <body> (W2).
  let openedAt = $state(new Date());
  $effect.pre(() => {
    if (open) untrack(() => (openedAt = new Date()));
  });
  const words = $derived(item ? markWords(item, card, openedAt) : null);
  const follows = $derived(words?.follows?.split(DATE_MARK) ?? null);

  async function handleSubmit() {
    if (busy || !item || !words) return;
    if (note.trim() === '') {
      noteMissing = true;
      return;
    }
    busy = true;
    problem = null;
    // What the answer's text names, as sent.
    const marking = item;
    try {
      const answer = await markToldAnotherWay({
        noticeId: marking.noticeId,
        body: { note: note.trim() },
      });
      if (answer.outcome === 'done') {
        open = false;
        onFinished(markedNotice(marking, answer.result.change));
      } else {
        const notice = markRefusalNotice(marking, answer);
        if (notice) {
          open = false;
          onFinished(notice);
        } else if (answer.status === 400) {
          noteMissing = true;
        } else if (answer.status === 401 || answer.status === 403) {
          problem = 'session_ended';
        } else {
          problem = 'failed';
        }
      }
    } catch (error) {
      problem = isSessionEnded(error) ? 'session_ended' : 'failed';
    } finally {
      busy = false;
    }
    if (problem !== null) {
      // The dialog stays open: move to why, so it is read out.
      await tick();
      document.querySelector<HTMLElement>('[data-settle-problem]')?.focus();
    }
  }
</script>

{#if item && words}
  <Dialog.Root bind:open dismissible={!busy} {closeFocus}>
    <Dialog.Content size="sm">
      <Dialog.Header>
        <Dialog.Title>{words.title}</Dialog.Title>
        <Dialog.Description>{words.description}</Dialog.Description>
      </Dialog.Header>
      <Dialog.Body>
        {#if problem}
          <Alert
            variant={problem === 'failed' ? 'error' : 'warning'}
            tabindex={-1}
            data-settle-problem
            data-testid="settle-problem"
            data-problem={problem}
          >
            {#if problem === 'session_ended'}
              <p>
                <strong>{m.support_outcome_signed_out_lead()}</strong>
                {m.support_settle_session_ended()}
              </p>
            {:else}
              <p>
                <strong>{m.support_queue_fees_mark_failed_lead()}</strong>
                {m.support_queue_fees_mark_failed()}
              </p>
            {/if}
          </Alert>
        {/if}
        <p class="text">{words.counts}</p>
        {#if follows}
          <p class="text" data-testid="mark-follows">
            {follows[0]}{#if words.date}<b>{words.date}</b>{follows[1] ?? ''}{/if}
          </p>
        {/if}
        <div class="field">
          <Label for={noteId}>
            {m.support_queue_fees_note_label()}
            <span class="field__hint">{m.support_queue_fees_note_hint()}</span>
          </Label>
          <TextArea
            id={noteId}
            bind:value={note}
            maxlength={SUPPORT_NOTE_MAX_LENGTH}
            placeholder={words.placeholder}
            required
            error={noteMissing ? m.support_note_missing() : undefined}
          />
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => (open = false)} disabled={busy}>
          {m.support_confirm_cancel()}
        </Button>
        <Button variant="primary" loading={busy} onclick={handleSubmit} data-testid="settle-submit">
          {problem === 'failed' ? m.support_queue_fees_try_again() : words.submit}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<style>
  .text {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .field__hint {
    margin-left: var(--space-1);
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
  }
</style>
