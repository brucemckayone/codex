<script lang="ts">
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx, setItemCtx } from './ctx.js';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		value: string;
		disabled?: boolean;
		class?: string;
		children?: Snippet;
	}

	const { value, disabled, class: className, children, ...rest }: Props = $props();

	const {
		elements: { item }
	} = getCtx();

	// Item value is a stable identifier, not reactive state
	setItemCtx(untrack(() => value));
</script>

<div {...$item({ value, disabled })} use:item class="accordion-item {className ?? ''}" {...rest}>
	{@render children?.()}
</div>

<style>
	.accordion-item {
		border-bottom: 1px solid var(--color-border);
	}
	.accordion-item:last-child {
		border-bottom: none;
	}
</style>
