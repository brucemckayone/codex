<script lang="ts">
	import { type CreateTabsProps, createTabs, melt } from '@melt-ui/svelte';
	import type { Snippet } from 'svelte';
	import { setCtx } from './ctx.js';

	type Props = Omit<CreateTabsProps, 'value' | 'onValueChange'> & {
		children?: Snippet;
		class?: string;
        value?: string;
        onValueChange?: (value: string | undefined) => void;
	} & Record<string, any>;

	let {
		orientation,
		activateOnFocus,
		loop,
		autoSet,
		defaultValue,
		value = $bindable(),
		onValueChange,
		children,
		class: className,
		...rest
	}: Props = $props();

	const builder = createTabs({
		defaultValue,
		autoSet,
		orientation, // Init needed for correct start
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
		options.orientation.set(orientation);
		options.activateOnFocus.set(activateOnFocus);
		options.loop.set(loop);
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
