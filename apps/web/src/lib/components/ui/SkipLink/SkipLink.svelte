<script lang="ts">
  interface Props {
    href?: string;
    class?: string;
  }

  const { href = '#main-content', class: className }: Props = $props();
</script>

<a class="skip-link {className ?? ''}" {href}>
  Skip to main content
</a>

<style>
  .skip-link {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    z-index: var(--z-modal);
    padding: var(--space-2) var(--space-4);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    text-decoration: none;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    transform: translateY(-200%);
    transition: transform var(--duration-normal) var(--ease-out);
  }

  .skip-link:focus {
    transform: translateY(0);
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }
</style>
