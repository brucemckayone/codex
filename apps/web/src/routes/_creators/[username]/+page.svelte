<script lang="ts">
  /**
   * Creator profile page
   * Shows creator's public profile and content feed
   */
  import type { PageData } from './$types';

  const { data }: { data: PageData } = $props();
  const username = data.username ?? 'Creator';
</script>

<svelte:head>
  <title>{username} | Revelations Creators</title>
</svelte:head>

<div class="profile">
  <section class="profile-header">
    <div class="avatar">
      <div class="avatar-placeholder">{username.charAt(0).toUpperCase()}</div>
    </div>
    <h1>{username}</h1>
    <p class="bio">Independent creator sharing transformative content</p>
    {#if !data.user}
      <a href="/login" class="follow-btn">Follow</a>
    {/if}
  </section>

  <section class="content">
    <h2>Latest Content</h2>
    <div class="content-grid">
      <div class="placeholder-card">Content coming soon...</div>
      <div class="placeholder-card">Content coming soon...</div>
      <div class="placeholder-card">Content coming soon...</div>
    </div>
  </section>

  <section class="organizations">
    <h2>Organizations</h2>
    <p class="subtitle">Creates content for these organizations</p>
    <div class="org-list">
      <div class="placeholder-org">Organization badges coming soon...</div>
    </div>
  </section>
</div>


