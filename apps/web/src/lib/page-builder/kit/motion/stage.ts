/**
 * The page's entrance stage (03-expressive-contract X13). An entrance — a
 * reveal, a heading's build, a hand-drawn mark, a figure counting up — plays
 * ONCE, in time, when the visitor reaches it. It is never scrubbed by the
 * scroll, so it always finishes, even at the foot of a short page.
 *
 * Two observers serve a whole page. The first report on an element says where
 * it is as it appears (the page waking up, or content rendered later): on
 * screen or already passed, it is left as it is — that visitor has seen it;
 * below the fold it is ARMED, waiting on its first frame out of sight. An
 * armed element plays when its top clears a line above the floating call to
 * action, or — at the foot of a page that cannot scroll that far — as soon as
 * it is in view. Nothing is staged on a still page (the canvas, thumbnails) or
 * under reduced motion, and without JavaScript nothing is ever armed: the
 * final state is what the server sends.
 */

export interface Actor {
  /** Hold the first frame, out of sight. False: it has nothing to play. */
  arm(): boolean;
  /** Play, `order` steps after the first of those entering together. */
  play(order: number): void;
  /** Its own look again, whatever it was doing. */
  settle(): void;
}

/** The line never sits lower than this share of the screen, from its foot. */
const FLOOR = 0.15;
/** Room between the floating call to action and the line, as a share. */
const AIR = 0.02;
/** Elements entering together step in at most this many times. */
const STEPS = 3;

const stages = new WeakMap<Element, Stage>();

/** The stage of the page `el` is on, or null where nothing may move. */
export function stageFor(el: Element): Stage | null {
  if (
    typeof IntersectionObserver === 'undefined' ||
    el.closest('[data-lp-still]') ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  )
    return null;
  const root = el.closest('.lp') ?? el.ownerDocument.documentElement;
  let stage = stages.get(root);
  if (!stage) {
    stage = new Stage(root, () => stages.delete(root));
    stages.set(root, stage);
  }
  return stage;
}

/** The line's height above the screen's foot, as a percentage: over the bar. */
function lineShare(root: Element): number {
  const bar = root.querySelector<HTMLElement>(':scope > .lp-sticky');
  // `offsetTop` ignores the transform that tucks a hidden bar away.
  const footprint = bar?.offsetHeight
    ? (innerHeight - bar.offsetTop) / innerHeight + AIR
    : 0;
  return Math.round(Math.min(0.5, Math.max(FLOOR, footprint)) * 100);
}

/** How much further the page can still scroll down. */
function ahead(root: Element): number {
  for (let el = root.parentElement; el; el = el.parentElement) {
    if (
      el.scrollHeight > el.clientHeight &&
      /auto|scroll|overlay/.test(getComputedStyle(el).overflowY)
    )
      return el.scrollHeight - el.scrollTop - el.clientHeight;
  }
  const page =
    root.ownerDocument.scrollingElement ?? root.ownerDocument.documentElement;
  return page.scrollHeight - page.scrollTop - page.clientHeight;
}

interface Part {
  actors: Actor[];
  armed: boolean;
}

export class Stage {
  private readonly cast = new Map<Element, Part>();
  private readonly view: IntersectionObserver;
  private readonly line: IntersectionObserver;
  private readonly share: number;

  constructor(
    private readonly root: Element,
    private readonly closed: () => void
  ) {
    this.share = lineShare(root);
    this.view = new IntersectionObserver((entries) => this.seen(entries));
    this.line = new IntersectionObserver(
      (entries) =>
        this.play(entries.filter((e) => e.isIntersecting).map((e) => e.target)),
      { rootMargin: `0px 0px -${this.share}% 0px` }
    );
  }

  /** Stage an element; returns what takes it off again. */
  add(el: Element, actor: Actor): () => void {
    let part = this.cast.get(el);
    const fresh = !part;
    if (!part) {
      part = { actors: [], armed: false };
      this.cast.set(el, part);
    }
    // A second actor on an element already waiting joins it on its first frame.
    if (!part.armed || actor.arm()) part.actors.push(actor);
    // Watched only once it has its actor, however soon the first report comes.
    if (fresh) this.view.observe(el);
    return () => this.release(el, actor);
  }

  private seen(entries: IntersectionObserverEntry[]) {
    for (const entry of entries) {
      const part = this.cast.get(entry.target);
      if (!part) continue;
      if (!part.armed) {
        const below = !entry.isIntersecting && entry.boundingClientRect.top > 0;
        part.actors = below ? part.actors.filter((actor) => actor.arm()) : [];
        if (part.actors.length === 0) this.forget(entry.target);
        else {
          part.armed = true;
          this.line.observe(entry.target);
        }
      } else if (entry.isIntersecting && !this.reachable(entry)) {
        this.play([entry.target]);
      }
    }
  }

  /** Can the page still scroll far enough to lift it to the line? */
  private reachable(entry: IntersectionObserverEntry): boolean {
    const height = entry.rootBounds?.height ?? innerHeight;
    const rise = entry.boundingClientRect.top - height * (1 - this.share / 100);
    return rise <= ahead(this.root) + 1;
  }

  private play(targets: Element[]) {
    let order = 0;
    for (const target of targets) {
      const part = this.cast.get(target);
      if (!part?.armed) continue;
      this.forget(target);
      for (const actor of part.actors) actor.play(Math.min(order, STEPS));
      order += 1;
    }
  }

  private release(el: Element, actor: Actor) {
    actor.settle();
    const part = this.cast.get(el);
    if (!part) return;
    part.actors = part.actors.filter((a) => a !== actor);
    if (part.actors.length === 0) this.forget(el);
  }

  private forget(el: Element) {
    this.cast.delete(el);
    this.view.unobserve(el);
    this.line.unobserve(el);
    if (this.cast.size > 0) return;
    this.view.disconnect();
    this.line.disconnect();
    this.closed();
  }
}
