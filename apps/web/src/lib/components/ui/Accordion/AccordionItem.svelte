<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getCtx, setItemCtx } from './ctx.js';

	interface Props {
		value: string;
		disabled?: boolean;
		class?: string;
		children?: Snippet;
		[key: string]: any;
	}

	const { value, disabled, class: className, children, ...rest }: Props = $props();

	const {
		elements: { item }
	} = getCtx();

	// Item value is stable identifier (not reactive - intentional)
	setItemCtx(value);
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
