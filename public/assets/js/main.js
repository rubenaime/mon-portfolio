/* =========================================================
   RUBEN EBAH — Portfolio 2026
   Interactions & comportements
   ========================================================= */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* ---------- Header & progression ---------- */
  var header = $('#siteHeader');
  var progress = $('#scrollProgress');
  var lastScroll = 0;

  function onScroll() {
    var y = window.scrollY || document.documentElement.scrollTop;
    if (header) header.classList.toggle('is-scrolled', y > 24);
    if (progress) {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = (h > 0 ? (y / h) * 100 : 0) + '%';
    }
    lastScroll = y;
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Menu mobile ---------- */
  var menuToggle = $('#menuToggle');
  var mobileMenu = $('#mobileMenu');

  function setMenu(open) {
    if (!menuToggle || !mobileMenu) return;
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    mobileMenu.classList.toggle('is-open', open);
    mobileMenu.setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('is-locked', open);
  }

  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', function () {
      setMenu(menuToggle.getAttribute('aria-expanded') !== 'true');
    });
    $$('a', mobileMenu).forEach(function (link) {
      link.addEventListener('click', function () { setMenu(false); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setMenu(false);
    });
  }

  /* ---------- Navigation active ---------- */
  var navLinks = $$('.site-nav a');
  var sections = navLinks.map(function (a) { return $(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && sections.length) {
    var navObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (a) {
          a.classList.toggle('is-active', a.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    sections.forEach(function (s) { navObs.observe(s); });
  }

  /* ---------- Rotateur de rôle ---------- */
  var roles = ['Développeur logiciel', 'Designer UI/UX', 'Motion designer', 'Prompt engineer'];
  var roleEl = $('#roleRotator');
  var roleIndex = 0;
  if (roleEl && !reduceMotion) {
    setInterval(function () {
      roleEl.style.opacity = '0';
      roleEl.style.transform = 'translateY(-6px)';
      setTimeout(function () {
        roleIndex = (roleIndex + 1) % roles.length;
        roleEl.textContent = roles[roleIndex];
        roleEl.style.opacity = '1';
        roleEl.style.transform = 'translateY(0)';
      }, 240);
    }, 3200);
    roleEl.style.transition = 'opacity .24s ease, transform .24s ease';
    roleEl.style.display = 'inline-block';
  }

  /* ---------- Photo 3D : rotation 360° ---------- */
  var stage = $('[data-hero-visual]');
  var hero3d = $('#hero3d');

  if (stage && hero3d) {
    var yaw = -12;
    var pitch = 3;
    var velYaw = 0;
    var velPitch = 0;
    var dragging = false;
    var interacted = false;
    var lastX = 0;
    var lastY = 0;
    var lastTime = performance.now();
    var spinStart = 0;
    var spinFrom = 0;
    var spinTarget = 0;

    var clampPitch = function (v) { return Math.max(-24, Math.min(24, v)); };

    function apply() {
      hero3d.style.setProperty('--ry', yaw.toFixed(2) + 'deg');
      hero3d.style.setProperty('--rx', pitch.toFixed(2) + 'deg');
    }

    function animate(now) {
      var dt = Math.min(64, now - lastTime) / 16.67;
      lastTime = now;

      if (spinStart && now - spinStart < 900) {
        var t = (now - spinStart) / 900;
        var ease = 1 - Math.pow(1 - t, 3);
        yaw = spinFrom + (spinTarget - spinFrom) * ease;
      } else if (spinStart) {
        spinStart = 0;
      } else if (!dragging) {
        if (Math.abs(velYaw) > 0.02 || Math.abs(velPitch) > 0.02) {
          yaw += velYaw * dt;
          pitch = clampPitch(pitch + velPitch * dt);
          velYaw *= Math.pow(0.94, dt);
          velPitch *= Math.pow(0.9, dt);
        } else if (interacted) {
          var snap = Math.round(yaw / 360) * 360;
          yaw += (snap - yaw) * 0.035 * dt;
          pitch += (0 - pitch) * 0.04 * dt;
        } else if (!reduceMotion) {
          var time = now / 1000;
          yaw = -12 + Math.sin(time * 0.42) * 9;
          pitch = 3 + Math.cos(time * 0.33) * 2.2;
        }
      }
      apply();
      requestAnimationFrame(animate);
    }

    function pointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true;
      interacted = true;
      spinStart = 0;
      velYaw = 0;
      velPitch = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      hero3d.classList.add('is-dragging');
      if (hero3d.setPointerCapture && e.pointerId !== undefined) {
        try { hero3d.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      }
    }

    function pointerMove(e) {
      if (!dragging) return;
      var dx = e.clientX - lastX;
      var dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      yaw += dx * 0.55;
      pitch = clampPitch(pitch - dy * 0.3);
      velYaw = dx * 0.28;
      velPitch = -dy * 0.12;
      if (e.cancelable) e.preventDefault();
    }

    function pointerUp() {
      if (!dragging) return;
      dragging = false;
      hero3d.classList.remove('is-dragging');
    }

    hero3d.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointermove', pointerMove, { passive: false });
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerUp);

    hero3d.addEventListener('dblclick', function () {
      interacted = true;
      spinFrom = yaw;
      spinTarget = Math.round(yaw / 360) * 360 + 360;
      spinStart = performance.now();
    });

    hero3d.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        interacted = true;
        yaw += e.key === 'ArrowLeft' ? -20 : 20;
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        interacted = true;
        spinFrom = yaw;
        spinTarget = Math.round(yaw / 360) * 360 + 360;
        spinStart = performance.now();
      }
    });

    apply();
    requestAnimationFrame(animate);
  }

  /* ---------- Apparition au scroll ---------- */
  var revealEls = $$('[data-reveal]');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach(function (el) { revealObs.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------- Compteurs ---------- */
  function animateCount(el) {
    var target = parseInt(el.getAttribute('data-count'), 10);
    if (isNaN(target) || target > 1000) { el.textContent = String(target); return; }
    var start = performance.now();
    var duration = 1100;
    function tick(now) {
      var p = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  var counters = $$('[data-count]');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var countObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          countObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { countObs.observe(el); });
  }

  /* ---------- Filtres projets ---------- */
  var filters = $$('.filter');
  var projectCards = $$('.project-card');
  filters.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filters.forEach(function (b) {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
      var cat = btn.getAttribute('data-filter');
      projectCards.forEach(function (card) {
        var show = cat === 'all' || card.getAttribute('data-category') === cat;
        card.classList.toggle('is-hidden', !show);
      });
    });
  });

  /* ---------- Lightbox certificats ---------- */
  var certData = {
    cert1: {
      title: 'Base de données SQL',
      desc: 'Certificat d\'achèvement Cursa — 8 h 55 de formation, terminé le 31 octobre 2025.',
      code: 'ea31f7bda6f37a13dcb1dc2320bd01ba',
      image: '/assets/img/certificat-sql.jpg'
    },
    cert2: {
      title: 'Informatique pour les débutants & SQL',
      desc: 'Deux modules validés le 31 octobre 2025 — 57 min + 2 exercices, et 8 h 55 de SQL.',
      code: '4ed5cf3e56e86de517351c82b2c4327a',
      image: '/assets/img/certificat-informatique.jpg'
    },
    cert3: {
      title: 'Marketing digital, Excel, Word & SQL',
      desc: 'Cinq modules validés entre 2025 et 2026 : marketing digital, informatique, Excel 2019, Word et SQL.',
      code: '1cd74b57c001ed752d223034bc226a24',
      image: '/assets/img/certificat-marketing.jpg'
    }
  };

  var lightbox = $('#certLightbox');
  var lbImage = $('#lightboxImage');
  var lbTitle = $('#lightboxTitle');
  var lbDesc = $('#lightboxDesc');
  var lbCode = $('#lightboxCode');
  var lbVerify = $('#lightboxVerify');
  var lbClose = $('#lightboxClose');
  var lastFocused = null;

  function openLightbox(key, trigger) {
    var data = certData[key];
    if (!data || !lightbox) return;
    lastFocused = trigger || document.activeElement;
    lbImage.src = data.image;
    lbImage.alt = 'Certificat Cursa — ' + data.title;
    lbTitle.textContent = data.title;
    lbDesc.textContent = data.desc;
    lbCode.textContent = data.code;
    lbVerify.href = 'https://cursa.app/pt/my-certificate?code=' + encodeURIComponent(data.code);
    lightbox.classList.add('is-open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-locked');
    setTimeout(function () { if (lbClose) lbClose.focus(); }, 60);
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-locked');
    if (lastFocused) lastFocused.focus();
  }

  $$('.cert-card').forEach(function (card) {
    card.addEventListener('click', function () {
      openLightbox(card.getAttribute('data-cert'), card);
    });
  });

  if (lightbox) {
    if (lbClose) lbClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && lightbox.classList.contains('is-open')) closeLightbox();
      if (e.key === 'Tab' && lightbox.classList.contains('is-open')) {
        var focusables = $$('button, a[href]', lightbox);
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  /* ---------- Formulaire de contact ---------- */
  var form = $('#contactForm');
  var formStatus = $('#formStatus');
  var submitBtn = $('#contactSubmit');

  function setStatus(type, message) {
    if (!formStatus) return;
    formStatus.className = 'form-status is-visible is-' + type;
    formStatus.textContent = message;
  }

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var data = {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        subject: form.subject.value.trim(),
        message: form.message.value.trim(),
        website: form.website.value
      };
      if (!data.name || !data.email || !data.subject || !data.message) {
        setStatus('error', 'Merci de remplir tous les champs.');
        return;
      }
      if (submitBtn) { submitBtn.disabled = true; submitBtn.style.opacity = '0.6'; }
      setStatus('success', 'Envoi en cours…');

      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(function (res) {
        return res.json().then(function (json) { return { ok: res.ok, json: json }; });
      }).then(function (result) {
        if (!result.ok) throw new Error(result.json.error || 'Erreur inconnue');
        setStatus('success', 'Message envoyé. Merci — je vous réponds sous 24 heures.');
        form.reset();
        track('contact_submit', { subject: data.subject.slice(0, 60) });
      }).catch(function (err) {
        setStatus('error', 'L\'envoi a échoué. Écrivez-moi directement à ebahruben9@gmail.com.');
      }).finally(function () {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.style.opacity = '1'; }
      });
    });
  }

  /* ---------- Année ---------- */
  var yearEl = $('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---------- Suivi des visites ---------- */
  var visitId = null;
  var startTime = Date.now();
  var maxScroll = 0;
  var sentExit = false;

  function track(event, meta) {
    try {
      var payload = {
        event: event,
        path: location.pathname + location.hash,
        referrer: document.referrer || '',
        page: document.body.getAttribute('data-page') || 'home',
        screen: window.screen.width + 'x' + window.screen.height,
        viewport: window.innerWidth + 'x' + window.innerHeight,
        language: navigator.language || '',
        timezone: (function () {
          try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (err) { return ''; }
        })(),
        meta: meta || {}
      };
      if (visitId) payload.visitId = visitId;
      var json = JSON.stringify(payload);
      if (event === 'page_exit' && navigator.sendBeacon) {
        navigator.sendBeacon('/api/track', new Blob([json], { type: 'application/json' }));
        return;
      }
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        keepalive: true
      }).then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (res) {
          if (res && res.visitId && !visitId) visitId = res.visitId;
        }).catch(function () { /* silencieux */ });
    } catch (err) { /* silencieux */ }
  }

  function scrollPct() {
    var h = document.documentElement.scrollHeight - window.innerHeight;
    return h > 0 ? Math.min(100, Math.round((window.scrollY / h) * 100)) : 0;
  }

  function sendHeartbeat() {
    if (sentExit) return;
    maxScroll = Math.max(maxScroll, scrollPct());
    track('heartbeat', {
      duration: Math.round((Date.now() - startTime) / 1000),
      scroll: maxScroll
    });
  }

  if (!reduceMotion) {
    setTimeout(function () {
      track('page_view', { title: document.title });
    }, 350);

    setInterval(sendHeartbeat, 30000);

    window.addEventListener('scroll', function () {
      maxScroll = Math.max(maxScroll, scrollPct());
    }, { passive: true });

    window.addEventListener('pagehide', function () {
      maxScroll = Math.max(maxScroll, scrollPct());
      sentExit = true;
      track('page_exit', {
        duration: Math.round((Date.now() - startTime) / 1000),
        scroll: maxScroll
      });
    });
  }

  /* ---------- Boutons magnétiques (léger) ---------- */
  if (!reduceMotion && window.matchMedia('(pointer: fine)').matches) {
    $$('.btn').forEach(function (btn) {
      btn.addEventListener('pointermove', function (e) {
        var r = btn.getBoundingClientRect();
        var x = (e.clientX - r.left - r.width / 2) / r.width;
        var y = (e.clientY - r.top - r.height / 2) / r.height;
        btn.style.transform = 'translate(' + (x * 4).toFixed(1) + 'px,' + (y * 3 - 2).toFixed(1) + 'px)';
      });
      btn.addEventListener('pointerleave', function () {
        btn.style.transform = '';
      });
    });
  }
})();
