/**
 * The studio canvas's INLINE-EDIT SEAM, in one place (F38).
 *
 * The canvas is WYSIWYG: a creator types the copy that has to sell their course
 * directly into the rendered section, through a `contenteditable` layered onto the
 * real text node. That seam used to be an eleven-times-copied attribute bag — one
 * per section component, byte-identical in all eleven — which is exactly how three
 * defects reached all eleven at once and stayed there:
 *
 *  1. `spellcheck="false"` on the primary copywriting surface of a SALES page.
 *  2. NO `onpaste`, so a `contenteditable` took a paste as RICH HTML by default: a
 *     paragraph pasted out of a word processor injected `<span style>`, `<b>`,
 *     fonts — sometimes whole tables — into a DOM whose text the store reads back
 *     as a PLAIN STRING. The canvas showed the markup, the store received flattened
 *     text, and what shipped to the public page was whichever one won the round
 *     trip. That is a data-integrity defect as much as a UX one.
 *  3. NO `role` and NO accessible name, so a screen-reader user was told "heading",
 *     never "editable", and never which of the section's fields the caret was in.
 *
 * ONE SEAM, NOT ELEVEN. Each section keeps a three-line local `editAttrs` wrapper
 * so its ~50 call sites are untouched and so `editable`/`onEdit` are read inside
 * the component's own reactive scope; the bag itself is built here.
 *
 * WHY AN ATTRIBUTE BAG AND NOT A SVELTE ACTION. Actions do not run during SSR, and
 * `contenteditable` has to be an ATTRIBUTE on a node whose text is already a real
 * child — the deleted `render-edit/EditableText.svelte` rendered an EMPTY element
 * and filled `textContent` from an action, which on the public page would have
 * served `<h1></h1>` and painted the headline in only after hydration. The canvas
 * never noticed, because the studio is `ssr = false`. A spread bag also means the
 * `role` below is invisible to Svelte's static a11y analysis, which is correct here
 * and would otherwise fire `a11y_no_noninteractive_element_to_interactive_role` on
 * eleven `<h2>`s that only ever carry the role in the studio.
 *
 * PUBLIC-BUNDLE SAFE, and that constraint shapes the label register below. This
 * module sits under the CE-4-scanned `PUBLIC_LIB_ROOT` (`$lib/page-builder`), so it
 * MUST NOT import `$lib/components/page-builder` — including
 * `section-fields.ts`, which is where the editor's own authoritative field labels
 * live. `apps/web/scripts/check-brand-editor-boundary.mjs` fails CI on exactly that
 * import, and it scans `.ts` files here, tests included. So the labels are restated
 * here, deliberately, and the allowed import direction (editor UI may import the
 * public tree, never the reverse) is what a round-trip guard would use to pin the
 * two together — see the handoff on {@link editFieldLabel}.
 */
import type { HTMLAttributes } from 'svelte/elements';
import { findSectionDefinition } from '../section-catalog';

/** What a section's `onEdit` prop accepts: one `props` key, one plain string. */
export type EditFieldCommit = (key: string, value: string) => void;

/**
 * Field labels shared across section types, keyed by the `PageSection.props` key
 * the seam writes.
 *
 * The strings match `$lib/components/page-builder/section-fields.ts` — the same
 * words the author reads on the control in the inspector, so the screen-reader name
 * and the visible form label agree. Legacy alias keys resolve to the label of the
 * key they alias (`SECTION_PROP_ALIASES` in `./coerce.ts`), because a page that
 * stores `statement` is storing a heading and the author is shown "Heading".
 *
 * INLINE ENGLISH, not paraglide, by the same contract (A20) that keeps
 * `section-catalog.ts`'s labels inline: the section half of the name below comes
 * from that catalogue, and a translated field label bolted onto an untranslated
 * section label is a worse string than a consistent English one. Keying the whole
 * builder vocabulary is its own refactor, and it has to move both halves together.
 */
const SHARED_FIELD_LABELS: Readonly<Record<string, string>> = {
  accent: 'Accent line',
  bio: 'Bio',
  body: 'Body',
  clip: 'On-frame label',
  eyebrow: 'Eyebrow',
  felt: 'Emphasis line',
  from: 'From',
  heading: 'Heading',
  headline: 'Headline',
  kicker: 'Kicker',
  // `lede` aliases `body`, `statement` aliases `heading`, `tag` aliases `clip`.
  lede: 'Body',
  name: 'Name',
  note: 'Closing note',
  quote: 'Pull-quote',
  risk: 'Risk-reversal',
  role: 'Role / eyebrow',
  statement: 'Heading',
  sub: 'Sub-line',
  tag: 'On-frame label',
  to: 'To',
  trust: 'Trust line',
};

/**
 * Per-type labels, for the keys whose meaning genuinely differs by section.
 *
 * `q1` is a QUESTION in the FAQ and a QUOTE in the proof section — the same key,
 * two vocabularies — so a single flat map could only ever be right for one of them.
 * That is the whole reason the seam takes the section type as well as the key.
 */
const TYPE_FIELD_LABELS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  faq: { a: 'Answer', q: 'Question' },
  guide: { body: 'Bio', name: 'Guide name' },
  hero: { accent: 'Accent ending' },
  proof: { c: 'Context', n: 'Name', q: 'Quote' },
};

/** `q3` → `['q', '3']`; anything else → `[key, '']`. */
function splitNumberedKey(key: string): readonly [string, string] {
  const match = /^([A-Za-z]+)(\d+)$/.exec(key);
  return match ? [match[1], match[2]] : [key, ''];
}

/**
 * A key no register declares, made readable rather than announced raw:
 * `previewSub` → "Preview sub". A section that grows a field before this map does
 * still gets a usable name, which is the point — the fallback must never be the
 * empty string, because `role="textbox"` with no accessible name is the defect this
 * seam exists to close.
 */
function humaniseKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The human label for one editable field of one section type.
 *
 * Exported so a round-trip guard can pin it against the editor's own
 * `SECTION_FIELDS` labels. That test belongs in
 * `components/page-builder/section-fields.test.ts` (the editor side may import the
 * public tree; this module may not import the editor), which is why it is not here.
 */
export function editFieldLabel(type: string, key: string): string {
  const perType = TYPE_FIELD_LABELS[type];
  const direct = perType?.[key] ?? SHARED_FIELD_LABELS[key];
  if (direct) return direct;

  const [base, index] = splitNumberedKey(key);
  if (index) {
    const baseLabel =
      perType?.[base] ?? SHARED_FIELD_LABELS[base] ?? humaniseKey(base);
    return `${baseLabel} ${index}`;
  }
  return humaniseKey(key);
}

/**
 * The accessible name for one editable field: which section, then which field.
 *
 * The section half comes from the catalogue the studio itself draws the rail from
 * (`Hero`, `The ache`, `Intro video`), so the name a screen reader reads is the name
 * on screen. An unknown type degrades to the raw type rather than dropping the
 * qualifier, because "Heading" alone on a page of eleven sections names nothing.
 */
export function editFieldName(type: string, key: string): string {
  const label = findSectionDefinition(type)?.label ?? type;
  return `${label} — ${editFieldLabel(type, key)}`;
}

/**
 * Insert plain text at the caret, by hand.
 *
 * The FALLBACK path only — `document.execCommand('insertText')` is what runs in
 * every browser that has it, because it keeps the browser's own UNDO STACK intact
 * (a hand-built insertion is not undoable with ⌘Z) and it fires the one `input`
 * event that writes the store. This exists for the environments that do not have
 * it, jsdom included, and so the seam is never silently a no-op.
 *
 * With no caret inside this field — a programmatic paste, or a selection that has
 * wandered out of it — the text is APPENDED rather than dropped somewhere guessed.
 */
function insertTextAtCaret(el: HTMLElement, text: string): void {
  const doc = el.ownerDocument;
  const selection = doc.defaultView?.getSelection?.() ?? null;
  const range =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const node = doc.createTextNode(text);

  if (!range || !el.contains(range.commonAncestorContainer)) {
    el.appendChild(node);
    return;
  }

  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Take a paste as PLAIN TEXT, and make it produce exactly ONE store update.
 *
 * `oninput` below is the seam's only writer, and both paths here go through it:
 * `execCommand('insertText')` fires a native `input` event, and the manual fallback
 * dispatches one. So a paste costs one `onEdit` call, the same as a keystroke, and
 * this handler never calls `onEdit` itself — which is what stops the two paths
 * double-writing.
 *
 * AN UNUSABLE CLIPBOARD LEAVES THE FIELD ALONE. `preventDefault()` runs first and
 * unconditionally, so markup can never reach the DOM; if the payload carries no
 * `text/plain` at all (an image, or an HTML-only source) there is nothing to insert
 * and the field keeps what it had, unmarked-dirty. Refusing the paste is the safe
 * failure here — the alternative is the injection this whole handler exists to stop.
 */
function pastePlainText(event: ClipboardEvent): void {
  // FIRST, and whatever happens next: the default action is a rich-HTML insert.
  event.preventDefault();

  const el = event.currentTarget as HTMLElement | null;
  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (!el || text.length === 0) return;

  const doc = el.ownerDocument;
  if (
    typeof doc.execCommand === 'function' &&
    doc.execCommand('insertText', false, text)
  ) {
    return;
  }

  insertTextAtCaret(el, text);
  el.dispatchEvent(
    typeof InputEvent === 'function'
      ? new InputEvent('input', { bubbles: true })
      : new Event('input', { bubbles: true })
  );
}

/**
 * The inline-edit attribute bag for one field, or NOTHING when the surface is not
 * the studio canvas.
 *
 * `{}` when `editable` is false is load-bearing: the PUBLIC markup must be
 * byte-identical to having no seam at all, so no `role`, no `aria-label` and no
 * `contenteditable` ever reaches a visitor's page.
 *
 * `spellcheck: 'true'` is EXPLICIT, not left to the inherited default, because the
 * value it replaces was an explicit `'false'` and a future reader deserves to see
 * that the switch was thrown on purpose. The likely original reason — no red
 * squiggles on a surface that looks like a preview — is answered by the surface
 * being an EDITOR, which is the entire point of the inline canvas: this is where a
 * creator writes the prose that has to sell their course.
 *
 * NO FIELD IS EXEMPT, and two were considered. `guide.name` and `proof.n1…n3` hold
 * PROPER NOUNS, which a spellchecker will underline; that is not a reason to switch
 * it off. The house precedent is that spellcheck is disabled only for MACHINE
 * TOKENS — a hex code (`brand-editor/color-picker/ColorInput.svelte:98`) and a
 * type-DELETE-to-confirm box (`account/+page.svelte:79`) — and every key this seam
 * serves is human copy. Suppressing the squiggle on a name would also suppress a
 * genuine misspelling of a customer's name in a published testimonial, which is a
 * worse thing to ship than an underline the author can ignore.
 *
 * `role: 'textbox'` SUPERSEDES the element's native role in the canvas. Where a
 * section puts the seam directly on its heading element, that heading announces as
 * a text box instead of a heading; where it sits on a `<span>` INSIDE the heading —
 * the hero and the invite, which both interleave an accent span — the heading role
 * survives. That is the right trade in an editing surface: a
 * caret sitting in "The ache — Heading" needs to know it is in an editable field
 * and which one, and the document outline is still what the builder's own outline
 * rail is for. Nothing changes for a visitor — see the `{}` above.
 */
export function editFieldAttrs(
  type: string,
  key: string,
  editable: boolean,
  onEdit?: EditFieldCommit
): HTMLAttributes<HTMLElement> {
  if (!editable) return {};

  return {
    contenteditable: 'true',
    spellcheck: 'true',
    role: 'textbox',
    'aria-label': editFieldName(type, key),
    'data-field': key,
    oninput: (e) =>
      onEdit?.(key, (e.currentTarget as HTMLElement).textContent ?? ''),
    onpaste: pastePlainText,
  };
}
