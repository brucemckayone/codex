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
import { LayoutGridIcon, LayoutListIcon } from '$lib/components/ui/Icon';
import * as m from '$paraglide/messages';
import type { ListOption, SegmentOption } from '../list-toolbar/list-option';
import type { ContentStatusFilter } from './content-status';
import type { ListAccess, ListSort, ListType, ListView } from './list-url';

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
