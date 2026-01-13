<script lang="ts">
  import { enhance } from '$app/forms';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Input from '$lib/components/ui/Input/Input.svelte';
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
  <title>{m.auth_forgot_password()} | Revelations</title>
</svelte:head>

<h1>{m.auth_forgot_password()}</h1>

{#if form?.success}
  <div role="alert">
    <p>{m.auth_reset_email_sent()}</p>
  </div>
  <div>
    <a href="/login">{m.auth_signin_link()}</a>
  </div>
{:else}
  <form method="POST" use:enhance={handleSubmit}>
    {#if form?.error}
      <div role="alert">
        <p>{form.error}</p>
      </div>
    {/if}

    <div>
      <label for="email">{m.auth_email_label()}</label>
      <Input
        id="email"
        name="email"
        placeholder="you@example.com"
        autocomplete="email"
        value={form?.email ?? ''}
        error={form?.errors?.email}
      />
    </div>

    <Button type="submit" {loading}>
      Send Reset Link
    </Button>

    <a href="/login">
      Back to Sign In
    </a>
  </form>
{/if}

