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
import type { PageBuilderState, PageStatus } from '@codex/shared-types';
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
  saveBuilderDraft,
} from '$lib/page-builder/builder-save';
import {
  DEFINITIONS,
  type KitPage,
  resolveStyle,
  type SectionTypeId,
  starterPage,
  starterSection,
  type TemplateContext,
  validateKitShape,
} from '$lib/page-builder/kit';
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
  retrySave(): void;
  publish(): Promise<PublishResult>;
  publishChanges(): Promise<PublishResult>;
  unpublish(): Promise<boolean>;
  preview(): Promise<void>;
  insertSection(type: SectionTypeId, afterId: string | null): string;
  startFromTemplate(): void;
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
  let busy = $state<SessionBusy>(null);

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
    pageBuilder.open(id, baseline);
    adoptRecoveredDraft(id, baseline);
    persistedStatus = baseline.status;
    void sellMedia.open(id, {
      hasCourse: loaded.subjectType === 'course' && !!loaded.subjectId,
    });
    void monetisation.open(
      loaded.subjectType === 'course' ? loaded.subjectId : null
    );
  }

  /**
   * The legacy editor writes crash recovery under the same key, so `open()`
   * can restore a draft in legacy vocabulary the kit cannot edit. Its edits
   * are carried over upgraded: reopen on the clean baseline and re-apply each
   * field that differs, so undo walks back to the saved page, never to a
   * legacy draft.
   */
  function adoptRecoveredDraft(id: string, baseline: PageBuilderState): void {
    const restored = pageBuilder.getSavePayload();
    if (!restored) return;
    const kit = toKitPage(restored);
    const shape = { design: restored.design, sections: restored.sections };
    if (sameValue(shape, kit)) return;
    const recovered: PageBuilderState = {
      ...restored,
      design: kit.design,
      sections: kit.sections,
    };
    pageBuilder.close();
    pageBuilder.open(id, baseline);
    for (const key of Object.keys(recovered) as (keyof PageBuilderState)[]) {
      if (!sameValue(recovered[key], baseline[key])) {
        pageBuilder.updateMeta(key, recovered[key]);
      }
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  /**
   * Only promote the draft to "saved" if nothing changed while the write was
   * in flight. The store's `markSaved()` baselines the CURRENT draft, so
   * keystrokes typed during an autosave would otherwise be marked saved
   * without ever being sent. Left dirty, the next save sends them.
   */
  function unchangedSince(
    sent: PageBuilderState,
    synced: PersistedPageOffer | null
  ): boolean {
    const now = pageBuilder.getSavePayload();
    if (!now) return false;
    const expected = synced
      ? { ...sent, offer: { ...(sent.offer ?? {}), ...synced } }
      : sent;
    return sameValue(now, expected);
  }

  async function saveNow(): Promise<AutosaveSaveResult> {
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
      savedOffer: pageBuilder.saved?.offer,
      savePage: saveJourneyPage,
      saveOffer: updateJourneyOffer,
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
        pageBuilder.updateOffer(next);
      },
      markSaved: () => {
        // Autosave is a checkpoint, not a commit point: keep the undo stack.
        if (unchangedSince(payload, synced)) {
          pageBuilder.markSaved({ keepHistory: true });
        }
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
      // already landed.
      if (result.stage !== 'page') persistedStatus = payload.status;
      return { ok: false, message: result.message };
    }
    persistedStatus = payload.status;
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
      if (isDirty) autosave.notifyChange();
    });
  });

  // One toast per distinct failure; a success in between re-arms it.
  let toastedError: string | null = null;
  $effect(() => {
    const now = autosave.status;
    const message = autosave.errorMessage;
    untrack(() => {
      if (now === 'saved') toastedError = null;
      if (now !== 'error' || !message || message === toastedError) return;
      toastedError = message;
      toast.error(m.studio_page_editor_toast_save_failed(), message);
    });
  });

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
      pageBuilder.updateMeta('status', next);
      let result = await autosave.flush();
      if (result.ok && persistedStatus !== next) {
        result = await autosave.flush();
      }
      if (!result.ok && persistedStatus !== next) {
        pageBuilder.updateMeta('status', previous);
      }
      return result.ok;
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

  async function publish(): Promise<PublishResult> {
    if (busy) return { ok: false };
    const blocked = blockedBy();
    if (blocked) return blocked;
    const ok = await setLive('published');
    if (ok) toast.success(m.studio_builder_toast_published());
    return { ok };
  }

  async function publishChanges(): Promise<PublishResult> {
    if (busy) return { ok: false };
    const blocked = blockedBy();
    if (blocked) return blocked;
    busy = 'publishing';
    try {
      const result = await autosave.flush();
      if (result.ok)
        toast.success(m.studio_page_editor_toast_changes_published());
      return { ok: result.ok };
    } finally {
      busy = null;
    }
  }

  async function unpublish(): Promise<boolean> {
    if (busy) return false;
    const ok = await setLive('draft');
    if (ok) toast.success(m.studio_page_editor_toast_unpublished());
    return ok;
  }

  /**
   * Open the public page. A draft is saved first so the preview shows it; a
   * LIVE page is never flushed from here — that would publish — so the
   * creator is told the preview shows what is live.
   */
  async function preview(): Promise<void> {
    if (isDirty && !isPublished) {
      const result = await autosave.flush();
      if (!result.ok) return;
    }
    const slug = pageBuilder.saved?.slug;
    if (!slug) {
      toast.error(m.studio_page_editor_need_slug());
      return;
    }
    if (isPublished && isDirty) {
      toast.info(m.studio_page_editor_preview_live_note());
    }
    window.open(`/journeys/${slug}?preview=1`, '_blank', 'noopener');
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

  function startFromTemplate(): void {
    const starter = starterPage(template, {
      style: resolveStyle(kitPage?.design),
    });
    pageBuilder.updateMeta('sections', starter.sections);
    pageBuilder.selectSection(starter.sections[0]?.id ?? null);
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
    if (!isDirty) return;
    if (isPublished) {
      if (!confirm(m.studio_page_editor_confirm_leave())) navigation.cancel();
      return;
    }
    // A draft saves itself, so leaving waits for the save instead of asking.
    navigation.cancel();
    const target = navigation.to?.url;
    if (!target) return;
    void autosave.flush().then((result) => {
      if (!result.ok) return;
      leaving = true;
      void goto(target);
    });
  });

  const stopUnloadGuard = guardUnload(() => isDirty);

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
    get saveStatus() {
      return autosave.status;
    },
    get saveError() {
      return autosave.errorMessage;
    },
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
