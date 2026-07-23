/* Prototype-map overlay — a shared nav across ALL surface mockups.
   One <script src="protonav.js"></script> per page injects a fixed corner button
   that opens a grouped directory of every surface, with the current page marked and
   not-yet-built surfaces dimmed. Deliberately separate from each page's own top bar —
   this is prototype navigation, not product chrome. */
(function () {
  const SURFACES = [
    { group: 'Public', items: [
      { href: 'course-sell.html',        label: 'Sales page' },
      { href: 'explore.html',            label: 'Explore' },
      { href: 'content-standalone.html', label: 'Content page · standalone' },
      { href: 'checkout.html',           label: 'Offer / checkout' },
    ]},
    { group: 'Member', items: [
      { href: 'library.html',            label: 'Library' },
      { href: 'course-dashboard.html',   label: 'Journey dashboard' },
      { href: 'content-incourse.html',   label: 'Content page · in-course' },
    ]},
    { group: 'Creator', items: [
      { href: 'studio-journeys.html',    label: 'Studio home · journeys' },
      { href: 'builder-new.html',        label: 'Create flow' },
      { href: 'course-editor.html',      label: 'Course curriculum' },
      { href: 'builder.html',            label: 'Sales-page builder' },
      { href: 'reporting.html',          label: 'Reporting' },
    ]},
    { group: 'Docs', items: [
      { href: 'flows.html',              label: 'User flows & friction map' },
    ]},
  ];

  const here = location.pathname.split('/').pop() || 'index.html';

  const css = `
  #pmap-btn{position:fixed;left:14px;bottom:14px;z-index:9998;display:flex;align-items:center;gap:.5rem;
    padding:.5rem .85rem;border-radius:999px;font:600 .72rem/1 Inter,system-ui,sans-serif;letter-spacing:.02em;
    color:#f1e8d6;background:rgba(20,14,9,.82);backdrop-filter:blur(12px);
    border:1px solid rgba(216,169,78,.34);box-shadow:0 10px 30px -12px #000;cursor:pointer;transition:border-color .2s,transform .15s}
  #pmap-btn:hover{border-color:rgba(216,169,78,.7);transform:translateY(-1px)}
  #pmap-btn .d{width:6px;height:6px;border-radius:50%;background:#d8a94e;box-shadow:0 0 8px 1px rgba(216,169,78,.7)}
  #pmap{position:fixed;left:14px;bottom:58px;z-index:9999;width:min(300px,calc(100vw - 28px));
    background:rgba(15,10,6,.96);backdrop-filter:blur(16px);border:1px solid rgba(216,169,78,.22);
    border-radius:16px;padding:1rem 1rem 1.1rem;box-shadow:0 24px 60px -20px #000;
    opacity:0;transform:translateY(8px) scale(.98);transform-origin:bottom left;pointer-events:none;transition:opacity .2s,transform .2s}
  #pmap.open{opacity:1;transform:none;pointer-events:auto}
  #pmap h4{font:600 .62rem/1 Inter,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.22em;color:#8f8168;margin:.9rem 0 .45rem}
  #pmap h4:first-child{margin-top:.2rem}
  #pmap .pm-t{font:400 1rem/1.1 Fraunces,Georgia,serif;color:#f1e8d6;margin-bottom:.1rem}
  #pmap .pm-s{font:.66rem/1 Inter,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#d8a94e;margin-bottom:.7rem}
  #pmap a{display:flex;align-items:center;gap:.55rem;padding:.42rem .55rem;border-radius:9px;color:#c9baa0;
    font:500 .82rem/1.2 Inter,system-ui,sans-serif;transition:background .15s,color .15s}
  #pmap a:hover{background:rgba(241,232,214,.07);color:#f1e8d6}
  #pmap a.on{color:#140e09;background:#d8a94e;font-weight:600}
  #pmap a.soon{color:#6f6350;cursor:default}
  #pmap a.soon:hover{background:none;color:#6f6350}
  #pmap a .tag{margin-left:auto;font-size:.6rem;letter-spacing:.14em;text-transform:uppercase;color:#8f8168}
  #pmap-scrim{position:fixed;inset:0;z-index:9997;background:transparent;display:none}
  #pmap-scrim.open{display:block}
  @media (prefers-reduced-motion: reduce){#pmap,#pmap-btn{transition:none}}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  const scrim = document.createElement('div'); scrim.id = 'pmap-scrim';
  const btn = document.createElement('button'); btn.id = 'pmap-btn';
  btn.innerHTML = '<span class="d"></span> Prototype map';

  const panel = document.createElement('nav'); panel.id = 'pmap';
  panel.innerHTML =
    '<div class="pm-t">Guided Journeys</div><div class="pm-s">surface map</div>' +
    SURFACES.map(g =>
      `<h4>${g.group}</h4>` + g.items.map(it => {
        if (it.href === here) return `<a class="on" href="${it.href}">${it.label}<span class="tag">here</span></a>`;
        if (it.soon)          return `<a class="soon">${it.label}<span class="tag">soon</span></a>`;
        return `<a href="${it.href}">${it.label}</a>`;
      }).join('')
    ).join('');

  document.body.appendChild(scrim);
  document.body.appendChild(btn);
  document.body.appendChild(panel);

  function toggle(open) {
    const o = open ?? !panel.classList.contains('open');
    panel.classList.toggle('open', o);
    scrim.classList.toggle('open', o);
  }
  btn.addEventListener('click', () => toggle());
  scrim.addEventListener('click', () => toggle(false));
  addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });
})();
