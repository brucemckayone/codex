<!--
  @component PaidAnotherWayDialog

  "Mark as paid another way" on a blocked payment whose chargeback was lost
  for less than the payment (owner D60, D61; mockup
  docs/handover/phase3-sources/pause-trials/support-short-loss.html, S2-S4).
  The bank returned part and Stripe won't refund a charged-back payment, so
  support pays the rest outside Stripe, then records it here. It sends
  nothing: it writes the charge's refunded-outside-Stripe mark, which ends
  the hourly alert and blocks every Stripe refund on the charge.

  - The confirm repeats the three amounts and says the money must already
    have been paid. No note: there is no column for one (Q2).
  - It sends the dispute and the amount it showed: what's owed having moved
    since is a 412, and a repeat is a success (`alreadyMarked`), so Try
    again after a lost answer is safe.
  - Not saved (a 5xx, a dropped connection) or the session ended: the dialog
    stays open and says so. Every other answer closes it with a notice for
    the page (`onFinished`), which reloads the charge and focuses it; focus
    is the page's then, so the close sends it nowhere. Cancel returns it to
    what opened the dialog (the ui/Dialog default).

  While its request runs the dialog can't be dismissed, and the answer names
  the buyer and amount that were sent, captured then.

  @prop {ChargeDetail} detail - Its `shortLoss` is what is marked.
  @prop {boolean} open - Bindable.
  @prop {(notice: SettleNotice) => void} onFinished
-->
<script lang="ts">
  import type { ChargeDetail } from '@codex/admin';
  import { tick } from 'svelte';
  import * as m from '$paraglide/messages';
  import { Alert, Button } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { formatPrice } from '$lib/utils/format';
  import { markPaidAnotherWay } from '$lib/remote/support.remote';
  import { isSessionEnded } from './session';
  import type { SettleNotice } from './settle-notice';
  import { type PaidAnotherWayProblem, paidAnotherWayOutcome } from './short-loss-view';
  import { formatDay } from './support-format';

  interface Props {
    detail: ChargeDetail;
    open: boolean;
    onFinished: (notice: SettleNotice) => void;
  }

  let { detail, open = $bindable(false), onFinished }: Props = $props();

  let busy = $state(false);
  /** An answer closed it: the page moves focus to its notice, so the close leaves it. */
  let answered = $state(false);

  const shortLoss = $derived(detail.shortLoss);
  /** The mark a problem belongs to: a different charge or dispute starts clean. */
  const markKey = $derived(`${detail.charge.id}:${shortLoss?.stripeDisputeId ?? ''}`);
  let failure = $state<{ key: string; problem: PaidAnotherWayProblem } | null>(null);
  const problem = $derived(failure?.key === markKey ? failure.problem : null);
  const buyer = $derived(detail.buyer.name);
  const owed = $derived(shortLoss ? formatPrice(shortLoss.owedCents) : '');
  const itemTitle = $derived(
    detail.source.type === 'purchase'
      ? (detail.source.item?.title ?? m.support_item_unknown())
      : detail.source.planName
  );

  /** Read once, by the close an answer made: the next close is the default again. */
  function leaveFocus(): null {
    answered = false;
    return null;
  }

  function finish(notice: SettleNotice) {
    answered = true;
    open = false;
    onFinished(notice);
  }

  async function handleSubmit() {
    if (busy || !shortLoss) return;
    busy = true;
    failure = null;
    // What the answer's text names, as sent.
    const marking = { key: markKey, chargeId: detail.charge.id, buyer, shortLoss };
    let next: PaidAnotherWayProblem | null = null;
    try {
      const answer = await markPaidAnotherWay({
        chargeId: marking.chargeId,
        body: {
          stripeDisputeId: marking.shortLoss.stripeDisputeId,
          expectedOwedCents: marking.shortLoss.owedCents,
        },
      });
      const outcome = paidAnotherWayOutcome(answer, marking.buyer);
      if ('notice' in outcome) finish(outcome.notice);
      else next = outcome.problem;
    } catch (error) {
      next = isSessionEnded(error) ? 'session_ended' : 'failed';
    } finally {
      busy = false;
    }
    if (next !== null) {
      failure = { key: marking.key, problem: next };
      // The dialog stays open: move to why, so it is read out.
      await tick();
      document.querySelector<HTMLElement>('[data-paid-another-way-problem]')?.focus();
    }
  }
</script>

{#if shortLoss}
  <Dialog.Root bind:open dismissible={!busy} closeFocus={answered ? leaveFocus : undefined}>
    <Dialog.Content size="sm">
      <Dialog.Header>
        <Dialog.Title>{m.support_short_loss_dialog_title({ owed, buyer })}</Dialog.Title>
        <Dialog.Description>
          {m.support_short_loss_dialog_description({
            item: itemTitle,
            date: formatDay(detail.charge.paidAt),
          })}
        </Dialog.Description>
      </Dialog.Header>
      <Dialog.Body>
        {#if problem}
          <Alert
            variant={problem === 'failed' ? 'error' : 'warning'}
            tabindex={-1}
            data-paid-another-way-problem
            data-testid="paid-another-way-problem"
            data-problem={problem}
          >
            {#if problem === 'session_ended'}
              <p>
                <strong>{m.support_outcome_signed_out_lead()}</strong>
                {m.support_short_loss_session_ended()}
              </p>
            {:else}
              <p>
                <strong>{m.support_short_loss_failed_lead()}</strong>
                {m.support_short_loss_failed()}
              </p>
            {/if}
          </Alert>
        {/if}
        <ul class="facts" data-testid="paid-another-way-facts">
          <li>
            <span>{m.support_short_loss_fact_paid()}</span>
            <span class="facts__amount">{formatPrice(detail.charge.amountCents)}</span>
          </li>
          <li>
            <span>{m.support_short_loss_fact_lost()}</span>
            <span class="facts__amount">{formatPrice(shortLoss.lostCents)}</span>
          </li>
          <li class="facts__owed">
            <span>{m.support_short_loss_fact_owed()}</span>
            <span class="facts__amount">{owed}</span>
          </li>
        </ul>
        <p class="text">
          <strong>{m.support_short_loss_dialog_paid_first_lead({ buyer })}</strong>
          {m.support_short_loss_dialog_paid_first()}
        </p>
        <p class="text">{m.support_short_loss_dialog_follows()}</p>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => (open = false)} disabled={busy}>
          {m.support_confirm_cancel()}
        </Button>
        <Button
          variant="primary"
          loading={busy}
          onclick={handleSubmit}
          data-testid="paid-another-way-submit"
        >
          {problem === 'failed'
            ? m.support_queue_fees_try_again()
            : m.support_short_loss_dialog_submit({ owed })}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<style>
  .facts {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    border-top: var(--border-width) var(--border-style) var(--color-border-strong);
  }

  .facts li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    font-size: var(--text-sm);
    color: var(--color-text);
    border-bottom: var(--border-width) var(--border-style) var(--color-border-strong);
  }

  .facts__amount {
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
    white-space: nowrap;
  }

  .facts__owed span {
    font-weight: var(--font-semibold);
  }

  .text {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
  }
</style>
