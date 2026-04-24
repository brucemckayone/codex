<script lang="ts">
  import type { Snippet } from 'svelte';
  import ErrorBoundary from './ErrorBoundary.svelte';
  import ErrorTrigger from './ErrorTrigger.svelte';

  interface Props {
    shouldError?: boolean;
    message?: string;
    fallback?: Snippet<[Error, () => void]>;
    onerror?: (error: Error, reset: () => void) => void;
    onreset?: () => void;
  }

  const {
    shouldError = false,
    message = 'Harness error',
    fallback,
    onerror,
    onreset,
  }: Props = $props();
</script>

<ErrorBoundary {fallback} {onerror} {onreset}>
  <div data-testid="normal-child">Normal child content</div>
  <ErrorTrigger {shouldError} {message} />
</ErrorBoundary>
