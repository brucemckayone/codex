<!--
  @component ClosePriceMoveDialog

  Close a held price move without a retry (Codex-2hxff.85; batch C1 Part B
  page 6, M5). Two reasons, the record's resolution: moved by hand (told,
  then changed in Stripe) or not needed (cancelled, refunded or replaced).
  A note is required, as on every Queue resolve. The dialog says plainly
  that closing moves nobody.

  Neither reason is chosen when it opens: support picks one. A refusal (409
  PRICE_MOVE_NOT_HELD: a newer price replaced it, the run got there first)
  closes with a notice and the list is refreshed. A save that failed keeps
  the dialog open with the note kept.

  @prop {HeldPriceMove | null} item
  @prop {boolean} open - Bindable.
  @prop {(notice: SettleNotice) => void} onFinished
  @prop {() => HTMLElement | null} [closeFocus] - Where focus goes on close.
-->
<script lang="ts">
  import type { HeldPriceMove } from '@codex/admin';
  import type { CreateDialogProps } from '@melt-ui/svelte';
  import { SUPPORT_NOTE_MAX_LENGTH } from '@codex/validation';
  import { tick } from 'svelte';
  import * as m from '$paraglide/messages';
  import { Alert, Button, Label } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import { closePriceMove } from '$lib/remote/support.remote';
  import { closedNotice, closeWords, moveRefusalNotice } from './price-moves-view';
  import { isSessionEnded } from './session';
  import type { SettleNotice } from './settle-notice';

  type Resolution = 'moved_by_hand' | 'not_needed';

  interface Props {
    item: HeldPriceMove | null;
    open: boolean;
    onFinished: (notice: SettleNotice) => void;
    closeFocus?: CreateDialogProps['closeFocus'];
  }

  let { item, open = $bindable(false), onFinished, closeFocus }: Props = $props();

  let resolution = $state<Resolution | null>(null);
  let note = $state('');
  let busy = $state(false);
  let problem = $state<'session_ended' | 'failed' | null>(null);
  let noteMissing = $state(false);
  let choiceMissing = $state(false);

  const uid = $props.id();
  const noteId = `${uid}-note`;
  const choiceErrorId = `${uid}-choice-error`;

  // A new row starts clean.
  $effect(() => {
    void item?.moveId;
    resolution = null;
    note = '';
    problem = null;
    noteMissing = false;
    choiceMissing = false;
  });

  $effect(() => {
    if (note.trim() !== '') noteMissing = false;
  });

  $effect(() => {
    if (resolution !== null) choiceMissing = false;
  });

  const words = $derived(item ? closeWords(item) : null);

  const CHOICES: Array<{ value: Resolution; label: () => string; hint: () => string }> = [
    {
      value: 'moved_by_hand',
      label: m.support_queue_moves_close_by_hand,
      hint: m.support_queue_moves_close_by_hand_hint,
    },
    {
      value: 'not_needed',
      label: m.support_queue_moves_close_not_needed,
      hint: m.support_queue_moves_close_not_needed_hint,
    },
  ];

  async function handleSubmit() {
    if (busy || !item) return;
    if (resolution === null) {
      choiceMissing = true;
      await tick();
      document.querySelector<HTMLElement>(`#${uid}-choice-0`)?.focus();
      return;
    }
    if (note.trim() === '') {
      noteMissing = true;
      return;
    }
    busy = true;
    problem = null;
    // What the answer's text names, as sent.
    const closing = item;
    const chosen = resolution;
    try {
      const answer = await closePriceMove({
        moveId: closing.moveId,
        body: { resolution: chosen, note: note.trim() },
      });
      if (answer.outcome === 'done') {
        open = false;
        onFinished(closedNotice(closing, chosen));
      } else {
        const notice = moveRefusalNotice(closing, 'close', answer);
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
        <p class="text">{words.body}</p>
        <fieldset
          class="choice-list"
          role="radiogroup"
          aria-invalid={choiceMissing || undefined}
          aria-describedby={choiceMissing ? choiceErrorId : undefined}
        >
          <legend>{m.support_queue_moves_close_legend()}</legend>
          {#each CHOICES as choice, index (choice.value)}
            <label class="choice" data-selected={resolution === choice.value || undefined}>
              <input
                id="{uid}-choice-{index}"
                type="radio"
                name="{uid}-resolution"
                value={choice.value}
                bind:group={resolution}
                disabled={busy}
                data-testid="close-choice-{choice.value}"
              />
              <span>{choice.label()}</span>
              <small>{choice.hint()}</small>
            </label>
          {/each}
          {#if choiceMissing}
            <p class="choice-error" id={choiceErrorId} data-testid="close-choice-missing">
              {m.support_queue_moves_close_choose()}
            </p>
          {/if}
        </fieldset>
        <div class="field">
          <Label for={noteId}>
            {m.support_queue_moves_close_note_label()}
            <span class="field__hint">{m.support_note_required()}</span>
          </Label>
          <TextArea
            id={noteId}
            bind:value={note}
            maxlength={SUPPORT_NOTE_MAX_LENGTH}
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
          {problem === 'failed' ? m.support_queue_fees_try_again() : m.support_queue_moves_close_submit()}
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

  .choice-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }

  .choice-list legend {
    margin-bottom: var(--space-2);
    padding: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .choice {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-0-5) var(--space-2);
    align-items: start;
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--color-text);
    cursor: pointer;
  }

  /* The chosen reason: the interactive border and a faint wash of it. The
     radio itself is checked too, so the choice never rests on colour. */
  .choice[data-selected] {
    border-color: var(--color-interactive);
    background: color-mix(in oklab, var(--color-interactive) 6%, var(--color-surface));
  }

  .choice input {
    margin: var(--space-0-5) 0 0;
    accent-color: var(--color-interactive);
  }

  .choice small {
    grid-column: 2;
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
  }

  .choice-error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-status-error-text);
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
