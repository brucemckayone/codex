<script lang="ts">
	import { melt } from '@melt-ui/svelte';
	import type { Snippet } from 'svelte';
	import { getCtx } from './ctx.js';

	const {
		value,
		disabled,
		children,
		class: className,
		...rest
	}: { value: string; disabled?: boolean; children?: Snippet; class?: string } & Record<
		string,
		any
	> = $props();

	const {
		elements: { trigger }
	} = getCtx();
</script>

<button
	use:melt={$trigger({ value, disabled })}
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
