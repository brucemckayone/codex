<script lang="ts">
  import { PageContainer } from '../index';
</script>

<footer class="footer">
  <PageContainer class="footer-inner">
    <p class="copyright">
      &copy; {new Date().getFullYear()} Codex. All rights reserved.
    </p>

    <nav class="links" aria-label="Footer">
      <a href="/about" class="footer-link">About</a>
      <a href="/terms" class="footer-link">Terms</a>
      <a href="/privacy" class="footer-link">Privacy</a>
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

  @media (min-width: 640px) {
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
    color: var(--color-primary-500);
  }
</style>
