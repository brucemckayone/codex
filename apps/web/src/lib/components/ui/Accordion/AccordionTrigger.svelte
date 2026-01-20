<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx, getItemCtx } from './ctx.js';

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
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="accordion-chevron"
			class:rotated={$isSelected(value)}
		>
			<polyline points="6 9 12 15 18 9"></polyline>
		</svg>
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
