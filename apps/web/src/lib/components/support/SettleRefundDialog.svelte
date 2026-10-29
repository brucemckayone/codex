<!--
  @component SettleRefundDialog

  Settle a failed refund, with a confirm (Codex-2hxff.28, mockup D3):

  - "Refunded another way" (`refunded_elsewhere`) only records it. The
    payees' shares stay taken back, and the buyer isn't emailed.
  - "Re-pay payees" (`creators_repaid`, Q5) pays back what the refund took,
    as new pending payouts, and gives a failed full purchase refund's buyer
    access back. A note is required: it is a money record (Q6).

  The dialog says the total the refund took; what each payee gets back is
  the server's to work out, and the confirmation lists the payouts it wrote.
  A clawback still running refuses calmly: try again later. A later
  chargeback or refund that took the payees' shares too refuses re-paying
  for good, since it would pay them twice: support settles it by hand, or as
  refunded another way. So does a clawback step only a person can read
  (`REFUND_CLAWBACK_NEEDS_PERSON`): support settles it by hand. Whether re-paying gives the buyer access back is the
  server's prediction (`accessRestoreBlockedReason`, the restore's own rule,
  nothing locked), so the dialog says what it predicts and the confirmation
  says what happened (`accessNotRestoredReason`).

  @prop {FailedRefundItem | null} item
  @prop {FailedRefundResolution | null} resolution
  @prop {boolean} open - Bindable.
  @prop {(notice: SettleNotice) => void} onFinished - Settled, or already gone.
  @prop {() => HTMLElement | null} [closeFocus] - Where focus goes on close.

  While its request runs the dialog can't be dismissed (Escape, outside
  click, the close button), and the answer's text names the item that was
  sent, captured then. A refusal that keeps the dialog open takes focus, so
  it is read out (R2-L3); one from a session that ended says to sign in again
  (R2-M1).
-->
<script lang="ts">
  import type {
    AccessNotRestoredReason,
    FailedRefundItem,
    FailedRefundResolution,
  } from '@codex/admin';
  import type { CreateDialogProps } from '@melt-ui/svelte';
  import { SUPPORT_NOTE_MAX_LENGTH } from '@codex/validation';
  import { tick } from 'svelte';
  import * as m from '$paraglide/messages';
  import { Alert, Button, Label } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import { formatPrice } from '$lib/utils/format';
  import { resolveFailedRefund } from '$lib/remote/support.remote';
  import { markRepayBlocked } from './repay-blocks.svelte';
  import { isSessionEnded } from './session';
  import { formatList, formatShortDay, systemSettledSentence } from './support-format';
  import type { SettleNotice } from './settle-notice';

  interface Props {
    item: FailedRefundItem | null;
    resolution: FailedRefundResolution | null;
    open: boolean;
    onFinished: (notice: SettleNotice) => void;
    closeFocus?: CreateDialogProps['closeFocus'];
  }

  let {
    item,
    resolution,
    open = $bindable(false),
    onFinished,
    closeFocus,
  }: Props = $props();

  let note = $state('');
  let busy = $state(false);
  /** A refusal the dialog stays open for: later, another way, or again. */
  let problem = $state<
    | 'clawback_running'
    | 'blocked_chargeback'
    | 'blocked_later_refunds'
    | 'needs_person'
    | 'session_ended'
    | 'failed'
    | null
  >(null);
  let noteMissing = $state(false);
  /** Refused for good: Submit is off, and nothing is said of what re-paying would do. */
  const refusedForGood = $derived(
    problem === 'blocked_chargeback' ||
      problem === 'blocked_later_refunds' ||
      problem === 'needs_person'
  );

  const noteId = $props.id();

  // A new item or a new choice starts clean.
  $effect(() => {
    void item?.refundId;
    void resolution;
    note = '';
    problem = null;
    noteMissing = false;
  });

  $effect(() => {
    if (note.trim() !== '') noteMissing = false;
  });

  const buyer = $derived(item?.buyer?.name ?? m.support_unknown_buyer());
  const title = $derived(item?.title ?? m.support_unknown_item());
  const amount = $derived(item ? formatPrice(item.amountCents) : '');
  const taken = $derived(item ? formatPrice(item.takenFromPayeesCents) : '');
  const noteRequired = $derived(resolution === 'creators_repaid');
  /** The server's prediction: null means re-paying gives access back (Q5d). */
  const blocked = $derived(item?.accessRestoreBlockedReason ?? null);
  const repaying = $derived(resolution === 'creators_repaid' && item !== null);
  /** What re-paying would do to access is said only while re-paying is on offer. */
  const predicting = $derived(repaying && !refusedForGood);
  const restoresAccess = $derived(predicting && blocked === null);
  /** An invoice's full refund cancelled the subscription; re-paying keeps it so. */
  const keepsCancelled = $derived(
    predicting && blocked === 'no_purchase' && item?.isFull === true
  );
  /** Why access won't come back, when there is something to say: a part
   * refund never ended it, and an invoice has its own note. `unknown`: the
   * server couldn't read Stripe to predict, so the settle decides. */
  const accessBlockedNote = $derived.by(() => {
    if (!predicting || blocked === null || blocked === 'partial' || blocked === 'no_purchase') {
      return null;
    }
    return blocked === 'unknown'
      ? m.support_repay_access_unknown({ buyer })
      : accessKept(blocked, buyer);
  });

  /** Why the buyer's access stayed as it was, when re-paying didn't give it back. */
  function accessKept(reason: AccessNotRestoredReason, name: string): string {
    switch (reason) {
      case 'partial':
        return m.support_access_kept_partial({ buyer: name });
      case 'not_refunded':
        return m.support_access_kept_not_refunded({ buyer: name });
      case 'dispute_holds':
        return m.support_access_kept_dispute({ buyer: name });
      case 'duplicate':
        return m.support_access_kept_duplicate();
      case 'rebought':
        return m.support_access_kept_rebought({ buyer: name });
      case 'still_refunded':
        return m.support_access_kept_still_refunded({ buyer: name });
      case 'no_purchase':
        return m.support_access_kept_no_purchase();
      default:
        return m.support_access_kept_other({ buyer: name });
    }
  }

  async function handleSubmit() {
    if (busy || !item || !resolution) return;
    if (noteRequired && note.trim() === '') {
      noteMissing = true;
      return;
    }
    busy = true;
    problem = null;
    // The names the answer's text uses, as sent.
    const settling = { refundId: item.refundId, buyer, title };
    try {
      const answer = await resolveFailedRefund({
        refundId: settling.refundId,
        body: { resolution, note: note.trim() },
      });
      if (answer.outcome === 'done') {
        const result = answer.result;
        let text: string;
        if (result.resolution === 'refunded_elsewhere') {
          text = m.support_settled_elsewhere({ buyer: settling.buyer });
        } else {
          const repaid =
            result.repaid.length > 0
              ? m.support_settled_repaid({
                  list: formatList(
                    result.repaid.map((row) =>
                      m.support_settled_repaid_row({
                        name: row.payeeName ?? m.support_debt_unnamed(),
                        amount: formatPrice(row.amountCents),
                      })
                    )
                  ),
                })
              : m.support_settled_repaid_none();
          const access = result.accessRestored
            ? m.support_settled_access({ buyer: settling.buyer, title: settling.title })
            : result.accessNotRestoredReason
              ? accessKept(result.accessNotRestoredReason, settling.buyer)
              : null;
          text = access ? m.support_sentences_two({ first: repaid, second: access }) : repaid;
          // A take-back that had stopped part-way, settled first by the system (Q6).
          const system = systemSettledSentence(result.systemSettled);
          if (system) text = m.support_sentences_two({ first: text, second: system });
        }
        open = false;
        onFinished({ variant: 'success', text });
      } else if (answer.detailsCode === 'ALREADY_SETTLED' || answer.status === 409) {
        open = false;
        onFinished({ variant: 'info', text: m.support_settle_already() });
      } else if (answer.status === 404) {
        open = false;
        onFinished({ variant: 'info', text: m.support_settle_gone() });
      } else if (answer.detailsCode === 'REFUND_CLAWBACK_UNFINISHED') {
        problem = 'clawback_running';
      } else if (answer.detailsCode === 'REPAY_BLOCKED_BY_LATER_CAUSE') {
        // Refused for good: the row's Re-pay stays off for the session.
        const reason = answer.reason === 'chargeback' ? 'chargeback' : 'later_refunds';
        markRepayBlocked(settling.refundId, reason);
        problem = reason === 'chargeback' ? 'blocked_chargeback' : 'blocked_later_refunds';
      } else if (answer.detailsCode === 'REFUND_CLAWBACK_NEEDS_PERSON') {
        // Retrying never helps either: Re-pay stays off for the session.
        markRepayBlocked(settling.refundId, 'needs_person');
        problem = 'needs_person';
      } else if (answer.status === 400 && noteRequired) {
        noteMissing = true;
      } else if (answer.status === 401 || answer.status === 403) {
        problem = 'session_ended';
      } else {
        problem = 'failed';
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

{#if item && resolution}
  <Dialog.Root bind:open dismissible={!busy} {closeFocus}>
    <Dialog.Content size="sm">
      <Dialog.Header>
        <Dialog.Title>
          {resolution === 'refunded_elsewhere'
            ? m.support_elsewhere_title({ buyer })
            : m.support_repay_title({ buyer })}
        </Dialog.Title>
        <Dialog.Description>
          {resolution === 'refunded_elsewhere'
            ? m.support_elsewhere_description({
                amount,
                title,
                date: formatShortDay(item.failedAt),
              })
            : m.support_repay_description({ buyer })}
        </Dialog.Description>
      </Dialog.Header>
      <Dialog.Body>
        {#if resolution === 'refunded_elsewhere'}
          <p class="text">{m.support_elsewhere_body({ buyer, amount, taken })}</p>
        {:else}
          <p class="text">{m.support_repay_body({ taken })}</p>
          {#if restoresAccess}
            <Alert variant="info">
              <p>
                <strong>{m.support_repay_access_lead({ buyer })}</strong>
                {m.support_repay_access_body({ title })}
              </p>
            </Alert>
          {:else if keepsCancelled}
            <Alert variant="info"><p>{m.support_repay_subscription()}</p></Alert>
          {:else if accessBlockedNote}
            <Alert variant="info" data-testid="repay-access-blocked">
              <p>{accessBlockedNote}</p>
            </Alert>
          {/if}
        {/if}
        <div class="field">
          <Label for={noteId}>
            {m.support_note_label()}
            <span class="field__hint">
              {noteRequired ? m.support_note_required() : m.support_note_optional()}
            </span>
          </Label>
          <TextArea
            id={noteId}
            bind:value={note}
            maxlength={SUPPORT_NOTE_MAX_LENGTH}
            required={noteRequired}
            error={noteMissing ? m.support_note_missing() : undefined}
          />
        </div>
        {#if problem}
          <Alert
            variant={problem === 'clawback_running'
              ? 'info'
              : problem === 'failed'
                ? 'error'
                : 'warning'}
            tabindex={-1}
            data-settle-problem
            data-testid="settle-problem"
            data-problem={problem}
          >
            {#if problem === 'clawback_running'}
              <p>{m.support_settle_clawback_running()}</p>
            {:else if problem === 'blocked_chargeback'}
              <p>
                <strong>{m.support_repay_blocked_lead()}</strong>
                {m.support_repay_blocked_chargeback()}
              </p>
            {:else if problem === 'blocked_later_refunds'}
              <p>
                <strong>{m.support_repay_blocked_lead()}</strong>
                {m.support_repay_blocked_later_refunds()}
              </p>
            {:else if problem === 'needs_person'}
              <p>
                <strong>{m.support_repay_needs_person_lead()}</strong>
                {m.support_repay_needs_person_body()}
              </p>
            {:else if problem === 'session_ended'}
              <p>
                <strong>{m.support_outcome_signed_out_lead()}</strong>
                {m.support_settle_session_ended()}
              </p>
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
        <Button
          variant="primary"
          loading={busy}
          disabled={refusedForGood}
          onclick={handleSubmit}
          data-testid="settle-submit"
        >
          {resolution === 'refunded_elsewhere'
            ? m.support_elsewhere_submit()
            : m.support_repay_submit({ amount: taken })}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<style>
  .text {
    margin: 0;
    font-size: var(--text-sm);
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
