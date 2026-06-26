<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import { resendVerificationEmailForm } from '$lib/remote/auth.remote';

  const { data } = $props();

  onMount(() => {
    if (data.status === 'success') {
      setTimeout(() => {
        goto('/library');
      }, 3000);
    }
  });
</script>

<svelte:head>
  <title>Email Verification | Codex</title>
</svelte:head>

<AuthLayout title={data.status === 'success' ? 'Email Verified' : data.status === 'pending' ? 'Check Your Email' : 'Verification Failed'}>
  {#if data.status === 'success'}
    <div class="auth-success">
      <p>Your email has been verified. Redirecting to your library...</p>
    </div>
  {:else}
    {#if data.status === 'pending'}
      <p class="auth-footer" style="margin-bottom: var(--space-4);">
        We've sent a verification link to your email address. Click the link to verify your account.
      </p>
    {:else}
      <div class="auth-error" role="alert">
        <p>{data.error ?? 'Invalid or expired verification link.'}</p>
      </div>
    {/if}

    {#if resendVerificationEmailForm.result?.success && !resendVerificationEmailForm.pending}
      <div class="auth-success" role="alert">
        <p>{resendVerificationEmailForm.result.message}</p>
      </div>
    {:else}
      <p class="auth-footer" style="margin-bottom: var(--space-4);">
        Didn't receive it? Check your spam folder, or request a new link below.
      </p>
      <form {...resendVerificationEmailForm} class="auth-form">
        <div class="auth-field">
          <Label for="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            value={data.email ?? ''}
            placeholder="you@example.com"
            autocomplete="email"
            required
          />
        </div>

        <Button type="submit" loading={resendVerificationEmailForm.pending > 0} class="auth-submit">
          Resend verification email
        </Button>
      </form>
    {/if}

    <p class="auth-footer">
      Already verified? <a href="/login" class="auth-link">Sign in</a>.
    </p>
  {/if}
</AuthLayout>
