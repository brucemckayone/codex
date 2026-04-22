<!--
  @component ContentFormSectionRail

  Left-rail section navigator for ContentForm. Shows each form
  section as a numbered anchor with a per-section readiness dot.
  Fixed-width, sticky, always visible — no "hidden behind scroll".

  The rail tracks scroll position via IntersectionObserver and marks
  the currently-visible section with aria-current.

  @prop sections  Ordered list of { id, label, ready? }
-->
<script lang="ts">
  import { onMount } from 'svelte';

  export interface RailSection {
    id: string;
    label: string;
    /** undefined = not scored; true/false = readiness state */
    ready?: boolean;
  }

  interface Props {
    sections: RailSection[];
  }

  const { sections }: Props = $props();

  let activeId = $state<string | null>(null);

  // IntersectionObserver: the section whose top is nearest the viewport
  // top edge (within the 0.25–0.75 band) is considered "active".
  onMount(() => {
    const motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const observer = new IntersectionObserver(
      (entries) => {
        // Prefer the entry with the largest intersectionRatio that is intersecting
        let best: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry;
        }
        if (best) activeId = best.target.id;
      },
      {
        // Band in the upper half of the viewport — feels like "what am I reading right now"
        rootMargin: '-20% 0px -55% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    // Register once targets exist
    queueMicrotask(() => {
      for (const section of sections) {
        const el = document.getElementById(section.id);
        if (el) observer.observe(el);
      }
    });

    // Return cleanup explicitly
    void motionOK;
    return () => observer.disconnect();
  });

  function handleClick(event: MouseEvent, id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    event.preventDefault();
    const motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: motionOK ? 'smooth' : 'auto', block: 'start' });
    // Optimistically mark active
    activeId = id;
    // Move keyboard focus into the section so assistive tech follows
    const focusable = el.querySelector<HTMLElement>(
      'input:not([type="hidden"]), textarea, select, button, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus({ preventScroll: true });
  }
</script>

<nav class="section-rail" aria-label="Form sections">
  <ol class="rail-list">
    {#each sections as section, index (section.id)}
      <li class="rail-item">
        <a
          href="#{section.id}"
          class="rail-link"
          data-active={activeId === section.id || undefined}
          data-ready={section.ready === true || undefined}
          data-unscored={section.ready === undefined || undefined}
          aria-current={activeId === section.id ? 'location' : undefined}
          onclick={(e) => handleClick(e, section.id)}
        >
          <span class="rail-ordinal" aria-hidden="true">
            {(index + 1).toString().padStart(2, '0')}
          </span>
          <span class="rail-pip" aria-hidden="true"></span>
          <span class="rail-label">{section.label}</span>
        </a>
      </li>
    {/each}
  </ol>
</nav>

<style>
  .section-rail {
    position: sticky;
    /* --cf-bar-height is set on the ContentForm layout element at runtime
       (measured from the command bar) so the rail sticks exactly under the
       bar regardless of viewport width / bar content. Falls back to a
       token-derived value until the measurement lands. */
    top: calc(var(--cf-bar-height, calc(var(--space-16) + var(--space-6))) + var(--space-3));
    align-self: start;
    padding: var(--space-4) 0;
    /* Ensure the rail sits above body content that scrolls past it. */
    z-index: 1;
  }

  .rail-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    /* Vertical meter rule threading the pips */
    position: relative;
  }

  .rail-list::before {
    content: '';
    position: absolute;
    left: calc(var(--space-8) + var(--space-1));
    top: var(--space-5);
    bottom: var(--space-5);
    width: var(--border-width);
    background: linear-gradient(
      to bottom,
      var(--color-border),
      color-mix(in srgb, var(--color-border) 40%, transparent)
    );
  }

  .rail-item {
    position: relative;
  }

  .rail-link {
    display: grid;
    grid-template-columns: var(--space-8) var(--space-3) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: var(--color-text-muted);
    transition: color var(--duration-fast) var(--ease-out),
                background-color var(--duration-fast) var(--ease-out);
  }

  .rail-link:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .rail-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .rail-link[data-active] {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  /* ── Ordinal numeral ("01", "02") — editorial tabular ─────── */
  .rail-ordinal {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
    text-align: right;
  }

  .rail-link[data-active] .rail-ordinal {
    color: var(--color-interactive);
    font-weight: var(--font-semibold);
  }

  /* ── Pip — small token indicator, fills on ready ────────────── */
  .rail-pip {
    width: var(--space-3);
    height: var(--space-3);
    border-radius: var(--radius-full, 9999px);
    border: var(--border-width-thick) var(--border-style) var(--color-border);
    background: var(--color-surface);
    position: relative;
    transition: border-color var(--duration-normal) var(--ease-out),
                background-color var(--duration-normal) var(--ease-out),
                transform var(--duration-normal) var(--ease-out);
  }

  /* Ready: fill with interactive (OKLCH-shifted brand) */
  .rail-link[data-ready] .rail-pip {
    background-color: var(--color-interactive);
    border-color: var(--color-interactive);
    box-shadow: 0 0 0 var(--space-1)
      color-mix(in srgb, var(--color-interactive) 18%, transparent);
  }

  /* Unscored sections (e.g. optional, organize, danger) — hollow mark */
  .rail-link[data-unscored] .rail-pip {
    border-style: dashed;
    border-color: color-mix(in srgb, var(--color-border) 80%, transparent);
  }

  /* Active scales the pip slightly */
  .rail-link[data-active] .rail-pip {
    transform: scale(1.15);
  }

  @media (prefers-reduced-motion: reduce) {
    .rail-link[data-active] .rail-pip { transform: none; }
  }

  /* ── Label ───────────────────────────────────────────────────── */
  .rail-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    letter-spacing: var(--tracking-tight);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rail-link[data-active] .rail-label {
    font-weight: var(--font-semibold);
  }
</style>
