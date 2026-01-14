<script lang="ts">
	import { type CreateAccordionProps, createAccordion, melt } from '@melt-ui/svelte';
	import type { Snippet } from 'svelte';
	import { setCtx } from './ctx.js';

	type Props = Omit<CreateAccordionProps, 'value' | 'onValueChange'> & {
		children?: Snippet;
		class?: string;
        value?: string | string[];
        onValueChange?: (value: string | string[] | undefined) => void;
	} & Record<string, any>;

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

	const builder = createAccordion({
		defaultValue,
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

<div use:melt={$root} class={className} {...rest}>
	{@render children?.()}
</div>
