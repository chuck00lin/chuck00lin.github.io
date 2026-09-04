/* 3D Plant Phenotyping portfolio — behaviour (no dependencies) */
(function () {
  'use strict';

  /* ---- dev theme switcher (persisted in localStorage) ---- */
  var root = document.documentElement;
  var q = new URLSearchParams(location.search).get('theme');
  var saved = q || localStorage.getItem('pf-theme');
  if (saved) setTheme(saved);
  function setTheme(name) {
    root.setAttribute('data-theme', name);
    localStorage.setItem('pf-theme', name);
    document.querySelectorAll('[data-theme-pick]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-theme-pick') === name);
    });
  }
  document.querySelectorAll('[data-theme-pick]').forEach(function (b) {
    b.addEventListener('click', function () { setTheme(b.getAttribute('data-theme-pick')); });
  });

  /* ---- growth cards: swap still <-> animated on hover / focus / tap ---- */
  document.querySelectorAll('.card[data-anim]').forEach(function (card) {
    var img = card.querySelector('img');
    var still = card.getAttribute('data-still');
    var anim = card.getAttribute('data-anim');
    var on = false;
    function play() { if (!on) { on = true; img.src = anim; } }
    function stop() { if (on) { on = false; img.src = still; } }
    card.addEventListener('mouseenter', play);
    card.addEventListener('mouseleave', stop);
    card.addEventListener('click', function () { on ? stop() : play(); });
    card.setAttribute('tabindex', '0');
    card.addEventListener('focus', play);
    card.addEventListener('blur', stop);
  });

  /* ---- pause hero video when off-screen (saves CPU on long pages) ---- */
  var vids = document.querySelectorAll('video[autoplay]');
  if ('IntersectionObserver' in window && vids.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) { v.play().catch(function () {}); } else { v.pause(); }
      });
    }, { threshold: 0.15 });
    vids.forEach(function (v) { io.observe(v); });
  }
})();
