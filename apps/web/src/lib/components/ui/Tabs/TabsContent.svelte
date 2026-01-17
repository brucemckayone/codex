<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx } from './ctx.js';

	const {
		value,
		children,
		class: className,
		...rest
	}: { value: string; children?: Snippet; class?: string } & HTMLAttributes<HTMLDivElement> = $props();

	const {
		elements: { content }
	} = getCtx();
</script>

<div {...$content(value)} use:content class="tabs-content {className ?? ''}" {...rest}>
	{@render children?.()}
</div>

<style>
	.tabs-content {
		outline: none;
	}
</style>
