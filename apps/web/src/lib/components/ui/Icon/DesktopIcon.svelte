<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<rect width="20" height="14" x="2" y="3" rx="2" />
	<line x1="8" x2="16" y1="21" y2="21" />
	<line x1="12" x2="12" y1="17" y2="21" />
</IconBase>
