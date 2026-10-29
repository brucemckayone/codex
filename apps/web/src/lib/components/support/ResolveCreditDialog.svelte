<!--
  @component ResolveCreditDialog

  Settle money owed back to a payee after a late take-back, with a confirm
  (Codex-2hxff.72/.73, mock-b-support O2-O4; owner decisions Q9-Q11):

  - `repay`: writes one pending re-pay payout for what Stripe took; the next
    payout run pays it. The title and the button name the person and the
    amount, which is the confirmation by name (Q9). The note is optional.
  - `count_against_debt`: the share's own debt is still open and Stripe took
    exactly its amount, so the take-back paid it. Settles that debt; nothing
    is re-paid (Q11).
  - `not_owed`: nothing is paid. A note is required: it is the record.

  On a row the ledger can't attribute (`needs_person`, "Check in Stripe, then
  decide"), Re-pay needs a note too: what support saw in Stripe.

  Opened from the Owed to creators tab, or from a charge page's history line
  (Re-pay and Count against this debt only). A repeat, or a row whose action
  changed meanwhile, closes with a notice and the list is refreshed: nothing
  is paid twice.

  @prop {CreditTarget | null} target
  @prop {OwedToCreatorAction | null} action
  @prop {boolean} open - Bindable.
  @prop {(notice: SettleNotice) => void} onFinished
  @prop {() => HTMLElement | null} [closeFocus] - Where focus goes on close.

  While its request runs the dialog can't be dismissed, and the answer names
  the payee that was sent, captured then. A refusal that keeps the dialog
  open takes focus, so it is read out; one from a session that ended says to
  sign in again.
-->
<script lang="ts">
  import type { OwedToCreatorAction } from '@codex/admin';
  import type { CreateDialogProps } from '@melt-ui/svelte';
  import { SUPPORT_NOTE_MAX_LENGTH } from '@codex/validation';
  import { tick } from 'svelte';
  import * as m from '$paraglide/messages';
  import { Alert, Button, Label } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import { resolveOwedToCreator } from '$lib/remote/support.remote';
  import { type CreditTarget, dialogWords, refusalNotice, resolvedNotice } from './owed-view';
  import { isSessionEnded } from './session';
  import type { SettleNotice } from './settle-notice';

  interface Props {
    target: CreditTarget | null;
    action: OwedToCreatorAction | null;
    open: boolean;
    onFinished: (notice: SettleNotice) => void;
    closeFocus?: CreateDialogProps['closeFocus'];
  }

  let { target, action, open = $bindable(false), onFinished, closeFocus }: Props = $props();

  let note = $state('');
  let busy = $state(false);
  let problem = $state<'session_ended' | 'sibling_unfinished' | 'failed' | null>(null);
  let noteMissing = $state(false);

  const uid = $props.id();
  const noteId = `${uid}-note`;

  // A new row or a new choice starts clean.
  $effect(() => {
    void target?.creditId;
    void action;
    note = '';
    problem = null;
    noteMissing = false;
  });

  $effect(() => {
    if (note.trim() !== '') noteMissing = false;
  });

  const words = $derived(target && action ? dialogWords(target, action) : null);

  async function handleSubmit() {
    if (busy || !target || !action || !words) return;
    if (words.noteRequired && note.trim() === '') {
      noteMissing = true;
      return;
    }
    busy = true;
    problem = null;
    // What the answer's text names, as sent.
    const settling = target;
    try {
      const answer = await resolveOwedToCreator({
        creditId: settling.creditId,
        body: { action, note: note.trim() },
      });
      if (answer.outcome === 'done') {
        open = false;
        onFinished(resolvedNotice(settling, answer.result));
      } else {
        const notice = refusalNotice(answer);
        if (notice) {
          open = false;
          onFinished(notice);
        } else if (
          answer.detailsCode === 'CREDIT_NOTE_REQUIRED' ||
          (answer.status === 400 && words.noteRequired)
        ) {
          noteMissing = true;
        } else if (answer.detailsCode === 'CREDIT_SIBLING_UNFINISHED') {
          // Another take-back on the slice is still running: nothing changed,
          // so the row stays as it is and can be tried again.
          problem = 'sibling_unfinished';
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

{#if target && words}
  <Dialog.Root bind:open dismissible={!busy} {closeFocus}>
    <Dialog.Content size="sm">
      <Dialog.Header>
        <Dialog.Title>{words.title}</Dialog.Title>
        <Dialog.Description>{target.description}</Dialog.Description>
      </Dialog.Header>
      <Dialog.Body>
        {#each words.body as sentence (sentence)}
          <p class="text">{sentence}</p>
        {/each}
        {#if words.reference}
          <p class="text">{words.reference.lead} <span class="mono">{words.reference.id}</span>.</p>
        {/if}
        <div class="field">
          <Label for={noteId}>
            {words.noteLabel}
            <span class="field__hint">
              {words.noteRequired ? m.support_note_required() : m.support_note_optional()}
            </span>
          </Label>
          <TextArea
            id={noteId}
            bind:value={note}
            maxlength={SUPPORT_NOTE_MAX_LENGTH}
            required={words.noteRequired}
            error={noteMissing ? m.support_note_missing() : undefined}
          />
        </div>
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
            {:else if problem === 'sibling_unfinished'}
              <p>{m.support_credit_sibling_unfinished()}</p>
            {:else}
              <p>{m.support_settle_failed()}</p>
            {/if}
          </Alert>
        {/if}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => (open = false)} disabled={busy}>
          {m.support_confirm_cancel()}
        </Button>
        <Button variant="primary" loading={busy} onclick={handleSubmit} data-testid="settle-submit">
          {words.submit}
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

  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
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
