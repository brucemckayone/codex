<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
</IconBase>
