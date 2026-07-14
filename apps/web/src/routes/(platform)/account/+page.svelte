<script lang="ts">
  import { enhance } from '$app/forms';
  import * as m from '$paraglide/messages';
  import { Alert, Button } from '$lib/components/ui';
  import ProfileForm from '$lib/components/ProfileForm.svelte';

  let { data, form } = $props();

  // Typed-DELETE confirmation gate for the danger zone.
  let deleteConfirm = $state('');
  let deleting = $state(false);
  const canDelete = $derived(deleteConfirm === 'DELETE');
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

  <section class="danger-zone" aria-labelledby="danger-zone-title">
    <h2 id="danger-zone-title" class="danger-zone__title">
      {m.account_danger_zone_title()}
    </h2>
    <div class="danger-card">
      <div class="danger-card__text">
        <h3>{m.account_delete_title()}</h3>
        <p>{m.account_delete_description()}</p>
        <p class="danger-card__note">{m.account_delete_subscriptions_note()}</p>
      </div>

      <form
        method="POST"
        action="?/deleteAccount"
        class="danger-card__form"
        use:enhance={() => {
          deleting = true;
          return async ({ update }) => {
            await update();
            deleting = false;
          };
        }}
      >
        {#if form?.message}
          <Alert variant="error">{form.message}</Alert>
        {/if}

        <div class="danger-card__field">
          <label class="field-label" for="deleteConfirm">
            {m.account_delete_confirm_label()}
          </label>
          <input
            id="deleteConfirm"
            name="confirm"
            class="field-input"
            bind:value={deleteConfirm}
            placeholder="DELETE"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
        </div>

        <Button
          type="submit"
          variant="destructive"
          disabled={!canDelete}
          loading={deleting}
        >
          {m.account_delete_button()}
        </Button>
      </form>
    </div>
  </section>
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

  .danger-zone {
    margin-top: var(--space-10);
    padding-top: var(--space-6);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .danger-zone__title {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-error);
    margin-bottom: var(--space-4);
  }

  .danger-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    border: var(--border-width) var(--border-style) var(--color-error-200);
    background-color: var(--color-error-50);
  }

  .danger-card__text h3 {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin-bottom: var(--space-1);
  }

  .danger-card__text p {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .danger-card__note {
    margin-top: var(--space-2);
    font-weight: var(--font-medium);
    color: var(--color-error-700);
  }

  .danger-card__form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .danger-card__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .field-input {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-background);
    color: var(--color-text);
    transition: var(--transition-colors);
    width: 100%;
  }

  .field-input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset-inset);
    border-color: var(--color-border-focus);
  }
</style>
