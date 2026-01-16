<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Button from '../Button/Button.svelte';
  import Toaster from './Toaster.svelte';
  import { toast } from './toast-store';

  const { Story } = defineMeta({
    title: 'UI/Toast',
    tags: ['autodocs'],
  });
</script>

<Story name="Success Toast">
  <Toaster />
  <Button onclick={() => toast.success('Success!', 'Your changes have been saved.')}>
    Show Success Toast
  </Button>
</Story>

<Story name="Error Toast">
  <Toaster />
  <Button variant="destructive" onclick={() => toast.error('Error', 'Something went wrong. Please try again.')}>
    Show Error Toast
  </Button>
</Story>

<Story name="Warning Toast">
  <Toaster />
  <Button variant="secondary" onclick={() => toast.warning('Warning', 'This action cannot be undone.')}>
    Show Warning Toast
  </Button>
</Story>

<Story name="Info Toast">
  <Toaster />
  <Button variant="ghost" onclick={() => toast.info('Info', 'Here is some helpful information.')}>
    Show Info Toast
  </Button>
</Story>

<Story name="All Variants">
  <Toaster />
  <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
    <Button onclick={() => toast.success('Success', 'Operation completed successfully.')}>Success</Button>
    <Button variant="destructive" onclick={() => toast.error('Error', 'An error occurred.')}>Error</Button>
    <Button variant="secondary" onclick={() => toast.warning('Warning', 'Please review before continuing.')}>Warning</Button>
    <Button variant="ghost" onclick={() => toast.info('Info', 'New updates available.')}>Info</Button>
  </div>
</Story>
