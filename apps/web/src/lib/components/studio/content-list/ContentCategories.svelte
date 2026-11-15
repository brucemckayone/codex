<!--
  @component ContentCategories

  A piece's categories in the org studio's list (Codex-a6ofh.3.3), the
  table's column and the card's fact alike: the first name and how many
  more ("Tutorials +2", `categoryWords`), and every name in the tooltip and
  for a screen reader. One line, however long the first name. A piece in
  none is the caller's to show, or not.
-->
<script lang="ts">
  interface Props {
    filed: { shown: string; all: string };
  }

  const { filed }: Props = $props();
</script>

<span class="content-categories" title={filed.all}>
  <span aria-hidden="true">{filed.shown}</span><span class="sr-only">{filed.all}</span>
</span>

<style>
  .content-categories {
    display: inline-block;
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }
</style>
