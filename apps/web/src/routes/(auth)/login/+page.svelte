<script lang="ts">
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { clearClientState } from '$lib/client/version-manifest';
  import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
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

<AuthLayout title={m.auth_signin_title()}>
  <form method="POST" use:enhance={handleSubmit} class="auth-form">
    {#if data.redirect}
      <input type="hidden" name="redirect" value={data.redirect} />
    {/if}

    {#if form?.error}
      <div class="auth-error" role="alert">
        <p>{form.error}</p>
      </div>
    {/if}

    <div class="auth-field">
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

    <div class="auth-field">
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

    <a href="/forgot-password" class="auth-back-link">
      {m.auth_forgot_password()}
    </a>
  </form>

  <div class="auth-divider">
    <span>{m.common_or()}</span>
  </div>

  {#snippet footer()}
    <p class="auth-footer">
      {m.auth_no_account()}
      <a href="/register{data.redirect ? `?redirect=${encodeURIComponent(data.redirect)}` : ''}" class="auth-link">
        {m.auth_signup_link()}
      </a>
    </p>
  {/snippet}
</AuthLayout>
