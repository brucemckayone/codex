/**
 * Paint <html> with the org layout's background, and keep it painted.
 *
 * A dialog's scroll lock keeps a classic scrollbar's gutter, and Chromium
 * paints that strip with <html>'s background, not the page's. So the org
 * layout copies its computed background onto <html>. A copy taken only when
 * the layout's own state changes went stale whenever something else changed
 * the background under it (Codex-vlphc review G4-U5, G5-C-L2, q6qjb):
 *
 * - PreviewFrame stamps the brand studio's preview theme straight onto a
 *   framed page's <html> (`data-theme` and its class). No state in the
 *   frame changes, so the strip beside a dialog in the preview kept the
 *   theme it loaded in.
 * - The brand editor's preview theme is `data-editing-theme` on the layout,
 *   and its edits are inline custom properties on it.
 * - A route change between the studio and a public page flips the layout's
 *   classes. The studio's layout is transparent.
 *
 * So the copy is taken again whenever one of those attributes changes, at
 * most once a frame. A transparent layout (the studio) leaves <html> its
 * own background, as a page loaded there has. What it returns stops
 * following and removes the copy.
 */
export function followLayoutBackground(layout: HTMLElement): () => void {
  const root = document.documentElement;
  let frame = 0;
  const sample = () => {
    cancelAnimationFrame(frame);
    // A frame later, once the change has been styled.
    frame = requestAnimationFrame(() => {
      const bg = getComputedStyle(layout).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)') root.style.backgroundColor = bg;
      else root.style.removeProperty('background-color');
    });
  };
  const observer = new MutationObserver(sample);
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-theme', 'class'],
  });
  observer.observe(layout, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-editing-theme', 'data-org-bg'],
  });
  sample();
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    root.style.removeProperty('background-color');
  };
}
