<!--
  @component ChargeSummaryCard

  "The charge": who paid, for what, when, how much is left, the window and
  Stripe's ids (Codex-2hxff.28, mockup B1 and C1). A subscription invoice
  names the plan and whether this is the current period's payment, which is
  what decides whether a full refund cancels it.

  @prop {ChargeDetail} detail
  @prop {Date} [now] - The clock "days left" is measured from.
-->
<script lang="ts">
  import type { ChargeDetail } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import { Badge } from '$lib/components/ui';
  import * as Card from '$lib/components/ui/Card';
  import { CheckIcon, CopyIcon } from '$lib/components/ui/Icon';
  import { formatPrice } from '$lib/utils/format';
  import {
    daysLeftText,
    formatDay,
    formatDayTime,
    formatShortDay,
    subscriptionStatus,
  } from './support-format';

  interface Props {
    detail: ChargeDetail;
    now?: Date;
  }

  const { detail, now = new Date() }: Props = $props();

  const charge = $derived(detail.charge);
  const source = $derived(detail.source);
  const leftCents = $derived(detail.refundable.maxCents);

  const amountLine = $derived.by(() => {
    const amount = formatPrice(charge.amountCents);
    if (charge.refundedCents <= 0) return m.support_amount_none({ amount });
    if (charge.refundedCents >= charge.amountCents) {
      return m.support_amount_full({ amount });
    }
    return m.support_amount_partial({
      amount,
      refunded: formatPrice(charge.refundedCents),
      left: formatPrice(leftCents),
    });
  });

  const windowLine = $derived(
    detail.window.isOpen
      ? m.support_window_open_until({
          date: formatDayTime(detail.window.closesAt),
          left: daysLeftText(detail.window.closesAt, now),
        })
      : m.support_window_closed_at({ date: formatDayTime(detail.window.closesAt) })
  );

  const orgName = $derived(detail.organization?.name ?? null);

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  async function copyChargeId() {
    try {
      await navigator.clipboard.writeText(charge.id);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 2000);
    } catch {
      // No clipboard (an insecure origin, a denied permission): the id is
      // on screen to select by hand.
    }
  }

  $effect(() => () => {
    if (copyTimer) clearTimeout(copyTimer);
  });
</script>

{#snippet deleted(flag: boolean)}
  {#if flag}<Badge>{m.support_deleted()}</Badge>{/if}
{/snippet}

<Card.Root>
  <Card.Header>
    <Card.Title level={2}>{m.support_charge_card_title()}</Card.Title>
  </Card.Header>
  <Card.Content>
    <dl class="kv">
      {#if source.type === 'purchase'}
        <dt>{m.support_kv_buyer()}</dt>
        <dd>
          {detail.buyer.name} · {detail.buyer.email}
          {@render deleted(detail.buyer.deleted)}
        </dd>
        <dt>{m.support_kv_item()}</dt>
        <dd>
          {#if source.item}
            {source.item.title}{orgName ? ` · ${orgName}` : ''}
            {@render deleted(source.item.deleted || (detail.organization?.deleted ?? false))}
          {:else}
            {m.support_item_unknown()}
          {/if}
        </dd>
      {:else}
        {@const status = subscriptionStatus(source.status)}
        <dt>{m.support_kv_subscriber()}</dt>
        <dd>
          {detail.buyer.name} · {detail.buyer.email}
          {@render deleted(detail.buyer.deleted)}
        </dd>
        <dt>{m.support_kv_plan()}</dt>
        <dd>
          {[
            source.planName,
            orgName,
            source.interval === 'year' ? m.support_interval_year() : m.support_interval_month(),
          ]
            .filter(Boolean)
            .join(' · ')}
          {@render deleted(source.planDeleted)}
        </dd>
        <dt>{m.support_kv_period()}</dt>
        <dd>
          {source.isCurrentPeriodPayment
            ? m.support_period_current({
                start: formatShortDay(source.periodStart),
                end: formatDay(source.periodEnd),
              })
            : m.support_period_earlier()}
        </dd>
        <dt>{m.support_kv_subscription()}</dt>
        <dd class="kv__inline">
          <Badge variant={status.variant}>{status.label}</Badge>
          {#if source.status === 'active'}
            {m.support_subscription_renews({ date: formatShortDay(source.periodEnd) })}
          {/if}
        </dd>
      {/if}
      <dt>{m.support_kv_paid()}</dt>
      <dd>{formatDayTime(charge.paidAt)}</dd>
      <dt>{m.support_kv_amount()}</dt>
      <dd class="num">{amountLine}</dd>
      <dt>{m.support_kv_window()}</dt>
      <dd>{windowLine}</dd>
      <dt>{m.support_kv_stripe()}</dt>
      <dd class="kv__inline">
        <span class="mono">{charge.id}</span>
        <button
          type="button"
          class="copy-btn"
          aria-label={copied ? m.support_copied() : m.support_copy_charge_id()}
          title={m.support_copy_charge_id()}
          onclick={copyChargeId}
        >
          {#if copied}<CheckIcon size={14} />{:else}<CopyIcon size={14} />{/if}
        </button>
        {#if charge.paymentIntentId}
          · <span class="mono">{charge.paymentIntentId}</span>
        {/if}
      </dd>
    </dl>
  </Card.Content>
</Card.Root>

<style>
  .kv {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-2) var(--space-6);
    margin: 0;
    font-size: var(--text-sm);
  }

  .kv dt {
    color: var(--color-text-secondary);
  }

  .kv dd {
    margin: 0;
    min-width: 0;
    color: var(--color-text);
    overflow-wrap: anywhere;
  }

  .kv__inline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .copy-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1);
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .copy-btn:hover {
    color: var(--color-text);
    background: var(--color-surface-secondary);
  }

  .copy-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  @media (--below-sm) {
    .kv {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-0-5);
    }

    .kv dd {
      margin-bottom: var(--space-2);
    }
  }
</style>
