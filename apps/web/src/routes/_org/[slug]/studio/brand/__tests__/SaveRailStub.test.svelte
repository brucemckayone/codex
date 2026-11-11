<!--
  Test-only stand-in for the brand page's rail (and Guided view): one Save
  button wired to the page's `onsave`, so a test can run the page's own Save.
  Named `*.test.svelte` so the vitest include globs never collect it.
-->
<script lang="ts">
  let { onsave }: { onsave?: () => void } = $props();
</script>

<button type="button" data-testid="stub-save" onclick={() => onsave?.()}>
  Save
</button>
