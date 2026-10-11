/**
 * The hero's facts line (3b round 1): the course's shape and its way in, read
 * off the page's own data, so a visitor knows both at once —
 * "3 stages · 4 practices · from £15 per month".
 *
 * The price is `pricingView`'s, so it is only ever a path the live offer has,
 * at what that path charges: the lowest of them, marked "from" when there is
 * more than one. A viewer who is enrolled, a course with no way in and an
 * offer that could not be read all get the shape alone. A count of nothing is
 * left out, and a page with nothing to say draws no line at all.
 */
import type { JourneySalesContext } from '../../render/types';
import { COPY, priceWithCadence } from './copy';
import { pricingView } from './offer';

export function heroFacts(context: JourneySalesContext): string[] {
  const facts: string[] = [];
  const stages = context.stages.length;
  const practices = context.stages.reduce(
    (count, stage) => count + stage.practices.length,
    0
  );
  if (stages > 0) facts.push(COPY.course.stages(stages));
  if (practices > 0) facts.push(COPY.course.practices(practices));

  const view = pricingView(context, {});
  const [first, ...rest] = view.paths;
  if (view.state === 'priced' && first) {
    const lowest = rest.reduce(
      (low, path) => (path.priceCents < low.priceCents ? path : low),
      first
    );
    const price = priceWithCadence(lowest);
    facts.push(rest.length > 0 ? COPY.hero.from(price) : price);
  }
  return facts;
}
