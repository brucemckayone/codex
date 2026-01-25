<script lang="ts">
  /**
   * Organization studio dashboard
   * Requires Creator+ role (to be enforced)
   */
</script>

<svelte:head>
  <title>Studio Dashboard | Revelations</title>
</svelte:head>

<div class="studio">
  <h1>Studio Dashboard</h1>
  <p class="subtitle">Manage your content and organization</p>

  <div class="dashboard-grid">
    <div class="dashboard-card">
      <h3>📝 Content</h3>
      <p>Create and manage your content</p>
      <a href="/studio/content">View Content</a>
    </div>
    <div class="dashboard-card">
      <h3>📊 Analytics</h3>
      <p>Track your performance</p>
      <a href="/studio/analytics">View Analytics</a>
    </div>
    <div class="dashboard-card">
      <h3>🎬 Media</h3>
      <p>Manage your media library</p>
      <a href="/studio/media">View Media</a>
    </div>
  </div>
</div>


