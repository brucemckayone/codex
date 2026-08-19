<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLThAttributes } from 'svelte/elements';

  interface Props extends HTMLThAttributes {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<th scope="col" class="table-head {className ?? ''}" {...restProps}>
  {@render children()}
</th>

<style>
  /* SHARED PRIMITIVE — consumed by studio/billing, studio/payouts,
     studio/sales, studio/subscribers, account/payment, CustomerDetailDrawer
     and MemberTable. The label treatment below is deliberately the same one
     `ui/DataTable` already gives its own headers (DataTable.svelte:200-202),
     because the two were drifting: a raw-Table `th` rendered at 15px in
     sentence case with normal tracking — the same size and case as the data
     underneath it, so the header row did not read as a header — while
     DataTable's rendered at 13px uppercase with wide tracking. Same band
     colour on both, measured; this was the whole "why does Customers look
     finished" delta at the table level. Changing the primitive converges every
     raw-Table consumer instead of adding a Team-local override that would
     widen the gap. */
  .table-head {
    height: var(--space-10);
    padding: 0 var(--space-4);
    text-align: left;
    vertical-align: middle;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    letter-spacing: var(--tracking-wide);
    text-transform: var(--text-transform-label);
    color: var(--color-text-secondary);
  }
</style>
