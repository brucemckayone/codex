<!-- STUB — replaced by WP-4 -->
<script lang="ts">
  import type { BlockProps } from '../../model/types';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Text from '../../primitives/Text.svelte';
  import { problemDefinition } from './definition';

  const { props, section, edit }: BlockProps = $props();

  const content = $derived(problemDefinition.coerce(props));
</script>

<div class="lp-stub">
  {#if content.eyebrow}
    <Eyebrow text={content.eyebrow} type={section.type} {edit} />
  {/if}
  {#if content.heading}
    <Heading
      level={section.headingLevel}
      text={content.heading}
      type={section.type}
      field="heading"
      {edit}
    />
  {/if}
  {#if content.body}
    <Text text={content.body} size="lead" type={section.type} field="body" {edit} />
  {/if}
</div>

<style>
  .lp-stub {
    display: grid;
    gap: var(--lp-stack);
    max-inline-size: var(--lp-measure);
  }
</style>
