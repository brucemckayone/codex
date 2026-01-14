<script lang="ts">
	import { melt } from '@melt-ui/svelte';
	import type { Snippet } from 'svelte';
	import { fly } from 'svelte/transition';
	import { getCtx } from './ctx.js';

	const {
		children,
		class: className,
		transitionConfig = { y: -5, duration: 150 },
		...rest
	}: { children?: Snippet; class?: string; transitionConfig?: any } & Record<string, any> = $props();

	const {
		elements: { menu },
		states: { open }
	} = getCtx();
</script>

{#if $open}
	<div
		use:melt={$menu}
		class="dropdown-content {className ?? ''}"
		transition:fly={transitionConfig}
		{...rest}
	>
		{@render children?.()}
	</div>
{/if}

<style>
	.dropdown-content {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		padding: var(--space-1);
		z-index: var(--z-dropdown);
		min-width: 8rem;
		display: flex;
		flex-direction: column;
		outline: none;
	}
</style>
