<!--
  @component FactsLine

  A line of short facts about the course, parted by dots: "6 stages · 24
  practices · 2 hr 41 min of video and audio". Small, in the soft ink, its
  figures lined up. The hero and the benefits draw it (Codex-61zsk.73), and
  nothing to say draws nothing.

  A WRAP NEVER LEAVES A DOT AT EITHER END. A fact never breaks inside, and
  each draws its own dot before it: silent, with a hidden comma as the
  spoken pause. The run is shifted one dot's room to the left inside a clip,
  so where a line starts at the edge (start-aligned, the kit's default) the
  dot that leads it is cut away, with no script. A centred line starts in
  its own free space, out of the clip's reach, so once the page's script has
  laid it out the line marks each fact that starts a line, and that dot is
  hidden. Hidden, it keeps its room, so nothing re-wraps, and the shift still
  puts the words themselves in the middle. Centred or not is the parent's
  `text-align`, which the line inherits, so no Style has a prop to keep in
  step. Until the script runs, a centred line that wraps shows the dot that
  leads its second line, as every facts line did before this one.
-->
<script lang="ts">
  import type { Attachment } from 'svelte/attachments';

  interface Props {
    facts: readonly string[];
    class?: string;
  }

  const { facts, class: className }: Props = $props();

  /** Which facts start a line as laid out: none until the script has looked. */
  let starts = $state<readonly boolean[]>([]);

  /**
   * Reads where each fact sits whenever the run or a fact changes size: a web
   * font landing re-wraps the line without resizing the run, but never
   * without resizing a fact. A fact starts a line when it sits below the
   * middle of the one before it.
   */
  function lineStarts(count: number): Attachment<HTMLElement> {
    return (run) => {
      if (count < 2 || typeof ResizeObserver === 'undefined') return;
      const read = () => {
        const placed = [...run.querySelectorAll<HTMLElement>(':scope > .lp-facts__fact')];
        starts = placed.map((fact, index) => {
          const before = placed[index - 1];
          return before !== undefined && fact.offsetTop > before.offsetTop + before.offsetHeight / 2;
        });
      };
      const observer = new ResizeObserver(read);
      observer.observe(run);
      for (const fact of run.children) observer.observe(fact);
      return () => observer.disconnect();
    };
  }
</script>

{#if facts.length > 0}
  <p class="lp-facts {className ?? ''}">
    <span class="lp-facts__run" {@attach lineStarts(facts.length)}
      >{#each facts as fact, index (index)}<span
          class="lp-facts__fact"
          data-starts={starts[index] ? '' : undefined}
          >{#if index > 0}<span class="sr-only">{', '}</span>{/if}{fact}</span
        >{/each}</span
    >
  </p>
{/if}

<style>
  .lp-facts {
    /* One dot's room: the gap between two facts, the dot in its middle. */
    --_dot: 1.1em;
    margin: 0;
    /* Across only, so a glyph that rises above its line is never cut. */
    overflow-x: clip;
    color: var(--lp-ink-soft);
    font-family: var(--lp-font-body);
    font-size: var(--lp-size-small);
    font-variant-numeric: tabular-nums;
    line-height: var(--lp-leading-body);
  }

  .lp-facts__run {
    display: block;
    margin-inline-start: calc(-1 * var(--_dot));
    text-wrap: balance;
  }

  .lp-facts__fact {
    display: inline-block;
    white-space: nowrap;
  }

  /* An engine that cannot read the silent form keeps the plain one, so the
     dot still fills the room the run is shifted by and parts the facts; it
     is then read aloud, beside the comma. */
  .lp-facts__fact::before {
    content: '·';
    content: '·' / '';
    display: inline-block;
    inline-size: var(--_dot);
    text-align: center;
  }

  /* The first fact leads the line wherever it sits; a centred line's later
     leads are marked by the script (above). */
  .lp-facts__fact:first-child::before,
  .lp-facts__fact[data-starts]::before {
    visibility: hidden;
  }
</style>
