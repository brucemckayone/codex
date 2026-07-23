/* One course, two surfaces. Both the sales preview and the journey dashboard
   render from this single object so the lesson list can never drift.
   Rootwork = the foundation course; its lessons run in recommended order
   through the same five stages every journey shares. */
window.COURSE = {
  title: 'Rootwork',
  kicker: 'The foundation course',
  lede: 'Before any journey, the ground. Rootwork teaches the body the basics of safety and settling — the practices everything else grows from.',
  priceNote: 'Included with membership · £12 a month',
  stages: [
    {
      n: 'Regulation',
      gloss: 'Finding the ground. Teaching the body it is safe enough to soften.',
      lessons: [
        { t: 'Orienting',           type: 'practice',   min: 8,  done: true, free: true },
        { t: 'The long exhale',     type: 'audio',      min: 6,  done: true },
        { t: 'Feet on the earth',   type: 'practice',   min: 10, done: true },
      ],
    },
    {
      n: 'Embodiment',
      gloss: 'Coming back into sensation — feeling what is actually here.',
      lessons: [
        { t: 'Body scan',           type: 'practice',   min: 12, done: true },
        { t: 'Where am I holding?', type: 'reflection', min: 5,  current: true },
        { t: 'Weight & support',    type: 'practice',   min: 9 },
      ],
    },
    {
      n: 'Attunement',
      gloss: 'Listening inward; letting need and impulse be known.',
      lessons: [
        { t: 'The felt sense',      type: 'audio',      min: 7 },
        { t: 'Naming need',         type: 'reflection', min: 6 },
        { t: 'Small yes, small no', type: 'practice',   min: 8 },
      ],
    },
    {
      n: 'Co-regulation',
      gloss: 'Being met by another. The body settling in company.',
      lessons: [
        { t: 'Safe eyes',           type: 'practice',   min: 10 },
        { t: 'Borrowing calm',      type: 'audio',      min: 8 },
      ],
    },
    {
      n: 'Reclamation',
      gloss: 'Living from wholeness — taking back what was held away.',
      lessons: [
        { t: 'Standing in it',        type: 'practice',   min: 11 },
        { t: 'What is mine to keep',  type: 'reflection', min: 7 },
        { t: 'Closing the circle',    type: 'audio',      min: 9 },
      ],
    },
  ],
};

/* flat helpers shared by both surfaces */
window.COURSE.flat = window.COURSE.stages.flatMap((s, si) =>
  s.lessons.map((l, li) => ({ ...l, stage: s.n, stageIndex: si, lessonIndex: li }))
);
window.COURSE.totals = (() => {
  const flat = window.COURSE.flat;
  const total = flat.length;
  const done = flat.filter(l => l.done).length;
  const minutes = flat.reduce((a, l) => a + l.min, 0);
  return { total, done, minutes, pct: Math.round((done / total) * 100) };
})();
window.TYPE_META = {
  practice:   { label: 'practice',   glyph: '❋' },
  audio:      { label: 'audio',      glyph: '♪' },
  reflection: { label: 'reflection', glyph: '✎' },
};
