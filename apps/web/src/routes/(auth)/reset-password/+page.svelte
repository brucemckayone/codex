<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
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

<AuthLayout title={m.auth_reset_password_title()}>
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

      <div class="auth-field">
        <Label for="password">{m.auth_password_label()}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          error={form?.errors?.password}
        />
      </div>

      <div class="auth-field">
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
</AuthLayout>
