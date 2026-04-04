<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<rect width="7" height="7" x="3" y="3" rx="1" />
	<rect width="7" height="7" x="3" y="14" rx="1" />
	<line x1="14" x2="21" y1="4" y2="4" />
	<line x1="14" x2="21" y1="9" y2="9" />
	<line x1="14" x2="21" y1="15" y2="15" />
	<line x1="14" x2="21" y1="20" y2="20" />
</IconBase>
