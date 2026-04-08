<script lang="ts">
  interface Props {
    size?: 'sm' | 'md' | 'lg';
  }

  const { size = 'md' }: Props = $props();
</script>

<span class="spinner spinner-{size}" role="status" aria-label="Loading">
  <span class="sr-only">Loading...</span>
</span>

<style>
  .spinner {
    display: inline-block;
    border-radius: 50%;
    border: var(--border-width-thick) solid var(--color-border);
    border-top-color: var(--color-interactive);
    animation: spin 0.6s linear infinite;
  }

  .spinner-sm {
    width: var(--space-4);
    height: var(--space-4);
  }

  .spinner-md {
    width: var(--space-6);
    height: var(--space-6);
  }

  .spinner-lg {
    width: var(--space-10);
    height: var(--space-10);
    border-width: 3px;
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: var(--opacity-40);
      }
    }
  }
</style>
