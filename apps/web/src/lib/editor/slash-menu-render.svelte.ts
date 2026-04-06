/**
 * Svelte 5 render bridge for the slash commands suggestion plugin.
 *
 * Tiptap's suggestion utility calls render().onStart/onUpdate/onKeyDown/onExit
 * to manage a floating popup. This file bridges those lifecycle hooks to a
 * Svelte 5 component using mount() / unmount().
 */

import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
} from '@tiptap/suggestion';
import { mount, unmount } from 'svelte';
import SlashMenu from '../components/editor/SlashMenu.svelte';
import type { SlashCommandItem } from './slash-commands.js';

interface SlashMenuInstance {
  handleKeyDown: (e: KeyboardEvent) => boolean;
}

export function createSlashMenuRender(): NonNullable<
  SuggestionOptions<SlashCommandItem>['render']
> {
  let container: HTMLDivElement | null = null;
  let component: Record<string, unknown> | null = null;
  let instance: SlashMenuInstance | null = null;

  function updatePosition(clientRect: (() => DOMRect | null) | null) {
    if (!container || !clientRect) return;
    const rect = clientRect();
    if (!rect) return;
    // clientRect() returns viewport-relative coordinates, but the container
    // is absolutely positioned relative to the document body — add scroll
    // offset to convert viewport → document coordinates.
    container.style.left = `${rect.left + window.scrollX}px`;
    container.style.top = `${rect.bottom + 8 + window.scrollY}px`;
  }

  function cleanup() {
    if (component && container) {
      unmount(component);
      component = null;
      instance = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
  }

  return () => ({
    onStart(props) {
      container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.zIndex = '50';
      document.body.appendChild(container);

      const mounted = mount(SlashMenu, {
        target: container,
        props: {
          items: props.items,
          onselect: (item: SlashCommandItem) => props.command(item),
        },
      });

      component = mounted;
      instance = mounted as unknown as SlashMenuInstance;
      updatePosition(props.clientRect);
    },

    onUpdate(props) {
      if (component) {
        // Svelte 5 mount() returns a proxy — set props directly
        (component as Record<string, unknown>).items = props.items;
        (component as Record<string, unknown>).onselect = (
          item: SlashCommandItem
        ) => props.command(item);
      }
      updatePosition(props.clientRect);
    },

    onKeyDown(props: SuggestionKeyDownProps) {
      if (props.event.key === 'Escape') {
        cleanup();
        return true;
      }
      return instance?.handleKeyDown(props.event) ?? false;
    },

    onExit() {
      cleanup();
    },
  });
}
