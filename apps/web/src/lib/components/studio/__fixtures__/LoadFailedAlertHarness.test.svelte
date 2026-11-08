<!--
  Test-only harness: LoadFailedAlert as a page mounts it, with the query
  DERIVED from its remote function, as every caller does. Named
  `*.test.svelte` (a fixture) so the vitest include globs never collect it.
-->
<script lang="ts">
  import LoadFailedAlert from '../LoadFailedAlert.svelte';
  import type { KitQuery } from './kit-query.mock.svelte';

  const { remote }: { remote: KitQuery<unknown> } = $props();

  const query = $derived(remote.get());
</script>

<LoadFailedAlert
  {query}
  message="We couldn't load it."
  againMessage="We still couldn't load it."
  loadedMessage="It loaded."
  data-testid="load-error"
/>
