'use strict';

/* =========================================================
   RUBEN EBAH — Portfolio 2026
   Serveur Node.js sans dépendance externe
   - Site public + pages projets rendues côté serveur
   - API de suivi des visites
   - Back-office sécurisé (scrypt, sessions, CSRF, rate limit)
   ========================================================= */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const VIEWS_DIR = path.join(ROOT, 'views');
const IS_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
// Sur Vercel, le système de fichiers est en lecture seule sauf /tmp
const DATA_DIR = IS_VERCEL ? '/tmp/data' : path.join(ROOT, 'data');
const UPLOAD_DIR = IS_VERCEL ? '/tmp/uploads' : path.join(PUBLIC_DIR, 'uploads');

// Initialise les dossiers et les données sur Vercel (copie depuis le dépôt)
if (IS_VERCEL) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const srcData = path.join(ROOT, 'data');
    for (const name of ['projects', 'icons', 'admin']) {
      const src = path.join(srcData, name + '.json');
      const dst = path.join(DATA_DIR, name + '.json');
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
    }
  } catch (err) { console.error('[vercel] init data:', err.message); }
}

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SECURE_COOKIES = process.env.SECURE_COOKIES === '1';
const SESSION_TTL = 8 * 60 * 60 * 1000;
const DEFAULT_USER = process.env.ADMIN_USER || 'ruben';
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'RubenEbah!2026';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');

const CATEGORIES = {
  web: 'Web',
  application: 'Application',
  design: 'Design',
  motion: 'Motion'
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

/* ---------- Utilitaires ---------- */

function iso() { return new Date().toISOString(); }
function uid(prefix) { return prefix + crypto.randomBytes(8).toString('hex'); }
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function truncate(str, n) { str = String(str || ''); return str.length > n ? str.slice(0, n) + '…' : str; }
function normalizeText(str) {
  return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function slugify(str) {
  return normalizeText(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'projet';
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------- Stockage JSON ---------- */

const FILES = ['projects', 'visits', 'actions', 'messages', 'admin'];
const store = {};
const dirty = new Set();

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadStore() {
  for (const name of FILES) {
    const file = path.join(DATA_DIR, name + '.json');
    try {
      store[name] = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      store[name] = name === 'admin' ? null : [];
    }
  }
  if (!Array.isArray(store.projects)) store.projects = [];
  if (!Array.isArray(store.visits)) store.visits = [];
  if (!Array.isArray(store.actions)) store.actions = [];
  if (!Array.isArray(store.messages)) store.messages = [];
}

function saveNow(name) {
  try {
    const file = path.join(DATA_DIR, name + '.json');
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store[name], null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('[data] écriture impossible pour', name, err.message);
  }
}

function markDirty(name) { dirty.add(name); }

setInterval(() => {
  for (const name of Array.from(dirty)) {
    dirty.delete(name);
    saveNow(name);
  }
}, 2000).unref();

function flushAll() {
  for (const name of Array.from(dirty)) { dirty.delete(name); saveNow(name); }
}

process.on('SIGINT', () => { flushAll(); process.exit(0); });
process.on('SIGTERM', () => { flushAll(); process.exit(0); });

/* ---------- Mot de passe & admin ---------- */

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, s, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt: s, hash };
}

function verifyPassword(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  try {
    const hash = crypto.scryptSync(password, record.salt, 64, { N: 16384, r: 8, p: 1 });
    const stored = Buffer.from(record.hash, 'hex');
    return hash.length === stored.length && crypto.timingSafeEqual(hash, stored);
  } catch (err) { return false; }
}

function ensureAdmin() {
  if (!store.admin || !store.admin.hash) {
    const { salt, hash } = hashPassword(DEFAULT_PASSWORD);
    store.admin = {
      username: DEFAULT_USER,
      salt,
      hash,
      mustChange: true,
      createdAt: iso(),
      updatedAt: iso(),
      lastLoginAt: null
    };
    markDirty('admin');
    saveNow('admin');
    console.log('');
    console.log('  ┌──────────────────────────────────────────────┐');
    console.log('  │  ESPACE ADMINISTRATEUR — identifiants initiaux│');
    console.log('  ├──────────────────────────────────────────────┤');
    console.log('  │  Utilisateur : ' + DEFAULT_USER.padEnd(30) + '│');
    console.log('  │  Mot de passe : ' + DEFAULT_PASSWORD.padEnd(29) + '│');
    console.log('  └──────────────────────────────────────────────┘');
    console.log('  Changez ce mot de passe dès la première connexion.');
    console.log('');
  }
}

loadStore();
ensureAdmin();

/* ---------- Sessions ---------- */

const sessions = new Map();

function createSession(username, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  const session = {
    token,
    username,
    csrf,
    createdAt: Date.now(),
    expires: Date.now() + SESSION_TTL,
    ip: maskIp(clientIp(req)),
    ua: truncate(req.headers['user-agent'] || '', 200)
  };
  sessions.set(token, session);
  return session;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.pf_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) { sessions.delete(token); return null; }
  return session;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) if (s.expires < now) sessions.delete(token);
  const cutoff = now - 24 * 60 * 60 * 1000;
  for (const [key, v] of loginAttempts) if (v.start < cutoff && (!v.until || v.until < now)) loginAttempts.delete(key);
  for (const [key, v] of rateBuckets) if (v.start < now - 10 * 60 * 1000) rateBuckets.delete(key);
}, 10 * 60 * 1000).unref();

/* ---------- Cookies ---------- */

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setCookie(res, name, value, maxAge, sameSite, httpOnly) {
  let cookie = name + '=' + encodeURIComponent(value) + '; Path=/; Max-Age=' + Math.floor(maxAge) + '; SameSite=' + (sameSite || 'Lax');
  if (httpOnly !== false) cookie += '; HttpOnly';
  if (SECURE_COOKIES) cookie += '; Secure';
  const prev = res.getHeader('Set-Cookie');
  if (prev) res.setHeader('Set-Cookie', [].concat(prev, cookie));
  else res.setHeader('Set-Cookie', cookie);
}

function clearCookie(res, name) {
  setCookie(res, name, '', 0, 'Strict');
}

function getVisitorId(req, res) {
  const cookies = parseCookies(req);
  let vid = cookies.pf_vid;
  if (!vid || !/^[a-f0-9]{32}$/.test(vid)) {
    vid = crypto.randomBytes(16).toString('hex');
    setCookie(res, 'pf_vid', vid, 365 * 24 * 60 * 60, 'Lax', true);
  }
  return vid;
}

/* ---------- IP & user agent ---------- */

function clientIp(req) {
  let ip = '';
  if (TRUST_PROXY && req.headers['x-forwarded-for']) {
    ip = String(req.headers['x-forwarded-for']).split(',')[0].trim();
  }
  if (!ip) ip = req.socket.remoteAddress || '';
  return ip.replace(/^::ffff:/, '');
}

function maskIp(ip) {
  if (!ip) return '—';
  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    return parts.slice(0, 4).join(':') + ':…';
  }
  const p = ip.split('.');
  if (p.length === 4) return p[0] + '.' + p[1] + '.' + p[2] + '.x';
  return ip;
}

function parseUA(ua) {
  ua = String(ua || '');
  let browser = 'Autre';
  let os = 'Autre';
  let device = 'Ordinateur';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  else if (/curl|wget|bot|spider/i.test(ua)) browser = 'Robot';

  if (/Windows/.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  if (/iPad|Tablet/i.test(ua)) device = 'Tablette';
  else if (/Mobi|iPhone|Android.*Mobile/i.test(ua)) device = 'Mobile';
  if (browser === 'Robot') device = 'Robot';
  return { browser, os, device };
}

/* ---------- Rate limiting ---------- */

const rateBuckets = new Map();
const loginAttempts = new Map();

function limited(key, max, windowMs) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { count: 0, start: now };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count > max;
}

/* ---------- Actions ---------- */

function logAction(type, label, detail, req, actor) {
  store.actions.unshift({
    id: uid('a_'),
    timestamp: iso(),
    type,
    label,
    detail: truncate(detail || '', 300),
    actor: actor || 'admin',
    ip: req ? maskIp(clientIp(req)) : '',
    ua: req ? truncate(req.headers['user-agent'] || '', 160) : ''
  });
  if (store.actions.length > 3000) store.actions.length = 3000;
  markDirty('actions');
}

/* ---------- Visites ---------- */

function recordVisit(req, res, data) {
  const visitorId = getVisitorId(req, res);
  const ua = String(req.headers['user-agent'] || '');
  const parsed = parseUA(ua);
  const now = Date.now();

  const duplicate = store.visits.find(v =>
    v.visitorId === visitorId &&
    v.path === data.path &&
    now - new Date(v.timestamp).getTime() < 3000
  );
  if (duplicate) return duplicate;

  const visit = {
    id: uid('v_'),
    timestamp: new Date(now).toISOString(),
    visitorId,
    path: truncate(data.path || '/', 300),
    page: truncate(data.page || 'home', 60),
    referrer: truncate(data.referrer || '', 300),
    ip: maskIp(clientIp(req)),
    ua: truncate(ua, 300),
    device: parsed.device,
    browser: parsed.browser,
    os: parsed.os,
    screen: truncate(data.screen || '', 20),
    viewport: truncate(data.viewport || '', 20),
    language: truncate(data.language || '', 20),
    timezone: truncate(data.timezone || '', 60),
    duration: 0,
    scroll: 0,
    lastSeen: new Date(now).toISOString()
  };
  store.visits.unshift(visit);
  if (store.visits.length > 6000) store.visits.length = 6000;
  markDirty('visits');
  return visit;
}

function updateVisit(data) {
  if (!data.visitId) return;
  const visit = store.visits.find(v => v.id === data.visitId);
  if (!visit) return;
  const duration = Math.max(0, Math.min(7200, Number(data.meta && data.meta.duration) || 0));
  const scroll = Math.max(0, Math.min(100, Number(data.meta && data.meta.scroll) || 0));
  visit.duration = Math.max(visit.duration || 0, Math.round(duration));
  visit.scroll = Math.max(visit.scroll || 0, Math.round(scroll));
  visit.lastSeen = iso();
  markDirty('visits');
}

/* ---------- Validation projets ---------- */

function str(value, min, max, name) {
  if (typeof value !== 'string') throw new HttpError(400, name + ' est invalide.');
  const s = value.trim();
  if (s.length < min || s.length > max) throw new HttpError(400, name + ' doit contenir entre ' + min + ' et ' + max + ' caractères.');
  return s;
}

function optionalUrl(value, name) {
  if (!value) return '';
  const s = String(value).trim();
  if (!/^https:\/\/[^\s]+$/i.test(s)) throw new HttpError(400, name + ' doit être une URL https valide.');
  if (s.length > 300) throw new HttpError(400, name + ' est trop long.');
  return s;
}

function listOfStrings(value, maxItems, maxLen, name) {
  if (value == null || value === '') return [];
  const arr = Array.isArray(value) ? value : String(value).split(',');
  const out = [];
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (!s) continue;
    if (s.length > maxLen) throw new HttpError(400, name + ' : un élément dépasse ' + maxLen + ' caractères.');
    if (!out.includes(s)) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function saveDataImage(dataUrl) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!match) throw new HttpError(400, 'Format d\'image non supporté (JPEG, PNG ou WebP).');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 3 * 1024 * 1024) throw new HttpError(413, 'L\'image dépasse 3 Mo.');
  const valid =
    (ext === 'jpg' && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) ||
    (ext === 'png' && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) ||
    (ext === 'webp' && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP');
  if (!valid) throw new HttpError(400, 'Le contenu du fichier ne correspond pas à une image valide.');
  const name = 'cover-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return '/uploads/' + name;
}

function normalizeCover(input) {
  if (!input) return '/assets/img/cover-default.svg';
  if (typeof input !== 'string') throw new HttpError(400, 'Couverture invalide.');
  if (/^data:image\//.test(input)) return saveDataImage(input);
  if (/^\/assets\/img\/[a-z0-9._-]+\.(svg|jpg|jpeg|png|webp)$/i.test(input)) return input;
  if (/^\/uploads\/[a-z0-9._-]+\.(jpg|jpeg|png|webp)$/i.test(input)) return input;
  throw new HttpError(400, 'Chemin de couverture invalide.');
}

function uniqueSlug(base, excludeId) {
  let slug = slugify(base);
  let candidate = slug;
  let i = 2;
  while (store.projects.some(p => p.slug === candidate && p.id !== excludeId)) {
    candidate = slug + '-' + i++;
  }
  return candidate;
}

function buildProject(body, existing) {
  const title = str(body.title, 2, 120, 'Le titre');
  const category = CATEGORIES[body.category] ? body.category : 'web';
  const year = String(body.year || '').trim();
  if (!/^(20[2-3][0-9])$/.test(year)) throw new HttpError(400, 'L\'année doit être comprise entre 2020 et 2039.');
  const excerpt = str(body.excerpt, 10, 300, 'Le résumé');
  const description = str(body.description, 10, 12000, 'La description');
  const role = str(body.role || 'Développeur', 2, 100, 'Le rôle');
  const client = str(body.client || 'Projet personnel', 2, 140, 'Le client');
  const duration = str(body.duration || '—', 1, 60, 'La durée');
  const cover = normalizeCover(body.cover);
  const tags = listOfStrings(body.tags, 8, 30, 'Les tags');
  const stack = listOfStrings(body.stack, 12, 30, 'La stack');
  const liveUrl = optionalUrl(body.liveUrl, 'Le lien du site');
  const repoUrl = optionalUrl(body.repoUrl, 'Le lien du dépôt');
  let order = Number(body.order);
  if (!Number.isFinite(order)) order = store.projects.length + 1;
  order = Math.max(0, Math.min(999, Math.round(order)));
  const featured = Boolean(body.featured);

  if (featured) {
    store.projects.forEach(p => { if (!existing || p.id !== existing.id) p.featured = false; });
  }

  return {
    id: existing ? existing.id : uid('p_'),
    slug: existing ? existing.slug : uniqueSlug(title),
    title,
    category,
    year,
    role,
    client,
    duration,
    excerpt,
    description,
    tags,
    stack,
    cover,
    liveUrl,
    repoUrl,
    featured,
    order,
    createdAt: existing ? existing.createdAt : iso(),
    updatedAt: iso()
  };
}

/* ---------- Rendu HTML ---------- */

function layoutReplace(template, values) {
  let html = template;
  for (const [key, value] of Object.entries(values)) {
    html = html.split('{{' + key + '}}').join(value == null ? '' : String(value));
  }
  return html;
}

function projectCardsHtml() {
  const projects = store.projects.slice().sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
  if (!projects.length) {
    return '<p class="section-desc" style="grid-column:1/-1;">Les projets seront bientôt disponibles.</p>';
  }
  return projects.map(p => {
    const category = CATEGORIES[p.category] || 'Projet';
    return '<a class="project-card' + (p.featured ? ' project-card--featured' : '') + '" href="/projet/' + encodeURIComponent(p.slug) + '" data-category="' + esc(p.category) + '">' +
      '<div class="project-card__media">' +
        '<img src="' + esc(p.cover) + '" alt="Aperçu du projet ' + esc(p.title) + '" loading="lazy" width="1600" height="1000">' +
        '<div class="project-card__badges">' +
          (p.featured ? '<span class="badge badge--accent">À la une</span>' : '') +
          '<span class="badge">' + esc(category) + '</span>' +
        '</div>' +
        '<span class="project-card__arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></span>' +
      '</div>' +
      '<div class="project-card__body">' +
        '<div class="project-card__meta"><span>' + esc(category) + '</span><span>' + esc(p.year) + '</span></div>' +
        '<h3>' + esc(p.title) + '</h3>' +
        '<p>' + esc(p.excerpt) + '</p>' +
        '<div class="project-card__stack">' + p.stack.slice(0, 4).map(s => '<span class="tag">' + esc(s) + '</span>').join('') + '</div>' +
      '</div>' +
    '</a>';
  }).join('\n');
}

function projectFiltersHtml() {
  const present = new Set(store.projects.map(p => p.category));
  return Object.entries(CATEGORIES)
    .filter(([key]) => present.has(key))
    .map(([key, label]) => '<button class="filter" data-filter="' + key + '" type="button">' + esc(label) + '</button>')
    .join('');
}

function renderContent(text) {
  const blocks = String(text || '').split(/\n{2,}/);
  return blocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('## ')) return '<h2>' + inline(trimmed.slice(3)) + '</h2>';
    const lines = trimmed.split('\n');
    if (lines.every(l => l.trim().startsWith('- '))) {
      return '<ul>' + lines.map(l => '<li>' + inline(l.trim().slice(2)) + '</li>').join('') + '</ul>';
    }
    return '<p>' + inline(lines.join('\n')).replace(/\n/g, '<br>') + '</p>';
  }).join('\n');
}

function inline(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function serveHome(req, res, nonce) {
  const file = path.join(PUBLIC_DIR, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  html = html.split('<!--PROJECTS_GRID-->').join(projectCardsHtml());
  html = html.split('<!--PROJECTS_FILTERS-->').join(projectFiltersHtml());
  html = html.split('__CSP_NONCE__').join(nonce);
  getVisitorId(req, res);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache'
  });
  res.end(req.method === 'HEAD' ? undefined : html);
}

function renderProjectPage(project, nonce) {
  const template = fs.readFileSync(path.join(VIEWS_DIR, 'project.html'), 'utf8');
  const sorted = store.projects.slice().sort((a, b) => a.order - b.order);
  const index = sorted.findIndex(p => p.id === project.id);
  const prev = index > 0 ? sorted[index - 1] : null;
  const next = index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : null;

  const stackTags = project.stack.map(s => '<span class="tag">' + esc(s) + '</span>').join('');
  const tags = project.tags.map(s => '<span class="tag">' + esc(s) + '</span>').join('');
  const liveBtn = project.liveUrl
    ? '<a class="btn" href="' + esc(project.liveUrl) + '" target="_blank" rel="noopener noreferrer">Voir le site en ligne <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></a>'
    : '';
  const repoBtn = project.repoUrl
    ? '<a class="btn btn--ghost" href="' + esc(project.repoUrl) + '" target="_blank" rel="noopener noreferrer">Code source <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></a>'
    : '';
  const prevLink = prev
    ? '<a href="/projet/' + encodeURIComponent(prev.slug) + '"><span>Projet précédent</span><strong>' + esc(prev.title) + '</strong></a>'
    : '<a href="/#projets"><span>Retour</span><strong>Tous les projets</strong></a>';
  const nextLink = next
    ? '<a href="/projet/' + encodeURIComponent(next.slug) + '"><span>Projet suivant</span><strong>' + esc(next.title) + '</strong></a>'
    : '<a href="/#contact"><span>Et ensuite</span><strong>Travaillons ensemble</strong></a>';

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: project.title,
    description: project.excerpt,
    dateCreated: project.year,
    creator: { '@type': 'Person', name: 'Aimé Kouassi Ruben EBAH' },
    keywords: project.tags.join(', ')
  }).replace(/</g, '\\u003c');

  return layoutReplace(template, {
    TITLE: esc(project.title),
    META_DESC: esc(project.excerpt),
    CATEGORY: esc(CATEGORIES[project.category] || 'Projet'),
    YEAR: esc(project.year),
    ROLE: esc(project.role),
    CLIENT: esc(project.client),
    DURATION: esc(project.duration),
    EXCERPT: esc(project.excerpt),
    COVER: esc(project.cover),
    CONTENT: renderContent(project.description),
    STACK: stackTags,
    TAGS: tags,
    LIVE_BTN: liveBtn,
    REPO_BTN: repoBtn,
    PREV_LINK: prevLink,
    NEXT_LINK: nextLink,
    NONCE: nonce,
    JSONLD: jsonLd,
    YEAR_NOW: String(new Date().getFullYear())
  });
}

function serveProject(req, res, slug, nonce) {
  const project = store.projects.find(p => p.slug === slug);
  if (!project) return serve404(req, res, nonce);
  const html = renderProjectPage(project, nonce);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : html);
}

function serve404(req, res, nonce) {
  const template = fs.readFileSync(path.join(VIEWS_DIR, '404.html'), 'utf8');
  const html = layoutReplace(template, { NONCE: nonce, YEAR_NOW: String(new Date().getFullYear()) });
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : html);
}

/* ---------- Sécurité HTTP ---------- */

function setSecurityHeaders(res, nonce) {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'nonce-" + nonce + "'",
    "connect-src 'self'",
    "media-src 'self'",
    "manifest-src 'self'"
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-XSS-Protection', '0');
  if (SECURE_COOKIES) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
}

/* ---------- Corps de requête ---------- */

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(new HttpError(413, 'Requête trop volumineuse.'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on('error', err => { if (!failed) { failed = true; reject(err); } });
  });
}

async function readJson(req, limit) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (ct && ct.indexOf('application/json') === -1) {
    throw new HttpError(415, 'Type de contenu non supporté. Utilisez application/json.');
  }
  const raw = await readBody(req, limit || 100 * 1024);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch (err) {
    throw new HttpError(400, 'Corps JSON invalide.');
  }
}

/* ---------- Réponses ---------- */

function sendJson(res, status, data, headers) {
  const body = JSON.stringify(data);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, headers || {}));
  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(html);
}

/* ---------- Auth admin ---------- */

function requireAdmin(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { error: 'Session expirée. Reconnectez-vous.' });
    return null;
  }
  return session;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.host === req.headers.host;
  } catch (err) { return false; }
}

function checkCsrf(req, session) {
  if (!sameOrigin(req)) return false;
  const token = req.headers['x-csrf-token'];
  if (!token || typeof token !== 'string') return false;
  return safeEqual(token, session.csrf);
}

function checkOrigin(req) {
  if (!sameOrigin(req)) throw new HttpError(403, 'Origine de la requête non autorisée.');
}

/* ---------- Statistiques ---------- */

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function localDate(d) {
  const x = new Date(d);
  const pad = n => String(n).padStart(2, '0');
  return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
}

function computeStats() {
  const visits = store.visits;
  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
  const total = visits.length;
  const unique = new Set(visits.map(v => v.visitorId)).size;
  const today = visits.filter(v => new Date(v.timestamp).getTime() >= todayStart).length;
  const week = visits.filter(v => new Date(v.timestamp).getTime() >= weekStart).length;
  const durations = visits.filter(v => v.duration > 0).map(v => v.duration);
  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  const countBy = (arr, fn) => {
    const map = new Map();
    arr.forEach(item => {
      const key = fn(item);
      if (key == null || key === '') return;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  };

  const pageLabel = path => {
    if (!path || path === '/') return 'Accueil';
    if (path.indexOf('/projet/') === 0) {
      const slug = path.slice('/projet/'.length);
      const project = store.projects.find(p => p.slug === slug);
      return project ? project.title : decodeURIComponent(slug).replace(/-/g, ' ');
    }
    return path;
  };

  const topPages = countBy(visits, v => v.path).slice(0, 6).map(([label, count]) => ({ label: pageLabel(label), count }));
  const topProjects = countBy(visits.filter(v => v.path.indexOf('/projet/') === 0), v => v.path).slice(0, 5).map(([label, count]) => ({ label: pageLabel(label), count }));
  const devices = countBy(visits, v => v.device).map(([label, count]) => ({ label, count }));
  const browsers = countBy(visits, v => v.browser).slice(0, 5).map(([label, count]) => ({ label, count }));
  const referrers = countBy(visits, v => {
    if (!v.referrer) return 'Accès direct';
    try { return new URL(v.referrer).hostname.replace(/^www\./, ''); } catch (err) { return 'Accès direct'; }
  }).slice(0, 5).map(([label, count]) => ({ label, count }));

  const daily = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(todayStart);
    day.setDate(day.getDate() - i);
    const start = day.getTime();
    const end = start + 24 * 60 * 60 * 1000;
    const dayVisits = visits.filter(v => {
      const t = new Date(v.timestamp).getTime();
      return t >= start && t < end;
    });
    daily.push({
      date: localDate(day),
      label: day.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
      views: dayVisits.length,
      visitors: new Set(dayVisits.map(v => v.visitorId)).size
    });
  }

  const unread = store.messages.filter(m => !m.read).length;
  const lastLogin = store.actions.find(a => a.type === 'auth.login');

  return {
    total, unique, today, week, avgDuration,
    actions: store.actions.length,
    messages: store.messages.length,
    unread,
    projects: store.projects.length,
    topPages, topProjects, devices, browsers, referrers, daily,
    lastLogin: lastLogin || null,
    recentActions: store.actions.slice(0, 6)
  };
}

/* ---------- Export CSV ---------- */

function csvCell(value) {
  const s = String(value == null ? '' : value);
  return '"' + s.replace(/"/g, '""') + '"';
}

function visitsCsv(rows) {
  const head = ['Date', 'Page', 'Chemin', 'Appareil', 'Navigateur', 'Système', 'Référent', 'IP', 'Durée (s)', 'Scroll (%)', 'Écran', 'Langue'];
  const lines = [head.map(csvCell).join(',')];
  rows.forEach(v => {
    lines.push([
      v.timestamp, v.page, v.path, v.device, v.browser, v.os, v.referrer || 'Accès direct',
      v.ip, v.duration || 0, v.scroll || 0, v.screen, v.language
    ].map(csvCell).join(','));
  });
  return '\ufeff' + lines.join('\r\n');
}

/* ---------- Servir les fichiers statiques ---------- */

function serveStatic(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch (err) { return false; }
  const rel = decoded.replace(/^\/+/, '');
  if (!rel || rel.split('/').some(part => part.startsWith('.') || part === '..')) return false;
  const filePath = path.resolve(PUBLIC_DIR, rel);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) return false;
  let realPath;
  try { realPath = fs.realpathSync(filePath); } catch (err) { return false; }
  if (realPath !== PUBLIC_DIR && !realPath.startsWith(PUBLIC_DIR + path.sep)) return false;
  let stat;
  try { stat = fs.statSync(realPath); } catch (err) { return false; }
  if (!stat.isFile()) return false;
  // Bloque les fichiers cachés et les extensions exécutables
  if (path.basename(realPath).startsWith('.')) return false;

  const ext = path.extname(realPath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const isAsset = /^\/(assets|uploads|favicon)/.test(decoded);
  const headers = {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': isAsset ? 'public, max-age=604800' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff'
  };
  if (ext === '.pdf') headers['Content-Disposition'] = 'inline; filename="CV-Ruben-EBAH.pdf"';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(realPath).pipe(res);
  return true;
}

/* ---------- Routes API ---------- */

async function handleTrack(req, res) {
  const ip = clientIp(req);
  if (limited('track:' + ip, 240, 5 * 60 * 1000)) return sendJson(res, 429, { error: 'Trop de requêtes.' });
  const data = await readJson(req, 20 * 1024);
  const event = String(data.event || '');
  if (!['page_view', 'heartbeat', 'page_exit', 'cert_view', 'contact_submit'].includes(event)) {
    return sendJson(res, 400, { error: 'Événement inconnu.' });
  }

  if (event === 'page_view') {
    const visit = recordVisit(req, res, {
      path: String(data.path || '/').slice(0, 300),
      page: String(data.page || 'home').slice(0, 60),
      referrer: String(data.referrer || '').slice(0, 300),
      screen: String(data.screen || '').slice(0, 20),
      viewport: String(data.viewport || '').slice(0, 20),
      language: String(data.language || '').slice(0, 20),
      timezone: String(data.timezone || '').slice(0, 60)
    });
    return sendJson(res, 200, { ok: true, visitId: visit.id });
  }

  updateVisit(data);
  return sendJson(res, 200, { ok: true });
}

async function handleContact(req, res) {
  const ip = clientIp(req);
  if (limited('contact:' + ip, 5, 60 * 60 * 1000)) {
    return sendJson(res, 429, { error: 'Trop de messages envoyés. Réessayez plus tard.' });
  }
  const data = await readJson(req, 32 * 1024);
  if (data.website) return sendJson(res, 200, { ok: true });

  let name, email, subject, message;
  try {
    name = str(data.name, 2, 80, 'Le nom');
    email = str(data.email, 5, 120, 'L\'email');
    subject = str(data.subject, 2, 140, 'Le sujet');
    message = str(data.message, 5, 4000, 'Le message');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'L\'adresse email est invalide.');
  } catch (err) {
    return sendJson(res, err.status || 400, { error: err.message });
  }

  const entry = {
    id: uid('m_'),
    timestamp: iso(),
    name, email, subject, message,
    ip: maskIp(ip),
    ua: truncate(req.headers['user-agent'] || '', 200),
    read: false
  };
  store.messages.unshift(entry);
  if (store.messages.length > 500) store.messages.length = 500;
  markDirty('messages');
  logAction('message.received', 'Nouveau message de ' + name, subject, req, 'visiteur');
  return sendJson(res, 200, { ok: true });
}

async function handleLogin(req, res) {
  checkOrigin(req);
  const ip = clientIp(req);
  const now = Date.now();
  const attempt = loginAttempts.get(ip);
  if (attempt && attempt.until && attempt.until > now) {
    const retry = Math.ceil((attempt.until - now) / 1000);
    return sendJson(res, 429, { error: 'Trop de tentatives. Réessayez dans ' + Math.ceil(retry / 60) + ' minute(s).', retryAfter: retry });
  }

  const data = await readJson(req, 8 * 1024);
  const username = String(data.username || '').slice(0, 80);
  const password = String(data.password || '').slice(0, 200);

  const admin = store.admin;
  const userOk = safeEqual(username, admin.username);
  const passOk = verifyPassword(password, admin);

  await new Promise(r => setTimeout(r, 320));

  if (!userOk || !passOk) {
    const current = loginAttempts.get(ip) || { fails: 0, start: now, until: 0 };
    if (now - current.start > 15 * 60 * 1000) { current.fails = 0; current.start = now; }
    current.fails += 1;
    if (current.fails >= 5) {
      current.until = now + 15 * 60 * 1000;
      logAction('auth.locked', 'Compte temporairement verrouillé', '5 échecs depuis ' + maskIp(ip), req, 'système');
    }
    loginAttempts.set(ip, current);
    logAction('auth.failed', 'Tentative de connexion échouée', 'Utilisateur : ' + truncate(username, 40), req, 'système');
    return sendJson(res, 401, { error: 'Identifiant ou mot de passe incorrect.' });
  }

  loginAttempts.delete(ip);
  // Révoque les sessions précédentes du même utilisateur (anti-fixation)
  for (const [token, s] of sessions) {
    if (s.username === admin.username) sessions.delete(token);
  }
  const session = createSession(admin.username, req);
  setCookie(res, 'pf_session', session.token, SESSION_TTL / 1000, 'Strict', true);
  admin.lastLoginAt = iso();
  markDirty('admin');
  logAction('auth.login', 'Connexion administrateur', 'Session ouverte depuis ' + maskIp(ip), req, 'admin');
  return sendJson(res, 200, {
    ok: true,
    csrf: session.csrf,
    username: admin.username,
    mustChange: Boolean(admin.mustChange)
  });
}

function handleLogout(req, res) {
  const session = getSession(req);
  if (session) {
    sessions.delete(session.token);
    logAction('auth.logout', 'Déconnexion administrateur', '', req, 'admin');
  }
  clearCookie(res, 'pf_session');
  return sendJson(res, 200, { ok: true });
}

function handleLogoutAll(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  if (!checkCsrf(req, session)) return sendJson(res, 403, { error: 'Jeton CSRF invalide.' });
  for (const [token] of sessions) if (token !== session.token) sessions.delete(token);
  logAction('auth.logout_all', 'Sessions révoquées', 'Toutes les autres sessions ont été fermées', req, 'admin');
  return sendJson(res, 200, { ok: true });
}

async function handlePassword(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  if (!checkCsrf(req, session)) return sendJson(res, 403, { error: 'Jeton CSRF invalide.' });
  const data = await readJson(req, 8 * 1024);
  const current = String(data.currentPassword || '');
  const next = String(data.newPassword || '');
  if (!verifyPassword(current, store.admin)) {
    logAction('auth.password_failed', 'Échec de changement de mot de passe', '', req, 'admin');
    return sendJson(res, 400, { error: 'Le mot de passe actuel est incorrect.' });
  }
  if (next.length < 12 || next.length > 128) return sendJson(res, 400, { error: 'Le nouveau mot de passe doit contenir au moins 12 caractères.' });
  if (!/[a-z]/.test(next) || !/[A-Z]/.test(next) || !/[0-9]/.test(next) || !/[^A-Za-z0-9]/.test(next)) {
    return sendJson(res, 400, { error: 'Utilisez au moins une minuscule, une majuscule, un chiffre et un caractère spécial.' });
  }
  if (next === current) return sendJson(res, 400, { error: 'Le nouveau mot de passe doit être différent de l\'actuel.' });
  const { salt, hash } = hashPassword(next);
  store.admin.salt = salt;
  store.admin.hash = hash;
  store.admin.mustChange = false;
  store.admin.updatedAt = iso();
  markDirty('admin');
  // Révoque toutes les autres sessions après un changement de mot de passe
  for (const [token] of sessions) {
    if (token !== session.token) sessions.delete(token);
  }
  session.csrf = crypto.randomBytes(24).toString('hex');
  logAction('auth.password_changed', 'Mot de passe modifié', 'Le mot de passe administrateur a été changé et les autres sessions ont été révoquées', req, 'admin');
  return sendJson(res, 200, { ok: true, csrf: session.csrf });
}

function handleSessionInfo(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  return sendJson(res, 200, {
    authenticated: true,
    username: store.admin.username,
    mustChange: Boolean(store.admin.mustChange),
    csrf: session.csrf,
    lastLoginAt: store.admin.lastLoginAt,
    sessionCreatedAt: new Date(session.createdAt).toISOString(),
    sessionIp: session.ip
  });
}

function handleStats(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  return sendJson(res, 200, computeStats());
}

function handleVisits(req, res, url) {
  const session = requireAdmin(req, res);
  if (!session) return;
  const q = String(url.searchParams.get('q') || '').toLowerCase().trim();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(5, parseInt(url.searchParams.get('limit') || '25', 10) || 25));

  let rows = store.visits;
  if (q) {
    rows = rows.filter(v => [v.path, v.page, v.ip, v.device, v.browser, v.os, v.referrer, v.language]
      .some(field => String(field || '').toLowerCase().includes(q)));
  }
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const items = rows.slice((page - 1) * limit, page * limit);
  return sendJson(res, 200, { items, total, page, pages, limit });
}

function handleVisitsExport(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  const csv = visitsCsv(store.visits);
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="visites-portfolio-' + new Date().toISOString().slice(0, 10) + '.csv"',
    'Cache-Control': 'no-store'
  });
  res.end(csv);
}

function handleActions(req, res, url) {
  const session = requireAdmin(req, res);
  if (!session) return;
  const type = String(url.searchParams.get('type') || '').trim();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(5, parseInt(url.searchParams.get('limit') || '30', 10) || 30));
  let rows = store.actions;
  if (type && type !== 'all') {
    rows = rows.filter(a => a.type === type || a.type.startsWith(type + '.'));
  }
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  return sendJson(res, 200, {
    items: rows.slice((page - 1) * limit, page * limit),
    total, page, pages, limit
  });
}

function handleProjects(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  return sendJson(res, 200, {
    items: store.projects.slice().sort((a, b) => a.order - b.order),
    categories: CATEGORIES
  });
}

async function handleCreateProject(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  if (!checkCsrf(req, session)) return sendJson(res, 403, { error: 'Jeton CSRF invalide.' });
  const body = await readJson(req, 6 * 1024 * 1024);
  const project = buildProject(body, null);
  store.projects.push(project);
  markDirty('projects');
  logAction('project.created', 'Projet ajouté', project.title, req, 'admin');
  return sendJson(res, 201, { ok: true, project });
}

async function handleUpdateProject(req, res, id) {
  const session = requireAdmin(req, res);
  if (!session) return;
  if (!checkCsrf(req, session)) return sendJson(res, 403, { error: 'Jeton CSRF invalide.' });
  const existing = store.projects.find(p => p.id === id);
  if (!existing) return sendJson(res, 404, { error: 'Projet introuvable.' });
  const body = await readJson(req, 6 * 1024 * 1024);
  const project = buildProject(body, existing);
  const index = store.projects.findIndex(p => p.id === id);
  store.projects[index] = project;
  markDirty('projects');
  logAction('project.updated', 'Projet modifié', project.title, req, 'admin');
  return sendJson(res, 200, { ok: true, project });
}

function handleDeleteProject(req, res, id) {
  const session = requireAdmin(req, res);
  if (!session) return;
  if (!checkCsrf(req, session)) return sendJson(res, 403, { error: 'Jeton CSRF invalide.' });
  const index = store.projects.findIndex(p => p.id === id);
  if (index < 0) return sendJson(res, 404, { error: 'Projet introuvable.' });
  const project = store.projects[index];
  store.projects.splice(index, 1);
  markDirty('projects');
  if (project.cover && project.cover.startsWith('/uploads/')) {
    const file = path.join(UPLOAD_DIR, path.basename(project.cover));
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (err) { /* ignore */ }
  }
  logAction('project.deleted', 'Projet supprimé', project.title, req, 'admin');
  return sendJson(res, 200, { ok: true });
}

function handleMessages(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  return sendJson(res, 200, { items: store.messages });
}

function handleMessageUpdate(req, res, id) {
  const session = requireAdmin(req, res);
  if (!session) return;
  if (!checkCsrf(req, session)) return sendJson(res, 403, { error: 'Jeton CSRF invalide.' });
  const message = store.messages.find(m => m.id === id);
  if (!message) return sendJson(res, 404, { error: 'Message introuvable.' });
  message.read = true;
  markDirty('messages');
  logAction('message.read', 'Message ouvert', 'Message de ' + message.name, req, 'admin');
  return sendJson(res, 200, { ok: true });
}

function handleMessageDelete(req, res, id) {
  const session = requireAdmin(req, res);
  if (!session) return;
  if (!checkCsrf(req, session)) return sendJson(res, 403, { error: 'Jeton CSRF invalide.' });
  const index = store.messages.findIndex(m => m.id === id);
  if (index < 0) return sendJson(res, 404, { error: 'Message introuvable.' });
  const message = store.messages[index];
  store.messages.splice(index, 1);
  markDirty('messages');
  logAction('message.deleted', 'Message supprimé', 'Message de ' + message.name, req, 'admin');
  return sendJson(res, 200, { ok: true });
}

function handlePublicProjects(req, res) {
  return sendJson(res, 200, {
    items: store.projects.slice().sort((a, b) => a.order - b.order).map(p => ({
      slug: p.slug, title: p.title, category: p.category, year: p.year,
      excerpt: p.excerpt, cover: p.cover, tags: p.tags, stack: p.stack, featured: p.featured
    }))
  });
}

/* ---------- Routeur ---------- */

async function handleRequest(req, res) {
  const nonce = crypto.randomBytes(18).toString('base64');

  // Protection anti-DoS / anti-abus : limitation globale par IP
  const ip = clientIp(req);
  if (limited('global:' + ip, 600, 5 * 60 * 1000)) {
    res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60', 'X-Content-Type-Options': 'nosniff' });
    return res.end('Trop de requêtes.');
  }

  // Rejette les requêtes anormales (URL trop longue, octets nuls, traversée)
  if (typeof req.url !== 'string' || req.url.length > 2048 || /\x00/.test(req.url)) {
    res.writeHead(414, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    return res.end('URI trop longue.');
  }

  // Validation de l'en-tête Host (anti-injection)
  const hostHeader = String(req.headers.host || '');
  const allowedHosts = new Set(['localhost:' + PORT, '127.0.0.1:' + PORT, 'localhost', '127.0.0.1']);
  // Autorise localhost/127.0.0.1 sur n'importe quel port (dev, tests)
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(hostHeader)) allowedHosts.add(hostHeader);
  if (SITE_URL) {
    try { allowedHosts.add(new URL(SITE_URL).host); } catch (err) { /* ignore */ }
  }
  if (HOST && HOST !== '127.0.0.1' && HOST !== 'localhost') allowedHosts.add(HOST + (PORT ? ':' + PORT : ''));
  // Sur Vercel, l'hôte est géré par la plateforme
  if (IS_VERCEL) allowedHosts.add(hostHeader);
  if (hostHeader && !allowedHosts.has(hostHeader)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    return res.end('Hôte non autorisé.');
  }

  setSecurityHeaders(res, nonce);

  let url;
  try {
    url = new URL(req.url, 'http://' + (hostHeader || 'localhost'));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Requête invalide');
  }

  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch (err) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Requête invalide'); }

  // Rejette les séquences de traversée et les octets nuls dans le chemin
  if (/\x00/.test(pathname) || pathname.indexOf('../') !== -1 || pathname.indexOf('/..') !== -1) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Requête invalide');
  }

  try {
    /* Pages */
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/') return serveHome(req, res, nonce);
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/projet/')) {
      return serveProject(req, res, pathname.slice('/projet/'.length), nonce);
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/admin') {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      if (getSession(req)) {
        res.writeHead(302, { Location: '/admin/dashboard', 'Cache-Control': 'no-store' });
        return res.end();
      }
      const template = fs.readFileSync(path.join(VIEWS_DIR, 'admin-login.html'), 'utf8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      return sendHtml(res, 200, layoutReplace(template, { YEAR_NOW: String(new Date().getFullYear()) }));
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/admin/dashboard') {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      const session = getSession(req);
      if (!session) {
        res.writeHead(302, { Location: '/admin', 'Cache-Control': 'no-store' });
        return res.end();
      }
      const template = fs.readFileSync(path.join(VIEWS_DIR, 'admin-dashboard.html'), 'utf8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      return sendHtml(res, 200, layoutReplace(template, {
        CSRF: session.csrf,
        USERNAME: esc(store.admin.username),
        MUST_CHANGE: store.admin.mustChange ? '1' : '0',
        YEAR_NOW: String(new Date().getFullYear())
      }));
    }

    if (req.method === 'GET' && pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      return res.end('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ' + siteBase(req) + '/sitemap.xml\n');
    }

    if (req.method === 'GET' && pathname === '/sitemap.xml') {
      const base = siteBase(req);
      const urls = ['<url><loc>' + base + '/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>']
        .concat(store.projects.map(p => '<url><loc>' + base + '/projet/' + encodeURIComponent(p.slug) + '</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>'));
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>';
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      return res.end(xml);
    }

    /* API publique */
    if (req.method === 'POST' && pathname === '/api/track') return await handleTrack(req, res);
    if (req.method === 'POST' && pathname === '/api/contact') return await handleContact(req, res);
    if (req.method === 'GET' && pathname === '/api/projects') return handlePublicProjects(req, res);

    /* API admin */
    if (req.method === 'POST' && pathname === '/api/admin/login') return await handleLogin(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/logout') return handleLogout(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/logout-all') return handleLogoutAll(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/password') return await handlePassword(req, res);
    if (req.method === 'GET' && pathname === '/api/admin/session') return handleSessionInfo(req, res);
    if (req.method === 'GET' && pathname === '/api/admin/stats') return handleStats(req, res);
    if (req.method === 'GET' && pathname === '/api/admin/visits') return handleVisits(req, res, url);
    if (req.method === 'GET' && pathname === '/api/admin/visits/export') return handleVisitsExport(req, res);
    if (req.method === 'GET' && pathname === '/api/admin/actions') return handleActions(req, res, url);
    if (req.method === 'GET' && pathname === '/api/admin/projects') return handleProjects(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/projects') return await handleCreateProject(req, res);
    if (req.method === 'GET' && pathname === '/api/admin/messages') return handleMessages(req, res);

    const projectMatch = /^\/api\/admin\/projects\/([a-zA-Z0-9_]+)$/.exec(pathname);
    if (projectMatch) {
      if (req.method === 'PUT' || req.method === 'PATCH') return await handleUpdateProject(req, res, projectMatch[1]);
      if (req.method === 'DELETE') return handleDeleteProject(req, res, projectMatch[1]);
    }

    const messageMatch = /^\/api\/admin\/messages\/([a-zA-Z0-9_]+)$/.exec(pathname);
    if (messageMatch) {
      if (req.method === 'PATCH') return handleMessageUpdate(req, res, messageMatch[1]);
      if (req.method === 'DELETE') return handleMessageDelete(req, res, messageMatch[1]);
    }

    /* Fichiers statiques */
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (serveStatic(req, res, pathname)) return;
      return serve404(req, res, nonce);
    }

    sendJson(res, 405, { error: 'Méthode non autorisée.' });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error('[server]', err);
    if (res.headersSent) return res.end();
    if (pathname && pathname.startsWith('/api/')) return sendJson(res, status, { error: status === 500 ? 'Erreur interne du serveur.' : err.message });
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(status === 500 ? 'Erreur interne du serveur.' : err.message);
  }
}

// Export pour Vercel (serverless) ; sinon démarrage du serveur HTTP classique
if (IS_VERCEL) {
  module.exports = handleRequest;
} else {
  const server = http.createServer(handleRequest);
  server.timeout = 30000;
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  server.listen(PORT, HOST, () => {
    const base = 'http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT;
    console.log('');
    console.log('  Portfolio Ruben EBAH — serveur démarré');
    console.log('  Site public  : ' + base + '/');
    console.log('  Admin        : ' + base + '/admin');
    console.log('  Données      : ' + DATA_DIR);
    console.log('  Arrêt        : Ctrl + C');
    console.log('');
  });
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error('Le port ' + PORT + ' est déjà utilisé. Définissez PORT=autre_port.');
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}

function siteBase(req) {
  if (SITE_URL) return SITE_URL;
  const proto = SECURE_COOKIES ? 'https' : 'http';
  return proto + '://' + (req.headers.host || 'localhost:' + PORT);
}
