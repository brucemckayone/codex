<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { writable } from 'svelte/store';
  import * as Tabs from './index';

  const { Story } = defineMeta({
    title: 'UI/Tabs',
    tags: ['autodocs'],
  });

  // State stores for reactive tab values
  const defaultTab = writable<string | undefined>('account');
  const contentTab = writable<string | undefined>('overview');
</script>

<Story name="Default">
  <div style="max-width: 500px;">
    <Tabs.Root defaultValue="account" bind:value={$defaultTab}>
      <Tabs.List>
        <Tabs.Trigger value="account">Account</Tabs.Trigger>
        <Tabs.Trigger value="password">Password</Tabs.Trigger>
        <Tabs.Trigger value="notifications">Notifications</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="account">
        <div style="padding: 1rem 0;">
          <h4 style="margin-bottom: 0.5rem; color: var(--color-text);">Account Settings</h4>
          <p style="color: var(--color-text-secondary);">Manage your account information and preferences.</p>
        </div>
      </Tabs.Content>
      <Tabs.Content value="password">
        <div style="padding: 1rem 0;">
          <h4 style="margin-bottom: 0.5rem; color: var(--color-text);">Password</h4>
          <p style="color: var(--color-text-secondary);">Change your password and security settings.</p>
        </div>
      </Tabs.Content>
      <Tabs.Content value="notifications">
        <div style="padding: 1rem 0;">
          <h4 style="margin-bottom: 0.5rem; color: var(--color-text);">Notifications</h4>
          <p style="color: var(--color-text-secondary);">Configure how and when you receive notifications.</p>
        </div>
      </Tabs.Content>
    </Tabs.Root>
  </div>
</Story>

<Story name="Content Tabs">
  <div style="max-width: 600px;">
    <Tabs.Root defaultValue="overview" bind:value={$contentTab}>
      <Tabs.List>
        <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
        <Tabs.Trigger value="analytics">Analytics</Tabs.Trigger>
        <Tabs.Trigger value="settings">Settings</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="overview">
        <div style="padding: 1.5rem; background: var(--color-surface-secondary); border-radius: 8px; margin-top: 0.5rem;">
          <h3 style="margin-bottom: 1rem; color: var(--color-text);">Content Overview</h3>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;">
            <div style="padding: 1rem; background: var(--color-surface); border-radius: 8px; text-align: center;">
              <div style="font-size: 1.5rem; font-weight: bold; color: var(--color-text);">42</div>
              <div style="font-size: 0.875rem; color: var(--color-text-secondary);">Total Views</div>
            </div>
            <div style="padding: 1rem; background: var(--color-surface); border-radius: 8px; text-align: center;">
              <div style="font-size: 1.5rem; font-weight: bold; color: var(--color-text);">12</div>
              <div style="font-size: 0.875rem; color: var(--color-text-secondary);">Purchases</div>
            </div>
            <div style="padding: 1rem; background: var(--color-surface); border-radius: 8px; text-align: center;">
              <div style="font-size: 1.5rem; font-weight: bold; color: var(--color-text);">$240</div>
              <div style="font-size: 0.875rem; color: var(--color-text-secondary);">Revenue</div>
            </div>
          </div>
        </div>
      </Tabs.Content>
      <Tabs.Content value="analytics">
        <div style="padding: 1.5rem; background: var(--color-surface-secondary); border-radius: 8px; margin-top: 0.5rem;">
          <h3 style="color: var(--color-text);">Analytics Dashboard</h3>
          <p style="color: var(--color-text-secondary);">Detailed analytics would appear here.</p>
        </div>
      </Tabs.Content>
      <Tabs.Content value="settings">
        <div style="padding: 1.5rem; background: var(--color-surface-secondary); border-radius: 8px; margin-top: 0.5rem;">
          <h3 style="color: var(--color-text);">Content Settings</h3>
          <p style="color: var(--color-text-secondary);">Configure your content settings here.</p>
        </div>
      </Tabs.Content>
    </Tabs.Root>
  </div>
</Story>
