/* Cattle identity visual: fixed ROI frames + a deterministic mock embedding view. */
(function () {
  'use strict';

  var visual = document.querySelector('#cattle .cow-id-visual');
  var canvas = document.getElementById('cowEmbeddingCanvas');
  if (!visual || !canvas) return;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ctx = canvas.getContext('2d');
  var cards = Array.prototype.slice.call(visual.querySelectorAll('.cow-id-card'));
  var matchBadge = visual.querySelector('.cow-embed-match');
  var ids = ['A-014', 'B-087', 'C-203', 'D-316'];

  function randomFactory(seed) {
    return function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  var random = randomFactory(4102);
  var palette = ['#7ee787', '#56d8a8', '#4fc3c7', '#69aee8', '#8d91e8', '#b98de1',
                 '#e18cc1', '#ed9382', '#f0b429', '#d7d94f', '#9bdc58', '#68cf78'];
  var points = [];
  var centers = [];
  for (var group = 0; group < 12; group++) {
    var angle = group / 12 * Math.PI * 2;
    var center = {
      x: Math.cos(angle) * (.88 + (group % 3) * .06),
      y: Math.sin(angle) * (.58 + (group % 2) * .08),
      z: ((group % 4) - 1.5) * .32 + Math.sin(angle * 2) * .13
    };
    centers.push(center);
    for (var j = 0; j < 24; j++) {
      var noise = function () { return random() + random() + random() - 1.5; };
      points.push({
        x: center.x + noise() * .15,
        y: center.y + noise() * .12,
        z: center.z + noise() * .14,
        group: group,
        drift: random() * Math.PI * 2
      });
    }
  }

  var width = 0;
  var height = 0;
  var ratio = 1;
  function resizeCanvas() {
    var rect = canvas.getBoundingClientRect();
    var nextW = Math.max(1, Math.round(rect.width));
    var nextH = Math.max(1, Math.round(rect.height));
    var nextRatio = Math.min(2, window.devicePixelRatio || 1);
    if (nextW === width && nextH === height && nextRatio === ratio) return;
    width = nextW;
    height = nextH;
    ratio = nextRatio;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function rotatePoint(point, time) {
    var ay = time * .00016;
    var ax = -.34 + Math.sin(time * .00011) * .08;
    var cy = Math.cos(ay), sy = Math.sin(ay);
    var cx = Math.cos(ax), sx = Math.sin(ax);
    var x1 = point.x * cy - point.z * sy;
    var z1 = point.x * sy + point.z * cy;
    return { x: x1, y: point.y * cx - z1 * sx, z: point.y * sx + z1 * cx };
  }

  function project(point) {
    var perspective = 3.7 / (3.7 + point.z);
    var scale = Math.min(width * .34, height * .52);
    return {
      x: width * .5 + point.x * scale * perspective,
      y: height * .46 + point.y * scale * perspective,
      z: point.z,
      p: perspective
    };
  }

  var cube = [
    [-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
    [-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]
  ];
  var cubeEdges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  var activeMatch = -1;

  function renderEmbedding(time) {
    resizeCanvas();
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    var active = Math.floor(time / 1900) % 4;
    var activeGroup = active * 3;
    if (active !== activeMatch) {
      activeMatch = active;
      if (matchBadge) {
        matchBadge.classList.remove('is-on');
        void matchBadge.offsetWidth;
        matchBadge.classList.add('is-on');
      }
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--line-2').trim() || '#2a3644';
    cubeEdges.forEach(function (edge) {
      var a = rotatePoint({x:cube[edge[0]][0], y:cube[edge[0]][1] * .72, z:cube[edge[0]][2] * .72}, time);
      var b = rotatePoint({x:cube[edge[1]][0], y:cube[edge[1]][1] * .72, z:cube[edge[1]][2] * .72}, time);
      var pa = project(a), pb = project(b);
      ctx.globalAlpha = .32;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    });

    var plotted = points.map(function (point) {
      var pulse = point.group === activeGroup ? Math.sin(time * .003 + point.drift) * .025 : 0;
      var rotated = rotatePoint({x:point.x + pulse, y:point.y - pulse, z:point.z + pulse}, time);
      return { point: point, rotated: rotated, projected: project(rotated) };
    }).sort(function (a, b) { return b.rotated.z - a.rotated.z; });

    plotted.forEach(function (item) {
      var isActive = item.point.group === activeGroup;
      var radius = (isActive ? 2.25 : 1.45) * item.projected.p;
      ctx.globalAlpha = isActive ? .98 : .56;
      ctx.fillStyle = palette[item.point.group];
      ctx.beginPath();
      ctx.arc(item.projected.x, item.projected.y, Math.max(.8, radius), 0, Math.PI * 2);
      ctx.fill();
    });

    var labelPoint = project(rotatePoint(centers[activeGroup], time));
    var label = 'ID ' + ids[active];
    ctx.globalAlpha = 1;
    ctx.font = '600 10px ui-monospace, monospace';
    var labelWidth = ctx.measureText(label).width + 12;
    var lx = Math.max(5, Math.min(width - labelWidth - 5, labelPoint.x + 8));
    var ly = Math.max(35, Math.min(height - 19, labelPoint.y - 10));
    ctx.fillStyle = 'rgba(5,8,11,.82)';
    ctx.fillRect(lx, ly, labelWidth, 17);
    ctx.strokeStyle = palette[activeGroup];
    ctx.strokeRect(lx + .5, ly + .5, labelWidth - 1, 16);
    ctx.fillStyle = '#f2f5f8';
    ctx.fillText(label, lx + 6, ly + 12);

    cards.forEach(function (card, index) { card.classList.toggle('is-match', index === active); });
  }

  var intersecting = false;
  var frame = 0;
  function shouldRun() {
    return !reduced && intersecting && visual.classList.contains('on') && document.visibilityState === 'visible';
  }
  function tick(time) {
    frame = 0;
    renderEmbedding(time);
    if (shouldRun()) frame = requestAnimationFrame(tick);
  }
  function sync() {
    if (shouldRun() && !frame) frame = requestAnimationFrame(tick);
    if (!shouldRun() && frame) { cancelAnimationFrame(frame); frame = 0; }
    if (!shouldRun()) renderEmbedding(0);
  }

  var observer = new IntersectionObserver(function (entries) {
    intersecting = !!(entries[0] && entries[0].isIntersecting);
    sync();
  }, { threshold: .05 });
  observer.observe(visual);
  new MutationObserver(sync).observe(visual, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', sync);
  document.addEventListener('visibilitychange', sync);

  window.cowIdentity = {
    setActive: function (active) {
      visual.classList.toggle('cow-id-live', !!active);
      if (active) activeMatch = -1;
      sync();
    }
  };

  renderEmbedding(0);
})();
