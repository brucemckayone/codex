<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<path d="m22 8-6 4 6 4V8Z" />
	<rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
</IconBase>
