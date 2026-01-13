<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import * as m from '$paraglide/messages';

  const { data } = $props();

  onMount(() => {
    if (data.success) {
      // Auto-redirect after short delay
      setTimeout(() => {
        goto('/library');
      }, 3000);
    }
  });
</script>

<svelte:head>
  <title>Email Verification | Revelations</title>
</svelte:head>

<div class="container">
  {#if data.success}
    <div class="icon success">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
    </div>
    <h1 class="title">{m.auth_verify_email_success()}</h1>
    <p class="message">Redirecting you to the library...</p>

    <a href="/library" class="button">Go to Library</a>
  {:else}
    <div class="icon error">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
    </div>
    <h1 class="title">Verification Failed</h1>
    <p class="message">{data.error ?? m.auth_verify_email_error()}</p>
    <div class="actions">
       <a href="/login" class="link">Return to Sign In</a>
    </div>
  {/if}
</div>

<style>
  .container {
    text-align: center;
    padding: var(--space-8) 0;
  }

  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    margin-bottom: var(--space-4);
  }

  .icon.success {
    background: var(--color-success-50);
    color: var(--color-success);
  }

  .icon.error {
    background: var(--color-error-50);
    color: var(--color-error);
  }

  .title {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin-bottom: var(--space-2);
  }

  .message {
    color: var(--color-text-secondary);
    margin-bottom: var(--space-6);
  }

  .button {
    display: inline-block;
    background: var(--color-primary-500);
    color: white;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    font-weight: var(--font-medium);
    transition: background 0.2s;
  }

  .button:hover {
    background: var(--color-primary-600);
  }

  .link {
    color: var(--color-text-secondary);
    text-decoration: underline;
  }

  .link:hover {
     color: var(--color-primary-500);
  }
</style>
