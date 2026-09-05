/* ==========================================================================
   FURIA — GLOBAL SCRIPT
   All animation logic lives here (no inline scripts in page markup).
   Sections:
   01. Utils + feature detection
   02. Preloader (session-gated, real-load proxy, floor + max wait)
   03. Smooth/inertial scroll (custom rAF virtual scroll, no jQuery)
   04. Anchor navigation (tweened to virtual scroll)
   05. Parallax layers ([data-parallax])
   06. Custom cursor: dot + lagging ring + "VIEW" morph + magnetic buttons
   07. Scroll reveal ([data-reveal]) + stagger groups
   08. Count-up stats ([data-count])
   09. Ticker + partners carousel builders
   10. Header state + mobile menu
   11. Init
   ========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------
     01. Utils + feature detection
  ------------------------------------------------------------------ */
  const doc = document;
  const root = doc.documentElement;
  const $  = (s, c = doc) => c.querySelector(s);
  const $$ = (s, c = doc) => Array.from(c.querySelectorAll(s));

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer  = window.matchMedia('(pointer: fine)').matches;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const debounce = (fn, wait) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
  };
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

  /* ------------------------------------------------------------------
     02. Preloader
     - Full version on first visit per session (sessionStorage-gated)
     - ~400ms "short" version on every later load in the same session
     - Progress = max(real asset load proxy, time-based curve)
     - Floor ~1.2s, hard max ~3s; then upward wipe with the hero reveal
  ------------------------------------------------------------------ */
  function initPreloader() {
    const preloader = $('#preloader');
    const hero = $('#hero');

    if (!preloader) {
      // No preloader in the page: just reveal the hero immediately.
      if (hero) hero.classList.add('in');
      doc.body.classList.add('revealed');
      return;
    }

    // Skip the animation entirely for reduced-motion users.
    if (reduceMotion) {
      preloader.classList.add('reduce');
      if (hero) hero.classList.add('in');
      doc.body.classList.add('revealed');
      preloader.remove();
      return;
    }

    let seenThisSession = false;
    try { seenThisSession = sessionStorage.getItem('furia_preloaded') === '1'; } catch (e) { /* storage blocked */ }
    const short = seenThisSession;

    const pctEl  = $('#preloaderPct');
    const fillEl = $('#preloaderFill');

    // Dev flag ?slowpreloader=1 holds the preloader open for visual inspection.
    const devSlow = /[?&]slowpreloader=1/.test(location.search) ? 8000 : 0;

    const FLOOR_MS = 1200 + devSlow;   // minimum time the full preloader is visible
    const MAX_MS   = 3000 + devSlow;   // hard cap — never let it feel broken
    const SHORT_MS = 420;              // repeat-visit duration

    const t0 = performance.now();
    let progress = 0;
    let done = false;
    let assetsReady = false;
    let fontsReady = false;

    // "Real" load signal: window load + web fonts.
    const markReady = () => { assetsReady = true; };
    window.addEventListener('load', markReady);
    if (doc.readyState === 'complete') markReady();
    if (doc.fonts && doc.fonts.ready) {
      doc.fonts.ready.then(() => { fontsReady = true; }).catch(() => {});
    }

    const setPct = (p) => {
      const shown = clamp(Math.round(p), 0, 100);
      if (pctEl) pctEl.textContent = shown;
      if (fillEl) fillEl.style.transform = 'scaleX(' + (shown / 100) + ')';
    };

    const finish = () => {
      if (done) return;
      done = true;
      try { sessionStorage.setItem('furia_preloaded', '1'); } catch (e) {}

      // Wipe upward and start the hero text reveal as the wipe begins.
      preloader.classList.add('done');
      if (hero) hero.classList.add('in');
      doc.body.classList.add('revealed');

      // Clean up after the transition completes.
      setTimeout(() => preloader.classList.add('gone'), 950);
      setTimeout(() => preloader.remove(), 1400);
    };

    const tick = (now) => {
      const elapsed = now - t0;

      if (short) {
        // Quick version: count to 100 in ~SHORT_MS, wipe, done.
        progress = (elapsed / SHORT_MS) * 100;
        setPct(progress);
        if (progress >= 100) { finish(); return; }
      } else {
        // Full version: blend a real-asset proxy with a time-based curve.
        const realP = ((fontsReady ? 0.5 : 0) + (assetsReady ? 0.5 : 0)) * 100;
        // Ease toward 88% over ~75% of the max window; assets can pull it to 100 early.
        const timeP = easeInOutCubic(Math.min(1, elapsed / (MAX_MS * 0.75))) * 88;
        progress = Math.max(timeP, realP);
        setPct(progress);

        const elapsedOK = elapsed >= FLOOR_MS;
        if (elapsedOK && progress >= 100) { finish(); return; }
        if (elapsed >= MAX_MS) { setPct(100); finish(); return; }
      }

      requestAnimationFrame(tick);
    };

    if (short) preloader.classList.add('short');
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------------
     03. Smooth / inertial scroll — custom rAF virtual scroll
     - html.smooth is added only when JS + full motion are available,
       so the page degrades to native scroll automatically.
     - A fixed wrapper is translated by a lerped "current" value while a
       spacer div owns the native scrollbar / touch / keyboard scroll.
  ------------------------------------------------------------------ */
  let smoothOn = false;
  let wrap = null;
  let spacer = null;
  let current = 0;    // smoothed scroll position
  let target = 0;     // native scroll position (owned by the spacer)
  let tween = null;   // active anchor tween { from, to, t0, dur }

  function setupSmooth() {
    if (reduceMotion) return;
    wrap = $('#scrollWrap');
    spacer = $('#scrollSpacer');
    if (!wrap || !spacer) return;

    root.classList.add('smooth');
    smoothOn = true;

    const measure = () => { spacer.style.height = wrap.scrollHeight + 'px'; };
    measure();
    window.addEventListener('load', measure);
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(measure);
    window.addEventListener('resize', debounce(() => { measure(); initParallax(); }, 150));

    // Re-sync after the browser restores the scroll position on reload.
    target = window.scrollY || 0;
    current = target;
    wrap.style.transform = 'translate3d(0,' + (-current) + 'px,0)';

    // User wheel / touch input cancels any running anchor tween.
    window.addEventListener('wheel', cancelTween, { passive: true });
    window.addEventListener('touchstart', cancelTween, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key)) cancelTween();
    });
  }

  function cancelTween() { tween = null; }

  function scrollLoop() {
    if (smoothOn) {
      if (tween) {
        const p = clamp((performance.now() - tween.t0) / tween.dur, 0, 1);
        current = tween.from + (tween.to - tween.from) * easeInOutCubic(p);
        window.scrollTo(0, current);          // keep the native scrollbar in sync
        target = current;                      // don't fight our own scroll event
        if (p >= 1) tween = null;
      } else {
        target = window.scrollY;
        current += (target - current) * 0.085; // inertial lerp
        if (Math.abs(target - current) < 0.05) current = target;
      }
      wrap.style.transform = 'translate3d(0,' + (-current) + 'px,0)';
      parallax(current);
      headerState(current);
    }
    requestAnimationFrame(scrollLoop);
  }

  /* ------------------------------------------------------------------
     04. Anchor navigation — tween the virtual scroll to the target
  ------------------------------------------------------------------ */
  const HEADER_OFFSET = 84;

  function bindAnchors() {
    $$('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href').slice(1);
        if (!id) return;
        const el = doc.getElementById(id);
        if (!el) return;

        if (!smoothOn) return; // native jump (reduced motion / JS shell)

        e.preventDefault();
        // el's rect is viewport-relative, so its document Y = current + rect.top.
        const docY = current + el.getBoundingClientRect().top - HEADER_OFFSET;
        const y = Math.max(0, docY);
        tween = { from: current, to: y, t0: performance.now(), dur: 950 };
      });
    });
  }

  /* ------------------------------------------------------------------
     05. Parallax — background layers drift slower than foreground
  ------------------------------------------------------------------ */
  let pEls = [];

  function initParallax() {
    if (reduceMotion || !smoothOn) return;
    pEls = $$('[data-parallax]').map((el) => {
      const speed = parseFloat(el.getAttribute('data-parallax') || '0.3');
      const scale = parseFloat(el.getAttribute('data-scale') || '1');
      const r = el.getBoundingClientRect();
      return { el, speed, scale, top: r.top + current, h: r.height };
    });
  }

  function parallax(scrollY) {
    const vh = window.innerHeight;
    for (const p of pEls) {
      const center = p.top + p.h / 2 - scrollY;
      const offset = (center - vh / 2) * p.speed;
      p.el.style.transform =
        'translate3d(0,' + offset.toFixed(2) + 'px,0) scale(' + p.scale + ')';
    }
  }

  /* ------------------------------------------------------------------
     06. Custom cursor — dot + lagging ring + contextual morphs
  ------------------------------------------------------------------ */
  function initCursor() {
    if (!finePointer || reduceMotion) return;

    const dot   = $('#curDot');
    const ring  = $('#curRing');
    const label = $('#curLabel');
    if (!dot || !ring) return;

    let mx = 0, my = 0;          // raw pointer position
    let rx = 0, ry = 0;          // lagged ring position
    let lx = 0, ly = 0;          // lagged label position
    let active = false;

    window.addEventListener('mousemove', (e) => {
      mx = e.clientX; my = e.clientY;
      if (!active) {
        active = true;
        rx = mx; ry = my; lx = mx; ly = my;
        dot.style.opacity = 1; ring.style.opacity = 1;
      }
    });
    doc.addEventListener('mouseleave', () => {
      active = false;
      dot.style.opacity = 0; ring.style.opacity = 0;
    });

    // Ring grows over interactive elements (buttons, links, [data-mag]).
    const hoverables = 'a, button, [data-mag], [data-mag-zone]';
    const enterBig = (e) => { if (e.target.closest(hoverables)) ring.classList.add('big'); };
    const leaveBig = (e) => { if (e.target.closest(hoverables)) ring.classList.remove('big'); };
    doc.addEventListener('mouseover', enterBig);
    doc.addEventListener('mouseout', leaveBig);

    // Cards morph the cursor into a small "VIEW" target.
    doc.addEventListener('mouseover', (e) => {
      if (e.target.closest('[data-view]')) {
        ring.classList.add('view');
        if (label) label.classList.add('on');
      }
    });
    doc.addEventListener('mouseout', (e) => {
      if (e.target.closest('[data-view]')) {
        ring.classList.remove('view');
        if (label) label.classList.remove('on');
      }
    });

    doc.addEventListener('mousedown', () => ring.classList.add('press'));
    doc.addEventListener('mouseup',   () => ring.classList.remove('press'));

    const loop = () => {
      if (active) {
        rx += (mx - rx) * 0.16;
        ry += (my - ry) * 0.16;
        lx += (mx - lx) * 0.24;
        ly += (my - ly) * 0.24;
        dot.style.transform   = 'translate(' + mx + 'px,' + my + 'px) translate(-50%,-50%)';
        ring.style.transform  = 'translate(' + rx + 'px,' + ry + 'px) translate(-50%,-50%)';
        if (label) label.style.transform = 'translate(' + lx + 'px,' + ly + 'px) translate(-50%,-50%)';
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  // Magnetic buttons — the element pulls slightly toward the pointer.
  function initMagnetic() {
    if (!finePointer || reduceMotion) return;
    $$('[data-magnetic]').forEach((el) => {
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width  / 2)) * 0.16;
        const dy = (e.clientY - (r.top  + r.height / 2)) * 0.16;
        el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      });
      el.addEventListener('mouseleave', () => { el.style.transform = ''; });
    });
  }

  /* ------------------------------------------------------------------
     07. Scroll reveal — fade-up + scale-in, staggered by group
  ------------------------------------------------------------------ */
  function initReveal() {
    // Optional per-group stagger: children get incremental transition-delay.
    $$('[data-reveal-group]').forEach((g) => {
      $$('[data-reveal]', g).forEach((el, i) => {
        el.style.transitionDelay = (i * 70) + 'ms';
      });
    });

    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

    $$('[data-reveal]').forEach((el) => io.observe(el));

    // SVG line-draw sections ([data-draw]) trigger when well in view.
    $$('[data-draw]').forEach((el) => {
      const drawIO = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) { en.target.classList.add('in'); drawIO.unobserve(en.target); }
        });
      }, { threshold: 0.35 });
      drawIO.observe(el);
    });
  }

  /* ------------------------------------------------------------------
     08. Count-up stats — [data-count], eased, honors reduced motion
  ------------------------------------------------------------------ */
  function initCounters() {
    const counters = $$('[data-count]').map((el) => ({
      el,
      targetVal: parseFloat(el.getAttribute('data-count')),
      decimals: parseInt(el.getAttribute('data-decimals') || '0', 10),
      dur: 1600,
      done: false
    }));
    if (!counters.length) return;

    const write = (c, v) => {
      const s = c.decimals
        ? v.toFixed(c.decimals)
        : Math.round(v).toLocaleString('en-US');
      c.el.textContent = s;
    };

    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const c = counters.find((x) => x.el === en.target);
        if (!c || c.done) return;
        c.done = true;
        io.unobserve(en.target);

        if (reduceMotion) { write(c, c.targetVal); return; }

        const t0 = performance.now();
        const step = (now) => {
          const p = Math.min(1, (now - t0) / c.dur);
          write(c, c.targetVal * easeOutQuart(p));
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }, { threshold: 0.5 });

    counters.forEach((c) => io.observe(c.el));
  }

  /* ------------------------------------------------------------------
     09. Ticker + partners carousel builders
  ------------------------------------------------------------------ */
  function buildTicker() {
    const track = $('#tickerTrack');
    if (!track) return;

    const items = [
      { t: 'BUILD. RACE. WIN.', b: true },
      { t: 'WE ARE RECRUITING', mk: true },
      { t: 'SAE BAJA — PILLAI COLLEGE OF ENGINEERING' },
      { t: '10 DEPARTMENTS', b: true },
      { t: 'ALL-TERRAIN VEHICLES' },
      { t: 'THINK IT. BUILD IT. RACE IT.', mk: true },
      { t: 'REGISTRATION OPEN 2026–27', b: true }
    ];

    let html = '';
    for (let r = 0; r < 2; r++) {
      items.forEach((it) => {
        const inner = it.b ? '<b>' + it.t + '</b>' : it.t;
        html += '<span' + (it.mk ? ' class="mk"' : '') + '>' + inner + '</span>';
      });
    }
    track.innerHTML = html;
  }

  function buildPartners() {
    const track = $('#partnersTrack');
    if (!track) return;

    const names = [
      'APEX <i>INDUSTRIES</i>',
      'VELOX BRAKES',
      '<i>KINETIC</i> WHEELS',
      'MERIDIAN TYRES',
      'HALO AERO',
      'OCTANE <i>FUELS</i>',
      'GARDA LEATHER',
      'PULSAR AUDIO'
    ];

    let html = '';
    for (let r = 0; r < 2; r++) {
      names.forEach((n) => { html += '<span class="partner">' + n + '</span>'; });
    }
    track.innerHTML = html;
  }

  /* ------------------------------------------------------------------
     10. Header state + mobile menu
  ------------------------------------------------------------------ */
  function headerState(scrollY) {
    const header = $('.site-header');
    if (!header) return;
    header.classList.toggle('scrolled', scrollY > 24);
  }

  function initMobileNav() {
    const toggle = $('#navToggle');
    const menu = $('#mobileMenu');
    if (!toggle || !menu) return;

    const close = () => {
      menu.classList.remove('open');
      toggle.classList.remove('open');
      doc.body.classList.remove('menu-open');
    };
    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      toggle.classList.toggle('open', open);
      doc.body.classList.toggle('menu-open', open);
    });
    $$('a', menu).forEach((a) => a.addEventListener('click', close));
  }

  /* ------------------------------------------------------------------
     11. Init
  ------------------------------------------------------------------ */
  function init() {
    initPreloader();
    setupSmooth();
    initParallax();
    initReveal();
    initCounters();
    buildTicker();
    buildPartners();
    bindAnchors();
    initMobileNav();
    headerState(0);
    initCursor();
    initMagnetic();
    scrollLoop();
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();