<!--
  @component OnboardingChecklist

  First-run "Get set up" checklist for the personal creator studio
  dashboard (WP-9 — Codex-fc5oh.9). A dismissible card with a progress
  bar and one row per core step (profile → payouts → media → publish),
  each with an inline CTA when incomplete, plus an optional "open a
  studio" row surfaced only while the creator is org-less.

  Presentational only: completion logic lives in the pure
  `buildCreatorOnboardingChecklist` aggregator. This component maps step
  ids to Paraglide copy + routes and renders progress. The parent owns
  dismissal persistence (localStorage) and the create-studio dialog.

  @prop state         Computed checklist state (steps, counts, percent).
  @prop onDismiss     Fired when the creator dismisses the whole checklist.
  @prop onCreateStudio Fired when the optional "Create studio" CTA is used.
-->
<script lang="ts">
  import { CheckCircleIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import type {
    OnboardingChecklistState,
    OnboardingStepId,
  } from './onboarding-checklist';

  interface Props {
    state: OnboardingChecklistState;
    onDismiss: () => void;
    onCreateStudio: () => void;
  }

  const { state, onDismiss, onCreateStudio }: Props = $props();

  interface StepMeta {
    title: string;
    description: string;
    /** CTA label + route — omitted for the always-done profile step. */
    cta?: string;
    href?: string;
  }

  // Copy + routes keyed by step id. Kept in the component (not the pure
  // aggregator) so i18n stays with the view layer.
  function stepMeta(id: OnboardingStepId): StepMeta {
    switch (id) {
      case 'profile':
        return {
          title: m.studio_onboarding_profile_title(),
          description: m.studio_onboarding_profile_description(),
        };
      case 'payouts':
        return {
          title: m.studio_onboarding_payouts_title(),
          description: m.studio_onboarding_payouts_description(),
          cta: m.studio_onboarding_payouts_cta(),
          href: '/studio/earnings',
        };
      case 'media':
        return {
          title: m.studio_onboarding_media_title(),
          description: m.studio_onboarding_media_description(),
          cta: m.studio_onboarding_media_cta(),
          href: '/studio/media',
        };
      case 'publish':
        return {
          title: m.studio_onboarding_publish_title(),
          description: m.studio_onboarding_publish_description(),
          cta: m.studio_onboarding_publish_cta(),
          href: '/studio/content/new',
        };
    }
  }
</script>

<section class="onboarding" aria-labelledby="onboarding-heading">
  <header class="onboarding__header">
    <div class="onboarding__heading-group">
      <h2 id="onboarding-heading" class="onboarding__title">
        {m.studio_onboarding_title()}
      </h2>
      <p class="onboarding__subtitle">{m.studio_onboarding_subtitle()}</p>
    </div>
    <span class="onboarding__count">
      {m.studio_onboarding_progress({
        completed: String(state.completedCount),
        total: String(state.totalCount),
      })}
    </span>
  </header>

  <div
    class="onboarding__progress"
    role="progressbar"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={state.percent}
    aria-labelledby="onboarding-heading"
  >
    <div class="onboarding__progress-fill" style="width: {state.percent}%"></div>
  </div>

  <ol class="onboarding__list">
    {#each state.steps as step (step.id)}
      {@const meta = stepMeta(step.id)}
      <li class="onboarding__item" class:onboarding__item--done={step.done}>
        <span class="onboarding__status" aria-hidden="true">
          {#if step.done}
            <CheckCircleIcon size={20} />
          {:else}
            <span class="onboarding__circle"></span>
          {/if}
        </span>

        <span class="onboarding__body">
          <span class="onboarding__item-title">
            {meta.title}
            {#if step.done}
              <span class="onboarding__done-label">
                · {m.studio_onboarding_step_done()}
              </span>
            {/if}
          </span>
          {#if !step.done}
            <span class="onboarding__item-desc">{meta.description}</span>
          {/if}
        </span>

        {#if !step.done && meta.cta && meta.href}
          <a class="onboarding__cta" href={meta.href}>{meta.cta} →</a>
        {/if}
      </li>
    {/each}
  </ol>

  {#if state.optionalStudio.show}
    <div class="onboarding__optional">
      <div class="onboarding__optional-body">
        <span class="onboarding__optional-eyebrow">
          {m.studio_onboarding_optional_label()}
        </span>
        <span class="onboarding__optional-title">
          {m.studio_onboarding_studio_title()}
        </span>
        <span class="onboarding__item-desc">
          {m.studio_onboarding_studio_description()}
        </span>
      </div>
      <button type="button" class="onboarding__cta" onclick={onCreateStudio}>
        {m.studio_onboarding_studio_cta()} →
      </button>
    </div>
  {/if}

  <div class="onboarding__footer">
    <button type="button" class="onboarding__dismiss" onclick={onDismiss}>
      {m.studio_onboarding_dismiss()}
    </button>
  </div>
</section>

<style>
  .onboarding {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  /* ── Header ──────────────────────────────────────────────── */
  .onboarding__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .onboarding__heading-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .onboarding__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
    line-height: var(--leading-snug);
  }

  .onboarding__subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
  }

  .onboarding__count {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
  }

  /* ── Progress bar ────────────────────────────────────────── */
  .onboarding__progress {
    height: var(--space-1-5, var(--space-2));
    border-radius: var(--radius-full, 9999px);
    background-color: var(--color-surface-secondary);
    overflow: hidden;
  }

  .onboarding__progress-fill {
    height: 100%;
    border-radius: inherit;
    background-color: var(--color-success-500);
    transition: width var(--duration-slow) var(--ease-out);
  }

  @media (prefers-reduced-motion: reduce) {
    .onboarding__progress-fill {
      transition: none;
    }
  }

  /* ── Steps ───────────────────────────────────────────────── */
  .onboarding__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .onboarding__item {
    display: grid;
    grid-template-columns: var(--space-6) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-1);
  }

  .onboarding__status {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-success-600);
  }

  .onboarding__circle {
    width: var(--space-5);
    height: var(--space-5);
    border-radius: var(--radius-full, 9999px);
    border: var(--border-width-thick) var(--border-style) var(--color-border);
    background-color: transparent;
  }

  .onboarding__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .onboarding__item-title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    line-height: var(--leading-snug);
  }

  .onboarding__item--done .onboarding__item-title {
    color: var(--color-text-secondary);
  }

  .onboarding__done-label {
    font-weight: var(--font-medium);
    color: var(--color-success-600);
  }

  .onboarding__item-desc {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
  }

  /* ── CTA (shared by nav links + create-studio button) ────── */
  .onboarding__cta {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1-5, var(--space-2)) var(--space-3);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-on-brand);
    background-color: var(--color-interactive);
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-md);
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .onboarding__cta:hover {
    background-color: var(--color-interactive-hover);
  }

  .onboarding__cta:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* ── Optional "open a studio" ────────────────────────────── */
  .onboarding__optional {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-1) 0;
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .onboarding__optional-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .onboarding__optional-eyebrow {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
  }

  .onboarding__optional-title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    line-height: var(--leading-snug);
  }

  /* ── Footer / dismiss ────────────────────────────────────── */
  .onboarding__footer {
    display: flex;
    justify-content: flex-end;
  }

  .onboarding__dismiss {
    padding: 0;
    border: none;
    background: none;
    font-family: inherit;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .onboarding__dismiss:hover {
    color: var(--color-text);
    text-decoration: underline;
  }

  .onboarding__dismiss:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* ── Responsive ──────────────────────────────────────────── */
  @media (--below-sm) {
    .onboarding__item {
      grid-template-columns: var(--space-6) minmax(0, 1fr);
      grid-template-areas:
        'status body'
        '.      cta';
      row-gap: var(--space-2);
    }
    .onboarding__status {
      grid-area: status;
    }
    .onboarding__body {
      grid-area: body;
    }
    .onboarding__cta {
      grid-area: cta;
      justify-self: start;
    }
    .onboarding__optional {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
