/**
 * The film and course counts every tier surface words the same way
 * (Codex-2hxff.91): "18 films and 2 courses", "18 films · 2 courses",
 * "20 items". "Films" is the owner's word for every content item (video,
 * audio, article).
 */

import * as m from '$paraglide/messages';

export function filmsLabel(count: number): string {
  return count === 1
    ? m.plan_count_films_one()
    : m.plan_count_films_other({ count });
}

export function coursesLabel(count: number): string {
  return count === 1
    ? m.plan_count_courses_one()
    : m.plan_count_courses_other({ count });
}

/** Films and courses together ("20 items"), as the guidance note counts them. */
export function itemsLabel(count: number): string {
  return count === 1
    ? m.plan_count_items_one()
    : m.plan_count_items_other({ count });
}

/**
 * "18 films and 2 courses". With `omitZero`, a kind with none is left out
 * ("4 films"), for sentences about what a change touches; with both zero it
 * still says "0 films".
 */
export function countsAnd(
  films: number,
  courses: number,
  omitZero = false
): string {
  if (omitZero && courses === 0) return filmsLabel(films);
  if (omitZero && films === 0) return coursesLabel(courses);
  return m.plan_counts_films_and_courses({
    films: filmsLabel(films),
    courses: coursesLabel(courses),
  });
}

/** "18 films · 2 courses", the tier row's link into its checklist. */
export function countsDot(films: number, courses: number): string {
  return m.plan_counts_films_dot_courses({
    films: filmsLabel(films),
    courses: coursesLabel(courses),
  });
}
