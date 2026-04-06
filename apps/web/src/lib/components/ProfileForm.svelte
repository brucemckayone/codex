<!--
  @component ProfileForm

  Shared profile editing form used by both the platform account page
  and the creator studio settings page. Manages display name, username,
  bio, avatar upload/delete, and social links.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as m from '$paraglide/messages';
  import { updateProfileForm } from '$lib/remote/account.remote';
  import { avatarUploadForm } from '$lib/remote/avatar-upload.remote';
  import { avatarDeleteForm } from '$lib/remote/avatar-delete.remote';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import { Avatar, AvatarImage, AvatarFallback } from '$lib/components/ui/Avatar';
  import { Alert, Card } from '$lib/components/ui';

  import { onDestroy } from 'svelte';
  import { invalidateAll } from '$app/navigation';

  interface ProfileData {
    name?: string | null;
    username?: string | null;
    email?: string | null;
    bio?: string | null;
    image?: string | null;
    socialLinks?: {
      website?: string;
      twitter?: string;
      youtube?: string;
      instagram?: string;
    } | null;
  }

  interface Props {
    /** Profile data from server load */
    profile: ProfileData | null | undefined;
    /** Optional content rendered before the form (e.g., upgrade banners) */
    header?: Snippet;
  }

  const { profile: profileProp, header }: Props = $props();

  const profile = $derived(profileProp);

  // Track email separately since it's a read-only field not managed by form()
  let email = $state('');
  $effect(() => {
    if (profile?.email) email = profile.email;
  });

  // Avatar preview state
  let avatarPreview = $state<string | null>(null);
  let hasSelectedFile = $state(false);
  let fileInput: HTMLInputElement;

  // Sync avatar preview with server profile (unless user has selected a file)
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

  // Repopulate form and show success after profile update
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

  // Handle avatar upload success
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

  // Handle avatar delete success
  $effect(() => {
    if (avatarDeleteForm.result?.success && !avatarDeleteForm.pending) {
      avatarPreview = null;
      hasSelectedFile = false;
      void invalidateAll();
    }
  });

  const { displayName, username, bio, website, twitter, youtube, instagram } =
    updateProfileForm.fields;

  // Populate form fields from profile data on mount and after load re-runs
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

<div class="profile-form-root">
  {#if header}
    {@render header()}
  {/if}

  {#if showSuccess}
    <Alert variant="success">
      {m.account_save_success()}
    </Alert>
  {/if}

  {#if updateProfileForm.result?.error}
    <Alert variant="error">{updateProfileForm.result.error}</Alert>
  {/if}

  <!-- Avatar Section -->
  <Card.Root>
    <Card.Header>
      <Card.Title level={2}>{m.account_avatar_heading()}</Card.Title>
    </Card.Header>
    <Card.Content>
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
    </Card.Content>
  </Card.Root>

  <!--
    Profile Form

    Uses 'novalidate' to bypass browser-native validation (e.g., type="url").
    This allows SvelteKit Remote Functions to handle validation entirely,
    which is required for E2E tests to verify custom server-side error states.
  -->
  <Card.Root>
    <form {...updateProfileForm} novalidate>
      <Card.Header>
        <Card.Title level={2}>{m.account_personal_information()}</Card.Title>
      </Card.Header>
      <Card.Content>
        <!-- Display Name -->
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

        <!-- Email (read-only) -->
        <div class="form-group">
          <Label for="email">{m.account_email()}</Label>
          <Input id="email" name="email" bind:value={email} disabled />
          <p class="form-help">{m.account_email_change_disclaimer()}</p>
        </div>

        <!-- Username -->
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

        <!-- Bio -->
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

        <!-- Social Links Section -->
        <h3>{m.account_social_links()}</h3>

        <!-- Website -->
        <div class="form-group">
          <Label for="website">{m.account_social_website()}</Label>
          <Input id="website" {...website.as('url')} placeholder="https://example.com" />
          {#each website.issues() as issue}
            <p class="field-error">{issue.message}</p>
          {/each}
        </div>

        <!-- Twitter -->
        <div class="form-group">
          <Label for="twitter">{m.account_social_twitter()}</Label>
          <Input
            id="twitter"
            {...twitter.as('url')}
            placeholder="https://twitter.com/username"
          />
          {#each twitter.issues() as issue}
            <p class="field-error">{issue.message}</p>
          {/each}
        </div>

        <!-- YouTube -->
        <div class="form-group">
          <Label for="youtube">{m.account_social_youtube()}</Label>
          <Input
            id="youtube"
            {...youtube.as('url')}
            placeholder="https://youtube.com/channel/..."
          />
          {#each youtube.issues() as issue}
            <p class="field-error">{issue.message}</p>
          {/each}
        </div>

        <!-- Instagram -->
        <div class="form-group">
          <Label for="instagram">{m.account_social_instagram()}</Label>
          <Input
            id="instagram"
            {...instagram.as('url')}
            placeholder="https://instagram.com/username"
          />
          {#each instagram.issues() as issue}
            <p class="field-error">{issue.message}</p>
          {/each}
        </div>
      </Card.Content>
      <Card.Footer>
        <Button type="submit" variant="primary" loading={updateProfileForm.pending > 0}>
          {updateProfileForm.pending > 0 ? m.account_saving() : m.account_save_button()}
        </Button>
      </Card.Footer>
    </form>
  </Card.Root>
</div>

<style>
  .profile-form-root {
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
</style>
