<!--
  @component GuideSection

  The guide / credibility section (Codex-2pryk · WP-3/WP-5). Candlelit poster
  play-frame beside role / heading / bio / pull-quote. Variants: portrait
  (media + text) · centered (no media) · quote (quote-led). Styling in
  `../journey-sections.css`.
-->
<script lang="ts">
  import EditableText from '../EditableText.svelte';
  import { has, type SectionComponentProps, text } from '../section-render';

  let { props, variant, editable = false, onEdit }: SectionComponentProps = $props();
  const edit = (key: string) => (value: string) => onEdit?.(key, value);
</script>

<section class="jp-guide jp-guide--{variant}">
  <div class="jp-guide__inner">
    <div class="jp-guide__player">
      <span class="jp-guide__ember" aria-hidden="true"></span>
      {#if has(props, 'clip')}<span class="jp-guide__watch">{text(props, 'clip')}</span>{/if}
      {#if has(props, 'duration')}<span class="jp-guide__dur">{text(props, 'duration')}</span>{/if}
      <span class="jp-guide__play" aria-hidden="true">▶</span>
    </div>
    <div class="jp-guide__text">
      {#if has(props, 'role')}
        <EditableText tag="p" class="jp-guide__role" field="role" value={text(props, 'role')} {editable} onEdit={edit('role')} />
      {/if}
      <EditableText tag="h2" class="jp-guide__heading" field="heading" value={text(props, 'heading')} {editable} onEdit={edit('heading')} />
      {#if has(props, 'body')}
        <EditableText tag="p" class="jp-guide__body" field="body" value={text(props, 'body')} {editable} onEdit={edit('body')} />
      {/if}
      {#if has(props, 'quote')}
        <blockquote class="jp-guide__quote">
          <EditableText tag="p" field="quote" value={text(props, 'quote')} {editable} onEdit={edit('quote')} />
        </blockquote>
      {/if}
    </div>
  </div>
</section>
