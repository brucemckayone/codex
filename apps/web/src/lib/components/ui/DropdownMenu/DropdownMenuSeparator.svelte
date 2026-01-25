<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx } from './ctx.js';

	const { class: className, ...rest }: { class?: string } & HTMLAttributes<HTMLDivElement> = $props();

	const {
		elements: { separator }
	} = getCtx();
</script>

<div {...$separator} use:separator class="dropdown-separator {className ?? ''}" {...rest}></div>

<style>
	.dropdown-separator {
		height: 1px;
		background-color: var(--color-border);
		margin: var(--space-1) 0;
	}
</style>
