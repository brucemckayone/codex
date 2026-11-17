<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { prefersReducedMotion } from 'svelte/motion';
	import { type FlyParams, fly } from 'svelte/transition';
	import { getCtx } from './ctx.js';

	/**
	 * The panel is a dialog, and a dialog needs a name: an `aria-label`, or an
	 * `aria-labelledby` pointing at its heading. One of them is required, so a
	 * popover without a name does not type-check.
	 */
	type Name =
		| { 'aria-label': string; 'aria-labelledby'?: string }
		| { 'aria-label'?: string; 'aria-labelledby': string };

	type Props = {
		children?: Snippet;
		class?: string;
		transitionConfig?: FlyParams;
	} & Omit<HTMLAttributes<HTMLDivElement>, 'aria-label' | 'aria-labelledby'> &
		Name;

	const { children, class: className, transitionConfig = { y: 5, duration: 150 }, ...rest }: Props =
		$props();

	const {
		elements: { content },
		states: { open },
		options: { disableFocusTrap }
	} = getCtx();

	// Svelte's fly takes raw numbers, which the motion tokens' reduced-motion
	// collapse never reaches (design-system ref 03 §4): under reduce the panel
	// simply appears and goes. The same gate as Dialog.Content's.
	const motion = $derived(
		prefersReducedMotion.current ? { ...transitionConfig, y: 0, duration: 0 } : transitionConfig
	);
</script>

{#if $open}
	<!-- Melt's content carries no role, while its trigger says
	     `aria-haspopup="dialog"`: the panel is that dialog, named by the
	     required `aria-label` or `aria-labelledby`. It is modal while Melt's
	     focus trap holds Tab inside (Popover.Root's default), and non-modal
	     when the root says `disableFocusTrap`, so what a screen reader is told
	     matches what Tab does. A consumer's own `role` (in `rest`) wins. -->
	<div
		{...$content}
		use:content
		class="popover-content {className ?? ''}"
		role="dialog"
		aria-modal={$disableFocusTrap ? undefined : 'true'}
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
