<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
	<path d="M7 11V7a5 5 0 0 1 10 0v4" />
</IconBase>
