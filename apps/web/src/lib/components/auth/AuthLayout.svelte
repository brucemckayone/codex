<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    subtitle?: string;
    children: Snippet;
    footer?: Snippet;
  }

  const { title, subtitle, children, footer }: Props = $props();
</script>

<a href="/" class="auth-logo">codex</a>

<h1>{title}</h1>

{#if subtitle}
  <p class="auth-subtitle">{subtitle}</p>
{/if}

{@render children()}

{#if footer}
  {@render footer()}
{/if}

<style>
  .auth-logo {
    display: block;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-interactive);
    text-transform: lowercase;
    letter-spacing: var(--tracking-tight);
    margin-bottom: var(--space-6);
  }

  h1 {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-6);
  }

  .auth-subtitle {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin-top: calc(-1 * var(--space-4));
    margin-bottom: var(--space-6);
  }

  /* Shared styles for auth page children — :global scoped to parent card */
  :global(.auth-form) {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  :global(.auth-field) {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  :global(.auth-error) {
    padding: var(--space-3);
    background-color: var(--color-error-50);
    border: var(--border-width) var(--border-style) var(--color-error-200);
    border-radius: var(--radius-md);
    color: var(--color-error-700);
    font-size: var(--text-sm);
  }

  :global(.auth-success) {
    padding: var(--space-3);
    background-color: var(--color-success-50);
    border: var(--border-width) var(--border-style) var(--color-success-200);
    border-radius: var(--radius-md);
    color: var(--color-success-700);
    font-size: var(--text-sm);
  }

  :global(.auth-submit) {
    width: 100%;
  }

  :global(.auth-divider) {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-4) 0;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  :global(.auth-divider)::before,
  :global(.auth-divider)::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--color-border);
  }

  :global(.auth-footer) {
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  :global(.auth-link) {
    color: var(--color-interactive);
    font-weight: var(--font-medium);
  }

  :global(.auth-link):hover {
    color: var(--color-interactive-hover);
  }

  :global(.auth-hint) {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  :global(.auth-back-link) {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-align: center;
    display: block;
  }

  :global(.auth-back-link):hover {
    color: var(--color-interactive);
  }
</style>
