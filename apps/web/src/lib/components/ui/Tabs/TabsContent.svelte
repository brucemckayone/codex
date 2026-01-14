<script lang="ts">
	import { melt } from '@melt-ui/svelte';
	import type { Snippet } from 'svelte';
	import { getCtx } from './ctx.js';

	const {
		value,
		children,
		class: className,
		...rest
	}: { value: string; children?: Snippet; class?: string } & Record<string, any> = $props();

	const {
		elements: { content }
	} = getCtx();
</script>

<div use:melt={$content(value)} class="tabs-content {className ?? ''}" {...rest}>
	{@render children?.()}
</div>

<style>
	.tabs-content {
		outline: none;
	}
</style>
