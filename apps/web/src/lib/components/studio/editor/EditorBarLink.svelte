<!--
  @component EditorBarLink

  A link in the editor's bars (Codex-a6ofh.2.3, mockups W2/W4/W5b): an icon
  and its words. The way out of the editor by default, with an arrow back;
  "Preview as a visitor" with an eye (Codex-a6ofh.2.11). On a phone (W8a)
  the words are heard but not shown, as the bar has no room for them. The
  Write and Publish bars, a live piece's and the preview's share it.

  @prop {string} href - Where it goes
  @prop {string} label - What it says
  @prop {Component} [icon] - Its picture: an arrow back unless given
-->
<script lang="ts">
  import type { Component } from 'svelte';
  import { ArrowLeftIcon } from '$lib/components/ui/Icon';

  interface Props {
    href: string;
    label: string;
    icon?: Component<{ size?: number }>;
  }

  const { href, label, icon: Icon = ArrowLeftIcon }: Props = $props();
</script>

<a class="editor-bar-link" {href}>
  <Icon size={16} />
  <span class="editor-bar-link-label">{label}</span>
</a>

<style>
  .editor-bar-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    white-space: nowrap;
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .editor-bar-link:hover {
    color: var(--color-text);
  }

  .editor-bar-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  @media (--below-md) {
    .editor-bar-link-label {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
</style>
