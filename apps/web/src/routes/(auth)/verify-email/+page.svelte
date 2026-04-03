<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import AuthLayout from '$lib/components/auth/AuthLayout.svelte';

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
  {:else if data.status === 'pending'}
    <p class="auth-footer" style="margin-bottom: var(--space-4);">
      We've sent a verification link to your email address. Click the link to verify your account.
    </p>
    <p class="auth-footer">Didn't receive the email? Check your spam folder or <a href="/register" class="auth-link">try again</a>.</p>
  {:else}
    <div class="auth-error" role="alert">
      <p>{data.error ?? 'Invalid or expired verification link.'}</p>
    </div>
    <p class="auth-footer">
      <a href="/register" class="auth-link">Register again</a> or <a href="/login" class="auth-link">sign in</a>.
    </p>
  {/if}
</AuthLayout>
