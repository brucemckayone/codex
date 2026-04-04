<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<rect width="7" height="7" x="3" y="3" rx="1" />
	<rect width="7" height="7" x="14" y="3" rx="1" />
	<rect width="7" height="7" x="14" y="14" rx="1" />
	<rect width="7" height="7" x="3" y="14" rx="1" />
</IconBase>
