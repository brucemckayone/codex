<script lang="ts">
	import { getCtx } from './ctx.js';

	const { class: className, ...rest }: { class?: string } & Record<string, any> = $props();

	const {
		elements: { arrow }
	} = getCtx();
</script>

<div {...$arrow} use:arrow class="popover-arrow {className ?? ''}" {...rest}></div>

<style>
	.popover-arrow {
		background-color: var(--color-surface);
		border-color: var(--color-border);
	}
</style>
