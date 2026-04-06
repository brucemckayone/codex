<script lang="ts">
  import * as m from '$paraglide/messages';
  import { Button } from '$lib/components/ui';
  import ProfileForm from '$lib/components/ProfileForm.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>{m.account_profile_title()} - Codex</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="account-page">
  <h1>{m.account_profile_title()}</h1>
  <p class="description">{m.account_profile_description()}</p>

  <ProfileForm profile={data.profile}>
    {#snippet header()}
      {#if data.user?.role === 'customer'}
        <div class="upgrade-banner">
          <div class="upgrade-content">
            <h2>Start creating on Codex</h2>
            <p>Set up your creator profile, upload content, and build your audience.</p>
          </div>
          <a href="/become-creator">
            <Button variant="primary">Become a Creator</Button>
          </a>
        </div>
      {/if}
    {/snippet}
  </ProfileForm>
</div>

<style>
  .account-page h1 {
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

  .upgrade-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-5);
    margin-bottom: var(--space-6);
    border-radius: var(--radius-lg);
    background-color: var(--color-interactive-subtle);
    border: var(--border-width) var(--border-style) var(--color-focus-ring);
  }

  .upgrade-content h2 {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-interactive-active);
    margin-bottom: var(--space-1);
  }

  .upgrade-content p {
    font-size: var(--text-sm);
    color: var(--color-interactive-active);
  }
</style>
