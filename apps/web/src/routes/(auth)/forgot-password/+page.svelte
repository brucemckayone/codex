<script lang="ts">
  import { enhance } from '$app/forms';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import * as m from '$paraglide/messages';

  const { form } = $props();
  let loading = $state(false);

  function handleSubmit() {
    loading = true;
    return async ({ update }) => {
      loading = false;
      await update();
    };
  }
</script>

<svelte:head>
  <title>{m.auth_forgot_password()} | Codex</title>
</svelte:head>

<a href="/" class="auth-logo">codex</a>

<h1>{m.auth_forgot_password()}</h1>

{#if form?.success}
  <div class="auth-success" role="alert">
    <p>{m.auth_reset_email_sent()}</p>
  </div>
  <p class="auth-footer">
    <a href="/login" class="auth-link">{m.auth_signin_link()}</a>
  </p>
{:else}
  <p class="subtitle">Enter your email and we'll send you a reset link.</p>

  <form method="POST" use:enhance={handleSubmit} class="auth-form">
    {#if form?.error}
      <div class="auth-error" role="alert">
        <p>{form.error}</p>
      </div>
    {/if}

    <div class="field">
      <Label for="email">{m.auth_email_label()}</Label>
      <Input
        id="email"
        name="email"
        placeholder="you@example.com"
        autocomplete="email"
        value={form?.email ?? ''}
        error={form?.errors?.email}
      />
    </div>

    <Button type="submit" {loading} class="auth-submit">
      Send Reset Link
    </Button>

    <a href="/login" class="back-link">
      Back to Sign In
    </a>
  </form>
{/if}

<style>
  .auth-logo {
    display: block;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-primary-500);
    text-transform: lowercase;
    letter-spacing: var(--tracking-tight);
    margin-bottom: var(--space-6);
  }

  h1 {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-2);
  }

  .subtitle {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
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

  .back-link {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-align: center;
  }

  .back-link:hover {
    color: var(--color-primary-500);
  }

  .auth-footer {
    text-align: center;
    font-size: var(--text-sm);
  }

  .auth-link {
    color: var(--color-primary-500);
    font-weight: var(--font-medium);
  }
</style>

