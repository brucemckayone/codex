<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<polyline points="15,3 21,3 21,9" />
	<polyline points="9,21 3,21 3,15" />
	<line x1="21" y1="3" x2="14" y2="10" />
	<line x1="3" y1="21" x2="10" y2="14" />
</IconBase>
