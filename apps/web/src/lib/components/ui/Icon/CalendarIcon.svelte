<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
	<path d="M16 2v5" />
	<path d="M8 2v5" />
	<path d="M2 12h20" />
</IconBase>
