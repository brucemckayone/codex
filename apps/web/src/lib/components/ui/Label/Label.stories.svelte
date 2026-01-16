<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Label } from './index';

  const { Story } = defineMeta({
    title: 'UI/Label',
    component: Label,
    tags: ['autodocs'],
  });
</script>

<Story name="Default">
  <Label>Email Address</Label>
</Story>

<Story name="With For Attribute">
  <Label for="email-input">Email Address</Label>
  <input id="email-input" type="email" style="margin-top: 0.5rem; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px;" />
</Story>

<Story name="Form Labels">
  <div style="display: flex; flex-direction: column; gap: 1rem;">
    <div>
      <Label for="name">Full Name</Label>
      <input id="name" style="margin-top: 0.25rem; display: block; width: 200px; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px;" />
    </div>
    <div>
      <Label for="email">Email</Label>
      <input id="email" type="email" style="margin-top: 0.25rem; display: block; width: 200px; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px;" />
    </div>
  </div>
</Story>
