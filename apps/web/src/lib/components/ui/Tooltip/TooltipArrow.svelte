<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx } from './ctx.js';

	const { class: className, ...rest }: { class?: string } & HTMLAttributes<HTMLDivElement> = $props();

	const {
		elements: { arrow }
	} = getCtx();
</script>

<div {...$arrow} use:arrow class="tooltip-arrow {className ?? ''}" {...rest}></div>

<style>
	.tooltip-arrow {
		background-color: var(--color-surface-secondary);
		border-color: var(--color-border);
	}
</style>
