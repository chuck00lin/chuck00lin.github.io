/* Pest chapter — the standardised revision loop.
 *
 * Inner ring   : dataset -> train -> evaluate -> investigate, the cycle the
 *                partners agreed on. Edge weight is proportional to how often
 *                that hand-off actually happened (media/pest/loop_data.json).
 * Outer rail   : the deployment half of the loop — a release goes out over the
 *                air, stations keep scanning, the day's boards come back in.
 * Centre        : what one board goes through — scan, crop, classify, dashboard.
 *
 * Phases (driven by the journey engine via window.pestLoop.setPhase):
 *   0  static contract — nodes and edges only
 *  >=1 live — pulses run the ring and the rail, the centre pipeline plays
 */
(function () {
  'use strict';
  var host = document.getElementById('loopVisual');
  if (!host) return;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var NS = 'http://www.w3.org/2000/svg';
  /* Phone (<=560px): the 900x640 layout scaled to a 335px column left the labels at
     ~7px. A near-square 620x600 layout without the rail captions renders ~1.5x larger
     in the same slot. Chosen once at build; a resize across the breakpoint is rare. */
  var compact = window.matchMedia('(max-width: 560px)').matches;
  var W = compact ? 620 : 900, H = compact ? 600 : 640;
  var CX = compact ? 300 : 400, CY = compact ? 262 : 282, R = compact ? 168 : 186;
  var ANGLE = { dataset: 195, train: 265, evaluate: 335, investigate: 75 };
  var OUTSIDE = compact ? { field: [66, 96], ship: [566, 404] } : { field: [92, 128], ship: [800, 424] };
  var RAIL_Y = compact ? 528 : 560, RAIL_R = compact ? 26 : 30;
  var CHEVRON_DX = compact ? 74 : 109;

  /* Node labels the map exports are internal shorthand; these are the public ones. */
  var LABELS = {
    field: 'Field data', dataset: 'Dataset', train: 'Train',
    evaluate: 'Evaluate', investigate: 'Investigate', ship: 'Release',
  };

  /* The deployment half of the loop, read right-to-left along the rail. */
  var BEATS = compact ? [
    [458, 'OTA UPDATE', []],
    [311, 'IN SERVICE', []],
    [164, 'AUTO-UPLOAD', []],
  ] : [
    [648, 'OTA UPDATE', ['The approved model ships', 'to every station.']],
    [430, 'IN SERVICE', ['Traps are scanned as', 'part of routine work.']],
    [212, 'AUTO-UPLOAD', ['Every scan comes back', 'as training data.']],
  ];

  var data = null, svg = null, edgesG = null, pulsesG = null;
  var paths = {};          // key -> {el, len, count}
  var pulses = [];         // {key, u, speed}
  var phase = -1, running = false, raf = null;

  function pt(id) {
    if (OUTSIDE[id]) return OUTSIDE[id];
    var a = ANGLE[id] * Math.PI / 180;
    return [CX + R * Math.cos(a), CY - R * Math.sin(a)];
  }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    (parent || svg).appendChild(e);
    return e;
  }

  function arcPath(fromId, toId) {
    var d0 = ANGLE[fromId], d1 = ANGLE[toId];
    if (d1 > d0) d1 -= 360;                       // travel clockwise on screen
    var large = (d0 - d1) > 180 ? 1 : 0;
    var p0 = pt(fromId), p1 = pt(toId);
    return 'M' + p0[0] + ' ' + p0[1] + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + p1[0] + ' ' + p1[1];
  }
  function linkPath(fromId, toId) {
    var p0 = pt(fromId), p1 = pt(toId);
    var mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2 - 40;
    return 'M' + p0[0] + ' ' + p0[1] + ' Q' + mx + ' ' + my + ' ' + p1[0] + ' ' + p1[1];
  }
  function railPath() {
    var s = pt('ship'), f = pt('field');
    return 'M' + s[0] + ' ' + s[1] +
      ' L' + s[0] + ' ' + (RAIL_Y - RAIL_R) + ' Q' + s[0] + ' ' + RAIL_Y + ' ' + (s[0] - RAIL_R) + ' ' + RAIL_Y +
      ' L' + (f[0] + RAIL_R) + ' ' + RAIL_Y + ' Q' + f[0] + ' ' + RAIL_Y + ' ' + f[0] + ' ' + (RAIL_Y - RAIL_R) +
      ' L' + f[0] + ' ' + f[1];
  }

  function addPath(key, dAttr, cls, width, count) {
    var p = el('path', { d: dAttr, class: cls, 'stroke-width': width }, edgesG);
    paths[key] = { el: p, len: p.getTotalLength(), count: count };
    return p;
  }

  function build() {
    svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'loop-svg', role: 'img' }, host);
    host.appendChild(svg);
    host.classList.toggle('loop-compact', compact);
    edgesG = el('g', {}, svg);
    pulsesG = el('g', {}, svg);

    addPath('rail', railPath(), 'loop-edge loop-edge-rail', 1.5, 6);
    data.edges.forEach(function (e) {
      var inLoop = ANGLE[e.from] !== undefined && ANGLE[e.to] !== undefined;
      addPath(e.from + '>' + e.to, inLoop ? arcPath(e.from, e.to) : linkPath(e.from, e.to),
              'loop-edge', 1.5 + Math.min(3.5, e.count / 10), e.count);
    });

    data.nodes.forEach(function (n) {
      var p = pt(n.id);
      var g = el('g', { class: 'loop-node loop-node-' + n.id }, svg);
      el('circle', { cx: p[0], cy: p[1], r: n.id === 'ship' ? 11 : 9, class: 'loop-dot' }, g);
      var above = p[1] < CY || n.id === 'ship';
      el('text', { x: p[0], y: p[1] + (above ? -20 : 30), class: 'loop-label' }, g).textContent =
        LABELS[n.id] || n.label;
    });

    var band = el('g', { class: 'loop-band' }, svg);
    BEATS.forEach(function (b, k) {
      el('circle', { cx: b[0], cy: RAIL_Y, r: 4.5, class: 'loop-beat-dot' }, band);
      el('text', { x: b[0], y: RAIL_Y - 20, class: 'loop-beat' }, band).textContent = b[1];
      b[2].forEach(function (line, j) {
        el('text', { x: b[0], y: RAIL_Y + 27 + j * 19, class: 'loop-beat-cap' }, band).textContent = line;
      });
      // the rail runs right-to-left; a chevron says so even when nothing is moving
      var cx = b[0] + CHEVRON_DX;
      el('path', { d: 'M' + (cx + 5) + ' ' + (RAIL_Y - 6) + ' L' + (cx - 5) + ' ' + RAIL_Y +
                      ' L' + (cx + 5) + ' ' + (RAIL_Y + 6), class: 'loop-chevron' }, band);
    });

    buildCenter();

    Object.keys(paths).forEach(function (key) {           // pulses ∝ real traffic
      var n = Math.max(1, Math.round(paths[key].count / 6));
      for (var i = 0; i < n; i++) {
        pulses.push({ key: key, u: i / n, speed: 0.024 + (i % 3) * 0.004 });
      }
    });
  }

  /* ---- centre mini-pipeline: scan -> crop -> classify -> dashboard ---- */
  var centerG = null, scenes = [], sceneT0 = 0, SCENE_S = 4.2, FADE = 0.12;
  var CLS = [['thrips', '#7ee787', 58], ['gnat', '#f0b429', 461], ['whitefly', '#7aa2f7', 157], ['others', '#7d8b99', 81]];

  function bug(parent, x, y, s) {
    var g = el('g', { class: 'lc-bug', transform: 'translate(' + x + ' ' + y + ') scale(' + s + ')' }, parent);
    el('ellipse', { cx: 0, cy: 3.4, rx: 4.2, ry: 7.2 }, g);
    el('circle', { cx: 0, cy: -6.4, r: 3.1 }, g);
    el('path', { d: 'M-1.7 -9 L-5 -13.4 M1.7 -9 L5 -13.4', class: 'lc-bugline' }, g);
    el('path', { d: 'M-4 -2.6 L-9.4 -6 M4 -2.6 L9.4 -6 M-4.4 1.6 L-10.4 1.6 M4.4 1.6 L10.4 1.6 M-4 5.6 L-9.4 9 M4 5.6 L9.4 9', class: 'lc-bugline' }, g);
    return g;
  }

  function buildCenter() {
    centerG = el('g', { class: 'loop-center' }, svg);
    var cx = CX, cy = CY - 8;

    var s0 = el('g', { class: 'lc-scene' }, centerG);          // the board as scanned
    el('rect', { x: cx - 62, y: cy - 78, width: 124, height: 156, rx: 8, class: 'lc-board' }, s0);
    var seed = 7;
    for (var i = 0; i < 26; i++) {
      seed = (seed * 16807) % 2147483647;
      var rx2 = cx - 48 + (seed % 97);
      seed = (seed * 16807) % 2147483647;
      var ry2 = cy - 64 + (seed % 129);
      el('circle', { cx: rx2, cy: ry2, r: 2.1, class: 'lc-dot' }, s0);
    }
    el('text', { x: cx, y: cy + 102, class: 'lc-cap' }, s0).textContent = 'scan';

    var s1 = el('g', { class: 'lc-scene' }, centerG);          // one crop, one insect
    el('rect', { x: cx - 62, y: cy - 78, width: 124, height: 156, rx: 8, class: 'lc-board lc-dim' }, s1);
    el('rect', { x: cx - 30, y: cy - 32, width: 60, height: 52, class: 'lc-cropbox' }, s1);
    bug(s1, cx, cy - 5, 1.55);
    el('text', { x: cx, y: cy + 102, class: 'lc-cap' }, s1).textContent = 'crop';

    var s2 = el('g', { class: 'lc-scene' }, centerG);          // the open class list
    CLS.forEach(function (c, i) {
      var y = cy - 66 + i * 40;
      el('rect', { x: cx - 58, y: y, width: 116, height: 28, rx: 14, class: 'lc-chip', stroke: c[1] }, s2);
      el('text', { x: cx, y: y + 19, class: 'lc-chiptext', fill: c[1] }, s2).textContent = c[0];
    });
    el('text', { x: cx, y: cy + 102, class: 'lc-cap' }, s2).textContent = 'classify';

    var s3 = el('g', { class: 'lc-scene' }, centerG);          // what the station reads
    var maxH = 110;
    CLS.forEach(function (c, i) {
      var h = Math.max(10, Math.log(c[2]) / Math.log(461) * maxH);
      var x = cx - 66 + i * 36;
      el('rect', { x: x, y: cy + 40 - h, width: 24, height: h, rx: 3, fill: c[1], class: 'lc-bar' }, s3);
      el('text', { x: x + 12, y: cy + 58, class: 'lc-barnum' }, s3).textContent = c[2];
    });
    el('text', { x: cx, y: cy + 102, class: 'lc-cap' }, s3).textContent = 'dashboard';

    scenes = Array.prototype.slice.call(centerG.querySelectorAll('.lc-scene'));
    scenes.forEach(function (sc, i) { sc.style.opacity = i === 0 ? 1 : 0; });
  }

  function tickCenter(ts) {
    if (!scenes.length) return;
    if (!sceneT0) sceneT0 = ts;
    var u = ((ts - sceneT0) / 1000) / SCENE_S;
    var idx = Math.floor(u) % scenes.length;
    var f = u - Math.floor(u), hold = 1 - FADE;
    scenes.forEach(function (sc, i) {
      var o = 0;
      if (i === idx) o = f < hold ? 1 : 1 - (f - hold) / FADE;
      if (i === (idx + 1) % scenes.length && f > hold) o = (f - hold) / FADE;
      sc.style.opacity = o;
    });
  }

  var last = null;
  function tick(ts) {
    raf = null;
    if (!running) return;
    var dt = last ? Math.min(0.08, (ts - last) / 1000) : 0.016;
    last = ts;
    while (pulsesG.firstChild) pulsesG.removeChild(pulsesG.firstChild);
    pulses.forEach(function (p) {
      var P = paths[p.key];
      p.u += p.speed * dt * 60 / (P.len / 220);
      if (p.u > 1) p.u -= 1;
      var q = P.el.getPointAtLength(p.u * P.len);
      el('circle', { cx: q.x, cy: q.y, r: 3.2, class: 'loop-pulse' + (p.key === 'rail' ? ' loop-pulse-rail' : '') }, pulsesG);
    });
    tickCenter(ts);
    raf = requestAnimationFrame(tick);
  }

  function setPhase(i) {
    if (!svg || i === phase) return;
    phase = i;
    host.classList.toggle('loop-live', i >= 1);
    var wantRun = i >= 1 && !reduced;
    if (wantRun && !running) { running = true; last = null; raf = requestAnimationFrame(tick); }
    if (!wantRun && running) { running = false; if (raf) cancelAnimationFrame(raf); }
  }

  // pause whenever the section is off screen
  var vis = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting && running) { running = false; }
      else if (e.isIntersecting && phase >= 1 && !running && !reduced) {
        running = true; last = null; raf = requestAnimationFrame(tick);
      }
    });
  }, { threshold: 0.05 });
  vis.observe(host);

  fetch('media/pest/loop_data.json').then(function (r) { return r.json(); }).then(function (d) {
    data = d;
    build();
    if (reduced) { setPhase(1); running = false; }
    else setPhase(Math.max(phase, 0));
    if (window.__pestPhasePending !== undefined) setPhase(window.__pestPhasePending);
  });

  window.pestLoop = { setPhase: function (i) {
    if (!svg) { window.__pestPhasePending = i; return; }
    setPhase(i);
  } };
})();
