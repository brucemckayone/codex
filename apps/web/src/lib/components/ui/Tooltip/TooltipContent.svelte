<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { type FadeParams, fade } from 'svelte/transition';
	import { getCtx } from './ctx.js';

	const {
		children,
		class: className,
		transitionConfig = { duration: 150 },
		...rest
	}: { children?: Snippet; class?: string; transitionConfig?: FadeParams } & HTMLAttributes<HTMLDivElement> = $props();

	const {
		elements: { content },
		states: { open }
	} = getCtx();
</script>

{#if $open}
	<div
		{...$content}
		use:content
		class="tooltip-content {className ?? ''}"
		transition:fade={transitionConfig}
		{...rest}
	>
		{@render children?.()}
	</div>
{/if}

<style>
	.tooltip-content {
		background: var(--color-surface-secondary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-sm);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-xs);
		z-index: var(--z-dropdown);
		pointer-events: none;
	}
</style>
