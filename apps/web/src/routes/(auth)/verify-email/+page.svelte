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

<div>
  {#if data.status === 'success'}
    <div>
      <h1>Email Verified</h1>
      <p>Your email has been verified. Redirecting to your library...</p>
    </div>
  {:else if data.status === 'pending'}
    <div>
      <h1>Check Your Email</h1>
      <p>We've sent a verification link to your email address. Click the link to verify your account.</p>
      <p>Didn't receive the email? Check your spam folder or <a href="/register">try again</a>.</p>
    </div>
  {:else}
    <div role="alert">
      <h1>Verification Failed</h1>
      <p>{data.error ?? 'Invalid or expired verification link.'}</p>
      <p><a href="/register">Register again</a> or <a href="/login">sign in</a>.</p>
    </div>
  {/if}
</div>
