<script lang="ts">
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { clearClientState } from '$lib/client/version-manifest';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import * as m from '$paraglide/messages';

  const { data, form } = $props();
  let loading = $state(false);

  // Clear client caches after logout redirect
  onMount(() => {
    if (page.url.searchParams.has('logout')) {
      clearClientState();
    }
  });

  function handleSubmit() {
    loading = true;
    return async ({ result, update }) => {
      loading = false;
      if (result.type === 'redirect') {
        await goto(result.location);
      } else {
        await update();
      }
    };
  }
</script>

<svelte:head>
  <title>{m.auth_signin_title()} | Codex</title>
</svelte:head>

<a href="/" class="auth-logo">codex</a>

<h1>{m.auth_signin_title()}</h1>

<form method="POST" use:enhance={handleSubmit} class="auth-form">
  {#if data.redirect}
    <input type="hidden" name="redirect" value={data.redirect} />
  {/if}

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

  <div class="field">
    <Label for="password">{m.auth_password_label()}</Label>
    <Input
      id="password"
      name="password"
      type="password"
      autocomplete="current-password"
      error={form?.errors?.password}
    />
  </div>

  <Button type="submit" {loading} class="auth-submit">
    {loading ? m.common_loading() : m.auth_signin_button()}
  </Button>

  <a href="/forgot-password" class="forgot-link">
    {m.auth_forgot_password()}
  </a>
</form>

<div class="divider">
  <span>{m.common_or()}</span>
</div>

<p class="auth-footer">
  {m.auth_no_account()}
  <a href="/register{data.redirect ? `?redirect=${encodeURIComponent(data.redirect)}` : ''}" class="auth-link">
    {m.auth_signup_link()}
  </a>
</p>

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

  :global(.auth-submit) {
    width: 100%;
  }

  .forgot-link {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-align: center;
  }

  .forgot-link:hover {
    color: var(--color-primary-500);
  }

  .divider {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-4) 0;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--color-border);
  }

  .auth-footer {
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .auth-link {
    color: var(--color-primary-500);
    font-weight: var(--font-medium);
  }

  .auth-link:hover {
    color: var(--color-primary-600);
  }
</style>
