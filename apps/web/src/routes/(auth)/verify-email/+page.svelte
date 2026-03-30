<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

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

<a href="/" class="auth-logo">codex</a>

{#if data.status === 'success'}
  <h1>Email Verified</h1>
  <div class="auth-success">
    <p>Your email has been verified. Redirecting to your library...</p>
  </div>
{:else if data.status === 'pending'}
  <h1>Check Your Email</h1>
  <p class="subtitle">We've sent a verification link to your email address. Click the link to verify your account.</p>
  <p class="auth-footer">Didn't receive the email? Check your spam folder or <a href="/register" class="auth-link">try again</a>.</p>
{:else}
  <h1>Verification Failed</h1>
  <div class="auth-error" role="alert">
    <p>{data.error ?? 'Invalid or expired verification link.'}</p>
  </div>
  <p class="auth-footer">
    <a href="/register" class="auth-link">Register again</a> or <a href="/login" class="auth-link">sign in</a>.
  </p>
{/if}

<style>
  .auth-logo {
    display: block;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-primary-500);
    text-transform: lowercase;
    letter-spacing: var(--tracking-tight);
    margin-bottom: var(--space-6);
  }

  h1 {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-4);
  }

  .subtitle {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin-bottom: var(--space-4);
    line-height: var(--leading-relaxed);
  }

  .auth-error {
    padding: var(--space-3);
    background-color: var(--color-error-50);
    border: var(--border-width) var(--border-style) var(--color-error-200);
    border-radius: var(--radius-md);
    color: var(--color-error-700);
    font-size: var(--text-sm);
    margin-bottom: var(--space-4);
  }

  .auth-success {
    padding: var(--space-3);
    background-color: var(--color-success-50);
    border: var(--border-width) var(--border-style) var(--color-success-200);
    border-radius: var(--radius-md);
    color: var(--color-success-700);
    font-size: var(--text-sm);
  }

  .auth-footer {
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin-top: var(--space-4);
  }

  .auth-link {
    color: var(--color-primary-500);
    font-weight: var(--font-medium);
  }

  .auth-link:hover {
    color: var(--color-primary-600);
  }
</style>
