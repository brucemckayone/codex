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
   * Media type of the featured item. Drives the slide's type badge, the
   * audio waveform treatment, and the "Watch / Listen / Read" CTA label.
   */
  contentType: 'video' | 'audio' | 'article';
  description?: string | null;
  href: string;
  image?: string | null;
}
