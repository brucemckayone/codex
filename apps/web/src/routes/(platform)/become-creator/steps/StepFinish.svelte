<!--
  @component StepFinish

  Final step. Marks onboarding complete on mount, then lands the creator in
  their studio with a next-action CTA — "Create your first content" (NOT "share
  your page": the profile is empty at this point). Links are cross-origin
  (apex → creators subdomain) so they use <a href>, not goto().

  @prop payoutsEnabled Whether payouts were connected (drives the reminder line).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { CheckCircleIcon } from '$lib/components/ui/Icon';
  import { updateCreatorOnboarding } from '$lib/remote/onboarding.remote';
  import { buildCreatorsUrl } from '$lib/utils/subdomain';
  import * as m from '$paraglide/messages';

  interface Props {
    payoutsEnabled: boolean;
  }

  const { payoutsEnabled }: Props = $props();

  const createUrl = $derived(buildCreatorsUrl(page.url, '/studio/content/new'));
  const dashboardUrl = $derived(buildCreatorsUrl(page.url, '/studio'));
  const earningsUrl = $derived(buildCreatorsUrl(page.url, '/studio/earnings'));

  onMount(() => {
    // Mark complete so the guards stop routing the creator into the wizard.
    // Best-effort — a failed patch only means they may see the finish step
    // again, never a broken state.
    updateCreatorOnboarding({ completed: true }).catch(() => {});
  });
</script>

<div class="finish">
  <div class="finish__icon" aria-hidden="true">
    <CheckCircleIcon size={48} />
  </div>

  <header class="finish__header">
    <h1 class="finish__title">{m.onboarding_finish_title()}</h1>
    <p class="finish__subtitle">{m.onboarding_finish_subtitle()}</p>
  </header>

  <div class="finish__actions">
    <a class="finish__cta finish__cta--primary" href={createUrl}>
      {m.onboarding_finish_primary_cta()}
    </a>
    <a class="finish__cta finish__cta--secondary" href={dashboardUrl}>
      {m.onboarding_finish_secondary_cta()}
    </a>
  </div>

  {#if !payoutsEnabled}
    <p class="finish__reminder">
      {m.onboarding_finish_payouts_reminder()}
      <a class="finish__reminder-link" href={earningsUrl}>Earnings</a>
    </p>
  {/if}
</div>

<style>
  .finish {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-5);
  }

  .finish__icon {
    color: var(--color-success-600);
  }

  .finish__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .finish__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    line-height: var(--leading-tight);
  }

  .finish__subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .finish__actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
    max-width: 22rem;
  }

  .finish__cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3) var(--space-5);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    border-radius: var(--radius-md);
    text-decoration: none;
    border: var(--border-width) var(--border-style) transparent;
    transition: var(--transition-colors);
  }

  .finish__cta--primary {
    color: var(--color-text-on-brand);
    background-color: var(--color-interactive);
  }

  .finish__cta--primary:hover {
    background-color: var(--color-interactive-hover);
  }

  .finish__cta--secondary {
    color: var(--color-text);
    background-color: transparent;
    border-color: var(--color-border);
  }

  .finish__cta--secondary:hover {
    background-color: var(--color-surface-secondary);
  }

  .finish__cta:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .finish__reminder {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  .finish__reminder-link {
    color: var(--color-interactive);
    text-decoration: underline;
  }

  .finish__reminder-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
