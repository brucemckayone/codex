<script lang="ts">
	import { melt } from '@melt-ui/svelte';
	import { getCtx } from './ctx.js';

	const { class: className, ...rest }: { class?: string } & Record<string, any> = $props();

	const {
		elements: { separator }
	} = getCtx();
</script>

<div use:melt={$separator} class="dropdown-separator {className ?? ''}" {...rest}></div>

<style>
	.dropdown-separator {
		height: 1px;
		background-color: var(--color-border);
		margin: var(--space-1) 0;
	}
</style>
