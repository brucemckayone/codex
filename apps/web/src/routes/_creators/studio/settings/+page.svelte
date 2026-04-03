<!--
  @component CreatorStudioSettings

  Creator profile settings page within the personal studio.
  Manages display name, username, bio, avatar, and social links.
  Reuses the same remote functions as the account profile page.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { updateProfileForm } from '$lib/remote/account.remote';
  import { avatarUploadForm } from '$lib/remote/avatar-upload.remote';
  import { avatarDeleteForm } from '$lib/remote/avatar-delete.remote';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import { Avatar, AvatarImage, AvatarFallback } from '$lib/components/ui/Avatar';
  import { Alert, PageHeader } from '$lib/components/ui';

  import { onDestroy, tick } from 'svelte';
  import { invalidateAll } from '$app/navigation';

  let { data } = $props();
  const profile = $derived(data.profile);

  let email = $state('');
  $effect(() => {
    if (profile?.email) email = profile.email;
  });

  // Avatar preview state
  let avatarPreview = $state<string | null>(null);
  let hasSelectedFile = $state(false);
  let fileInput: HTMLInputElement;

  $effect(() => {
    if (!hasSelectedFile) {
      avatarPreview = profile?.image ?? null;
    }
  });

  const showDeleteAvatar = $derived(!!avatarPreview && !hasSelectedFile);

  const initials = $derived(
    profile?.name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) ?? profile?.username?.slice(0, 2).toUpperCase() ?? '?'
  );

  function handleAvatarSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      avatarPreview = URL.createObjectURL(file);
      hasSelectedFile = true;
    }
  }

  function handleAvatarCancel() {
    avatarPreview = profile?.image ?? null;
    hasSelectedFile = false;
    if (fileInput) fileInput.value = '';
  }

  // Success message state
  let showSuccess = $state(false);
  let successTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastHandledResult: unknown = null;

  function showSuccessMessage() {
    showSuccess = true;
    if (successTimeout) clearTimeout(successTimeout);
    successTimeout = setTimeout(() => (showSuccess = false), 3000);
  }

  onDestroy(() => {
    if (successTimeout) clearTimeout(successTimeout);
  });

  $effect(() => {
    const result = updateProfileForm.result;
    if (result?.success && !updateProfileForm.pending && result !== lastHandledResult) {
      lastHandledResult = result;
      showSuccessMessage();
      void invalidateAll();
      if (result.data?.image) {
        avatarPreview = result.data.image;
      }
      setTimeout(() => {
        const d = result.data;
        if (d) {
          updateProfileForm.fields.set({
            displayName: d.name ?? '',
            username: d.username ?? '',
            bio: d.bio ?? '',
            website: d.socialLinks?.website ?? '',
            twitter: d.socialLinks?.twitter ?? '',
            youtube: d.socialLinks?.youtube ?? '',
            instagram: d.socialLinks?.instagram ?? '',
          });
          if (d.email) email = d.email;
        }
      }, 100);
    }
  });

  $effect(() => {
    if (avatarUploadForm.result?.success && !avatarUploadForm.pending) {
      const resultData = avatarUploadForm.result.data;
      if (resultData?.avatarUrl) {
        avatarPreview = resultData.avatarUrl;
      }
      hasSelectedFile = false;
      if (fileInput) fileInput.value = '';
      void invalidateAll();
    }
  });

  $effect(() => {
    if (avatarDeleteForm.result?.success && !avatarDeleteForm.pending) {
      avatarPreview = null;
      hasSelectedFile = false;
      void invalidateAll();
    }
  });

  const { displayName, username, bio, website, twitter, youtube, instagram } =
    updateProfileForm.fields;

  $effect(() => {
    if (profile) {
      updateProfileForm.fields.set({
        displayName: profile.name ?? '',
        username: profile.username ?? '',
        bio: profile.bio ?? '',
        website: profile.socialLinks?.website ?? '',
        twitter: profile.socialLinks?.twitter ?? '',
        youtube: profile.socialLinks?.youtube ?? '',
        instagram: profile.socialLinks?.instagram ?? '',
      });
    }
  });
</script>

<svelte:head>
  <title>Settings | My Studio</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="settings-page">
  <PageHeader title="Profile Settings" description="Manage your creator profile and social links" />

  {#if showSuccess}
    <Alert variant="success">
      {m.account_save_success()}
    </Alert>
  {/if}

  {#if updateProfileForm.result?.error}
    <Alert variant="error">{updateProfileForm.result.error}</Alert>
  {/if}

  <!-- Avatar Section -->
  <div class="settings-card">
    <h2>Avatar</h2>
    <div class="avatar-container">
      <Avatar src={avatarPreview ?? undefined}>
        <AvatarImage src={avatarPreview ?? ''} alt="Avatar" />
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>

      <div class="avatar-actions">
        <form {...avatarUploadForm} enctype="multipart/form-data" class="avatar-upload-form">
          <input
            bind:this={fileInput}
            type="file"
            id="avatar-upload"
            {...avatarUploadForm.fields.avatar.as('file')}
            accept="image/*"
            hidden
            onchange={handleAvatarSelect}
          />

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onclick={() => fileInput?.click()}
            disabled={avatarUploadForm.pending > 0}
          >
            {m.account_avatar_upload()}
          </Button>

          {#if hasSelectedFile}
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={avatarUploadForm.pending > 0}
              loading={avatarUploadForm.pending > 0}
            >
              {avatarUploadForm.pending > 0
                ? m.account_avatar_uploading()
                : m.account_avatar_save()}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onclick={handleAvatarCancel}
              disabled={avatarUploadForm.pending > 0}
            >
              {m.common_cancel()}
            </Button>
          {/if}
        </form>

        {#if showDeleteAvatar}
          <form {...avatarDeleteForm}>
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={avatarDeleteForm.pending > 0}
              loading={avatarDeleteForm.pending > 0}
            >
              {m.account_avatar_remove()}
            </Button>
          </form>
        {/if}
      </div>
    </div>

    <p class="avatar-help">{m.account_avatar_help()}</p>

    {#if avatarUploadForm.result?.error}
      <Alert variant="error">{avatarUploadForm.result.error}</Alert>
    {/if}

    {#if avatarDeleteForm.result?.error}
      <Alert variant="error">{avatarDeleteForm.result.error}</Alert>
    {/if}
  </div>

  <!-- Profile Form -->
  <form {...updateProfileForm} class="settings-card" novalidate>
    <h2>{m.account_personal_information()}</h2>

    <div class="form-group">
      <Label for="displayName">{m.account_display_name()}</Label>
      <Input
        id="displayName"
        {...displayName.as('text')}
        placeholder={m.account_display_name_placeholder()}
      />
      {#each displayName.issues() as issue}
        <p class="field-error">{issue.message}</p>
      {/each}
    </div>

    <div class="form-group">
      <Label for="email">{m.account_email()}</Label>
      <Input id="email" name="email" bind:value={email} disabled />
      <p class="form-help">{m.account_email_change_disclaimer()}</p>
    </div>

    <div class="form-group">
      <Label for="username">{m.account_username()}</Label>
      <Input
        id="username"
        {...username.as('text')}
        placeholder={m.account_username_placeholder()}
      />
      {#each username.issues() as issue}
        <p class="field-error">{issue.message}</p>
      {/each}
    </div>

    <div class="form-group">
      <Label for="bio">{m.account_bio()}</Label>
      <TextArea
        id="bio"
        {...bio.as('text')}
        placeholder={m.account_bio_placeholder()}
        rows={4}
      />
      {#each bio.issues() as issue}
        <p class="field-error">{issue.message}</p>
      {/each}
    </div>

    <h3>{m.account_social_links()}</h3>

    <div class="form-group">
      <Label for="website">{m.account_social_website()}</Label>
      <Input id="website" {...website.as('url')} placeholder="https://example.com" />
      {#each website.issues() as issue}
        <p class="field-error">{issue.message}</p>
      {/each}
    </div>

    <div class="form-group">
      <Label for="twitter">{m.account_social_twitter()}</Label>
      <Input id="twitter" {...twitter.as('url')} placeholder="https://twitter.com/username" />
      {#each twitter.issues() as issue}
        <p class="field-error">{issue.message}</p>
      {/each}
    </div>

    <div class="form-group">
      <Label for="youtube">{m.account_social_youtube()}</Label>
      <Input id="youtube" {...youtube.as('url')} placeholder="https://youtube.com/channel/..." />
      {#each youtube.issues() as issue}
        <p class="field-error">{issue.message}</p>
      {/each}
    </div>

    <div class="form-group">
      <Label for="instagram">{m.account_social_instagram()}</Label>
      <Input id="instagram" {...instagram.as('url')} placeholder="https://instagram.com/username" />
      {#each instagram.issues() as issue}
        <p class="field-error">{issue.message}</p>
      {/each}
    </div>

    <div class="form-actions">
      <Button type="submit" variant="primary" loading={updateProfileForm.pending > 0}>
        {updateProfileForm.pending > 0 ? m.account_saving() : m.account_save_button()}
      </Button>
    </div>
  </form>
</div>

<style>
  .settings-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 720px;
  }

.field-error {
    font-size: var(--text-xs);
    color: var(--color-error-600);
    margin-top: var(--space-1);
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

  .settings-card h3 {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin-top: var(--space-6);
    margin-bottom: var(--space-4);
  }

  .avatar-container {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: flex-start;
  }

  @media (--breakpoint-sm) {
    .avatar-container {
      flex-direction: row;
      align-items: center;
    }
  }

  .avatar-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .avatar-upload-form {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .avatar-help {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin: var(--space-4) 0 0 0;
  }

  .form-group {
    margin-bottom: var(--space-4);
  }

  .form-group:last-child {
    margin-bottom: 0;
  }

  .form-help {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin-top: var(--space-1);
  }

  .form-actions {
    margin-top: var(--space-6);
    padding-top: var(--space-6);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }
</style>
