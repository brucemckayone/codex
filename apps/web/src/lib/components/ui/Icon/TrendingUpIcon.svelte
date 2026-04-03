<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<path d="M3 3v18h18" />
	<path d="m19 9-5 5-4-4-3 3" />
</IconBase>
