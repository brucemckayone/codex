/**
 * Where a media item is used (Codex-6sbn1), as the Studio draws it: the
 * library chip's popover, and every state of the delete dialog.
 *
 * The worker's one lookup (`GET /api/media/:id/usage`) decides what is live
 * and what is named; this module only groups, words and links what it sent.
 * The screens are the mockups the owner approved
 * (scratchpad mockups-owner-numbers/media-delete/: library, delete-blocked,
 * delete-drafts, delete-unused, failures).
 */

import type {
  MediaUsage,
  MediaUse,
  MediaUseLink,
  MediaUseSlot,
} from '@codex/shared-types';
import { buildCreatorsUrl, buildOrgUrl } from '$lib/utils/subdomain';
import * as m from '$paraglide/messages';

/** Published first (these stop a delete), then drafts (these don't). */
export function splitUses(uses: readonly MediaUse[]): {
  live: MediaUse[];
  drafts: MediaUse[];
} {
  return {
    live: uses.filter((use) => use.live),
    drafts: uses.filter((use) => !use.live),
  };
}

/**
 * The Studio page where another media item can be swapped in, on the host
 * that serves it: the film's editor, the course page builder's Settings tab,
 * or Brand. Null when the caller can't change it there.
 *
 * A course link is the LANDING PAGE id, which `/studio/journeys/[id]/page`
 * takes (`createBuilderSession({ pageId: params.id })`), never the course id.
 */
export function useHref(
  link: MediaUseLink | null,
  current: URL
): string | null {
  if (!link) return null;
  switch (link.to) {
    case 'content': {
      const path = `/studio/content/${encodeURIComponent(link.contentId)}/edit`;
      return link.orgSlug
        ? buildOrgUrl(current, link.orgSlug, path)
        : buildCreatorsUrl(current, path);
    }
    case 'journey':
      return buildOrgUrl(
        current,
        link.orgSlug,
        `/studio/journeys/${encodeURIComponent(link.pageId)}/page?tab=settings`
      );
    case 'brand':
      return buildOrgUrl(current, link.orgSlug, '/studio/brand');
  }
}

/**
 * What a row offers. `replace` on a published use; on a draft, `open`, except
 * in the blocked dialog, where the owner asked for Replace on every row
 * (round 2, decision 5). Without a link: who can change it instead.
 */
export type UseAction = 'replace' | 'open' | 'ask-admin' | 'ask-creator';

export function useAction(
  use: MediaUse,
  draftAction: 'open' | 'replace' = 'open'
): UseAction {
  if (!use.link) {
    return use.kind === 'course' || use.kind === 'intro'
      ? 'ask-admin'
      : 'ask-creator';
  }
  return use.live ? 'replace' : draftAction;
}

/** A stable key for one use, for `{#each}` and for comparing two reads. */
export function useKey(use: MediaUse): string {
  const link = use.link;
  const target =
    link?.to === 'content'
      ? link.contentId
      : link?.to === 'journey'
        ? link.pageId
        : link?.to === 'brand'
          ? link.orgSlug
          : `${use.title}\u0000${use.orgName ?? ''}`;
  return `${use.kind}:${use.slot}:${target}`;
}

const SLOT_LABELS: Record<
  Exclude<MediaUseSlot, 'media' | 'org_intro'>,
  () => string
> = {
  intro: () => m.studio_builder_media_slot_intro(),
  reel: () => m.studio_builder_media_slot_reel(),
  guide_video: () => m.studio_builder_media_slot_guide_video(),
  hero: () => m.studio_builder_media_slot_hero(),
  guide_portrait: () => m.studio_builder_media_slot_guide_portrait(),
};

/** The row's title. An intro video's is the org's name, which `where` carries. */
export function useTitle(use: MediaUse): string {
  return use.kind === 'intro' ? m.media_use_intro_title() : use.title;
}

/** The row's second line: what it is, and where. */
export function useWhere(use: MediaUse): string {
  const org = use.orgName;
  if (use.kind === 'intro') {
    return m.media_use_where_intro({ org: org ?? use.title });
  }
  if (use.kind === 'course') {
    const slot =
      use.slot === 'media' || use.slot === 'org_intro'
        ? null
        : SLOT_LABELS[use.slot]();
    const what = use.live
      ? m.media_use_where_course()
      : m.media_use_where_course_draft();
    return [what, slot, org].filter(Boolean).join(' · ');
  }
  const audio = use.kind === 'audio';
  if (use.liveReason === 'bought') {
    return audio
      ? m.media_use_where_bought_audio()
      : m.media_use_where_bought_film();
  }
  const what = use.live
    ? audio
      ? m.media_use_where_audio_published()
      : m.media_use_where_film_published()
    : audio
      ? m.media_use_where_audio_draft()
      : m.media_use_where_film_draft();
  return [what, org].filter(Boolean).join(' · ');
}

/**
 * The uses the worker counted but did not list: drafts the caller can't open
 * (`hidden`), and anything past the 50-row cap. `total` is the truth.
 */
export function unlistedCounts(usage: MediaUsage): {
  hidden: number;
  capped: number;
} {
  const capped = Math.max(0, usage.total - usage.uses.length - usage.hidden);
  return { hidden: usage.hidden, capped };
}

const listFormat = new Intl.ListFormat('en-GB', {
  style: 'long',
  type: 'conjunction',
});

/**
 * The blocked dialog's "It's used by …" list, from the published uses: "2
 * published films, a course page and your intro video". A course page using
 * the item in two slots is one course page.
 */
export function liveUsesPhrase(usage: MediaUsage): string {
  const { live } = splitUses(usage.uses);
  const count = (pick: (use: MediaUse) => boolean) => live.filter(pick).length;
  const published = (kind: 'film' | 'audio') => (use: MediaUse) =>
    use.kind === kind && use.liveReason !== 'bought';
  const bought = (kind: 'film' | 'audio') => (use: MediaUse) =>
    use.kind === kind && use.liveReason === 'bought';

  const films = count(published('film'));
  const audio = count(published('audio'));
  const boughtFilms = count(bought('film'));
  const boughtAudio = count(bought('audio'));
  const courses = new Set(
    live
      .filter((use) => use.kind === 'course')
      .map((use) =>
        use.link?.to === 'journey' ? use.link.pageId : useKey(use)
      )
  ).size;
  const intros = count((use) => use.kind === 'intro');
  // `uses` is capped, so the published list can be shorter than `live`.
  const unlisted = Math.max(0, usage.live - live.length);

  const parts = [
    films === 1
      ? m.media_why_film_one()
      : films > 1
        ? m.media_why_film({ count: films })
        : null,
    audio === 1
      ? m.media_why_audio_one()
      : audio > 1
        ? m.media_why_audio({ count: audio })
        : null,
    boughtFilms === 1
      ? m.media_why_bought_film_one()
      : boughtFilms > 1
        ? m.media_why_bought_film({ count: boughtFilms })
        : null,
    boughtAudio === 1
      ? m.media_why_bought_audio_one()
      : boughtAudio > 1
        ? m.media_why_bought_audio({ count: boughtAudio })
        : null,
    courses === 1
      ? m.media_why_course_one()
      : courses > 1
        ? m.media_why_course({ count: courses })
        : null,
    intros === 1
      ? m.media_why_intro_one()
      : intros > 1
        ? m.media_why_intro({ count: intros })
        : null,
    unlisted > 0 ? m.media_why_more({ count: unlisted }) : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? listFormat.format(parts) : m.media_why_something();
}

/**
 * The use a refused delete was about (R1): the first published use the new
 * read has that the dialog's read did not show as published. Null when none
 * can be told apart (the dialog then says "something published").
 */
export function newlyLiveUse(
  before: MediaUsage | null,
  after: MediaUsage
): MediaUse | null {
  const wasLive = new Set(
    (before?.uses ?? []).filter((use) => use.live).map(useKey)
  );
  return (
    after.uses.find((use) => use.live && !wasLive.has(useKey(use))) ?? null
  );
}

/** The first draft the creator can open, for the toast's "Show them". */
export function firstOpenableDraft(usage: MediaUsage): MediaUse | null {
  return usage.uses.find((use) => !use.live && use.link !== null) ?? null;
}
