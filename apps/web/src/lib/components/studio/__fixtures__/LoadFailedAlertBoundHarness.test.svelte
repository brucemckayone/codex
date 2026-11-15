<!--
  Test-only harness: a page that binds LoadFailedAlert's `retrying` to keep
  its failed layout through a Retry, as Monetisation and Subscribers do, and
  can stop rendering the alert while the page stays (`show`: their `isOwner`
  turning false). The page's bound value is written out for the test to read.
  Named `*.test.svelte` (a fixture) so the vitest include globs never collect
  it.
-->
<script lang="ts">
  import type { AlertRead } from '../alert-read';
  import LoadFailedAlert from '../LoadFailedAlert.svelte';

  interface Props {
    /** A kit query double: what the page holds now. */
    remote: { get(): AlertRead };
    show: boolean;
  }

  const { remote, show }: Props = $props();

  const held = $derived(remote.get());
  let retrying = $state(false);
</script>

{#if show}
  <LoadFailedAlert
    query={held}
    bind:retrying
    message="We couldn't load it."
    againMessage="We still couldn't load it."
    loadedMessage="It loaded."
    data-testid="load-error"
  />
{/if}
<p data-testid="page-retrying">{retrying}</p>
