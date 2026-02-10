<script lang="ts">
  /**
   * Account notification preferences page
   */
</script>

<svelte:head>
  <title>Notification Preferences - Codex</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="notifications">
  <h1>Notifications</h1>
  <p class="description">Manage how and when you receive notifications.</p>

  <div class="settings-card">
    <h2>Email Notifications</h2>
    <div class="toggle-row">
      <div class="toggle-info">
        <span class="toggle-label">New content from followed creators</span>
        <span class="toggle-desc">Get notified when creators you follow publish new content.</span>
      </div>
      <input type="checkbox" class="toggle-input" checked />
    </div>
    <div class="toggle-row">
      <div class="toggle-info">
        <span class="toggle-label">Purchase receipts</span>
        <span class="toggle-desc">Receive email receipts for purchases.</span>
      </div>
      <input type="checkbox" class="toggle-input" checked />
    </div>
    <div class="toggle-row">
      <div class="toggle-info">
        <span class="toggle-label">Product updates</span>
        <span class="toggle-desc">Learn about new features and improvements.</span>
      </div>
      <input type="checkbox" class="toggle-input" />
    </div>
  </div>
</div>

<style>
  .notifications h1 {
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
  }

  .settings-card h2 {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin-bottom: var(--space-6);
  }

  .toggle-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) 0;
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .toggle-row:last-child {
    border-bottom: none;
  }

  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .toggle-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .toggle-desc {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .toggle-input {
    flex-shrink: 0;
    width: 1.25rem;
    height: 1.25rem;
    accent-color: var(--color-primary-500);
    cursor: pointer;
    margin-top: var(--space-1);
  }
</style>
