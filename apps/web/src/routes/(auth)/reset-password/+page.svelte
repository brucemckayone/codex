<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
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
  <title>{m.auth_reset_password_title()}</title>
</svelte:head>

<a href="/" class="auth-logo">codex</a>

<h1>{m.auth_reset_password_title()}</h1>

{#if !token && !form?.success}
  <div class="auth-error">
    <p>Invalid or missing reset token.</p>
  </div>
  <p class="auth-footer">
    <a href="/forgot-password" class="auth-link">Request a new one</a>
  </p>
{:else if form?.success}
  <div class="auth-success">
    <p>Password reset successfully!</p>
  </div>
  <p class="auth-footer">
    <a href="/login" class="auth-link">{m.auth_signin_link()}</a>
  </p>
{:else}
  <form method="POST" use:enhance={handleSubmit} class="auth-form">
    {#if form?.error}
      <div class="auth-error" role="alert">
        <p>{form.error}</p>
      </div>
    {/if}

    <input type="hidden" name="token" value={token} />

    <div class="field">
      <Label for="password">{m.auth_password_label()}</Label>
      <Input
        id="password"
        name="password"
        type="password"
        required
        error={form?.errors?.password}
      />
    </div>

    <div class="field">
      <Label for="confirmPassword">{m.auth_confirm_password_label()}</Label>
      <Input
        id="confirmPassword"
        name="confirmPassword"
        type="password"
        required
        error={form?.errors?.confirmPassword}
      />
    </div>

    <Button type="submit" {loading} class="auth-submit">
      {m.auth_reset_password_button()}
    </Button>
  </form>
{/if}

<style>
  .auth-logo {
    display: block;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-interactive);
    text-transform: lowercase;
    letter-spacing: var(--tracking-tight);
    margin-bottom: var(--space-6);
  }

  h1 {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-6);
  }

  .auth-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .auth-error {
    padding: var(--space-3);
    background-color: var(--color-error-50);
    border: var(--border-width) var(--border-style) var(--color-error-200);
    border-radius: var(--radius-md);
    color: var(--color-error-700);
    font-size: var(--text-sm);
    margin-bottom: var(--space-4);
  }

  .auth-success {
    padding: var(--space-3);
    background-color: var(--color-success-50);
    border: var(--border-width) var(--border-style) var(--color-success-200);
    border-radius: var(--radius-md);
    color: var(--color-success-700);
    font-size: var(--text-sm);
    margin-bottom: var(--space-4);
  }

  :global(.auth-submit) {
    width: 100%;
  }

  .auth-footer {
    text-align: center;
    font-size: var(--text-sm);
  }

  .auth-link {
    color: var(--color-interactive);
    font-weight: var(--font-medium);
  }

  .auth-link:hover {
    color: var(--color-interactive-hover);
  }
</style>
