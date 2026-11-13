(function () {
  'use strict';

  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify(body || {}),
      credentials: 'same-origin',
      keepalive: true
    }).catch(function () {});
  }

  /* Toasts */
  document.querySelectorAll('[data-toast]').forEach(function (toast) {
    setTimeout(function () { toast.remove(); }, 7000);
  });
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-dismiss]');
    if (btn) btn.closest('[data-toast]').remove();
  });

  /* Mobile menu */
  var menuBtn = document.querySelector('[data-menu-toggle]');
  var menu = document.getElementById('mobile-menu');
  if (menuBtn && menu) {
    menuBtn.addEventListener('click', function () {
      var open = menu.classList.toggle('hidden') === false;
      menuBtn.setAttribute('aria-expanded', String(open));
    });
  }

  /* Show / hide password */
  document.querySelectorAll('[data-toggle-password]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.getElementById(btn.getAttribute('data-toggle-password'));
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.querySelector('i').className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
    });
  });

  /* Confirm destructive actions */
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  /* Remember the browser time zone for signed-in users (sessions are shown in local time) */
  if (document.body.hasAttribute('data-signed-in')) {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && !sessionStorage.getItem('tsa_tz_sent')) {
        sessionStorage.setItem('tsa_tz_sent', '1');
        post('/api/timezone', { timezone: tz });
      }
    } catch (e) { /* ignore */ }
  }

  /* One-time community prompt */
  var modal = document.querySelector('[data-community-modal]');
  if (modal && typeof modal.showModal === 'function') {
    var seen = false;
    var markSeen = function () {
      if (seen) return;
      seen = true;
      post('/api/community-seen');
    };
    setTimeout(function () { if (!modal.open) modal.showModal(); }, parseInt(modal.getAttribute('data-delay'), 10) || 2500);
    modal.addEventListener('close', markSeen);
    modal.querySelectorAll('[data-community-close]').forEach(function (b) {
      b.addEventListener('click', function () { modal.close(); });
    });
    modal.querySelectorAll('[data-community-link]').forEach(function (a) {
      a.addEventListener('click', function () { markSeen(); });
    });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.close(); });
  }

  /* Reload when a session's Join window opens, so the button appears without the student refreshing */
  document.querySelectorAll('[data-reload-at]').forEach(function (el) {
    var at = Date.parse(el.getAttribute('data-reload-at'));
    var wait = at - Date.now();
    if (!isNaN(at) && wait > 0 && wait < 24 * 60 * 60 * 1000) setTimeout(function () { location.reload(); }, wait + 1000);
    var out = el.querySelector('[data-countdown]');
    if (out && !isNaN(at)) {
      var tick = function () {
        var s = Math.max(Math.round((at - Date.now()) / 1000), 0);
        var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
        out.textContent = (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + r + 's';
      };
      tick();
      setInterval(tick, 1000);
    }
  });

  /* Keep a live attendance list fresh */
  var auto = document.querySelector('[data-autorefresh]');
  if (auto) {
    var secs = parseInt(auto.getAttribute('data-autorefresh'), 10) || 30;
    setInterval(function () { if (!document.hidden && !document.querySelector('details[open]')) location.reload(); }, secs * 1000);
  }

  /* Hero slider */
  var root = document.querySelector('[data-slider]');
  if (root) {
    var slides = [].slice.call(root.querySelectorAll('[data-slide]'));
    var tabs = [].slice.call(root.querySelectorAll('[data-tab]'));
    var playBtn = root.querySelector('[data-play]');
    var DURATION = 6500;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var index = 0;
    var timer = null;
    var userPaused = reduce;
    var hoverPaused = false;

    var playing = function () { return slides.length > 1 && !userPaused && !hoverPaused; };

    var schedule = function () {
      clearTimeout(timer);
      tabs.forEach(function (t) { var b = t.querySelector('[data-bar]'); if (b) b.style.animation = 'none'; });
      var bar = tabs[index] && tabs[index].querySelector('[data-bar]');
      if (bar) {
        void bar.offsetWidth;
        if (playing()) bar.style.animation = 'tsa-fill ' + DURATION + 'ms linear forwards';
      }
      if (playing()) timer = setTimeout(function () { go(index + 1); }, DURATION);
    };

    var go = function (n) {
      index = (n + slides.length) % slides.length;
      slides.forEach(function (s, k) {
        var on = k === index;
        s.classList.toggle('opacity-100', on);
        s.classList.toggle('opacity-0', !on);
        s.classList.toggle('pointer-events-none', !on);
        if (on) s.removeAttribute('inert'); else s.setAttribute('inert', '');
        s.setAttribute('aria-hidden', String(!on));
      });
      tabs.forEach(function (t, k) {
        t.classList.toggle('is-active', k === index);
        t.setAttribute('aria-current', k === index ? 'true' : 'false');
      });
      schedule();
    };

    tabs.forEach(function (t, k) { t.addEventListener('click', function () { go(k); }); });
    var prev = root.querySelector('[data-prev]');
    var next = root.querySelector('[data-next]');
    if (prev) prev.addEventListener('click', function () { go(index - 1); });
    if (next) next.addEventListener('click', function () { go(index + 1); });

    if (playBtn) {
      var paintPlay = function () {
        playBtn.setAttribute('aria-label', userPaused ? 'Play slideshow' : 'Pause slideshow');
        playBtn.querySelector('i').className = userPaused ? 'fa-solid fa-play' : 'fa-solid fa-pause';
      };
      paintPlay();
      playBtn.addEventListener('click', function () { userPaused = !userPaused; paintPlay(); schedule(); });
    }

    root.addEventListener('mouseenter', function () { hoverPaused = true; schedule(); });
    root.addEventListener('mouseleave', function () { hoverPaused = false; schedule(); });
    root.addEventListener('focusin', function () { hoverPaused = true; schedule(); });
    root.addEventListener('focusout', function () { hoverPaused = false; schedule(); });

    var startX = null;
    root.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
    root.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
    }, { passive: true });

    go(0);
  }
})();
