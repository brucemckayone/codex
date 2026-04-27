<script lang="ts">
  import { page } from '$app/state';
  import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import { resetPasswordForm } from '$lib/remote/auth.remote';
  import * as m from '$paraglide/messages';

  const token = $derived(page.url.searchParams.get('token'));
  const result = $derived(resetPasswordForm.result);
</script>

<svelte:head>
  <title>{m.auth_reset_password_title()}</title>
</svelte:head>

<AuthLayout title={m.auth_reset_password_title()}>
  {#if !token && !result?.success}
    <div class="auth-error">
      <p>Invalid or missing reset token.</p>
    </div>
    <p class="auth-footer">
      <a href="/forgot-password" class="auth-link">Request a new one</a>
    </p>
  {:else if result?.success && !resetPasswordForm.pending}
    <div class="auth-success">
      <p>Password reset successfully!</p>
    </div>
    <p class="auth-footer">
      <a href="/login" class="auth-link">{m.auth_signin_link()}</a>
    </p>
  {:else}
    <form {...resetPasswordForm} class="auth-form">
      {#if result && !result.success && result.error}
        <div class="auth-error" role="alert">
          <p>{result.error}</p>
        </div>
      {/if}

      <input type="hidden" name="token" value={token} />

      <div class="auth-field">
        <Label for="_password">{m.auth_password_label()}</Label>
        <Input
          id="_password"
          name="_password"
          type="password"
          required
        />
      </div>

      <div class="auth-field">
        <Label for="_confirmPassword">{m.auth_confirm_password_label()}</Label>
        <Input
          id="_confirmPassword"
          name="_confirmPassword"
          type="password"
          required
        />
      </div>

      <Button type="submit" loading={resetPasswordForm.pending > 0} class="auth-submit">
        {m.auth_reset_password_button()}
      </Button>
    </form>
  {/if}
</AuthLayout>
