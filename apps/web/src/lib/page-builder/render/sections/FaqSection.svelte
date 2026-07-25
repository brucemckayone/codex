<!--
  @component FaqSection

  Objection-handling FAQ (Codex-2pryk · WP-3/WP-5), native `<details>` for
  accessibility. Questions are edited via the inspector (so the summary toggle
  stays clean); answers are inline-editable in the canvas. Variants: accordion
  (first open) · open (all expanded) · boxed (each a card). A row renders only
  when its question is non-empty. Styling in `../journey-sections.css`.
-->
<script lang="ts">
  import EditableText from '../EditableText.svelte';
  import { has, type SectionComponentProps, text } from '../section-render';

  let { props, variant, editable = false, onEdit }: SectionComponentProps = $props();
  const edit = (key: string) => (value: string) => onEdit?.(key, value);
  const slots = [1, 2, 3] as const;

  const openByDefault = (i: number): boolean =>
    variant === 'accordion' ? i === 0 : true;
</script>

<section class="jp-faq jp-faq--{variant}">
  <div class="jp-faq__wrap">
    <header class="jp-faq__head">
      <EditableText tag="h2" class="jp-faq__title" field="heading" value={text(props, 'heading')} {editable} onEdit={edit('heading')} />
      <span class="jp-faq__rule"></span>
    </header>
    <div class="jp-faq__list">
      {#each slots as n (n)}
        {#if has(props, `q${n}`)}
          <details class="jp-faq__item" open={openByDefault(n - 1)}>
            <summary class="jp-faq__q">
              <!-- Read-only in-canvas (edited via the inspector) so the toggle stays clean. -->
              <EditableText class="jp-faq__qt" field={`q${n}`} value={text(props, `q${n}`)} editable={false} />
              <span class="jp-faq__ic" aria-hidden="true"></span>
            </summary>
            <div class="jp-faq__panel">
              <EditableText field={`a${n}`} value={text(props, `a${n}`)} {editable} onEdit={edit(`a${n}`)} />
            </div>
          </details>
        {/if}
      {/each}
    </div>
  </div>
</section>
