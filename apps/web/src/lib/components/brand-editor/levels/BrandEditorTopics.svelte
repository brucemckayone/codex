<!--
  @component BrandEditorTopics

  The rail's Topics control (Codex-8swlj.2): how the landing's topic selector
  renders inside Browse everything. One bar (the default), Windows or Channels.

  Stored as tokenOverrides['topics-style'] and written through
  `updateField('tokenOverrides', …)`, never `setThemeTokenOverride`: that one
  writes darkTokenOverrides while the dark theme is being edited, and the
  style is one choice for both themes. Choosing One bar DELETES the key, so
  the default stays implicit (and a stale unknown value is cleared).

  A radiogroup with roving tabindex: arrow keys, Home and End select on move,
  so the live preview follows the keyboard (the BrandMixer.svelte pattern;
  see its header for why the keydown sits on each radio, not the group).
-->
<script lang="ts">
  import {
    DEFAULT_TOPICS_STYLE,
    TOPICS_STYLE_KEY,
    TOPICS_STYLES,
    type TopicsStyle,
  } from '@codex/validation';
  import { brandEditor, resolveTopicsStyle } from '$lib/brand-editor';

  // Keyed by TopicsStyle, so a style added to TOPICS_STYLES without its copy
  // fails the type check. The cards render in TOPICS_STYLES' order.
  const COPY: Record<TopicsStyle, { label: string; description: string }> = {
    bar: { label: 'One bar', description: 'Topic chips in the filter bar' },
    windows: {
      label: 'Windows',
      description: 'Topic plates that show your shader',
    },
    channels: { label: 'Channels', description: 'A front page per topic' },
  };

  const labelId = $props.id();

  const active = $derived(
    resolveTopicsStyle(undefined, brandEditor.pending?.tokenOverrides)
  );

  function select(style: TopicsStyle): void {
    if (!brandEditor.pending) return;
    const next = { ...brandEditor.pending.tokenOverrides };
    if (style === DEFAULT_TOPICS_STYLE) {
      delete next[TOPICS_STYLE_KEY];
    } else {
      next[TOPICS_STYLE_KEY] = style;
    }
    brandEditor.updateField('tokenOverrides', next);
  }

  const STEPS: Record<string, number> = {
    ArrowRight: 1,
    ArrowDown: 1,
    ArrowLeft: -1,
    ArrowUp: -1,
  };

  function onKeydown(
    event: KeyboardEvent & { currentTarget: HTMLElement }
  ): void {
    const count = TOPICS_STYLES.length;
    let nextIndex: number | null = null;
    if (event.key in STEPS) {
      const index = TOPICS_STYLES.indexOf(active);
      nextIndex = (index + STEPS[event.key] + count) % count;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = count - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const style = TOPICS_STYLES[nextIndex];
    select(style);
    // Focus follows the selection, so the roving tab stop stays on the
    // checked card.
    event.currentTarget
      .closest('[role="radiogroup"]')
      ?.querySelector<HTMLElement>(`[data-style="${style}"]`)
      ?.focus();
  }
</script>

<div class="topics-editor">
  <section class="topics-editor__section">
    <span class="topics-editor__section-label" id={labelId}>Style</span>
    <div class="topics-editor__grid" role="radiogroup" aria-labelledby={labelId}>
      {#each TOPICS_STYLES as style (style)}
        {@const checked = active === style}
        <button
          type="button"
          class={['topics-editor__card', { 'topics-editor__card--active': checked }]}
          role="radio"
          aria-checked={checked}
          tabindex={checked ? 0 : -1}
          data-style={style}
          onclick={() => select(style)}
          onkeydown={onKeydown}
        >
          <span class="topics-editor__preview">
            {#if style === 'bar'}
              <svg viewBox="0 0 220 80" fill="none" aria-hidden="true">
                <rect x="0" y="0" width="220" height="80" rx="4" fill="var(--color-surface-secondary)" />
                <rect x="8" y="8" width="204" height="16" rx="3" fill="var(--color-text-muted)" opacity="0.12" />
                <rect x="14" y="12" width="30" height="8" rx="4" fill="var(--color-interactive)" opacity="0.5" />
                <rect x="48" y="12" width="26" height="8" rx="4" fill="var(--color-text-muted)" opacity="0.3" />
                <rect x="78" y="12" width="34" height="8" rx="4" fill="var(--color-text-muted)" opacity="0.3" />
                <rect x="116" y="12" width="24" height="8" rx="4" fill="var(--color-text-muted)" opacity="0.3" />
                <rect x="176" y="13" width="30" height="6" rx="1" fill="var(--color-text-muted)" opacity="0.25" />
                <rect x="8" y="32" width="64" height="40" rx="3" fill="var(--color-text-muted)" opacity="0.2" />
                <rect x="78" y="32" width="64" height="40" rx="3" fill="var(--color-text-muted)" opacity="0.2" />
                <rect x="148" y="32" width="64" height="40" rx="3" fill="var(--color-text-muted)" opacity="0.2" />
              </svg>
            {:else if style === 'windows'}
              <svg viewBox="0 0 220 80" fill="none" aria-hidden="true">
                <rect x="0" y="0" width="220" height="80" rx="4" fill="var(--color-surface-secondary)" />
                <rect x="8" y="8" width="100" height="64" rx="3" fill="var(--color-interactive)" opacity="0.45" />
                <rect x="114" y="8" width="46" height="30" rx="3" fill="var(--color-interactive)" opacity="0.3" />
                <rect x="166" y="8" width="46" height="30" rx="3" fill="var(--color-interactive)" opacity="0.25" />
                <rect x="114" y="42" width="46" height="30" rx="3" fill="var(--color-interactive)" opacity="0.25" />
                <rect x="166" y="42" width="46" height="30" rx="3" fill="var(--color-interactive)" opacity="0.3" />
                <rect x="16" y="58" width="48" height="6" rx="1" fill="var(--color-text-muted)" opacity="0.6" />
                <rect x="120" y="30" width="26" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.5" />
                <rect x="172" y="30" width="22" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.5" />
                <rect x="120" y="64" width="22" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.5" />
                <rect x="172" y="64" width="28" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.5" />
              </svg>
            {:else if style === 'channels'}
              <svg viewBox="0 0 220 80" fill="none" aria-hidden="true">
                <rect x="0" y="0" width="220" height="80" rx="4" fill="var(--color-surface-secondary)" />
                <rect x="12" y="8" width="26" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.6" />
                <rect x="12" y="14" width="26" height="1.5" fill="var(--color-interactive)" opacity="0.7" />
                <rect x="46" y="8" width="22" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.3" />
                <rect x="76" y="8" width="30" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.3" />
                <rect x="114" y="8" width="20" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.3" />
                <rect x="8" y="20" width="204" height="52" rx="3" fill="var(--color-interactive)" opacity="0.3" />
                <rect x="16" y="28" width="22" height="3" rx="1" fill="var(--color-text-muted)" opacity="0.45" />
                <rect x="16" y="35" width="74" height="9" rx="2" fill="var(--color-text-muted)" opacity="0.65" />
                <rect x="16" y="48" width="64" height="3" rx="1" fill="var(--color-text-muted)" opacity="0.35" />
                <rect x="16" y="58" width="38" height="7" rx="3.5" fill="var(--color-interactive)" opacity="0.6" />
                <rect x="124" y="30" width="26" height="34" rx="2" fill="var(--color-surface-secondary)" opacity="0.7" />
                <rect x="154" y="30" width="26" height="34" rx="2" fill="var(--color-surface-secondary)" opacity="0.7" />
                <rect x="184" y="30" width="20" height="34" rx="2" fill="var(--color-surface-secondary)" opacity="0.7" />
              </svg>
            {/if}
          </span>
          <span class="topics-editor__text">
            <span class="topics-editor__card-label">{COPY[style].label}</span>
            <span class="topics-editor__card-note">{COPY[style].description}</span>
          </span>
        </button>
      {/each}
    </div>
    <p class="topics-editor__hint">
      Windows and Channels use your shader; without one they use your brand
      colours.
    </p>
  </section>
</div>

<style>
  .topics-editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .topics-editor__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .topics-editor__section-label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .topics-editor__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-2);
  }

  .topics-editor__card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    padding: var(--space-2);
    border: var(--border-width-thick) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    cursor: pointer;
    transition: var(--transition-colors);
    text-align: left;
    width: 100%;
  }

  .topics-editor__card:hover {
    border-color: var(--color-border);
    background: var(--color-surface-secondary);
  }

  .topics-editor__card:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .topics-editor__card--active {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  .topics-editor__card--active:hover {
    border-color: var(--color-interactive);
  }

  .topics-editor__preview {
    display: block;
    border-radius: var(--radius-md);
    overflow: hidden;
    line-height: 0;
  }

  .topics-editor__preview :global(svg) {
    width: 100%;
    height: auto;
    display: block;
  }

  .topics-editor__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding-inline: var(--space-1);
  }

  .topics-editor__card-label {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .topics-editor__card-note {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .topics-editor__hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
</style>
