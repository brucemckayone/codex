/**
 * What the content list's toolbar offers, with its labels (Codex-a6ofh.3.1,
 * mockup L1 notes 2-5). The toolbar, the phone sheet and the empty states
 * all read these, so a facet is named the same everywhere.
 */
import {
  CONTENT_ACCESS_TYPE,
  CONTENT_STATUS,
  CONTENT_TYPES,
} from '@codex/constants';
import type { ContentWhereCounts } from '@codex/shared-types';
import { LayoutGridIcon, LayoutListIcon } from '$lib/components/ui/Icon';
import * as m from '$paraglide/messages';
import type { ListOption, SegmentOption } from '../list-toolbar/list-option';
import type { ContentStatusFilter } from './content-status';
import {
  CATEGORY_ANY,
  isOrgWhere,
  type ListAccess,
  type ListSort,
  type ListType,
  type ListView,
  WHERE_ALL,
  WHERE_PERSONAL,
} from './list-url';

export const STATUS_OPTIONS: readonly ListOption<ContentStatusFilter>[] = [
  { value: 'all', label: () => m.studio_content_filter_all() },
  { value: CONTENT_STATUS.DRAFT, label: () => m.studio_content_filter_draft() },
  {
    value: CONTENT_STATUS.PUBLISHED,
    label: () => m.studio_content_filter_published(),
  },
  {
    value: CONTENT_STATUS.ARCHIVED,
    label: () => m.studio_content_filter_archived(),
  },
];

export const TYPE_OPTIONS: readonly ListOption<ListType>[] = [
  { value: 'all', label: () => m.media_filter_any() },
  { value: CONTENT_TYPES.VIDEO, label: () => m.content_type_video() },
  { value: CONTENT_TYPES.AUDIO, label: () => m.content_type_audio() },
  { value: CONTENT_TYPES.WRITTEN, label: () => m.content_type_article() },
];

/** Mockup L1 note 3: Free, Paid, Subscribers, Followers, Team, Portal only. */
export const ACCESS_OPTIONS: readonly ListOption<ListAccess>[] = [
  { value: 'any', label: () => m.media_filter_any() },
  {
    value: CONTENT_ACCESS_TYPE.FREE,
    label: () => m.studio_content_form_access_free(),
  },
  {
    value: CONTENT_ACCESS_TYPE.PAID,
    label: () => m.studio_content_list_access_paid(),
  },
  {
    value: CONTENT_ACCESS_TYPE.SUBSCRIBERS,
    label: () => m.studio_content_form_access_subscribers(),
  },
  {
    value: CONTENT_ACCESS_TYPE.FOLLOWERS,
    label: () => m.studio_content_form_access_followers(),
  },
  {
    value: CONTENT_ACCESS_TYPE.TEAM,
    label: () => m.studio_content_form_access_team(),
  },
  {
    value: CONTENT_ACCESS_TYPE.COURSE,
    label: () => m.studio_content_list_access_course(),
  },
];

/** Mockup L1 note 5. */
export const SORT_OPTIONS: readonly ListOption<ListSort>[] = [
  { value: 'updated', label: () => m.studio_content_list_sort_updated() },
  { value: 'newest', label: () => m.media_sort_newest() },
  { value: 'published', label: () => m.studio_content_list_sort_published() },
  { value: 'title', label: () => m.media_sort_title() },
  { value: 'views', label: () => m.studio_content_list_sort_views() },
  { value: 'sales', label: () => m.studio_content_list_sort_sales() },
];

/** The table (L1) or the cards (L5). */
export const VIEW_OPTIONS: readonly SegmentOption<ListView>[] = [
  { value: 'list', label: () => m.media_view_list(), icon: LayoutListIcon },
  { value: 'grid', label: () => m.media_view_grid(), icon: LayoutGridIcon },
];

/**
 * The personal studio's Where (Codex-a6ofh.3.2, mockup L4b): Everywhere,
 * Personal, then each org the creator has pieces in. `counts` undefined
 * (unread, or the read failed) gives no numbers, never a 0.
 *
 * An org the URL is on that the counts do not name (still unread, or no
 * pieces there) is named from the layout's `orgs`, so the menu never shows
 * an id. One neither names stays out: the trigger then reads the raw value,
 * as any facet's stale param does.
 */
export function whereOptions(
  counts: ContentWhereCounts | undefined,
  where: string,
  orgs: readonly { id: string; name: string }[]
): ListOption[] {
  const options: ListOption[] = [
    {
      value: WHERE_ALL,
      label: () => m.studio_content_where_all(),
      count: counts?.all,
    },
    {
      value: WHERE_PERSONAL,
      label: () => m.studio_content_where_personal(),
      count: counts?.personal,
    },
    ...(counts?.orgs ?? []).map((org) => ({
      value: org.id,
      label: () => org.name,
      count: org.count,
    })),
  ];
  if (isOrgWhere(where) && !options.some((option) => option.value === where)) {
    const name = orgs.find((org) => org.id === where)?.name;
    if (name) {
      options.push({
        value: where,
        label: () => name,
        ...(counts && { count: 0 }),
      });
    }
  }
  return options;
}

/**
 * The org studio's Category (Codex-a6ofh.3.3, mockup L1 pin 4): Any, then
 * the org's categories in their order. `categories` undefined (unread, or
 * the read failed) offers Any alone. A category the URL is on that the read
 * does not name (still unread, or since removed) is "This category", so the
 * menu never shows an id.
 */
export function categoryOptions(
  categories: readonly { id: string; name: string }[] | undefined,
  category: string
): ListOption[] {
  const options: ListOption[] = [
    { value: CATEGORY_ANY, label: () => m.studio_content_category_any() },
    ...(categories ?? []).map((item) => ({
      value: item.id,
      label: () => item.name,
    })),
  ];
  if (!options.some((option) => option.value === category)) {
    options.push({
      value: category,
      label: () => m.studio_content_category_this(),
    });
  }
  return options;
}
