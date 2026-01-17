<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getCtx } from './ctx.js';

	const {
		children,
		class: className,
		disabled = false,
		...rest
	}: { children?: Snippet; class?: string; disabled?: boolean } & Record<string, any> = $props();

	const {
		elements: { item }
	} = getCtx();
</script>

<div
	{...$item}
	use:item
	class="dropdown-item {className ?? ''}"
	{...rest}
	aria-disabled={disabled}
	data-disabled={disabled ? '' : undefined}
>
	{@render children?.()}
</div>

<style>
	.dropdown-item {
		display: flex;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-base);
		color: var(--color-text);
		cursor: default;
		user-select: none;
		outline: none;
		transition: background-color var(--duration-fast);
		text-decoration: none;
	}

	.dropdown-item:global([data-highlighted]) {
		background-color: var(--color-neutral-100);
		color: var(--color-text);
	}

	.dropdown-item:global([data-disabled]) {
		opacity: 0.5;
		pointer-events: none;
	}
</style>
