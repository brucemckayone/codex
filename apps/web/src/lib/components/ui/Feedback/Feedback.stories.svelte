<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { writable } from 'svelte/store';
  import { logger } from '$lib/observability';
  import Button from '../Button/Button.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import ErrorBanner from './ErrorBanner.svelte';
  import ErrorBoundary from './ErrorBoundary/ErrorBoundary.svelte';
  import ErrorTrigger from './ErrorBoundary/ErrorTrigger.svelte';

  const { Story } = defineMeta({
    title: 'UI/Feedback',
    tags: ['autodocs'],
  });

  // Create stores for dialog state
  const deleteOpen = writable(false);
  const saveOpen = writable(false);

  // Create stores for error boundary demos
  const errorTrigger1 = writable(false);
  const errorTrigger2 = writable(false);
  const errorTrigger3 = writable(false);
</script>

<!-- ConfirmDialog Stories -->
<Story name="Confirm Dialog - Delete">
  <Button variant="destructive" onclick={() => $deleteOpen = true}>Delete Item</Button>
  <ConfirmDialog
    bind:open={$deleteOpen}
    title="Delete Item?"
    description="This action cannot be undone. The item will be permanently removed."
    confirmText="Delete"
    variant="destructive"
    onConfirm={() => logger.info('Deleted!')}
  />
</Story>

<Story name="Confirm Dialog - Save">
  <Button onclick={() => $saveOpen = true}>Save Changes</Button>
  <ConfirmDialog
    bind:open={$saveOpen}
    title="Save Changes?"
    description="Your changes will be saved and published immediately."
    confirmText="Save"
    variant="primary"
    onConfirm={() => logger.info('Saved!')}
  />
</Story>

<!-- ErrorBanner Stories -->
<Story name="Error Banner - Simple">
  <div style="max-width: 500px;">
    <ErrorBanner
      title="Something went wrong"
      description="We couldn't complete your request. Please try again later."
    />
  </div>
</Story>

<Story name="Error Banner - With Action">
  <div style="max-width: 500px;">
    <ErrorBanner
      title="Payment Failed"
      description="Your payment could not be processed. Please check your payment details and try again."
    >
      <Button variant="primary" size="sm">Retry Payment</Button>
    </ErrorBanner>
  </div>
</Story>

<Story name="Error Banner - Form Validation">
  <div style="max-width: 500px;">
    <ErrorBanner
      title="Form Errors"
      description="Please correct the following errors before submitting:"
    >
      <ul style="margin: 0.5rem 0 0 1rem; padding: 0; font-size: 0.875rem;">
        <li>Email is required</li>
        <li>Password must be at least 8 characters</li>
      </ul>
    </ErrorBanner>
  </div>
</Story>

<!-- ErrorBoundary Stories -->
<Story name="Error Boundary - Default">
  <div style="max-width: 500px;">
    <Button
      variant="destructive"
      onclick={() => $errorTrigger1 = true}
    >
      Trigger Error
    </Button>
    <ErrorBoundary onreset={() => $errorTrigger1 = false}>
      <ErrorTrigger shouldError={$errorTrigger1} message="Test error triggered!" />
    </ErrorBoundary>
  </div>
</Story>

<Story name="Error Boundary - Custom Fallback">
  <div style="max-width: 500px;">
    <Button
      variant="destructive"
      onclick={() => $errorTrigger2 = true}
    >
      Trigger Custom Error
    </Button>
    <ErrorBoundary>
      {#snippet fallback(error, reset)}
        <div style="padding: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 0.5rem;">
          <h3 style="margin: 0 0 0.5rem 0; color: #991b1b;">Custom Error Handler</h3>
          <p style="margin: 0; font-size: 0.875rem; color: #7f1d1d;">
            Error: {error.message}
          </p>
          <Button
            variant="primary"
            size="sm"
            onclick={() => {
              $errorTrigger2 = false;
              reset();
            }}
            style="margin-top: 0.5rem;"
          >
            Reset
          </Button>
        </div>
      {/snippet}
      <ErrorTrigger shouldError={$errorTrigger2} message="Custom fallback error!" />
    </ErrorBoundary>
  </div>
</Story>

<Story name="Error Boundary - Protecting Content">
  <div style="max-width: 500px;">
    <p>This content is safe and renders normally.</p>
    <ErrorBoundary onreset={() => $errorTrigger3 = false}>
      <div style="padding: 1rem; background: #f5f5f5; border-radius: 0.5rem; margin: 1rem 0;">
        <p style="margin: 0 0 0.5rem 0;">This section is protected by an error boundary.</p>
        <Button
          variant="destructive"
          size="sm"
          onclick={() => $errorTrigger3 = true}
        >
          Break This Section
        </Button>
        <ErrorTrigger shouldError={$errorTrigger3} message="Component crashed!" />
      </div>
    </ErrorBoundary>
    <p style="margin-top: 1rem;">This content stays intact even if the section above crashes.</p>
  </div>
</Story>
