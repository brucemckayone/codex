<!--
  @component SettingsGeneral

  Placeholder for General settings page.
  Will be replaced by SETTINGS-02 implementation.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
</script>

<div class="settings-placeholder">
  <p class="placeholder-text">{m.settings_coming_soon()}</p>
</div>

<style>
  .settings-placeholder {
    padding: var(--space-12) var(--space-4);
    text-align: center;
  }

  .placeholder-text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }
</style>
