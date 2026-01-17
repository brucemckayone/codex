<script lang="ts">

	import type { Snippet } from 'svelte';
	import { getCtx } from './ctx.js';

	const {
		children,
		class: className,
		...rest
	}: { children?: Snippet; class?: string } & Record<string, any> = $props();

	const {
		elements: { trigger }
	} = getCtx();
</script>

<button {...$trigger} use:trigger class={className} type="button" {...rest}>
	{@render children?.()}
</button>
