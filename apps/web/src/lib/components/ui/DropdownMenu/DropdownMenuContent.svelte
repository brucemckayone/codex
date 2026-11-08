<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { prefersReducedMotion } from 'svelte/motion';
	import { type FlyParams, fly } from 'svelte/transition';
	import { forwardBrandTokens } from '$lib/utils/portal-brand';
	import { getCtx } from './ctx.js';

	const {
		children,
		class: className,
		transitionConfig = { y: -5, duration: 150 },
		...rest
	}: { children?: Snippet; class?: string; transitionConfig?: FlyParams } & Omit<
		HTMLAttributes<HTMLDivElement>,
		'id'
	> = $props();

	// Melt's id stays, after the spread, whatever a page passes: the
	// trigger's aria-controls, the menu's close focus (DropdownMenu.svelte)
	// and a dialog's way back to the menu's button (Dialog.svelte's
	// menuTrigger) all find the menu by it (Codex-vlphc review c6).
	const {
		elements: { menu },
		states: { open }
	} = getCtx();

	/**
	 * A Svelte transition is timed in JS, so no CSS reduced-motion rule reaches
	 * it (Codex-71rf3): the menu appears in place for a reduced-motion user.
	 */
	const motion = $derived(
		prefersReducedMotion.current ? { ...transitionConfig, y: 0, duration: 0 } : transitionConfig
	);
</script>

{#if $open}
	<div
		{...$menu}
		use:menu
		use:forwardBrandTokens
		class="dropdown-content {className ?? ''}"
		transition:fly={motion}
		{...rest}
		id={$menu.id}
	>
		{@render children?.()}
	</div>
{/if}

<style>
	.dropdown-content {
		background: var(--color-surface);
		border: var(--border-width) var(--border-style) var(--color-border);
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
