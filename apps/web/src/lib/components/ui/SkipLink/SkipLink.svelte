<script lang="ts">
  interface Props {
    href?: string;
    label?: string;
    class?: string;
  }

  const { href = '#main-content', label = 'Skip to main content', class: className }: Props = $props();
</script>

<a class="skip-link {className ?? ''}" {href}>
  {label}
</a>

<style>
  .skip-link {
    position: absolute;
    top: var(--space-2);
    left: 50%;
    z-index: var(--z-modal);
    padding: var(--space-2) var(--space-4);
    background-color: var(--color-primary-500);
    color: white;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    text-decoration: none;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    transform: translate(-50%, -200%);
    transition: transform var(--duration-normal) var(--ease-out);
  }

  .skip-link:focus {
    transform: translate(-50%, 0);
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }
</style>
