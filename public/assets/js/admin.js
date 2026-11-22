/* =========================================================
   RUBEN EBAH — Back-office
   Aucune dépendance externe.
   ========================================================= */
(function () {
  'use strict';

  var meta = function (name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? el.getAttribute('content') : '';
  };

  var state = {
    csrf: meta('csrf-token'),
    username: meta('admin-user') || 'admin',
    view: 'overview',
    stats: null,
    visits: { page: 1, pages: 1, q: '', limit: 25 },
    activity: { page: 1, pages: 1, type: 'all', limit: 30 },
    projects: [],
    categories: { web: 'Web', application: 'Application', design: 'Design', motion: 'Motion' },
    messages: [],
    currentMessage: null,
    coverData: '',
    confirmAction: null,
    projectEditing: null
  };

  var COLORS = {
    accent: '#c9f45b',
    muted: '#6b717a',
    text: '#f2f0ea',
    line: 'rgba(255,255,255,0.08)',
    palette: ['#c9f45b', '#7cb8ff', '#ffc65c', '#ff6b5a', '#b78cff', '#4fd6b0']
  };

  /* ---------- Helpers ---------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function icon(id) {
    return '<svg class="icon" aria-hidden="true"><use href="#' + id + '"/></svg>';
  }

  function formatNumber(n) {
    return new Intl.NumberFormat('fr-FR').format(Number(n) || 0);
  }

  function formatDuration(seconds) {
    var s = Math.max(0, Math.round(Number(seconds) || 0));
    if (s < 60) return s + ' s';
    var m = Math.floor(s / 60);
    var rest = s % 60;
    if (m < 60) return m + ' min ' + String(rest).padStart(2, '0') + ' s';
    var h = Math.floor(m / 60);
    return h + ' h ' + String(m % 60).padStart(2, '0');
  }

  function formatDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' · ' +
      d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function relativeTime(iso) {
    var d = new Date(iso).getTime();
    if (!d) return '—';
    var diff = Math.max(0, Date.now() - d);
    var min = Math.floor(diff / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return 'il y a ' + min + ' min';
    var h = Math.floor(min / 60);
    if (h < 24) return 'il y a ' + h + ' h';
    var j = Math.floor(h / 24);
    if (j < 7) return 'il y a ' + j + ' j';
    return formatDate(iso);
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) {
      return w.charAt(0).toUpperCase();
    }).join('') || '?';
  }

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, delay || 260);
    };
  }

  /* ---------- Toasts ---------- */

  function toast(message, type) {
    var host = $('#toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast toast--' + (type || 'success');
    el.innerHTML = '<svg aria-hidden="true"><use href="#' + (type === 'error' ? 'i-alert' : 'i-check') + '"/></svg>' +
      '<span>' + escapeHtml(message) + '</span>';
    host.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(function () { el.remove(); }, 320);
    }, 3600);
  }

  /* ---------- API ---------- */

  function api(path, options) {
    options = options || {};
    var headers = Object.assign({ 'Accept': 'application/json' }, options.headers || {});
    var init = {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: headers
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    if (init.method !== 'GET' && init.method !== 'HEAD') {
      headers['X-CSRF-Token'] = state.csrf;
    }

    return fetch(path, init).then(function (res) {
      if (res.status === 401) {
        window.location.href = '/admin';
        throw new Error('Session expirée.');
      }
      var type = res.headers.get('content-type') || '';
      if (type.indexOf('application/json') === -1) {
        return res.text().then(function (text) {
          if (!res.ok) throw new Error(text || 'Erreur serveur.');
          return {};
        });
      }
      return res.json().then(function (json) {
        if (!res.ok) {
          var err = new Error(json.error || 'Erreur serveur.');
          err.status = res.status;
          throw err;
        }
        return json;
      });
    });
  }

  /* ---------- Navigation ---------- */

  var VIEW_META = {
    overview: { title: "Vue d'ensemble", sub: 'Activité de votre portfolio' },
    visits: { title: 'Visites', sub: 'Détail des passages sur le site' },
    activity: { title: 'Activité', sub: "Journal des actions de l'espace admin" },
    projects: { title: 'Projets', sub: 'Gérer les réalisations du portfolio' },
    messages: { title: 'Messages', sub: 'Demandes reçues via le formulaire' },
    security: { title: 'Sécurité', sub: 'Mot de passe et sessions' }
  };

  function setView(view, updateHash) {
    if (!VIEW_META[view]) view = 'overview';
    state.view = view;

    $$('.admin-section').forEach(function (section) {
      section.hidden = section.getAttribute('data-section') !== view;
    });

    $$('.admin-nav button[data-view]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-view') === view);
    });

    var info = VIEW_META[view];
    var title = $('#viewTitle');
    var sub = $('#viewSub');
    if (title) title.textContent = info.title;
    if (sub) sub.textContent = info.sub;

    if (updateHash !== false) {
      if (window.location.hash !== '#' + view) {
        history.replaceState(null, '', '#' + view);
      }
    }

    closeSidebar();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (view === 'overview') loadStats();
    if (view === 'visits') loadVisits();
    if (view === 'activity') loadActivity();
    if (view === 'projects') loadProjects();
    if (view === 'messages') loadMessages();
    if (view === 'security') loadSession();
  }

  /* ---------- Sidebar mobile ---------- */

  function openSidebar() {
    var sidebar = $('#adminSidebar');
    var backdrop = $('#sidebarBackdrop');
    if (sidebar) sidebar.classList.add('is-open');
    if (backdrop) backdrop.classList.add('is-open');
  }

  function closeSidebar() {
    var sidebar = $('#adminSidebar');
    var backdrop = $('#sidebarBackdrop');
    if (sidebar) sidebar.classList.remove('is-open');
    if (backdrop) backdrop.classList.remove('is-open');
  }

  /* ---------- Canvas ---------- */

  function setupCanvas(canvas) {
    if (!canvas) return null;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, rect.width || canvas.clientWidth || 300);
    var h = Math.max(1, rect.height || canvas.clientHeight || 200);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function drawLineChart(canvas, daily) {
    var setup = setupCanvas(canvas);
    if (!setup || !daily || !daily.length) return;
    var ctx = setup.ctx;
    var w = setup.w;
    var h = setup.h;
    var pad = { top: 16, right: 12, bottom: 26, left: 30 };
    var innerW = w - pad.left - pad.right;
    var innerH = h - pad.top - pad.bottom;

    var max = Math.max.apply(null, daily.map(function (d) { return d.views; }).concat([1]));
    max = Math.ceil(max / 4) * 4 || 4;

    ctx.clearRect(0, 0, w, h);
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (var i = 0; i <= 4; i++) {
      var value = (max / 4) * i;
      var y = pad.top + innerH - (innerH * (i / 4));
      ctx.strokeStyle = 'rgba(255,255,255,0.055)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = '#6b717a';
      ctx.fillText(String(Math.round(value)), pad.left - 7, y);
    }

    function points(key) {
      return daily.map(function (d, idx) {
        var x = pad.left + (daily.length === 1 ? innerW / 2 : (innerW * idx) / (daily.length - 1));
        var y = pad.top + innerH - (innerH * Math.min(1, d[key] / max));
        return { x: x, y: y };
      });
    }

    function smooth(pts) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) {
        var prev = pts[i - 1];
        var cur = pts[i];
        var cx = (prev.x + cur.x) / 2;
        ctx.bezierCurveTo(cx, prev.y, cx, cur.y, cur.x, cur.y);
      }
    }

    var views = points('views');
    var gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + innerH);
    gradient.addColorStop(0, 'rgba(201,244,91,0.22)');
    gradient.addColorStop(1, 'rgba(201,244,91,0)');
    smooth(views);
    ctx.lineTo(views[views.length - 1].x, pad.top + innerH);
    ctx.lineTo(views[0].x, pad.top + innerH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    smooth(views);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    var visitors = points('visitors');
    smooth(visitors);
    ctx.strokeStyle = 'rgba(160,168,178,0.85)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    views.forEach(function (p, idx) {
      if (idx !== views.length - 1 && daily[idx].views === 0) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = idx === views.length - 1 ? COLORS.accent : '#0f1216';
      ctx.fill();
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    });

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#6b717a';
    ctx.font = '8px "JetBrains Mono", monospace';
    var step = daily.length > 8 ? 2 : 1;
    daily.forEach(function (d, idx) {
      if (idx % step !== 0 && idx !== daily.length - 1) return;
      var x = pad.left + (daily.length === 1 ? innerW / 2 : (innerW * idx) / (daily.length - 1));
      ctx.fillText(d.label, x, pad.top + innerH + 8);
    });
  }

  function drawDonut(canvas, data) {
    var setup = setupCanvas(canvas);
    if (!setup) return;
    var ctx = setup.ctx;
    var w = setup.w;
    var h = setup.h;
    var cx = w / 2;
    var cy = h / 2;
    var radius = Math.min(w, h) / 2 - 6;
    var thickness = 13;
    var total = data.reduce(function (sum, d) { return sum + d.count; }, 0);

    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(cx, cy, radius - thickness / 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = thickness;
    ctx.stroke();

    if (!total) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Aucune visite', cx, cy);
      return;
    }

    var start = -Math.PI / 2;
    data.forEach(function (item, idx) {
      var angle = (item.count / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius - thickness / 2, start + 0.02, start + angle - 0.02);
      ctx.strokeStyle = COLORS.palette[idx % COLORS.palette.length];
      ctx.lineWidth = thickness;
      ctx.lineCap = 'butt';
      ctx.stroke();
      start += angle;
    });

    ctx.fillStyle = COLORS.text;
    ctx.font = '700 20px "Sora", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatNumber(total), cx, cy - 5);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.fillText('VISITES', cx, cy + 13);
  }

  /* ---------- Vue d'ensemble ---------- */

  function renderRank(host, items, emptyLabel) {
    if (!host) return;
    if (!items || !items.length) {
      host.innerHTML = '<p class="cell-sub" style="font-size:10px;">' + escapeHtml(emptyLabel || 'Aucune donnée pour le moment.') + '</p>';
      return;
    }
    var max = Math.max.apply(null, items.map(function (i) { return i.count; }).concat([1]));
    host.innerHTML = items.map(function (item) {
      var pct = Math.max(3, Math.round((item.count / max) * 100));
      return '<div class="rank-item">' +
        '<div class="rank-item__top"><span>' + escapeHtml(item.label) + '</span><strong>' + formatNumber(item.count) + '</strong></div>' +
        '<div class="rank-bar"><i style="width:' + pct + '%"></i></div>' +
        '</div>';
    }).join('');
  }

  function actionIcon(type) {
    if (!type) return 'i-activity';
    if (type.indexOf('auth') === 0) return 'i-shield';
    if (type.indexOf('project') === 0) return 'i-folder';
    if (type.indexOf('message') === 0) return 'i-mail';
    return 'i-activity';
  }

  function renderActivity(host, actions) {
    if (!host) return;
    if (!actions || !actions.length) {
      host.innerHTML = '<p class="cell-sub" style="font-size:10px;padding:14px 0;">Aucune action enregistrée.</p>';
      return;
    }
    host.innerHTML = actions.map(function (a) {
      return '<div class="activity__item">' +
        '<span class="activity__dot">' + icon(actionIcon(a.type)) + '</span>' +
        '<div class="activity__body">' +
          '<div class="activity__title">' + escapeHtml(a.label) + '</div>' +
          (a.detail ? '<div class="activity__detail">' + escapeHtml(a.detail) + '</div>' : '') +
        '</div>' +
        '<span class="activity__time" title="' + escapeHtml(formatDateTime(a.timestamp)) + '">' + escapeHtml(relativeTime(a.timestamp)) + '</span>' +
      '</div>';
    }).join('');
  }

  function loadStats() {
    api('/api/admin/stats').then(function (data) {
      state.stats = data;

      var set = function (id, value) {
        var el = document.getElementById(id);
        if (el) el.textContent = value;
      };

      set('statTotal', formatNumber(data.total));
      set('statUnique', formatNumber(data.unique));
      set('statToday', formatNumber(data.today));
      set('statDuration', data.avgDuration ? formatDuration(data.avgDuration) : '—');
      set('statWeek', formatNumber(data.week));

      drawLineChart($('#visitsChart'), data.daily);
      drawDonut($('#devicesChart'), data.devices || []);

      var legend = $('#devicesLegend');
      if (legend) {
        var total = (data.devices || []).reduce(function (s, d) { return s + d.count; }, 0);
        legend.innerHTML = (data.devices || []).map(function (d, idx) {
          var pct = total ? Math.round((d.count / total) * 100) : 0;
          return '<li><i style="background:' + COLORS.palette[idx % COLORS.palette.length] + '"></i>' +
            escapeHtml(d.label) + ' <strong>' + pct + '%</strong></li>';
        }).join('') || '<li class="cell-sub">Aucune visite</li>';
      }

      renderRank($('#topPages'), data.topPages, 'Aucune page consultée.');
      renderRank($('#topProjects'), data.topProjects, 'Aucun projet consulté.');
      renderRank($('#referrers'), data.referrers, 'Aucun référent enregistré.');
      renderActivity($('#recentActivity'), data.recentActions || []);

      updateUnreadBadge(data.unread);
      var notice = $('#passwordNotice');
      if (notice) notice.hidden = !(meta('must-change') === '1');
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  function updateUnreadBadge(count) {
    var badge = $('#navUnread');
    if (!badge) return;
    if (count > 0) {
      badge.hidden = false;
      badge.textContent = count > 99 ? '99+' : String(count);
    } else {
      badge.hidden = true;
    }
  }

  /* ---------- Visites ---------- */

  function loadVisits() {
    var body = $('#visitsBody');
    if (body) body.innerHTML = '<tr><td colspan="7"><div class="skeleton" style="height:40px;"></div></td></tr>';

    var params = '?page=' + state.visits.page + '&limit=' + state.visits.limit +
      (state.visits.q ? '&q=' + encodeURIComponent(state.visits.q) : '');

    api('/api/admin/visits' + params).then(function (data) {
      state.visits.page = data.page;
      state.visits.pages = data.pages;

      if (!body) return;
      if (!data.items.length) {
        body.innerHTML = '<tr><td colspan="7"><div class="empty-state">' + icon('i-eye') +
          '<strong>Aucune visite trouvée</strong><p>Les visites apparaîtront ici dès que quelqu’un ouvrira le site.</p></div></td></tr>';
      } else {
        body.innerHTML = data.items.map(function (v) {
          return '<tr>' +
            '<td><span class="cell-main">' + escapeHtml(formatDateTime(v.timestamp)) + '</span><span class="cell-sub">' + escapeHtml(relativeTime(v.timestamp)) + '</span></td>' +
            '<td><span class="cell-main">' + escapeHtml(v.page || 'Accueil') + '</span><span class="cell-sub">' + escapeHtml(v.path || '/') + '</span></td>' +
            '<td><span class="chip">' + escapeHtml(v.device || '—') + '</span><span class="cell-sub">' + escapeHtml((v.browser || '') + ' · ' + (v.os || '')) + '</span></td>' +
            '<td class="cell-mono">' + escapeHtml(v.referrer ? v.referrer.replace(/^https?:\/\//, '').slice(0, 34) : 'Direct') + '</td>' +
            '<td class="cell-mono">' + escapeHtml(v.ip || '—') + '</td>' +
            '<td class="cell-mono">' + (v.duration ? escapeHtml(formatDuration(v.duration)) : '—') + '</td>' +
            '<td class="cell-mono">' + (v.scroll ? escapeHtml(v.scroll + ' %') : '—') + '</td>' +
          '</tr>';
        }).join('');
      }

      var metaEl = $('#visitsMeta');
      if (metaEl) {
        var from = data.total ? (data.page - 1) * data.limit + 1 : 0;
        var to = Math.min(data.total, data.page * data.limit);
        metaEl.textContent = from + '–' + to + ' sur ' + formatNumber(data.total) + ' visites';
      }
      var prev = $('#visitsPrev');
      var next = $('#visitsNext');
      if (prev) prev.disabled = data.page <= 1;
      if (next) next.disabled = data.page >= data.pages;
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  /* ---------- Activité ---------- */

  function loadActivity() {
    var list = $('#activityList');
    if (list) list.innerHTML = '<div class="skeleton" style="height:120px;"></div>';

    var params = '?page=' + state.activity.page + '&limit=' + state.activity.limit +
      (state.activity.type !== 'all' ? '&type=' + encodeURIComponent(state.activity.type) : '');

    api('/api/admin/actions' + params).then(function (data) {
      state.activity.page = data.page;
      state.activity.pages = data.pages;
      renderActivity(list, data.items);

      var metaEl = $('#activityMeta');
      if (metaEl) {
        var from = data.total ? (data.page - 1) * data.limit + 1 : 0;
        var to = Math.min(data.total, data.page * data.limit);
        metaEl.textContent = from + '–' + to + ' sur ' + formatNumber(data.total) + ' actions';
      }
      var count = $('#activityCount');
      if (count) count.textContent = formatNumber(data.total) + ' entrées';

      var prev = $('#activityPrev');
      var next = $('#activityNext');
      if (prev) prev.disabled = data.page <= 1;
      if (next) next.disabled = data.page >= data.pages;
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  /* ---------- Projets ---------- */

  function loadProjects() {
    var list = $('#projectsList');
    if (list) list.innerHTML = '<div class="skeleton" style="height:80px;margin:16px;"></div>';

    api('/api/admin/projects').then(function (data) {
      state.projects = data.items || [];
      state.categories = data.categories || state.categories;
      renderProjects();

      var count = $('#projectsCount');
      if (count) count.textContent = state.projects.length + ' projet' + (state.projects.length > 1 ? 's' : '');
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  function renderProjects() {
    var list = $('#projectsList');
    if (!list) return;

    if (!state.projects.length) {
      list.innerHTML = '<div class="empty-state">' + icon('i-folder') +
        '<strong>Aucun projet</strong><p>Ajoutez votre première réalisation pour l’afficher sur le site.</p></div>';
      return;
    }

    list.innerHTML = state.projects.map(function (p) {
      return '<div class="admin-project">' +
        '<div class="admin-project__thumb"><img src="' + escapeHtml(p.cover) + '" alt="" loading="lazy"></div>' +
        '<div class="admin-project__body">' +
          '<div class="admin-project__title">' + escapeHtml(p.title) +
            (p.featured ? '<span class="chip chip--accent">À la une</span>' : '') +
          '</div>' +
          '<div class="admin-project__meta">' + escapeHtml(state.categories[p.category] || p.category) + ' · ' + escapeHtml(p.year) + ' · /projet/' + escapeHtml(p.slug) + '</div>' +
        '</div>' +
        '<div class="admin-project__actions">' +
          '<a class="btn btn--icon" href="/projet/' + encodeURIComponent(p.slug) + '" target="_blank" rel="noopener" title="Voir la page" aria-label="Voir ' + escapeHtml(p.title) + '">' + icon('i-external') + '</a>' +
          '<button class="btn btn--icon" type="button" data-edit="' + escapeHtml(p.id) + '" title="Modifier" aria-label="Modifier ' + escapeHtml(p.title) + '">' + icon('i-edit') + '</button>' +
          '<button class="btn btn--icon btn--danger" type="button" data-delete="' + escapeHtml(p.id) + '" title="Supprimer" aria-label="Supprimer ' + escapeHtml(p.title) + '">' + icon('i-trash') + '</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* ---------- Modale projet ---------- */

  function openModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    var focusable = modal.querySelector('input:not([type="file"]), select, textarea, button');
    if (focusable) setTimeout(function () { focusable.focus(); }, 120);
  }

  function closeModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    if (!$$('.modal.is-open').length) document.body.style.overflow = '';
  }

  function resetProjectForm() {
    var form = $('#projectForm');
    if (form) form.reset();
    state.projectEditing = null;
    state.coverData = '';
    var id = $('#projectId');
    if (id) id.value = '';
    var year = $('#projectYear');
    if (year) year.value = String(new Date().getFullYear());
    var order = $('#projectOrder');
    if (order) order.value = String(state.projects.length + 1);
    var role = $('#projectRole');
    if (role) role.value = 'Développeur & designer';
    var client = $('#projectClient');
    if (client) client.value = 'Projet personnel';
    var title = $('#projectModalTitle');
    if (title) title.textContent = 'Nouveau projet';
    var sub = $('#projectModalSub');
    if (sub) sub.textContent = 'Ajouter une réalisation au portfolio';
    setCoverPreview('');
  }

  function setCoverPreview(src) {
    var img = $('#coverPreview');
    var empty = $('#coverEmpty');
    var badge = $('#coverBadge');
    if (!img) return;
    if (src) {
      img.src = src;
      img.hidden = false;
      if (empty) empty.hidden = true;
      if (badge) badge.hidden = false;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
      if (empty) empty.hidden = false;
      if (badge) badge.hidden = true;
    }
  }

  function fillProjectForm(project) {
    state.projectEditing = project;
    state.coverData = '';

    var set = function (id, value) {
      var el = document.getElementById(id);
      if (el) el.value = value == null ? '' : value;
    };

    set('projectId', project.id);
    set('projectTitle', project.title);
    set('projectCategory', project.category);
    set('projectYear', project.year);
    set('projectRole', project.role);
    set('projectClient', project.client);
    set('projectDuration', project.duration);
    set('projectOrder', project.order);
    set('projectExcerpt', project.excerpt);
    set('projectDescription', project.description);
    set('projectTags', (project.tags || []).join(', '));
    set('projectStack', (project.stack || []).join(', '));
    set('projectLive', project.liveUrl);
    set('projectRepo', project.repoUrl);

    var featured = $('#projectFeatured');
    if (featured) featured.checked = Boolean(project.featured);

    setCoverPreview(project.cover);

    var title = $('#projectModalTitle');
    if (title) title.textContent = 'Modifier le projet';
    var sub = $('#projectModalSub');
    if (sub) sub.textContent = project.title;
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Lecture du fichier impossible.')); };
      reader.readAsDataURL(file);
    });
  }

  function submitProject(event) {
    event.preventDefault();
    var btn = $('#projectSaveBtn');
    var form = $('#projectForm');
    if (!form) return;

    var title = $('#projectTitle').value.trim();
    var excerpt = $('#projectExcerpt').value.trim();
    var description = $('#projectDescription').value.trim();

    if (title.length < 2) return toast('Le titre doit contenir au moins 2 caractères.', 'error');
    if (excerpt.length < 10) return toast('Le résumé doit contenir au moins 10 caractères.', 'error');
    if (description.length < 10) return toast('La description doit contenir au moins 10 caractères.', 'error');

    var payload = {
      title: title,
      category: $('#projectCategory').value,
      year: Number($('#projectYear').value),
      role: $('#projectRole').value.trim(),
      client: $('#projectClient').value.trim(),
      duration: $('#projectDuration').value.trim() || '—',
      order: Number($('#projectOrder').value),
      excerpt: excerpt,
      description: description,
      tags: $('#projectTags').value,
      stack: $('#projectStack').value,
      liveUrl: $('#projectLive').value.trim(),
      repoUrl: $('#projectRepo').value.trim(),
      featured: $('#projectFeatured').checked
    };

    if (state.coverData) payload.cover = state.coverData;

    if (btn) btn.disabled = true;

    var editing = state.projectEditing;
    var request = editing
      ? api('/api/admin/projects/' + encodeURIComponent(editing.id), { method: 'PUT', body: payload })
      : api('/api/admin/projects', { method: 'POST', body: payload });

    request.then(function (result) {
      toast(editing ? 'Projet mis à jour.' : 'Projet ajouté.');
      closeModal('projectModal');
      resetProjectForm();
      loadProjects();
      return result;
    }).catch(function (err) {
      toast(err.message, 'error');
    }).finally(function () {
      if (btn) btn.disabled = false;
    });
  }

  /* ---------- Messages ---------- */

  function loadMessages() {
    var list = $('#messagesList');
    if (list) list.innerHTML = '<div class="skeleton" style="height:80px;margin:16px;"></div>';

    api('/api/admin/messages').then(function (data) {
      state.messages = data.items || [];
      renderMessages();
      var count = $('#messagesCount');
      if (count) count.textContent = state.messages.length + ' message' + (state.messages.length > 1 ? 's' : '');
      var unread = state.messages.filter(function (m) { return !m.read; }).length;
      updateUnreadBadge(unread);
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  function renderMessages() {
    var list = $('#messagesList');
    if (!list) return;

    if (!state.messages.length) {
      list.innerHTML = '<div class="empty-state">' + icon('i-inbox') +
        '<strong>Aucun message</strong><p>Les demandes envoyées depuis le formulaire de contact apparaîtront ici.</p></div>';
      return;
    }

    list.innerHTML = state.messages.map(function (m) {
      return '<button class="message-item' + (m.read ? '' : ' is-unread') + '" type="button" data-message="' + escapeHtml(m.id) + '">' +
        '<span class="message-item__avatar">' + escapeHtml(initials(m.name)) + '</span>' +
        '<span class="message-item__body">' +
          '<span class="message-item__top">' +
            '<span class="message-item__name">' + escapeHtml(m.name) + '</span>' +
            (m.read ? '' : '<span class="unread-dot" aria-label="Non lu"></span>') +
            '<span class="message-item__time">' + escapeHtml(relativeTime(m.timestamp)) + '</span>' +
          '</span>' +
          '<span class="message-item__subject">' + escapeHtml(m.subject) + '</span>' +
          '<span class="message-item__excerpt">' + escapeHtml(m.message) + '</span>' +
        '</span>' +
      '</button>';
    }).join('');
  }

  function openMessage(id) {
    var message = state.messages.find(function (m) { return m.id === id; });
    if (!message) return;
    state.currentMessage = message;

    var body = $('#messageModalBody');
    if (body) {
      body.innerHTML =
        '<div class="message-view__meta">' +
          '<span class="message-item__avatar">' + escapeHtml(initials(message.name)) + '</span>' +
          '<div><strong>' + escapeHtml(message.name) + '</strong><br><span>' + escapeHtml(message.email) + '</span></div>' +
          '<span style="margin-left:auto;font-family:var(--font-mono);font-size:8.5px;color:var(--muted-2);">' + escapeHtml(formatDateTime(message.timestamp)) + '</span>' +
        '</div>' +
        '<h3 style="font-size:14px;margin-bottom:10px;">' + escapeHtml(message.subject) + '</h3>' +
        '<p class="message-view__text">' + escapeHtml(message.message) + '</p>' +
        '<p class="cell-sub" style="margin-top:16px;">IP : ' + escapeHtml(message.ip || '—') + '</p>';
    }

    var reply = $('#messageReplyBtn');
    if (reply) {
      reply.href = 'mailto:' + message.email + '?subject=' + encodeURIComponent('Re: ' + message.subject);
    }

    openModal('messageModal');

    if (!message.read) {
      api('/api/admin/messages/' + encodeURIComponent(message.id), { method: 'PATCH' }).then(function () {
        message.read = true;
        renderMessages();
        var unread = state.messages.filter(function (m) { return !m.read; }).length;
        updateUnreadBadge(unread);
      }).catch(function () { /* silencieux */ });
    }
  }

  function deleteMessage() {
    var message = state.currentMessage;
    if (!message) return;
    confirmAction('Supprimer ce message ?', 'Le message de ' + message.name + ' sera définitivement supprimé.', function () {
      return api('/api/admin/messages/' + encodeURIComponent(message.id), { method: 'DELETE' }).then(function () {
        state.messages = state.messages.filter(function (m) { return m.id !== message.id; });
        state.currentMessage = null;
        closeModal('messageModal');
        renderMessages();
        var count = $('#messagesCount');
        if (count) count.textContent = state.messages.length + ' message' + (state.messages.length > 1 ? 's' : '');
        toast('Message supprimé.');
      });
    });
  }

  /* ---------- Confirmation ---------- */

  function confirmAction(title, text, action) {
    var titleEl = $('#confirmTitle');
    var textEl = $('#confirmText');
    if (titleEl) titleEl.textContent = title;
    if (textEl) textEl.textContent = text;
    state.confirmAction = action;
    openModal('confirmModal');
  }

  function runConfirm() {
    if (typeof state.confirmAction !== 'function') return;
    var action = state.confirmAction;
    state.confirmAction = null;
    closeModal('confirmModal');
    Promise.resolve().then(action).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  /* ---------- Sécurité ---------- */

  function loadSession() {
    api('/api/admin/session').then(function (data) {
      var host = $('#sessionInfo');
      if (host) {
        host.innerHTML =
          row('Utilisateur', data.username) +
          row('Connecté depuis', formatDateTime(data.sessionCreatedAt)) +
          row('Adresse IP', data.sessionIp || '—') +
          row('Dernière connexion', data.lastLoginAt ? formatDateTime(data.lastLoginAt) : '—');
      }
      var notice = $('#passwordNotice');
      if (notice) notice.hidden = !data.mustChange;
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  function row(label, value) {
    return '<div class="session-row"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  }

  function submitPassword(event) {
    event.preventDefault();
    var current = $('#currentPassword');
    var next = $('#newPassword');
    var confirm = $('#confirmPassword');
    var message = $('#passwordMsg');
    var btn = $('#passwordSubmit');

    if (!current || !next || !confirm) return;

    function show(text, ok) {
      if (!message) return;
      message.style.display = 'block';
      message.style.color = ok ? '#c9f45b' : '#ff9d90';
      message.textContent = text;
    }

    if (next.value.length < 12) return show('Le nouveau mot de passe doit contenir au moins 12 caractères.', false);
    if (next.value !== confirm.value) return show('Les deux mots de passe ne correspondent pas.', false);

    if (btn) btn.disabled = true;

    api('/api/admin/password', {
      method: 'POST',
      body: { currentPassword: current.value, newPassword: next.value }
    }).then(function (result) {
      if (result.csrf) state.csrf = result.csrf;
      show('Mot de passe mis à jour avec succès.', true);
      toast('Mot de passe mis à jour.');
      var form = $('#passwordForm');
      if (form) form.reset();
      var notice = $('#passwordNotice');
      if (notice) notice.hidden = true;
    }).catch(function (err) {
      show(err.message, false);
    }).finally(function () {
      if (btn) btn.disabled = false;
    });
  }

  function logout() {
    api('/api/admin/logout', { method: 'POST' }).catch(function () { /* ignore */ }).finally(function () {
      window.location.href = '/admin';
    });
  }

  function logoutAll() {
    confirmAction('Révoquer les autres sessions ?', 'Toutes les autres sessions ouvertes sur ce compte seront fermées. La vôtre restera active.', function () {
      return api('/api/admin/logout-all', { method: 'POST' }).then(function () {
        toast('Les autres sessions ont été fermées.');
      });
    });
  }

  /* ---------- Écouteurs ---------- */

  function bind() {
    $$('.admin-nav button[data-view]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setView(btn.getAttribute('data-view'));
      });
    });

    $$('[data-goto]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        setView(link.getAttribute('data-goto'));
      });
    });

    var toggle = $('#sidebarToggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var sidebar = $('#adminSidebar');
        if (sidebar && sidebar.classList.contains('is-open')) closeSidebar();
        else openSidebar();
      });
    }

    var backdrop = $('#sidebarBackdrop');
    if (backdrop) backdrop.addEventListener('click', closeSidebar);

    $$('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeModal(btn.getAttribute('data-close'));
      });
    });

    $$('.modal').forEach(function (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeModal(modal.id);
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        $$('.modal.is-open').forEach(function (modal) { closeModal(modal.id); });
        closeSidebar();
      }
    });

    var logoutBtn = $('#logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    var logoutAllBtn = $('#logoutAllBtn');
    if (logoutAllBtn) logoutAllBtn.addEventListener('click', logoutAll);

    var confirmAccept = $('#confirmAccept');
    if (confirmAccept) confirmAccept.addEventListener('click', runConfirm);

    /* Visites */
    var search = $('#visitsSearch');
    if (search) {
      search.addEventListener('input', debounce(function () {
        state.visits.q = search.value.trim();
        state.visits.page = 1;
        loadVisits();
      }, 320));
    }

    var refresh = $('#visitsRefresh');
    if (refresh) refresh.addEventListener('click', loadVisits);

    var prev = $('#visitsPrev');
    if (prev) prev.addEventListener('click', function () {
      if (state.visits.page > 1) { state.visits.page -= 1; loadVisits(); }
    });

    var next = $('#visitsNext');
    if (next) next.addEventListener('click', function () {
      if (state.visits.page < state.visits.pages) { state.visits.page += 1; loadVisits(); }
    });

    /* Activité */
    var filter = $('#activityFilter');
    if (filter) filter.addEventListener('change', function () {
      state.activity.type = filter.value;
      state.activity.page = 1;
      loadActivity();
    });

    var activityRefresh = $('#activityRefresh');
    if (activityRefresh) activityRefresh.addEventListener('click', loadActivity);

    var activityPrev = $('#activityPrev');
    if (activityPrev) activityPrev.addEventListener('click', function () {
      if (state.activity.page > 1) { state.activity.page -= 1; loadActivity(); }
    });

    var activityNext = $('#activityNext');
    if (activityNext) activityNext.addEventListener('click', function () {
      if (state.activity.page < state.activity.pages) { state.activity.page += 1; loadActivity(); }
    });

    /* Projets */
    var newBtn = $('#newProjectBtn');
    if (newBtn) newBtn.addEventListener('click', function () {
      resetProjectForm();
      openModal('projectModal');
    });

    var projectsList = $('#projectsList');
    if (projectsList) {
      projectsList.addEventListener('click', function (e) {
        var editBtn = e.target.closest('[data-edit]');
        if (editBtn) {
          var project = state.projects.find(function (p) { return p.id === editBtn.getAttribute('data-edit'); });
          if (project) {
            fillProjectForm(project);
            openModal('projectModal');
          }
          return;
        }
        var deleteBtn = e.target.closest('[data-delete]');
        if (deleteBtn) {
          var target = state.projects.find(function (p) { return p.id === deleteBtn.getAttribute('data-delete'); });
          if (!target) return;
          confirmAction('Supprimer ce projet ?', '« ' + target.title + ' » sera retiré du site. Cette action est définitive.', function () {
            return api('/api/admin/projects/' + encodeURIComponent(target.id), { method: 'DELETE' }).then(function () {
              toast('Projet supprimé.');
              loadProjects();
            });
          });
        }
      });
    }

    var projectForm = $('#projectForm');
    if (projectForm) projectForm.addEventListener('submit', submitProject);

    var coverInput = $('#coverInput');
    if (coverInput) {
      coverInput.addEventListener('change', function () {
        var file = coverInput.files && coverInput.files[0];
        if (!file) return;
        if (['image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) === -1) {
          toast('Format non supporté. Utilisez JPEG, PNG ou WebP.', 'error');
          coverInput.value = '';
          return;
        }
        if (file.size > 3 * 1024 * 1024) {
          toast('Image trop lourde (3 Mo maximum).', 'error');
          coverInput.value = '';
          return;
        }
        readFileAsDataUrl(file).then(function (dataUrl) {
          state.coverData = dataUrl;
          setCoverPreview(dataUrl);
        }).catch(function (err) {
          toast(err.message, 'error');
        });
      });
    }

    /* Messages */
    var messagesList = $('#messagesList');
    if (messagesList) {
      messagesList.addEventListener('click', function (e) {
        var item = e.target.closest('[data-message]');
        if (item) openMessage(item.getAttribute('data-message'));
      });
    }

    var messagesRefresh = $('#messagesRefresh');
    if (messagesRefresh) messagesRefresh.addEventListener('click', loadMessages);

    var messageDelete = $('#messageDeleteBtn');
    if (messageDelete) messageDelete.addEventListener('click', deleteMessage);

    /* Sécurité */
    var passwordForm = $('#passwordForm');
    if (passwordForm) passwordForm.addEventListener('submit', submitPassword);

    /* Re-dessin des graphiques au redimensionnement */
    window.addEventListener('resize', debounce(function () {
      if (state.view === 'overview' && state.stats) {
        drawLineChart($('#visitsChart'), state.stats.daily);
        drawDonut($('#devicesChart'), state.stats.devices || []);
      }
    }, 220));
  }

  /* ---------- Démarrage ---------- */

  function boot() {
    bind();

    var hash = (window.location.hash || '').replace('#', '');
    var initial = VIEW_META[hash] ? hash : 'overview';
    setView(initial, false);

    setInterval(function () {
      if (document.hidden) return;
      if (state.view === 'overview') loadStats();
    }, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
