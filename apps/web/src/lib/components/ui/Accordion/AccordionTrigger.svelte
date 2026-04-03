<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx, getItemCtx } from './ctx.js';
	import { ChevronDownIcon } from '$lib/components/ui/Icon';

	const {
		children,
		class: className,
		...rest
	}: { children?: Snippet; class?: string } & HTMLAttributes<HTMLButtonElement> = $props();

	const {
		elements: { trigger },
		helpers: { isSelected }
	} = getCtx();
	const { value } = getItemCtx();
</script>

<div class="accordion-header">
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
</div>

<style>
	.accordion-header {
		display: flex;
	}
	.accordion-trigger {
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-4) 0;
		font-weight: var(--font-medium);
		transition: all 0.2s;
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
		transition: transform 0.2s;
		opacity: 0.5;
	}
	.rotated {
		transform: rotate(180deg);
	}
</style>
