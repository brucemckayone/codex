<!--
  Test-only harness: LoadFailedAlert as a page mounts it, with the query
  DERIVED from its remote function, as every caller does, or from a read of
  the page's load (`load-read.mock.svelte`). With `refuseStatus`
  it lets the query go on that status, as the negotiation thread passes
  `threadRefused ? null : threadQuery`. The input stands for anywhere else on
  the page. Named `*.test.svelte` (a fixture) so the vitest include globs
  never collect it.
-->
<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import LoadFailedAlert from '../LoadFailedAlert.svelte';

  interface Props {
    /** A kit query double or a load read double: what the page holds now. */
    remote: {
      get(): NonNullable<ComponentProps<typeof LoadFailedAlert>['query']>;
    };
    refuseStatus?: number;
  }

  const { remote, refuseStatus }: Props = $props();

  function statusOf(error: unknown): number | undefined {
    if (error && typeof error === 'object' && 'status' in error) {
      return typeof error.status === 'number' ? error.status : undefined;
    }
    return undefined;
  }

  // Shaped as the negotiation thread is: the query derived on its own, the
  // refusal derived from its error, and the prop choosing between them.
  const held = $derived(remote.get());
  const refused = $derived(
    refuseStatus !== undefined && statusOf(held.error) === refuseStatus
  );
</script>

<LoadFailedAlert
  query={refused ? null : held}
  message="We couldn't load it."
  againMessage="We still couldn't load it."
  loadedMessage="It loaded."
  data-testid="load-error"
/>
<input data-testid="elsewhere" aria-label="Elsewhere" />
