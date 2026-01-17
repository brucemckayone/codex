<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getCtx } from './ctx.js';

	const { children, class: className, ...rest }: { children: Snippet; class?: string } & HTMLAttributes<HTMLButtonElement> = $props();

	const {
		elements: { trigger }
	} = getCtx();
</script>

<button {...$trigger} use:trigger class={className} type="button" {...rest}>
	{@render children()}
</button>
