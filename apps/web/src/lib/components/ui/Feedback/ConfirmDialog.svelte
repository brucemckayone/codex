<!--
  @component ConfirmDialog

  A small confirm / cancel dialog. By default it closes the moment either
  button is pressed and does not wait for `onConfirm`.

  @prop {boolean} [open=false] - Bindable.
  @prop {string} title
  @prop {string} [description]
  @prop {string} [confirmText='Confirm']
  @prop {string} [cancelText='Cancel']
  @prop {'primary'|'destructive'} [variant='primary']
  @prop {boolean} [confirmDisabled=false] - Disables the confirm button only,
    e.g. while what it confirms is still loading. Cancel stays available.
  @prop {boolean} [awaitConfirm=false] - Opt in to waiting for `onConfirm`:
    when it returns a promise, the dialog stays open with the confirm button
    busy and Cancel disabled until it settles. Fulfilled closes the dialog;
    rejected leaves it open (so nothing looks done that was not) and rethrows,
    so the caller owns the message. Off by default because existing callers
    pass async handlers and rely on the immediate close.
  @prop {() => void | Promise<unknown>} [onConfirm]
  @prop {() => void} [onCancel]
  @prop {Snippet} [children] - Rendered in the dialog body.
-->
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
		confirmDisabled?: boolean;
		awaitConfirm?: boolean;
		onConfirm?: () => void | Promise<unknown>;
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
		confirmDisabled = false,
		awaitConfirm = false,
		onConfirm,
		onCancel,
		children
	}: Props = $props();

	let busy = $state(false);
	/**
	 * Bumped whenever the dialog closes, so a confirm that settles after the
	 * person closed it (Escape, the overlay, ✕) cannot close a dialog opened
	 * since, or leave it busy.
	 */
	let session = 0;

	async function handleConfirm() {
		const result = onConfirm?.();
		if (!awaitConfirm || !(result instanceof Promise)) {
			open = false;
			return;
		}
		const mine = session;
		busy = true;
		try {
			await result;
			if (mine === session) open = false;
		} finally {
			if (mine === session) busy = false;
		}
	}

	function handleCancel() {
		onCancel?.();
		open = false;
	}

	function handleOpenChange(next: boolean) {
		if (next) return;
		session += 1;
		busy = false;
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content size="sm">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			{#if description}
				<Dialog.Description>{description}</Dialog.Description>
			{/if}
		</Dialog.Header>

		{#if children}
			<Dialog.Body>
				{@render children()}
			</Dialog.Body>
		{/if}

		<Dialog.Footer>
			<Button variant="secondary" onclick={handleCancel} disabled={busy}>{cancelText}</Button>
			<Button
				variant={variant}
				onclick={handleConfirm}
				disabled={confirmDisabled}
				loading={busy}
			>
				{confirmText}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
