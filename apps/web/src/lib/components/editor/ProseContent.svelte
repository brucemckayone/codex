<!--
  @component ProseContent

  Brand-aware renderer for TipTap HTML content.
  Provides beautiful long-form typography that inherits org branding
  CSS variables (colors, fonts, density, radius) automatically. The styles
  are the shared `$lib/styles/prose.css`, which the studio editor's canvas
  uses too.

  @prop {string} html - Pre-rendered, sanitised HTML from renderContentBody()
-->
<script lang="ts">
  import '$lib/styles/prose.css';

  interface Props {
    html: string;
  }

  const { html }: Props = $props();
</script>

<article class="prose-content">
  {@html html}
</article>
