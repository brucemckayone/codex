<script lang="ts">
	/**
	 * Content Detail Error Boundary
	 *
	 * Handles errors for content detail page with helpful messaging.
	 */

	import { page } from '$app/stores';
	import * as m from '$paraglide/messages';

	interface Props {
		data: {
			status: number;
			error?: Error;
		};
	}

	let { data }: Props = $props();

	const errorMessages = {
		404: m.content_error_not_found(),
		401: m.org_error_unauthorized(),
		403: m.org_error_forbidden(),
		500: m.content_error_server()
	};

	const errorMessage = $derived(
		errorMessages[data.status as keyof typeof errorMessages] ?? m.org_error_unknown()
	);

	const errorDescription = $derived(() => {
		switch (data.status) {
			case 404:
				return m.org_error_not_found_description();
			case 401:
				return m.org_error_unauthorized_description();
			case 403:
				return m.org_error_forbidden_description();
			default:
				return m.org_error_server_error_description();
		}
	});
</script>

<div class="error-boundary">
	<div class="error-boundary__content">
		<div class="error-boundary__icon" aria-hidden="true">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="48"
				height="48"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<circle cx="12" cy="12" r="10"></circle>
				<line x1="12" y1="8" x2="12" y2="12"></line>
				<line x1="12" y1="16" x2="12.01" y2="16"></line>
			</svg>
		</div>

		<h1 class="error-boundary__title">{data.status}</h1>

		<p class="error-boundary__message">{errorMessage}</p>
		<p class="error-boundary__description">{errorDescription()}</p>

		<div class="error-boundary__actions">
			<a href="/library" class="error-boundary__button error-boundary__button--primary">
				{m.org_navigation_library()}
			</a>
			<a
				href={($page.url.pathname.split('/').slice(0, -2).join('/')) || '/'}
				class="error-boundary__button error-boundary__button--secondary"
			>
				{m.org_error_go_back()}
			</a>
		</div>
	</div>
</div>

<style>
	.error-boundary {
		display: flex;
		align-items: center;
		justify-content: center;
		min-block-size: 50vh;
		padding: var(--space-6);
	}

	.error-boundary__content {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		max-width: var(--size-content-md);
		gap: var(--space-4);
	}

	.error-boundary__icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--space-12);
		height: var(--space-12);
		color: var(--color-error-500);
		background: var(--color-error-50);
		border-radius: var(--radius-full);
	}

	.error-boundary__title {
		margin: 0;
		font-size: var(--text-6xl);
		font-weight: var(--font-bold);
		line-height: 1;
		color: var(--color-text);
	}

	.error-boundary__message {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: var(--font-semibold);
		color: var(--color-text);
	}

	.error-boundary__description {
		margin: 0;
		font-size: var(--text-base);
		color: var(--color-text-secondary);
	}

	.error-boundary__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		justify-content: center;
		margin-top: var(--space-2);
	}

	.error-boundary__button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-3) var(--space-5);
		font-size: var(--text-base);
		font-weight: var(--font-medium);
		text-decoration: none;
		border-radius: var(--radius-md);
		transition: background var(--duration-fast), color var(--duration-fast),
			border-color var(--duration-fast);
	}

	.error-boundary__button--primary {
		background: var(--color-primary-500);
		color: var(--color-text-on-primary);
	}

	.error-boundary__button--primary:hover {
		background: var(--color-primary-600);
	}

	.error-boundary__button--secondary {
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-border-default);
	}

	.error-boundary__button--secondary:hover {
		background: var(--color-neutral-50);
		border-color: var(--color-border-hover);
	}

	/* Dark mode */
	:global([data-theme='dark']) .error-boundary__icon {
		color: var(--color-error-400);
		background: var(--color-error-900);
	}

	:global([data-theme='dark']) .error-boundary__title,
	:global([data-theme='dark']) .error-boundary__message {
		color: var(--color-text-dark);
	}

	:global([data-theme='dark']) .error-boundary__description {
		color: var(--color-text-secondary-dark);
	}

	:global([data-theme='dark']) .error-boundary__button--primary {
		background: var(--color-primary-400);
		color: var(--color-text-on-primary-dark);
	}

	:global([data-theme='dark']) .error-boundary__button--primary:hover {
		background: var(--color-primary-500);
	}

	:global([data-theme='dark']) .error-boundary__button--secondary {
		background: var(--color-surface-dark);
		color: var(--color-text-dark);
		border-color: var(--color-border-dark);
	}

	:global([data-theme='dark']) .error-boundary__button--secondary:hover {
		background: var(--color-neutral-800);
		border-color: var(--color-border-hover-dark);
	}
</style>
