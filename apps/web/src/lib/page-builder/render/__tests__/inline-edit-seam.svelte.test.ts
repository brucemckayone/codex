/**
 * THE INLINE-EDIT SEAM, across all eleven sections at once (F38).
 *
 * The canvas is WYSIWYG: the creator types their sell copy into the rendered
 * section through a `contenteditable`. Eleven components implemented that with
 * eleven byte-identical copies of the same attribute bag, and all eleven carried
 * the same three defects — spellcheck off on a sales page's copy, no `onpaste` (so
 * a `contenteditable` took a paste as RICH HTML and the store read the text back
 * FLATTENED, i.e. the DOM and the store diverged), and no role or accessible name.
 *
 * This file exists BECAUSE the seam is now one function. It sweeps every section
 * rather than testing the helper in isolation, because "eleven copies" is the
 * failure mode: a twelfth section, or a copy that drifts back, has to turn this red.
 *
 * The section-by-section tests next to each component still own that component's
 * own read boundary (which key each field writes). This file owns only the three
 * attributes and the paste, in all eleven.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { editFieldLabel, editFieldName } from '../editable';
import { SECTION_COMPONENTS, type SectionComponent } from '../section-registry';
import HeroSection from '../sections/HeroSection.svelte';
import type { JourneySalesContext, SellPreview } from '../types';

const CANDLELIT: ResolvedSectionDesign = {
  width: 'narrow',
  density: 'airy',
  surface: 'media',
  edge: 'none',
  align: 'center',
  type: 'monumental',
  accent: 'glow',
  motion: 'drift',
  media: 'bleed',
};

function context(
  overrides: Partial<JourneySalesContext> = {}
): JourneySalesContext {
  return {
    course: {
      id: 'c1',
      slug: 'demo',
      title: 'The course title',
      kicker: null,
      lede: null,
      status: 'published',
      priceCents: 4900,
      stageCount: 1,
      practiceCount: 2,
    },
    stages: [
      {
        id: 's1',
        name: 'Stage one',
        gloss: null,
        sortOrder: 0,
        practices: [
          {
            contentId: 'p1',
            slug: 'p1',
            title: 'Practice one',
            contentType: 'video',
            sortOrder: 0,
          },
        ],
      },
    ],
    testimonials: [],
    checkoutUrl: 'http://lvh.me:3000/journeys/demo/checkout',
    dashboardUrl: 'http://lvh.me:3000/journeys/demo/dashboard',
    enrolled: false,
    offer: null,
    purchasable: true,
    sellPreview: Promise.resolve<SellPreview | null>(null),
    ...overrides,
  };
}

/**
 * Enough copy per type that the section renders at least one editable field. Each
 * bag is the section's own header vocabulary plus whatever its authored-item path
 * needs (`proof`/`faq` render numbered rows only off the flat `q1`/`a1`/`n1` keys —
 * an `items[]` array has no `props` key to write back to and is read-only even in
 * the canvas).
 */
const CONFIGS: Readonly<Record<string, SectionProps>> = {
  hero: {
    headline: 'Headline copy',
    eyebrow: 'Eyebrow copy',
    trust: 'Trusted',
  },
  introVideo: { heading: 'Heading', kicker: 'Eyebrow', sub: 'Sub' },
  ache: { heading: 'Heading', kicker: 'Eyebrow', body: 'Body copy' },
  turn: { heading: 'Heading', kicker: 'Eyebrow', body: 'Body copy' },
  reel: { heading: 'Heading', kicker: 'Eyebrow', sub: 'Sub', tag: 'Tag' },
  map: { heading: 'Heading', eyebrow: 'Eyebrow', sub: 'Sub', note: 'Note' },
  feel: { heading: 'Heading', kicker: 'Eyebrow', body: 'Body copy' },
  proof: {
    heading: 'Heading',
    eyebrow: 'Eyebrow',
    q1: 'A quote',
    n1: 'A name',
    c1: 'A context',
  },
  guide: {
    heading: 'Heading',
    name: 'The guide',
    body: 'A bio',
    quote: 'A pull quote',
  },
  faq: {
    heading: 'Heading',
    eyebrow: 'Eyebrow',
    q1: 'A question',
    a1: 'An answer',
  },
  invite: {
    heading: 'Heading',
    eyebrow: 'Eyebrow',
    sub: 'Sub',
    risk: 'Risk reversal',
  },
};

let component: ReturnType<typeof mount> | undefined;

function render(
  Component: SectionComponent,
  props: {
    config: SectionProps;
    editable?: boolean;
    onEdit?: (key: string, value: string) => void;
  }
) {
  component = mount(Component, {
    target: document.body,
    props: {
      config: props.config,
      context: context(),
      design: CANDLELIT,
      editable: props.editable,
      onEdit: props.onEdit,
    },
  });
  flushSync();
  return document.body;
}

function fields(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('[contenteditable]')];
}

afterEach(() => {
  if (component) {
    unmount(component);
    component = undefined;
  }
  document.body.innerHTML = '';
});

/**
 * What a paste out of Word / Pages / a web page carries: a `text/html` flavour
 * with tags, styles and a font, alongside a `text/plain` flavour of the same words.
 * A test that pastes only plain text proves nothing — plain text was never the
 * failure.
 */
const RICH_HTML =
  '<meta charset="utf-8"><b style="font-weight:normal">' +
  '<span style="font-family:Calibri;font-size:11pt;color:#1f1f1f">Slow work, </span>' +
  '<strong><em>close</em></strong><span style="font-family:Calibri"> to the bone.</span>' +
  '</b>';
const RICH_PLAIN = 'Slow work, close to the bone.';

/** A `paste` event carrying both clipboard flavours. jsdom has no ClipboardEvent. */
function pasteEvent(html: string, plain: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) =>
        type === 'text/html' ? html : type === 'text/plain' ? plain : '',
    },
  });
  return event;
}

/** Put the caret at the end of the field's own text, the way a click would. */
function caretAtEnd(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE THREE ATTRIBUTES, IN ALL ELEVEN
// ─────────────────────────────────────────────────────────────────────────────

describe('the inline-edit seam — every section, every field', () => {
  const types = Object.keys(SECTION_COMPONENTS);

  it('covers all eleven catalogue types', () => {
    // A twelfth section with no config here would silently escape the sweep.
    expect(types).toHaveLength(11);
    expect(Object.keys(CONFIGS).sort()).toEqual([...types].sort());
  });

  for (const type of types) {
    describe(type, () => {
      it('spellchecks the creator’s prose, names the field, and takes a paste', () => {
        render(SECTION_COMPONENTS[type as keyof typeof SECTION_COMPONENTS], {
          config: CONFIGS[type],
          editable: true,
          onEdit: () => {},
        });

        const edited = fields();
        // A section that renders NO editable field would make every assertion
        // below vacuous — this is the guard against a silently empty sweep.
        expect(edited.length).toBeGreaterThan(0);

        for (const el of edited) {
          const key = el.getAttribute('data-field');
          expect(
            key,
            'every field declares the props key it writes'
          ).toBeTruthy();

          // 1. Spellcheck is ON. This is the prose that has to sell the course.
          expect(el.getAttribute('spellcheck')).toBe('true');

          // 2. It announces as an editor, with a name saying WHICH field.
          expect(el.getAttribute('role')).toBe('textbox');
          expect(el.getAttribute('aria-label')).toBe(
            editFieldName(type, key as string)
          );
          expect(el.getAttribute('aria-label')).toContain(
            editFieldLabel(type, key as string)
          );

          // 3. A paste is intercepted. Asserted BEHAVIOURALLY, not by reading
          //    `el.onpaste`: Svelte 5 attaches the listener with
          //    `addEventListener`, so the IDL property stays null and a property
          //    check passes vacuously. Cancelling the event is the whole fix —
          //    without it a `contenteditable` inserts the clipboard's RICH HTML.
          const tagsBefore = el.querySelectorAll('*').length;
          const paste = pasteEvent(RICH_HTML, RICH_PLAIN);
          el.dispatchEvent(paste);
          expect(paste.defaultPrevented, `${type}.${key} takes a paste`).toBe(
            true
          );
          // "No NEW tags", not "no tags": `guide`'s bio is a multi-paragraph
          // container whose `<p>`s are the section's own markup, so a blanket
          // no-markup assertion would only be right for the other ten.
          expect(el.querySelectorAll('*').length).toBe(tagsBefore);
          expect(el.querySelector('span, strong, b, em, meta')).toBeNull();
        }
      });

      it('adds nothing at all to the public page', () => {
        render(SECTION_COMPONENTS[type as keyof typeof SECTION_COMPONENTS], {
          config: CONFIGS[type],
        });

        // The public markup must be byte-identical to having no seam: not just no
        // `contenteditable`, but no role and no name leaking to a visitor either.
        expect(document.body.querySelector('[contenteditable]')).toBeNull();
        expect(document.body.querySelector('[data-field]')).toBeNull();
        expect(document.body.querySelector('[role="textbox"]')).toBeNull();
      });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// THE PASTE — falsified with the shape a word processor actually produces
// ─────────────────────────────────────────────────────────────────────────────

describe('the inline-edit seam — pasting rich text', () => {
  it('stores PLAIN text and leaves no markup in the DOM', () => {
    const edits: Array<[string, string]> = [];
    render(HeroSection, {
      // NB `asString` trims, so the stored value has no trailing space — the
      // pasted words land hard against it, which is what a caret at the end does.
      config: { headline: 'A headline.' },
      editable: true,
      onEdit: (key, value) => edits.push([key, value]),
    });

    const field = document.body.querySelector<HTMLElement>(
      '.hero__headline [data-field="headline"]'
    ) as HTMLElement;
    caretAtEnd(field);
    field.dispatchEvent(pasteEvent(RICH_HTML, RICH_PLAIN));
    flushSync();

    // The DOM the author is looking at: text, and only text.
    expect(field.querySelector('span, strong, b, em, meta')).toBeNull();
    expect(field.innerHTML).not.toContain('<');
    expect(field.innerHTML).not.toContain('style=');
    expect(field.textContent).toBe(`A headline.${RICH_PLAIN}`);

    // And the store got that same plain string — ONCE, like a keystroke.
    expect(edits).toEqual([['headline', `A headline.${RICH_PLAIN}`]]);
  });

  it('cancels the browser’s own rich-HTML insert', () => {
    render(HeroSection, {
      config: { headline: 'A headline' },
      editable: true,
      onEdit: () => {},
    });
    const field = document.body.querySelector<HTMLElement>(
      '[data-field="headline"]'
    ) as HTMLElement;

    const event = pasteEvent(RICH_HTML, RICH_PLAIN);
    const prevented = !field.dispatchEvent(event);
    // `preventDefault()` is the only thing standing between the clipboard's
    // markup and the DOM, and it must run whatever the payload turns out to be.
    expect(prevented).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves the field untouched when the clipboard has no plain text', () => {
    const edits: Array<[string, string]> = [];
    render(HeroSection, {
      config: { headline: 'Untouched' },
      editable: true,
      onEdit: (key, value) => edits.push([key, value]),
    });
    const field = document.body.querySelector<HTMLElement>(
      '[data-field="headline"]'
    ) as HTMLElement;
    caretAtEnd(field);

    // An image, or an HTML-only source: there is nothing safe to insert, so the
    // paste is refused outright rather than injecting the markup.
    field.dispatchEvent(pasteEvent(RICH_HTML, ''));
    flushSync();

    expect(field.textContent).toBe('Untouched');
    expect(edits).toEqual([]);
  });

  it('routes an execCommand insert through oninput — exactly one store update', () => {
    // The browser path. `document.execCommand('insertText')` is preferred over the
    // manual fallback because it keeps the native UNDO stack, and it fires its own
    // `input` event — so the seam must NOT also write the store itself, or a paste
    // would cost two updates where a keystroke costs one.
    const edits: Array<[string, string]> = [];
    render(HeroSection, {
      config: { headline: 'Typed' },
      editable: true,
      onEdit: (key, value) => edits.push([key, value]),
    });
    const field = document.body.querySelector<HTMLElement>(
      '[data-field="headline"]'
    ) as HTMLElement;

    const execCommand = vi.fn<
      (command: string, showUI?: boolean, value?: string) => boolean
    >((command, _showUI, value) => {
      if (command !== 'insertText') return false;
      // What a real browser does for `insertText`: mutate the field AND fire its
      // own `input` event. The seam must lean on that event, not write the store.
      field.textContent = `${field.textContent}${value ?? ''}`;
      field.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return true;
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    try {
      field.dispatchEvent(pasteEvent(RICH_HTML, RICH_PLAIN));
      flushSync();
    } finally {
      // Restore jsdom's own state: it does not implement `execCommand` at all,
      // so the honest reset is to take the stub back off rather than leave one
      // standing for the next test file in this worker.
      Reflect.deleteProperty(document, 'execCommand');
    }

    expect(execCommand).toHaveBeenCalledWith('insertText', false, RICH_PLAIN);
    expect(edits).toEqual([['headline', `Typed${RICH_PLAIN}`]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE LABEL REGISTER
// ─────────────────────────────────────────────────────────────────────────────

describe('editFieldLabel / editFieldName', () => {
  it('speaks the builder’s own field vocabulary', () => {
    expect(editFieldLabel('hero', 'headline')).toBe('Headline');
    expect(editFieldLabel('map', 'note')).toBe('Closing note');
    expect(editFieldLabel('invite', 'risk')).toBe('Risk-reversal');
    expect(editFieldLabel('guide', 'name')).toBe('Guide name');
  });

  it('disambiguates a key that means two different things', () => {
    // The reason the seam takes a TYPE as well as a key: `q1` is a QUESTION in the
    // FAQ and a QUOTE in the proof section. A flat key→label map could only ever
    // be right for one of them.
    expect(editFieldLabel('faq', 'q1')).toBe('Question 1');
    expect(editFieldLabel('proof', 'q1')).toBe('Quote 1');
    expect(editFieldLabel('faq', 'a2')).toBe('Answer 2');
    expect(editFieldLabel('proof', 'c3')).toBe('Context 3');
  });

  it('gives a legacy alias key the label of the key it aliases', () => {
    // `SECTION_PROP_ALIASES` bridges these on read, so a stored page can hand the
    // seam either one. The author is shown one control, so they hear one name.
    expect(editFieldLabel('turn', 'statement')).toBe(
      editFieldLabel('turn', 'heading')
    );
    expect(editFieldLabel('turn', 'lede')).toBe(editFieldLabel('turn', 'body'));
    expect(editFieldLabel('reel', 'tag')).toBe(editFieldLabel('reel', 'clip'));
  });

  it('never returns an empty name for a key it has never seen', () => {
    // `role="textbox"` with no accessible name is the defect this seam closes, so
    // the fallback has to be readable rather than absent.
    expect(editFieldLabel('hero', 'previewSub')).toBe('Preview sub');
    expect(editFieldName('hero', 'someNewField')).toBe('Hero — Some new field');
    expect(editFieldName('nosuchtype', 'heading')).toBe('nosuchtype — Heading');
  });

  it('names the section the author sees on the rail', () => {
    expect(editFieldName('ache', 'heading')).toBe('The ache — Heading');
    expect(editFieldName('introVideo', 'clip')).toBe(
      'Intro video — On-frame label'
    );
  });
});
