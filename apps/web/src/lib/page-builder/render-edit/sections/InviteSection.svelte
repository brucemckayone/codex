<!--
  @component InviteSection

  The offer + CTA close (Codex-2pryk · WP-3/WP-5). Ember rising from below, a
  descent hairline + seed, the offer card in an ember pool. Variants: descent
  (cinematic) · banner (compact horizontal) · card (quiet, no atmosphere).
  Styling in `../journey-sections.css`.
-->
<script lang="ts">
  import EditableText from '../EditableText.svelte';
  import { has, type SectionComponentProps, text } from '../section-render';

  let { props, variant, editable = false, onEdit }: SectionComponentProps = $props();
  const edit = (key: string) => (value: string) => onEdit?.(key, value);
</script>

<section class="jp-invite jp-invite--{variant}">
  {#if variant === 'descent'}
    <div class="jp-invite__descent" aria-hidden="true"><span class="jp-invite__seed"></span></div>
  {/if}
  <div class="jp-invite__wrap">
    {#if has(props, 'eyebrow')}
      <EditableText tag="p" class="jp-eyebrow" field="eyebrow" value={text(props, 'eyebrow')} {editable} onEdit={edit('eyebrow')} />
    {/if}
    <h2 class="jp-invite__title">
      <EditableText field="heading" value={text(props, 'heading')} {editable} onEdit={edit('heading')} />{#if has(props, 'accent')}<EditableText
          class="jp-invite__accent"
          field="accent"
          value={text(props, 'accent')}
          {editable}
          onEdit={edit('accent')}
        />{/if}
    </h2>
    {#if has(props, 'sub')}
      <EditableText tag="p" class="jp-invite__sub" field="sub" value={text(props, 'sub')} {editable} onEdit={edit('sub')} />
    {/if}
    <div class="jp-invite__offer">
      {#if has(props, 'price')}
        <EditableText tag="p" class="jp-invite__price" field="price" value={text(props, 'price')} {editable} onEdit={edit('price')} />
      {/if}
      <span class="jp-cta">
        <EditableText field="button" value={text(props, 'button')} {editable} onEdit={edit('button')} />
        <span class="jp-arrow" aria-hidden="true">→</span>
      </span>
      {#if has(props, 'risk')}
        <EditableText tag="p" class="jp-invite__risk" field="risk" value={text(props, 'risk')} {editable} onEdit={edit('risk')} />
      {/if}
    </div>
  </div>
</section>
