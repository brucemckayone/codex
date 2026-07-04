<!--
  @component Become Creator — onboarding wizard shell

  Renders the progress stepper + the active step (driven by ?step= via the
  server load). Owns step navigation: goToStep patches the server `currentStep`
  pointer, then navigates the query param so the load re-resolves. Step 1
  (essentials) self-redirects via its form; later steps advance through here.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Button } from '$lib/components/ui';
  import { updateCreatorOnboarding } from '$lib/remote/onboarding.remote';
  import { buildCreatorsUrl } from '$lib/utils/subdomain';
  import * as m from '$paraglide/messages';
  import OnboardingProgress from './OnboardingProgress.svelte';
  import StepEssentials from './steps/StepEssentials.svelte';
  import StepFinish from './steps/StepFinish.svelte';
  import StepPayouts from './steps/StepPayouts.svelte';
  import StepProfile from './steps/StepProfile.svelte';

  let { data } = $props();

  const steps = $derived([
    { id: 'essentials', label: m.onboarding_step_essentials_label() },
    { id: 'profile', label: m.onboarding_step_profile_label() },
    { id: 'payouts', label: m.onboarding_step_payouts_label() },
    { id: 'finish', label: m.onboarding_step_finish_label() },
  ]);

  // Show the top-level "skip setup" affordance only mid-flow (post-upgrade,
  // pre-finish) — a customer at essentials isn't a creator yet, and finish is
  // already the end.
  const canSkipAll = $derived(
    data.step === 'profile' || data.step === 'payouts'
  );

  async function goToStep(step: string) {
    await updateCreatorOnboarding({ currentStep: step }).catch(() => {});
    await goto(`/become-creator?step=${step}`, { keepFocus: true });
  }

  async function skipAll() {
    await updateCreatorOnboarding({ dismissed: true }).catch(() => {});
    // Cross-origin (apex → creators subdomain) — full navigation, not goto.
    window.location.href = buildCreatorsUrl(page.url, '/studio');
  }
</script>

<svelte:head>
  <title>Set up your creator profile · Codex</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="wizard">
  {#if data.step !== 'finish'}
    <OnboardingProgress {steps} currentStep={data.step} />
  {/if}

  <div class="wizard__body">
    {#if data.step === 'essentials'}
      <StepEssentials />
    {:else if data.step === 'profile'}
      <StepProfile
        profile={data.profile}
        onNext={() => goToStep('payouts')}
        onSkip={() => goToStep('payouts')}
      />
    {:else if data.step === 'payouts'}
      <StepPayouts
        payoutsEnabled={data.payoutsEnabled}
        connectReturnBanner={data.connectReturnBanner}
        onContinue={() => goToStep('finish')}
        onSkip={() => goToStep('finish')}
        onBack={() => goToStep('profile')}
      />
    {:else if data.step === 'finish'}
      <StepFinish payoutsEnabled={data.payoutsEnabled} />
    {/if}
  </div>

  {#if canSkipAll}
    <div class="wizard__skip">
      <Button type="button" variant="ghost" size="sm" onclick={skipAll}>
        {m.onboarding_skip_all()}
      </Button>
    </div>
  {/if}
</div>

<style>
  .wizard {
    max-width: 40rem;
    margin: 0 auto;
    padding: var(--space-6) 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .wizard__body {
    display: flex;
    flex-direction: column;
  }

  .wizard__skip {
    display: flex;
    justify-content: center;
  }
</style>
