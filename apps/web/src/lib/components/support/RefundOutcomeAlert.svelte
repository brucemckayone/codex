<!--
  @component RefundOutcomeAlert

  Stripe's answer, above the refunds list (Codex-2hxff.28, mockup B3): made
  (pending or succeeded), already made (a replay of the same decision),
  changed under the open page, refused (Stripe's code under a plain
  sentence), refused earlier for this exact refund (Stripe's 24-hour answer),
  blocked since the page loaded, or not sent.

  "Succeeded" is not "clawed back": the shares are taken when Stripe's
  `charge.refunded` event arrives, and the page reloads once and offers
  Refresh rather than polling (Q10).

  The alert takes focus when the confirm closes (`tabindex="-1"`, found by
  `data-refund-outcome`): a live region that arrives already filled is often
  not read out, so focus is what makes the answer heard.

  @prop {RefundOutcome} outcome
  @prop {ChargeDetail} detail - The charge as now loaded.
  @prop {boolean} [reloading=false] - The charge is reloading.
  @prop {() => void} [onReload] - "Reload the charge".
-->
<script lang="ts">
  import type { ChargeDetail } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import { Alert, Button } from '$lib/components/ui';
  import { RefreshCwIcon } from '$lib/components/ui/Icon';
  import { formatPrice } from '$lib/utils/format';
  import type { RefundOutcome } from './refund-outcome';
  import {
    formatDay,
    formatDayTime,
    formatList,
    formatTime,
    payeeName,
    requesterLabel,
  } from './support-format';

  interface Props {
    outcome: RefundOutcome;
    detail: ChargeDetail;
    reloading?: boolean;
    onReload?: () => void;
  }

  const { outcome, detail, reloading = false, onReload }: Props = $props();

  type Variant = 'error' | 'success' | 'info' | 'warning';

  const PAYEE_METHODS = new Set([
    'transfer_reversal',
    'reduce_unpaid',
    'cancel_unpaid',
    'from_repay_payout',
  ]);

  const buyer = $derived(detail.buyer.name);
  const sliceById = $derived(new Map(detail.slices.map((s) => [s.payoutId, s])));

  /** What the alert says: a lead in bold, the rest, an id or code, a button. */
  const view = $derived.by(
    (): {
      variant: Variant;
      lead: string;
      body: string;
      mono: string | null;
      reload: boolean;
    } => {
      switch (outcome.kind) {
        case 'made': {
          const amount = formatPrice(outcome.refund.amountCents);
          const status = outcome.refund.status;
          if (status === 'pending' || status === 'requires_action') {
            return {
              variant: 'info',
              lead: m.support_outcome_pending_lead({ amount }),
              body: m.support_outcome_pending_body({ buyer }),
              mono: outcome.refund.id,
              reload: false,
            };
          }
          if (status === 'succeeded') {
            const names = [
              ...new Set(
                outcome.preview.lines
                  .filter((line) => PAYEE_METHODS.has(line.method) && line.payoutId)
                  .map((line) =>
                    m.support_outcome_share_of({
                      name: payeeName(sliceById.get(line.payoutId ?? '')),
                    })
                  )
              ),
            ];
            const shares = names.length
              ? m.support_outcome_succeeded_named({ names: formatList(names) })
              : m.support_outcome_succeeded_body();
            return {
              variant: 'success',
              lead: m.support_outcome_succeeded_lead({ amount, buyer }),
              body: m.support_sentences_two({
                first: shares,
                second: accessSentence(outcome.preview.access.kind, outcome.preview.access.title),
              }),
              mono: outcome.refund.id,
              reload: false,
            };
          }
          return {
            variant: 'warning',
            lead: m.support_outcome_stopped_lead({ status }),
            body: m.support_outcome_stopped_body(),
            mono: outcome.refund.id,
            reload: false,
          };
        }
        case 'replayed': {
          const refundId = outcome.refund.id;
          const row = detail.refunds.find((refund) => refund.id === refundId);
          const amount = formatPrice(outcome.refund.amountCents);
          const date = formatDayTime(outcome.refund.createdAt);
          return {
            variant: 'info',
            lead: m.support_outcome_replayed_lead(),
            body: row
              ? m.support_outcome_replayed_by({
                  amount,
                  date,
                  name: requesterLabel(row.requestedBy),
                })
              : m.support_outcome_replayed({ amount, date }),
            mono: outcome.refund.id,
            reload: false,
          };
        }
        case 'changed': {
          const seen = new Set(outcome.seenRefundIds);
          const newer = detail.refunds.filter((refund) => !seen.has(refund.id));
          const latest = [...newer].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt)
          )[0];
          const left = m.support_outcome_changed_left({
            left: formatPrice(detail.refundable.maxCents),
          });
          let body: string;
          if (latest) {
            body = m.support_sentences_two({
              first: m.support_outcome_changed_who({
                who: requesterLabel(latest.requestedBy),
                amount: formatPrice(latest.amountCents),
                time: formatTime(latest.createdAt),
              }),
              second: left,
            });
          } else {
            body = reloading ? m.support_outcome_changed_loading() : left;
          }
          return {
            variant: 'warning',
            lead: m.support_outcome_changed_lead(),
            body,
            mono: null,
            reload: true,
          };
        }
        case 'refused':
          return {
            variant: 'error',
            lead: m.support_outcome_refused_lead(),
            body:
              outcome.stripeCode === 'charge_disputed'
                ? m.support_outcome_refused_disputed({ buyer })
                : m.support_outcome_refused_other(),
            mono: outcome.stripeCode,
            reload: true,
          };
        case 'key_spent':
          return {
            variant: 'warning',
            lead: m.support_outcome_key_spent_lead(),
            body: m.support_outcome_key_spent_body(),
            mono: null,
            reload: false,
          };
        case 'window_closed':
          return {
            variant: 'warning',
            lead: m.support_blocked_lead(),
            body: outcome.closesAt
              ? m.support_blocked_window({
                  date: formatDay(outcome.closesAt),
                  time: formatTime(outcome.closesAt),
                })
              : m.support_blocked_window_unknown(),
            mono: null,
            reload: false,
          };
        case 'chargeback':
          return {
            variant: 'error',
            lead: m.support_outcome_chargeback_lead(),
            body: m.support_blocked_chargeback_body(),
            mono: null,
            reload: false,
          };
        case 'nothing_left':
          return {
            variant: 'info',
            lead: m.support_blocked_nothing(),
            body: m.support_outcome_nothing_body(),
            mono: null,
            reload: false,
          };
        case 'too_large':
          return {
            variant: 'warning',
            lead: m.support_outcome_too_large_lead(),
            body:
              outcome.maxCents === null
                ? m.support_outcome_too_large_unknown()
                : m.support_outcome_too_large_body({ max: formatPrice(outcome.maxCents) }),
            mono: null,
            reload: false,
          };
        case 'signed_out':
          return {
            variant: 'warning',
            lead: m.support_outcome_signed_out_lead(),
            body: m.support_outcome_signed_out_body(),
            mono: null,
            reload: false,
          };
        case 'rate_limited':
          return {
            variant: 'warning',
            lead: m.support_outcome_rate_limited_lead(),
            body: m.support_outcome_rate_limited_body(),
            mono: null,
            reload: false,
          };
        case 'failed':
          return {
            variant: 'error',
            lead: m.support_outcome_failed_lead(),
            body: m.support_outcome_failed_body(),
            mono: null,
            reload: true,
          };
      }
    }
  );

  function accessSentence(kind: string, title: string): string {
    switch (kind) {
      case 'keeps':
        return m.support_outcome_access_keeps({ buyer });
      case 'loses':
        return m.support_outcome_access_loses({ buyer, title });
      case 'subscription_cancelled':
        return m.support_outcome_access_cancelled({ buyer, title });
      default:
        return m.support_outcome_access_runs({ buyer, title });
    }
  }
</script>

<Alert
  variant={view.variant}
  tabindex={-1}
  data-refund-outcome
  data-testid="refund-outcome"
  data-kind={outcome.kind}
>
  <p><strong>{view.lead}</strong> {view.body}</p>
  {#if view.mono}
    <p class="mono">{view.mono}</p>
  {/if}
  {#if view.reload && onReload}
    <div class="actions">
      <Button variant="secondary" size="sm" loading={reloading} onclick={onReload}>
        <RefreshCwIcon size={14} />
        {m.support_reload_charge()}
      </Button>
    </div>
  {/if}
</Alert>

<style>
  p {
    margin: 0;
  }

  p + p {
    margin-top: var(--space-1-5);
  }

  .mono {
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
</style>
