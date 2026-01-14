<script lang="ts">
	import { melt } from '@melt-ui/svelte';
	import type { Snippet } from 'svelte';
	import { getCtx } from './ctx.js';

	const {
		children,
		class: className,
		...rest
	}: { children?: Snippet; class?: string } & Record<string, any> = $props();

	const {
		elements: { list }
	} = getCtx();
</script>

<div use:melt={$list} class="tabs-list {className ?? ''}" {...rest}>
	{@render children?.()}
</div>

<style>
	.tabs-list {
		display: flex;
		justify-content: flex-start;
		border-bottom: 1px solid var(--color-border);
		margin-bottom: var(--space-4);
		gap: var(--space-4);
	}
</style>
