<!--
  @component CreatorStudioDashboard

  Personal studio dashboard with navigation cards.
  Stats and analytics will be added once the backend supports
  creator-scoped queries without organizationId.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { FileIcon, VideoIcon, SettingsIcon } from '$lib/components/ui/Icon';

  let { data } = $props();
</script>

<svelte:head>
  <title>{m.studio_dashboard_title()} | My Studio</title>
</svelte:head>

<div class="dashboard">
  <header class="dashboard-header">
    <h1 class="dashboard-title">{m.studio_dashboard_title()}</h1>
    <p class="dashboard-subtitle">Manage your personal content</p>
  </header>

  <div class="dashboard-grid">
    <a href="/studio/content" class="dashboard-card">
      <div class="card-icon">
        <FileIcon size={24} />
      </div>
      <h3 class="card-title">Content</h3>
      <p class="card-description">Create and manage your personal content</p>
    </a>

    <a href="/studio/media" class="dashboard-card">
      <div class="card-icon">
        <VideoIcon size={24} />
      </div>
      <h3 class="card-title">Media Library</h3>
      <p class="card-description">Upload and manage your media assets</p>
    </a>

    <a href="/studio/settings" class="dashboard-card">
      <div class="card-icon">
        <SettingsIcon size={24} />
      </div>
      <h3 class="card-title">Settings</h3>
      <p class="card-description">Update your profile and preferences</p>
    </a>
  </div>
</div>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 1200px;
  }

  .dashboard-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .dashboard-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-tight);
  }

  .dashboard-subtitle {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    line-height: var(--leading-normal);
  }

  .dashboard-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  @media (--breakpoint-sm) {
    .dashboard-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (--breakpoint-lg) {
    .dashboard-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .dashboard-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .dashboard-card:hover {
    border-color: var(--color-brand-primary-subtle);
    background-color: var(--color-interactive-subtle);
  }

  .card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-10);
    height: var(--space-10);
    border-radius: var(--radius-md);
    background-color: var(--color-interactive-subtle);
    color: var(--color-interactive-hover);
    margin-bottom: var(--space-1);
  }

  .card-title {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .card-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    line-height: var(--leading-relaxed);
  }

  :global([data-theme='dark']) .dashboard-card {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .dashboard-card:hover {
    border-color: var(--color-interactive-active);
    background-color: color-mix(in srgb, var(--color-interactive) 10%, var(--color-surface-dark));
  }

  :global([data-theme='dark']) .card-icon {
    background-color: color-mix(in srgb, var(--color-interactive) 15%, var(--color-surface-dark));
    color: var(--color-interactive);
  }

  :global([data-theme='dark']) .card-title {
    color: var(--color-text-dark);
  }
</style>
