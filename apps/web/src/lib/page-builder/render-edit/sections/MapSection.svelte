<!--
  @component MapSection

  The descent map — the journey's curriculum laid out (Codex-2pryk · WP-3/WP-5),
  rendered in its lit end-state (the scroll choreography can't run in an
  inner-scrolling canvas). Variants: descent (ember spine + gates, default) ·
  list (compact stage rows) · grid (stage cards). Stages come from the course
  (via `stages`), not the page draft — the builder supplies mock stages. Copy
  (eyebrow/heading/sub/note) is page-editable. Styling in `../journey-sections.css`.
-->
<script lang="ts">
  import EditableText from '../EditableText.svelte';
  import { has, type SectionComponentProps, text } from '../section-render';

  let { props, variant, editable = false, onEdit, stages = [] }: SectionComponentProps =
    $props();
  const edit = (key: string) => (value: string) => onEdit?.(key, value);

  const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'];
  const TYPE_GLYPH: Record<string, string> = {
    audio: '♪',
    video: '▶',
    written: '¶',
    practice: '✎',
    meditation: '☾',
    reflection: '❋',
  };
  const glyph = (t: string): string => TYPE_GLYPH[t] ?? '•';
  const label = (t: string): string => (t ? t[0].toUpperCase() + t.slice(1) : 'Practice');

  const practiceCount = $derived(
    stages.reduce((sum, s) => sum + s.lessons.length, 0)
  );
  const totalMinutes = $derived(
    stages.reduce(
      (sum, s) => sum + s.lessons.reduce((m, l) => m + (l.minutes || 0), 0),
      0
    )
  );
</script>

{#snippet head(centred: boolean)}
  <header class="jp-descent__head" class:jp-descent__head--tight={!centred}>
    {#if has(props, 'eyebrow')}
      <EditableText class="jp-eyebrow" field="eyebrow" value={text(props, 'eyebrow')} {editable} onEdit={edit('eyebrow')} />
    {/if}
    <EditableText tag="h2" class="jp-descent__title" field="heading" value={text(props, 'heading')} {editable} onEdit={edit('heading')} />
    {#if has(props, 'sub')}
      <EditableText tag="p" class="jp-descent__sub" field="sub" value={text(props, 'sub')} {editable} onEdit={edit('sub')} />
    {/if}
  </header>
{/snippet}

{#snippet foot()}
  {#if has(props, 'note')}
    <EditableText tag="p" class="jp-descent__foot" field="note" value={text(props, 'note')} {editable} onEdit={edit('note')} />
  {/if}
{/snippet}

<section class="jp-descent jp-descent--{variant}">
  <div class="jp-descent__inner">
    {#if variant === 'list'}
      {@render head(false)}
      <div class="jp-stages">
        {#each stages as stage, i (stage.name + i)}
          <div class="jp-stage">
            <span class="jp-rn">{ROMAN[i] ?? i + 1}</span>
            <span class="jp-sn">{stage.name}</span>
            <span class="jp-ct">{stage.lessons.length} practices</span>
          </div>
        {/each}
      </div>
      {@render foot()}
    {:else if variant === 'grid'}
      {@render head(true)}
      <div class="jp-stagegrid">
        {#each stages as stage, i (stage.name + i)}
          <div class="jp-stagecard">
            <span class="jp-rn">{ROMAN[i] ?? i + 1}</span>
            <div class="jp-sn">{stage.name}</div>
            <p class="jp-gl">{stage.gloss}</p>
            <p class="jp-ct">{stage.lessons.length} practices</p>
          </div>
        {/each}
      </div>
      {@render foot()}
    {:else}
      {@render head(true)}
      <div class="jp-descent__stats">
        <span class="jp-descent__stat"><b>{stages.length}</b> gated depths</span>
        <span class="jp-descent__stat"><b>{practiceCount}</b> practices</span>
        <span class="jp-descent__stat">≈ <b>{totalMinutes}</b> min in all</span>
      </div>
      <div class="jp-descent__body">
        <div class="jp-descent__spine" aria-hidden="true">
          <span class="jp-descent__spine-track"></span>
          <span class="jp-descent__spine-draw"></span>
        </div>
        <ol class="jp-descent__stages">
          {#each stages as stage, i (stage.name + i)}
            <li class="jp-descent-band">
              <div class="jp-descent-gate">
                <span class="jp-descent-gate__node"><span class="jp-descent-gate__rn">{ROMAN[i] ?? i + 1}</span></span>
                <div class="jp-descent-gate__meta">
                  <h3 class="jp-descent-gate__name">{stage.name}</h3>
                  <p class="jp-descent-gate__gloss">{stage.gloss}</p>
                </div>
              </div>
              <div class="jp-descent-practices">
                {#each stage.lessons as lesson, li (lesson.title + li)}
                  <article class="jp-descent-card" class:jp-descent-card--free={lesson.free}>
                    {#if lesson.free}<span class="jp-descent-card__flag">free</span>{/if}
                    <div class="jp-descent-card__top">
                      <span class="jp-descent-card__type">
                        <span class="jp-descent-card__glyph">{glyph(lesson.type)}</span>{label(lesson.type)}
                      </span>
                      <span class="jp-descent-card__lock">{lesson.free ? '▶' : '🔒'}</span>
                    </div>
                    <h4 class="jp-descent-card__title">{lesson.title}</h4>
                    <p class="jp-descent-card__min">{lesson.minutes} min</p>
                  </article>
                {/each}
              </div>
            </li>
          {/each}
        </ol>
      </div>
      {@render foot()}
    {/if}
  </div>
</section>
