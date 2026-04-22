<!--
  @component StudioSidebar

  Hover-expanding rail sidebar for the Creator Studio. Absorbs every piece of
  chrome the old horizontal header used to carry: brand block, studio switcher,
  role-gated nav sections, theme toggle, and authenticated user menu.

  Mirrors the public SidebarRail pattern (200ms pointerenter grace, instant
  pointerleave collapse, `data-expanded` attribute driving label reveals).
  Falls back to a static expanded layout inside the mobile drawer via
  `mode="mobile"`.
-->
<script lang="ts">
  import { navigating, page } from '$app/state';
  import { submitFormPost } from '$lib/utils/navigation';
  import { buildPlatformUrl, buildOrgUrl, buildCreatorsUrl } from '$lib/utils/subdomain';
  import {
    SIDEBAR_BASE_LINKS,
    SIDEBAR_ADMIN_LINKS,
    SIDEBAR_OWNER_LINKS,
    SIDEBAR_PERSONAL_LINKS,
    type SidebarIcon,
    type SidebarLink,
  } from '$lib/config/navigation';
  import {
    LayoutDashboardIcon,
    FileIcon,
    VideoIcon,
    TrendingUpIcon,
    UsersIcon,
    UserPlusIcon,
    SettingsIcon,
    CoinsIcon,
    CreditCardIcon,
    GlobeIcon,
    UserIcon,
    LogInIcon,
  } from '$lib/components/ui/Icon';
  import Avatar from '$lib/components/ui/Avatar/Avatar.svelte';
  import AvatarImage from '$lib/components/ui/Avatar/AvatarImage.svelte';
  import AvatarFallback from '$lib/components/ui/Avatar/AvatarFallback.svelte';
  import DropdownMenu from '$lib/components/ui/DropdownMenu/DropdownMenu.svelte';
  import DropdownMenuTrigger from '$lib/components/ui/DropdownMenu/DropdownMenuTrigger.svelte';
  import DropdownMenuContent from '$lib/components/ui/DropdownMenu/DropdownMenuContent.svelte';
  import DropdownMenuItem from '$lib/components/ui/DropdownMenu/DropdownMenuItem.svelte';
  import DropdownMenuSeparator from '$lib/components/ui/DropdownMenu/DropdownMenuSeparator.svelte';
  import { createTooltip, melt } from '@melt-ui/svelte';
  import type { Component } from 'svelte';
  import StudioSidebarItem from './StudioSidebarItem.svelte';
  import StudioSwitcher from './StudioSwitcher.svelte';
  import ThemeToggle from '$lib/components/ui/ThemeToggle/ThemeToggle.svelte';
  import * as m from '$paraglide/messages';

  const ICON_MAP: Record<SidebarIcon, Component<Record<string, unknown>>> = {
    dashboard: LayoutDashboardIcon,
    content: FileIcon,
    media: VideoIcon,
    analytics: TrendingUpIcon,
    team: UsersIcon,
    customers: UserPlusIcon,
    settings: SettingsIcon,
    monetisation: CoinsIcon,
    billing: CreditCardIcon,
  };

  interface StudioUser {
    name: string;
    email: string;
    image?: string;
  }

  interface BrandInfo {
    name: string;
    imageUrl?: string | null;
    initial?: string;
  }

  interface SwitcherConfig {
    currentContext: 'personal' | 'org';
    currentSlug?: string;
    creatorUsername?: string | null;
    orgs: Array<{ name: string; slug: string; logoUrl?: string; role?: string }>;
  }

  interface Props {
    role: string;
    context: 'personal' | 'org';
    user: StudioUser | null;
    badgeCounts?: { draftContent: number };
    brand: BrandInfo;
    switcher: SwitcherConfig;
    /**
     * `'desktop'` = hover-expand rail (default); `'mobile'` = permanently
     * expanded layout inside a drawer.
     */
    mode?: 'desktop' | 'mobile';
  }

  const {
    role,
    context,
    user,
    badgeCounts,
    brand,
    switcher,
    mode = 'desktop',
  }: Props = $props();

  // ── Hover-expand logic (mirrors SidebarRail exactly) ─────────────────
  // 200ms grace-on-enter + instant collapse-on-leave. Keyboard focus also
  // expands the rail so labels are visible to sighted keyboard users.
  let expandTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverExpanded = $state(false);
  let focusWithin = $state(false);

  const expanded = $derived(mode === 'mobile' || hoverExpanded || focusWithin);

  function handleMouseEnter() {
    if (mode !== 'desktop') return;
    expandTimer = setTimeout(() => {
      hoverExpanded = true;
    }, 200);
  }

  function handleMouseLeave() {
    if (mode !== 'desktop') return;
    if (expandTimer) {
      clearTimeout(expandTimer);
      expandTimer = null;
    }
    hoverExpanded = false;
  }

  function handleFocusIn() {
    if (mode !== 'desktop') return;
    focusWithin = true;
  }

  function handleFocusOut(event: FocusEvent) {
    if (mode !== 'desktop') return;
    const next = event.relatedTarget as Node | null;
    if (!next || !(event.currentTarget as HTMLElement).contains(next)) {
      focusWithin = false;
    }
  }

  const isAdmin = $derived(role === 'admin' || role === 'owner');
  const isOwner = $derived(role === 'owner');

  function isActive(href: string, currentPath: string): boolean {
    if (href === '/studio') return currentPath === '/studio';
    return currentPath.startsWith(href);
  }

  function isLoading(href: string): boolean {
    const to = navigating?.to?.url.pathname;
    return to != null && isActive(href, to);
  }

  function getInitials(name: string): string {
    return name
      .split(' ')
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  const brandInitial = $derived(brand.initial ?? brand.name[0] ?? '?');

  interface NavSection {
    id: string;
    label?: string;
    links: SidebarLink[];
  }

  const sections = $derived<NavSection[]>(
    (
      [
        { id: 'base', links: SIDEBAR_BASE_LINKS } as NavSection,
        isAdmin && context === 'org'
          ? ({
              id: 'admin',
              label: m.studio_sidebar_admin(),
              links: SIDEBAR_ADMIN_LINKS,
            } as NavSection)
          : null,
        isOwner && context === 'org'
          ? ({
              id: 'owner',
              label: m.studio_sidebar_owner(),
              links: SIDEBAR_OWNER_LINKS,
            } as NavSection)
          : null,
        context === 'personal'
          ? ({ id: 'personal', links: SIDEBAR_PERSONAL_LINKS } as NavSection)
          : null,
      ] as Array<NavSection | null>
    ).filter((s): s is NavSection => s !== null),
  );

  // Brand tooltip — single instance created at setup time. Only renders in
  // desktop mode when the rail is collapsed (matches SidebarRailItem).
  const {
    elements: { trigger: brandTrigger, content: brandContent },
    states: { open: brandOpen },
  } = createTooltip({
    positioning: { placement: 'right' },
    openDelay: 0,
    closeDelay: 0,
    forceVisible: true,
  });

  const publicSiteHref = $derived(
    switcher.currentContext === 'personal' && switcher.creatorUsername
      ? buildCreatorsUrl(page.url, `/${switcher.creatorUsername}`)
      : switcher.currentSlug
        ? buildOrgUrl(page.url, switcher.currentSlug, '/')
        : '/',
  );

  const showBrandTooltip = $derived(mode === 'desktop' && !expanded);
</script>

<aside
  class="studio-rail"
  data-mode={mode}
  data-expanded={expanded}
  aria-label="Studio navigation"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  onfocusin={handleFocusIn}
  onfocusout={handleFocusOut}
>
  <!-- ══ Brand block (top) — logo/avatar → /studio home ══ -->
  <!-- Branching (not conditional use:melt) because Melt's action function
       destructures `.action` from its argument and throws on `undefined`.
       Matches the SidebarRailItem reference pattern exactly. -->
  <div class="studio-rail__brand">
    {#if showBrandTooltip}
      <a
        href="/studio"
        class="studio-rail__brand-link"
        aria-label={brand.name}
        use:melt={$brandTrigger}
      >
        {#if brand.imageUrl}
          <img src={brand.imageUrl} alt="" class="studio-rail__brand-image" />
        {:else}
          <span class="studio-rail__brand-initial">{brandInitial}</span>
        {/if}
        <span class="studio-rail__brand-text">
          <span class="studio-rail__brand-kicker">Studio</span>
          <span class="studio-rail__brand-name">{brand.name}</span>
        </span>
      </a>
      {#if $brandOpen}
        <div use:melt={$brandContent} class="studio-rail__tooltip">
          {brand.name}
        </div>
      {/if}
    {:else}
      <a href="/studio" class="studio-rail__brand-link" aria-label={brand.name}>
        {#if brand.imageUrl}
          <img src={brand.imageUrl} alt="" class="studio-rail__brand-image" />
        {:else}
          <span class="studio-rail__brand-initial">{brandInitial}</span>
        {/if}
        <span class="studio-rail__brand-text">
          <span class="studio-rail__brand-kicker">Studio</span>
          <span class="studio-rail__brand-name">{brand.name}</span>
        </span>
      </a>
    {/if}
  </div>

  <!-- ══ Studio switcher ══ -->
  <div class="studio-rail__switcher">
    <StudioSwitcher
      currentContext={switcher.currentContext}
      currentSlug={switcher.currentSlug}
      creatorUsername={switcher.creatorUsername}
      orgs={switcher.orgs}
      {expanded}
      placement={mode === 'mobile' ? 'bottom' : 'right'}
    />
  </div>

  <div class="studio-rail__divider"></div>

  <!-- ══ Nav sections ══ -->
  <nav class="studio-rail__nav">
    {#each sections as section, sectionIndex (section.id)}
      {#if sectionIndex > 0}
        <div class="studio-rail__divider studio-rail__divider--nav"></div>
      {/if}
      {#if section.label}
        <span class="studio-rail__section-label">{section.label}</span>
      {/if}
      <ul class="studio-rail__list" role="list">
        {#each section.links as link, i (link.href)}
          <StudioSidebarItem
            href={link.href}
            label={link.label}
            icon={ICON_MAP[link.icon]}
            active={isActive(link.href, page.url.pathname)}
            loading={isLoading(link.href)}
            {expanded}
            showTooltip={mode === 'desktop' && !expanded}
            index={i}
            badgeCount={link.icon === 'content' ? badgeCounts?.draftContent : undefined}
          />
        {/each}
      </ul>
    {/each}
  </nav>

  <!-- Spacer pushes bottom cluster down -->
  <div class="studio-rail__spacer"></div>

  <!-- ══ Theme toggle ══ -->
  <div class="studio-rail__theme">
    <ThemeToggle showLabel size={18} />
  </div>

  <!-- ══ User menu (absorbs old header functionality) ══ -->
  {#if user}
    <div class="studio-rail__divider"></div>
    <div class="studio-rail__user">
      <DropdownMenu
        positioning={{
          placement: mode === 'mobile' ? 'top-start' : 'right-end',
          gutter: 12,
        }}
      >
        <DropdownMenuTrigger class="studio-rail__user-trigger">
          <Avatar class="studio-rail__user-avatar">
            {#if user.image}
              <AvatarImage src={user.image} alt={user.name} />
            {/if}
            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
          </Avatar>
          <span class="studio-rail__user-details">
            <span class="studio-rail__user-name">{user.name}</span>
            <span class="studio-rail__user-email">{user.email}</span>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="studio-rail__user-menu">
          <div class="studio-rail__user-menu-header">
            <Avatar class="studio-rail__user-menu-avatar">
              {#if user.image}
                <AvatarImage src={user.image} alt={user.name} />
              {/if}
              <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
            </Avatar>
            <div class="studio-rail__user-menu-info">
              <span class="studio-rail__user-menu-name">{user.name}</span>
              <span class="studio-rail__user-menu-email">{user.email}</span>
            </div>
          </div>
          <DropdownMenuSeparator />
          <a href={publicSiteHref} class="studio-rail__user-menu-link">
            <DropdownMenuItem class="studio-rail__user-menu-item">
              <GlobeIcon size={16} />
              <span>{m.studio_view_public_site()}</span>
            </DropdownMenuItem>
          </a>
          <a
            href={buildPlatformUrl(page.url, '/account')}
            class="studio-rail__user-menu-link"
          >
            <DropdownMenuItem class="studio-rail__user-menu-item">
              <UserIcon size={16} />
              <span>{m.nav_account()}</span>
            </DropdownMenuItem>
          </a>
          <DropdownMenuSeparator />
          <button
            type="button"
            class="studio-rail__user-menu-logout"
            onclick={() => submitFormPost('/logout')}
          >
            <DropdownMenuItem
              class="studio-rail__user-menu-item studio-rail__user-menu-item--danger"
            >
              <LogInIcon size={16} />
              <span>{m.nav_log_out()}</span>
            </DropdownMenuItem>
          </button>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  {/if}
</aside>

<style>
  /* ══════════════════════════════════════════════════════════════════
     Rail shell
     ──────────────────────────────────────────────────────────────── */
  .studio-rail {
    /* Width tokens are component-local because no other sidebar shares
       this exact footprint — matching SidebarRail's 64/260 split. */
    --rail-width-collapsed: var(--space-16);
    --rail-width-expanded: 260px /* px */;
    --rail-glass-bg: color-mix(in oklch, var(--color-surface) 85%, transparent);
    --rail-glass-border: color-mix(in oklch, var(--color-border) 60%, transparent);

    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3) 0;
    width: var(--rail-width-collapsed);
    height: 100%;
    background-color: var(--color-surface);
    border-right: var(--border-width) var(--border-style) var(--color-border);
    overflow-y: auto;
    overflow-x: hidden;
    transition:
      width var(--duration-slow) var(--ease-spring),
      background-color var(--duration-normal) var(--ease-default),
      box-shadow var(--duration-normal) var(--ease-default),
      border-radius var(--duration-normal) var(--ease-default);
    view-transition-name: sidebar-nav;
  }

  .studio-rail[data-expanded='true'] {
    width: var(--rail-width-expanded);
  }

  /* Desktop: floats above content as glass when expanded — same visual
     language as SidebarRail so the two systems feel like one product. */
  .studio-rail[data-mode='desktop'][data-expanded='true'] {
    background: var(--rail-glass-bg);
    backdrop-filter: blur(var(--blur-xl));
    -webkit-backdrop-filter: blur(var(--blur-xl));
    border-right-color: var(--rail-glass-border);
    box-shadow: var(--shadow-xl);
    border-radius: 0 var(--radius-xl) var(--radius-xl) 0;
  }

  /* Mobile drawer = permanently expanded, no glass (drawer owns chrome). */
  .studio-rail[data-mode='mobile'] {
    width: 100%;
    height: 100%;
  }

  @media (prefers-reduced-motion: reduce) {
    .studio-rail {
      transition: background-color var(--duration-normal) var(--ease-default);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     Brand block
     ──────────────────────────────────────────────────────────────── */
  .studio-rail__brand {
    padding: 0 var(--space-2);
    min-height: var(--space-12);
    display: flex;
    align-items: center;
  }

  .studio-rail__brand-link {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    width: 100%;
    min-height: var(--space-10);
    border-radius: var(--radius-md);
    color: var(--color-text);
    text-decoration: none;
    overflow: hidden;
    transition: background-color var(--duration-fast) var(--ease-default);
  }

  .studio-rail__brand-link:hover {
    background-color: color-mix(in oklch, var(--color-interactive) 10%, transparent);
  }

  .studio-rail__brand-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .studio-rail__brand-image,
  .studio-rail__brand-initial {
    width: var(--space-8);
    height: var(--space-8);
    flex-shrink: 0;
    border-radius: var(--radius-md);
    object-fit: contain;
  }

  .studio-rail__brand-initial {
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand);
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-bold);
  }

  .studio-rail__brand-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
    opacity: 0;
    transform: translateX(calc(-1 * var(--space-1)));
    transition:
      opacity var(--duration-normal) var(--ease-default),
      transform var(--duration-normal) var(--ease-out);
  }

  .studio-rail[data-expanded='true'] .studio-rail__brand-text {
    opacity: 1;
    transform: translateX(0);
  }

  .studio-rail__brand-kicker {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    line-height: var(--leading-none);
  }

  .studio-rail__brand-name {
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    color: var(--color-text);
    letter-spacing: var(--tracking-tight);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: var(--leading-tight);
  }

  @media (prefers-reduced-motion: reduce) {
    .studio-rail__brand-text {
      transition: opacity var(--duration-fast) var(--ease-default);
      transform: none;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     Switcher wrapper (StudioSwitcher owns its own trigger chrome)
     ──────────────────────────────────────────────────────────────── */
  .studio-rail__switcher {
    display: flex;
    flex-direction: column;
  }

  /* ══════════════════════════════════════════════════════════════════
     Dividers
     ──────────────────────────────────────────────────────────────── */
  .studio-rail__divider {
    height: var(--border-width);
    background-color: var(--color-border);
    margin: var(--space-2) var(--space-4);
    flex-shrink: 0;
  }

  .studio-rail__divider--nav {
    margin: var(--space-3) var(--space-4);
  }

  /* ══════════════════════════════════════════════════════════════════
     Nav wrapper
     ──────────────────────────────────────────────────────────────── */
  .studio-rail__nav {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .studio-rail__section-label {
    display: block;
    padding: var(--space-2) var(--space-5) var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    opacity: 0;
    transition: opacity var(--duration-normal) var(--ease-default);
    /* Reserve zero vertical space when collapsed so icons align cleanly. */
    height: 0;
    overflow: hidden;
  }

  .studio-rail[data-expanded='true'] .studio-rail__section-label {
    opacity: 1;
    height: auto;
    overflow: visible;
  }

  @media (prefers-reduced-motion: reduce) {
    .studio-rail__section-label {
      transition: opacity var(--duration-fast) var(--ease-default);
    }
  }

  .studio-rail__list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  /* ══════════════════════════════════════════════════════════════════
     Brand tooltip (only mounts when brand-link tooltip is enabled)
     ──────────────────────────────────────────────────────────────── */
  .studio-rail__tooltip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    background: var(--color-surface-secondary);
    color: var(--color-text);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-sm);
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    z-index: var(--z-dropdown);
    pointer-events: none;
  }

  /* ══════════════════════════════════════════════════════════════════
     Spacer
     ──────────────────────────────────────────────────────────────── */
  .studio-rail__spacer {
    flex: 1;
    min-height: var(--space-4);
  }

  /* ══════════════════════════════════════════════════════════════════
     Theme toggle
     ──────────────────────────────────────────────────────────────── */
  .studio-rail__theme {
    margin: 0 var(--space-2);
  }

  .studio-rail__theme :global(.theme-toggle__label) {
    opacity: 0;
    transform: translateX(calc(-1 * var(--space-1)));
    transition:
      opacity var(--duration-normal) var(--ease-default),
      transform var(--duration-normal) var(--ease-out);
  }

  .studio-rail[data-expanded='true'] .studio-rail__theme :global(.theme-toggle__label) {
    opacity: 1;
    transform: translateX(0);
  }

  @media (prefers-reduced-motion: reduce) {
    .studio-rail__theme :global(.theme-toggle__label) {
      transition: opacity var(--duration-fast) var(--ease-default);
      transform: none;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     User section
     ──────────────────────────────────────────────────────────────── */
  .studio-rail__user {
    padding: 0 var(--space-2);
  }

  :global(.studio-rail__user-trigger) {
    display: flex !important;
    align-items: center !important;
    gap: var(--space-3) !important;
    padding: var(--space-2) !important;
    width: 100% !important;
    min-height: var(--space-12) !important;
    border-radius: var(--radius-md) !important;
    background: transparent !important;
    border: none !important;
    cursor: pointer !important;
    transition: background-color var(--duration-fast) var(--ease-default) !important;
    text-align: left !important;
    color: var(--color-text) !important;
  }

  :global(.studio-rail__user-trigger:hover) {
    background-color: color-mix(in oklch, var(--color-interactive) 12%, transparent) !important;
  }

  :global(.studio-rail__user-trigger:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus) !important;
    outline-offset: 2px !important;
  }

  :global(.studio-rail__user-trigger[data-state='open']) {
    background-color: color-mix(in oklch, var(--color-interactive) 15%, transparent) !important;
  }

  :global(.studio-rail__user-avatar) {
    width: var(--space-8) !important;
    height: var(--space-8) !important;
    flex-shrink: 0 !important;
  }

  .studio-rail__user-details {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
    overflow: hidden;
    opacity: 0;
    transform: translateX(calc(-1 * var(--space-1)));
    transition:
      opacity var(--duration-normal) var(--ease-default),
      transform var(--duration-normal) var(--ease-out);
  }

  .studio-rail[data-expanded='true'] .studio-rail__user-details {
    opacity: 1;
    transform: translateX(0);
  }

  .studio-rail__user-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .studio-rail__user-email {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (prefers-reduced-motion: reduce) {
    .studio-rail__user-details {
      transition: opacity var(--duration-fast) var(--ease-default);
      transform: none;
    }
  }

  /* ── User dropdown content ── */
  :global(.studio-rail__user-menu) {
    min-width: 240px !important;
    padding: var(--space-1) !important;
  }

  .studio-rail__user-menu-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  :global(.studio-rail__user-menu-avatar) {
    width: var(--space-10) !important;
    height: var(--space-10) !important;
    flex-shrink: 0 !important;
  }

  .studio-rail__user-menu-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .studio-rail__user-menu-name {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .studio-rail__user-menu-email {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :global(.studio-rail__user-menu-item) {
    gap: var(--space-2) !important;
    font-size: var(--text-sm) !important;
  }

  :global(.studio-rail__user-menu-item--danger) {
    color: var(--color-error) !important;
  }

  :global(.studio-rail__user-menu-item--danger[data-highlighted]) {
    color: var(--color-error) !important;
    background-color: color-mix(in oklch, var(--color-error) 10%, transparent) !important;
  }

  .studio-rail__user-menu-link {
    display: block;
    text-decoration: none;
    color: inherit;
  }

  .studio-rail__user-menu-logout {
    width: 100%;
    padding: 0;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
</style>
