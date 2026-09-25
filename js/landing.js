/* Landing — journey engine.
 *
 * Single source of truth: an ordered station table (enter / step / exit per
 * chapter host), each station holding a scroll anchor (document y where the traveler
 * arrives) and a spine position (where its dot physically sits on the line).
 * Everything — spine fill, the glowing traveler dot, step highlighting and video
 * play/pause — derives from the same table. The engine only observes native scroll;
 * it never captures wheel/touch input or moves the page on the user's behalf.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  root.classList.toggle('reduced-motion', reduced);

  /* ---------- theme ---------- */
  var q = new URLSearchParams(location.search).get('theme');
  var saved = q || localStorage.getItem('pf-theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  function setTheme(t) {
    root.setAttribute('data-theme', t);
    localStorage.setItem('pf-theme', t);
    if (tbtn) {
      var light = t === 'light';
      tbtn.setAttribute('aria-pressed', light ? 'true' : 'false');
      tbtn.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    }
  }
  var tbtn = document.getElementById('themeToggle');
  setTheme(saved);
  if (tbtn) tbtn.addEventListener('click', function () {
    setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  /* ---------- reveal on view ---------- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
    });
  }, { threshold: 0.25 });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

  /* ---------- lazy media ---------- */
  var narrowMQ = window.matchMedia('(max-width: 960px)');
  function hydrate(container) {
    container.querySelectorAll('[data-src]').forEach(function (img) {
      if (img.src) return;
      // a dense figure drawn for a desktop column is unreadable at phone width, so
      // some assets ship a simplified variant sized for the narrow slot
      var narrow = narrowMQ.matches && img.getAttribute('data-src-narrow');
      img.src = narrow || img.getAttribute('data-src');
    });
  }
  var lazyIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { hydrate(e.target); lazyIO.unobserve(e.target); } });
  }, { rootMargin: '120% 0px' });
  document.querySelectorAll('.chapter, .autonomy').forEach(function (c) { lazyIO.observe(c); });

  /* ================================================================
     Journey engine
     ================================================================ */
  var ANCHOR = 0.55;          // flat sections: the traveler rides at 55% viewport height
  var DOT_OFFSET = 12;        // dot centre below a step item's top edge
  var CHAPTERS = [
    {
      id: 'autonomy', hostSel: '.autonomy-sticky', pinned: true,
      stepSel: '.autonomy-copy .step', bands: [0, 1 / 3, 2 / 3],
      frames: '[data-autonomy-frame]',
      videos: { 0: 'uavSimReal', 1: 'uavFlightVideo', 2: 'uavScene' },
    },
    {
      id: 'phenotyping', hostSel: '.chapter-sticky', pinned: true,
      stepSel: '.chapter-text .step', bands: [0, 1 / 3, 2 / 3],
      vis: '#chapterVisual .vis', captionId: 'visualCaption',
      captions: ['Row B · plant 01 · 3DGS · DAT 24',
                 'Row B · plant 01 · 31 leaf instances',
                 'Row B · one seedling → 6 plants × 11 days · DAT 4 → 24'],
      videos: { 2: 'galleryBurst' },
    },
    {
      id: 'pest', hostSel: '.chapter-sticky', pinned: true,
      stepSel: '.chapter-text .step', bands: [0, 0.5],
      vis: '#pestVisual .vis', captionId: 'pestCaption',
      captions: ['real scan above · schematic below',
                 'edge weight = how often that hand-off actually happened'],
      onStep: function (i) { if (window.pestLoop) window.pestLoop.setPhase(i >= 1 ? 2 : 0); },
    },
    {
      id: 'cattle', hostSel: '.chapter-sticky', pinned: true,
      stepSel: '.chapter-text .step', bands: [0, 0.5],
      vis: '#cattleVisual .vis', captionId: 'cattleCaption',
      captions: ['tracked ROI → 512-D embedding → identity match',
                 'camera + IoT → local inference → structured events'],
      videos: { 0: 'cowTrackVideo' },
      onStep: function (i) { if (window.cowIdentity) window.cowIdentity.setActive(i === 0); },
    },
  ];

  var cowMap = document.querySelector('#cattle .cow-system-map');
  var cowHost = cowMap && cowMap.parentElement;
  var vh = document.documentElement.clientHeight || window.innerHeight;
  var stations = [];          // ordered; each: {host,kind,local,scroll,el?,stepIdx?,tcol?}
  var hosts = [];             // {cfg,el,sec,fill,traveler,height,enterI,exitI,stepEls,activeStep}

  function buildJourney() {
    vh = Math.max(1, document.documentElement.clientHeight || window.innerHeight);
    stations = []; hosts = [];
    CHAPTERS.forEach(function (cfg) {
      var sec = document.getElementById(cfg.id);
      if (!sec) return;
      sec.querySelectorAll(':scope > .journey-snap-point').forEach(function (el) { el.remove(); });
      var hostEl = cfg.hostSel ? sec.querySelector(cfg.hostSel) : sec;
      if (!hostEl) return;
      var fill = hostEl.querySelector(':scope > .spine-fill');
      if (!fill) return;
      var traveler = hostEl.querySelector(':scope > .spine-traveler');
      if (!traveler) {
        traveler = document.createElement('i');
        traveler.className = 'spine-traveler';
        traveler.setAttribute('aria-hidden', 'true');
        hostEl.appendChild(traveler);
      }
      var hr = hostEl.getBoundingClientRect();
      var H = {
        cfg: cfg, el: hostEl, sec: sec, fill: fill, traveler: traveler,
        height: hr.height, enterI: -1, exitI: -1, stepEls: [], activeStep: -2,
        foot: hostEl.querySelector('.chapter-foot'), visEls: [],
      };
      // one visual per step, in step order, so scrubVisuals can address them by index
      if (cfg.frames) {
        hostEl.querySelectorAll(cfg.frames).forEach(function (f) {
          H.visEls[parseInt(f.getAttribute('data-autonomy-frame'), 10)] = f;
        });
      } else if (cfg.vis) {
        document.querySelectorAll(cfg.vis).forEach(function (v) {
          H.visEls[parseInt(v.getAttribute('data-step'), 10)] = v;
        });
      }
      function localY(el, extra) {
        return el.getBoundingClientRect().top - hr.top + (extra || 0);
      }
      function add(st) { st.host = H; stations.push(st); }

      if (cfg.pinned) {
        var pinHeight = Math.max(1, hostEl.clientHeight || vh);
        var secTop = sec.offsetTop, len = Math.max(1, sec.offsetHeight - pinHeight);
        H.stepEls = Array.prototype.slice.call(sec.querySelectorAll(cfg.stepSel));
        add({ kind: 'enter', local: 0, scroll: secTop - pinHeight });
        H.stepEls.forEach(function (el, k) {
          add({ kind: 'step', stepIdx: k, el: el, local: localY(el, DOT_OFFSET), scroll: secTop + cfg.bands[k] * len });
        });
        add({ kind: 'exit', local: H.height, scroll: secTop + len });
      } else {
        var docTop = sec.getBoundingClientRect().top + window.scrollY;
        var flatScroll = function (local) { return docTop + local - ANCHOR * vh; };
        add({ kind: 'enter', local: 0, scroll: flatScroll(0) });
        add({ kind: 'exit', local: H.height, scroll: flatScroll(H.height) });
      }
      setFootVisibility(H, false);
      hosts.push(H);
    });

    // bookkeeping + monotonicity assertion
    var ok = true;
    stations.forEach(function (st, i) {
      if (st.kind === 'enter') st.host.enterI = i;
      if (st.kind === 'exit') st.host.exitI = i;
      if (i > 0 && st.scroll < stations[i - 1].scroll - 1) ok = false;
    });
    if (!ok) console.warn('journey: non-monotonic station anchors',
      stations.map(function (s) { return [s.kind, Math.round(s.scroll)]; }));
  }

  function locate(y) {
    var k = 0;
    while (k < stations.length - 2 && y >= stations[k + 1].scroll) k++;
    var s0 = stations[k], s1 = stations[k + 1];
    var t = clamp((y - s0.scroll) / Math.max(1e-6, s1.scroll - s0.scroll), 0, 1);
    return { k: k, t: t };
  }

  function setFootVisibility(H, show) {
    if (!H.foot) return;
    H.foot.classList.toggle('on', show);
    H.foot.inert = !show;
    H.foot.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  function hostIsEngaged(H) {
    if (!H.cfg.pinned) {
      var r = H.sec.getBoundingClientRect();
      return r.bottom > 0 && r.top < vh;
    }
    var y = window.scrollY || window.pageYOffset;
    var start = H.sec.offsetTop;
    var end = start + Math.max(0, H.sec.offsetHeight - H.height);
    return y >= start - 1 && y <= end + 1;
  }

  /* `preload=none` is important for the long landing page, but Safari and some
     Chromium builds do not always resume a source when preload is changed and
     play() is called in the same frame. Keep an explicit intent on the element
     and retry when decoded data actually becomes available. */
  function startIntendedVideo(v) {
    if (!v.__journeyPlayIntent || v.readyState < 2 || document.visibilityState !== 'visible') return;
    v.muted = true;
    if (!v.paused) return;
    var promise = v.play();
    if (promise && promise.catch) promise.catch(function () {});
  }

  function requestVideoPlayback(v) {
    v.__journeyPlayIntent = true;
    if (!v.__journeyReadyBound) {
      v.__journeyReadyBound = true;
      ['loadedmetadata', 'loadeddata', 'canplay'].forEach(function (evt) {
        v.addEventListener(evt, function () { startIntendedVideo(v); });
      });
    }
    if (v.preload !== 'auto') {
      v.preload = 'auto';
      // Unconditionally, not only on NETWORK_EMPTY: a preload=none element with a
      // poster has already finished resource selection, so Safari reports
      // NETWORK_IDLE and the old guard skipped load(). Raising preload alone does
      // not make it fetch an idle source, so readyState stayed 0, canplay never
      // fired, and the video sat on its poster until some unrelated event
      // (a tab switch) restarted the media load algorithm.
      v.load();
      v.__journeyLoadRetries = 0;
    }
    startIntendedVideo(v);
    // and one bounded nudge, for the case where that load is dropped on the floor
    if (v.readyState < 2 && (v.__journeyLoadRetries || 0) < 2) {
      clearTimeout(v.__journeyNudge);
      v.__journeyNudge = setTimeout(function () {
        if (!v.__journeyPlayIntent || v.readyState >= 2) return;
        if (v.networkState !== HTMLMediaElement.NETWORK_LOADING) {
          v.__journeyLoadRetries = (v.__journeyLoadRetries || 0) + 1;
          v.load();
        }
        startIntendedVideo(v);
      }, 1200);
    }
  }

  function syncMedia(H) {
    var cfg = H.cfg;
    if (!cfg.videos) return;
    var canPlay = !reduced && document.visibilityState === 'visible' && hostIsEngaged(H);
    Object.keys(cfg.videos).forEach(function (key) {
      var v = document.getElementById(cfg.videos[key]);
      if (!v) return;
      var active = parseInt(key, 10) === H.activeStep;
      if (canPlay && active) {
        if (v.id === 'galleryBurst') {
          try { if (v.currentTime > 9.5) v.currentTime = 0; } catch (e) {}
        }
        requestVideoPlayback(v);
      } else {
        v.__journeyPlayIntent = false;
        if (!v.paused) v.pause();
        if (!active && v.preload !== 'none') v.preload = 'none';
      }
    });
  }

  function syncAllMedia() {
    hosts.forEach(syncMedia);
  }

  function applyChapterStep(H, idx) {
    var cfg = H.cfg;
    var changed = idx !== H.activeStep;
    H.activeStep = idx;
    if (changed) {
      H.stepEls.forEach(function (el, k) {
        el.classList.toggle('active', k === idx);
        el.classList.toggle('passed', k < idx);
      });
      if (cfg.frames) {
        H.el.querySelectorAll(cfg.frames).forEach(function (f) {
          f.classList.toggle('active', parseInt(f.getAttribute('data-autonomy-frame'), 10) === idx);
        });
      }
      if (cfg.vis) {
        document.querySelectorAll(cfg.vis).forEach(function (v) {
          v.classList.toggle('on', parseInt(v.getAttribute('data-step'), 10) === idx);
        });
        var cap = document.getElementById(cfg.captionId);
        if (cap && idx >= 0) cap.textContent = cfg.captions[idx] || '';
      }
      if (cfg.onStep) cfg.onStep(idx);
      // pulse.js listens; `engaged` is false for the chapters ahead of / behind the viewport, which
      // also get a step assigned on every layout pass and must not count as seen
      document.dispatchEvent(new CustomEvent('journey:step', { detail: { chapter: cfg.id, step: idx, engaged: hostIsEngaged(H) } }));
      // the map's slot is only final once its step is laid out, so re-fit on arrival
      if (cfg.id === 'cattle') fitCowMap();
    }
    setFootVisibility(H, reduced || (idx === H.stepEls.length - 1));
    syncMedia(H);
  }

  /* A step's scroll anchor is geometry-derived and fixed, but where its dot sits on the
     spine is layout-derived — and the notes now open and close, which moves every step
     below them. So the spine position is re-read from the DOM rather than trusted from
     build time; without this the fill lags the active step by the height of one note. */
  function refreshStepLocals() {
    hosts.forEach(function (H) { H.hostRectTop = null; });
    stations.forEach(function (st) {
      if (st.kind !== 'step' || !st.el) return;
      var H = st.host;
      if (H.hostRectTop === null) H.hostRectTop = H.el.getBoundingClientRect().top;
      st.local = st.el.getBoundingClientRect().top - H.hostRectTop + DOT_OFFSET;
    });
  }

  /* 2026-09-07: the visuals follow the scroll instead of swapping at a boundary.
     Testers read a pinned chapter as "the page is stuck" because for a whole screen of
     scrolling nothing on screen moved except a hairline. Now every scroll tick moves the
     picture: the active visual rises slowly through its band, and at the boundary the next
     one rises in from below while the old one continues up and fades. All of it is a pure
     function of scroll position, so it reverses when the user scrolls back. */
  var HANDOFF = 0.18;   // half-width of the swap, in step units (the swap spans ~36% of a band)
  function scrubVisuals(H, u) {
    var n = H.visEls.length;
    if (!n) return;
    var phone = narrowMQ.matches;
    var slide = phone ? 28 : 48, drift = phone ? 14 : 30;
    for (var j = 0; j < n; j++) {
      var el = H.visEls[j];
      if (!el) continue;
      var d = u - j;
      var inn = j === 0 ? 1 : clamp((d + HANDOFF) / (2 * HANDOFF), 0, 1);
      var out = j === n - 1 ? 1 : clamp((j + 1 + HANDOFF - u) / (2 * HANDOFF), 0, 1);
      var o = inn * out;
      // never below its rest position once fully in, so it cannot ride down onto the caption
      var yPx = (1 - inn) * slide - (1 - out) * slide - clamp(d, 0, 1) * drift;
      el.style.opacity = o.toFixed(3);
      el.style.transform = 'translate3d(0,' + yPx.toFixed(1) + 'px,0)';
      el.style.visibility = o > 0.005 ? '' : 'hidden';
    }
  }

  // continuous step coordinate for a pinned host: -1..0 while the chapter slides in,
  // j..j+1 across step j's band, N once the chapter has released
  function hostProgress(H, k, t) {
    if (k < H.enterI) return -1;
    if (k >= H.exitI) return H.stepEls.length;
    var st = stations[k];
    return st.kind === 'enter' ? -1 + t : st.stepIdx + t;
  }

  function render(y) {
    refreshStepLocals();
    var pos = locate(y);
    var k = pos.k, t = pos.t;
    hosts.forEach(function (H) {
      var h;
      if (k >= H.exitI) h = H.height;
      else if (k < H.enterI) h = 0;
      else {
        var s0 = stations[k], s1 = stations[k + 1];
        // Continuous interpolation keeps the rail moving with the page. There is no
        // hidden dwell/hop phase that can make the visual jump independently.
        h = s0.local + t * (s1.local - s0.local);  // both in this host by construction
      }
      h = clamp(h, 0, H.height);
      H.fill.style.height = h + 'px';
      var inside = h > 2 && h < H.height - 2;
      H.traveler.style.opacity = inside ? 1 : 0;
      if (inside) H.traveler.style.top = h + 'px';
      if (H.stepEls.length) {
        var idx = -1;
        for (var i = H.enterI; i <= Math.min(k, H.exitI); i++) {
          if (stations[i].kind === 'step' && stations[i].host === H) idx = stations[i].stepIdx;
        }
        applyChapterStep(H, idx === -1 ? 0 : idx);
        if (H.cfg.pinned) scrubVisuals(H, hostProgress(H, k, t));
      }
    });
  }

  /* ---------- hero / nav ---------- */
  var hero = document.getElementById('hero');
  var heroOrbit = document.getElementById('heroOrbit');
  var nav = document.getElementById('nav');
  var menuButton = document.getElementById('navMenuToggle');
  var siteNav = document.getElementById('siteNav');

  function setMenu(open, returnFocus) {
    if (!nav || !menuButton || !siteNav) return;
    nav.classList.toggle('menu-open', open);
    menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    siteNav.inert = !open && window.matchMedia('(max-width: 960px)').matches;
    if (!open && returnFocus) menuButton.focus();
  }
  if (menuButton && siteNav) {
    setMenu(false, false);
    menuButton.addEventListener('click', function () {
      setMenu(menuButton.getAttribute('aria-expanded') !== 'true', false);
    });
    siteNav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false, false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') setMenu(false, true);
    });
    document.addEventListener('pointerdown', function (e) {
      if (menuButton.getAttribute('aria-expanded') === 'true' && !nav.contains(e.target)) setMenu(false, false);
    });
  }

  /* The architecture map is a fixed composition, not a reflowable one: where its slot is
     shorter than the map, scale the whole thing down rather than let .chapter-sticky's
     overflow crop its lower half. Widening before scaling keeps the result full-bleed;
     a few passes settle it because a wider layout is also a shorter one. */
  function fitCowMap() {
    if (!cowMap) return;
    cowMap.style.transform = 'none';
    var cs = getComputedStyle(cowHost);
    var avail = cowHost.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    var natural = cowMap.offsetHeight;
    if (avail <= 0 || natural <= 0) return;
    var s = Math.min(1, avail / natural);
    if (s > 0.995) { cowMap.style.transform = ''; return; }
    cowMap.style.transformOrigin = 'top center';
    cowMap.style.transform = 'scale(' + s + ')';
  }
  buildJourney();
  fitCowMap();

  if (reduced) {
    hosts.forEach(function (H) {
      if (H.stepEls.length) applyChapterStep(H, 0);
      setFootVisibility(H, true);
    });
    syncAllMedia();
    return;
  }

  /* ---------- scroll loop ---------- */
  var ticking = false;
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', function () {
    setMenu(false, false);
    fitCowMap();
    buildJourney();
    request();
  });
  window.addEventListener('load', function () { fitCowMap(); buildJourney(); request(); });
  document.addEventListener('visibilitychange', syncAllMedia);
  function request() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }

  function update() {
    ticking = false;
    var y = window.scrollY || window.pageYOffset;
    if (nav) nav.classList.toggle('scrolled', y > 24);
    var p = clamp(y / (vh * 0.8), 0, 1);
    if (hero) hero.classList.toggle('past', p > 0.5);
    if (heroOrbit) heroOrbit.style.opacity = 1 - clamp((p - 0.35) / 0.5, 0, 1) * 0.9;
    render(y);
  }
  update();

  /* dev: ?scroll=<px> jumps for screenshot checks */
  var ds = new URLSearchParams(location.search).get('scroll');
  if (ds) setTimeout(function () { window.scrollTo({ top: parseInt(ds, 10), behavior: 'instant' }); update(); }, 1200);
})();

/* ---------- media wait indicator (2026-09-22) ----------
   Runs the orbit dot inside a chapter visual while its *active* asset is still on its way:
   an image until it has pixels, a video from the moment the journey wants it to play until it
   can. Posters cover the time before that. ?boot=hold keeps every indicator on for preview. */
(function () {
  var hold = new URLSearchParams(location.search).get('boot') === 'hold';
  var containers = document.querySelectorAll('.visual-stack, .autonomy-visual');
  if (!containers.length) return;
  function ready(el) {
    if (el.tagName === 'IMG') return !el.getAttribute('src') || el.__waitError || (el.complete && el.naturalWidth > 0);
    if (el.tagName === 'VIDEO') return !el.__journeyPlayIntent || el.readyState >= 2 || !!el.error;
    return true;
  }
  function activeMedia(c) {
    var active = c.querySelector('.vis.on, .autonomy-frame.active');
    if (!active) return [];
    if (active.tagName === 'IMG' || active.tagName === 'VIDEO') return [active];
    return Array.prototype.slice.call(active.querySelectorAll('img, video'));
  }
  containers.forEach(function (c) {
    var w = document.createElement('div');
    w.className = 'media-wait'; w.setAttribute('aria-hidden', 'true');
    w.appendChild(document.createElement('i'));
    c.appendChild(w);
    var tick = function () {
      var waiting = hold || activeMedia(c).some(function (m) { return !ready(m); });
      c.classList.toggle('is-waiting', waiting);
    };
    c.querySelectorAll('img').forEach(function (img) {
      img.addEventListener('load', tick);
      img.addEventListener('error', function () { img.__waitError = true; tick(); });
    });
    c.querySelectorAll('video').forEach(function (v) {
      ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'error', 'emptied'].forEach(function (e) { v.addEventListener(e, tick); });
    });
    new MutationObserver(tick).observe(c, { subtree: true, attributes: true, attributeFilter: ['class', 'src'] });
    tick();
  });
})();

