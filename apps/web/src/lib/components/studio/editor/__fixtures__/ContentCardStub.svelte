<!-- Stands in for ContentCard: what the Publish step's preview was given. -->
<script lang="ts">
  const {
    title,
    thumbnail = null,
    price = null,
  }: {
    title: string;
    thumbnail?: string | null;
    price?: { amount: number; currency: string } | null;
  } = $props();
</script>

<div data-probe="card" data-thumbnail={thumbnail ?? ''} data-price={price ? `${price.currency} ${price.amount}` : ''}>
  {title}
</div>
