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
  <title>{m.auth_signup_title()} | Revelations</title>
</svelte:head>

<h1 class="title">{m.auth_signup_title()}</h1>

<form method="POST" use:enhance={handleSubmit} class="form">
  {#if form?.error}
    <div class="form-error" role="alert">
      <p>{form.error}</p>
    </div>
  {/if}

  <div class="field">
    <label for="name">{m.auth_name_label()}</label>
    <Input
      id="name"
      name="name"
      placeholder="Your Name"
      autocomplete="name"
      value={form?.name ?? ''}
      error={form?.errors?.name}
    />
  </div>

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
    {loading ? m.common_loading() : m.auth_signup_button()}
  </Button>
</form>

<div class="divider">
  <span>{m.common_or()}</span>
</div>

<p class="signin-prompt">
  {m.auth_have_account()}
  <a href="/login{data.redirect ? `?redirect=${encodeURIComponent(data.redirect)}` : ''}">
    {m.auth_signin_link()}
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
  }

  .submit-button {
    width: 100%;
    margin-top: var(--space-2);
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

  .signin-prompt {
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .signin-prompt a {
    color: var(--color-primary-500);
    font-weight: var(--font-medium);
  }
</style>
