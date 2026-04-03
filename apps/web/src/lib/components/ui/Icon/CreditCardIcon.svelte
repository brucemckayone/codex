<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<rect width="20" height="14" x="2" y="5" rx="2" />
	<line x1="2" x2="22" y1="10" y2="10" />
</IconBase>
