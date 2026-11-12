import type { Component } from 'svelte';
import type { IconProps } from '$lib/components/ui/Icon/types';

/**
 * One choice in a studio list's menu or segment (Codex-a6ofh.3.1): the value
 * the URL holds and its label, read lazily so a locale switch relabels it.
 * The media library's and the content list's toolbars, phone sheets and
 * empty states all name a facet through these, so it reads the same everywhere.
 */
export interface ListOption<T extends string = string> {
  value: T;
  label: () => string;
  /**
   * How many it would show, beside the label (the personal studio's Where,
   * mockup L4b). Left out when unknown: a count never read is no number,
   * never a 0.
   */
  count?: number;
}

/** A segment's option (`ListSegment`): an icon, never a count. */
export type SegmentOption<T extends string = string> = Omit<
  ListOption<T>,
  'count'
> & {
  icon?: Component<IconProps>;
};

/**
 * A facet whose choices could not be read (Codex-a6ofh.3.3, owner): its
 * menu and its sheet say so after what they can offer, with a Try again,
 * so a failed read never reads as a list with nothing to pick.
 */
export interface FacetUnread {
  /** What could not be read: "Couldn't load the categories." */
  failed: () => string;
  /** The same once a Try again failed too, so a repeat is told apart. */
  failedAgain: () => string;
  /** Reads the choices again; rejects when that read fails too. */
  retry: () => Promise<unknown>;
}

/** A facet in a list's phone sheet: its URL param, heading and choices. */
export interface ListFacet<K extends string = string> {
  key: K;
  title: () => string;
  options: readonly ListOption[];
  /** The param's bare-URL value: the sheet's Clear all, and its count. */
  fallback: string;
  /** Set when its choices could not be read. */
  unread?: FacetUnread;
}
