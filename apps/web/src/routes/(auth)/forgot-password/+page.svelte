<script lang="ts">
  import { enhance } from '$app/forms';
  import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
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

<AuthLayout title={m.auth_forgot_password()} subtitle={form?.success ? undefined : 'Enter your email and we\'ll send you a reset link.'}>
  {#if form?.success}
    <div class="auth-success" role="alert">
      <p>{m.auth_reset_email_sent()}</p>
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

      <Button type="submit" {loading} class="auth-submit">
        Send Reset Link
      </Button>

      <a href="/login" class="auth-back-link">
        Back to Sign In
      </a>
    </form>
  {/if}
</AuthLayout>
