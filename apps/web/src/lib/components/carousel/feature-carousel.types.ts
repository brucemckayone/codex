/**
 * Minimal, typed shape for a FeatureCarousel slide. WP-11 maps featured content
 * (`content.featured`) into this at the landing page. Kept intentionally small —
 * no `any`, every optional field guarded in the component template.
 *
 * Lives in a plain `.ts` module (not the component's `<script module>`) so
 * consumers can `import type { FeatureItem }` under plain `tsc` — the ambient
 * `*.svelte` module only declares a default export.
 */
export interface FeatureItem {
  id: string;
  title: string;
  /** Eyebrow / kind line, e.g. "Editor's pick". */
  kind: string;
  /**
   * What KIND of thing the slide points at. Drives the slide's type badge, the
   * audio waveform treatment, and the CTA verb ("Watch / Listen / Read / See
   * the journey").
   *
   * `'portal'` is not a media type — it is a whole guided journey
   * (`landing_pages` of `pageType='course'` joined to `courses`), promoted here
   * when a creator sets `landing_pages.featured`. It rides this same field
   * rather than a discriminated union because every type-specific value on a
   * slide already flows through ONE lookup in the component (`TYPE_META`:
   * label, icon, CTA verb), and a portal needs nothing a content pick does not
   * — a cover, a title, a tagline and a link. A union would buy branching in
   * the template for no additional data.
   */
  contentType: 'video' | 'audio' | 'article' | 'portal';
  description?: string | null;
  href: string;
  image?: string | null;
}
