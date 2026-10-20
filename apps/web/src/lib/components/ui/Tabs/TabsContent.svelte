<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx, getTabsId, tabIds } from './ctx.js';

	const {
		value,
		children,
		class: className,
		...rest
	}: { value: string; children?: Snippet; class?: string } & HTMLAttributes<HTMLDivElement> = $props();

	const {
		elements: { content }
	} = getCtx();
	const setId = getTabsId();
	const ids = $derived(tabIds(setId, value));
</script>

<!-- Named by its own tab: Melt's `aria-labelledby` is the bare value. -->
<div
	{...$content(value)}
	use:content
	id={ids.panel}
	aria-labelledby={ids.tab}
	class="tabs-content {className ?? ''}"
	{...rest}
>
	{@render children?.()}
</div>

<style>
	.tabs-content {
		outline: none;
	}
</style>
