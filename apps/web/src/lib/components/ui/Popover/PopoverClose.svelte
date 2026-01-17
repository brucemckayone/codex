<script lang="ts">

	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx } from './ctx.js';

	const {
		children,
		class: className,
		...rest
	}: { children?: Snippet; class?: string } & HTMLAttributes<HTMLButtonElement> = $props();

	const {
		elements: { close }
	} = getCtx();
</script>

<button {...$close} use:close class={className} type="button" {...rest}>
	{@render children?.()}
</button>
