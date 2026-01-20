<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import TextArea from './TextArea.svelte';

  const { Story } = defineMeta({
    title: 'UI/TextArea',
    component: TextArea,
    tags: ['autodocs'],
    argTypes: {
      placeholder: {
        control: 'text',
        description: 'Placeholder text',
      },
      autoResize: {
        control: 'boolean',
        description: 'Auto-resize based on content',
      },
      disabled: {
        control: 'boolean',
        description: 'Disable the textarea',
      },
    },
  });
</script>

<Story name="Default" args={{ placeholder: 'Enter your message...' }}>
  <div style="max-width: 400px;">
    <TextArea placeholder="Enter your message..." />
  </div>
</Story>

<Story name="With Value" args={{ value: 'This is some example text content that demonstrates how the TextArea component looks with a value.' }}>
  <div style="max-width: 400px;">
    <TextArea value="This is some example text content that demonstrates how the TextArea component looks with a value." />
  </div>
</Story>

<Story name="Disabled" args={{ placeholder: 'Disabled textarea', disabled: true }}>
  <div style="max-width: 400px;">
    <TextArea placeholder="Disabled textarea" disabled />
  </div>
</Story>

<Story name="Fixed Height (No Auto Resize)" args={{ placeholder: 'Fixed height textarea...', autoResize: false }}>
  <div style="max-width: 400px;">
    <TextArea placeholder="Fixed height textarea..." autoResize={false} />
  </div>
</Story>

<Story name="Form Example">
  <div style="display: flex; flex-direction: column; gap: 0.5rem; max-width: 400px;">
    <label for="description-textarea" style="font-size: 0.875rem; font-weight: 500;">Description</label>
    <TextArea id="description-textarea" placeholder="Describe your content..." rows={4} />
    <span style="font-size: 0.75rem; color: #666;">Minimum 50 characters</span>
  </div>
</Story>
