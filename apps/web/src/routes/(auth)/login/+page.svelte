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

<h1>{m.auth_signin_title()}</h1>

<form method="POST" use:enhance={handleSubmit}>
  {#if form?.error}
    <div role="alert">
      <p>{form.error}</p>
    </div>
  {/if}

  <div>
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

  <div>
    <label for="password">{m.auth_password_label()}</label>
    <Input
      id="password"
      name="password"
      type="password"
      autocomplete="current-password"
      error={form?.errors?.password}
    />
  </div>

  <Button type="submit" {loading}>
    {loading ? m.common_loading() : m.auth_signin_button()}
  </Button>

  <a href="/forgot-password">
    {m.auth_forgot_password()}
  </a>
</form>

<div>
  <span>{m.common_or()}</span>
</div>

<p>
  {m.auth_no_account()}
  <a href="/register{data.redirect ? `?redirect=${encodeURIComponent(data.redirect)}` : ''}">
    {m.auth_signup_link()}
  </a>
</p>
