/**
 * Shared Tiptap extension configuration.
 *
 * CRITICAL: This file is the single source of truth for extensions used by
 * both the client-side editor and the server-side generateHTML() renderer.
 * If these diverge, content will render incorrectly.
 */

import type { Extensions } from '@tiptap/core';
import BubbleMenu from '@tiptap/extension-bubble-menu';
import CharacterCount from '@tiptap/extension-character-count';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import StarterKit from '@tiptap/starter-kit';
import {
  createSlashCommandsExtension,
  type SlashCommandRender,
} from './slash-commands.js';
import type { EditorExtensionOptions } from './types.js';

export interface FullExtensionOptions extends EditorExtensionOptions {
  /** Render function for slash command popup — only needed client-side */
  slashCommandRender?: SlashCommandRender;
  /** DOM element for the bubble menu — only needed client-side */
  bubbleMenuElement?: HTMLElement;
}

/**
 * Full extension set for article body editing.
 * Includes headings, code blocks, blockquotes, slash commands, and bubble menu.
 */
export function getFullExtensions(options?: FullExtensionOptions): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer nofollow' },
    }),
    Typography,
    ...(options?.placeholder
      ? [Placeholder.configure({ placeholder: options.placeholder })]
      : []),
    ...(options?.maxLength
      ? [CharacterCount.configure({ limit: options.maxLength })]
      : []),
    ...(options?.slashCommandRender
      ? [createSlashCommandsExtension(options.slashCommandRender)]
      : []),
    ...(options?.bubbleMenuElement
      ? [
          BubbleMenu.configure({
            element: options.bubbleMenuElement,
            shouldShow: ({ editor, state }) => {
              // Show on text selection, but not in code blocks or empty selections
              return !state.selection.empty && !editor.isActive('codeBlock');
            },
          }),
        ]
      : []),
  ];
}

/**
 * Minimal extension set for short rich-text fields (descriptions).
 * Bold, italic, links, and lists only — no headings, code blocks, or slash commands.
 */
export function getMinimalExtensions(
  options?: EditorExtensionOptions
): Extensions {
  return [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      blockquote: false,
      horizontalRule: false,
      code: false,
      strike: false,
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer nofollow' },
    }),
    Typography,
    ...(options?.placeholder
      ? [Placeholder.configure({ placeholder: options.placeholder })]
      : []),
    ...(options?.maxLength
      ? [CharacterCount.configure({ limit: options.maxLength })]
      : []),
  ];
}

/**
 * Get extensions for server-side HTML rendering.
 * Omits client-only extensions (Placeholder, CharacterCount, BubbleMenu,
 * SlashCommands) that have no rendering output.
 */
export function getRenderExtensions(
  preset: 'full' | 'minimal' = 'full'
): Extensions {
  if (preset === 'minimal') {
    return [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        code: false,
        strike: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow' },
      }),
    ];
  }

  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer nofollow' },
    }),
  ];
}
