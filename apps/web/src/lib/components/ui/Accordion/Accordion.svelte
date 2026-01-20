<!--
  @component Accordion

  An accessible accordion component supporting single or multiple open items.
  Follows WAI-ARIA patterns with full keyboard navigation support.

  @prop {boolean} [multiple] - Allow multiple items to be open simultaneously
  @prop {string|string[]} value - Bindable value(s) of currently open item(s)
  @prop {string|string[]} [defaultValue] - Initial value (captured at init only)
  @prop {function} [onValueChange] - Callback when open items change
  @prop {boolean} [disabled] - Disable the entire accordion
  @prop {boolean} [forceVisible] - Force all content to be visible (for testing)

  @example
  <Accordion.Root bind:value={openItems}>
    <Accordion.Item value="item-1">
      <Accordion.Trigger>Question?</Accordion.Trigger>
      <Accordion.Content>Answer</Accordion.Content>
    </Accordion.Item>
  </Accordion.Root>
-->
<script lang="ts">
	import { type CreateAccordionProps, createAccordion } from '@melt-ui/svelte';
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { setCtx } from './ctx.js';

	type Props = Omit<CreateAccordionProps, 'value' | 'onValueChange'> & {
		children?: Snippet;
		class?: string;
        value?: string | string[];
        onValueChange?: (value: string | string[] | undefined) => void;
	} & HTMLAttributes<HTMLDivElement>;

	let {
		multiple,
		value = $bindable(),
		defaultValue,
		onValueChange,
		disabled,
		forceVisible,
		children,
		class: className,
		...rest
	}: Props = $props();

	// defaultValue must be captured at init only (prevents reactivity bugs when value changes externally)
	const builder = createAccordion({
		defaultValue: untrack(() => defaultValue),
		onValueChange: ({ next }) => {
			if (value !== next) {
				value = next;
				onValueChange?.(next);
			}
			return next;
		}
	});

	const {
		elements: { root },
		options,
		states: { value: valueStore }
	} = builder;

	setCtx(builder);

	$effect(() => {
		options.multiple.set(multiple);
		options.disabled.set(disabled);
		options.forceVisible.set(forceVisible);
	});

	$effect(() => {
		if (value !== undefined && value !== $valueStore) {
			valueStore.set(value);
		}
	});
</script>

<div {...$root} use:root class={className} {...rest}>
	{@render children?.()}
</div>
