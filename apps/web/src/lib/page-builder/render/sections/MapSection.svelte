<!--
  @component MapSection

  The descent map (SPEC §4.1 `map`): the course's ordered stages, each a gate on
  a vertical spine with its concurrent pool of practices. This is the PUBLIC
  sales view — it renders from the awaited `context.stages` and shows NO progress
  and NO completion state (those belong to the member dashboard, WP-4). The
  practice's `completed` field is omitted server-side on the public page.

  CONTRACT GAP (flagged for the conductor): the prototype's free-taste door — a
  single "free" practice badge on the map — has no field on the frozen
  `JourneyPracticeView`. It is intentionally NOT rendered here to keep typecheck
  clean; when WP-6/WP-2 add a public `isFree`/`preview` flag to the practice
  read-model, add the badge here (additive).
-->
<script lang="ts">
  import { asString } from '../coerce';
  import type { MapSectionProps, JourneySalesContext } from '../types';
  import type { JourneyContentType, SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
  }

  const { config, context }: Props = $props();

  const p: MapSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    title: asString(config, 'title'),
    sub: asString(config, 'sub'),
    foot: asString(config, 'foot'),
  });

  const stages = $derived(
    [...context.stages].sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const title = $derived(p.title ?? "Everything you'll walk.");

  const CONTENT_TYPE_LABEL: Record<JourneyContentType, string> = {
    video: 'Practice',
    audio: 'Audio',
    written: 'Reflection',
  };

  function typeLabel(type: string): string {
    return CONTENT_TYPE_LABEL[type as JourneyContentType] ?? 'Practice';
  }
</script>

{#if stages.length > 0}
  <div class="descent">
    <div class="descent__inner">
      <header class="descent__head">
        {#if p.eyebrow}
          <p class="descent__eyebrow">{p.eyebrow}</p>
        {/if}
        <h2 class="descent__title">{title}</h2>
        {#if p.sub}
          <p class="descent__sub">{p.sub}</p>
        {/if}
        <p class="descent__stats">
          <span class="descent__stat">
            <b>{context.course.stageCount}</b> stages
          </span>
          <span class="descent__stat">
            <b>{context.course.practiceCount}</b> practices
          </span>
        </p>
      </header>

      <ol class="descent__stages">
        {#each stages as stage, i (stage.id)}
          <li class="descent__stage">
            <div class="descent__node" aria-hidden="true">{i + 1}</div>
            <div class="descent__stage-body">
              <h3 class="descent__stage-name">{stage.name}</h3>
              {#if stage.gloss}
                <p class="descent__gloss">{stage.gloss}</p>
              {/if}
              {#if stage.practices.length > 0}
                <ul class="descent__practices">
                  {#each [...stage.practices].sort((a, b) => a.sortOrder - b.sortOrder) as practice (practice.contentId)}
                    <li class="descent__practice">
                      <span class="descent__practice-title">{practice.title}</span>
                      <span class="descent__practice-type">{typeLabel(practice.contentType)}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          </li>
        {/each}
      </ol>

      {#if p.foot}
        <p class="descent__foot">{p.foot}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .descent {
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
  }

  .descent__inner {
    max-width: 60rem;
    margin-inline: auto;
  }

  .descent__head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    max-width: 48rem;
    margin: 0 auto var(--space-12);
    text-align: center;
  }

  .descent__eyebrow {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .descent__title {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-4xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.015em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .descent__sub {
    margin: 0;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .descent__stats {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
    margin: var(--space-3) 0 0;
  }

  .descent__stat {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    border: var(--border-width) solid var(--color-border-subtle);
    background: var(--color-surface-secondary);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .descent__stat b {
    font-weight: var(--font-semibold);
    color: var(--color-brand-primary);
  }

  .descent__stages {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .descent__stage {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-5);
    align-items: start;
  }

  /* The spine: a line descending from each node to the next. */
  .descent__stage:not(:last-child) .descent__node::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    width: var(--border-width-thick);
    height: calc(100% + var(--space-8));
    transform: translateX(-50%);
    background: var(--color-border-subtle);
  }

  .descent__node {
    position: relative;
    display: grid;
    place-items: center;
    width: var(--space-11);
    height: var(--space-11);
    border-radius: var(--radius-full);
    border: var(--border-width-thick) solid var(--color-brand-primary);
    background: var(--color-surface);
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    color: var(--color-brand-primary);
  }

  .descent__stage-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-1);
  }

  .descent__stage-name {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    line-height: var(--leading-snug);
    color: var(--color-heading);
  }

  .descent__gloss {
    margin: 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .descent__practices {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
  }

  .descent__practice {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-2) 0;
    border-top: var(--border-width) solid var(--color-border-subtle);
    font-size: var(--text-sm);
  }

  .descent__practice-title {
    color: var(--color-text);
  }

  .descent__practice-type {
    flex-shrink: 0;
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
  }

  .descent__foot {
    margin: var(--space-12) 0 0;
    text-align: center;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }
</style>
