<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fly } from 'svelte/transition';
	import { getCtx } from './ctx.js';

	const {
		children,
		class: className,
		transitionConfig = { y: 5, duration: 150 },
		...rest
	}: { children?: Snippet; class?: string; transitionConfig?: any } & Record<string, any> = $props();

	const {
		elements: { content },
		states: { open }
	} = getCtx();
</script>

{#if $open}
	<div
		{...$content}
		use:content
		class="popover-content {className ?? ''}"
		transition:fly={transitionConfig}
		{...rest}
	>
		{@render children?.()}
	</div>
{/if}

<style>
	.popover-content {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		padding: var(--space-4);
		z-index: var(--z-dropdown);
		max-width: 20rem;
		outline: none;
	}
</style>
