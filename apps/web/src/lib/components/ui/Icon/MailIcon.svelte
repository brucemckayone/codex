<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<rect x="2" y="4" width="20" height="16" rx="2" />
	<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
</IconBase>
