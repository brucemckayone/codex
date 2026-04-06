<!--
  @component SubscriptionBadge

  Small badge showing a subscription tier name.
  Used in library cards and content cards to indicate tier-gated content.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';

  interface Props {
    tierName: string;
    class?: string;
  }

  const { tierName, class: className }: Props = $props();
</script>

<span class="subscription-badge {className ?? ''}" title={tierName}>
  {tierName}
</span>

<style>
  .subscription-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    background-color: var(--color-interactive-subtle);
    border-radius: var(--radius-full);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }
</style>
