/**
 * Inline text editing on the canvas without the store fighting the caret
 * (docs/design/landing-builder/02-kit-foundation.md, the WP-7b note).
 *
 * Every keystroke still commits through the kit's seam, so undo, autosave and
 * crash recovery see it live. What changes is what the canvas RENDERS while a
 * field is focused: that one field is pinned to its value at focus time, so
 * Svelte never writes into the node the caret is in.
 *
 * On blur, the browser's own edits to that subtree are rolled back to exactly
 * the nodes Svelte built, and only then is the pin released — so Svelte
 * re-renders the field from the store onto nodes it still owns. Without the
 * rollback, a paragraph typed with Enter would be the browser's `<p>`, and the
 * next render would add Svelte's copy beside it.
 */
import { flushSync } from 'svelte';
import {
  fieldOf,
  isSectionTypeId,
  type KitPage,
  type PageEdit,
} from '$lib/page-builder/kit';

export interface InlineField {
  element: HTMLElement;
  sectionId: string;
  key: string;
  type: string;
}

interface Pin {
  sectionId: string;
  key: string;
  had: boolean;
  value: unknown;
}

interface DomSnapshot {
  children: Map<Node, Node[]>;
  texts: Map<Text, string>;
}

function snapshotDom(root: Node): DomSnapshot {
  const children = new Map<Node, Node[]>();
  const texts = new Map<Text, string>();
  const walk = (node: Node) => {
    if (node instanceof Text) {
      texts.set(node, node.data);
      return;
    }
    const kids = Array.from(node.childNodes);
    children.set(node, kids);
    for (const kid of kids) walk(kid);
  };
  walk(root);
  return { children, texts };
}

/** Parents first (the map is in walk order), then every text node's data. */
function restoreDom(snapshot: DomSnapshot): void {
  for (const [parent, kids] of snapshot.children) {
    if (parent instanceof Element) parent.replaceChildren(...kids);
  }
  for (const [text, data] of snapshot.texts) {
    if (text.data !== data) text.data = data;
  }
}

/** The canvas field an event came from, or null when it came from anywhere else. */
export function fieldFrom(target: EventTarget | null): InlineField | null {
  if (!(target instanceof HTMLElement)) return null;
  const element = target.closest<HTMLElement>('[data-field]');
  const section = element?.closest<HTMLElement>('[data-lp-section]');
  const key = element?.dataset.field;
  const sectionId = section?.dataset.lpSection;
  const type = section?.dataset.lpType;
  if (!element?.isContentEditable || !key || !sectionId || !type) return null;
  return { element, sectionId, key, type };
}

/** Paragraph fields take Enter; every other field is one line. */
export function isMultiline(type: string, key: string): boolean {
  return isSectionTypeId(type) && fieldOf(type, key)?.control === 'textarea';
}

export interface InlineEditing {
  /** The seam handed to `PageRenderer`. */
  readonly edit: PageEdit;
  readonly active: boolean;
  begin(field: InlineField): void;
  end(): void;
  /** The page to render: `page`, with the focused field pinned. */
  render(page: KitPage): KitPage;
}

export function createInlineEditing(deps: {
  read(sectionId: string, key: string): { had: boolean; value: unknown };
  commit(sectionId: string, key: string, value: string): void;
}): InlineEditing {
  let pin = $state<Pin | null>(null);
  let snapshot: DomSnapshot | null = null;

  function end(): void {
    if (!pin) return;
    if (snapshot) restoreDom(snapshot);
    snapshot = null;
    pin = null;
    // Re-render from the store now, onto the restored nodes, before paint.
    flushSync();
  }

  function begin(field: InlineField): void {
    if (pin?.sectionId === field.sectionId && pin.key === field.key) return;
    end();
    pin = {
      sectionId: field.sectionId,
      key: field.key,
      ...deps.read(field.sectionId, field.key),
    };
    snapshot = snapshotDom(field.element);
  }

  function render(page: KitPage): KitPage {
    const current = pin;
    if (!current) return page;
    return {
      ...page,
      sections: page.sections.map((section) => {
        if (section.id !== current.sectionId) return section;
        const props = { ...section.props };
        if (current.had) props[current.key] = current.value;
        else delete props[current.key];
        return { ...section, props };
      }),
    };
  }

  return {
    edit: { commit: deps.commit },
    get active() {
      return pin !== null;
    },
    begin,
    end,
    render,
  };
}
