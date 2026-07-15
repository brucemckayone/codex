<!--
  @component StepPayouts

  Step 3 — connect Stripe payouts (skippable). Reuses connectMeOnboard: builds
  return/refresh URLs back into the wizard's payouts step so the flow resumes
  after the external Stripe round-trip (the server load syncs status on return).

  @prop payoutsEnabled       Whether Connect charges+payouts are already enabled.
  @prop connectReturnBanner  Banner state from a Stripe return, if any.
  @prop onContinue           Advance to the finish step.
  @prop onSkip               Advance without connecting.
  @prop onBack               Return to the profile step.
-->
<script lang="ts">
  import { Alert, Button } from '$lib/components/ui';
  import { connectMeOnboard } from '$lib/remote/subscription.remote';
  import type { ConnectOnboardResponse } from '$lib/types';
  import * as m from '$paraglide/messages';

  interface Props {
    payoutsEnabled: boolean;
    connectReturnBanner: 'success' | 'sync_failed' | 'refresh' | null;
    onContinue: () => void;
    onSkip: () => void;
    onBack: () => void;
  }

  const { payoutsEnabled, connectReturnBanner, onContinue, onSkip, onBack }: Props =
    $props();

  let connecting = $state(false);
  let connectError = $state<string | null>(null);

  async function connect() {
    connecting = true;
    connectError = null;
    try {
      const origin = window.location.origin;
      // Annotate the result: the remote command() boundary widens the return
      // type, so without this a wrong field name (e.g. the historical
      // `result.url`) would not fail tsc. The server returns
      // ConnectOnboardResponse = { accountId, onboardingUrl }. (Codex-et1tx)
      const result: ConnectOnboardResponse = await connectMeOnboard({
        returnUrl: `${origin}/become-creator?step=payouts&connect=success`,
        refreshUrl: `${origin}/become-creator?step=payouts&connect=refresh`,
      });
      // Full external navigation to Stripe-hosted onboarding.
      window.location.href = result.onboardingUrl;
    } catch {
      connectError = m.onboarding_payouts_error();
      connecting = false;
    }
  }
</script>

<div class="step">
  <header class="step__header">
    <h1 class="step__title">{m.onboarding_payouts_title()}</h1>
    <p class="step__subtitle">{m.onboarding_payouts_subtitle()}</p>
  </header>

  {#if connectReturnBanner === 'success'}
    <Alert variant="success">{m.onboarding_connect_success()}</Alert>
  {:else if connectReturnBanner === 'sync_failed'}
    <Alert variant="warning">{m.onboarding_connect_sync_failed()}</Alert>
  {:else if connectReturnBanner === 'refresh'}
    <Alert variant="warning">{m.onboarding_connect_refresh()}</Alert>
  {/if}

  {#if connectError}
    <Alert variant="error">{connectError}</Alert>
  {/if}

  {#if payoutsEnabled}
    <div class="connected">
      <span class="connected__title">{m.onboarding_payouts_connected_title()}</span>
      <span class="connected__body">{m.onboarding_payouts_connected_body()}</span>
    </div>
  {/if}

  <div class="step__actions">
    <Button type="button" variant="ghost" onclick={onBack} disabled={connecting}>
      {m.onboarding_back()}
    </Button>
    <div class="step__actions-right">
      {#if payoutsEnabled}
        <Button type="button" variant="primary" onclick={onContinue}>
          {m.onboarding_payouts_continue()}
        </Button>
      {:else}
        <Button type="button" variant="ghost" onclick={onSkip} disabled={connecting}>
          {m.onboarding_payouts_skip()}
        </Button>
        <Button
          type="button"
          variant="primary"
          onclick={connect}
          loading={connecting}
          data-testid="payouts-connect"
        >
          {connecting
            ? m.onboarding_payouts_connecting()
            : m.onboarding_payouts_connect_cta()}
        </Button>
      {/if}
    </div>
  </div>
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

  .connected {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-success-500);
  }

  .connected__title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .connected__body {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .step__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .step__actions-right {
    display: flex;
    gap: var(--space-3);
  }
</style>
