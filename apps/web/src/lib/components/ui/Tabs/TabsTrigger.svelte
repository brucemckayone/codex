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
		color: var(--color-interactive);
		border-bottom-color: var(--color-interactive);
	}

	.tabs-trigger:global([data-disabled]) {
		opacity: var(--opacity-50);
		cursor: not-allowed;
	}
</style>
