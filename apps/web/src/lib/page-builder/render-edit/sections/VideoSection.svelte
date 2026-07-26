<!--
  @component VideoSection

  Cinematic video frame — backs both `introVideo` and `reel` (Codex-2pryk ·
  WP-3/WP-5), the prototype's single `video()` renderer. Honest poster
  placeholder, no real playback. Variants: cinema (corners + meta) · simple ·
  split (text beside the frame). Styling in `../journey-sections.css`.
-->
<script lang="ts">
  import EditableText from '../EditableText.svelte';
  import { has, type SectionComponentProps, text } from '../section-render';

  let { props, variant, editable = false, onEdit }: SectionComponentProps = $props();

  const edit = (key: string) => (value: string) => onEdit?.(key, value);
  const corners = ['tl', 'tr', 'bl', 'br'] as const;
</script>

{#snippet lead()}
  <div class="jp-video__lead">
    {#if has(props, 'kicker')}
      <EditableText tag="p" class="jp-video__kick" field="kicker" value={text(props, 'kicker')} {editable} onEdit={edit('kicker')} />
    {/if}
    <EditableText tag="h2" class="jp-video__heading" field="heading" value={text(props, 'heading')} {editable} onEdit={edit('heading')} />
    {#if has(props, 'sub')}
      <EditableText tag="p" class="jp-video__sub" field="sub" value={text(props, 'sub')} {editable} onEdit={edit('sub')} />
    {/if}
  </div>
{/snippet}

{#snippet frame()}
  <div class="jp-video__frame">
    {#each corners as c (c)}<span class="jp-video__corner jp-video__corner--{c}"></span>{/each}
    <span class="jp-video__play" aria-hidden="true">▶</span>
    {#if has(props, 'clip')}<span class="jp-video__tag">{text(props, 'clip')}</span>{/if}
    {#if has(props, 'duration')}<span class="jp-video__dur">{text(props, 'duration')}</span>{/if}
  </div>
{/snippet}

<section class="jp-video jp-video--{variant}">
  {#if variant === 'split'}
    <div class="jp-video__wrap">{@render lead()}{@render frame()}</div>
  {:else}
    {@render lead()}{@render frame()}
  {/if}
</section>
