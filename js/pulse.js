/* pulse.js — anonymous usage beacon for lalalachuck.com (2026-09-25, CEO option C).
 *
 * What is recorded, per visit: a random session id that lives only in this tab's memory,
 * when the visit started, how many seconds the tab was actually visible, the deepest scroll
 * position, viewport size, theme, language, referrer host, which chapter/step was active
 * for how long, which videos actually played, and which page sections were reached.
 * Nothing is stored in the browser (no cookie, no localStorage), so a returning visitor is
 * simply a new session. The receiver (pulse/src/worker.js) keeps no IP address.
 *
 * Sends only on the real site. Add ?pulse=1 to force it on a local preview. */
(function () {
  var q = new URLSearchParams(location.search);
  var here = location.hostname;
  var live = here === 'lalalachuck.com' || here === 'www.lalalachuck.com';
  if (!live && q.get('pulse') !== '1') return;
  if (q.get('pulse') === '0') return;
  if (!('sendBeacon' in navigator)) return;

  var URL_ = 'https://lala-pulse.chuckmails.workers.dev/p';
  var MAX_FLUSHES = 8;
  var sid = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  var t0 = Date.now();
  var flushes = 0, dirty = false;
  var activeMs = 0, visibleSince = document.visibilityState === 'visible' ? Date.now() : 0;
  var maxScroll = 0;
  var steps = [];           // {c, i, at (s since t0), dur (s)}
  var current = null;       // the open step record
  var videos = {}, reached = {};

  function secs(ms) { return Math.round(ms / 1000); }
  function activeSeconds() { return secs(activeMs + (visibleSince ? Date.now() - visibleSince : 0)); }
  function refHost() { try { return document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { return ''; } }

  function closeStep() {
    if (!current) return;
    current.dur = Math.max(0, secs(Date.now() - current._open));
    delete current._open;
    current = null;
  }
  function openStep(chapter, idx) {
    closeStep();
    current = { c: chapter, i: idx, at: secs(Date.now() - t0), _open: Date.now() };
    steps.push(current);
    if (steps.length > 80) steps.shift();
    reached[chapter] = 1;
    dirty = true;
  }

  document.addEventListener('journey:step', function (e) {
    var d = e.detail || {};
    if (d.step < 0 || !d.engaged) {                           // left the chapter, or not in it yet
      if (current && current.c === d.chapter) { closeStep(); dirty = true; }
      return;
    }
    openStep(d.chapter, d.step);
  });
  // a chapter whose pinned range we scroll out of without a step<0 event is closed by the next open

  // sections without steps: hero (always), at-a-glance, footer
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { reached[en.target.id || en.target.tagName.toLowerCase()] = 1; dirty = true; } });
  }, { threshold: 0.3 });
  ['hero', 'glance'].forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });
  var foot = document.querySelector('footer'); if (foot) io.observe(foot);

  document.querySelectorAll('video[id]').forEach(function (v) {
    v.addEventListener('playing', function () { if (!videos[v.id]) { videos[v.id] = 1; dirty = true; } });
  });

  function onScroll() {
    var doc = document.documentElement;
    var max = Math.max(1, doc.scrollHeight - doc.clientHeight);
    var pct = Math.round(100 * (window.scrollY || window.pageYOffset) / max);
    if (pct > maxScroll) { maxScroll = Math.min(100, pct); dirty = true; }
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  function snapshot() {
    var open = current ? { c: current.c, i: current.i, at: current.at, dur: secs(Date.now() - current._open) } : null;
    var list = steps.map(function (s) { return s === current ? open : { c: s.c, i: s.i, at: s.at, dur: s.dur || 0 }; });
    return JSON.stringify({
      sid: sid, t0: t0, n: flushes + 1, active: activeSeconds(), maxScroll: maxScroll,
      vp: window.innerWidth + 'x' + window.innerHeight,
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      theme: document.documentElement.getAttribute('data-theme') || '',
      lang: navigator.language || '', ref: refHost(), path: location.pathname,
      steps: list, videos: Object.keys(videos), reached: Object.keys(reached),
    });
  }
  function flush(force) {
    if (!force && !dirty) return;
    if (flushes >= MAX_FLUSHES && !force) return;
    if (flushes >= MAX_FLUSHES + 2) return;             // hard cap even for forced sends
    try { if (navigator.sendBeacon(URL_, snapshot())) { flushes++; dirty = false; } } catch (e) {}
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      if (visibleSince) { activeMs += Date.now() - visibleSince; visibleSince = 0; }
      flush(true);
    } else if (!visibleSince) {
      visibleSince = Date.now();
    }
  });
  window.addEventListener('pagehide', function () { flush(true); });
  // a first note once the visitor has clearly engaged, then every 45 s while something changed
  setTimeout(function () { flush(true); }, 15000);
  setInterval(function () { if (document.visibilityState === 'visible') flush(false); }, 45000);
  onScroll();
})();
