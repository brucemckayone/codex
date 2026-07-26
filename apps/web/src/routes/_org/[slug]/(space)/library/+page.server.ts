/**
 * Org library — server load.
 *
 * Adds the member "Your journeys" shelf (SPEC §8.4): the caller's enrolled
 * courses in THIS org, each with a progress rollup. The owned-content grid + the
 * resume rail stay client-side (the localStorage-backed `libraryCollection`);
 * this loader only supplies the journeys data the client cannot derive.
 *
 * The enrolled-courses read is AWAITED — the shelf is above the fold and part of
 * first paint — but wrapped so a worker hiccup degrades to an empty shelf rather
 * than a 500. Anonymous visitors get `[]` (the page's client auth-guard redirects
 * them); the worker also enforces `auth: 'required'`, so the session is the only
 * scope — never a client-supplied user id.
 */
import type { EnrolledCourseSummary } from '$lib/journeys/types';
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, platform, cookies }) => {
  const { org, user } = await parent();

  let enrolledCourses: EnrolledCourseSummary[] = [];
  if (user && org?.id) {
    try {
      enrolledCourses = await createServerApi(
        platform,
        cookies
      ).access.listEnrolledCourses(org.id);
    } catch {
      enrolledCourses = [];
    }
  }

  return { enrolledCourses };
};
