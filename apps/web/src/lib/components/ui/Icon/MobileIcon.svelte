<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
	<path d="M12 18h.01" />
</IconBase>
