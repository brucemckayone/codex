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
    border: 2px solid var(--color-neutral-200, #e5e5e5);
    border-top-color: var(--color-primary-500, #c24129);
    animation: spin 0.6s linear infinite;
  }

  .spinner-sm {
    width: 16px;
    height: 16px;
  }

  .spinner-md {
    width: 24px;
    height: 24px;
  }

  .spinner-lg {
    width: 40px;
    height: 40px;
    border-width: 3px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
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
        opacity: 0.4;
      }
    }
  }
</style>
