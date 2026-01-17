<script lang="ts">

	import type { Snippet } from 'svelte';
	import { getCtx } from './ctx.js';

	const {
		children,
		class: className,
		...rest
	}: { children?: Snippet; class?: string } & Record<string, any> = $props();

	const {
		elements: { close }
	} = getCtx();
</script>

<button {...$close} use:close class={className} type="button" {...rest}>
	{@render children?.()}
</button>
