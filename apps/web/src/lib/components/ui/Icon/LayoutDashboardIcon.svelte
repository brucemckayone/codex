<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<rect width="7" height="9" x="3" y="3" rx="1" />
	<rect width="7" height="5" x="14" y="3" rx="1" />
	<rect width="7" height="9" x="14" y="12" rx="1" />
	<rect width="7" height="5" x="3" y="16" rx="1" />
</IconBase>
