<script lang="ts">
	import { melt } from '@melt-ui/svelte';
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

	setItemCtx(value);
</script>

<div use:melt={$item({ value, disabled })} class="accordion-item {className ?? ''}" {...rest}>
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
