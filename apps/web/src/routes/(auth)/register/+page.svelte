<script lang="ts">
  import { enhance } from '$app/forms';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
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
  <title>{m.auth_signup_title()} | Codex</title>
</svelte:head>

<h1>{m.auth_signup_title()}</h1>

<form method="POST" use:enhance={handleSubmit}>
  {#if form?.error}
    <div role="alert">
      <p>{form.error}</p>
    </div>
  {/if}

  <div>
    <Label for="name">{m.auth_name_label()}</Label>
    <Input
      id="name"
      name="name"
      placeholder="Your Name"
      autocomplete="name"
      value={form?.name ?? ''}
      error={form?.errors?.name}
    />
  </div>

  <div>
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

  <div>
    <Label for="password">{m.auth_password_label()}</Label>
    <Input
      id="password"
      name="password"
      type="password"
      autocomplete="new-password"
      error={form?.errors?.password}
    />
    <p>At least 8 characters, one letter and one number.</p>
  </div>

  <div>
    <Label for="confirmPassword">{m.auth_confirm_password_label()}</Label>
    <Input
      id="confirmPassword"
      name="confirmPassword"
      type="password"
      autocomplete="new-password"
      error={form?.errors?.confirmPassword}
    />
  </div>

  <Button type="submit" {loading}>
    {loading ? m.common_loading() : m.auth_signup_button()}
  </Button>
</form>

<div>
  <span>{m.common_or()}</span>
</div>

<p>
  {m.auth_have_account()}
  <a href="/login{data.redirect ? `?redirect=${encodeURIComponent(data.redirect)}` : ''}">
    {m.auth_signin_link()}
  </a>
</p>

