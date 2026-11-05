/**
 * `forwardBrandTokens` — the org brand a portalled Dialog or DropdownMenu
 * takes with it to <body>. The font is the point of the last case: an
 * inline value would beat `[data-org-brand] { font-family: var(--font-sans) }`
 * and draw the portal in <body>'s Inter beside a brand-font page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { forwardBrandTokens } from './portal-brand';

function orgLayout(): HTMLElement {
  const layout = document.createElement('div');
  layout.className = 'org-layout';
  layout.setAttribute('data-org-brand', '');
  layout.setAttribute('data-org-bg', '');
  layout.style.setProperty('--brand-font-body', 'Georgia');
  layout.style.setProperty('--brand-color', '#336699');
  layout.style.setProperty('--page-gutter', '2rem');
  document.body.appendChild(layout);
  return layout;
}

describe('forwardBrandTokens', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('leaves the node alone on a page with no org layout', () => {
    const node = document.createElement('div');
    forwardBrandTokens(node);
    expect(node.attributes).toHaveLength(0);
  });

  it('copies the brand attributes and only the --brand-* properties', () => {
    orgLayout();
    const node = document.createElement('div');
    forwardBrandTokens(node);

    expect(node.hasAttribute('data-org-brand')).toBe(true);
    expect(node.hasAttribute('data-org-bg')).toBe(true);
    expect(node.style.getPropertyValue('--brand-font-body')).toBe('Georgia');
    expect(node.style.getPropertyValue('--brand-color')).toBe('#336699');
    expect(node.style.getPropertyValue('--page-gutter')).toBe('');
  });

  it('sets no font of its own, so [data-org-brand] gives the brand font', () => {
    orgLayout();
    const node = document.createElement('div');
    forwardBrandTokens(node);
    expect(node.style.fontFamily).toBe('');
  });
});
