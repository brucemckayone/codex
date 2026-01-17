<script lang="ts">
	import { getCtx } from './ctx.js';

	const { class: className, ...rest }: { class?: string } & Record<string, any> = $props();

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
