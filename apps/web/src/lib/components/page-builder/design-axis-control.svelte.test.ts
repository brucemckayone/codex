/**
 * ONE LINE PER AXIS DID NOT COST THE ANNOUNCEMENT.
 *
 * WHAT THIS GUARDS. `DesignAxisControl` used to state its inherited-vs-overridden
 * state twice in ink — an `Inherited` / `Overridden` chip on its own line, PLUS a
 * sentence naming the fallback value — and kept the axis hint permanently below
 * it. MEASURED on of-blood-and-bones/bone-deep at 1512x950: one row 117px, the
 * nine axes 1056px, a third of a 3573px inspector. Eight of those nine chips read
 * `Inherited`, which is the unremarkable default.
 *
 * Compacting the row to one line moved that prose OUT OF INK and INTO `sr-only`,
 * and THAT is the risk this file exists for. The cheap way to tidy a
 * visually-hidden paragraph is `display: none`; the cheap way to hide a hint
 * until focus is `visibility: hidden`. Both remove the node from the
 * accessibility tree, which silently unwires the `aria-describedby` the sentence
 * exists to serve. The result is a regression with NO visual symptom, on the one
 * control whose entire job is explaining where a value came from — so a reviewer
 * looking at the rendered panel could not catch it.
 *
 * DELIBERATELY NOT ASSERTED: the row's pixel height. The density is the reason
 * for the change but it is a layout outcome, and pinning it here would fail on
 * any legitimate spacing-token change. What must not regress is the CONTRACT the
 * density was bought with, which is what each test below reads.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount } from '$tests/utils/component-test-utils.svelte';
import DesignAxisControl from './DesignAxisControl.svelte';

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
  if (component) unmount(component);
  component = undefined;
  document.body.innerHTML = '';
});

const OPTIONS = [
  { value: 'text-column', label: 'Text column' },
  { value: 'full', label: 'Full width' },
] as const;

/** Mount one axis row. `override: undefined` IS the inherited state. */
function render(over?: string): void {
  component = mount(DesignAxisControl, {
    target: document.body,
    props: {
      label: 'Width',
      hint: 'How wide the content runs',
      options: OPTIONS,
      effective: over ?? 'text-column',
      override: over,
      inherited: 'text-column',
      inheritedFrom: 'page' as const,
      onselect: () => {},
      onclear: () => {},
    },
  });
}

/**
 * `querySelector('select')`, NOT `querySelector<HTMLSelectElement>('select')`.
 * `apps/web` typechecks with `@cloudflare/workers-types` in scope, which defines
 * its own `Element` (the HTMLRewriter one), so the generic's `T extends Element`
 * constraint rejects every DOM interface — `error TS2344`. The tag-name overload
 * reads the type off `HTMLElementTagNameMap` instead and needs no generic, which
 * is what the sibling suites in this directory do.
 */
const select = (): HTMLSelectElement => {
  const el = document.body.querySelector('select');
  if (!el) throw new Error('no select rendered');
  return el;
};

/** The elements `aria-describedby` actually points at, in order. */
function describedBy(): HTMLElement[] {
  const ids = select().getAttribute('aria-describedby')?.split(/\s+/) ?? [];
  return ids.map((id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`aria-describedby points at missing id "${id}"`);
    return el;
  });
}

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'DesignAxisControl.svelte'),
  'utf8'
);

/** The declarations of one scoped rule, by selector. */
function ruleBody(selector: string): string {
  const at = SOURCE.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`no rule for "${selector}"`);
  return SOURCE.slice(at, SOURCE.indexOf('}', at));
}

describe('DesignAxisControl — the state is announced, not only shown', () => {
  it('describes the select with BOTH the state sentence and the axis hint', () => {
    render();
    const described = describedBy();
    // Two, not one: the hint was visible-only before this change and reached
    // assistive tech not at all. Losing either reference is the regression.
    expect(described).toHaveLength(2);
    expect(described[0].textContent?.trim()).toBe(
      'Inherited from the page look (Text column).'
    );
    expect(described[1].textContent?.trim()).toBe('How wide the content runs');
  });

  it('names the fallback value in the overridden case too', () => {
    render('full');
    // The sentence a reset button alone leaves implicit: what you go back TO.
    expect(describedBy()[0].textContent?.trim()).toBe(
      'Set on this section. The page look is Text column.'
    );
  });

  it('hides the sentence and the hint with opacity, never display or visibility', () => {
    // THE POINT OF THE FILE. `display: none` / `visibility: hidden` drop a node
    // from the accessibility tree, so either one would leave the assertions above
    // passing on ids that announce nothing.
    const hint = ruleBody('.dax__hint');
    expect(hint).toContain('opacity: 0');
    expect(hint).not.toContain('display: none');
    expect(hint).not.toContain('visibility: hidden');
    // The state sentence rides the platform `.sr-only` utility, which is the
    // clip-rect technique rather than either of those two.
    expect(SOURCE).toContain('class="sr-only"');
  });

  it('reveals the hint on focus as well as hover, so it is not mouse-only', () => {
    // A hint reachable only by hover is unreachable by keyboard and by touch.
    expect(SOURCE).toContain('.dax:focus-within .dax__hint');
  });

  it('offers the reset only when there is an override, and names what it returns to', () => {
    render('full');
    const reset = document.body.querySelector('button');
    expect(reset).not.toBeNull();
    // Icon-only, so the accessible name is the whole of its self-description —
    // and it carries the words the removed chip used to spend a line on.
    expect(reset?.getAttribute('aria-label')).toBe(
      'Use the page look for width'
    );

    // Negative control: a permanently-visible reset would imply an override that
    // is not there, which is the state this control exists to disambiguate.
    unmount(component!);
    component = undefined;
    document.body.innerHTML = '';
    render();
    expect(document.body.querySelector('button')).toBeNull();
  });

  it('keeps the inheritance suffix in the option list, in text', () => {
    render('full');
    const labels = [...select().options].map((o) => o.textContent?.trim());
    // This is why the control is a native select: the inheritance is READABLE
    // rather than encoded in the spine colour, so it survives for a screen reader
    // now that the chip is gone.
    expect(labels).toContain('Text column · page look');
    expect(labels).toContain('Full width');
  });
});
