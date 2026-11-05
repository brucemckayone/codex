<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { type FlyParams, fly } from 'svelte/transition';
	import { getCtx } from './ctx.js';

	const {
		children,
		class: className,
		transitionConfig = { y: 5, duration: 150 },
		...rest
	}: { children?: Snippet; class?: string; transitionConfig?: FlyParams } & HTMLAttributes<HTMLDivElement> = $props();

	const {
		elements: { content },
		states: { open }
	} = getCtx();

	// Svelte's fly takes raw numbers, which the motion tokens' reduced-motion
	// collapse never reaches (design-system ref 03 §4): under reduce the panel
	// simply appears and goes. Read as it is made, so the first open is right.
	const query = '(prefers-reduced-motion: reduce)';
	let reduceMotion = $state(typeof window !== 'undefined' && window.matchMedia(query).matches);
	$effect(() => {
		const list = window.matchMedia(query);
		const onChange = (e: MediaQueryListEvent) => {
			reduceMotion = e.matches;
		};
		list.addEventListener('change', onChange);
		return () => list.removeEventListener('change', onChange);
	});
	const motion = $derived(reduceMotion ? { ...transitionConfig, y: 0, duration: 0 } : transitionConfig);
</script>

{#if $open}
	<!-- Melt's content carries no role, while its trigger says
	     `aria-haspopup="dialog"`: the panel is that non-modal dialog, so its
	     `aria-label` names something. A consumer's own `role` (in `rest`) wins. -->
	<div
		{...$content}
		use:content
		class="popover-content {className ?? ''}"
		role="dialog"
		transition:fly={motion}
		{...rest}
	>
		{@render children?.()}
	</div>
{/if}

<style>
	.popover-content {
		background: var(--color-surface);
		border: var(--border-width) var(--border-style) var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		padding: var(--space-4);
		z-index: var(--z-dropdown);
		max-width: 20rem;
		outline: none;
	}
</style>
