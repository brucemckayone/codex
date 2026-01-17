<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx } from './ctx.js';

	const {
		children,
		class: className,
		...rest
	}: { children?: Snippet; class?: string } & HTMLAttributes<HTMLDivElement> = $props();

	const {
		elements: { list }
	} = getCtx();
</script>

<div {...$list} use:list class="tabs-list {className ?? ''}" {...rest}>
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
