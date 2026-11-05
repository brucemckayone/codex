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
		elements: { trigger },
		states: { open }
	} = getCtx();
</script>

<!-- `aria-expanded` from the open state, after Melt's: under `forceVisible`
     (Popover.Root's default) Melt derives its own from visibility, so it read
     "true" closed as well as open. -->
<button {...$trigger} use:trigger class={className} type="button" aria-expanded={$open ? 'true' : 'false'} {...rest}>
	{@render children?.()}
</button>
