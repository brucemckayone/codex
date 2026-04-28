<!--
  @component DashboardCommandBar

  Sticky editorial command bar for the studio dashboard. Anchors the page
  with creator identity (org logo + name + eyebrow) on the left, a plain-
  English "today" narrative in the middle, and two primary actions on the
  right. Matches the ContentFormCommandBar vocabulary (backdrop-filter,
  breadcrumb eyebrow, ordinal meter) but adapted for the dashboard's
  "status at a glance" role.

  @prop orgName     Organisation display name
  @prop orgSlug     Organisation slug (for View Site link hint)
  @prop logoUrl     Optional logo URL (square image)
  @prop userName    Current creator's display name
  @prop narrative   Single-line sentence summarising today (drafts, revenue, new members)
  @prop isAdmin     Whether the viewer can see admin-only actions
-->
<script lang="ts">
  import { PlusIcon, GlobeIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

  interface Props {
    orgName: string;
    logoUrl?: string | null;
    userName: string;
    narrative: string;
    isAdmin: boolean;
  }

  const { orgName, userName, logoUrl, narrative, isAdmin }: Props = $props();

  const initials = $derived(
    orgName
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '·'
  );

  // TODO i18n — add keys to apps/web/src/lib/paraglide/messages/en.json:
  //   studio_dashboard_eyebrow, studio_dashboard_hello
  const eyebrow = 'Studio · Today';
</script>

<div class="command-bar" role="banner" aria-label="Studio dashboard header">
  <div class="bar-identity">
    <span class="identity-mark" aria-hidden="true">
      {#if logoUrl}
        <img src={logoUrl} alt="" class="identity-logo" loading="lazy" />
      {:else}
        <span class="identity-initials">{initials}</span>
      {/if}
    </span>
    <span class="identity-text">
      <span class="identity-eyebrow">{eyebrow}</span>
      <span class="identity-name" title={orgName}>{orgName}</span>
    </span>
  </div>

  <p class="bar-narrative" aria-live="polite">
    <span class="narrative-lede">Hello, {userName.split(' ')[0] || 'there'}.</span>
    <span class="narrative-body">{narrative}</span>
  </p>

  <div class="bar-actions">
    {#if isAdmin}
      <a class="action action--secondary" href="/studio/content?action=create">
        <PlusIcon size={16} />
        <span>{m.studio_action_create_content()}</span>
      </a>
    {/if}
    <a
      class="action action--primary"
      href="/"
      target="_blank"
      rel="noopener"
    >
      <GlobeIcon size={16} />
      <span>{m.studio_view_public_site()}</span>
    </a>
  </div>
</div>

<style>
  .command-bar {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr) minmax(0, auto);
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-4) var(--space-5);
    background-color: color-mix(in srgb, var(--color-surface) 86%, transparent);
    backdrop-filter: blur(var(--blur-2xl, 24px));
    -webkit-backdrop-filter: blur(var(--blur-2xl, 24px));
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: 0 var(--space-1) var(--space-4)
      color-mix(in srgb, var(--color-text) 6%, transparent);
  }

  @media (--below-md) {
    .command-bar {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'identity actions'
        'narrative narrative';
      row-gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
    }
    .bar-identity { grid-area: identity; }
    .bar-narrative { grid-area: narrative; }
    .bar-actions { grid-area: actions; }
  }

  /* ── Identity (logo + eyebrow/name) ─────────────────────── */
  .bar-identity {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .identity-mark {
    flex-shrink: 0;
    width: var(--space-10);
    height: var(--space-10);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 14%, var(--color-surface));
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 26%, transparent);
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .identity-logo {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .identity-initials {
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    letter-spacing: var(--tracking-tight);
    color: var(--color-brand-primary, var(--color-interactive));
  }

  .identity-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: var(--leading-tight);
  }

  .identity-eyebrow {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
  }

  .identity-name {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Narrative (today summary) ──────────────────────────── */
  .bar-narrative {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    color: var(--color-text-secondary);
    min-width: 0;
  }

  .narrative-lede {
    font-family: var(--font-heading);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    letter-spacing: var(--tracking-tight);
    margin-right: var(--space-1);
  }

  .narrative-body {
    color: var(--color-text-secondary);
  }

  /* ── Actions ─────────────────────────────────────────────── */
  .bar-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    justify-content: flex-end;
  }

  .action {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--space-10);
    padding: 0 var(--space-4);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    text-decoration: none;
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) transparent;
    transition: var(--transition-colors), var(--transition-shadow);
    white-space: nowrap;
    cursor: pointer;
  }

  .action:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .action--secondary {
    background: var(--color-surface);
    border-color: var(--color-border);
    color: var(--color-text);
  }

  .action--secondary:hover {
    border-color: var(--color-interactive);
    color: var(--color-interactive);
  }

  .action--primary {
    background: var(--color-interactive);
    color: var(--color-text-on-brand, var(--color-background));
  }

  .action--primary:hover {
    background: var(--color-interactive-hover);
  }

  @media (--below-md) {
    /* Keep only primary action on mobile; hide secondary to avoid crowding */
    .bar-actions .action--secondary { display: none; }
  }
</style>
