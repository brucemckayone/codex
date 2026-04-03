<script lang="ts">
  // Shadows Level 1 — placeholder for shadow intensity + tint controls.
  // Full implementation depends on DB expansion (tokenOverrides column).
  // For now, renders a preview card showing current shadow tokens.
</script>

<div class="shadows-level">
  <p class="shadows-level__note">
    Shadow customization will be available after the token overrides system is implemented.
  </p>

  <div class="shadows-level__preview">
    <div class="shadows-level__card shadows-level__card--sm">
      <span>shadow-sm</span>
    </div>
    <div class="shadows-level__card shadows-level__card--md">
      <span>shadow-md</span>
    </div>
    <div class="shadows-level__card shadows-level__card--lg">
      <span>shadow-lg</span>
    </div>
  </div>
</div>

<style>
  .shadows-level {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .shadows-level__note {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .shadows-level__preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4) 0;
  }

  .shadows-level__card {
    padding: var(--space-4);
    background: var(--color-surface);
    border-radius: var(--radius-md);
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .shadows-level__card--sm { box-shadow: var(--shadow-sm); }
  .shadows-level__card--md { box-shadow: var(--shadow-md); }
  .shadows-level__card--lg { box-shadow: var(--shadow-lg); }
</style>
