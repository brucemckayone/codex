<script lang="ts">
  /**
   * Account payment/billing page
   */
</script>

<svelte:head>
  <title>Payment Settings - Codex</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="payment">
  <h1>Payments</h1>
  <p class="description">Manage your billing information and purchase history.</p>

  <div class="settings-card">
    <h2>Billing Information</h2>
    <p class="placeholder">No payment methods on file. Payment methods will be added when you make your first purchase.</p>
  </div>

  <div class="settings-card">
    <h2>Purchase History</h2>
    <p class="placeholder">No purchases yet. Browse the <a href="/discover" class="link">Discover</a> page to find content.</p>
  </div>
</div>

<style>
  .payment h1 {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin-bottom: var(--space-2);
  }

  .description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin-bottom: var(--space-8);
  }

  .settings-card {
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    margin-bottom: var(--space-6);
  }

  .settings-card h2 {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin-bottom: var(--space-4);
  }

  .placeholder {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .link {
    color: var(--color-primary-500);
    text-decoration: underline;
  }

  .link:hover {
    color: var(--color-primary-600);
  }
</style>
