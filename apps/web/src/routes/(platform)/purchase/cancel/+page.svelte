<script lang="ts">
  import { page } from '$app/stores';
  import * as m from '$paraglide/messages';

  const contentId = $derived($page.url.searchParams.get('contentId'));

  const xIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;

  const tryAgainUrl = $derived(contentId ? `/content/${contentId}` : '/discover');
</script>

<svelte:head>
  <title>{m.commerce_payment_cancelled()} | Codex</title>
  <meta name="description" content={m.commerce_no_charges_made()} />
</svelte:head>

<div class="cancel-page">
  <div class="cancel-card">
    <div class="cancel-icon" aria-hidden="true">
      {@html xIcon}
    </div>

    <h1 class="cancel-title">{m.commerce_payment_cancelled()}</h1>
    <p class="cancel-description">{m.commerce_no_charges_made()}</p>

    <div class="cancel-actions">
      <a href={tryAgainUrl} class="btn btn-primary">
        {m.commerce_try_again()}
      </a>
      <a href="/" class="btn btn-secondary">
        {m.commerce_back_to_home()}
      </a>
    </div>
  </div>
</div>

<style>
  .cancel-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--color-background);
  }

  .cancel-card {
    width: 100%;
    max-width: 480px;
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-8);
    box-shadow: var(--shadow-lg);
    border: var(--border-width) var(--border-style) var(--color-border);
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
  }

  .cancel-icon {
    color: var(--color-warning);
    margin-bottom: var(--space-2);
  }

  .cancel-title {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
  }

  .cancel-description {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .cancel-actions {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-2);
    flex-wrap: wrap;
    justify-content: center;
    width: 100%;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    text-decoration: none;
    border: none;
    cursor: pointer;
    transition: var(--transition-colors);
    font-family: inherit;
  }

  .btn-primary {
    background: var(--color-primary-500);
    color: #ffffff;
  }

  .btn-primary:hover {
    background: var(--color-primary-600);
  }

  .btn-secondary {
    background: transparent;
    color: var(--color-text-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .btn-secondary:hover {
    background: var(--color-neutral-50);
    color: var(--color-text);
  }

  /* Dark mode */
  [data-theme='dark'] .cancel-page {
    background: var(--color-background);
  }

  [data-theme='dark'] .cancel-card {
    background: var(--color-surface);
    border-color: var(--color-border);
  }

  [data-theme='dark'] .cancel-title {
    color: var(--color-text);
  }

  [data-theme='dark'] .cancel-description {
    color: var(--color-text-secondary);
  }

  [data-theme='dark'] .btn-secondary {
    border-color: var(--color-border);
    color: var(--color-text-secondary);
  }

  [data-theme='dark'] .btn-secondary:hover {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }
</style>
