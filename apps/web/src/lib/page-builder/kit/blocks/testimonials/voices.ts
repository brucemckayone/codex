/**
 * The quotes a testimonials section shows: the course's own testimonials
 * first, in their order, then the creator's. Merged, never either/or — a
 * layout arranges every voice and drops none.
 */
import type { JourneyTestimonialView } from '$lib/page-builder';
import type { TestimonialItem } from './definition';

export interface Testimonial {
  key: string;
  quote: string;
  name?: string;
  detail?: string;
  /** How much room the words need: the big layouts size by it. */
  length: 'short' | 'medium' | 'long';
}

/** One pair of double quotes around the whole text, and none inside it. */
const WRAPPED = /^["“]([^"“”]+)["”]$/;

/** The block draws its own marks, so a creator's own pair would double them. */
export function unwrapQuote(text: string): string {
  const trimmed = text.trim();
  return (WRAPPED.exec(trimmed)?.[1] ?? trimmed).trim();
}

function lengthOf(quote: string): Testimonial['length'] {
  if (quote.length <= 90) return 'short';
  return quote.length <= 180 ? 'medium' : 'long';
}

function voice(
  key: string,
  text: string,
  name?: string | null,
  detail?: string | null
): Testimonial | null {
  const quote = unwrapQuote(text);
  if (!quote) return null;
  return {
    key,
    quote,
    name: name?.trim() || undefined,
    detail: detail?.trim() || undefined,
    length: lengthOf(quote),
  };
}

export function voices(
  live: readonly JourneyTestimonialView[],
  items: readonly TestimonialItem[] = []
): Testimonial[] {
  const course = [...live]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((t) =>
      voice(`course-${t.id}`, t.quote, t.authorName, t.authorContext)
    );
  const own = items.map((item, index) =>
    voice(`own-${index}`, item.quote, item.name, item.detail)
  );
  return [...course, ...own].filter(
    (entry): entry is Testimonial => entry !== null
  );
}
