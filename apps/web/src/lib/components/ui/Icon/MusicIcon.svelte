<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<path d="M9 18V5l12-2v13" />
	<circle cx="6" cy="18" r="3" />
	<circle cx="18" cy="16" r="3" />
</IconBase>
