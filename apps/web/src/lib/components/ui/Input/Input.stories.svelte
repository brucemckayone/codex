<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Input } from './index';

  const { Story } = defineMeta({
    title: 'UI/Input',
    component: Input,
    tags: ['autodocs'],
    argTypes: {
      type: {
        control: 'select',
        options: ['text', 'email', 'password', 'number', 'tel', 'url'],
        description: 'Input type',
      },
      placeholder: {
        control: 'text',
        description: 'Placeholder text',
      },
      error: {
        control: 'text',
        description: 'Error message',
      },
      disabled: {
        control: 'boolean',
        description: 'Disable the input',
      },
    },
  });
</script>

<Story name="Default" args={{ placeholder: 'Enter text...' }}>
  <Input placeholder="Enter text..." />
</Story>

<Story name="With Value" args={{ value: 'Hello World' }}>
  <Input value="Hello World" />
</Story>

<Story name="Email" args={{ type: 'email', placeholder: 'email@example.com' }}>
  <Input type="email" placeholder="email@example.com" />
</Story>

<Story name="Password" args={{ type: 'password', placeholder: 'Enter password' }}>
  <Input type="password" placeholder="Enter password" />
</Story>

<Story name="Number" args={{ type: 'number', placeholder: '0' }}>
  <Input type="number" placeholder="0" />
</Story>

<Story name="With Error" args={{ error: 'This field is required', placeholder: 'Enter text...' }}>
  <Input placeholder="Enter text..." error="This field is required" />
</Story>

<Story name="Disabled" args={{ disabled: true, placeholder: 'Disabled input' }}>
  <Input placeholder="Disabled input" disabled />
</Story>

<Story name="Form Example">
  <div style="display: flex; flex-direction: column; gap: 1rem; max-width: 300px;">
    <div style="display: flex; flex-direction: column; gap: 0.25rem;">
      <label style="font-size: 0.875rem; font-weight: 500;">Email</label>
      <Input type="email" placeholder="you@example.com" />
    </div>
    <div style="display: flex; flex-direction: column; gap: 0.25rem;">
      <label style="font-size: 0.875rem; font-weight: 500;">Password</label>
      <Input type="password" placeholder="Enter password" />
    </div>
    <div style="display: flex; flex-direction: column; gap: 0.25rem;">
      <label style="font-size: 0.875rem; font-weight: 500;">Username</label>
      <Input placeholder="username" error="Username is already taken" />
    </div>
  </div>
</Story>
