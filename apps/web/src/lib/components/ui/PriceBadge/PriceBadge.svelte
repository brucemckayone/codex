<!--
  @component PriceBadge

  Displays a price/access badge with dark glass overlay for guaranteed contrast
  on any thumbnail. Subscriber-gated content carries a faint brand-primary
  gradient so the badge reads as the org's premium tier without a second pill.

  Variants:
  - "Free" / formatted price / "Purchased" (check) / "Included" (check)
  - "Followers" / "Team" — gating labels
  - Tier name or "Subscription" with faint brand gradient for subscriber-gated
  - Stacked dual badge (price ▲ tier ▼) for hybrid content (paid + tierName),
    enabled by `stacked={true}` from ContentCard.

  Priority: purchased > included > followers+isFollower > stacked-hybrid >
            subscribers > accessType > price.
-->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import * as m from '$paraglide/messages';
  import { formatPrice } from '$lib/utils/format';
  import { CheckIcon } from '$lib/components/ui/Icon';

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    amount: number | null;
    currency?: string;
    purchased?: boolean;
    included?: boolean;
    accessType?: 'free' | 'paid' | 'followers' | 'subscribers' | 'team' | null;
    isFollower?: boolean;
    tierName?: string | null;
    stacked?: boolean;
  }

  const {
    amount,
    currency = 'GBP',
    purchased = false,
    included = false,
    accessType = null,
    isFollower = false,
    tierName = null,
    stacked = false,
    class: className,
    ...restProps
  }: Props = $props();

  const isHybrid = $derived(
    stacked &&
      accessType === 'paid' &&
      !!tierName &&
      !purchased &&
      !included &&
      amount != null &&
      amount > 0
  );

  const variant = $derived.by(() => {
    if (purchased) return 'purchased';
    if (included) return 'included';
    if (accessType === 'followers' && isFollower) return 'included';
    if (isHybrid) return 'hybrid';
    if (accessType === 'subscribers') return 'subscribers';
    if (accessType === 'followers') return 'followers';
    if (accessType === 'team') return 'team';
    if (amount === 0 || accessType === 'free') return 'free';
    return 'paid';
  });

  const label = $derived.by(() => {
    if (purchased) return m.content_price_purchased();
    if (included) return m.content_price_included();
    if (accessType === 'followers' && isFollower) return m.content_price_included();
    if (accessType === 'subscribers') {
      // Subscriber-gated content may still carry a price (legacy dual-gated
      // case where `paid + minimumTierId` was modelled as `subscribers`).
      // Show the price if present, else tier name, else generic label.
      if (amount && amount > 0) return formatPrice(amount);
      if (tierName) return tierName;
      return m.content_price_subscribers();
    }
    if (accessType === 'followers') return m.content_price_followers();
    if (accessType === 'team') return m.content_price_team();
    if (amount === 0 || accessType === 'free') return m.content_price_free();
    if (amount != null) return formatPrice(amount);
    return '';
  });

  const showCheck = $derived(variant === 'purchased' || variant === 'included');
  const show = $derived(amount != null || purchased || included || accessType != null);
  const hybridPrice = $derived(amount != null && amount > 0 ? formatPrice(amount) : '');
</script>

{#if show}
  {#if variant === 'hybrid' && tierName}
    <span class="price-badge-stack {className ?? ''}" data-variant="hybrid" {...restProps}>
      <span class="price-badge">{hybridPrice}</span>
      <span class="price-badge price-badge--premium">{tierName}</span>
    </span>
  {:else}
    <span class="price-badge {className ?? ''}" data-variant={variant} {...restProps}>
      {#if showCheck}
        <CheckIcon size={12} />
      {/if}
      {label}
    </span>
  {/if}
{/if}

<style>
  .price-badge {
    /* Faint brand-primary gradient — used by subscriber-gated and the tier
       line in hybrid stacks. Dominantly dark-glass for legibility; the wash
       sits at ~28% intensity along a 135° axis. Brand-primary (not -accent)
       is the org's identity colour; accent is reserved for hover/highlight. */
    --_premium-bg: linear-gradient(
      135deg,
      color-mix(in oklch, var(--color-brand-primary) 28%, var(--color-neutral-900)) 0%,
      var(--color-neutral-900) 70%
    );

    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    border-radius: var(--radius-full);
    line-height: var(--leading-tight);
    white-space: nowrap;
    background: var(--color-neutral-900);
    color: var(--color-neutral-50);
  }

  .price-badge[data-variant='subscribers'],
  .price-badge--premium {
    background: var(--_premium-bg);
  }

  .price-badge--premium {
    font-weight: var(--font-semibold);
  }

  .price-badge-stack {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-0-5);
  }
</style>
