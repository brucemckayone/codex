<script lang="ts">
  import Accordion from './Accordion.svelte';
  import AccordionContent from './AccordionContent.svelte';
  import AccordionItem from './AccordionItem.svelte';
  import AccordionTrigger from './AccordionTrigger.svelte';

  interface Props {
    defaultValue?: string[];
    onValueChange?: (value: string | string[] | undefined) => void;
  }

  let { defaultValue, onValueChange }: Props = $props();

  // Wire `multiple` and `defaultValue` via a props-spread to dodge the wrapper's
  // Props type narrowing `multiple` to `false`. The Melt UI runtime is the
  // source of truth for behaviour here; value type is verified by E2E tests.
  const multipleProps = $derived(
    {
      multiple: true,
      defaultValue,
    } as unknown as { multiple: false; defaultValue: string | undefined }
  );
</script>

<Accordion {onValueChange} {...multipleProps}>
  <AccordionItem value="item-1">
    <AccordionTrigger data-testid="trigger-1">Question One?</AccordionTrigger>
    <AccordionContent data-testid="content-1">Answer One</AccordionContent>
  </AccordionItem>
  <AccordionItem value="item-2">
    <AccordionTrigger data-testid="trigger-2">Question Two?</AccordionTrigger>
    <AccordionContent data-testid="content-2">Answer Two</AccordionContent>
  </AccordionItem>
</Accordion>
