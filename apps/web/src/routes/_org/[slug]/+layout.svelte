<script lang="ts">
  /**
   * Organization layout - for {slug}.revelations.studio routes
   * Wires OrgHeader component and injects org brand colors as CSS variables.
   */
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';
  import OrgHeader from '$lib/components/layout/Header/OrgHeader.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    data: LayoutData;
    children: Snippet;
  }

  const { data, children }: Props = $props();
</script>

<div
  class="org-layout"
  style:--brand-primary={data.org?.brandColors?.primary}
  style:--brand-secondary={data.org?.brandColors?.secondary}
  style:--brand-accent={data.org?.brandColors?.accent}
>
  <OrgHeader user={data.user} org={data.org} />

  <main class="org-main">
    {@render children()}
  </main>

  <footer class="org-footer">
    <div class="footer-inner">
      <p class="powered-by">
        {m.footer_powered_by({ platform: m.footer_powered_by_platform() })}
      </p>
      <nav class="footer-links">
        <a href="/about">{m.footer_about()}</a>
        <a href="/terms">{m.footer_terms()}</a>
        <a href="/privacy">{m.footer_privacy()}</a>
      </nav>
      <p class="copyright">{m.footer_copyright()}</p>
    </div>
  </footer>
</div>

<style>
  .org-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background-color: var(--color-background);
    color: var(--color-text);
  }

  .org-main {
    flex: 1;
  }

  .org-footer {
    border-top: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface);
    padding: var(--space-8) var(--space-4);
  }

  .footer-inner {
    max-width: var(--container-max);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    text-align: center;
  }

  @media (min-width: 768px) {
    .footer-inner {
      flex-direction: row;
      justify-content: space-between;
      text-align: left;
    }
  }

  .powered-by {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .footer-links {
    display: flex;
    gap: var(--space-4);
  }

  .footer-links a {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    transition: var(--transition-colors);
  }

  .footer-links a:hover {
    color: var(--color-text);
  }

  .copyright {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  /* Dark mode support */
  :global([data-theme='dark']) .org-layout {
    background-color: var(--color-background);
    color: var(--color-text);
  }

  :global([data-theme='dark']) .org-footer {
    background-color: var(--color-surface);
    border-top-color: var(--color-border);
  }

  :global([data-theme='dark']) .footer-links a:hover {
    color: var(--color-text);
  }
</style>
