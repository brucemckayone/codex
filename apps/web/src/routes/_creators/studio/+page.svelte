<script lang="ts">
  /**
   * Personal studio dashboard
   * Creator's private workspace for managing all personal content
   */
</script>

<svelte:head>
  <title>My Studio | Revelations</title>
</svelte:head>

<div class="studio">
  <h1>My Studio</h1>
  <p class="subtitle">Manage your personal content across all organizations</p>

  <div class="dashboard-grid">
    <div class="dashboard-card">
      <h3>📝 Personal Content</h3>
      <p>Create and manage your content</p>
      <a href="/studio/content">View Content</a>
    </div>
    <div class="dashboard-card">
      <h3>🎬 Media Library</h3>
      <p>All your media assets</p>
      <a href="/studio/media">View Media</a>
    </div>
    <div class="dashboard-card">
      <h3>📊 Analytics</h3>
      <p>Track your performance</p>
      <a href="/studio/analytics">View Analytics</a>
    </div>
    <div class="dashboard-card">
      <h3>🏢 Organizations</h3>
      <p>Manage org memberships</p>
      <a href="/studio/orgs">View Organizations</a>
    </div>
  </div>
</div>


