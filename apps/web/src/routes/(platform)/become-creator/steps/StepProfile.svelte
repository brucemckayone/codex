<!--
  @component StepProfile

  Step 2 — "who you are": avatar (reuses avatarUploadForm) + bio + social links.
  Bio and links are saved together via saveOnboardingProfile so the single
  updateProfile call carries the full social set (no partial clobber). All
  optional; "Skip for now" advances without saving.

  @prop profile Current profile values to prefill.
  @prop onNext  Advance to the next step (after a successful save).
  @prop onSkip  Advance without saving.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Alert, Button } from '$lib/components/ui';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import { saveOnboardingProfile } from '$lib/remote/account.remote';
  import { avatarUploadForm } from '$lib/remote/avatar-upload.remote';
  import * as m from '$paraglide/messages';

  interface SocialLinks {
    website?: string;
    twitter?: string;
    youtube?: string;
    instagram?: string;
  }

  interface Props {
    profile: {
      avatarUrl: string | null;
      bio: string | null;
      socialLinks: SocialLinks | null;
    };
    onNext: () => void;
    onSkip: () => void;
  }

  const { profile, onNext, onSkip }: Props = $props();

  // One-time snapshot of the prop to seed the editable fields. `untrack` makes
  // the "capture initial value only" intent explicit (this is an editable copy,
  // not a derived mirror of the prop).
  const initial = untrack(() => ({
    bio: profile.bio ?? '',
    website: profile.socialLinks?.website ?? '',
    twitter: profile.socialLinks?.twitter ?? '',
    youtube: profile.socialLinks?.youtube ?? '',
    instagram: profile.socialLinks?.instagram ?? '',
  }));

  let bio = $state(initial.bio);
  let website = $state(initial.website);
  let twitter = $state(initial.twitter);
  let youtube = $state(initial.youtube);
  let instagram = $state(initial.instagram);

  let saving = $state(false);
  let saveError = $state<string | null>(null);

  // Show the freshly uploaded avatar if one was just uploaded, else the prop.
  const avatarUrl = $derived(
    avatarUploadForm.result?.success
      ? avatarUploadForm.result.data.avatarUrl
      : profile.avatarUrl
  );

  async function saveAndContinue() {
    saving = true;
    saveError = null;
    try {
      await saveOnboardingProfile({ bio, website, twitter, youtube, instagram });
      onNext();
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'Failed to save profile';
    } finally {
      saving = false;
    }
  }
</script>

<div class="step">
  <header class="step__header">
    <h1 class="step__title">{m.onboarding_profile_title()}</h1>
    <p class="step__subtitle">{m.onboarding_profile_subtitle()}</p>
  </header>

  {#if saveError}
    <Alert variant="error">{saveError}</Alert>
  {/if}

  <div class="avatar">
    <div class="avatar__preview" aria-hidden="true">
      {#if avatarUrl}
        <img src={avatarUrl} alt="" class="avatar__img" />
      {:else}
        <span class="avatar__placeholder"></span>
      {/if}
    </div>
    <form {...avatarUploadForm} class="avatar__form">
      <Label for="avatar">{m.onboarding_profile_avatar_label()}</Label>
      <input
        id="avatar"
        class="avatar__input"
        type="file"
        name="avatar"
        accept="image/*"
      />
      {#if avatarUploadForm.result && !avatarUploadForm.result.success}
        <p class="field__error">{avatarUploadForm.result.error}</p>
      {/if}
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={avatarUploadForm.pending > 0}
      >
        {avatarUploadForm.pending > 0
          ? m.onboarding_profile_avatar_uploading()
          : m.onboarding_profile_avatar_cta()}
      </Button>
    </form>
  </div>

  <div class="field">
    <Label for="bio">{m.onboarding_profile_bio_label()}</Label>
    <TextArea
      id="bio"
      bind:value={bio}
      placeholder={m.onboarding_profile_bio_placeholder()}
      rows={4}
      maxlength={500}
    />
  </div>

  <fieldset class="links">
    <legend class="links__legend">{m.onboarding_profile_links_label()}</legend>
    <div class="field">
      <Label for="website">{m.onboarding_profile_website()}</Label>
      <Input id="website" type="url" bind:value={website} placeholder="https://example.com" />
    </div>
    <div class="field">
      <Label for="twitter">{m.onboarding_profile_twitter()}</Label>
      <Input id="twitter" type="url" bind:value={twitter} placeholder="https://x.com/you" />
    </div>
    <div class="field">
      <Label for="youtube">{m.onboarding_profile_youtube()}</Label>
      <Input id="youtube" type="url" bind:value={youtube} placeholder="https://youtube.com/@you" />
    </div>
    <div class="field">
      <Label for="instagram">{m.onboarding_profile_instagram()}</Label>
      <Input id="instagram" type="url" bind:value={instagram} placeholder="https://instagram.com/you" />
    </div>
  </fieldset>

  <div class="step__actions">
    <Button type="button" variant="ghost" onclick={onSkip} disabled={saving}>
      {m.onboarding_profile_skip()}
    </Button>
    <Button type="button" variant="primary" onclick={saveAndContinue} loading={saving}>
      {saving ? m.onboarding_profile_saving() : m.onboarding_profile_continue()}
    </Button>
  </div>
</div>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .step__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .step__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    line-height: var(--leading-tight);
  }

  .step__subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .avatar {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
  }

  .avatar__preview {
    flex-shrink: 0;
    width: var(--space-16);
    height: var(--space-16);
    border-radius: var(--radius-full, 9999px);
    overflow: hidden;
    background-color: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .avatar__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar__placeholder {
    display: block;
    width: 100%;
    height: 100%;
  }

  .avatar__form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
  }

  .avatar__input {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .avatar__input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5, var(--space-2));
  }

  .field__error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-error-600);
  }

  .links {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    border: none;
  }

  .links__legend {
    padding: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .step__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
  }
</style>
