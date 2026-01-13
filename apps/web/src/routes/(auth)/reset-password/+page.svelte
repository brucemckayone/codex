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
  <title>{m.auth_reset_password_title()}</title>
</svelte:head>

<h1>{m.auth_reset_password_title()}</h1>

{#if !token && !form?.success}
  <p>Invalid or missing reset token.</p>
  <a href="/forgot-password">Request a new one</a>
{:else if form?.success}
  <p>Password reset successfully!</p>
  <a href="/login">{m.auth_signin_link()}</a>
{:else}
  <form method="POST" use:enhance={handleSubmit}>
    {#if form?.error}<p role="alert">{form.error}</p>{/if}

    <input type="hidden" name="token" value={token} />

    <div>
      <label for="password">{m.auth_password_label()}</label>
      <Input
        id="password"
        name="password"
        type="password"
        required
        error={form?.errors?.password}
      />
    </div>

    <div>
      <label for="confirmPassword">{m.auth_confirm_password_label()}</label>
      <Input
        id="confirmPassword"
        name="confirmPassword"
        type="password"
        required
        error={form?.errors?.confirmPassword}
      />
    </div>

    <Button type="submit" disabled={loading}>
      {m.auth_reset_password_button()}
    </Button>
  </form>
{/if}
