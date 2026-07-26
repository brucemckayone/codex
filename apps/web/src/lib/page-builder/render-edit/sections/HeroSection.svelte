<!--
  @component HeroSection

  The opening hero for a journey sales page (Codex-2pryk · WP-3/WP-5). Faithful
  port of the prototype's hero renderer: breathing brand glow, rising motes,
  vignette, kinetic serif headline with an italic accent ending, lede + emphasis
  line, primary + quiet CTA, trust dot, scroll cue. Variants: centered · left ·
  split (media) · minimal. Background treatment via `props.bg` (ember/blood/still).
  Styling lives in `../journey-sections.css` (real Codex tokens).
-->
<script lang="ts">
  import EditableText from '../EditableText.svelte';
  import { has, type SectionComponentProps, text } from '../section-render';

  let { props, variant, editable = false, onEdit }: SectionComponentProps = $props();

  const edit = (key: string) => (value: string) => onEdit?.(key, value);
  const motes = Array.from({ length: 12 }, (_, i) => i);
  const bg = $derived(text(props, 'bg') || 'ember');
  const showCue = $derived(variant !== 'split' && variant !== 'minimal');
</script>

{#snippet column()}
  {#if has(props, 'eyebrow')}
    <EditableText
      tag="p"
      class="jp-eyebrow"
      field="eyebrow"
      value={text(props, 'eyebrow')}
      {editable}
      onEdit={edit('eyebrow')}
    />
  {/if}
  <h1 class="jp-hero__headline">
    <EditableText
      field="headline"
      value={text(props, 'headline')}
      {editable}
      onEdit={edit('headline')}
    />{#if has(props, 'accent')}&nbsp;<EditableText
        class="jp-hero__soften"
        field="accent"
        value={text(props, 'accent')}
        {editable}
        onEdit={edit('accent')}
      />{/if}
  </h1>
  <p class="jp-hero__lede">
    <EditableText field="sub" value={text(props, 'sub')} {editable} onEdit={edit('sub')} />
    {#if has(props, 'felt')}
      <EditableText
        class="jp-hero__lede-accent"
        field="felt"
        value={text(props, 'felt')}
        {editable}
        onEdit={edit('felt')}
      />
    {/if}
  </p>
  <div class="jp-hero__actions">
    <span class="jp-cta">
      <EditableText field="button" value={text(props, 'button')} {editable} onEdit={edit('button')} />
      <span class="jp-arrow" aria-hidden="true">→</span>
    </span>
    {#if has(props, 'quiet')}
      <span class="jp-hero__quiet">
        <EditableText field="quiet" value={text(props, 'quiet')} {editable} onEdit={edit('quiet')} />
        <span aria-hidden="true">↓</span>
      </span>
    {/if}
  </div>
  {#if has(props, 'trust')}
    <p class="jp-hero__trust">
      <span class="jp-hero__trust-dot" aria-hidden="true"></span>
      <EditableText field="trust" value={text(props, 'trust')} {editable} onEdit={edit('trust')} />
    </p>
  {/if}
{/snippet}

<header class="jp-hero jp-hero--{variant}" data-bg={bg}>
  <div class="jp-hero__atmos" aria-hidden="true">
    <div class="jp-hero__glow"></div>
    <div class="jp-hero__motes">
      {#each motes as m (m)}<span class="jp-hero__mote"></span>{/each}
    </div>
    <div class="jp-hero__vignette"></div>
  </div>

  {#if variant === 'split'}
    <div class="jp-hero__inner">
      <div class="jp-hero__col">{@render column()}</div>
      <div class="jp-hero__media"><span class="jp-play-dot" aria-hidden="true">▶</span></div>
    </div>
  {:else}
    <div class="jp-hero__inner">{@render column()}</div>
  {/if}

  {#if showCue}
    <span class="jp-hero__cue" aria-hidden="true">
      <span class="jp-hero__cue-line"><span class="jp-hero__cue-spark"></span></span>
      <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
        <path d="M1 1l7 7 7-7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
  {/if}
</header>
