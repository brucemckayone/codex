/**
 * A studio list read a page at a time (Codex-a6ofh.3.1), from the media
 * library's (Codex-a6ofh.1.6), so the content list keeps the same rules:
 *
 * - The first page is a remote query the view re-runs: a changed filter,
 *   sort or search is a new query, and the URL is the source of truth.
 * - While a changed view loads, the last list that arrived is held, so the
 *   page dims instead of flashing a skeleton on every keystroke.
 * - "Show more" appends the next page to the view it was read for, never to
 *   one the creator has since moved to; a page that repeats a row (a list
 *   written to between reads) shows it once.
 * - A failed read is a state, never an empty list: a first read that failed,
 *   or a refetch that did (kit keeps `current` and sets `error`).
 * - Each caller picks its Try again: `first.refresh()` re-reads the first
 *   page (the content list's LoadFailedAlert), `refresh()` every loaded page
 *   (the media library's). `refresh()` REJECTS when a read fails, so the
 *   caller logs it and keeps its rows. Never `invalidate()`: a load that
 *   throws there swaps in +error.svelte.
 *
 * Built in a component's script (it owns an effect), with reactive getters
 * for the args, so the view the URL describes drives it.
 */
import type { RemoteQuery } from '@sveltejs/kit';
import { isReadOutage } from '$lib/remote/query-result';

export interface ListPage<Item> {
  items: Item[];
  pagination: { total: number };
}

export interface PagedListOptions<Args, Page> {
  /** One page of the view the URL describes, `page` from 1. */
  args: (page: number) => Args;
  /** The remote query for those args (`listContent`, `listMedia`). */
  read: (args: Args) => RemoteQuery<Page>;
  /** A "Show more" that failed: logged by the caller's rule. */
  onMoreFailed: (error: unknown) => void;
}

/** A row of a page: `Page['items']`'s element type. */
type ItemOf<Page extends ListPage<{ id: string }>> = Page['items'][number];

export class PagedList<Args, Page extends ListPage<{ id: string }>> {
  readonly #options: PagedListOptions<Args, Page>;

  /** Which list the loaded pages belong to: "Show more" appends to one only. */
  readonly key = $derived.by(() => JSON.stringify(this.#options.args(1)));
  /** The first page of the view. */
  readonly first = $derived.by(() => this.#options.read(this.#options.args(1)));

  #held = $state.raw<Page | null>(null);
  #extra = $state.raw<{ key: string; pages: Page[] }>({ key: '', pages: [] });
  #moreLoadingFor = $state<string | null>(null);
  #moreFailedFor = $state<string | null>(null);

  constructor(options: PagedListOptions<Args, Page>) {
    this.#options = options;
    $effect(() => {
      const current = this.first.current;
      if (current) this.#held = current;
    });
  }

  /** The first page as shown: this view's, or the last one held while it loads. */
  readonly shown = $derived.by(() => this.first.current ?? this.#held);

  /** The pages "Show more" added to this view. */
  readonly #extraPages = $derived.by(() =>
    this.#extra.key === this.key ? this.#extra.pages : []
  );

  /**
   * A list read failed: this view's first read, or a refetch. Either way
   * nothing may claim the list is empty.
   */
  readonly failed = $derived.by(() => this.first.error != null);

  /**
   * This view's own read failed with nothing of its own landed: the failure
   * stands in for the list. The rows held are another view's (the filter the
   * creator just left), so they must never show under this one. A refetch
   * of the same view that failed is not this: kit keeps its `current`.
   */
  readonly unread = $derived.by(
    () => this.failed && this.first.current === undefined
  );

  /**
   * A 4xx (other than a timeout or a rate limit) refuses the same view
   * again, so it never reads as a connection problem with a Try again.
   */
  readonly refused = $derived.by(
    () => this.first.error != null && !isReadOutage(this.first.error)
  );

  /** Nothing has arrived for any view yet: the skeleton's moment. */
  readonly loading = $derived.by(() => this.shown === null && !this.failed);

  /** A changed view is loading over the last one held: dim, never blank. */
  readonly refreshing = $derived.by(
    () =>
      this.first.current === undefined && !this.failed && this.#held !== null
  );

  /** Every loaded row in order, each once. */
  readonly items = $derived.by(() => {
    const seen = new Set<string>();
    const out: ItemOf<Page>[] = [];
    for (const list of [this.shown, ...this.#extraPages]) {
      for (const item of list?.items ?? []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
    }
    return out;
  });

  /** The view's total, from the newest page read. */
  readonly total = $derived.by(
    () => (this.#extraPages.at(-1) ?? this.shown)?.pagination.total ?? 0
  );

  /** How many rows "Show more" could still add. */
  readonly left = $derived.by(() =>
    Math.max(0, this.total - this.items.length)
  );

  readonly moreLoading = $derived.by(() => this.#moreLoadingFor === this.key);
  readonly moreFailed = $derived.by(() => this.#moreFailedFor === this.key);

  /** Append the next page to this view. */
  async showMore(): Promise<void> {
    const key = this.key;
    const pages = this.#extraPages;
    const args = this.#options.args(pages.length + 2);
    this.#moreLoadingFor = key;
    this.#moreFailedFor = null;
    try {
      const next = await this.#options.read(args);
      if (key === this.key) this.#extra = { key, pages: [...pages, next] };
    } catch (error) {
      this.#options.onMoreFailed(error);
      if (key === this.key) this.#moreFailedFor = key;
    } finally {
      if (this.#moreLoadingFor === key) this.#moreLoadingFor = null;
    }
  }

  /**
   * Read every loaded page again (after a change, or the Try again). REJECTS
   * when a read fails, so the caller logs it and keeps its rows.
   */
  async refresh(): Promise<void> {
    const key = this.key;
    const more = this.#extraPages.map((_, index) =>
      this.#options.args(index + 2)
    );
    await Promise.all([
      this.first.refresh(),
      Promise.all(more.map((args) => this.#options.read(args))).then(
        (pages) => {
          if (key === this.key && pages.length > 0)
            this.#extra = { key, pages };
        }
      ),
    ]);
  }
}
