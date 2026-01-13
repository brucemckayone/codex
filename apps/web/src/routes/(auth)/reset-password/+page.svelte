<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import * as m from '$paraglide/messages';

  const { form } = $props();
  let loading = $state(false);
  const token = $derived(page.url.searchParams.get('token'));

  function handleSubmit() {
    loading = true;
    return async ({ update }) => {
      loading = false;
      await update();
    };
  }
</script>

<svelte:head>
  <title>{m.auth_reset_password_title()} | Revelations</title>
</svelte:head>

<h1 class="title">{m.auth_reset_password_title()}</h1>

{#if !token && !form?.success}
  <div class="form-error" role="alert">
    <p>Invalid or missing reset token.</p>
    <a href="/forgot-password" class="back-link">Request a new one</a>
  </div>
{:else if form?.success}
  <div class="success-message" role="alert">
    <p>Password reset successfully!</p>
  </div>
  <div class="actions">
    <a href="/login" class="back-link">{m.auth_signin_link()}</a>
  </div>
{:else}
  <form method="POST" use:enhance={handleSubmit} class="form">
    {#if form?.error}
      <div class="form-error" role="alert">
        <p>{form.error}</p>
      </div>
    {/if}

    <input type="hidden" name="token" value={token} />

    <div class="field">
      <label for="password">{m.auth_password_label()}</label>
      <Input
        id="password"
        name="password"
        type="password"
        autocomplete="new-password"
        error={form?.errors?.password}
      />
      <p class="hint">At least 8 characters, one letter and one number.</p>
    </div>

    <div class="field">
      <label for="confirmPassword">{m.auth_confirm_password_label()}</label>
      <Input
        id="confirmPassword"
        name="confirmPassword"
        type="password"
        autocomplete="new-password"
        error={form?.errors?.confirmPassword}
      />
    </div>

    <Button type="submit" {loading} class="submit-button">
      {m.auth_reset_password_button()}
    </Button>
  </form>
{/if}

<style>
  .title {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    text-align: center;
    margin-bottom: var(--space-6);
    color: var(--color-text);
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .field label {
    display: block;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    margin-bottom: var(--space-1);
    color: var(--color-text);
  }

  .hint {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin-top: var(--space-1);
  }

  .form-error {
    background: var(--color-error);
    color: var(--color-text-inverse);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    text-align: center;
  }

  .success-message {
    background: var(--color-success);
    color: var(--color-text-inverse);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    text-align: center;
    margin-bottom: var(--space-6);
  }

  .submit-button {
    width: 100%;
    margin-top: var(--space-2);
  }

  .actions {
    display: flex;
    justify-content: center;
  }

  .back-link {
    display: block;
    text-align: center;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    margin-top: var(--space-4);
    text-decoration: underline;
  }

  .back-link:hover {
    color: var(--color-primary-500);
  }
</style>
