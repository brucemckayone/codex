<script lang="ts">
  interface Props {
    shouldError?: boolean;
    message?: string;
  }

  const { shouldError = false, message = 'Component error!' }: Props = $props();
</script>

<!-- Throw error during render if shouldError is true -->
{#if shouldError}
  {@const _ = (() => { throw new Error(message); })()}
{/if}

<div style="padding: 1rem; background: #f5f5f5; border-radius: 0.5rem;">
  <p style="margin: 0;">This component renders successfully when shouldError is false.</p>
</div>
