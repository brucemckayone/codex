<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
	<line x1="12" x2="12.01" y1="18" y2="18" />
</IconBase>
