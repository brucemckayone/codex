<!--
  @component CreatorBreakdownCard (Codex-6nt4l)

  One card per creator in the `/studio/payouts` right rail. Surfaces:
    - Avatar + name + "Org owner" badge (when applicable)
    - Total paid headline
    - Source breakdown (purchases / subscriptions) — only non-zero halves
    - Transaction count + needs-attention count (compact pill row)
    - Last paid date (de-emphasised)

  Visually mirrors KPICard's chromatic surface (`--color-surface-card` on
  bordered tile, `--shadow-sm`, `--radius-lg`) so the rail feels native to
  the studio. Multi-metric so it's not KPICard itself — but the token
  vocabulary stays aligned.

  @prop breakdown - One CreatorPayoutBreakdown row from the rail's query.
-->
<script lang="ts">
  import Avatar from '$lib/components/ui/Avatar/Avatar.svelte';
  import AvatarImage from '$lib/components/ui/Avatar/AvatarImage.svelte';
  import AvatarFallback from '$lib/components/ui/Avatar/AvatarFallback.svelte';
  import { Badge } from '$lib/components/ui';
  import {
    AlertTriangleIcon,
    ReceiptIcon,
    SparkleIcon,
  } from '$lib/components/ui/Icon';
  import { formatDate, formatPrice, getInitials } from '$lib/utils/format';
  import type { CreatorPayoutBreakdown } from '@codex/subscription';

  interface Props {
    breakdown: CreatorPayoutBreakdown;
  }

  const { breakdown }: Props = $props();

  const displayName = $derived(
    breakdown.name ?? breakdown.email ?? 'Unknown creator'
  );

  // Show the source split row only when at least one half is non-zero.
  // If both are zero the creator has no paid rows under the current
  // filters (e.g. all rows are still pending) — the headline £0 already
  // tells that story; a "£0 purchases · £0 subscriptions" subline is just
  // noise.
  const hasSourceBreakdown = $derived(
    breakdown.purchasePaidCents > 0 || breakdown.subscriptionPaidCents > 0
  );

  const transactionLabel = $derived(
    breakdown.transactionCount === 1 ? 'transaction' : 'transactions'
  );

  // Owner-card composition disclosure (Codex-6nt4l). The owner's
  // `totalPaidCents` mixes `organization_fee` rows with any
  // `creator_payout_to_owner` slice — non-owner creators see only their
  // own `creator_payout` rows. Surfacing the org-fee subset keeps the
  // owner card visually comparable with the rest of the rail rather
  // than always headlining "biggest number" for accounting reasons.
  const showOrgFeeBreakdown = $derived(
    breakdown.isOrgOwner && breakdown.orgFeePaidCents > 0
  );
</script>

<article
  class="creator-card"
  data-org-owner={breakdown.isOrgOwner ? 'true' : 'false'}
>
  <header class="creator-card__header">
    <Avatar class="creator-card__avatar">
      {#if breakdown.avatarUrl}
        <AvatarImage src={breakdown.avatarUrl} alt={displayName} />
      {/if}
      <AvatarFallback>
        {getInitials(breakdown.name, breakdown.email)}
      </AvatarFallback>
    </Avatar>
    <div class="creator-card__identity">
      <span class="creator-card__name">{displayName}</span>
      {#if breakdown.isOrgOwner}
        <Badge variant="info">
          <span class="creator-card__owner-badge">
            <SparkleIcon size={12} />
            Org owner
          </span>
        </Badge>
      {/if}
    </div>
  </header>

  <p class="creator-card__total">{formatPrice(breakdown.totalPaidCents)}</p>

  {#if showOrgFeeBreakdown}
    <p class="creator-card__org-fee">
      of which {formatPrice(breakdown.orgFeePaidCents)} org fee
    </p>
  {/if}

  {#if hasSourceBreakdown}
    <p class="creator-card__split">
      {#if breakdown.purchasePaidCents > 0}
        <span>
          {formatPrice(breakdown.purchasePaidCents)}
          <span class="creator-card__split-label">purchases</span>
        </span>
      {/if}
      {#if breakdown.purchasePaidCents > 0 && breakdown.subscriptionPaidCents > 0}
        <span class="creator-card__split-sep" aria-hidden="true">·</span>
      {/if}
      {#if breakdown.subscriptionPaidCents > 0}
        <span>
          {formatPrice(breakdown.subscriptionPaidCents)}
          <span class="creator-card__split-label">subscriptions</span>
        </span>
      {/if}
    </p>
  {/if}

  <div class="creator-card__counts">
    <span class="creator-card__count" title="Distinct transactions">
      <ReceiptIcon size={12} />
      {breakdown.transactionCount}
      {transactionLabel}
    </span>
    {#if breakdown.needsAttentionCount > 0}
      <span class="creator-card__count creator-card__count--alert">
        <AlertTriangleIcon size={12} />
        {breakdown.needsAttentionCount} needs attention
      </span>
    {/if}
  </div>

  {#if breakdown.lastPaidAt}
    <p class="creator-card__last-paid">
      Last paid {formatDate(breakdown.lastPaidAt)}
    </p>
  {/if}
</article>

<style>
  .creator-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background-color: var(--color-surface-card);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
  }

  .creator-card__header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  :global(.creator-card__avatar) {
    width: var(--space-8) !important;
    height: var(--space-8) !important;
    flex-shrink: 0 !important;
  }

  .creator-card__identity {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .creator-card__name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .creator-card__owner-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .creator-card__total {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    line-height: var(--leading-tight);
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .creator-card__split {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1);
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .creator-card__split-label {
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
  }

  .creator-card__split-sep {
    color: var(--color-text-muted);
  }

  .creator-card__counts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .creator-card__count {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .creator-card__count--alert {
    color: var(--color-error-700);
  }

  .creator-card__last-paid {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .creator-card__org-fee {
    margin: calc(-1 * var(--space-1)) 0 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-style: italic;
    font-variant-numeric: tabular-nums;
  }
</style>
