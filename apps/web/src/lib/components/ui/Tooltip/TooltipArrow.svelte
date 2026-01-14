<script lang="ts">
	import { melt } from '@melt-ui/svelte';
	import { getCtx } from './ctx.js';

	const { class: className, ...rest }: { class?: string } & Record<string, any> = $props();

	const {
		elements: { arrow }
	} = getCtx();
</script>

<div use:melt={$arrow} class="tooltip-arrow {className ?? ''}" {...rest}></div>

<style>
	.tooltip-arrow {
		background-color: var(--color-surface-secondary);
		border-color: var(--color-border);
	}
</style>
