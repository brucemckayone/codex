<!--
  @component StepEssentials

  Step 1 of the onboarding wizard. Captures the username and triggers the
  one-time customer→creator upgrade via `becomeCreatorForm`, which on success
  server-redirects to ?step=profile (works with JS disabled).
-->
<script lang="ts">
  import { Alert, Button } from '$lib/components/ui';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import { becomeCreatorForm } from '$lib/remote/account.remote';
  import * as m from '$paraglide/messages';

  const { username } = becomeCreatorForm.fields;
</script>

<div class="step">
  <header class="step__header">
    <h1 class="step__title">{m.onboarding_essentials_title()}</h1>
    <p class="step__subtitle">{m.onboarding_essentials_subtitle()}</p>
  </header>

  {#if becomeCreatorForm.result && !becomeCreatorForm.result.success && becomeCreatorForm.result.error}
    <Alert variant="error">{becomeCreatorForm.result.error}</Alert>
  {/if}

  <form {...becomeCreatorForm} class="step__form" novalidate>
    <div class="field">
      <Label for="username">{m.onboarding_essentials_username_label()}</Label>
      <Input
        id="username"
        {...username.as('text')}
        placeholder="my-creator-name"
        required
      />
      <p class="field__help">{m.onboarding_essentials_username_help()}</p>
      {#each username.issues() as issue (issue.message)}
        <p class="field__error">{issue.message}</p>
      {/each}
    </div>

    <div class="step__actions">
      <Button type="submit" variant="primary" loading={becomeCreatorForm.pending > 0}>
        {becomeCreatorForm.pending > 0
          ? m.onboarding_essentials_submitting()
          : m.onboarding_essentials_submit()}
      </Button>
    </div>
  </form>
</div>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .step__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .step__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    line-height: var(--leading-tight);
  }

  .step__subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .step__form {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5, var(--space-2));
  }

  .field__help {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  .field__error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-error-600);
  }

  .step__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
  }
</style>
