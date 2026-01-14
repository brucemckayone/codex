<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '../Button/index';
	import * as Dialog from '../Dialog/index';

	interface Props {
		open?: boolean;
		title: string;
		description?: string;
		confirmText?: string;
		cancelText?: string;
		variant?: 'primary' | 'destructive';
		onConfirm?: () => void;
		onCancel?: () => void;
		children?: Snippet;
	}

	let {
		open = $bindable(false),
		title,
		description,
		confirmText = 'Confirm',
		cancelText = 'Cancel',
		variant = 'primary',
		onConfirm,
		onCancel,
		children
	}: Props = $props();

	function handleConfirm() {
		onConfirm?.();
		open = false;
	}

	function handleCancel() {
		onCancel?.();
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Title>{title}</Dialog.Title>
		{#if description}
			<Dialog.Description>{description}</Dialog.Description>
		{/if}

		{@render children?.()}

		<Dialog.Footer>
			<Button variant="secondary" onclick={handleCancel}>{cancelText}</Button>
			<Button variant={variant} onclick={handleConfirm}>{confirmText}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
