/**
 * Slash commands extension for Tiptap.
 *
 * Type "/" on an empty line to open a command menu with block types.
 * Uses @tiptap/suggestion under the hood.
 */

import type { Editor, Range } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Suggestion, type SuggestionOptions } from '@tiptap/suggestion';

export interface SlashCommandItem {
  title: string;
  description: string;
  icon: string;
  command: (editor: Editor, range: Range) => void;
}

/** Available slash command items for the full preset */
const SLASH_COMMAND_ITEMS: SlashCommandItem[] = [
  {
    title: 'Heading 1',
    description: 'Large section heading',
    icon: 'H1',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run();
    },
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    icon: 'H2',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run();
    },
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    icon: 'H3',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run();
    },
  },
  {
    title: 'Bullet List',
    description: 'Unordered list with bullets',
    icon: 'list',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: 'Numbered List',
    description: 'Ordered list with numbers',
    icon: 'list-ordered',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: 'Blockquote',
    description: 'Highlight a quote or excerpt',
    icon: 'quote',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: 'Code Block',
    description: 'Display code with formatting',
    icon: 'code',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    title: 'Divider',
    description: 'Visual separator between sections',
    icon: 'divider',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
];

/**
 * Filter items based on user's query (text typed after "/").
 */
function filterItems(query: string): SlashCommandItem[] {
  if (!query) return SLASH_COMMAND_ITEMS;
  const lower = query.toLowerCase();
  return SLASH_COMMAND_ITEMS.filter(
    (item) =>
      item.title.toLowerCase().includes(lower) ||
      item.description.toLowerCase().includes(lower)
  );
}

export type SlashCommandRender = SuggestionOptions<SlashCommandItem>['render'];

/**
 * Create the slash commands extension.
 * The `render` function is injected by the component that mounts the UI.
 */
export function createSlashCommandsExtension(render: SlashCommandRender) {
  return Extension.create({
    name: 'slashCommands',

    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommandItem>({
          editor: this.editor,
          char: '/',
          allowSpaces: false,
          startOfLine: false,
          items: ({ query }) => filterItems(query),
          command: ({ editor, range, props }) => {
            props.command(editor, range);
          },
          render,
        }),
      ];
    },
  });
}
