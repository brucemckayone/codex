/* mock-data.js — shared mock datasets for the surface prototypes.
   Loads AFTER course-data.js (reuses window.COURSE). GBP throughout (£).
   Also carries a first cut of the §6 entitlements resolver so surfaces can reflect
   real access states (canView vs canEnterCourse) — the seed of the backend mock. */

/* ── the three course-access paths (SPEC §7) — Rootwork's offer ── */
window.OFFERS = {
  course: 'Rootwork',
  note: 'One course. Three ways in.',
  paths: [
    {
      id: 'membership', kind: 'tier', name: 'Full membership',
      price: '£12', per: 'month', grants: 'course', best: true,
      who: 'All-in on the whole path', scope: 'Rootwork + every journey', commit: 'monthly · cancel anytime',
      blurb: 'Every journey, every practice — Rootwork and everything that grows from it.',
      bullets: ['All courses & journeys', 'New practices each month', 'Cancel anytime'],
    },
    {
      id: 'course-sub', kind: 'course_subscription', name: 'Rootwork monthly',
      price: '£6', per: 'month', grants: 'course',
      who: 'Just here for Rootwork', scope: 'Rootwork only', commit: 'monthly · cancel anytime',
      blurb: 'Just this course — a gentler way in. Upgrade to full membership whenever.',
      bullets: ['Rootwork only', 'All 14 practices', 'Cancel anytime'],
    },
    {
      id: 'one-off', kind: 'course_purchase', name: 'Own Rootwork',
      price: '£45', per: 'once', grants: 'course',
      who: 'Prefer to own, not subscribe', scope: 'Rootwork only', commit: 'one payment · yours forever',
      blurb: 'Buy the course outright. Yours to return to, for good.',
      bullets: ['Rootwork, forever', 'No subscription', 'Lifetime access'],
    },
  ],
};

/* ── content-page "ways in" (SPEC §6/§7 applied to a SINGLE content item) ──
   The star of the refined content page. A locked piece derives its payment paths
   from its own access policy + the courses it belongs to — the SAME model that
   powers canView(). One piece can be separable: buyable à la carte AND in a tier
   AND part of a course, so the content page must offer every door, like checkout. */
window.CONTENT_SHOWCASE = {
  title: 'Nervous system 101', type: 'video', min: 18, by: 'Of Blood and Bones',
  // §6.1 access POLICY — separable states, not a single accessType enum
  policy: { isFree: false, isPurchasable: true, priceCents: 900, includedInTierId: 'membership', courseOnly: false },
  courses: ['Rootwork'],   // pieces can belong to >1 course; buying the course also unlocks this
  bundlePrice: '£45',      // owning the whole journey — the "save vs buying pieces" cue
  blurb: 'A plain-language map of the nervous system in the body — what "activation" and "settling" actually are, and why your system does what it does. Watch once for the frame; return to it whenever you need reminding.',
};

/* derive the payment paths for a locked content item — buy à la carte / subscribe /
   enter via each owning course. Returns rows in the checkout's `offer` shape. */
window.waysInFor = function (content) {
  const p = content.policy || {};
  const paths = [];
  if (p.isPurchasable) paths.push({
    id: 'buy', kind: 'content_purchase', name: 'Buy this practice',
    price: '£' + (p.priceCents / 100).toFixed(0), per: 'once',
    blurb: 'This one piece, yours to keep. No subscription.', cta: 'Buy · ',
  });
  if (p.includedInTierId) paths.push({
    id: 'membership', kind: 'tier', name: 'Full membership', best: true,
    price: '£12', per: 'month',
    blurb: 'This and every practice & journey — new work each month.',
  });
  (content.courses || []).forEach(c => paths.push({
    id: 'course:' + c, kind: 'course', name: 'Through ' + c, course: c,
    price: 'from £6', per: 'month', href: 'course-sell.html',
    blurb: 'One step of the ' + c + ' journey. Own the whole path (' + (content.bundlePrice || '£45') + ') or subscribe.',
  }));
  return paths;
};

/* ── the member's library (SPEC §8.4). `via` is the ACCESS SOURCE — the key
   discovery point: how the shelf signals *why* you can see something. Sized up
   here so the "large library / find what you want" problem is real. ── */
window.LIBRARY = {
  member: 'Wren',
  journeys: [
    { title: 'Rootwork',                    kicker: 'The foundation course', tone: 'ember', via: 'membership', progress: { done: 4, total: 14, pct: 29 }, last: 'Where am I holding?', status: 'in-progress', href: 'course-dashboard.html' },
    { title: 'Sleep & the nervous system',  kicker: 'A journey',             tone: 'clay',  via: 'membership', progress: { done: 5, total: 7,  pct: 71 }, last: 'The weight of the day', status: 'in-progress', href: 'course-dashboard.html' },
    { title: 'Boundaries in the body',      kicker: 'A journey',             tone: 'rose',  via: 'purchased',  progress: { done: 9, total: 9,  pct: 100 }, last: 'Saying no in the body', status: 'completed', href: 'course-dashboard.html' },
    { title: 'Grief & the body',            kicker: 'A journey',             tone: 'blood', via: 'membership', progress: { done: 0, total: 9,  pct: 0 }, status: 'not-started', href: 'course-dashboard.html' },
    { title: 'Ancestral lineage',           kicker: 'A journey',             tone: 'blood', via: 'membership', progress: { done: 0, total: 11, pct: 0 }, status: 'not-started', href: 'course-dashboard.html' },
  ],
  // owned standalone content, most-recent first. `via` = access source; course:* opens in-course.
  content: [
    { title: 'The long exhale',       type: 'audio',      min: 6,  via: 'course:Rootwork',                 opened: '2h ago',      href: 'content-incourse.html' },
    { title: 'Nervous system 101',    type: 'video',      min: 18, via: 'purchased',                       opened: 'Yesterday',   resume: { pct: 52, at: '9:24', of: '18:00' }, href: 'content-standalone.html' },
    { title: 'The weight of the day', type: 'audio',      min: 12, via: 'course:Sleep & the nervous system', opened: 'Yesterday', href: 'content-incourse.html' },
    { title: 'Orienting',             type: 'practice',   min: 8,  via: 'free',                            opened: '3 days ago',  href: 'content-standalone.html' },
    { title: 'Feet on the earth',     type: 'practice',   min: 10, via: 'members',                         opened: '3 days ago',  href: 'content-standalone.html' },
    { title: 'A letter to the ache',  type: 'reflection', min: 7,  via: 'free',                            opened: 'Last week',   href: 'content-standalone.html' },
    { title: 'Saying no in the body', type: 'video',      min: 14, via: 'course:Boundaries in the body',   opened: 'Last week',   href: 'content-incourse.html' },
    { title: 'Where am I holding?',   type: 'practice',   min: 9,  via: 'course:Rootwork',                 opened: 'Last week',   href: 'content-incourse.html' },
    { title: 'Naming need',           type: 'reflection', min: 6,  via: 'course:Rootwork',                 opened: '2 weeks ago', href: 'content-incourse.html' },
    { title: 'The ground beneath',    type: 'audio',      min: 9,  via: 'members',                         opened: '2 weeks ago', resume: { pct: 35, at: '3:08', of: '9:00' }, href: 'content-standalone.html' },
    { title: 'Unclenching the jaw',   type: 'practice',   min: 5,  via: 'free',                            opened: '3 weeks ago', href: 'content-standalone.html' },
    { title: 'When the body says no', type: 'video',      min: 16, via: 'purchased',                       opened: 'A month ago', href: 'content-standalone.html' },
    { title: 'Softening the belly',   type: 'audio',      min: 8,  via: 'members',                         opened: 'A month ago', href: 'content-standalone.html' },
    { title: 'What grief asks',       type: 'reflection', min: 7,  via: 'free',                            opened: 'A month ago', href: 'content-standalone.html' },
  ],
};

/* ── Explore / discovery (SPEC §8.5) — courses sit alongside content but read
   differently (price · lesson count · "journey" affordance). ── */
window.EXPLORE = {
  // `start`/`after` carry the journey HIERARCHY — most begin at Rootwork, then branch.
  // Kept light here (Explore stays simple); the full "how they connect" view is a
  // separate surface (see openHierarchy note). `preview` = has a seller video (hover-play).
  courses: [
    { title: 'Rootwork',          kicker: 'Foundation course', tone: 'ember', lessons: 14, mins: 116, price: 'from £6/mo', href: 'course-sell.html',
      start: true, preview: true, tagline: 'Teach the body it is safe to settle.' },
    { title: 'Grief & the body',  kicker: 'A journey',         tone: 'blood', lessons: 9,  mins: 74,  price: 'membership',  href: 'course-sell.html',
      after: 'Rootwork', preview: true, tagline: 'For when grief lives in the chest and won’t move.' },
    { title: 'Sleep & the nervous system', kicker: 'A journey', tone: 'clay', lessons: 7, mins: 61,  price: 'membership',  href: 'course-sell.html',
      after: 'Rootwork', preview: false, tagline: 'Come down from the day. Let rest arrive.' },
  ],
  // Brand types (audio/video/practice/reflection) map onto the real contentType
  // {video,audio,article} + category axes; `topic` drives the category chips.
  content: [
    { title: 'The long exhale',    type: 'audio',      min: 6,  access: 'free',        topic: 'rest',        href: 'content-standalone.html' },
    { title: 'Nervous system 101', type: 'video',      min: 18, access: 'purchasable', price: '£9', topic: 'regulation', href: 'content-standalone.html' },
    { title: 'Feet on the earth',  type: 'practice',   min: 10, access: 'subscribers', topic: 'regulation',  href: 'content-standalone.html' },
    { title: 'Naming need',        type: 'reflection', min: 6,  access: 'course-only', course: 'Rootwork', topic: 'boundaries', href: 'content-standalone.html' },
    { title: 'Where am I holding?', type: 'practice',  min: 9,  access: 'free',        topic: 'grief',       href: 'content-standalone.html' },
    { title: 'The weight of the day', type: 'audio',   min: 12, access: 'subscribers', topic: 'rest',        href: 'content-standalone.html' },
    { title: 'Saying no in the body', type: 'video',   min: 14, access: 'purchasable', price: '£9', topic: 'boundaries', href: 'content-standalone.html' },
    { title: 'A letter to the ache', type: 'reflection', min: 7, access: 'free',       topic: 'grief',       href: 'content-standalone.html' },
  ],
};

/* ── Creator reporting (SPEC §8, §11) ──
   Each metric carries `src` = its DATA PROVENANCE, from the grounded audit:
     'live'   → derivable NOW (purchases, subscriptions, payouts, videoPlayback)
     'course' → needs the planned course_enrollments / practice_completions tables
     'track'  → needs NET-NEW instrumentation (sales-page views, traffic source) — not built or planned
   Surfacing provenance in the mock IS the "what's required to gather this" note. */
window.REPORT = {
  course: 'Rootwork', currency: '£',
  legend: {
    live:   { label: 'Live data', tip: 'From purchases, subscriptions & payouts today.' },
    course: { label: 'Needs course tables', tip: 'course_enrollments / practice_completions — designed, not built.' },
    track:  { label: 'Needs new tracking', tip: 'Sales-page views & traffic source aren’t captured anywhere yet.' },
  },
  kpis: [
    { label: 'Enrolled',          value: '342',    delta: '+28 (30d)',      src: 'course' },
    { label: 'Active this week',  value: '118',    delta: '34% of enrolled', src: 'course' },
    { label: 'Completed',         value: '64',     delta: '19% completion',  src: 'course' },
    { label: 'Revenue · 30d',     value: '£4,128', delta: '+£612',           src: 'live' },
  ],
  funnel: [
    { stage: 'Viewed sales page',      n: 5210, pct: 100, src: 'track' },
    { stage: 'Opened an offer',        n: 640,  pct: 12,  src: 'track' },
    { stage: 'Purchased / subscribed', n: 342,  pct: 6.6, src: 'live' },
    { stage: 'Completed Stage I',      n: 250,  pct: 4.8, src: 'course' },
    { stage: 'Completed the course',   n: 64,   pct: 1.2, src: 'course' },
  ],
  // "How they PAID" — the entitlement/purchase path. This is live (purchases+subscriptions).
  // NOTE: this is NOT "where they came from" (referrer/UTM) — that is un-trackable today.
  mix: [
    { path: 'Full membership',  n: 214, tone: 'ember', src: 'live' },
    { path: 'Rootwork monthly', n: 86,  tone: 'clay',  src: 'live' },
    { path: 'One-off purchase', n: 42,  tone: 'blood', src: 'live' },
  ],
  recent: [
    { who: 'w····n@···', when: '2h ago', what: 'Subscribed · full membership', src: 'live' },
    { who: 'm····a@···', when: '5h ago', what: 'Completed the course',         src: 'course' },
    { who: 'j····s@···', when: '1d ago', what: 'Bought Rootwork · £45',        src: 'live' },
    { who: 'r····y@···', when: '1d ago', what: 'Subscribed · Rootwork monthly', src: 'live' },
    { who: 'a····e@···', when: '2d ago', what: 'Enrolled (membership)',        src: 'course' },
  ],
};

/* ── Studio home / "your journeys" index (SPEC §8, creator surfaces) ──
   The hallway that ties the creator's editors together: every journey & page the
   creator owns, each opening into its Curriculum (course-editor), Sales page
   (builder) or Insights (reporting). `type` drives which doors a card shows —
   a landing page has no curriculum, a draft course has no revenue yet. ── */
window.STUDIO = {
  owner: 'Of Blood and Bones',
  items: [
    { name: 'Rootwork', type: 'course', status: 'published', tagline: 'The foundation course',
      stages: 5, practices: 14, enrolled: 342, revenue: '£4,128', updated: '2 days ago', tone: 'ember' },
    { name: 'Grief & the body', type: 'course', status: 'published', tagline: 'A journey',
      stages: 4, practices: 9, enrolled: 96, revenue: '£1,040', updated: 'Last week', tone: 'blood' },
    { name: 'Sleep & the nervous system', type: 'course', status: 'draft', tagline: 'A journey · still building',
      stages: 3, practices: 7, enrolled: 0, revenue: null, updated: 'Yesterday', tone: 'clay' },
    { name: 'Winter offering', type: 'landing', status: 'draft', tagline: 'A single landing page',
      updated: '3 days ago', tone: 'rose' },
  ],
};

/* ── §6 entitlements resolver (first cut / backend-mock seed) ──
   Content access POLICY is separable; access is granted via entitlements over a
   content item OR a course. canView(content) ≠ canEnterCourse(course). */
window.MOCK = (function () {
  // the signed-in member's active entitlements (what Wren holds)
  const entitlements = [
    { resourceType: 'course', resourceId: 'Rootwork', source: 'membership' },
    { resourceType: 'content', resourceId: 'Nervous system 101', source: 'content_purchase' },
  ];
  // which courses contain a given content title (shared content lives in >1 course)
  const contentCourses = {
    'The long exhale': ['Rootwork'],
    'Naming need': ['Rootwork', 'Grief & the body'],
    'Feet on the earth': ['Rootwork'],
  };
  const hasCourseEnt = c => entitlements.some(e => e.resourceType === 'course' && e.resourceId === c);
  const hasContentEnt = t => entitlements.some(e => e.resourceType === 'content' && e.resourceId === t);

  return {
    entitlements, contentCourses,
    // may the member open this content ANYWHERE?
    canView(content) {
      const p = content.policy || {};
      if (p.isFree || content.access === 'free') return true;
      if (p.courseOnly || content.access === 'course-only')
        return (contentCourses[content.title] || []).some(hasCourseEnt);
      if (hasContentEnt(content.title)) return true;
      if (content.access === 'purchasable' && hasContentEnt(content.title)) return true;
      return (contentCourses[content.title] || []).some(hasCourseEnt);
    },
    // may the member enter this course's JOURNEY? (course-scoped — never leaks)
    canEnterCourse(course) { return hasCourseEnt(course); },
  };
})();
