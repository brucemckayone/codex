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
  A clawback still running refuses calmly: try again later.

  @prop {FailedRefundItem | null} item
  @prop {FailedRefundResolution | null} resolution
  @prop {boolean} open - Bindable.
  @prop {(notice: SettleNotice) => void} onFinished - Settled, or already gone.
-->
<script lang="ts">
  import type { FailedRefundItem, FailedRefundResolution } from '@codex/admin';
  import { SUPPORT_NOTE_MAX_LENGTH } from '@codex/validation';
  import * as m from '$paraglide/messages';
  import { Alert, Button, Label } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import { formatPrice } from '$lib/utils/format';
  import { resolveFailedRefund } from '$lib/remote/support.remote';
  import { formatList, formatShortDay } from './support-format';
  import type { SettleNotice } from './settle-notice';

  interface Props {
    item: FailedRefundItem | null;
    resolution: FailedRefundResolution | null;
    open: boolean;
    onFinished: (notice: SettleNotice) => void;
  }

  let { item, resolution, open = $bindable(false), onFinished }: Props = $props();

  let note = $state('');
  let busy = $state(false);
  /** A refusal the dialog stays open for: try again later, or try again. */
  let problem = $state<'clawback_running' | 'failed' | null>(null);
  let noteMissing = $state(false);

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
  /** A failed full purchase refund ended access; re-paying gives it back (Q5d). */
  const restoresAccess = $derived(
    resolution === 'creators_repaid' && item?.isFull === true && item.kind === 'purchase'
  );
  const keepsCancelled = $derived(
    resolution === 'creators_repaid' && item?.isFull === true && item.kind !== 'purchase'
  );

  async function handleSubmit() {
    if (busy || !item || !resolution) return;
    if (noteRequired && note.trim() === '') {
      noteMissing = true;
      return;
    }
    busy = true;
    problem = null;
    const settling = item;
    try {
      const answer = await resolveFailedRefund({
        refundId: settling.refundId,
        body: { resolution, note: note.trim() },
      });
      if (answer.outcome === 'done') {
        const result = answer.result;
        const texts: string[] = [];
        if (result.resolution === 'refunded_elsewhere') {
          texts.push(m.support_settled_elsewhere({ buyer }));
        } else {
          texts.push(
            result.repaid.length > 0
              ? m.support_settled_repaid({
                  list: formatList(
                    result.repaid.map(
                      (row) =>
                        `${row.payeeName ?? m.support_debt_unnamed()} ${formatPrice(row.amountCents)}`
                    )
                  ),
                })
              : m.support_settled_repaid_none()
          );
          if (result.accessRestored) texts.push(m.support_settled_access({ buyer, title }));
        }
        open = false;
        onFinished({ variant: 'success', text: texts.join(' ') });
      } else if (answer.detailsCode === 'ALREADY_SETTLED' || answer.status === 409) {
        open = false;
        onFinished({ variant: 'info', text: m.support_settle_already() });
      } else if (answer.status === 404) {
        open = false;
        onFinished({ variant: 'info', text: m.support_settle_gone() });
      } else if (answer.detailsCode === 'REFUND_CLAWBACK_UNFINISHED') {
        problem = 'clawback_running';
      } else if (answer.status === 400 && noteRequired) {
        noteMissing = true;
      } else {
        problem = 'failed';
      }
    } catch {
      problem = 'failed';
    } finally {
      busy = false;
    }
  }
</script>

{#if item && resolution}
  <Dialog.Root bind:open>
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
            variant={problem === 'clawback_running' ? 'info' : 'error'}
            data-testid="settle-problem"
            data-problem={problem}
          >
            <p>
              {problem === 'clawback_running'
                ? m.support_settle_clawback_running()
                : m.support_settle_failed()}
            </p>
          </Alert>
        {/if}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => (open = false)} disabled={busy}>
          {m.support_confirm_cancel()}
        </Button>
        <Button variant="primary" loading={busy} onclick={handleSubmit} data-testid="settle-submit">
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
