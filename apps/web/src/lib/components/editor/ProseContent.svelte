<!--
  @component ProseContent

  Brand-aware renderer for TipTap HTML content.
  Provides beautiful long-form typography that inherits org branding
  CSS variables (colors, fonts, density, radius) automatically.

  @prop {string} html - Pre-rendered HTML string from generateHTML()
-->
<script lang="ts">
  interface Props {
    html: string;
  }

  const { html }: Props = $props();
</script>

<article class="prose-content">
  {@html html}
</article>

<style>
  .prose-content {
    font-family: var(--font-body, var(--font-sans));
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
    max-width: 72ch;
    word-break: break-word;
    overflow-wrap: break-word;
  }

  /* ── Headings ──────────────────────────────────────────────── */

  .prose-content :global(h1) {
    font-family: var(--font-heading, var(--font-sans));
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    line-height: var(--leading-snug);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
    margin: var(--space-8) 0 var(--space-4);
  }

  .prose-content :global(h1:first-child) {
    margin-top: 0;
  }

  .prose-content :global(h2) {
    font-family: var(--font-heading, var(--font-sans));
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    line-height: var(--leading-snug);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
    margin: var(--space-8) 0 var(--space-3);
  }

  .prose-content :global(h3) {
    font-family: var(--font-heading, var(--font-sans));
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    line-height: var(--leading-snug);
    color: var(--color-text);
    margin: var(--space-6) 0 var(--space-3);
  }

  /* Add a subtle top border on h2 for visual section breaks */
  .prose-content :global(h2:not(:first-child)) {
    padding-top: var(--space-6);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  /* ── Paragraphs ────────────────────────────────────────────── */

  .prose-content :global(p) {
    margin: var(--space-4) 0;
    line-height: var(--leading-relaxed);
    font-size: var(--text-base);
    color: var(--color-text-secondary);
  }

  .prose-content :global(p:first-child) {
    margin-top: 0;
  }

  .prose-content :global(p:last-child) {
    margin-bottom: 0;
  }

  /* ── Inline marks ──────────────────────────────────────────── */

  .prose-content :global(strong) {
    font-weight: var(--font-bold);
    color: var(--color-text);
  }

  .prose-content :global(em) {
    font-style: italic;
  }

  .prose-content :global(s) {
    text-decoration: line-through;
    opacity: var(--opacity-60);
  }

  .prose-content :global(a) {
    color: var(--color-interactive);
    text-decoration: underline;
    text-underline-offset: 0.15em;
    text-decoration-thickness: 0.075em;
    transition: var(--transition-colors);
  }

  .prose-content :global(a:hover) {
    color: var(--color-interactive-hover);
    text-decoration-thickness: 0.125em;
  }

  /* ── Lists ─────────────────────────────────────────────────── */

  .prose-content :global(ul) {
    padding-left: var(--space-6);
    margin: var(--space-4) 0;
    list-style-type: disc;
  }

  .prose-content :global(ol) {
    padding-left: var(--space-6);
    margin: var(--space-4) 0;
    list-style-type: decimal;
  }

  .prose-content :global(li) {
    margin: var(--space-2) 0;
    padding-left: var(--space-1);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .prose-content :global(li p) {
    margin: 0;
  }

  .prose-content :global(li > ul),
  .prose-content :global(li > ol) {
    margin: var(--space-1) 0;
  }

  /* ── Blockquote ────────────────────────────────────────────── */

  .prose-content :global(blockquote) {
    position: relative;
    margin: var(--space-6) 0;
    padding: var(--space-4) var(--space-5);
    border-left: 3px solid var(--color-brand-primary, var(--color-interactive));
    background-color: var(--color-brand-primary-subtle, color-mix(in oklch, var(--color-interactive) 6%, transparent));
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
    color: var(--color-text-secondary);
    font-style: italic;
  }

  .prose-content :global(blockquote p) {
    margin: var(--space-2) 0;
  }

  .prose-content :global(blockquote p:first-child) {
    margin-top: 0;
  }

  .prose-content :global(blockquote p:last-child) {
    margin-bottom: 0;
  }

  /* ── Code ──────────────────────────────────────────────────── */

  .prose-content :global(code) {
    font-family: var(--font-mono, monospace);
    font-size: 0.875em;
    background-color: var(--color-surface-secondary, var(--color-surface));
    padding: 0.125em var(--space-1);
    border-radius: var(--radius-sm);
    border: var(--border-width) var(--border-style) var(--color-border);
    word-break: break-word;
  }

  .prose-content :global(pre) {
    margin: var(--space-6) 0;
    padding: var(--space-5);
    background-color: var(--color-surface-secondary, var(--color-surface));
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    overflow-x: auto;
    line-height: var(--leading-normal);
    -webkit-overflow-scrolling: touch;
  }

  .prose-content :global(pre code) {
    background: none;
    padding: 0;
    border: none;
    border-radius: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    word-break: normal;
  }

  /* ── Horizontal rule ───────────────────────────────────────── */

  .prose-content :global(hr) {
    border: none;
    border-top: var(--border-width) var(--border-style) var(--color-border);
    margin: var(--space-8) 0;
  }

  /* ── Images ────────────────────────────────────────────────── */

  .prose-content :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-lg);
    margin: var(--space-6) 0;
    box-shadow: var(--shadow-sm);
  }

  /* ── Responsive refinements ────────────────────────────────── */

  @media (--breakpoint-md) {
    .prose-content :global(h1) {
      font-size: var(--text-4xl);
    }
  }
</style>
