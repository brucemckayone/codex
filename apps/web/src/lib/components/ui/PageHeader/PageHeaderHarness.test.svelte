<!--
  Test harness for PageHeader's `meta` seam.

  `createRawSnippet` can only return a single element, so it cannot express the
  shape every real call site actually uses: a snippet whose contents are
  themselves guarded by an `{#if}` (`customers/+page.svelte` guards on
  `hasCustomers && totalCustomers > 0`, `team/+page.svelte` on
  `!loading && teamMembers.length > 0`). That "snippet supplied but renders
  nothing" branch is the one the `:empty` collapse exists for, so it has to be
  tested through a real component.
-->
<script lang="ts">
  import PageHeader from './PageHeader.svelte';

  interface Props {
    /** When false the `meta` snippet is supplied but renders no items. */
    hasFacts?: boolean;
  }

  const { hasFacts = true }: Props = $props();
</script>

<PageHeader title="Team" kicker="Organisation">
  {#snippet meta()}
    {#if hasFacts}
      <li>Members: 4</li>
      <li>Last 30 days</li>
    {/if}
  {/snippet}
</PageHeader>
