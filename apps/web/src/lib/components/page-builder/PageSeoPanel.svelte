<!--
  @component PageSeoPanel

  The "SEO & web address" page-mode panel (Codex-2pryk.3.3 · WP-5). Edits the web
  address (slug) and the page's meta title + description — all three are real
  `PageBuilderState` fields, persisted by the page save.

  META TITLE / DESCRIPTION ARE NOW PERSISTED (Codex-2j8nq). They shipped DISABLED
  because `landing_pages` had no `seo` column and the save body is `.strict()`, so
  the keystrokes would have been discarded under a "Page saved" toast — the same
  silent swallow the pricing panel had before `updateJourneyOffer` landed. The
  whole chain now exists: migration 0090 adds `landing_pages.seo` jsonb,
  `pageSeoSchema` declares the key on `saveJourneyPageBodySchema`,
  `CourseJourneyService.saveJourneyPage` writes it, `getJourneyForBuilder`
  projects it back, and the public sell page reads it in `<svelte:head>` from the
  AWAITED envelope (never a streamed promise — it is SEO-critical).

  CLEARING A FIELD IS THE EMPTY STRING, and that is load-bearing: the head falls
  back with `||`, not `??`, so an empty override resumes deriving the title from
  the page title and the description from the course lede. Absent (the client said
  nothing about SEO) is what the service reads as "leave the stored bag alone".

  WEB ADDRESS — WHY THE LOCAL DRAFT. The input's `value` used to be bound to the
  SLUGIFIED store value and re-derived on every keystroke, so the field rewrote
  what the creator was typing, under the caret. MEASURED at the pre-fix commit:
  typing a space between "deep" and "work" replaced the field's own value with
  "deep-work" and moved `selectionStart` from 5 to the end of the field (9) — so
  editing anywhere but the end threw the caret away, one keystroke at a time. The
  same binding also let the field DISPLAY characters that never entered the
  stored slug (a trailing hyphen, punctuation), because `slugify` strips them and
  an unchanged store value means no re-render.

  (The bead's stronger claim — that `deep-work` was unauthorable at all — does
  NOT reproduce: `page-seo-panel.svelte.test.ts` types it at the pre-fix commit
  and the store does end up holding `deep-work`. The caret and the display lie
  are the real defects, and they are what the test pins.)

  The draft string is authoritative while the field is focused (the same pattern,
  for the same reason, as `PagePricingPanel`'s price fields); `pending.slug` still
  holds the canonical slugified value on EVERY keystroke, so a draft can never
  make the save payload invalid.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';

  interface Props {
    /** Org domain for the address preview (e.g. `rootwork.space`). */
    orgDomain?: string;
  }

  const { orgDomain = 'your-space' }: Props = $props();

  const pending = $derived(pageBuilder.pending);

  function slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Raw text while the field is focused; null when it is not. See the component
  // header — without it a hyphen cannot be typed.
  let slugDraft = $state<string | null>(null);

  function typeSlug(raw: string): void {
    slugDraft = raw;
    pageBuilder.updateMeta('slug', slugify(raw));
  }

  /** Blur → drop the draft so the field shows the canonical stored slug. */
  function commitSlug(): void {
    slugDraft = null;
  }

  // Renaming a LIVE page breaks every link already shared to it — the one
  // consequence on this panel a creator cannot discover by looking. Shown only
  // once the address actually differs from what is published, so it reads as a
  // consequence of THIS edit rather than as a permanent scold.
  const renamingLivePage = $derived(
    pending?.status === 'published' &&
      Boolean(pageBuilder.saved?.slug) &&
      pending.slug !== pageBuilder.saved?.slug
  );
</script>

{#if pending}
  <div class="panel">
    <header class="panel__head">
      <h2 class="panel__title">{m.studio_builder_seo_title()}</h2>
      <p class="panel__sub">{m.studio_builder_panel_page_level()}</p>
    </header>

    <label class="panel__field">
      <span class="panel__label">{m.studio_builder_seo_web_address()}</span>
      <input
        type="text"
        class="panel__input"
        value={slugDraft ?? pending.slug}
        oninput={(e) => typeSlug(e.currentTarget.value)}
        onblur={commitSlug}
      />
      <span class="panel__hint">{orgDomain} / journeys / <b>{pending.slug || 'draft'}</b></span>
    </label>

    {#if renamingLivePage}
      <p class="panel__warn" role="status">
        {m.studio_builder_seo_live_at()} <b>/journeys/{pageBuilder.saved?.slug}</b>. {m.studio_builder_seo_rename_warn()}
      </p>
    {/if}

    <label class="panel__field">
      <span class="panel__label">{m.studio_builder_seo_meta_title()}</span>
      <input
        type="text"
        class="panel__input"
        placeholder={pending.title}
        value={pending.seo?.title ?? ''}
        oninput={(e) => pageBuilder.updateSeo({ title: e.currentTarget.value })}
      />
      <span class="panel__hint">{m.studio_builder_seo_meta_title_hint()}</span>
    </label>

    <label class="panel__field">
      <span class="panel__label">{m.studio_builder_seo_meta_description()}</span>
      <textarea
        class="panel__input panel__input--area"
        rows="3"
        value={pending.seo?.description ?? ''}
        oninput={(e) =>
          pageBuilder.updateSeo({ description: e.currentTarget.value })}
      ></textarea>
      <span class="panel__hint">
        {m.studio_builder_seo_meta_description_hint()}
      </span>
    </label>

    <p class="panel__group">{m.studio_builder_seo_share_image()}</p>
    <div class="panel__media">
      <span class="panel__media-thumb" aria-hidden="true"></span>
      <span class="panel__media-copy">
        {m.studio_builder_seo_social_preview()}
        <small>{m.studio_builder_seo_social_preview_hint()}</small>
      </span>
    </div>
  </div>
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .panel__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .panel__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  /* NO `--color-text-muted` in this panel, deliberately, and the guard in
     `components/page-builder/panel-contrast.test.ts` now enforces it
     (Codex-6nb7i). Measured on the studio panel surface by canvas readback:
     muted at `--text-xs` is 2.52:1 light / 3.19:1 dark, under the 4.5 floor, and
     13px is not WCAG "large text". Secondary reads 7.81 / 10.21.
     WHAT WAS MUTED HERE, and this is the most SEO-critical panel in the builder:
     the address preview and "Shown in search results & the browser tab. Unset ->
     the page title." (`.panel__hint`), the "Share image" group heading
     (`.panel__group`), the "1200x630 - media library soon" slot note
     (`.panel__media-copy small`) and the panel subtitle. Every one of them tells
     the creator what a field does or what happens if it is left unset — the exact
     register O22 records as this builder's house standard — so none is decoration.
     NOTE the ratio is a function of the ORG's brand background, not a constant:
     under `[data-org-brand]`, `--color-text-muted` derives from `--brand-bg`
     (tokens/org-brand.css) while `--color-text-secondary` mixes back from
     `--color-text` — which is what makes the swap safe on every brand rather
     than lucky on one. */
  .panel__sub {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .panel__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .panel__label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .panel__input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    transition: var(--transition-colors);
  }

  .panel__input--area {
    resize: vertical;
    line-height: var(--leading-normal);
  }

  .panel__warn {
    margin: 0;
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-warning-200);
    border-radius: var(--radius-md);
    background-color: var(--color-warning-50);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-warning-700);
  }

  .panel__input:focus-visible {
    outline: none;
    border-color: var(--color-interactive);
    box-shadow: var(--shadow-focus-ring);
  }

  .panel__hint {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-snug);
  }

  .panel__hint b {
    color: var(--color-text-secondary);
  }

  .panel__group {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .panel__media {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .panel__media-thumb {
    display: grid;
    place-items: center;
    width: var(--space-12);
    height: var(--space-8);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-secondary);
  }

  .panel__media-copy {
    display: flex;
    flex-direction: column;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .panel__media-copy small {
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
  }
</style>
