<script lang="ts">
  import PageContainer from './PageContainer.svelte';
  import * as m from '$paraglide/messages';
</script>

<!--
  The legal links below are RELATIVE, deliberately, and must stay that way.

  This footer is mounted ONLY by routes/(platform)/+layout.svelte, and the
  (platform) group is reachable on exactly two host classes: the apex, and a
  RESERVED subdomain. `hooks.ts` returns the pathname UNREWRITTEN for a reserved
  subdomain (`if (isReservedSubdomain(subdomain)) return pathname`), so
  `staging.revelations.studio/terms` renders `(platform)/terms` in place and a
  relative href resolves correctly there.

  An absolute apex URL here is a REGRESSION: `buildPlatformUrl` collapses
  `staging.revelations.studio` to `revelations.studio`, sending a staging viewer
  to PRODUCTION. Verified — `isReservedSubdomain('staging')` and
  `isReservedSubdomain('codex-staging')` are both true via a suffix rule, not
  list membership, so grepping STATIC_RESERVED_SUBDOMAINS gives the wrong answer.

  The tenant-host 404 this looked like it should fix is NOT here: org subdomains
  never render this component. They have their own inline footer in
  routes/_org/[slug]/+layout.svelte, which DOES need buildPlatformUrl because a
  tenant host IS rewritten to /_org/<slug>/…. The two footers need opposite
  treatments because they render on different host classes. (Codex-6wkr1)
-->

<footer class="footer">
  <PageContainer class="footer-inner">
    <p class="copyright">
      {m.footer_copyright()}
    </p>

    <nav class="links" aria-label="Footer">
      <a href="/about" class="footer-link">{m.footer_about()}</a>
      <a href="/terms" class="footer-link">{m.footer_terms()}</a>
      <a href="/privacy" class="footer-link">{m.footer_privacy()}</a>
    </nav>
  </PageContainer>
</footer>

<style>
  .footer {
    padding: var(--space-12) 0;
    background-color: var(--color-surface-secondary);
    border-top: var(--border-width) var(--border-style) var(--color-border);
    margin-top: auto;
  }

  :global(.footer-inner) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-6);
  }

  @media (--breakpoint-sm) {
    :global(.footer-inner) {
      flex-direction: row;
      justify-content: space-between;
    }
  }

  .copyright {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .links {
    display: flex;
    gap: var(--space-6);
  }

  .footer-link {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    transition: var(--transition-colors);
  }

  .footer-link:hover {
    color: var(--color-interactive);
  }
</style>
