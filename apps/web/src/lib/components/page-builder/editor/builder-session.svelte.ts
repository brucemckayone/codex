/**
 * The page editor's session (docs/design/landing-builder/01-contract.md §7,
 * WP-7b): everything between the route and the canvas that is not layout.
 *
 * It owns the reads the canvas renders against, opens the three stores on an
 * UPGRADED page, saves through `saveBuilderDraft`, runs the draft/published
 * split (a draft autosaves; a live page collects changes for "Publish
 * changes"), the three status transitions, and the guards that stop a creator
 * losing work. The reads mirror the legacy route (`../page/+page.svelte`),
 * whose comments carry the reasoning for each.
 *
 * Create it during component initialisation: it registers a navigation guard
 * and an unload guard, and its teardown closes the stores.
 */
import type {
  PageBuilderState,
  PageOffer,
  PageStatus,
} from '@codex/shared-types';
import { buildJourneyUrl } from '@codex/urls';
import { untrack } from 'svelte';
import { beforeNavigate, goto, invalidate } from '$app/navigation';
import { page as appPage } from '$app/state';
import { toast } from '$lib/components/ui/Toast/toast-store';
import type { JourneyPageRecord } from '$lib/page-builder';
import {
  type AutosaveSaveResult,
  type AutosaveStatus,
  createAutosave,
  guardUnload,
} from '$lib/page-builder/autosave.svelte';
import {
  type PersistedPageOffer,
  type SavePagePayload,
  saveBuilderDraft,
} from '$lib/page-builder/builder-save';
import {
  DEFINITIONS,
  type KitPage,
  type SectionTypeId,
  starterSection,
  type TemplateContext,
  validateKitShape,
} from '$lib/page-builder/kit';
import { isSectionTypeId } from '$lib/page-builder/kit/model/ids';
import {
  type RecipeId,
  recipeSections,
} from '$lib/page-builder/kit/model/recipes';
import { upgradePage } from '$lib/page-builder/kit/model/upgrade';
import { monetisation } from '$lib/page-builder/monetisation-store.svelte';
import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
import { builderSalesContext } from '$lib/page-builder/render/builder-context';
import type { JourneySalesContext } from '$lib/page-builder/render/types';
import { sellMedia } from '$lib/page-builder/sell-media-store.svelte';
import {
  getCourseCurriculum,
  getCourseOffer,
  getCoursePagePreview,
  getJourneyForBuilder,
  resolveSellPreview,
  saveJourneyPage,
  updateJourneyOffer,
} from '$lib/remote/journeys.remote';
import { queryErrorMessage } from '$lib/remote/query-result';
import * as m from '$paraglide/messages';

export type SessionLoad = 'loading' | 'error' | 'missing' | 'ready';
export type SessionBusy = 'publishing' | 'unpublishing' | null;

export interface PublishResult {
  ok: boolean;
  /** The section the creator has to fix before the page can go live. */
  reveal?: string;
}

export interface BuilderSession {
  readonly load: SessionLoad;
  readonly loadError: string | null;
  reload(): void;
  /** The page the canvas renders — the pending draft, upgraded. */
  readonly page: KitPage | null;
  readonly context: JourneySalesContext;
  readonly template: TemplateContext;
  readonly status: PageStatus;
  /** Page, media or pricing differ from what is saved. */
  readonly isDirty: boolean;
  readonly hasUnpublishedChanges: boolean;
  readonly saveStatus: AutosaveStatus;
  readonly saveError: string | undefined;
  readonly busy: SessionBusy;
  /**
   * Another tab saved this page after it was opened here. This copy is older,
   * so nothing in it saves or publishes again until the creator reloads.
   */
  readonly stale: boolean;
  /** Reload the browser tab — the way out of {@link stale}. */
  reloadTab(): void;
  /**
   * A read the canvas is drawn from — curriculum, course details, sell
   * preview, price — failed, so the page shown may be missing parts. False
   * while a read is still loading, and once the creator puts the notice away.
   */
  readonly contextError: boolean;
  /** Read each failed read again. */
  retryContext(): void;
  /** Put the notice away, until a read fails again. */
  dismissContextError(): void;
  retrySave(): void;
  publish(): Promise<PublishResult>;
  publishChanges(): Promise<PublishResult>;
  unpublish(): Promise<boolean>;
  preview(): Promise<void>;
  insertSection(type: SectionTypeId, afterId: string | null): string;
  /** Fill the page from a starting page (`recipes.ts`), as one undoable step. */
  startFromTemplate(recipe: RecipeId): void;
}

/** Key-order-insensitive JSON form, `undefined` keys dropped as JSON does. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const bag = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(bag)
        .filter((key) => bag[key] !== undefined)
        .sort()
        .map((key) => [key, canonical(bag[key])])
    );
  }
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function toKitPage(state: PageBuilderState): KitPage {
  return upgradePage({ design: state.design, sections: state.sections });
}

export function createBuilderSession(options: {
  pageId: () => string;
}): BuilderSession {
  const pageId = $derived(options.pageId());

  // ── Reads ────────────────────────────────────────────────────────────────
  const draftQuery = $derived(
    pageId ? getJourneyForBuilder({ id: pageId }) : null
  );
  const record = $derived<JourneyPageRecord | null>(
    draftQuery?.current ?? null
  );
  const isCourse = $derived(record?.subjectType === 'course');
  const courseId = $derived(record?.subjectId ?? '');
  const curriculumQuery = $derived(
    isCourse && pageId ? getCourseCurriculum({ pageId }) : null
  );
  const stages = $derived(curriculumQuery?.current?.stages ?? []);
  // The SAVED slug keys the course read: after an autosaved rename the old
  // slug no longer resolves, and the pending one would re-read per keystroke.
  const savedSlug = $derived(pageBuilder.saved?.slug ?? record?.slug ?? '');
  const coursePageQuery = $derived(
    isCourse && savedSlug ? getCoursePagePreview({ slug: savedSlug }) : null
  );
  const courseFacts = $derived(coursePageQuery?.current?.course ?? null);
  const testimonials = $derived(coursePageQuery?.current?.testimonials ?? []);
  const sellPreviewQuery = $derived(
    isCourse && pageId && courseId
      ? resolveSellPreview({ pageId, courseId })
      : null
  );
  const sellPreview = $derived(sellPreviewQuery?.current ?? null);
  const offerQuery = $derived(
    isCourse && courseId ? getCourseOffer({ courseId }) : null
  );
  // The canvas shows what a PROSPECT sees. The studio's offer read reports the
  // VIEWER's entitlement, and the owner is always entitled — left in, every
  // CTA on the canvas would be the member's "Continue".
  const offer = $derived(
    offerQuery?.current ? { ...offerQuery.current, entitled: false } : null
  );

  // Each read above falls back to its EMPTY shape, which is right while it
  // loads and wrong once it has failed: a rejected read renders as "no
  // stages", "no price", every image on its plate — content that exists,
  // shown as missing. So a failure says so on the canvas instead, and Retry
  // re-reads only what failed.
  const failedReads = $derived(
    [curriculumQuery, coursePageQuery, sellPreviewQuery, offerQuery].flatMap(
      (query) =>
        query && !query.loading && queryErrorMessage(query.error) !== null
          ? [query]
          : []
    )
  );
  /** The failures the creator put away. A NEW failure raises the notice again. */
  let dismissedErrors = $state.raw<unknown[]>([]);
  const contextError = $derived(
    failedReads.some((query) => !dismissedErrors.includes(query.error))
  );

  function retryContext(): void {
    for (const query of failedReads) {
      // The outcome arrives through the query itself; this promise only
      // rejects with the same failure.
      void query.refresh().catch(() => {});
    }
  }

  function dismissContextError(): void {
    dismissedErrors = failedReads.map((query) => query.error);
  }

  const draftError = $derived(queryErrorMessage(draftQuery?.error));
  const draftMissing = $derived(
    !!draftQuery && !draftQuery.loading && draftQuery.current === null
  );
  const load = $derived.by<SessionLoad>(() => {
    if (pageBuilder.isOpen && pageBuilder.pageId === pageId) return 'ready';
    if (draftError) return 'error';
    if (draftMissing) return 'missing';
    return 'loading';
  });

  // ── What the canvas renders ──────────────────────────────────────────────
  const kitPage = $derived(
    pageBuilder.pending ? toKitPage(pageBuilder.pending) : null
  );
  const course = $derived({
    id: courseId,
    slug: savedSlug,
    title: pageBuilder.pending?.title || record?.title || '',
    kicker: courseFacts?.kicker ?? null,
    lede: courseFacts?.lede ?? null,
  });
  const journeyTarget = $derived({ slug: course.slug || null, id: course.id });
  const checkoutUrl = $derived(
    buildJourneyUrl(appPage.url, journeyTarget, { surface: 'checkout' })
  );
  const dashboardUrl = $derived(
    buildJourneyUrl(appPage.url, journeyTarget, { surface: 'dashboard' })
  );
  // One promise per sell-preview VALUE. The blocks `{#await}` it, and a fresh
  // promise on every context rebuild (every title keystroke) would remount
  // their media each time.
  const sellPreviewPromise = $derived(Promise.resolve(sellPreview));
  const context = $derived<JourneySalesContext>({
    ...builderSalesContext({
      course,
      stages,
      testimonials,
      offer,
      checkoutUrl,
      dashboardUrl,
      sellPreview,
      // Page images (contract A3) resolve against the same CDN base as public.
      mediaBaseUrl: coursePageQuery?.current?.mediaBaseUrl ?? null,
    }),
    sellPreview: sellPreviewPromise,
  });
  const template = $derived<TemplateContext>({
    courseTitle: course.title,
    courseLede: course.lede,
  });

  // ── Dirty state ──────────────────────────────────────────────────────────
  const isDirty = $derived(
    pageBuilder.isDirty || sellMedia.isDirty || monetisation.isDirty
  );
  const status = $derived<PageStatus>(pageBuilder.pending?.status ?? 'draft');
  const isPublished = $derived(status === 'published');

  /** The status the server last accepted — see `setLive`. */
  let persistedStatus: PageStatus | null = null;
  /**
   * The offer the server last accepted: what the offer leg compares against
   * to decide whether to send. It moves the moment that leg lands, while the
   * page's saved baseline moves only once EVERY leg has — so an offer that
   * landed before a later leg failed would otherwise still read as the old
   * one, and setting it back to the old value would never be sent.
   */
  let persistedOffer: PageOffer | undefined;
  let busy = $state<SessionBusy>(null);
  let stale = $state(false);

  // ── Open ─────────────────────────────────────────────────────────────────
  $effect(() => {
    const id = pageId;
    const loaded = record;
    if (!id || !loaded || loaded.id !== id || pageBuilder.pageId === id) return;
    untrack(() => openStores(id, loaded));
  });

  function openStores(id: string, loaded: JourneyPageRecord): void {
    const {
      id: _rowId,
      organizationId: _orgId,
      publishedAt: _publishedAt,
      ...editable
    } = loaded;
    // The kit reads v2 only; the saved baseline is the upgraded page, so a
    // legacy row is rewritten to v2 on its first save (contract §3).
    const kit = toKitPage(editable);
    const baseline: PageBuilderState = {
      ...editable,
      design: kit.design,
      sections: kit.sections,
    };
    // A restored draft was edited from exactly this page (the store checks),
    // so it autosaves like any edit. A discarded one was not, and saving it
    // would have written the older page over the newer one.
    const recovery = pageBuilder.open(id, baseline);
    if (recovery === 'restored') {
      toast.info(m.studio_page_editor_recovery_restored());
    } else if (recovery === 'discarded') {
      toast.warning(m.studio_page_editor_recovery_discarded());
    }
    persistedStatus = baseline.status;
    persistedOffer = baseline.offer;
    stale = false;
    void sellMedia.open(id, {
      hasCourse: loaded.subjectType === 'course' && !!loaded.subjectId,
    });
    void monetisation.open(
      loaded.subjectType === 'course' ? loaded.subjectId : null
    );
  }

  // ── Other tabs ───────────────────────────────────────────────────────────
  /**
   * Two tabs on one page would each autosave their own copy over the other's:
   * a save sends the WHOLE page. So every save is announced on a channel for
   * this page, and a tab that hears another tab saved it goes STALE — it stops
   * saving and publishing, and the canvas says to reload.
   *
   * Best effort by design: without `BroadcastChannel` nothing is heard, and a
   * second DEVICE is out of reach of any tab-to-tab signal.
   */
  const tabId = crypto.randomUUID();
  let channel: BroadcastChannel | null = null;

  $effect(() => {
    const id = pageId;
    if (!id || typeof BroadcastChannel === 'undefined') return;
    const opened = new BroadcastChannel(`codex:page-builder:${id}`);
    opened.onmessage = (event: MessageEvent<{ tab?: unknown }>) => {
      const from = event.data?.tab;
      if (typeof from === 'string' && from !== tabId) goStale();
    };
    channel = opened;
    return () => {
      opened.close();
      if (channel === opened) channel = null;
    };
  });

  function goStale(): void {
    if (stale) return;
    stale = true;
    autosave.cancel();
  }

  /** Tell the page's other tabs that the server's copy just moved. */
  function announceSave(): void {
    try {
      channel?.postMessage({ tab: tabId });
    } catch {
      // Closed under a save that outlived the editor: nobody left to tell.
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  /** What the server holds once `sent` has landed: the offer as persisted. */
  function landed(
    sent: PageBuilderState,
    synced: PersistedPageOffer | null
  ): PageBuilderState {
    return synced
      ? { ...sent, offer: { ...(sent.offer ?? {}), ...synced } }
      : sent;
  }

  /**
   * Did the draft change while the write was in flight? The store's plain
   * `markSaved()` baselines the CURRENT draft, so keystrokes typed during an
   * autosave would be marked saved without ever being sent. When they exist,
   * the baseline moves to what landed instead, and the next save sends them.
   */
  function unchangedSince(
    sent: PageBuilderState,
    synced: PersistedPageOffer | null
  ): boolean {
    const now = pageBuilder.getSavePayload();
    return !!now && sameValue(now, landed(sent, synced));
  }

  /**
   * The save body accepts only v2 section types (WP-9b). An upgraded page
   * holds nothing else, so this narrows the TYPE for the remote rather than
   * changing data — a stray non-v2 section (impossible after `upgradePage`)
   * is dropped instead of 400-ing the whole save.
   */
  function toV2SaveBody(input: SavePagePayload) {
    return {
      ...input,
      sections: input.sections.flatMap((section) =>
        isSectionTypeId(section.type)
          ? [{ ...section, type: section.type }]
          : []
      ),
    };
  }

  async function saveNow(): Promise<AutosaveSaveResult> {
    // The one gate every save passes: a stale copy would write over newer work.
    if (stale)
      return { ok: false, message: m.studio_page_editor_stale_banner() };
    if (!isDirty) return { ok: true };
    const payload = pageBuilder.getSavePayload();
    const rowId = record?.id;
    if (!payload || !rowId) {
      return { ok: false, message: m.studio_builder_toast_draft_loading() };
    }
    let synced: PersistedPageOffer | null = null;
    const result = await saveBuilderDraft({
      pageId: rowId,
      payload,
      savedOffer: persistedOffer,
      savePage: (input) => saveJourneyPage(toV2SaveBody(input)),
      saveOffer: async (input) => {
        const saved = await updateJourneyOffer(input);
        persistedOffer = input.offer;
        return saved;
      },
      monetisation: {
        isDirty: monetisation.isDirty,
        save: () => monetisation.save(),
        presentation: () => monetisation.presentationOffer,
      },
      sellMedia: {
        isDirty: sellMedia.isDirty,
        save: () => sellMedia.save(),
      },
      syncOffer: (next) => {
        synced = next;
        // Only over the offer that was SENT. A price typed while this save was
        // in flight is newer than `next`: overwriting it would make the draft
        // match the payload, so it would be marked saved and never sent.
        if (!sameValue(pageBuilder.pending?.offer, payload.offer)) return;
        // The server's normalised offer, not a creator edit — no undo step.
        pageBuilder.updateOffer(next, { record: false });
      },
      markSaved: () => {
        // Autosave is a checkpoint, not a commit point: keep the undo stack.
        pageBuilder.markSaved(
          unchangedSince(payload, synced)
            ? { keepHistory: true }
            : { keepHistory: true, baseline: landed(payload, synced) }
        );
      },
      refresh: () => invalidate('cache:versions'),
      refreshQueries: ({ offer: offerMoved, media }) =>
        Promise.all([
          offerMoved ? offerQuery?.refresh() : undefined,
          media ? sellPreviewQuery?.refresh() : undefined,
        ]),
    });
    if (result.outcome === 'failed') {
      // Every stage after `page` means the page row — its status included —
      // already landed, so the other tabs' copies are just as out of date.
      if (result.stage !== 'page') {
        persistedStatus = payload.status;
        announceSave();
      }
      return { ok: false, message: result.message };
    }
    persistedStatus = payload.status;
    announceSave();
    if (result.staleWarning) toast.warning(result.staleWarning);
    return { ok: true };
  }

  const autosave = createAutosave({
    isDirty: () => isDirty,
    isPublished: () => isPublished,
    save: saveNow,
  });

  // Every change restarts the draft's debounce. A published page is ignored
  // by the controller itself, so its changes accumulate for "Publish changes".
  const changeSignal = $derived(
    pageBuilder.isOpen
      ? JSON.stringify([
          pageBuilder.pending,
          sellMedia.slots,
          monetisation.draft,
        ])
      : null
  );
  $effect(() => {
    if (changeSignal === null) return;
    untrack(() => {
      if (isDirty && !stale) autosave.notifyChange();
    });
  });

  // A BACKGROUND autosave toasts once per distinct failure; a success in
  // between re-arms it. An action the creator started reports its own failure
  // (see `flushForAction`), and a stale tab's banner already says why nothing
  // saves.
  let toastedError: string | null = null;
  let acting = 0;
  $effect(() => {
    const now = autosave.status;
    const message = autosave.errorMessage;
    untrack(() => {
      if (now === 'saved') toastedError = null;
      if (now !== 'error' || !message || message === toastedError) return;
      if (stale || acting > 0) return;
      toastedError = message;
      toast.error(m.studio_page_editor_toast_save_failed(), message);
    });
  });

  /**
   * Save for something the creator just asked for — Publish, Publish changes,
   * Unpublish, Preview, leaving. The caller reports a failure with
   * {@link reportFailure}, EVERY time: left to the deduped toast above, an
   * action failing the same way as the last autosave would say nothing, and
   * the click would look like it did nothing.
   */
  async function flushForAction(): Promise<AutosaveSaveResult> {
    acting += 1;
    try {
      return await autosave.flush();
    } finally {
      acting -= 1;
    }
  }

  function reportFailure(message: string | undefined): void {
    // The creator has now seen it: a background repeat need not toast again.
    toastedError = message ?? null;
    toast.error(m.studio_page_editor_toast_save_failed(), message);
  }

  // ── Status transitions ───────────────────────────────────────────────────
  /**
   * Flip the status and save it. `flush()` rides a save that is already in
   * flight — one sent BEFORE the status changed — so a second flush sends
   * the new status. The status is rolled back only when the server never
   * accepted it (a failure after the page leg means it did).
   */
  async function setLive(next: 'published' | 'draft'): Promise<boolean> {
    const previous = status;
    busy = next === 'published' ? 'publishing' : 'unpublishing';
    try {
      // Never an undo step: undo walks back edits, not whether the page is live.
      pageBuilder.updateMeta('status', next, { record: false });
      let result = await flushForAction();
      if (result.ok && persistedStatus !== next) {
        result = await flushForAction();
      }
      if (!result.ok && persistedStatus !== next) {
        pageBuilder.updateMeta('status', previous, { record: false });
      }
      // A flush can resolve without having sent the status (the editor closed
      // under it), so only what the server holds counts as done.
      const landed = result.ok && persistedStatus === next;
      if (!landed) reportFailure(result.message);
      return landed;
    } finally {
      busy = null;
    }
  }

  /** The shape errors a live page must not have, surfaced and focused. */
  function blockedBy(): PublishResult | null {
    const blockers = kitPage
      ? validateKitShape(kitPage).filter((issue) => issue.severity === 'error')
      : [];
    if (blockers.length === 0) return null;
    toast.error(
      m.studio_page_editor_publish_blocked(),
      blockers.map((issue) => issue.message).join(' ')
    );
    const reveal = blockers.find((issue) => issue.sectionId)?.sectionId;
    if (reveal) pageBuilder.selectSection(reveal);
    return { ok: false, reveal };
  }

  // A stale tab publishes nothing: its copy is older than the server's, and
  // publishing it would put the older page live over the newer one.
  async function publish(): Promise<PublishResult> {
    if (busy || stale) return { ok: false };
    const blocked = blockedBy();
    if (blocked) return blocked;
    const ok = await setLive('published');
    if (ok) toast.success(m.studio_builder_toast_published());
    return { ok };
  }

  async function publishChanges(): Promise<PublishResult> {
    if (busy || stale) return { ok: false };
    const blocked = blockedBy();
    if (blocked) return blocked;
    busy = 'publishing';
    try {
      const result = await flushForAction();
      if (result.ok) {
        toast.success(m.studio_page_editor_toast_changes_published());
      } else {
        reportFailure(result.message);
      }
      return { ok: result.ok };
    } finally {
      busy = null;
    }
  }

  async function unpublish(): Promise<boolean> {
    if (busy || stale) return false;
    const ok = await setLive('draft');
    if (ok) toast.success(m.studio_page_editor_toast_unpublished());
    return ok;
  }

  /**
   * Open the public page. A draft is saved first so the preview shows it; a
   * LIVE page is never flushed from here — that would publish — so the
   * creator is told the preview shows what is live.
   *
   * The tab opens IN the click, before any save. A browser blocks a tab
   * opened after an await once the click's activation has lapsed, and a save
   * of four legs can outlast it. So the tab opens blank and is sent to the
   * page once the save lands — or closed, with the reason, if it fails.
   */
  async function preview(): Promise<void> {
    // A stale tab's copy is never saved first: the preview shows the newer
    // copy the other tab saved.
    const saveFirst = isDirty && !isPublished && !stale;
    if (!saveFirst && !pageBuilder.saved?.slug) {
      toast.error(m.studio_page_editor_need_slug());
      return;
    }
    const tab = window.open('', '_blank');
    if (!tab) {
      toast.error(m.studio_page_editor_preview_blocked());
      return;
    }
    if (saveFirst) {
      const result = await flushForAction();
      if (!result.ok) {
        tab.close();
        reportFailure(result.message);
        return;
      }
    }
    const slug = pageBuilder.saved?.slug;
    if (!slug) {
      tab.close();
      toast.error(m.studio_page_editor_need_slug());
      return;
    }
    if (isPublished && isDirty) {
      toast.info(m.studio_page_editor_preview_live_note());
    }
    tab.location.href = `/journeys/${slug}?preview=1`;
    // What 'noopener' did for the old one-step open: the public page gets no
    // handle back into the editor.
    tab.opener = null;
  }

  // ── Sections with course-aware starter copy ──────────────────────────────
  function insertSection(type: SectionTypeId, afterId: string | null): string {
    const props = DEFINITIONS[type].starter(template);
    if (afterId !== null)
      return pageBuilder.addKitSection(type, props, afterId);
    // "Before the first": one undoable step, where add-then-move would be two.
    const pending = pageBuilder.getSavePayload();
    if (!pending) return '';
    const section = starterSection(type, template);
    pageBuilder.updateMeta('sections', [section, ...pending.sections]);
    pageBuilder.selectSection(section.id);
    return section.id;
  }

  // The recipe names the sections; the page's Style lays out and colours
  // every one it does not pin, so no Style is read here.
  function startFromTemplate(recipe: RecipeId): void {
    const sections = recipeSections(recipe, template);
    pageBuilder.updateMeta('sections', sections);
    pageBuilder.selectSection(sections[0]?.id ?? null);
  }

  // ── Guards ───────────────────────────────────────────────────────────────
  let leaving = false;
  beforeNavigate((navigation) => {
    // Unloads are the unload guard's (the browser's own prompt).
    if (leaving || navigation.willUnload) return;
    if (navigation.to?.url.pathname.startsWith('/journeys/')) {
      navigation.cancel();
      toast.info(m.studio_page_editor_toast_links_inert());
      return;
    }
    // A stale tab's edits cannot be saved or published, so there is nothing
    // to wait for and nothing to ask about.
    if (!isDirty || stale) return;
    if (isPublished) {
      if (!confirm(m.studio_page_editor_confirm_leave())) navigation.cancel();
      return;
    }
    // A draft saves itself, so leaving waits for the save instead of asking.
    navigation.cancel();
    const target = navigation.to?.url;
    if (!target) return;
    void flushForAction().then((result) => {
      if (!result.ok) {
        reportFailure(result.message);
        return;
      }
      leaving = true;
      void goto(target);
    });
  });

  // The stale banner's Reload is the creator's own choice, made knowing this
  // tab's edits cannot be saved — the browser's leave prompt would only
  // second-guess it.
  let reloading = false;
  const stopUnloadGuard = guardUnload(() => isDirty && !reloading);

  function reloadTab(): void {
    reloading = true;
    window.location.reload();
  }

  $effect(() => () => {
    autosave.dispose();
    stopUnloadGuard();
    pageBuilder.close();
    sellMedia.close();
    monetisation.close();
  });

  return {
    get load() {
      return load;
    },
    get loadError() {
      return draftError;
    },
    reload: () => void draftQuery?.refresh(),
    get page() {
      return kitPage;
    },
    get context() {
      return context;
    },
    get template() {
      return template;
    },
    get status() {
      return status;
    },
    get isDirty() {
      return isDirty;
    },
    get hasUnpublishedChanges() {
      return autosave.hasUnpublishedChanges;
    },
    // Nothing saves in a stale tab, so there is no save state to show.
    get saveStatus() {
      return stale ? 'idle' : autosave.status;
    },
    get saveError() {
      return stale ? undefined : autosave.errorMessage;
    },
    get stale() {
      return stale;
    },
    reloadTab,
    get contextError() {
      return contextError;
    },
    retryContext,
    dismissContextError,
    get busy() {
      return busy;
    },
    retrySave: () => autosave.retry(),
    publish,
    publishChanges,
    unpublish,
    preview,
    insertSection,
    startFromTemplate,
  };
}
