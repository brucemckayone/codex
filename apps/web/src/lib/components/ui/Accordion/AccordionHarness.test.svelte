<script lang="ts">
  import Accordion from './Accordion.svelte';
  import AccordionContent from './AccordionContent.svelte';
  import AccordionItem from './AccordionItem.svelte';
  import AccordionTrigger from './AccordionTrigger.svelte';

  interface Props {
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string | string[] | undefined) => void;
    disabled?: boolean;
  }

  let {
    value = $bindable(),
    defaultValue,
    onValueChange,
    disabled,
  }: Props = $props();
</script>

<Accordion bind:value {defaultValue} {onValueChange} {disabled}>
  <AccordionItem value="item-1">
    <AccordionTrigger data-testid="trigger-1">Question One?</AccordionTrigger>
    <AccordionContent data-testid="content-1">Answer One</AccordionContent>
  </AccordionItem>
  <AccordionItem value="item-2">
    <AccordionTrigger data-testid="trigger-2">Question Two?</AccordionTrigger>
    <AccordionContent data-testid="content-2">Answer Two</AccordionContent>
  </AccordionItem>
  <AccordionItem value="item-3" disabled>
    <AccordionTrigger data-testid="trigger-3">Disabled item?</AccordionTrigger>
    <AccordionContent data-testid="content-3">Disabled Answer</AccordionContent>
  </AccordionItem>
</Accordion>
