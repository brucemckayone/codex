<script lang="ts">
  import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import { forgotPasswordForm } from '$lib/remote/auth.remote';
  import * as m from '$paraglide/messages';
</script>

<svelte:head>
  <title>{m.auth_forgot_password()} | Codex</title>
</svelte:head>

<AuthLayout
  title={m.auth_forgot_password()}
  subtitle={forgotPasswordForm.result?.success
    ? undefined
    : "Enter your email and we'll send you a reset link."}
>
  {#if forgotPasswordForm.result?.success && !forgotPasswordForm.pending}
    <div class="auth-success" role="alert">
      <p>{m.auth_reset_email_sent()}</p>
    </div>
    <p class="auth-footer">
      <a href="/login" class="auth-link">{m.auth_signin_link()}</a>
    </p>
  {:else}
    <form {...forgotPasswordForm} class="auth-form">
      <div class="auth-field">
        <Label for="email">{m.auth_email_label()}</Label>
        <Input
          id="email"
          name="email"
          placeholder="you@example.com"
          autocomplete="email"
        />
      </div>

      <Button type="submit" loading={forgotPasswordForm.pending > 0} class="auth-submit">
        Send Reset Link
      </Button>

      <a href="/login" class="auth-back-link">
        Back to Sign In
      </a>
    </form>
  {/if}
</AuthLayout>
