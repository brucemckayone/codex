<!--
  @component PaidAnotherWayDialog

  "Mark as paid another way" on a blocked payment owed what Stripe won't
  refund (owner D60, D61, D63, D66; mockup
  docs/handover/phase3-sources/pause-trials/support-short-loss.html, S2-S4,
  A2, A4, B3, B4), at its stage (`detail.shortLoss.stage`):
  - `short`: its chargeback was lost for less than the payment. The bank
    returned part and Stripe won't refund a charged-back payment, so support
    pays the rest outside Stripe. The mark also blocks every Stripe refund
    on the charge.
  - `owed_again`: support had paid the rest, then the chargeback was won
    late, so the bank took it back from the buyer. Support pays it again,
    and marks it a second time.
  Each mark ADDS what it pays (D66), so a stage owed more after a mark is
  marked again, and the confirm says so. It sends nothing: it records the
  mark, which ends the hourly alert while nothing more is owed.

  - The confirm repeats the amounts that add up to what is owed (paid, less
    what was refunded through Stripe or another way, what was paid another
    way and what the bank returned) and says the money must already have
    been paid. No note: there is no column for one (Q2).
  - It sends the dispute, the stage, the amount it showed and what was paid
    another way so far (`paidAnotherWayBody`): any of them having moved since
    is a 412, and a repeat is a success (`alreadyMarked`), so Try again
    after a lost answer is safe and never adds twice.
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
  import {
    type PaidAnotherWayProblem,
    paidAnotherWayBody,
    paidAnotherWayFacts,
    paidAnotherWayFollows,
    paidAnotherWayOutcome,
  } from './short-loss-view';
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
  /** Owed again after a late win (owner D63): the second mark. */
  const owedAgain = $derived(shortLoss?.stage === 'owed_again');
  /** The mark a problem belongs to: a different charge, dispute or stage starts clean. */
  const markKey = $derived(
    `${detail.charge.id}:${shortLoss?.stripeDisputeId ?? ''}:${shortLoss?.stage ?? ''}`
  );
  let failure = $state<{ key: string; problem: PaidAnotherWayProblem } | null>(null);
  const problem = $derived(failure?.key === markKey ? failure.problem : null);
  const buyer = $derived(detail.buyer.name);
  const owed = $derived(shortLoss ? formatPrice(shortLoss.owedCents) : '');
  const itemTitle = $derived(
    detail.source.type === 'purchase'
      ? (detail.source.item?.title ?? m.support_item_unknown())
      : detail.source.planName
  );
  const description = $derived.by(() => {
    const words = { item: itemTitle, date: formatDay(detail.charge.paidAt) };
    return owedAgain
      ? m.support_owed_again_dialog_description(words)
      : m.support_short_loss_dialog_description(words);
  });
  /** The amounts that add up to what is owed. */
  const facts = $derived(
    shortLoss ? paidAnotherWayFacts(shortLoss, detail.charge.amountCents) : []
  );
  /** Why it stayed open: the session ended, or it may not have saved. */
  const problemWords = $derived(
    problem === 'session_ended'
      ? { lead: m.support_outcome_signed_out_lead(), text: m.support_short_loss_session_ended() }
      : { lead: m.support_short_loss_failed_lead(), text: m.support_short_loss_failed() }
  );
  /** Try again once it may not have saved; else the mark, with its amount. */
  const submitLabel = $derived(
    problem === 'failed' ? m.support_queue_fees_try_again() : m.support_short_loss_dialog_submit({ owed })
  );
  /** What follows the mark: once anything is marked, Stripe is blocked already, and a mark adds. */
  const follows = $derived(shortLoss ? paidAnotherWayFollows(shortLoss) : '');

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
        body: paidAnotherWayBody(marking.shortLoss),
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
        <Dialog.Description>{description}</Dialog.Description>
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
            <p><strong>{problemWords.lead}</strong> {problemWords.text}</p>
          </Alert>
        {/if}
        <ul class="facts" data-testid="paid-another-way-facts">
          {#each facts as fact (fact.label)}
            <li class={{ facts__owed: fact.owed }}>
              <span>{fact.label}</span>
              <span class="facts__amount">{formatPrice(fact.amountCents)}</span>
            </li>
          {/each}
        </ul>
        <p class="text">
          <strong>{m.support_short_loss_dialog_paid_first_lead({ buyer })}</strong>
          {m.support_short_loss_dialog_paid_first()}
        </p>
        <p class="text">{follows}</p>
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
          {submitLabel}
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
