<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx, getTabsId, tabIds } from './ctx.js';

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
	const setId = getTabsId();
	const ids = $derived(tabIds(setId, value));
	const attrs = $derived($trigger({ value, disabled }));
</script>

<!-- Melt marks the current tab only in `data-state`: a screen reader needs
     `aria-selected`, and the panel this tab controls. -->
<button
	{...attrs}
	use:trigger
	role="tab"
	id={ids.tab}
	aria-selected={attrs['data-state'] === 'active'}
	aria-controls={ids.panel}
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
