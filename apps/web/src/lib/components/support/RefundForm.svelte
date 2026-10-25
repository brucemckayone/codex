<!--
  @component RefundForm

  "Refund this charge" (Codex-2hxff.28, mockup B1, B2, B4 and C1).

  The preview is the server's: `planClawback`, the same code the refund
  webhook runs, so it says exactly what will happen. It is fetched 300 ms
  after the last keystroke, one query per amount, and keyed to the charge's
  refund count so a preview worked out before someone else's refund is never
  reused after it. Review stays disabled until the preview on screen is the
  preview of the amount on screen: never a stale one, never none. Pressing
  Review asks for it once more, since the one on screen may be minutes old
  and a payout paid since changes how a share is taken back: the confirm
  opens only on that fresh answer. A reload of the charge asks again too.

  When the confirm closes on an answer, the page focuses its outcome alert,
  so it is read out: the form may unmount the dialog with its reset, so the
  dialog can't do it. On Cancel, focus goes back to Review.

  Submitting sends the refund count the page showed (the route refuses with
  CHARGE_CHANGED if it moved) and is guarded against a double click: one call
  per submit. The server's idempotency key makes a repeat harmless anyway.

  A blocked charge (window closed, a chargeback, nothing left) shows the
  reason in place of the form; the server refuses all three too.

  @prop {ChargeDetail} detail
  @prop {boolean} [stale=false] - The charge is reloading: Review waits.
  @prop {(outcome: RefundOutcome) => void} onOutcome
-->
<script lang="ts">
  import type { ChargeDetail, RefundPreviewLine } from '@codex/admin';
  import { untrack } from 'svelte';
  import {
    DISPUTE_CHARGEBACK_OPEN_STATUSES,
    DISPUTE_INQUIRY_STATUSES,
  } from '@codex/constants';
  import * as m from '$paraglide/messages';
  import { Alert, Button, Skeleton } from '$lib/components/ui';
  import * as Card from '$lib/components/ui/Card';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { Input } from '$lib/components/ui/Input';
  import Select from '$lib/components/ui/Select/Select.svelte';
  import { formatPrice } from '$lib/utils/format';
  import { queryErrorMessage } from '$lib/remote/query-result';
  import { getRefundPreview, issueSupportRefund } from '$lib/remote/support.remote';
  import {
    type IssueRefundAnswer,
    parsePounds,
    type RefundOutcome,
    refundOutcomeOf,
    rejectedOutcome,
  } from './refund-outcome';
  import {
    formatDay,
    formatTime,
    payeeName,
    refundReasonLabel,
  } from './support-format';

  type Reason = 'requested_by_customer' | 'duplicate' | 'fraudulent';

  interface Props {
    detail: ChargeDetail;
    stale?: boolean;
    onOutcome: (outcome: RefundOutcome) => void;
  }

  const { detail, stale = false, onOutcome }: Props = $props();

  /** After the last keystroke, before the preview is asked for. */
  const PREVIEW_DEBOUNCE_MS = 300;
  const REASONS: Reason[] = ['requested_by_customer', 'duplicate', 'fraudulent'];

  const chargeId = $derived(detail.charge.id);
  const maxCents = $derived(detail.refundable.maxCents);
  const buyer = $derived(detail.buyer.name);
  const isPurchase = $derived(detail.source.type === 'purchase');
  const isCurrentPeriod = $derived(
    detail.source.type !== 'purchase' && detail.source.isCurrentPeriodPayment
  );
  const sliceById = $derived(new Map(detail.slices.map((s) => [s.payoutId, s])));

  // ── The amount ─────────────────────────────────────────────────────────
  let mode = $state<'part' | 'all' | null>(null);
  let amountText = $state('');
  let reason = $state<Reason>('requested_by_customer');

  const typedCents = $derived(parsePounds(amountText));
  /** The amount on screen, in pence, when it is one the route would accept. */
  const shownCents = $derived.by(() => {
    if (mode === 'all') return maxCents > 0 ? maxCents : null;
    if (mode !== 'part' || typedCents === null) return null;
    return typedCents >= 1 && typedCents <= maxCents ? typedCents : null;
  });
  const amountInvalid = $derived(
    mode === 'part' && amountText.trim() !== '' && shownCents === null
  );

  // ── The preview: 300 ms after the amount stops changing ──────────────────
  let previewCents = $state<number | null>(null);
  $effect(() => {
    const next = shownCents;
    if (next === null) {
      previewCents = null;
      return;
    }
    const timer = setTimeout(() => {
      previewCents = next;
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  const previewQuery = $derived(
    previewCents === null
      ? null
      : getRefundPreview({
          chargeId,
          amountCents: previewCents,
          refundCount: detail.refundCount,
        })
  );
  /** The preview of the amount on screen, or null while there is none. */
  const preview = $derived.by(() => {
    const current = previewQuery?.current;
    if (!current || shownCents === null || previewCents !== shownCents) return null;
    return current.amountCents === shownCents ? current : null;
  });
  const previewError = $derived(
    previewCents !== null && previewCents === shownCents
      ? queryErrorMessage(previewQuery?.error)
      : null
  );

  // A reload of the same charge can still have moved a payout (paid since,
  // say): ask for the preview again with it. A new refund count is a new
  // query, fetched anyway.
  let lastDetail: ChargeDetail | null = null;
  $effect(() => {
    const next = detail;
    const previous = lastDetail;
    lastDetail = next;
    if (!previous || previous === next || previous.refundCount !== next.refundCount) return;
    untrack(() => previewQuery)
      ?.refresh()
      .catch(() => {});
  });

  let submitting = $state(false);
  let reviewing = $state(false);
  let dialogOpen = $state(false);
  /** The confirm closed on an answer: the page focuses it, not Review. */
  let focusOutcome = false;

  const canReview = $derived(
    preview !== null && previewError === null && !stale && !submitting && !reviewing
  );

  const uid = $props.id();
  const partId = `${uid}-part`;
  const partHintId = `${uid}-part-hint`;
  const amountErrorId = `${uid}-amount-error`;

  // ── What the preview says, in words ────────────────────────────────────
  const PAYEE_METHODS = new Set([
    'transfer_reversal',
    'reduce_unpaid',
    'cancel_unpaid',
    'from_repay_payout',
    'needs_person',
  ]);

  function lineWho(line: RefundPreviewLine): string {
    if (line.method === 'rounding') return m.support_preview_rounding();
    if (line.method === 'platform_bears') return m.support_payee_platform_fee();
    return payeeName(line.payoutId ? sliceById.get(line.payoutId) : undefined);
  }

  function confirmLine(line: RefundPreviewLine): string {
    const name = lineWho(line);
    switch (line.method) {
      case 'transfer_reversal':
        return m.support_confirm_line_reversal({ name });
      case 'reduce_unpaid':
        return m.support_confirm_line_reduce({ name });
      case 'cancel_unpaid':
        return m.support_confirm_line_cancel({ name });
      case 'from_repay_payout':
        return m.support_confirm_line_repay({ name });
      default:
        return m.support_confirm_line_person({ name });
    }
  }

  const payeeLines = $derived(
    preview ? preview.lines.filter((line) => PAYEE_METHODS.has(line.method)) : []
  );

  const reversalNames = $derived([
    ...new Set(
      payeeLines
        .filter((line) => line.method === 'transfer_reversal')
        .map((line) => lineWho(line))
    ),
  ]);

  const accessNote = $derived.by(() => {
    if (!preview) return null;
    const title = preview.access.title;
    switch (preview.access.kind) {
      case 'keeps':
        return {
          variant: 'info' as const,
          lead: m.support_access_keeps_lead({ buyer }),
          body: m.support_access_keeps_body({ title }),
        };
      case 'loses':
        return {
          variant: 'warning' as const,
          lead: m.support_access_loses_lead({ buyer }),
          body: m.support_access_loses_body({ title }),
        };
      case 'subscription_cancelled':
        return {
          variant: 'warning' as const,
          lead: m.support_access_cancelled_lead({ buyer }),
          body: m.support_access_cancelled_body({ buyer, title }),
        };
      default:
        return {
          variant: 'info' as const,
          lead: m.support_access_runs_lead({ buyer }),
          body: m.support_access_runs_body({ title }),
        };
    }
  });

  const confirmBody = $derived.by(() => {
    if (!preview) return '';
    const title = preview.access.title;
    switch (preview.access.kind) {
      case 'keeps':
        return m.support_confirm_keeps({ buyer });
      case 'loses':
        return m.support_confirm_loses({ buyer, title });
      case 'subscription_cancelled':
        return m.support_confirm_cancelled({ buyer, title });
      default:
        return m.support_confirm_runs({ buyer, title });
    }
  });

  const announcement = $derived(
    preview
      ? m.support_preview_announce({
          amount: formatPrice(preview.amountCents),
          payees: formatPrice(preview.payeesGiveBackCents),
          platform: formatPrice(preview.platformBearsCents),
        })
      : ''
  );

  const itemTitle = $derived(
    detail.source.type === 'purchase'
      ? (detail.source.item?.title ?? m.support_item_unknown())
      : detail.source.planName
  );
  const cardText = $derived(
    detail.charge.card
      ? m.support_card({
          brand: capitalise(detail.charge.card.brand),
          last4: detail.charge.card.last4,
        })
      : null
  );

  const hasInquiry = $derived(
    detail.chargebacks.some((row) =>
      (DISPUTE_INQUIRY_STATUSES as readonly string[]).includes(row.status)
    )
  );
  const chargebackLost = $derived(
    detail.chargebacks.some((row) => row.status === 'lost') &&
      !detail.chargebacks.some((row) =>
        (DISPUTE_CHARGEBACK_OPEN_STATUSES as readonly string[]).includes(row.status)
      )
  );

  function capitalise(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function isReason(value: string | undefined): value is Reason {
    return REASONS.includes(value as Reason);
  }

  // ── Submit ─────────────────────────────────────────────────────────────
  async function openReview() {
    if (!canReview || !previewQuery) return;
    const query = previewQuery;
    const cents = shownCents;
    reviewing = true;
    try {
      await query.refresh();
    } catch {
      // Shown as the preview error, with Try again: no confirm.
    } finally {
      reviewing = false;
    }
    // `preview` is only ever the preview of the amount on screen, so this is
    // also "the amount is still the one Review was pressed for".
    const fresh =
      preview !== null &&
      preview.amountCents === cents &&
      previewError === null &&
      !stale;
    if (!fresh) return;
    focusOutcome = false;
    dialogOpen = true;
  }

  function focusAfterConfirm(): HTMLElement | null {
    return focusOutcome ? null : document.querySelector<HTMLElement>('[data-refund-review]');
  }

  async function handleConfirm() {
    // Set before the first await: a second click in the same tick, before
    // the button re-renders disabled, returns here and sends nothing.
    if (submitting || !preview) return;
    submitting = true;
    const reviewed = preview;
    const seenRefundIds = detail.refunds.map((refund) => refund.id);
    let outcome: RefundOutcome;
    try {
      const answer: IssueRefundAnswer = await issueSupportRefund({
        chargeId,
        amountCents: reviewed.amountCents,
        reason,
        expectedRefundCount: detail.refundCount,
      });
      outcome = refundOutcomeOf(answer, { preview: reviewed, seenRefundIds });
    } catch (error) {
      outcome = rejectedOutcome(error);
    } finally {
      submitting = false;
    }
    focusOutcome = true;
    dialogOpen = false;
    // The form closes once a refund exists; otherwise support keeps what
    // they entered, to check against the reloaded charge.
    if (outcome.kind === 'made' || outcome.kind === 'replayed') {
      mode = null;
      amountText = '';
    }
    onOutcome(outcome);
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title level={2}>{m.support_form_title()}</Card.Title>
    {#if !detail.refundable.blocked}
      <Card.Description>
        {(detail.charge.refundedCents > 0 ? m.support_form_left : m.support_form_can)({
          amount: formatPrice(maxCents),
          date: formatDay(detail.window.closesAt),
          time: formatTime(detail.window.closesAt),
        })}
      </Card.Description>
    {/if}
  </Card.Header>
  <Card.Content>
    {#if detail.refundable.blocked === 'window_closed'}
      <Alert variant="warning" data-testid="refund-blocked" data-reason="window_closed">
        <p>
          <strong>{m.support_blocked_lead()}</strong>
          {m.support_blocked_window({
            date: formatDay(detail.window.closesAt),
            time: formatTime(detail.window.closesAt),
          })}
        </p>
      </Alert>
    {:else if detail.refundable.blocked === 'chargeback'}
      <Alert variant="error" data-testid="refund-blocked" data-reason="chargeback">
        <p>
          <strong>
            {chargebackLost
              ? m.support_blocked_chargeback_lost_lead()
              : m.support_blocked_chargeback_open_lead()}
          </strong>
          {m.support_blocked_chargeback_body()}
        </p>
      </Alert>
    {:else if detail.refundable.blocked === 'nothing_left'}
      <Alert variant="info" data-testid="refund-blocked" data-reason="nothing_left">
        <p>{m.support_blocked_nothing()}</p>
      </Alert>
    {:else}
      <div class="refund-form">
        <fieldset class="radio-group">
          <legend class="legend">{m.support_form_how_much()}</legend>
          <!-- The amount field sits beside the radio's label, not in it, so the
               radio's name is "Part of it" alone; the hint and the error
               describe the field (and the hint the radio). -->
          <div class="radio-row radio-row--field">
            <input
              type="radio"
              id={partId}
              name="refund-amount"
              value="part"
              checked={mode === 'part'}
              aria-describedby={partHintId}
              onchange={() => (mode = 'part')}
            />
            <span class="radio-row__text">
              <label class="radio-row__title" for={partId}>{m.support_form_part()}</label>
              <!-- The amount opens with its choice, as drawn (B1, C1). -->
              {#if mode === 'part'}
                <span class="money-input">
                  <span class="money-input__prefix" aria-hidden="true">£</span>
                  <Input
                    bind:value={amountText}
                    inputmode="decimal"
                    autocomplete="off"
                    aria-label={m.support_form_amount_label()}
                    aria-describedby="{amountErrorId} {partHintId}"
                    aria-invalid={amountInvalid ? 'true' : undefined}
                    data-error={amountInvalid}
                    onkeydown={(event: KeyboardEvent) => {
                      if (event.key === 'Enter') void openReview();
                    }}
                  />
                  <!-- Always mounted with the field, so text arriving is read out. -->
                  <span class="amount-error" id={amountErrorId} aria-live="polite">
                    {amountInvalid
                      ? m.support_form_amount_invalid({ max: formatPrice(maxCents) })
                      : ''}
                  </span>
                </span>
              {/if}
              <span class="radio-row__hint" id={partHintId} data-part-hint>
                {#if mode !== 'part'}
                  {isPurchase ? m.support_form_part_keeps({ buyer }) : m.support_form_part_runs()}
                {:else if isPurchase}
                  {m.support_form_part_hint_keeps({ max: formatPrice(maxCents), buyer })}
                {:else}
                  {m.support_form_part_hint_runs({ max: formatPrice(maxCents) })}
                {/if}
              </span>
            </span>
          </div>
          <label class="radio-row">
            <input
              type="radio"
              name="refund-amount"
              value="all"
              checked={mode === 'all'}
              onchange={() => (mode = 'all')}
            />
            <span class="radio-row__text">
              <span class="radio-row__title">
                {(detail.charge.refundedCents > 0 ? m.support_form_all_left : m.support_form_all)({
                  amount: formatPrice(maxCents),
                })}
              </span>
              <span class="radio-row__hint">
                {isPurchase
                  ? m.support_form_all_hint_loses({ buyer })
                  : isCurrentPeriod
                    ? m.support_form_all_hint_cancels()
                    : m.support_form_all_hint_runs()}
              </span>
            </span>
          </label>
        </fieldset>

        {#if hasInquiry}
          <Alert variant="info" data-testid="refund-inquiry">
            <p>{m.support_form_inquiry()}</p>
          </Alert>
        {/if}

        <div class="field">
          <Select
            options={REASONS.map((value) => ({ value, label: refundReasonLabel(value) }))}
            value={reason}
            label={m.support_form_reason()}
            onValueChange={(value) => {
              if (isReason(value) && value !== reason) reason = value;
            }}
          />
          <p class="field__help">{m.support_form_reason_help()}</p>
        </div>

        <div class="preview" aria-busy={shownCents !== null && preview === null && previewError === null}>
          <p
            class="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-preview-announce
          >
            {announcement}
          </p>
          {#if shownCents === null}
            <p class="field__help">{m.support_preview_choose()}</p>
          {:else}
            <h3 class="preview__heading">
              {m.support_preview_heading({ amount: formatPrice(shownCents) })}
            </h3>
            {#if previewError}
              <Alert variant="error" data-testid="preview-error">
                <p>{m.support_preview_error({ amount: formatPrice(shownCents) })}</p>
                <div class="alert-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={previewQuery?.loading === true}
                    onclick={() => void previewQuery?.refresh().catch(() => {})}
                  >
                    {m.support_try_again()}
                  </Button>
                </div>
              </Alert>
            {:else if !preview}
              <div class="preview__skeleton" data-testid="preview-pending">
                <span class="sr-only">
                  {m.support_preview_loading({ amount: formatPrice(shownCents) })}
                </span>
                {#each Array(3) as _, i (i)}
                  <div class="preview__skeleton-row">
                    <Skeleton width="55%" height="var(--space-4)" />
                    <Skeleton width="18%" height="var(--space-4)" />
                  </div>
                {/each}
              </div>
            {:else}
              <ul class="preview-list" data-testid="preview-lines">
                {#each preview.lines as line, i (`${line.payoutId ?? line.method}:${i}`)}
                  <li>
                    <span class="preview-list__who">{lineWho(line)}</span>
                    <span class="preview-list__amount">{formatPrice(line.amountCents)}</span>
                    <span class="preview-list__how">{line.label}</span>
                  </li>
                {/each}
                <li class="preview-list__total">
                  <span class="preview-list__who">{m.support_preview_total()}</span>
                  <span class="preview-list__amount">{formatPrice(preview.amountCents)}</span>
                </li>
              </ul>
              <dl class="preview-sums">
                <dt>{m.support_preview_payees()}</dt>
                <dd>{formatPrice(preview.payeesGiveBackCents)}</dd>
                <dt>{m.support_preview_platform()}</dt>
                <dd>{formatPrice(preview.platformBearsCents)}</dd>
                <dt>{m.support_preview_fee()}</dt>
                <dd>
                  {preview.stripeFeeCents === null
                    ? m.support_preview_fee_unknown()
                    : formatPrice(preview.stripeFeeCents)}
                </dd>
              </dl>
              {#if accessNote}
                <Alert variant={accessNote.variant} data-testid="preview-access">
                  <p><strong>{accessNote.lead}</strong> {accessNote.body}</p>
                </Alert>
              {/if}
              {#if reversalNames.length === 1}
                <p class="field__help">{m.support_preview_debt_one({ name: reversalNames[0] })}</p>
              {:else if reversalNames.length > 1}
                <p class="field__help">{m.support_preview_debt_many()}</p>
              {/if}
            {/if}
          {/if}
        </div>

        <Button
          variant="primary"
          class="refund-form__review"
          disabled={!canReview}
          loading={reviewing}
          data-testid="review-refund"
          data-refund-review
          onclick={() => void openReview()}
        >
          {shownCents === null
            ? m.support_form_review_idle()
            : m.support_form_review({ amount: formatPrice(shownCents) })}
        </Button>
      </div>
    {/if}
  </Card.Content>
</Card.Root>

{#if preview}
  <Dialog.Root
    bind:open={dialogOpen}
    closeFocus={focusAfterConfirm}
  >
    <Dialog.Content size="sm">
      <Dialog.Header>
        <Dialog.Title>
          {m.support_confirm_title({ amount: formatPrice(preview.amountCents), buyer })}
        </Dialog.Title>
        <Dialog.Description>
          {[itemTitle, cardText, refundReasonLabel(reason)].filter(Boolean).join(' · ')}
        </Dialog.Description>
      </Dialog.Header>
      <Dialog.Body>
        <ul class="dialog-list">
          {#each payeeLines as line, i (`${line.payoutId}:${i}`)}
            <li>
              <span>{confirmLine(line)}</span>
              <span class="dialog-list__amount">{formatPrice(line.amountCents)}</span>
            </li>
          {/each}
          {#if preview.platformBearsCents > 0}
            <li>
              <span>{m.support_confirm_line_platform()}</span>
              <span class="dialog-list__amount">{formatPrice(preview.platformBearsCents)}</span>
            </li>
          {/if}
        </ul>
        <p class="dialog-text">{confirmBody}</p>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => (dialogOpen = false)} disabled={submitting}>
          {m.support_confirm_cancel()}
        </Button>
        <Button
          variant="primary"
          loading={submitting}
          onclick={handleConfirm}
          data-testid="confirm-refund"
        >
          {m.support_confirm_submit({ amount: formatPrice(preview.amountCents) })}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<style>
  .refund-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .radio-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    border: none;
    min-width: 0;
  }

  .legend {
    margin-bottom: var(--space-2);
    padding: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .radio-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .radio-row:has(input[type='radio']:checked) {
    border-color: var(--color-border-focus);
  }

  .radio-row input[type='radio'] {
    flex-shrink: 0;
    margin: var(--space-0-5) 0 0;
    accent-color: var(--color-interactive);
  }

  .radio-row input[type='radio']:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .radio-row__text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .radio-row__title {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  /* The part row holds a field, so only its label selects it. */
  .radio-row--field {
    cursor: default;
  }

  .radio-row--field .radio-row__title {
    cursor: pointer;
  }

  .amount-error {
    display: block;
    margin-top: var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-error);
  }

  .amount-error:empty {
    margin-top: 0;
  }

  .alert-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .radio-row__hint,
  .field__help {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .money-input {
    position: relative;
    display: block;
    max-width: calc(var(--space-24) + var(--space-16));
    margin-top: var(--space-2);
  }

  .money-input__prefix {
    position: absolute;
    top: 0;
    left: var(--space-3);
    display: flex;
    align-items: center;
    height: var(--space-10);
    color: var(--color-text-secondary);
    pointer-events: none;
    z-index: 1;
  }

  .money-input :global(.input) {
    padding-left: var(--space-8);
    font-variant-numeric: tabular-nums;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .preview__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .preview__skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .preview__skeleton-row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .preview-list {
    display: flex;
    flex-direction: column;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .preview-list li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-0-5) var(--space-3);
    margin: 0;
    padding: var(--space-2) 0;
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .preview-list__who,
  .preview-list__amount {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .preview-list__amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .preview-list__how {
    grid-column: 1 / -1;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .preview-list .preview-list__total {
    border-bottom: none;
  }

  .preview-list__total .preview-list__who,
  .preview-list__total .preview-list__amount {
    font-weight: var(--font-semibold);
  }

  .preview-sums {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    font-size: var(--text-sm);
  }

  .preview-sums dt {
    color: var(--color-text-secondary);
  }

  .preview-sums dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--color-text);
  }

  .refund-form :global(.refund-form__review) {
    width: 100%;
  }

  .dialog-list {
    display: flex;
    flex-direction: column;
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: var(--text-sm);
    /* --color-border-strong, not --color-border: in dark --color-border
       equals the dialog's elevated surface, so the dividers would vanish. */
    border-top: var(--border-width) var(--border-style) var(--color-border-strong);
  }

  .dialog-list li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    margin: 0;
    padding: var(--space-2) 0;
    border-bottom: var(--border-width) var(--border-style) var(--color-border-strong);
  }

  .dialog-list__amount {
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
    white-space: nowrap;
  }

  .dialog-text {
    margin: 0;
    font-size: var(--text-sm);
  }
</style>
