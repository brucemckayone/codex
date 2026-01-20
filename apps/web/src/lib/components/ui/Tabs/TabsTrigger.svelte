<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx } from './ctx.js';

	const {
		value,
		disabled,
		children,
		class: className,
		...rest
	}: { value: string; disabled?: boolean; children?: Snippet; class?: string } & HTMLAttributes<HTMLButtonElement> = $props();

	const {
		elements: { trigger }
	} = getCtx();
</script>

<button
	{...$trigger({ value, disabled })}
	use:trigger
	class="tabs-trigger {className ?? ''}"
	{...rest}
>
	{@render children?.()}
</button>

<style>
	.tabs-trigger {
		background: transparent;
		border: none;
		padding: var(--space-2) 0;
		cursor: pointer;
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--color-text-secondary);
		border-bottom: 2px solid transparent;
		transition: all var(--duration-fast);
	}

	.tabs-trigger:hover {
		color: var(--color-text);
	}

	.tabs-trigger:global([data-state='active']) {
		color: var(--color-primary-500);
		border-bottom-color: var(--color-primary-500);
	}

	.tabs-trigger:global([data-disabled]) {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
