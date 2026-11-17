<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx, getItemCtx } from './ctx.js';
	import { ChevronDownIcon } from '$lib/components/ui/Icon';

	const {
		children,
		class: className,
		level,
		...rest
	}: {
		children?: Snippet;
		class?: string;
		/** The heading the trigger sits in (WAI-ARIA accordion), so a fold is found by its heading; none by default. */
		level?: 2 | 3 | 4 | 5 | 6;
	} & HTMLAttributes<HTMLButtonElement> = $props();

	const {
		elements: { trigger },
		helpers: { isSelected }
	} = getCtx();
	const { value } = getItemCtx();
</script>

<svelte:element this={level ? `h${level}` : 'div'} class="accordion-header">
	<button
		{...$trigger(value)}
		use:trigger
		class="accordion-trigger {className ?? ''}"
		type="button"
		{...rest}
	>
		{@render children?.()}
		<ChevronDownIcon class="accordion-chevron {$isSelected(value) ? 'rotated' : ''}" />
	</button>
</svelte:element>

<style>
	.accordion-header {
		display: flex;
		margin: 0;
		font: inherit;
	}
	.accordion-trigger {
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-4) 0;
		font-weight: var(--font-medium);
		transition: all var(--duration-normal) var(--ease-default);
		background: transparent;
		border: none;
		cursor: pointer;
		width: 100%;
		text-align: left;
		color: var(--color-text);
		font-size: var(--text-sm);
	}
	.accordion-trigger:hover {
		text-decoration: underline;
	}
	.accordion-chevron {
		height: 1rem;
		width: 1rem;
		transition: transform var(--duration-normal) var(--ease-default);
		opacity: var(--opacity-50);
	}
	.rotated {
		transform: rotate(180deg);
	}
</style>
