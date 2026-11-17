/**
 * Forward the org brand onto a portalled node (Dialog.Content, DropdownMenu).
 *
 * Melt portals render at <body>, escaping the .org-layout subtree that
 * carries [data-org-brand], [data-org-bg] and the --brand-* inline styles
 * org-brand.css keys off. This action copies those attributes and styles
 * onto the portalled node so the full derivation engine resolves inside it.
 *
 * No inline font: [data-org-brand] sets the brand font on the node itself,
 * so the portal draws in the font of the page that opened it. An inline
 * `font-family: inherit` beat that rule and took <body>'s Inter instead.
 */
export function forwardBrandTokens(node: HTMLElement): void {
  const orgLayout = document.querySelector<HTMLElement>('.org-layout');
  if (!orgLayout) return;

  // Copy data attributes that activate org-brand.css rules
  if (orgLayout.hasAttribute('data-org-brand')) {
    node.setAttribute('data-org-brand', '');
  }
  if (orgLayout.hasAttribute('data-org-bg')) {
    node.setAttribute('data-org-bg', '');
  }

  // Copy the --brand-* inline custom properties
  const style = orgLayout.style;
  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    if (prop.startsWith('--brand-')) {
      node.style.setProperty(prop, style.getPropertyValue(prop));
    }
  }
}
