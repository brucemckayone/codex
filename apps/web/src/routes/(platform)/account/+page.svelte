<script lang="ts">
  /**
   * Account profile settings page
   */
</script>

<svelte:head>
  <title>Profile Settings - Codex</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="profile">
  <h1>Profile</h1>
  <p class="description">Manage your account profile and preferences.</p>

  <div class="settings-card">
    <h2>Personal Information</h2>
    <div class="form-group">
      <label class="form-label" for="display-name">Display Name</label>
      <input type="text" id="display-name" class="form-input" placeholder="Your display name" />
    </div>
    <div class="form-group">
      <label class="form-label" for="email">Email</label>
      <input type="email" id="email" class="form-input" placeholder="your@email.com" disabled />
      <p class="form-help">Email cannot be changed here. Contact support for assistance.</p>
    </div>
  </div>
</div>

<style>
  .profile h1 {
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

  .form-group {
    margin-bottom: var(--space-4);
  }

  .form-label {
    display: block;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    margin-bottom: var(--space-1);
  }

  .form-input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    background-color: var(--color-background);
    color: var(--color-text);
  }

  .form-input:focus {
    outline: 2px solid var(--color-primary-500);
    outline-offset: -1px;
  }

  .form-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .form-help {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin-top: var(--space-1);
  }
</style>
