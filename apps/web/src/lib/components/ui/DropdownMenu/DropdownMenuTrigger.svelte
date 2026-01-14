<script lang="ts">
	import { melt } from '@melt-ui/svelte';
	import type { Snippet } from 'svelte';
	import { getCtx } from './ctx.js';

	const { children, class: className, ...rest }: { children: Snippet; class?: string } & Record<string, any> = $props();

	const {
		elements: { trigger }
	} = getCtx();
</script>

<button use:melt={$trigger} class={className} type="button" {...rest}>
	{@render children()}
</button>
