<!--
  @component OnboardingProgress

  Non-interactive stepper for the creator onboarding wizard: a progress bar +
  a row of step labels with the active/completed states marked. Copy + step
  order are owned by the parent (i18n stays in the view layer); this component
  just renders position.

  @prop steps       Ordered steps as { id, label }.
  @prop currentStep The active step id.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';

  interface StepItem {
    id: string;
    label: string;
  }

  interface Props {
    steps: StepItem[];
    currentStep: string;
  }

  const { steps, currentStep }: Props = $props();

  const currentIndex = $derived(
    Math.max(
      0,
      steps.findIndex((s) => s.id === currentStep)
    )
  );
  const total = $derived(steps.length);
  const percent = $derived(Math.round(((currentIndex + 1) / total) * 100));
</script>

<div class="progress">
  <div class="progress__meta">
    <span class="progress__count">
      {m.onboarding_step_of({
        position: String(currentIndex + 1),
        total: String(total),
      })}
    </span>
  </div>

  <div
    class="progress__bar"
    role="progressbar"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={percent}
    aria-label={m.onboarding_step_of({
      position: String(currentIndex + 1),
      total: String(total),
    })}
  >
    <div class="progress__fill" style="width: {percent}%"></div>
  </div>

  <ol class="progress__steps">
    {#each steps as step, i (step.id)}
      <li
        class="progress__step"
        class:progress__step--active={i === currentIndex}
        class:progress__step--done={i < currentIndex}
        aria-current={i === currentIndex ? 'step' : undefined}
      >
        <span class="progress__dot"></span>
        <span class="progress__label">{step.label}</span>
      </li>
    {/each}
  </ol>
</div>

<style>
  .progress {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .progress__meta {
    display: flex;
    justify-content: flex-end;
  }

  .progress__count {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
  }

  .progress__bar {
    height: var(--space-2);
    border-radius: var(--radius-full, 9999px);
    background-color: var(--color-surface-secondary);
    overflow: hidden;
  }

  .progress__fill {
    height: 100%;
    border-radius: inherit;
    background-color: var(--color-success-500);
    transition: width var(--duration-slow) var(--ease-out);
  }

  @media (prefers-reduced-motion: reduce) {
    .progress__fill {
      transition: none;
    }
  }

  .progress__steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .progress__step {
    display: flex;
    align-items: center;
    gap: var(--space-1-5, var(--space-2));
    min-width: 0;
  }

  .progress__dot {
    flex-shrink: 0;
    width: var(--space-2-5, var(--space-3));
    height: var(--space-2-5, var(--space-3));
    border-radius: var(--radius-full, 9999px);
    background-color: var(--color-surface-tertiary);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .progress__step--done .progress__dot {
    background-color: var(--color-success-500);
    border-color: var(--color-success-500);
  }

  .progress__step--active .progress__dot {
    background-color: var(--color-interactive);
    border-color: var(--color-interactive);
  }

  .progress__label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .progress__step--active .progress__label {
    color: var(--color-text);
  }

  @media (--below-sm) {
    /* Collapse to just the active label + bar on narrow screens. */
    .progress__step:not(.progress__step--active) .progress__label {
      display: none;
    }
  }
</style>
