/**
 * Type-only module for the FocusRail component (WP-9 — Codex-k9no0).
 *
 * Lives here (rather than inside `FocusRail.svelte`) so non-Svelte
 * consumers (the agreement focus-item aggregator, the unit test for
 * the aggregator) can import the shape without hitting TypeScript's
 * limitation that named exports from `.svelte` files are not resolvable
 * from `.ts` files.
 *
 * FocusRail.svelte re-exports `FocusItem` for Svelte consumers so the
 * original import paths keep working without churn.
 */

import type { Component } from 'svelte';

export interface FocusItem {
  id: string;
  /** Eyebrow microcopy — e.g. "2 drafts" — rendered in monospace. */
  eyebrow: string;
  /** Title — primary headline of the card. */
  title: string;
  /** Optional one-line supporting copy. */
  description?: string;
  /** Destination href (root-relative; org subdomain inferred from host). */
  href: string;
  /** Colour accent. Defaults to `'action'` if omitted. */
  tone?: 'action' | 'warning' | 'muted';
  /** Optional leading icon. */
  icon?: Component<{ size?: number | string; class?: string }>;
  /**
   * When true, the rail renders an inline dismiss button. The parent
   * receives the dismissal via `onDismiss` and is expected to filter the
   * item out on the next render (typically via the localStorage
   * dismissal collection — see `$lib/collections/dismissals`).
   */
  dismissable?: boolean;
}
