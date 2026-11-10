<!-- A host that holds the slug and moves it itself, as the draft session does. -->
<script lang="ts">
  import SlugField from '../SlugField.svelte';

  let slug = $state('runes');
</script>

<SlugField value={slug} onchange={(next) => (slug = next)} orgSlug="alpha" organizationId="org-1" contentId="c1" />
<button type="button" data-move onclick={() => (slug = 'runes-all-three')}>move</button>
