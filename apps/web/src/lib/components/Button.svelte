<script lang="ts">
  interface Props {
    variant?: 'primary' | 'secondary';
    disabled?: boolean;
    onclick?: () => void;
    children?: any;
  }

  const {
    variant = 'primary',
    disabled = false,
    onclick,
    children,
  }: Props = $props();
</script>

<button class="btn btn-{variant}" {disabled} {onclick}>
  {@render children?.()}
</button>

<style>
  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 0.25rem;
    cursor: pointer;
    font-size: 1rem;
  }

  .btn-primary {
    background-color: #007bff;
    color: white;
  }

  .btn-secondary {
    background-color: #6c757d;
    color: white;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
