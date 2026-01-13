<script lang="ts">
  import { enhance } from '$app/forms';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import * as m from '$paraglide/messages';

  const { data, form } = $props();
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
  <title>{m.auth_signin_title()} | Revelations</title>
</svelte:head>

<h1 class="title">{m.auth_signin_title()}</h1>

<form method="POST" use:enhance={handleSubmit} class="form">
  {#if form?.error}
    <div class="form-error" role="alert">
      <p>{form.error}</p>
    </div>
  {/if}

  <div class="field">
    <label for="email">{m.auth_email_label()}</label>
    <Input
      id="email"
      name="email"
      placeholder="you@example.com"
      autocomplete="email"
      value={form?.email ?? ''}
      error={form?.errors?.email}
    />
  </div>

  <div class="field">
    <label for="password">{m.auth_password_label()}</label>
    <Input
      id="password"
      name="password"
      type="password"
      autocomplete="current-password"
      error={form?.errors?.password}
    />
  </div>

  <Button type="submit" {loading} class="submit-button">
    {loading ? m.common_loading() : m.auth_signin_button()}
  </Button>

  <a href="/forgot-password" class="forgot-link">
    {m.auth_forgot_password()}
  </a>
</form>

<div class="divider">
  <span>{m.common_or()}</span>
</div>

<p class="signup-prompt">
  {m.auth_no_account()}
  <a href="/register{data.redirect ? `?redirect=${encodeURIComponent(data.redirect)}` : ''}">
    {m.auth_signup_link()}
  </a>
</p>

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

  .form-error {
    background: var(--color-error);
    color: var(--color-text-inverse);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }

  .submit-button {
    width: 100%;
    margin-top: var(--space-2);
  }

  .forgot-link {
    display: block;
    text-align: center;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .forgot-link:hover {
    color: var(--color-primary-500);
  }

  .divider {
    display: flex;
    align-items: center;
    margin: var(--space-6) 0;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--color-border);
  }

  .divider span {
    padding: 0 var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .signup-prompt {
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .signup-prompt a {
    color: var(--color-primary-500);
    font-weight: var(--font-medium);
  }
</style>
