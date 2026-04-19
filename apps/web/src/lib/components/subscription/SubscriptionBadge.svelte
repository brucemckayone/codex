<!--
  @component SubscriptionBadge

  Small badge showing a subscription tier name.
  Used in library cards and content cards to indicate tier-gated content.

  Note: previously truncated with `max-width: 120px` + `title={tierName}`
  as overflow disclosure. That pattern fails WCAG 1.4.13 (Content on
  Hover or Focus) — `title` only surfaces on pointer hover, so keyboard
  users could not reveal the full tier name. The badge now sizes to
  content: full tier name always visible, no tooltip needed. If a
  future call site needs to bound the badge width, prefer wrapping in
  Melt UI `createTooltip` over re-adding `title`.
-->
<script lang="ts">
  interface Props {
    tierName: string;
    class?: string;
  }

  const { tierName, class: className }: Props = $props();
</script>

<span class="subscription-badge {className ?? ''}">
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
  }
</style>
