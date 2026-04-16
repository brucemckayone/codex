<!--
  @component PriceBadge

  Displays a price/access badge with dark glass overlay for guaranteed contrast
  on any thumbnail. Semantic left-accent stripe indicates access type at a glance.

  Variants:
  - "Free" (green accent) when amount is 0
  - Formatted price (no accent) when amount > 0
  - "Purchased" (blue accent + check) when purchased is true
  - "Included" (green accent + check) when included OR follower viewing followers-only
  - Tier name or "Subscription" (brand accent) for subscriber-gated content
  - "Followers" (blue accent) for followers-only content (non-follower viewer)
  - "Team" (muted accent) for team-only content

  Priority: purchased > included > followers+isFollower > accessType > price

  @prop {number | null} amount - Price in minor units (pence). 0 = free, null = hidden.
  @prop {string} currency - ISO 4217 currency code. Defaults to 'GBP'.
  @prop {boolean} purchased - Whether the user has purchased this content.
  @prop {boolean} included - Whether the user's subscription covers this content.
  @prop {'free' | 'paid' | 'followers' | 'subscribers' | 'team' | null} [accessType] - Content access type.
  @prop {boolean} [isFollower] - Whether the user follows this org (contextualizes followers badge).
  @prop {string | null} [tierName] - Resolved tier name for subscriber-gated content.
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
  }

  const {
    amount,
    currency = 'GBP',
    purchased = false,
    included = false,
    accessType = null,
    isFollower = false,
    tierName = null,
    class: className,
    ...restProps
  }: Props = $props();

  const variant = $derived.by(() => {
    if (purchased) return 'purchased';
    if (included) return 'included';
    // Follower viewing followers-only content → show as included (they have access)
    if (accessType === 'followers' && isFollower) return 'included';
    if (accessType === 'subscribers') return 'subscribers';
    if (accessType === 'followers') return 'followers';
    if (accessType === 'team') return 'team';
    if (amount === 0 || accessType === 'free') return 'free';
    return 'paid';
  });

  const label = $derived.by(() => {
    if (purchased) return m.content_price_purchased();
    if (included) return m.content_price_included();
    // Follower viewing followers-only → "Included"
    if (accessType === 'followers' && isFollower) return m.content_price_included();
    if (accessType === 'subscribers') {
      // Show price if dual-gated (purchasable + subscriber), otherwise tier name or generic
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
</script>

{#if show}
  <span class="price-badge {className ?? ''}" data-variant={variant} {...restProps}>
    {#if showCheck}
      <CheckIcon size={12} />
    {/if}
    {label}
  </span>
{/if}

<style>
  .price-badge {
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
</style>
