<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor" />
	<path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
	<path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
</IconBase>
