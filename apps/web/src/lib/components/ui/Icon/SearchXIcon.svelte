<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<circle cx="11" cy="11" r="8" />
	<line x1="21" y1="21" x2="16.65" y2="16.65" />
	<line x1="8" y1="8" x2="14" y2="14" />
	<line x1="14" y1="8" x2="8" y2="14" />
</IconBase>
