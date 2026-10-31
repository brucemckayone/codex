<!--
  @component PageMediaPanel

  The "Media" page-mode panel (Codex-eqh0z). One place to set everything visual a
  journey owns outside its copy:

    • the still COVER — the poster the journey card renders. `courses` had three
      VIDEO refs and no poster column at all, which is why `JourneyCard` was
      typographic-only; this uploads to the new `courses.cover_image_key`.
    • the still HERO IMAGE (Codex-490z7, amendment A32) — an UPLOADED image, to
      `courses.hero_image_key`. The "Hero film" slot below it (`heroMediaId`) is a
      `media_items` ref, and that table is CHECK-constrained to
      ('video','audio'), so the "hero image" a creator could pick there was
      really a VIDEO's auto-generated poster frame: someone with a photograph and
      no film had nothing to put in the loudest section of their own sales page.
      The two coexist as A32's chain — uploaded ?? the film's frame ?? the
      section's synthetic gradient — so clearing the upload degrades rather than
      blanks, which is why the toast says so.
    • the still SIGNATURE (Codex-wqxv4's named-slot half) — an UPLOADED mark, to
      `courses.signature_image_key`, and the signature's only source
      (Codex-61zsk.47): uploaded ?? the typeset name, so clearing the upload
      degrades rather than unsigns. A27's "Signature film" slot
      (`signatureMediaId`) is retired (`RETIRED_MEDIA_SLOTS`): it was a
      `media_items` ref, so the only signature it could express was a frame of a
      FILM of a signature — nobody films a signature — and the sign-off drew that
      photo where a mark belongs. The column stays and keeps what was picked.
    • the three sell VIDEOS + the guide PORTRAIT — `courses.introVideoMediaId`,
      `previewVideoMediaId`, `guideVideoMediaId` and `guide.portraitMediaId`. All
      four were READ-ONLY codebase-wide before this, so the `introVideo`, `reel`
      and `guide` sections could never show their primary content.

  The same slots are reachable from each section's inspector (`SectionEditor`'s
  `media` control). Both surfaces read and write the ONE `sellMedia` store, so the
  panel and the inspectors can never disagree about what is pending.

  THE STILL SLOTS (hero, portrait) OFFER VIDEO ONLY, via
  `sellMedia.optionsFor(slot)`. An audio item has no frame by construction — the
  transcoder writes
  `thumbnailKey: null` for anything that is not a video — so picking one for a
  still used to save cleanly, show no error, and leave the section drawing its
  fallback. The store owns the accept-list so the per-section inspector cannot
  offer a different one, and the server re-checks it, because a picker is not a
  boundary.

  All THREE uploads (cover, hero image, signature) and their clears apply
  IMMEDIATELY (a multipart upload has a different failure mode from a JSON patch,
  and the creator needs the resolved URL back to see what they picked). The media
  slots are pending until Save, like page copy.

  THE HERO UPLOAD IS PAIRED WITH THE LIBRARY SLOT IT OUTRANKS, in the copy rather
  than the layout: "Hero image" above / "Hero film" below. Two controls that both
  read as "the hero" would be worse than one, so each hint names the other and
  says which wins. The signature has one control.
-->
<script lang="ts">
  import { MAX_IMAGE_SIZE_BYTES } from '@codex/validation';
  import * as m from '$paraglide/messages';
  import MediaPicker from '$lib/components/studio/MediaPicker.svelte';
  import { UnlinkIcon } from '$lib/components/ui/Icon';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { sellMedia } from '$lib/page-builder/sell-media-store.svelte';
  import { shrinkPhotoAndSubmit } from '$lib/utils/shrink-photo';
  import { PAGE_MEDIA_SLOTS } from './page-media-slots';
  import {
    cappedSizes,
    containSizes,
    coverCropSizes,
    getThumbnailSrcset,
  } from '$lib/utils/image';
  import {
    uploadJourneyCoverForm,
    uploadJourneyHeroImageForm,
    uploadJourneySignatureImageForm,
  } from '$lib/remote/journeys.remote';

  const MAX_COVER_MB = Math.round(MAX_IMAGE_SIZE_BYTES / 1024 / 1024);

  /** The cover and hero previews fill BuilderShell's 23.75rem side panel (`SIDE_REM.panel`). */
  const PREVIEW_SIZES = cappedSizes(100, '23.75rem');

  /**
   * The signature is contained in a 4:1 frame across the panel, so it is drawn
   * at the frame's height times its own ratio, up to the frame's width: inside
   * its 0.5rem padding about 4.3rem tall and 20.5rem wide (Codex-kk9nv.3). As
   * the panel's width it was up to 5.5x over. A folder that does not record
   * the picture's size is taken as a 4:1 mark, as the page's Signature is.
   */
  const signatureSizes = $derived(
    containSizes(sellMedia.signatureImageUrl, 4.3, '20.5rem', 4)
  );

  /** The library slots, in page order (`page-media-slots.ts`). */
  const SLOTS = PAGE_MEDIA_SLOTS;

  let fileInput = $state<HTMLInputElement | null>(null);
  /** Own ref — three independent upload forms, so three independent file inputs. */
  let heroFileInput = $state<HTMLInputElement | null>(null);
  let signatureFileInput = $state<HTMLInputElement | null>(null);

  /**
   * Busy while EITHER the cover form is in flight or the store is clearing.
   *
   * The upload's pending state belongs to the form (a `File` cannot cross a
   * `command()` boundary, so the upload is a real multipart submission — see
   * `uploadJourneyCoverForm`); the clear is still a store command.
   */
  const coverBusy = $derived(
    !!uploadJourneyCoverForm.pending || sellMedia.coverBusy
  );

  /** The same split for the hero image — its own form, its own busy state. */
  const heroImageBusy = $derived(
    !!uploadJourneyHeroImageForm.pending || sellMedia.heroImageBusy
  );

  /** And again for the signature. Three uploads, three independent busy states —
      shared one would disable all three buttons on any one upload. */
  const signatureImageBusy = $derived(
    !!uploadJourneySignatureImageForm.pending || sellMedia.signatureImageBusy
  );

  /**
   * Clear one uploaded still: run the store command, say what happened, surface
   * the store's own error. The THREE copies this replaced differed only in
   * which command and which messages — and the hero/signature success copy says
   * what actually happens next (A32's chain falls through to the film's frame),
   * so each call site keeps naming its own message.
   *
   * The command arrives ALREADY INVOKED-WITH-RECEIVER (`() =>
   * sellMedia.clearCover()`): a bare `sellMedia.clearCover` detaches `this`
   * from the class-based store, the write never runs, and neither typecheck nor
   * a mocked-store test can see it (codex-review SF-001).
   */
  async function onClear(
    clear: () => Promise<void>,
    removed: string,
    failed: string
  ): Promise<void> {
    try {
      await clear();
      toast.success(removed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : failed);
    }
  }
</script>

<div class="panel">
  <header class="panel__head">
    <h2 class="panel__title">{m.studio_builder_media_title()}</h2>
    <p class="panel__sub">{m.studio_builder_panel_page_level()}</p>
  </header>

  <!--
    WHY THE READ FAILURE IS SAID OUT LOUD, and why it sits at the TOP of the panel
    rather than beside the pickers.

    `sellMedia.loadError` existed, was populated by both of `open()`'s reads and
    was rendered NOWHERE: this panel had no reference to it at all, so a failed
    media-library read was indistinguishable from "you have no ready media" — six
    empty pickers, three frames reading "No cover", and no way for the creator to
    tell a hiccup from an empty account. The sibling panel had been wired the whole
    time (`monetisation.loadError` → `PagePricingPanel`), so this is the same
    treatment, deliberately: same `role="alert"`, same warn surface, same
    error-then-loading pair.

    ABOVE EVERYTHING, because the failure explains everything below it. The three
    upload frames read their resolved URLs from the SAME read as the six slots, so
    a failed read makes "No cover" a claim the store cannot support either.

    IT DOES NOT LOCK THE CONTROLS, unlike the pricing panel's `locked`, and that is
    a gap rather than a choice: `MediaPicker` takes no `disabled` prop, so the
    slots stay pickable while `sellMedia.loaded` is false — and such a pick lands
    in the pending draft and is then dropped rather than persisted (see the store's
    `#loaded`). The message is what tells the creator that; the lock needs a prop on
    a component this panel does not own.
  -->
  {#if sellMedia.loadError}
    <p class="panel__warn" role="alert">{sellMedia.loadError}</p>
  {:else if sellMedia.loading}
    <p class="panel__note" role="status">{m.studio_builder_media_loading()}</p>
  {/if}

  <!-- ── Cover ─────────────────────────────────────────────────────────── -->
  <section class="panel__group">
    <h3 class="panel__group-title">{m.studio_builder_media_cover()}</h3>
    <p class="panel__hint">
      {m.studio_builder_media_cover_hint()}
    </p>

    <div class="cover">
      <div class="cover__frame">
        {#if sellMedia.coverImageUrl}
          <img
            class="cover__img"
            src={sellMedia.coverImageUrl}
            srcset={getThumbnailSrcset(sellMedia.coverImageUrl) || undefined}
            sizes={coverCropSizes(PREVIEW_SIZES, 16 / 9, sellMedia.coverImageUrl)}
            alt={m.studio_builder_media_cover_alt()}
          />
        {:else}
          <span class="cover__empty">{m.studio_builder_media_cover_none()}</span>
        {/if}
      </div>

      <!--
        A real multipart <form>, not a button calling a store method. `File`
        cannot be an argument to a `command()` — devalue cannot serialize it, and
        the call threw before reaching the network — so the upload has to be a
        `form()` submission. The picker UX is unchanged: the file input stays
        visually hidden and the styled button opens it, then `change` submits.
      -->
      <form
        class="cover__actions"
        enctype="multipart/form-data"
        {...uploadJourneyCoverForm.enhance(async ({ form, submit }) => {
          // The callback argument is `{ form, data, submit }` in this SvelteKit
          // (2.55) — `form` IS the HTMLFormElement, and the returned value is
          // read from the form function itself, not from this copy. Newer docs
          // describe an `{ element, result }` shape; that is a later version.
          try {
            await submit();
            const result = uploadJourneyCoverForm.result;
            if (result?.outcome === 'uploaded') {
              sellMedia.applyCoverUrl(result.coverImageUrl);
              toast.success(m.studio_builder_media_toast_cover_updated());
            } else {
              // The server's own message (an unsupported format, most commonly)
              // rather than a generic failure — the creator can only fix what
              // they can see.
              toast.error(result?.message ?? m.studio_builder_media_toast_cover_upload_failed());
            }
          } catch (err) {
            toast.error(
              err instanceof Error
                ? err.message
                : m.studio_builder_media_toast_cover_upload_failed()
            );
          } finally {
            // Reset so re-picking the SAME file fires `change` again — without
            // this a failed upload cannot be retried with the identical file.
            form.reset();
          }
        })}
      >
        <input
          {...uploadJourneyCoverForm.fields.pageId.as(
            'hidden',
            sellMedia.pageId ?? ''
          )}
        />
        <!-- `tabindex="-1"` COMPLETES the pattern this form already chose, and
             it is placed AFTER the spread so it wins.

             The comment above states the design: "the file input stays visually
             hidden and the styled button opens it". The input is hidden with the
             1px clip, which keeps it FOCUSABLE — so a keyboard user reached
             three unnamed file inputs in this panel (cover, hero image,
             signature) before ever reaching the buttons that name them. The
             `<button>` is the control and carries the name
             (Upload / Replace / Uploading…); the input is the mechanism. Not
             `aria-hidden` and not `display: none`: it is a real form control
             that has to submit, and Safari will not submit a `display: none`
             file input's selection reliably. -->
        <input
          bind:this={fileInput}
          class="cover__file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          {...uploadJourneyCoverForm.fields.cover.as('file')}
          tabindex="-1"
          onchange={shrinkPhotoAndSubmit}
        />
        <button
          type="button"
          class="cover__btn"
          disabled={coverBusy || !sellMedia.pageId}
          onclick={() => fileInput?.click()}
        >
          {coverBusy
            ? m.studio_builder_media_uploading()
            : sellMedia.coverImageUrl
              ? m.studio_builder_media_replace()
              : m.studio_builder_media_upload()}
        </button>
        {#if sellMedia.coverImageUrl}
          <button
            type="button"
            class="cover__btn cover__btn--quiet"
            disabled={coverBusy}
            onclick={() =>
            onClear(
              () => sellMedia.clearCover(),
              m.studio_builder_media_toast_cover_removed(),
              m.studio_builder_media_toast_cover_remove_failed()
            )}
          >
            {m.studio_builder_media_remove()}
          </button>
        {/if}
        <span class="panel__hint">{m.studio_builder_media_formats({ mb: MAX_COVER_MB })}</span>
      </form>
    </div>
  </section>

  <!-- ── Hero image (Codex-490z7 · A32) ────────────────────────────────── -->
  <section class="panel__group">
    <h3 class="panel__group-title">{m.studio_builder_media_hero_image()}</h3>
    <p class="panel__hint">
      {m.studio_builder_media_hero_image_hint()}
    </p>

    <div class="cover">
      <div class="cover__frame cover__frame--hero">
        {#if sellMedia.heroImageUrl}
          <img
            class="cover__img"
            src={sellMedia.heroImageUrl}
            srcset={getThumbnailSrcset(sellMedia.heroImageUrl) || undefined}
            sizes={coverCropSizes(PREVIEW_SIZES, 21 / 9, sellMedia.heroImageUrl)}
            alt={m.studio_builder_media_hero_image_alt()}
          />
        {:else}
          <span class="cover__empty">{m.studio_builder_media_hero_image_none()}</span>
        {/if}
      </div>

      <!--
        A second real multipart <form>, deliberately identical to the cover's
        above. `File` cannot be an argument to a `command()` — devalue cannot
        serialize it, and the call throws in the BROWSER before reaching the
        network — so an upload has to be a `form()` submission. See
        `uploadJourneyHeroImageForm`.
      -->
      <form
        class="cover__actions"
        enctype="multipart/form-data"
        {...uploadJourneyHeroImageForm.enhance(async ({ form, submit }) => {
          try {
            await submit();
            const result = uploadJourneyHeroImageForm.result;
            if (result?.outcome === 'uploaded') {
              sellMedia.applyHeroImageUrl(result.heroImageUrl);
              toast.success(m.studio_builder_media_toast_hero_image_updated());
            } else {
              // The server's own message (an unsupported format, most commonly),
              // never a generic failure — a creator can only fix what they see.
              toast.error(
                result?.message ??
                  m.studio_builder_media_toast_hero_image_upload_failed()
              );
            }
          } catch (err) {
            toast.error(
              err instanceof Error
                ? err.message
                : m.studio_builder_media_toast_hero_image_upload_failed()
            );
          } finally {
            // Reset so re-picking the SAME file fires `change` again — without
            // this a failed upload cannot be retried with the identical file.
            form.reset();
          }
        })}
      >
        <input
          {...uploadJourneyHeroImageForm.fields.pageId.as(
            'hidden',
            sellMedia.pageId ?? ''
          )}
        />
        <input
          bind:this={heroFileInput}
          class="cover__file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          {...uploadJourneyHeroImageForm.fields.image.as('file')}
          tabindex="-1"
          onchange={shrinkPhotoAndSubmit}
        />
        <button
          type="button"
          class="cover__btn"
          disabled={heroImageBusy || !sellMedia.pageId}
          onclick={() => heroFileInput?.click()}
        >
          {heroImageBusy
            ? m.studio_builder_media_uploading()
            : sellMedia.heroImageUrl
              ? m.studio_builder_media_replace()
              : m.studio_builder_media_upload()}
        </button>
        {#if sellMedia.heroImageUrl}
          <button
            type="button"
            class="cover__btn cover__btn--quiet"
            disabled={heroImageBusy}
            onclick={() =>
            onClear(
              () => sellMedia.clearHeroImage(),
              m.studio_builder_media_toast_hero_image_removed(),
              m.studio_builder_media_toast_hero_image_remove_failed()
            )}
          >
            {m.studio_builder_media_remove()}
          </button>
        {/if}
        <span class="panel__hint">{m.studio_builder_media_formats({ mb: MAX_COVER_MB })}</span>
      </form>
    </div>
  </section>

  <!-- ── Signature image (Codex-wqxv4 · the named-slot half) ───────────── -->
  <section class="panel__group">
    <h3 class="panel__group-title">{m.studio_builder_media_signature_image()}</h3>
    <p class="panel__hint">
      {m.studio_builder_media_signature_image_hint()}
    </p>

    <div class="cover">
      <div class="cover__frame cover__frame--signature">
        {#if sellMedia.signatureImageUrl}
          <img
            class="cover__img cover__img--contain"
            src={sellMedia.signatureImageUrl}
            srcset={getThumbnailSrcset(sellMedia.signatureImageUrl) || undefined}
            sizes={signatureSizes}
            alt={m.studio_builder_media_signature_image_alt()}
          />
        {:else}
          <span class="cover__empty"
            >{m.studio_builder_media_signature_image_none()}</span
          >
        {/if}
      </div>

      <!--
        The third real multipart <form>, deliberately identical to the two above.
        `File` cannot be an argument to a `command()` — devalue cannot serialize
        it, and the call throws in the BROWSER before reaching the network — so an
        upload has to be a `form()` submission. See
        `uploadJourneySignatureImageForm`.
      -->
      <form
        class="cover__actions"
        enctype="multipart/form-data"
        {...uploadJourneySignatureImageForm.enhance(async ({ form, submit }) => {
          try {
            await submit();
            const result = uploadJourneySignatureImageForm.result;
            if (result?.outcome === 'uploaded') {
              sellMedia.applySignatureImageUrl(result.signatureImageUrl);
              toast.success(m.studio_builder_media_toast_signature_image_updated());
            } else {
              // The server's own message (an unsupported format, most commonly),
              // never a generic failure — a creator can only fix what they see.
              toast.error(
                result?.message ??
                  m.studio_builder_media_toast_signature_image_upload_failed()
              );
            }
          } catch (err) {
            toast.error(
              err instanceof Error
                ? err.message
                : m.studio_builder_media_toast_signature_image_upload_failed()
            );
          } finally {
            // Reset so re-picking the SAME file fires `change` again — without
            // this a failed upload cannot be retried with the identical file.
            form.reset();
          }
        })}
      >
        <input
          {...uploadJourneySignatureImageForm.fields.pageId.as(
            'hidden',
            sellMedia.pageId ?? ''
          )}
        />
        <input
          bind:this={signatureFileInput}
          class="cover__file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          {...uploadJourneySignatureImageForm.fields.image.as('file')}
          tabindex="-1"
          onchange={shrinkPhotoAndSubmit}
        />
        <button
          type="button"
          class="cover__btn"
          disabled={signatureImageBusy || !sellMedia.pageId}
          onclick={() => signatureFileInput?.click()}
        >
          {signatureImageBusy
            ? m.studio_builder_media_uploading()
            : sellMedia.signatureImageUrl
              ? m.studio_builder_media_replace()
              : m.studio_builder_media_upload()}
        </button>
        {#if sellMedia.signatureImageUrl}
          <button
            type="button"
            class="cover__btn cover__btn--quiet"
            disabled={signatureImageBusy}
            onclick={() =>
            onClear(
              () => sellMedia.clearSignatureImage(),
              m.studio_builder_media_toast_signature_image_removed(),
              m.studio_builder_media_toast_signature_image_remove_failed()
            )}
          >
            {m.studio_builder_media_remove()}
          </button>
        {/if}
        <span class="panel__hint">{m.studio_builder_media_formats({ mb: MAX_COVER_MB })}</span>
      </form>
    </div>
  </section>

  <!-- ── Sell media ────────────────────────────────────────────────────── -->
  <section class="panel__group">
    <h3 class="panel__group-title">{m.studio_builder_media_slots_title()}</h3>
    <p class="panel__hint">
      {m.studio_builder_media_slots_hint()}
    </p>

    {#each SLOTS as entry (entry.slot)}
      {@const slotLabelId = `jm-${entry.slot}`}
      {@const missing = sellMedia.missingTitle(entry.slot)}
      <!--
        `role="group"` + `aria-labelledby`: `MediaPicker` renders a combobox input
        plus a clear button (plus a preview button once something is chosen), so a
        `<label>` wrapping it would label none of them — and Melt's own
        `aria-labelledby` on the input points at a `$label` element the picker never
        renders, so it DANGLES and the widget's name falls through to the shared
        placeholder "Select media...". Every slot in `SLOTS` named identically is
        not a name — and the count is deliberately not written out here, because a
        stated number goes stale the first time a slot is added.
        The full fix is a label prop on `MediaPicker` (handed off); a named group is
        what this panel can do, and the section inspector does the same.
      -->
      <div class="panel__field" role="group" aria-labelledby={slotLabelId}>
        <span class="panel__label" id={slotLabelId}>{entry.label()}</span>
        <!--
          `optionsFor`, not `options`: the STILL slots offer video only.
          An audio item has `thumbnailKey: null` by construction, so offering one
          here let a creator pick something that could only ever resolve to
          nothing — saved clean, no error, section unchanged. The accept-list
          lives in the store so this panel and the section inspectors cannot
          disagree; the server re-checks it regardless.
        -->
        <!-- Same reasoning as the section inspector's picker: the wrapper's
             `role="group"` names the FIELD, while Melt's dangling
             `aria-labelledby` left the TRIGGER falling through to the shared
             "Select media…" placeholder — four slots, one name between them.
             `entry.label()` is the visible label, so they cannot drift.
             NO `disabled` here on purpose — see the note at the section inspector's
             picker. `setSlot` is unguarded and `save()` no-ops on an unloaded store,
             so a pick made during the read IS silently discarded; the fix belongs in
             the store, and `!loaded` is also true after a failed read. Filed. -->
        <MediaPicker
          mediaItems={sellMedia.optionsFor(entry.slot)}
          value={sellMedia.slot(entry.slot)}
          name={`journey-media-${entry.slot}`}
          ariaLabel={entry.label()}
          showLibraryLink
          onchange={(mediaItemId) => sellMedia.setSlot(entry.slot, mediaItemId)}
        />
        <span class="panel__hint">{entry.hint()}</span>
        <!--
          The slot's media was deleted from its library (Codex-6sbn1). The
          course keeps the link (a support restore heals it), so the picker
          above reads empty with no reason; this is the reason. The public page
          shows the section's empty prompt.
        -->
        {#if missing}
          <p class="panel__missing" role="status">
            <UnlinkIcon size={14} />
            <span>{m.studio_builder_media_slot_missing({ title: missing })}</span>
          </p>
        {/if}
        <!--
          Owner P10: the sales page plays a film in full unless paid content
          uses it, and then only its 30-second preview. Said here, under the
          slot, the moment such a film is picked or found already attached, so
          the cut is never a surprise on the live page. The note covers PAID
          USE only, the one reason a creator acts on here; it uses the public
          stream's own paid-use test (`paidUse` in `sales-films.ts`), read once
          with the panel. The stream also refuses media that is not ready, or
          whose creator has left the org, and says nothing of those here.
        -->
        {#if sellMedia.previewOnly(entry.slot)}
          <p class="panel__note" role="status">
            {m.studio_builder_media_slot_preview_only()}
          </p>
        {/if}
      </div>
    {/each}
  </section>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-4);
  }

  .panel__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .panel__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  /* NO `--color-text-muted` in this panel, deliberately, and the guard in
     `page-builder/journey-palette.test.ts` now enforces it (Codex-6nb7i).
     Measured on the studio panel surface by canvas readback: muted at
     `--text-xs` is 2.52:1 light / 3.19:1 dark, under the 4.5 floor, and 13px is
     not WCAG "large text". The muted strings here included the group headings
     ("Cover", "Videos & portrait" — the same case SectionEditor already fixed)
     and every slot hint, one of which is "JPG, PNG, WebP or GIF · up to {N}MB":
     the string that stops a creator wasting an upload. Secondary reads
     7.81 / 10.21, and tracks `--color-text` so it holds on any brand
     background. */
  .panel__sub {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .panel__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .panel__group-title {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
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

  .panel__hint {
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    color: var(--color-text-secondary);
  }

  /* The read-failure surface, token-for-token the one `PagePricingPanel` gives
     `monetisation.loadError` — the two panels report the same class of failure
     and a creator should not have to learn two treatments for it. The WARNING
     ramp rather than the danger one: nothing is broken and nothing is lost, the
     store simply could not ask. */
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

  /* A slot whose media was deleted (Codex-6sbn1): the warning ramp of
     `.panel__warn`, dashed because the slot still holds the link. */
  .panel__missing {
    display: flex;
    align-items: flex-start;
    gap: var(--space-1-5);
    margin: 0;
    padding: var(--space-2);
    border: var(--border-width) dashed var(--color-status-warning-border);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-status-warning-surface) 55%, var(--color-surface));
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    color: var(--color-status-warning-text);
  }

  .panel__missing > :global(svg) {
    flex-shrink: 0;
    margin-top: var(--space-0-5);
  }

  /* The in-flight twin. `--color-text-secondary`, never muted: muted at
     `--text-xs` measures 2.52:1 on this surface, under the floor (see the
     `.panel__sub` note above), and this line is the one that explains an empty
     picker. */
  .panel__note {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  /* ── Cover ─────────────────────────────────────────────────────────────
     The frame keeps the card's 16/9 ratio so what the creator previews here is
     the shape the card renders. */
  .cover {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .cover__frame {
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
  }

  /*
    The hero preview is WIDER than the cover's 16/9 because the hero paints
    edge to edge — 21/9 is the aspect the `bleed` media axis gives a full-bleed
    hero, so the frame previews the crop the page will actually take rather than
    a card-shaped one the hero never uses.
  */
  .cover__frame--hero {
    aspect-ratio: 21 / 9;
  }

  /*
    A signature is WIDE and SHORT, and painted small: `GuideSection`'s
    `.guide__sig` is sized by HEIGHT (`calc(var(--jp-heading-size) * 1.6)`) with
    `width: auto`, so a typical mark lands around 200–400px wide by 50–100px tall.
    4/1 previews that proportion instead of a card-shaped box a signature never
    fills.

    The surface stays `--color-surface-secondary` — a theme-following token, NOT a
    forced white plate. A signature is usually dark ink on transparency, so a fixed
    light plate here would flatter the file in dark theme while the letter itself
    paints it on a dark background. Previewing on the same surface the creator's
    own theme gives is the honest read.
  */
  .cover__frame--signature {
    aspect-ratio: 4 / 1;
  }

  .cover__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /*
    `contain`, not the sibling's `cover`: a cover and a hero are CROPPED to a frame
    on the page, so previewing them cropped is accurate. A signature is never
    cropped — the whole mark is painted — and `cover` on a 4/1 box would slice the
    ends off a wide one, which is exactly the part a creator checks.
  */
  .cover__img--contain {
    object-fit: contain;
    padding: var(--space-2);
  }

  .cover__empty {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .cover__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  /* Hidden but still a real, focusable input — the visible button forwards to it,
     which keeps the native file dialog and its accessibility intact. */
  .cover__file {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  .cover__btn {
    padding: var(--space-1-5) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .cover__btn:hover:not(:disabled) {
    background-color: var(--color-surface-secondary);
    border-color: var(--color-border-strong);
  }

  .cover__btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .cover__btn:disabled {
    opacity: var(--opacity-60);
    cursor: not-allowed;
  }

  .cover__btn--quiet {
    color: var(--color-text-secondary);
  }
</style>
