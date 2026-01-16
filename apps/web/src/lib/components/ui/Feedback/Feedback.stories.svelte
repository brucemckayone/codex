<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Button from '../Button/Button.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import ErrorBanner from './ErrorBanner.svelte';

  const { Story } = defineMeta({
    title: 'UI/Feedback',
    tags: ['autodocs'],
  });
</script>

<script>
  const deleteOpen = $state(false);
  const saveOpen = $state(false);
</script>

<!-- ConfirmDialog Stories -->
<Story name="Confirm Dialog - Delete">
  <Button variant="destructive" onclick={() => deleteOpen = true}>Delete Item</Button>
  <ConfirmDialog
    bind:open={deleteOpen}
    title="Delete Item?"
    description="This action cannot be undone. The item will be permanently removed."
    confirmText="Delete"
    variant="destructive"
    onConfirm={() => console.log('Deleted!')}
  />
</Story>

<Story name="Confirm Dialog - Save">
  <Button onclick={() => saveOpen = true}>Save Changes</Button>
  <ConfirmDialog
    bind:open={saveOpen}
    title="Save Changes?"
    description="Your changes will be saved and published immediately."
    confirmText="Save"
    variant="primary"
    onConfirm={() => console.log('Saved!')}
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
