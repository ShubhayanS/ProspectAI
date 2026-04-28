/* ── Helpers ────────────────────────────────────────────────────────────────── */

function qs(sel, ctx = document) { return ctx.querySelector(sel); }
function qsa(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

async function api(path) {
  const r = await fetch(`/api/${path}`);
  return r.json();
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocked = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta']);
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  const toRemove = [];

  while (walker.nextNode()) {
    const el = walker.currentNode;
    const tag = el.tagName.toLowerCase();
    if (blocked.has(tag)) {
      toRemove.push(el);
      continue;
    }

    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    }
  }

  toRemove.forEach(node => node.remove());
  return doc.body.innerHTML;
}

function renderMarkdown(md) {
  return sanitizeHtml(marked.parse(md ?? ''));
}

function replaceIcons() {
  if (!window.feather?.replace) return;
  try {
    feather.replace();
  } catch (error) {
    qsa('[data-feather]').forEach(el => {
      const name = el.getAttribute('data-feather');
      if (name && !feather.icons?.[name]) {
        el.removeAttribute('data-feather');
        el.textContent = '';
      }
    });
    try { feather.replace(); } catch {}
  }
}

function dateFromValue(value) {
  if (!value) return 0;
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateValue(value) {
  const d = dateFromValue(value);
  return d ? d.getTime() : 0;
}

function parseScoreValue(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function filterByDateWindow(dateValue, windowKey) {
  if (!windowKey || windowKey === 'all') return true;
  const ts = parseDateValue(dateValue);
  if (!ts) return false;
  const now = Date.now();
  const windows = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 };
  return ts >= now - (windows[windowKey] || 0) * 86400000;
}

function truncate(s, n = 50) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function fmtDate(s) {
  if (!s) return '—';
  try {
    const d = dateFromValue(s);
    return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : s;
  } catch { return s; }
}

function fmtTableDate(s) {
  if (!s) return '—';
  const d = dateFromValue(s);
  if (!d) return s;
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

const _resumeDownloads = new Map();

function resumeKey({ url, company, title } = {}) {
  return (url || `${company || ''}|${title || ''}`).trim().toLowerCase();
}

function renderResumeAction({ url = '', company = '', title = '' } = {}, small = true) {
  const key = resumeKey({ url, company, title });
  const href = _resumeDownloads.get(key);
  const sizeClass = small ? ' btn-sm' : '';
  if (href) {
    return `<a class="btn${sizeClass} btn-secondary btn-resume" href="${escHtml(href)}" target="_blank" download>
      <i data-feather="download"></i> Download
    </a>`;
  }
  return `<button class="btn${sizeClass} btn-secondary btn-resume" data-resume-url="${escHtml(url)}" data-resume-company="${escHtml(company)}" data-resume-title="${escHtml(title)}">
    <i data-feather="file-plus"></i> Tailor
  </button>`;
}

// ── Score badge ──────────────────────────────────────────────────────────────
function scoreBadge(raw) {
  if (!raw) return `<span class="badge badge-gray">—</span>`;
  const v = parseFloat(raw);
  const cls = v >= 4.5 ? 'badge-green' : v >= 3.5 ? 'badge-blue' : v >= 2.5 ? 'badge-orange' : 'badge-red';
  return `<span class="badge ${cls}">${escHtml(raw)}</span>`;
}

// ── Status pill ──────────────────────────────────────────────────────────────
const STATUS_CLS = {
  Applied: 'applied', SKIP: 'skip', Evaluated: 'evaluated',
  Interview: 'interview', Offer: 'offer', Rejected: 'rejected',
  Responded: 'responded', Discarded: 'discarded',
  added: 'added', skipped_title: 'skipped_title',
  skipped_location: 'skipped_location', skipped_dup: 'skipped_dup',
  skipped_expired: 'skipped_expired', pending: 'pending',
};

const STATUS_LABEL = {
  added: 'Added',
  skipped_title: 'Title filter',
  skipped_location: 'Location',
  skipped_dup: 'Duplicate',
  skipped_expired: 'Expired',
  Applied: 'Applied', SKIP: 'Skip', Evaluated: 'Evaluated',
  Interview: 'Interview', Offer: 'Offer', Rejected: 'Rejected',
  Responded: 'Responded', Discarded: 'Discarded', pending: 'Pending',
};

function pill(status) {
  const cls = STATUS_CLS[status] || 'skip';
  const lbl = STATUS_LABEL[status] || status;
  return `<span class="pill pill-${cls}">${escHtml(lbl)}</span>`;
}

// ── Extract from "Company | Role" title string ───────────────────────────────
function splitTitle(title) {
  const m = title.match(/^(.+?)\s*\|\s*(.+)$/);
  return m ? { company: m[1].trim(), role: m[2].trim() } : { company: '', role: title };
}

// ── Toast ────────────────────────────────────────────────────────────────────
let _toastTimer;
function toast(msg) {
  const el = qs('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ── Copy ─────────────────────────────────────────────────────────────────────
function copy(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'));
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(title, bodyHtml, url) {
  qs('#modal-title').textContent = title;
  qs('#modal-body').innerHTML = bodyHtml;
  const linkEl = qs('#modal-open-link');
  if (url) { linkEl.href = url; linkEl.style.display = 'flex'; }
  else      { linkEl.style.display = 'none'; }
  qs('#modal-backdrop').classList.add('open');
  replaceIcons();
}

function closeModal() {
  qs('#modal-backdrop').classList.remove('open');
}

qs('#modal-close').addEventListener('click', closeModal);
qs('#modal-backdrop').addEventListener('click', e => {
  if (e.target === qs('#modal-backdrop')) closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── Theme ─────────────────────────────────────────────────────────────────────
function getTheme() {
  return localStorage.getItem('co-theme') ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('co-theme', t);
  const btn = qs('#theme-toggle');
  btn.innerHTML = t === 'dark'
    ? '<i data-feather="sun"></i>'
    : '<i data-feather="moon"></i>';
  replaceIcons();
}

qs('#theme-toggle').addEventListener('click', () => {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

// ── Navigation ────────────────────────────────────────────────────────────────
let _curPage = 'dashboard';

function navigate(page) {
  qsa('.page').forEach(p => p.classList.remove('active'));
  qsa('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = qs(`#page-${page}`);
  const navEl  = qs(`[data-page="${page}"]`);
  if (pageEl) pageEl.classList.add('active');
  if (navEl)  navEl.classList.add('active');
  _curPage = page;
  renderPage(page);
}

qsa('.nav-item').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    navigate(el.getAttribute('data-page'));
  });
});

// ── Page Dispatcher ───────────────────────────────────────────────────────────
async function renderPage(page) {
  const el = qs(`#page-${page}`);
  if (!el) return;
  el.innerHTML = `<div class="loader"><div class="spin"></div> Loading…</div>`;
  switch (page) {
    case 'dashboard':    await pageDashboard(el); break;
    case 'jobs':         await pageJobs(el); break;
    case 'applications': await pageApplications(el); break;
    case 'reports':      await pageReports(el); break;
    case 'scanner':      pageScanner(el); break;
    case 'evaluator':    pageEvaluator(el); break;
    case 'profile':      await pageProfile(el); break;
  }
  replaceIcons();
}

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════════════════════ */
async function pageDashboard(el) {
  const [stats, apps] = await Promise.all([
    api('stats'), api('applications'),
  ]);

  const recent = apps.slice(0, 8);

  el.innerHTML = `
    <div class="page-hd">
      <div class="page-hd-text">
        <h1>Dashboard</h1>
        <p>${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</p>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-secondary" onclick="openMatcherModal()">
          <i data-feather="cpu"></i> Score Today
        </button>
        <button class="btn btn-primary" onclick="navigate('scanner')">
          <i data-feather="search"></i> Find Jobs
        </button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon purple"><i data-feather="file-text"></i></div>
        <div class="stat-num">${stats.evaluated}</div>
        <div class="stat-lbl">Evaluated</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green"><i data-feather="send"></i></div>
        <div class="stat-num">${stats.applied}</div>
        <div class="stat-lbl">Applied</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon blue"><i data-feather="database"></i></div>
        <div class="stat-num">${stats.totalScanned}</div>
        <div class="stat-lbl">Jobs Scanned</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon orange"><i data-feather="star"></i></div>
        <div class="stat-num">${stats.highScore}</div>
        <div class="stat-lbl">Score ≥ 4.5</div>
      </div>
    </div>

    <div class="dash-grid mb-5">
      <!-- Recent evaluations -->
      <div class="card">
        <div class="card-hd">
          <h2>Recent Evaluations</h2>
          <button class="btn btn-sm btn-ghost" onclick="navigate('applications')">
            View all <i data-feather="arrow-right"></i>
          </button>
        </div>
        <div class="item-list">
          ${recent.length === 0
            ? `<div class="empty"><i data-feather="inbox"></i><p>No evaluations yet</p></div>`
            : recent.map(a => {
                const reportFile = (a['Report']||'').match(/\(reports\/([^)]+)\)/)?.[1] || '';
                return `
                <div class="item-row" onclick="${reportFile ? `openReport('${reportFile}')` : ''}">
                  <div class="item-info">
                    <div class="item-co">${escHtml(a['Company']||'—')}</div>
                    <div class="item-role">${escHtml(truncate(a['Role']||'—', 48))}</div>
                  </div>
                  ${scoreBadge(a['Score'])}
                  ${pill(a['Status']||'Evaluated')}
                </div>`;
              }).join('')
          }
        </div>
      </div>

      <!-- Right column -->
      <div style="display:flex;flex-direction:column;gap:14px">
        <!-- Score distribution -->
        <div class="card">
          <div class="card-hd"><h2>Score Distribution</h2></div>
          <div class="card-body">
            <div class="score-bars">
              ${[5,4,3,2,1].map(s => {
                const count = apps.filter(a => {
                  const v = parseFloat(a['Score']);
                  return s === 5 ? v >= 4.5 : (v >= s - 0.5 && v < s + 0.4999);
                }).length;
                const pct = stats.evaluated > 0 ? Math.round(count / stats.evaluated * 100) : 0;
                const colors = {5:'var(--green)',4:'var(--blue)',3:'var(--orange)',2:'var(--red)',1:'var(--red)'};
                return `
                <div class="score-bar-row">
                  <div class="score-bar-lbl">${s}</div>
                  <div class="score-bar-track">
                    <div class="score-bar-fill" style="width:${pct}%;background:${colors[s]}"></div>
                  </div>
                  <div class="score-bar-cnt">${count}</div>
                </div>`;
              }).join('')}
            </div>
            <div class="activity-grid">
              ${[
                ['Total Scanned', stats.totalScanned, 'var(--text-1)'],
                ['Added',         stats.byStatus?.added || 0, 'var(--green)'],
                ['Title Skip',    stats.byStatus?.skipped_title || 0, 'var(--text-3)'],
                ['Loc Skip',      stats.byStatus?.skipped_location || 0, 'var(--orange)'],
              ].map(([lbl,val,col]) => `
                <div class="activity-item">
                  <div class="activity-num" style="color:${col}">${val}</div>
                  <div class="activity-lbl">${lbl}</div>
                </div>`).join('')}
            </div>
          </div>
        </div>

        <!-- Status breakdown -->
        <div class="card">
          <div class="card-hd"><h2>Application Status</h2></div>
          <div class="card-body">
            ${Object.entries(stats.statusCounts||{}).length === 0
              ? `<p class="text-dim text-sm">No applications yet</p>`
              : Object.entries(stats.statusCounts).map(([s,n]) => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)">
                  ${pill(s)}
                  <span style="font-size:14px;font-weight:600;color:var(--text-1)">${n}</span>
                </div>`).join('')
            }
          </div>
        </div>
      </div>
    </div>

  `;
}

/* ═══════════════════════════════════════════════════════════════════════════
   JOBS
═══════════════════════════════════════════════════════════════════════════ */
let _jobFilter = 'all';
let _jobSearch = '';
let _jobScoreFilter = 'all';
let _jobScannedFilter = 'all';
let _jobSortField = 'recommended';
let _jobSortDir = 'desc';

async function pageJobs(el) {
  el.innerHTML = `
    <div class="page-hd">
      <div class="page-hd-text">
        <h1>All Jobs</h1>
        <p>Fresh roles collected from your searches</p>
      </div>
    </div>
    <div class="toolbar mb-4">
      <div class="search-box">
        <i data-feather="search"></i>
        <input class="search-input" id="job-search" placeholder="Search title or company…" value="${escHtml(_jobSearch)}">
      </div>
      <select class="toolbar-filter" id="job-status-filter">
        <option value="all">All Statuses</option>
        ${APP_STATUSES.map(s => `<option value="${s}"${_jobFilter===s?' selected':''}>${s}</option>`).join('')}
      </select>
      <select class="toolbar-filter" id="job-score-filter">
        <option value="all">All Scores</option>
        <option value="scored"${_jobScoreFilter==='scored'?' selected':''}>Scored only</option>
        <option value="4plus"${_jobScoreFilter==='4plus'?' selected':''}>Score 4.0+</option>
        <option value="3plus"${_jobScoreFilter==='3plus'?' selected':''}>Score 3.0+</option>
        <option value="unscored"${_jobScoreFilter==='unscored'?' selected':''}>Unscored</option>
      </select>
      <select class="toolbar-filter" id="job-scanned-filter">
        <option value="all">All Posted Dates</option>
        <option value="1d"${_jobScannedFilter==='1d'?' selected':''}>Posted 24h</option>
        <option value="7d"${_jobScannedFilter==='7d'?' selected':''}>Posted 7d</option>
        <option value="30d"${_jobScannedFilter==='30d'?' selected':''}>Posted 30d</option>
        <option value="90d"${_jobScannedFilter==='90d'?' selected':''}>Posted 90d</option>
      </select>
      <select class="toolbar-filter" id="job-sort-field">
        <option value="recommended"${_jobSortField==='recommended'?' selected':''}>Recommended</option>
        <option value="posted_at"${_jobSortField==='posted_at'?' selected':''}>Posted Date</option>
        <option value="score"${_jobSortField==='score'?' selected':''}>Score</option>
      </select>
      <button class="icon-btn" id="job-sort-dir" title="Toggle sort direction">
        <i data-feather="${_jobSortDir === 'desc' ? 'arrow-down' : 'arrow-up'}"></i>
      </button>
    </div>
    <div class="card" id="job-card">
      <div class="loader"><div class="spin"></div></div>
    </div>
  `;
  replaceIcons();

  qs('#job-search').addEventListener('input', e => {
    _jobSearch = e.target.value;
    loadJobs();
  });

  qs('#job-status-filter').addEventListener('change', e => {
    _jobFilter = e.target.value;
    loadJobs();
  });
  qs('#job-score-filter').addEventListener('change', e => {
    _jobScoreFilter = e.target.value;
    loadJobs();
  });
  qs('#job-scanned-filter').addEventListener('change', e => {
    _jobScannedFilter = e.target.value;
    loadJobs();
  });
  qs('#job-sort-field').addEventListener('change', e => {
    _jobSortField = e.target.value;
    loadJobs();
  });
  qs('#job-sort-dir').addEventListener('click', () => {
    _jobSortDir = _jobSortDir === 'desc' ? 'asc' : 'desc';
    loadJobs();
  });

  loadJobs();
}

function toggleScoreSort() {
  if (_jobSortField === 'score') {
    _jobSortDir = _jobSortDir === 'desc' ? 'asc' : 'desc';
  } else {
    _jobSortField = 'score';
    _jobSortDir = 'desc';
  }
  loadJobs();
}

async function loadJobs() {
  const card = qs('#job-card');
  if (!card) return;
  card.innerHTML = `<div class="loader"><div class="spin"></div></div>`;

  const p = new URLSearchParams({ status: _jobFilter });
  if (_jobSearch) p.set('search', _jobSearch);
  let { jobs } = await fetch(`/api/jobs?${p}`).then(r => r.json());

  jobs = (jobs || []).filter(j => {
    const score = parseScoreValue(j.score);
    if (_jobScoreFilter === 'scored' && score == null) return false;
    if (_jobScoreFilter === 'unscored' && score != null) return false;
    if (_jobScoreFilter === '4plus' && !(score >= 4)) return false;
    if (_jobScoreFilter === '3plus' && !(score >= 3)) return false;
    return filterByDateWindow(j.posted_at || j.first_seen, _jobScannedFilter);
  });

  const compare = (a, b, field) => {
    if (field === 'score') {
      return (parseScoreValue(a.score) ?? -1) - (parseScoreValue(b.score) ?? -1);
    }
    return parseDateValue(a[field]) - parseDateValue(b[field]);
  };

  jobs.sort((a, b) => {
    let result = 0;
    if (_jobSortField === 'recommended') {
      result =
        compare(a, b, 'posted_at') ||
        compare(a, b, 'score') ||
        compare(a, b, 'first_seen');
    } else {
      result = compare(a, b, _jobSortField);
    }
    return _jobSortDir === 'asc' ? result : -result;
  });

  const total = jobs.length;

  if (!jobs?.length) {
    card.innerHTML = `<div class="empty"><i data-feather="inbox"></i><p>No jobs match this filter</p></div>`;
    replaceIcons();
    return;
  }

  card.innerHTML = `
    <div class="row-count">${total} result${total!==1?'s':''}</div>
    <div class="tbl-wrap">
      <table class="data-table jobs-table">
        <colgroup>
          <col class="col-job">
          <col class="col-date">
          <col class="col-score">
          <col class="col-status">
          <col class="col-resume">
          <col class="col-action">
        </colgroup>
        <thead>
          <tr>
            <th>Job</th>
            <th>Posted</th>
            <th class="th-sortable" onclick="toggleScoreSort()" title="Sort by score">
              Score ${_jobSortField === 'score' ? (_jobSortDir === 'desc' ? '↓' : '↑') : '<span style="opacity:.35">↕</span>'}
            </th>
            <th>Status</th><th>Resume</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${jobs.map(j => `
            <tr>
              <td class="job-cell">
                <div class="job-title" title="${escHtml(j.title||'')}">${escHtml(j.title||'—')}</div>
                <div class="job-meta">
                  <span class="job-company">${escHtml(j.company||'—')}</span>
                  <span>${escHtml(j.portal||'—')}</span>
                </div>
              </td>
              <td class="date-cell" title="${escHtml(j.posted_at ? fmtDate(j.posted_at) : '')}">${escHtml(fmtTableDate(j.posted_at))}</td>
              <td class="score-cell">${j.score ? scoreBadge(j.score + '/5') : '<span class="badge badge-gray">—</span>'}</td>
              <td>
                <select class="status-select" data-url="${escHtml(j.url)}"
                  data-company="${escHtml(j.company||'')}" data-title="${escHtml(j.title||'')}"
                  onchange="updateJobStatus(this)">
                  <option value="">— Status —</option>
                  ${APP_STATUSES.map(s =>
                    `<option value="${s}"${s===j.status?' selected':''}>${s}</option>`
                  ).join('')}
                </select>
              </td>
              <td class="resume-cell">
                ${renderResumeAction({ url: j.url || '', company: j.company || '', title: j.title || '' })}
              </td>
              <td class="action-cell">
                ${j.url?.startsWith('http') ? `<a href="${escHtml(j.url)}" target="_blank" class="btn btn-apply"><i data-feather="external-link"></i> Open</a>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  replaceIcons();
}


/* ═══════════════════════════════════════════════════════════════════════════
   APPLICATIONS
═══════════════════════════════════════════════════════════════════════════ */
const APP_STATUSES = ['Evaluated','Applied','Responded','Interview','Offer','Rejected','Discarded','SKIP'];

let _appsFilter = 'all';
let _appsData   = [];
let _appsSortField = 'recommended';
let _appsSortDir = 'desc';

async function pageApplications(el) {
  _appsData = await api('applications');
  const statuses = ['all', ...APP_STATUSES];

  el.innerHTML = `
    <div class="page-hd">
      <div class="page-hd-text">
        <h1>My Applications</h1>
        <p>${_appsData.length} total · decisions, resumes, and analysis in one place</p>
      </div>
    </div>
    <div class="toolbar mb-4">
      <select class="toolbar-filter" id="apps-sort-field">
        <option value="recommended"${_appsSortField==='recommended'?' selected':''}>Recommended</option>
        <option value="posted"${_appsSortField==='posted'?' selected':''}>Posted Date</option>
        <option value="score"${_appsSortField==='score'?' selected':''}>Score</option>
        <option value="scanned"${_appsSortField==='scanned'?' selected':''}>Scanned On</option>
        <option value="date"${_appsSortField==='date'?' selected':''}>Application Date</option>
      </select>
      <button class="icon-btn" id="apps-sort-dir" title="Toggle sort direction">
        <i data-feather="${_appsSortDir === 'desc' ? 'arrow-down' : 'arrow-up'}"></i>
      </button>
    </div>
    <div class="chips mb-4" id="apps-chips">
      ${statuses.map(s =>
        `<button class="chip${_appsFilter===s?' on':''}" data-s="${s}">${escHtml(s)}</button>`
      ).join('')}
    </div>
    <div class="card" id="apps-card">
      ${renderAppsTable(_appsData, _appsFilter)}
    </div>
  `;
  replaceIcons();

  qsa('#apps-chips .chip').forEach(c => {
    c.addEventListener('click', () => {
      _appsFilter = c.getAttribute('data-s');
      qsa('#apps-chips .chip').forEach(x => x.classList.remove('on'));
      c.classList.add('on');
      qs('#apps-card').innerHTML = renderAppsTable(_appsData, _appsFilter);
      replaceIcons();
    });
  });
  qs('#apps-sort-field').addEventListener('change', e => {
    _appsSortField = e.target.value;
    qs('#apps-card').innerHTML = renderAppsTable(_appsData, _appsFilter);
    replaceIcons();
  });
  qs('#apps-sort-dir').addEventListener('click', () => {
    _appsSortDir = _appsSortDir === 'desc' ? 'asc' : 'desc';
    qs('#apps-card').innerHTML = renderAppsTable(_appsData, _appsFilter);
    replaceIcons();
  });
}

function renderAppsTable(apps, filter) {
  const rows = (filter === 'all' ? apps : apps.filter(a => (a.status || a['Status']) === filter)).slice();
  rows.sort((a, b) => {
    const posted = () => parseDateValue(a.posted_at) - parseDateValue(b.posted_at);
    const score = () => (parseScoreValue(a.score_display || a['Score']) ?? -1) - (parseScoreValue(b.score_display || b['Score']) ?? -1);
    const scanned = () => parseDateValue(a.first_seen || a['Date']) - parseDateValue(b.first_seen || b['Date']);
    const applied = () => parseDateValue(a.application_date || a['Date']) - parseDateValue(b.application_date || b['Date']);
    let result = 0;
    switch (_appsSortField) {
      case 'posted': result = posted(); break;
      case 'score': result = score(); break;
      case 'scanned': result = scanned(); break;
      case 'date': result = applied(); break;
      default: result = posted() || score() || scanned();
    }
    return _appsSortDir === 'asc' ? result : -result;
  });
  if (!rows.length)
    return `<div class="empty"><i data-feather="inbox"></i><p>Nothing here</p></div>`;

  return `
    <div class="row-count">${rows.length} result${rows.length!==1?'s':''}</div>
    <div class="tbl-wrap">
      <table class="data-table apps-table">
        <colgroup>
          <col class="col-job">
          <col class="col-date">
          <col class="col-score">
          <col class="col-status">
          <col class="col-resume">
          <col class="col-report">
          <col class="col-notes">
        </colgroup>
        <thead>
          <tr>
            <th>Job</th><th>Date</th><th>Score</th><th>Status</th><th>Resume</th><th>Report</th><th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(a => {
            const reportFile = a.report_file || (a['Report']||'').match(/\(reports\/([^)]+)\)/)?.[1] || '';
            const reportNum  = a.report_num || (a['Report']||'').match(/\[(\d+)\]/)?.[1] || '';
            const rowNum     = escHtml(a.application_num || a['#'] || '—');
            const date       = a.application_date || a.first_seen || a['Date'] || '—';
            const company    = a.company || a['Company'] || '';
            const title      = a.title || a['Role'] || '';
            const status     = a.status || a['Status'] || 'added';
            const score      = a.score_display || a['Score'] || '';
            return `
            <tr>
              <td class="job-cell ${reportFile ? 'clickable' : ''}" ${reportFile ? `data-report-file="${escHtml(reportFile)}"` : ''}>
                <div class="job-title" title="${escHtml(title)}">${escHtml(title||'—')}</div>
                <div class="job-meta">
                  <span class="job-company">${escHtml(company||'—')}</span>
                  <span>#${rowNum}</span>
                </div>
              </td>
              <td class="date-cell" title="${escHtml(date)}">${escHtml(fmtTableDate(date))}</td>
              <td class="score-cell">${scoreBadge(score)}</td>
              <td>
                <select class="status-select" data-row="${escHtml(a.application_num || a['#'] || '')}" data-url="${escHtml(a.url || '')}" onchange="updateStatus(this)">
                  ${APP_STATUSES.map(s =>
                    `<option value="${s}"${s===status?' selected':''}>${s}</option>`
                  ).join('')}
                </select>
              </td>
              <td>
                ${renderResumeAction({ url: a.url || '', company, title })}
              </td>
              <td>${reportFile
                ? `<button class="btn btn-sm btn-secondary" data-report-file="${escHtml(reportFile)}">
                     <i data-feather="file-text"></i> ${reportNum}
                   </button>`
                : score && score !== 'N/A'
                  ? `<button class="btn btn-sm btn-secondary" data-score-url="${escHtml(a.url || '')}" data-score-company="${escHtml(company)}" data-score-title="${escHtml(title)}">
                       <i data-feather="file-text"></i> Score
                     </button>`
                  : '—'}</td>
              <td class="notes-cell" title="${escHtml(a.notes || a['Notes'] || '')}">${escHtml(truncate(a.notes || a['Notes'] || '',42))}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function statusColor(s) {
  const map = {
    Applied:'var(--blue)', Interview:'var(--green)', Offer:'var(--green)',
    Rejected:'var(--red)', Discarded:'var(--red)', SKIP:'var(--text-3)',
    Evaluated:'var(--purple)', Responded:'var(--orange)',
  };
  return map[s] || 'var(--text-2)';
}

function jobStatusColor(s) {
  const map = {
    added:            'var(--green)',
    skipped_title:    'var(--text-3)',
    skipped_location: 'var(--orange)',
    skipped_dup:      'var(--text-2)',
    skipped_expired:  'var(--red)',
  };
  return map[s] || 'var(--text-2)';
}

async function updateJobStatus(sel) {
  const url       = sel.getAttribute('data-url');
  const company   = sel.getAttribute('data-company');
  const title     = sel.getAttribute('data-title');
  const newStatus = sel.value;

  try {
    const r = await fetch('/api/jobs/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, status: newStatus }),
    });
    const data = await r.json();
    if (!data.ok) { toast('Update failed: ' + (data.error || 'unknown')); return; }

    // Mirror to Applications tab
    const upsert = await fetch('/api/applications/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, company, title, status: newStatus }),
    }).then(r => r.json()).catch(() => null);

    if (upsert?.action === 'added') toast(`Status → ${newStatus} · added to Applications`);
    else if (upsert?.action === 'updated') toast(`Status → ${newStatus} · Applications updated`);
    else toast(`Status → ${STATUS_LABEL[newStatus] || newStatus}`);
  } catch { toast('Update failed'); }
}

async function updateStatus(sel) {
  const rowNum    = sel.getAttribute('data-row');
  const url       = sel.getAttribute('data-url');
  const newStatus = sel.value;

  try {
    const endpoint = rowNum ? '/api/applications/status' : '/api/jobs/status';
    const body = rowNum ? { num: rowNum, status: newStatus } : { url, status: newStatus };
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (data.ok) {
      toast(`Status → ${newStatus}`);
      // update local cache so filter re-render is consistent
      const entry = _appsData.find(a => a.application_num === rowNum || a['#'] === rowNum || a.url === url);
      if (entry) { entry.Status = newStatus; entry.status = newStatus; }
    } else {
      toast('Update failed: ' + (data.error || 'unknown'));
    }
  } catch(e) {
    toast('Update failed');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOP MATCHES
═══════════════════════════════════════════════════════════════════════════ */
let _reportsData = [];

async function pageReports(el) {
  const matches = await api('top-matches');
  _reportsData = matches || [];

  el.innerHTML = `
    <div class="page-hd">
      <div class="page-hd-text">
        <h1>Top Matches</h1>
        <p>${matches.length} evaluated or new job${matches.length!==1?'s':''} at 4.0+ · newest postings first, score breaks ties</p>
      </div>
    </div>
    ${matches.length === 0
      ? `<div class="card"><div class="empty"><i data-feather="star"></i><p>No evaluated or new 4.0+ matches right now</p></div></div>`
      : `<div class="reports-grid">
          ${matches.map(r => {
            const company = r.company || splitTitle(r.title || '').company || r.slug;
            const role = r.title || splitTitle(r.title || '').role;
            const reportFile = r.report_file || r.filename || '';
            const sortDate = r.posted_at || r.first_seen || r.report_date || r.date;
            return `
            <div class="report-card" ${reportFile ? `data-report-file="${escHtml(reportFile)}"` : `data-score-url="${escHtml(r.url || '')}"`}>
              <div class="report-card-hd">
                <div class="report-co">${escHtml(company || '—')}</div>
                ${scoreBadge(r.score_display || r.score)}
              </div>
              <div class="report-role">${escHtml(truncate(role || '—', 55))}</div>
              <div class="report-foot">
                <span class="report-date">${reportFile ? 'Report' : 'Score only'} · ${fmtDate(sortDate)}</span>
                ${r.url ? `<a href="${escHtml(r.url)}" target="_blank"
                    onclick="event.stopPropagation()"
                    class="btn btn-sm btn-secondary" style="padding:2px 8px;font-size:11px">
                    <i data-feather="external-link"></i>
                  </a>` : ''}
                <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation()" data-resume-url="${escHtml(r.url || '')}" data-resume-company="${escHtml(company || '')}" data-resume-title="${escHtml(role || '')}" style="padding:2px 8px;font-size:11px">
                  <i data-feather="download"></i>
                </button>
              </div>
            </div>`;
          }).join('')}
        </div>`}
  `;
  replaceIcons();
}

async function openReport(filename) {
  openModal('Loading…', `<div class="loader"><div class="spin"></div></div>`, null);
  try {
    const md = await fetch(`/api/reports/${filename}`).then(r => r.text());
    const titleM = md.match(/^#\s+(.+)/m);
    const urlM   = md.match(/\*\*URL:\*\*\s*(https?:\/\/\S+)/);
    const title  = titleM ? titleM[1].trim() : filename;
    const url    = urlM ? urlM[1].replace(/\)$/, '') : null;
    openModal(title, `<div class="md">${renderMarkdown(md)}</div>`, url);
  } catch(e) {
    qs('#modal-body').innerHTML = `<p style="color:var(--red)">Failed to load: ${e.message}</p>`;
  }
}

function findJobRecord({ url, company, title } = {}) {
  const all = [...(_appsData || []), ...(_reportsData || [])];
  return all.find(j =>
    (url && j.url === url) ||
    ((j.company || j.Company || '').toLowerCase() === (company || '').toLowerCase() &&
      (j.title || j.Role || '').toLowerCase() === (title || '').toLowerCase())
  );
}

function openScoredJob(url, companyHint = '', titleHint = '') {
  const job = findJobRecord({ url, company: companyHint, title: titleHint });
  if (!job) return;
  const company = job.company || job.Company || '—';
  const title = job.title || job.Role || '—';
  const score = job.score_display || job.Score || '—';
  openModal(`${company} | ${title}`, `
    <div class="md">
      <p><strong>Score:</strong> ${escHtml(score)}</p>
      <p><strong>Status:</strong> ${escHtml(job.status || job.Status || 'added')}</p>
      <p><strong>Scanned:</strong> ${escHtml(job.first_seen || job.Date || '—')}</p>
      ${job.notes || job.Notes ? `<p><strong>Notes:</strong> ${escHtml(job.notes || job.Notes)}</p>` : ''}
      <p>No exact full markdown report is linked to this job row yet.</p>
      <p>
        <button class="btn btn-primary" data-resume-url="${escHtml(job.url || '')}" data-resume-company="${escHtml(company)}" data-resume-title="${escHtml(title)}">
          <i data-feather="file-plus"></i> Tailor Resume
        </button>
      </p>
    </div>
  `, job.url || null);
  replaceIcons();
}

async function generateResume({ url, company, title }, triggerEl = null) {
  if (triggerEl) {
    triggerEl.disabled = true;
    triggerEl.innerHTML = '<span class="spin tiny-spin"></span> Working';
  }
  openModal('Tailoring resume…', `
    <div class="loader"><div class="spin"></div></div>
    <p class="text-dim text-sm" style="margin-top:12px">Using your base resume and this job posting to create an ATS-friendly PDF.</p>
  `, null);
  try {
    const r = await fetch('/api/jobs/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, company, title }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.output || data.error || 'Resume tailoring failed');
    const key = resumeKey({ url, company, title });
    _resumeDownloads.set(key, data.url);
    if (triggerEl) {
      triggerEl.outerHTML = renderResumeAction({ url, company, title });
    }
    openModal('Resume ready', `
      <div class="md">
        <p><strong>${escHtml(data.job?.company || company || 'Job')}</strong> — ${escHtml(data.job?.title || title || '')}</p>
        <p><a class="btn btn-primary" href="${escHtml(data.url)}" target="_blank" download><i data-feather="download"></i> Download Resume PDF</a></p>
        <iframe src="${escHtml(data.url)}" title="Generated resume" style="width:100%;height:70vh;border:1px solid var(--border);border-radius:8px;background:#fff"></iframe>
      </div>
    `, data.url);
    replaceIcons();
  } catch (error) {
    if (triggerEl) {
      triggerEl.disabled = false;
      triggerEl.innerHTML = '<i data-feather="file-plus"></i> Tailor';
      replaceIcons();
    }
    openModal('Resume tailoring failed', `
      <p style="color:var(--red)">${escHtml(error.message)}</p>
      <p class="text-dim text-sm">This action requires Claude. If you hit the Claude limit, try again after the limit resets.</p>
    `, null);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCANNER
═══════════════════════════════════════════════════════════════════════════ */
let _scanStream = null;

function pageScanner(el) {
  el.innerHTML = `
    <div class="page-hd">
      <div class="page-hd-text">
        <h1>Find Jobs</h1>
        <p>Search configured sources and add fresh roles to your workspace</p>
      </div>
    </div>

    <div class="card mb-5">
      <div class="card-hd"><h2>Options</h2></div>
      <div class="card-body">
        <div class="scan-opts">
          <div class="opt-group">
            <label class="opt-label">Time Filter</label>
            <select class="opt-select" id="s-since">
              <option value="all">All time</option>
              <option value="24h" selected>Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          </div>
          <div class="opt-group">
            <label class="opt-label">Company (optional)</label>
            <input class="opt-input" id="s-company" placeholder="e.g. Anthropic">
          </div>
          <div class="opt-group">
            <label class="opt-label">Flags</label>
            <label class="toggle-row">
              <label class="toggle">
                <input type="checkbox" id="s-dry">
                <span class="toggle-track"></span>
              </label>
              <span class="toggle-lbl">Dry run</span>
            </label>
            <label class="toggle-row">
              <label class="toggle">
                <input type="checkbox" id="s-verbose">
                <span class="toggle-track"></span>
              </label>
              <span class="toggle-lbl">Verbose</span>
            </label>
          </div>
        </div>

        <div class="scan-bar">
          <button class="btn btn-primary" id="s-run" onclick="startScan()">
            <i data-feather="play"></i> Find Jobs
          </button>
          <button class="btn btn-secondary" id="s-stop" onclick="stopScan()" style="display:none">
            <i data-feather="square"></i> Stop
          </button>
          <span class="scan-status" id="s-status"></span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-hd">
        <h2>Search Log</h2>
        <button class="btn btn-sm btn-secondary" onclick="clearTerm()">
          <i data-feather="trash-2"></i> Clear
        </button>
      </div>
      <div style="padding:0">
        <div class="terminal" id="s-term">Ready — press <span class="t-hi">Find Jobs</span> to start.\n</div>
      </div>
    </div>
  `;
  replaceIcons();
}

function startScan() {
  const since   = qs('#s-since').value;
  const company = qs('#s-company').value.trim();
  const dry     = qs('#s-dry').checked;
  const verbose = qs('#s-verbose').checked;

  const term   = qs('#s-term');
  term.innerHTML = '';

  qs('#s-run').style.display  = 'none';
  qs('#s-stop').style.display = 'flex';
  qs('#s-status').textContent = 'Searching…';

  const p = new URLSearchParams({ since, dryRun: dry, verbose });
  if (company) p.set('company', company);

  _scanStream = new EventSource(`/api/scan/stream?${p}`);

  function colorLine(text) {
    return text
      .replace(/(^\s*\+\s+.+)/g, '<span class="t-ok">$1</span>')
      .replace(/(·\s+.+\(0\s+new\))/g, '<span class="t-dim">$1</span>')
      .replace(/(━+)/g, '<span class="t-dim">$1</span>')
      .replace(/(New offers added:\s*\d+)/g, '<span class="t-ok">$1</span>')
      .replace(/(Portal Scan|Job Search)/g, '<span class="t-hi">$1</span>')
      .replace(/(Error|error|Failed|failed)/g, '<span class="t-err">$1</span>');
  }

  _scanStream.addEventListener('line', e => {
    const { text } = JSON.parse(e.data);
    const div = document.createElement('div');
    div.innerHTML = colorLine(text);
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
  });

  _scanStream.addEventListener('err', e => {
    try {
      const { text } = JSON.parse(e.data);
      const div = document.createElement('div');
      div.className = 't-err';
      div.textContent = text;
      term.appendChild(div);
    } catch {}
  });

  _scanStream.addEventListener('done', e => {
    const { code } = JSON.parse(e.data);
    _scanStream.close(); _scanStream = null;
    qs('#s-run').style.display  = 'flex';
    qs('#s-stop').style.display = 'none';
    qs('#s-status').textContent = code === 0 ? 'Done ✓' : `Exited (${code})`;
    const div = document.createElement('div');
    div.className = code === 0 ? 't-ok' : 't-err';
    div.textContent = code === 0 ? '\nSearch complete.' : `\nFailed (exit ${code})`;
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
    replaceIcons();
  });
}

function stopScan() {
  if (_scanStream) { _scanStream.close(); _scanStream = null; }
  const term = qs('#s-term');
  if (term) {
    const div = document.createElement('div');
    div.className = 't-warn';
    div.textContent = '\nStopped by user.';
    term.appendChild(div);
  }
  qs('#s-run').style.display  = 'flex';
  qs('#s-stop').style.display = 'none';
  qs('#s-status').textContent = 'Stopped';
  replaceIcons();
}

function clearTerm() {
  const term = qs('#s-term');
  if (term) term.innerHTML = 'Cleared.\n';
}

/* ═══════════════════════════════════════════════════════════════════════════
   MATCHER MODAL
═══════════════════════════════════════════════════════════════════════════ */
let _matchStream = null;

function openMatcherModal() {
  openModal("Score Today's Jobs", `
    <div style="margin-bottom:12px;color:var(--text-2);font-size:13px">
      Scores today's unreviewed jobs and creates the full analysis report for each one.
      Results save immediately as each job finishes.
    </div>
    <div class="opt-group" style="max-width:220px;margin-bottom:14px">
      <label class="opt-label">Optional max reviews</label>
      <input class="opt-input" id="m-limit" type="number" min="1" max="500" placeholder="All today's jobs">
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <button class="btn btn-primary" id="m-run" onclick="startMatcher()">
        <i data-feather="cpu"></i> Start Review
      </button>
      <button class="btn btn-secondary" id="m-stop" onclick="stopMatcher()" style="display:none">
        <i data-feather="square"></i> Stop
      </button>
    </div>
    <div class="terminal" id="m-term" style="min-height:200px">Ready — press Start Review.\n</div>
  `);
}

function startMatcher() {
  if (_matchStream) return;
  const term = qs('#m-term');
  term.innerHTML = '';
  qs('#m-run').style.display  = 'none';
  qs('#m-stop').style.display = 'flex';

  _matchStream = new EventSource('/api/match/stream?all=true');

  _matchStream.addEventListener('line', e => {
    const { text } = JSON.parse(e.data);
    const div = document.createElement('div');
    div.textContent = text;
    // Colorize score lines
    if (/✅/.test(text)) div.className = 't-ok';
    else if (/⚠|failed|timeout/.test(text)) div.className = 't-warn';
    else if (/━/.test(text)) div.className = 't-dim';
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
  });

  _matchStream.addEventListener('err', e => {
    const { text } = JSON.parse(e.data);
    const div = document.createElement('div');
    div.className = 't-err';
    div.textContent = text;
    term.appendChild(div);
  });

  _matchStream.addEventListener('done', e => {
    const { code } = JSON.parse(e.data);
    _matchStream.close(); _matchStream = null;
    qs('#m-run').style.display = 'flex';
    qs('#m-stop').style.display = 'none';
    const div = document.createElement('div');
    div.className = code === 0 ? 't-ok' : 't-err';
    div.textContent = code === 0 ? '\nDone. Refresh All Jobs to see every score.' : `\nFailed (exit ${code})`;
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
    replaceIcons();
  });
}

function stopMatcher() {
  if (_matchStream) { _matchStream.close(); _matchStream = null; }
  fetch('/api/match/stop', { method: 'POST' }).catch(() => {});
  const term = qs('#m-term');
  if (term) {
    const div = document.createElement('div');
    div.className = 't-warn';
    div.textContent = '\nStopped. Completed reviews are saved in All Jobs.';
    term.appendChild(div);
  }
  if (qs('#m-run')) qs('#m-run').style.display = 'flex';
  if (qs('#m-stop')) qs('#m-stop').style.display = 'none';
}

/* ═══════════════════════════════════════════════════════════════════════════
   EVALUATOR
═══════════════════════════════════════════════════════════════════════════ */
function pageEvaluator(el) {
  el.innerHTML = `
    <div class="page-hd">
      <div class="page-hd-text">
        <h1>Analyze Job Description</h1>
        <p>Paste a posting and get a fit score, gaps, and application notes</p>
      </div>
    </div>

    <div class="card mb-5">
      <div class="card-hd"><h2>Job Description</h2></div>
      <div class="card-body">
        <textarea id="eval-jd" style="width:100%;min-height:200px;padding:10px 12px;border-radius:var(--r-md);border:1px solid var(--border-med);background:var(--surface-2);color:var(--text-1);font-size:13px;font-family:inherit;resize:vertical;outline:none" placeholder="Paste the full job description here — title, responsibilities, requirements, company info…"></textarea>
        <div class="scan-bar" style="margin-top:12px">
          <button class="btn btn-primary" id="e-run" onclick="startEval()">
            <i data-feather="zap"></i> Analyze JD
          </button>
          <button class="btn btn-secondary" id="e-stop" onclick="stopEval()" style="display:none">
            <i data-feather="square"></i> Stop
          </button>
          <span class="scan-status" id="e-status"></span>
        </div>
      </div>
    </div>

    <div class="card" id="eval-output" style="display:none">
      <div class="card-hd">
        <h2>Evaluation</h2>
        <button class="btn btn-sm btn-secondary" onclick="clearEvalTerm()">
          <i data-feather="trash-2"></i> Clear
        </button>
      </div>
      <div style="padding:0">
        <div class="terminal" id="e-term"></div>
      </div>
    </div>
  `;
  replaceIcons();
}

let _evalReader = null;

async function startEval() {
  const jd = qs('#eval-jd')?.value?.trim();
  if (!jd) { toast('Paste a JD first'); return; }

  const term = qs('#e-term');
  const output = qs('#eval-output');
  output.style.display = 'block';
  term.innerHTML = '';

  qs('#e-run').style.display  = 'none';
  qs('#e-stop').style.display = 'flex';
  qs('#e-status').textContent = 'Evaluating…';

  try {
    const response = await fetch('/api/eval/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jd }),
    });

    const reader = response.body.getReader();
    _evalReader = reader;
    const dec = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        const eventLine = part.match(/^event: (.+)/m)?.[1];
        const dataLine  = part.match(/^data: (.+)/ms)?.[1];
        if (!dataLine) continue;
        let payload;
        try { payload = JSON.parse(dataLine); } catch { continue; }
        if (eventLine === 'line') {
          const div = document.createElement('div');
          div.textContent = payload.text;
          term.appendChild(div);
          term.scrollTop = term.scrollHeight;
        } else if (eventLine === 'err') {
          const div = document.createElement('div');
          div.className = 't-err';
          div.textContent = payload.text;
          term.appendChild(div);
          term.scrollTop = term.scrollHeight;
        } else if (eventLine === 'done') {
          const div = document.createElement('div');
          div.className = payload.code === 0 ? 't-ok' : 't-err';
          div.textContent = payload.code === 0 ? '\n✓ Evaluation complete.' : `\n✗ Failed (exit ${payload.code})`;
          term.appendChild(div);
          term.scrollTop = term.scrollHeight;
        }
      }
    }
  } catch(e) {
    const div = document.createElement('div');
    div.className = 't-err';
    div.textContent = 'Error: ' + e.message;
    qs('#e-term')?.appendChild(div);
  }

  _evalReader = null;
  qs('#e-run').style.display  = 'flex';
  qs('#e-stop').style.display = 'none';
  qs('#e-status').textContent = 'Done';
  replaceIcons();
}

function stopEval() {
  if (_evalReader) { _evalReader.cancel(); _evalReader = null; }
  qs('#e-run').style.display  = 'flex';
  qs('#e-stop').style.display = 'none';
  qs('#e-status').textContent = 'Stopped';
  const div = document.createElement('div');
  div.className = 't-warn';
  div.textContent = '\n⚠ Stopped by user.';
  qs('#e-term')?.appendChild(div);
}

function clearEvalTerm() {
  const term = qs('#e-term');
  if (term) term.innerHTML = '';
}

/* ═══════════════════════════════════════════════════════════════════════════
   PROFILE PAGE
═══════════════════════════════════════════════════════════════════════════ */
let _profileTab = 'resume';
let _templateOptions = [];
let _selectedTemplateId = null;
let _templateDirtyMode = null;
let _profileData = {};

// ── CV parser ─────────────────────────────────────────────────────────────
function parseCvMd(md) {
  const lines = (md || '').split('\n');
  let name = '', preamble = [], sections = [], cur = null;
  for (const line of lines) {
    if (line.startsWith('# ') && !name) { name = line.slice(2).trim(); continue; }
    if (line.startsWith('## ')) {
      if (cur) sections.push(cur);
      cur = { title: line.slice(3).trim(), lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    } else if (name) {
      preamble.push(line);
    }
  }
  if (cur) sections.push(cur);
  // trim trailing blank lines from each section
  sections = sections.map(s => ({ ...s, content: s.lines.join('\n').replace(/^\n+|\n+$/g, '') }));
  return { name, preamble: preamble.join('\n').replace(/^\n+|\n+$/g, ''), sections };
}

function buildCvMd(name, preamble, sections) {
  const parts = [`# ${name}`];
  if (preamble.trim()) parts.push('', preamble.trim());
  for (const s of sections) {
    parts.push('', `## ${s.title}`, s.content);
  }
  return parts.join('\n') + '\n';
}

function parseContactLine(preamble = '') {
  const line = String(preamble || '').split('\n').find(l => l.trim()) || '';
  const parts = line.split(/\s*[·•]\s*/).map(part => part.trim()).filter(Boolean);
  const out = { location: '', phone: '', email: '', linkedin: '', extra: [] };
  for (const part of parts) {
    if (!out.email && /@/.test(part)) out.email = part;
    else if (!out.phone && /(?:\+?\d[\d\s().-]{6,})/.test(part)) out.phone = part;
    else if (!out.linkedin && /linkedin/i.test(part)) out.linkedin = part;
    else if (!out.location) out.location = part;
    else out.extra.push(part);
  }
  return out;
}

function buildContactLineFromFields(fallback = '') {
  const values = [
    qs('#cv-contact-location')?.value.trim(),
    qs('#cv-contact-phone')?.value.trim(),
    qs('#cv-contact-email')?.value.trim(),
    qs('#cv-contact-linkedin')?.value.trim(),
    qs('#cv-contact-extra')?.value.trim(),
  ].filter(Boolean);
  return values.length ? values.join(' · ') : fallback;
}

function isBulletLine(line) {
  return /^\s*(?:[-*•]|\u2013|\u2014)\s+/.test(line);
}

function splitCvSectionBlocks(section) {
  const title = String(section.title || '').toLowerCase();
  const content = String(section.content || '').trim();
  if (!content) return [''];

  if (/skill|certification|award|coursework|summary|competenc/.test(title)) return [content];

  const blankBlocks = content
    .split(/\n\s*\n+/)
    .map(block => block.trim())
    .filter(Boolean);
  if (blankBlocks.length > 1) return blankBlocks;

  const lines = content.split('\n').map(line => line.trim().replace(/[ \t]{2,}/g, ' ')).filter(Boolean);
  if (lines.length <= 4) return [content];

  if (/education/.test(title) && !lines.some(isBulletLine)) {
    const grouped = [];
    for (let i = 0; i < lines.length; i += 2) {
      grouped.push(lines.slice(i, i + 2).join('\n'));
    }
    return grouped;
  }

  const blocks = [];
  let current = [];
  let sawBullet = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bullet = isBulletLine(line);
    const lowerOrWrapped = /^[a-z0-9(]/.test(line) || line.length > 82;
    const looksLikeNewEntry =
      current.length > 0 &&
      !bullet &&
      !lowerOrWrapped &&
      (sawBullet || /education/.test(title));

    if (looksLikeNewEntry) {
      blocks.push(current.join('\n').trim());
      current = [];
      sawBullet = false;
    }

    current.push(line);
    if (bullet) sawBullet = true;
  }

  if (current.length) blocks.push(current.join('\n').trim());
  return blocks.length ? blocks : [content];
}

function sectionIcon(title = '') {
  const t = title.toLowerCase();
  if (/education/.test(t)) return 'book-open';
  if (/experience|work|employment/.test(t)) return 'briefcase';
  if (/project/.test(t)) return 'layers';
  if (/skill|technical/.test(t)) return 'tool';
  if (/certification|award|coursework/.test(t)) return 'award';
  if (/summary|profile/.test(t)) return 'align-left';
  return 'file-text';
}

function blockTitle(sectionTitle, index, total) {
  if (total <= 1) return 'Details';
  const t = String(sectionTitle || '').toLowerCase();
  if (/education/.test(t)) return `School ${index + 1}`;
  if (/experience|work|employment/.test(t)) return `Role ${index + 1}`;
  if (/project/.test(t)) return `Project ${index + 1}`;
  return `Entry ${index + 1}`;
}

function textareaRows(value, min = 5, max = 12) {
  const lines = String(value || '').split('\n').length;
  return Math.max(min, Math.min(max, lines + 1));
}

function cleanResumeLine(value) {
  return String(value || '').trim().replace(/[ \t]{2,}/g, ' ');
}

function splitPlaceLine(value) {
  const line = cleanResumeLine(value);
  const match = line.match(/^(.+)\s+([A-Z][A-Za-z .'-]+,\s*(?:[A-Z]{2}|[A-Za-z .'-]+))$/);
  return match
    ? { name: match[1].trim(), location: match[2].trim() }
    : { name: line, location: '' };
}

function splitDateTail(value) {
  const line = cleanResumeLine(value);
  const datePattern = '(?:Expected\\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{4}(?:\\s*[–-]\\s*(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{4}|Present))?';
  const match = line.match(new RegExp(`^(.*?)\\s+(${datePattern})$`, 'i'));
  return match
    ? { text: match[1].trim(), dates: match[2].trim() }
    : { text: line, dates: '' };
}

function splitGpa(value) {
  const line = cleanResumeLine(value);
  const match = line.match(/^(.*?)(?:\s+[–-]\s*)?GPA:\s*([\d.]+)$/i);
  return match
    ? { degree: match[1].trim(), gpa: match[2].trim() }
    : { degree: line, gpa: '' };
}

function normalizeBulletText(lines) {
  const bullets = [];
  for (const raw of lines) {
    const line = cleanResumeLine(raw).replace(/^[–—•*-]\s*/, '').trim();
    if (!line) continue;
    if (isBulletLine(raw) || !bullets.length) bullets.push(line);
    else bullets[bullets.length - 1] += ` ${line}`;
  }
  return bullets.join('\n');
}

function parseEducationEntry(block) {
  const lines = String(block || '').split('\n').map(cleanResumeLine).filter(Boolean);
  const schoolLine = splitPlaceLine(lines[0] || '');
  const degreeDate = splitDateTail(lines.slice(1).join(' '));
  const degreeGpa = splitGpa(degreeDate.text);
  return {
    type: 'education',
    fields: [
      ['school', 'School', schoolLine.name, 'input'],
      ['location', 'Location', schoolLine.location, 'input'],
      ['degree', 'Degree / Program', degreeGpa.degree, 'input'],
      ['gpa', 'GPA', degreeGpa.gpa, 'input'],
      ['date', 'Graduation / Dates', degreeDate.dates, 'input'],
    ],
  };
}

function parseRoleEntry(block) {
  const lines = String(block || '').split('\n').map(cleanResumeLine).filter(Boolean);
  const companyLine = splitPlaceLine(lines[0] || '');
  const roleDate = splitDateTail(lines[1] || '');
  return {
    type: 'role',
    fields: [
      ['company', 'Company', companyLine.name, 'input'],
      ['location', 'Location', companyLine.location, 'input'],
      ['title', 'Title', roleDate.text, 'input'],
      ['dates', 'Dates', roleDate.dates, 'input'],
      ['bullets', 'Achievements / Responsibilities', normalizeBulletText(lines.slice(2)), 'textarea'],
    ],
  };
}

function parseProjectEntry(block) {
  const lines = String(block || '').split('\n').map(cleanResumeLine).filter(Boolean);
  const [name = '', focus = ''] = (lines[0] || '').split(/\s+[–—-]\s+/, 2);
  return {
    type: 'project',
    fields: [
      ['name', 'Project Name', name, 'input'],
      ['focus', 'Methods / Focus', focus, 'input'],
      ['bullets', 'Details / Impact', normalizeBulletText(lines.slice(1)), 'textarea'],
    ],
  };
}

function parseDetailsEntry(block) {
  const lines = String(block || '').split('\n').map(cleanResumeLine).filter(Boolean);
  const colonLines = lines.filter(line => line.includes(':'));
  if (colonLines.length >= 2) {
    return {
      type: 'details',
      fields: colonLines.map((line, index) => {
        const [label, ...rest] = line.split(':');
        return [`detail_${index}`, label.trim(), rest.join(':').trim(), 'textarea'];
      }),
    };
  }
  return {
    type: 'details',
    fields: [['details', 'Details', lines.join('\n'), 'textarea']],
  };
}

function parseResumeEntry(sectionTitle, block) {
  const title = String(sectionTitle || '').toLowerCase();
  if (/education/.test(title)) return parseEducationEntry(block);
  if (/experience|work|employment/.test(title)) return parseRoleEntry(block);
  if (/project/.test(title)) return parseProjectEntry(block);
  return parseDetailsEntry(block);
}

function renderResumeEntry(sectionTitle, block, secIndex, blockIndex, totalBlocks) {
  const entry = parseResumeEntry(sectionTitle, block);
  return `
    <div class="resume-entry" data-entry-type="${entry.type}">
      <div class="resume-entry-title">${escHtml(blockTitle(sectionTitle, blockIndex, totalBlocks))}</div>
      <div class="resume-field-grid">
        ${entry.fields.map(([key, label, value, kind]) => {
          const common = `class="resume-input cv-field cv-structured-field" data-sec="${secIndex}" data-block="${blockIndex}" data-type="${entry.type}" data-field="${escHtml(key)}"`;
          return `
            <label class="resume-field${kind === 'textarea' ? ' wide' : ''}">
              <span>${escHtml(label)}</span>
              ${kind === 'textarea'
                ? `<textarea ${common} rows="${textareaRows(value, 3, 8)}">${escHtml(value)}</textarea>`
                : `<input ${common} value="${escHtml(value)}">`}
            </label>`;
        }).join('')}
      </div>
    </div>
  `;
}

function valueFromResumeFields(secIndex, blockIndex, key) {
  return qs(`.cv-structured-field[data-sec="${secIndex}"][data-block="${blockIndex}"][data-field="${key}"]`)?.value.trim() || '';
}

function bulletLines(value) {
  return String(value || '')
    .split('\n')
    .map(line => line.trim().replace(/^[–—•*-]\s*/, ''))
    .filter(Boolean)
    .map(line => `– ${line}`);
}

function composeResumeEntry(secIndex, blockIndex) {
  const first = qs(`.cv-structured-field[data-sec="${secIndex}"][data-block="${blockIndex}"]`);
  if (!first) return '';
  const type = first.getAttribute('data-type');

  if (type === 'education') {
    const school = valueFromResumeFields(secIndex, blockIndex, 'school');
    const location = valueFromResumeFields(secIndex, blockIndex, 'location');
    const degree = valueFromResumeFields(secIndex, blockIndex, 'degree');
    const gpa = valueFromResumeFields(secIndex, blockIndex, 'gpa');
    const date = valueFromResumeFields(secIndex, blockIndex, 'date');
    const degreeLine = [degree, gpa ? `GPA: ${gpa}` : '', date].filter(Boolean).join(' ');
    return [[school, location].filter(Boolean).join(' '), degreeLine].filter(Boolean).join('\n');
  }

  if (type === 'role') {
    const company = valueFromResumeFields(secIndex, blockIndex, 'company');
    const location = valueFromResumeFields(secIndex, blockIndex, 'location');
    const title = valueFromResumeFields(secIndex, blockIndex, 'title');
    const dates = valueFromResumeFields(secIndex, blockIndex, 'dates');
    const bullets = bulletLines(valueFromResumeFields(secIndex, blockIndex, 'bullets'));
    return [
      [company, location].filter(Boolean).join(' '),
      [title, dates].filter(Boolean).join(' '),
      ...bullets,
    ].filter(Boolean).join('\n');
  }

  if (type === 'project') {
    const name = valueFromResumeFields(secIndex, blockIndex, 'name');
    const focus = valueFromResumeFields(secIndex, blockIndex, 'focus');
    const bullets = bulletLines(valueFromResumeFields(secIndex, blockIndex, 'bullets'));
    return [
      [name, focus].filter(Boolean).join(' – '),
      ...bullets,
    ].filter(Boolean).join('\n');
  }

  const fields = qsa(`.cv-structured-field[data-sec="${secIndex}"][data-block="${blockIndex}"]`);
  if (fields.length > 1) {
    return fields.map(field => {
      const label = field.closest('.resume-field')?.querySelector('span')?.textContent || 'Details';
      return `${label}: ${field.value.trim()}`;
    }).filter(Boolean).join('\n');
  }
  return fields[0]?.value.trim() || '';
}

async function pageProfile(el) {
  const [profileYaml, profileData, cvContent, templateHtml, templateData] = await Promise.all([
    fetch('/api/profile').then(r => r.text()),
    fetch('/api/profile/data').then(r => r.json()).catch(() => ({})),
    fetch('/api/cv').then(r => r.text()),
    fetch('/api/template').then(r => r.text()),
    fetch('/api/template/options').then(r => r.json()).catch(() => ({ options: [], active: null })),
  ]);
  _profileData = profileData || {};
  _templateOptions = templateData.options || [];
  _selectedTemplateId = templateData.active || _templateOptions[0]?.id || null;

  const cv = parseCvMd(cvContent);
  const contact = parseContactLine(cv.preamble);

  el.innerHTML = `
    <div class="page-hd">
      <div class="page-hd-text">
        <h1>Profile</h1>
        <p>Resume · preferences · CV template</p>
      </div>
    </div>

    <div class="profile-tabs mb-5">
      <button class="profile-tab${_profileTab==='resume'?' active':''}" onclick="switchProfileTab('resume')">
        <i data-feather="file-text"></i> Personal Info
      </button>
      <button class="profile-tab${_profileTab==='prefs'?' active':''}" onclick="switchProfileTab('prefs')">
        <i data-feather="sliders"></i> My Preferences
      </button>
      <button class="profile-tab${_profileTab==='template'?' active':''}" onclick="switchProfileTab('template')">
        <i data-feather="layout"></i> CV Template
      </button>
    </div>

    <!-- PERSONAL INFO TAB (parses cv.md) -->
    <div id="tab-resume" class="profile-tab-body${_profileTab==='resume'?'':' hidden'}">
      <div class="card mb-4">
        <div class="card-hd"><h2>Import Resume</h2></div>
        <div class="card-body">
          <div class="upload-zone" onclick="qs('#resume-file').click()" ondragover="event.preventDefault()" ondrop="handleResumeDrop(event)">
            <i data-feather="upload"></i>
            <p>Drop a <strong>PDF</strong>, <strong>.docx</strong>, <strong>.md</strong>, or <strong>.txt</strong> — parsed and loaded below</p>
            <input type="file" id="resume-file" accept=".pdf,.doc,.docx,.md,.txt,application/pdf" style="display:none" onchange="handleResumeFile(event)">
          </div>
        </div>
      </div>

      <div class="card mb-4">
        <div class="card-hd">
          <h2>Name &amp; Contact</h2>
          <div class="flex gap-2">
            <span id="cv-dirty" style="font-size:13px;color:var(--orange);align-self:center;display:none">Unsaved</span>
            <button class="btn btn-secondary" id="cv-save" onclick="saveCvFields()" disabled>
              <i data-feather="save"></i> Save
            </button>
            <button class="btn btn-primary" onclick="genPDF()">
              <i data-feather="download"></i> Generate PDF
            </button>
          </div>
        </div>
        <div class="card-body">
          <div class="info-grid">
            <div class="info-field" style="grid-column:1/-1">
              <label class="info-label"><i data-feather="user"></i> Full Name</label>
              <input class="info-input cv-field" id="cv-name" value="${escHtml(cv.name)}" placeholder="Your name">
            </div>
            <div class="info-field">
              <label class="info-label"><i data-feather="map-pin"></i> Location</label>
              <input class="info-input cv-field" id="cv-contact-location" value="${escHtml(contact.location)}" placeholder="Philadelphia, PA">
            </div>
            <div class="info-field">
              <label class="info-label"><i data-feather="phone"></i> Phone</label>
              <input class="info-input cv-field" id="cv-contact-phone" value="${escHtml(contact.phone)}" placeholder="(555) 555-5555">
            </div>
            <div class="info-field">
              <label class="info-label"><i data-feather="mail"></i> Email</label>
              <input class="info-input cv-field" id="cv-contact-email" value="${escHtml(contact.email)}" placeholder="email@example.com">
            </div>
            <div class="info-field">
              <label class="info-label"><i data-feather="linkedin"></i> LinkedIn</label>
              <input class="info-input cv-field" id="cv-contact-linkedin" value="${escHtml(contact.linkedin)}" placeholder="linkedin.com/in/you">
            </div>
            <div class="info-field" style="grid-column:1/-1">
              <label class="info-label"><i data-feather="plus-circle"></i> Extra Contact Items</label>
              <input class="info-input cv-field" id="cv-contact-extra" value="${escHtml(contact.extra.join(' · '))}" placeholder="Portfolio · GitHub">
            </div>
          </div>
        </div>
      </div>

      <div class="resume-section-grid">
        ${cv.sections.map((s, i) => {
          const blocks = splitCvSectionBlocks(s);
          return `
          <div class="resume-edit-card card mb-4">
            <div class="card-hd resume-edit-head">
              <div>
                <h2><i data-feather="${sectionIcon(s.title)}"></i> ${escHtml(s.title)}</h2>
                <p>${blocks.length} editable ${blocks.length === 1 ? 'block' : 'blocks'}</p>
              </div>
            </div>
            <div class="card-body">
              <div class="resume-entry-list">
                ${blocks.map((block, blockIndex) => renderResumeEntry(s.title, block, i, blockIndex, blocks.length)).join('')}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- MY PREFERENCES TAB (profile.yml) -->
    <div id="tab-prefs" class="profile-tab-body${_profileTab==='prefs'?'':' hidden'}">
      ${renderInfoForm(profileData, profileYaml)}
    </div>

    <!-- TEMPLATE TAB -->
    <div id="tab-template" class="profile-tab-body${_profileTab==='template'?'':' hidden'}">
      <div class="card">
        <div class="card-hd">
          <h2>CV Templates</h2>
          <div class="flex gap-2">
            <span id="tpl-dirty" style="font-size:13px;color:var(--orange);align-self:center;display:none">Template changed</span>
            <button class="btn btn-secondary" id="tpl-save" onclick="saveTemplateChanges()" disabled>
              <i data-feather="save"></i> Save
            </button>
            <button class="btn btn-primary" onclick="genPDF()">
              <i data-feather="download"></i> Generate PDF
            </button>
          </div>
        </div>
        <div class="card-body">
          <div id="template-picker"></div>
          <details style="margin-top:16px">
            <summary style="cursor:pointer;color:var(--text-2);font-size:13px">Advanced: edit HTML source</summary>
            <div class="card" style="margin-top:10px">
              <div class="card-body" style="padding:0">
                <textarea class="cv-editor" id="tpl-ed" spellcheck="false" style="height:420px;border-radius:0 0 var(--r-lg) var(--r-lg)">${escHtml(templateHtml)}</textarea>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  `;
  replaceIcons();

  // Mark cv fields dirty on any change
  qsa('.cv-field').forEach(el => {
    el.addEventListener('input', () => {
      const save = qs('#cv-save');
      const dirty = qs('#cv-dirty');
      if (save) save.disabled = false;
      if (dirty) dirty.style.display = 'inline';
    });
  });

  // Template editor dirty flag
  const tplEd = qs('#tpl-ed');
  if (tplEd) {
    tplEd.addEventListener('input', () => {
      qs('#tpl-save').disabled = false;
      qs('#tpl-dirty').textContent = 'Custom source changed';
      qs('#tpl-dirty').style.display = 'inline';
      _templateDirtyMode = 'source';
    });
  }
  renderTemplatePicker();
}

// Save cv.md from the structured fields
async function saveCvFields() {
  const rawCv = await fetch('/api/cv').then(r => r.text());
  const cv = parseCvMd(rawCv);

  const name = qs('#cv-name')?.value ?? cv.name;
  const preamble = buildContactLineFromFields(cv.preamble);
  const sections = cv.sections.map((s, i) => ({
    title: s.title,
    content: [...new Set(qsa(`.cv-structured-field[data-sec="${i}"]`).map(el => el.getAttribute('data-block')))]
      .sort((a, b) => Number(a) - Number(b))
      .map(blockIndex => composeResumeEntry(i, blockIndex))
      .filter(Boolean)
      .join('\n\n') || s.content,
  }));

  const md = buildCvMd(name, preamble, sections);
  const r = await fetch('/api/cv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: md }),
  });
  if (r.ok) {
    qs('#cv-save').disabled = true;
    qs('#cv-dirty').style.display = 'none';
    toast('Resume saved');
  } else toast('Save failed');
}

function renderTemplatePicker() {
  const mount = qs('#template-picker');
  if (!mount) return;

  mount.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
      ${_templateOptions.map(option => `
        <button class="template-option${option.id === _selectedTemplateId ? ' active' : ''}" data-template-id="${option.id}" style="text-align:left;border:1px solid ${option.id === _selectedTemplateId ? 'var(--blue)' : 'var(--border)'};background:${option.id === _selectedTemplateId ? 'rgba(37,99,235,0.06)' : 'var(--surface-1)'};border-radius:8px;padding:14px;cursor:pointer">
          <div style="font-size:15px;font-weight:600;color:var(--text-1)">${escHtml(option.name)}</div>
          <div style="font-size:13px;color:var(--text-2);margin-top:6px;line-height:1.5">${escHtml(option.description)}</div>
        </button>
      `).join('')}
    </div>
  `;

  qsa('.template-option', mount).forEach(button => {
    button.addEventListener('click', () => {
      _selectedTemplateId = button.getAttribute('data-template-id');
      qs('#tpl-save').disabled = false;
      qs('#tpl-dirty').textContent = 'Template changed';
      qs('#tpl-dirty').style.display = 'inline';
      _templateDirtyMode = 'choice';
      renderTemplatePicker();
      updateTemplatePreview();
    });
  });

  updateTemplatePreview();
}

function updateTemplatePreview() {
  const frame = qs('#template-preview');
  if (!frame) return;
  const selected = _templateOptions.find(option => option.id === _selectedTemplateId) || _templateOptions[0];
  frame.srcdoc = selected?.preview || '<p style="font-family:sans-serif;padding:24px">No preview available.</p>';
}

// ── Info form builder ─────────────────────────────────────────────────────
function renderInfoForm(profile = {}, profileYaml = '') {
  const candidate = profile.candidate || {};
  const narrative = profile.narrative || {};
  const compensation = profile.compensation || {};
  const location = profile.location || {};
  const targetRoles = profile.target_roles || {};
  const primaryRoles = Array.isArray(targetRoles.primary) ? targetRoles.primary.join(', ') : '';
  const superpowers = Array.isArray(narrative.superpowers) ? narrative.superpowers.join('\n') : '';
  const excludedLevels = Array.isArray(targetRoles.excluded_levels) ? targetRoles.excluded_levels.join(', ') : '';
  const preferences = Array.isArray(location.preferences) ? location.preferences.join('\n') : '';
  const archetypes = Array.isArray(targetRoles.archetypes)
    ? targetRoles.archetypes.map(item => [item.name || '', item.level || '', item.fit || ''].join(' | ')).join('\n')
    : '';
  const proofPoints = Array.isArray(narrative.proof_points)
    ? narrative.proof_points.map(item => [item.name || '', item.hero_metric || ''].join(' | ')).join('\n')
    : '';

  return `
    <div class="card mb-4">
      <div class="card-hd"><h2>Identity</h2><span style="font-size:12px;color:var(--text-2)">These fields are backed by <code>config/profile.yml</code></span></div>
      <div class="card-body">
        <div class="info-grid">
          ${[
            ['candidate.full_name', 'Full Name', 'user', candidate.full_name],
            ['candidate.email', 'Email', 'mail', candidate.email],
            ['candidate.phone', 'Phone', 'phone', candidate.phone],
            ['candidate.location', 'Profile Location', 'map-pin', candidate.location],
            ['candidate.linkedin', 'LinkedIn', 'linkedin', candidate.linkedin],
            ['candidate.github', 'GitHub', 'github', candidate.github],
            ['candidate.portfolio_url', 'Portfolio URL', 'globe', candidate.portfolio_url],
          ].map(([path, label, icon, value]) => `
            <div class="info-field">
              <label class="info-label"><i data-feather="${icon}"></i> ${label}</label>
              <input class="info-input" data-profile-path="${path}" value="${escHtml(value || '')}" placeholder="${label}">
            </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="card mb-4">
      <div class="card-hd"><h2>Targets & Narrative</h2></div>
      <div class="card-body">
        <div class="info-grid">
          <div class="info-field" style="grid-column:1/-1">
            <label class="info-label"><i data-feather="target"></i> Primary Roles</label>
            <input class="info-input" data-profile-path="target_roles.primary" value="${escHtml(primaryRoles)}" placeholder="Senior Data Engineer, Analytics Engineer">
          </div>
          <div class="info-field" style="grid-column:1/-1">
            <label class="info-label"><i data-feather="slash"></i> Excluded Levels</label>
            <input class="info-input" data-profile-path="target_roles.excluded_levels" value="${escHtml(excludedLevels)}" placeholder="Senior, Staff, Principal">
          </div>
          <div class="info-field" style="grid-column:1/-1">
            <label class="info-label"><i data-feather="align-left"></i> Headline</label>
            <input class="info-input" data-profile-path="narrative.headline" value="${escHtml(narrative.headline || '')}" placeholder="Your professional headline">
          </div>
          <div class="info-field" style="grid-column:1/-1">
            <label class="info-label"><i data-feather="message-square"></i> Exit Story</label>
            <textarea class="info-input" data-profile-path="narrative.exit_story" rows="3" placeholder="Short positioning story">${escHtml(narrative.exit_story || '')}</textarea>
          </div>
          <div class="info-field" style="grid-column:1/-1">
            <label class="info-label"><i data-feather="zap"></i> Superpowers</label>
            <textarea class="info-input" data-profile-path="narrative.superpowers" rows="4" placeholder="One per line">${escHtml(superpowers)}</textarea>
          </div>
          <div class="info-field" style="grid-column:1/-1">
            <label class="info-label"><i data-feather="layers"></i> Archetypes</label>
            <textarea class="info-input" data-profile-path="target_roles.archetypes" rows="5" placeholder="Name | Level | Fit">${escHtml(archetypes)}</textarea>
          </div>
          <div class="info-field" style="grid-column:1/-1">
            <label class="info-label"><i data-feather="award"></i> Proof Points</label>
            <textarea class="info-input" data-profile-path="narrative.proof_points" rows="5" placeholder="Project name | Hero metric">${escHtml(proofPoints)}</textarea>
          </div>
        </div>
      </div>
    </div>

    <div class="card mb-4">
      <div class="card-hd"><h2>Compensation &amp; Location</h2></div>
      <div class="card-body">
        <div class="info-grid">
          ${[
            ['compensation.target_range', 'Target Range', 'dollar-sign', compensation.target_range],
            ['compensation.minimum', 'Minimum', 'credit-card', compensation.minimum],
            ['compensation.currency', 'Currency', 'circle', compensation.currency],
            ['compensation.location_flexibility', 'Location Flexibility', 'navigation', compensation.location_flexibility],
            ['location.city', 'City', 'map-pin', location.city],
            ['location.country', 'Country', 'flag', location.country],
            ['location.state', 'State', 'map', location.state],
            ['location.timezone', 'Timezone', 'clock', location.timezone],
            ['location.visa_status', 'Visa Status', 'shield', location.visa_status],
            ['location.job_search_scope', 'Job Search Scope', 'globe', location.job_search_scope],
          ].map(([path, label, icon, value]) => `
            <div class="info-field">
              <label class="info-label"><i data-feather="${icon}"></i> ${label}</label>
              <input class="info-input" data-profile-path="${path}" value="${escHtml(value || '')}" placeholder="${label}">
            </div>`).join('')}
          <div class="info-field" style="grid-column:1/-1">
            <label class="info-label"><i data-feather="map"></i> Location Preferences</label>
            <textarea class="info-input" data-profile-path="location.preferences" rows="4" placeholder="One preference per line">${escHtml(preferences)}</textarea>
          </div>
        </div>
      </div>
    </div>

    <div class="flex gap-2">
      <button class="btn btn-primary" onclick="saveProfileInfo()">
        <i data-feather="save"></i> Save Profile
      </button>
    </div>
  `;
}

function switchProfileTab(tab) {
  _profileTab = tab;
  qsa('.profile-tab').forEach(b => b.classList.toggle('active', b.getAttribute('onclick').includes(`'${tab}'`)));
  qsa('.profile-tab-body').forEach(d => d.classList.add('hidden'));
  const pane = qs(`#tab-${tab}`);
  if (pane) { pane.classList.remove('hidden'); replaceIcons(); }
}

async function saveProfileInfo() {
  const structured = JSON.parse(JSON.stringify(_profileData || {}));

  function setDeep(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {};
      cur = cur[key];
    }
    cur[parts[parts.length - 1]] = value;
  }

  qsa('.info-input[data-profile-path]').forEach(inp => {
    const path = inp.getAttribute('data-profile-path');
    let value = inp.value.trim();
    if (path === 'target_roles.primary') {
      value = value ? value.split(',').map(item => item.trim()).filter(Boolean) : [];
    } else if (path === 'narrative.superpowers') {
      value = value ? value.split('\n').map(item => item.trim()).filter(Boolean) : [];
    } else if (path === 'target_roles.excluded_levels') {
      value = value ? value.split(',').map(item => item.trim()).filter(Boolean) : [];
    } else if (path === 'location.preferences') {
      value = value ? value.split('\n').map(item => item.trim()).filter(Boolean) : [];
    } else if (path === 'target_roles.archetypes') {
      value = value
        ? value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
            const [name = '', level = '', fit = ''] = line.split('|').map(part => part.trim());
            return { name, level, fit };
          })
        : [];
    } else if (path === 'narrative.proof_points') {
      value = value
        ? value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
            const [name = '', hero_metric = ''] = line.split('|').map(part => part.trim());
            return { name, hero_metric };
          })
        : [];
    }
    setDeep(structured, path, value);
  });

  const r = await fetch('/api/profile/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: structured }),
  });

  if (r.ok) {
    _profileData = structured;
    toast('Profile saved');
    renderPage('profile');
  } else toast('Save failed');
}

async function saveCV() {
  const content = qs('#cv-ed')?.value;
  if (!content) return;
  const ok = await saveCVContent(content);
  if (ok) {
    qs('#cv-save').disabled = true;
    qs('#cv-dirty').style.display = 'none';
    toast('Resume saved');
  }
}

async function saveCVContent(content) {
  const r = await fetch('/api/cv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!r.ok) toast('Save failed');
  return r.ok;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function uploadResumeFile(file) {
  const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
  const r = await fetch('/api/cv/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type,
      contentBase64,
    }),
  });
  const data = await r.json();
  if (!r.ok || !data.ok) throw new Error(data.error || 'Upload failed');
  return data.content;
}

async function saveTemplateChoice() {
  if (!_selectedTemplateId) return;
  const r = await fetch('/api/template/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: _selectedTemplateId }),
  });
  if (r.ok) {
    qs('#tpl-save').disabled = true;
    qs('#tpl-dirty').style.display = 'none';
    _templateDirtyMode = null;
    toast('Template selection saved');
  } else toast('Save failed');
}

async function saveTemplate() {
  const content = qs('#tpl-ed')?.value;
  if (!content) return;
  const r = await fetch('/api/template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (r.ok) {
    qs('#tpl-save').disabled = true;
    qs('#tpl-dirty').style.display = 'none';
    _templateDirtyMode = null;
    toast('Template saved');
    renderPage('profile');
  } else toast('Save failed');
}

async function saveTemplateChanges() {
  if (_templateDirtyMode === 'source') return saveTemplate();
  return saveTemplateChoice();
}

async function genPDF() {
  toast('Generating PDF…');
  const r = await fetch('/api/pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await r.json();
  toast(data.ok ? `PDF saved: ${data.path?.split('/').pop() || 'output/'}` : `PDF failed — ${String(data.output || 'unknown error').slice(0, 80)}`);
}

function handleResumeFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  (async () => {
    toast(`Importing ${file.name}…`);
    await uploadResumeFile(file); // saves to cv.md server-side
    toast(`Imported — reloading fields…`);
    // Reload the profile page to show freshly parsed fields
    const el = qs('#page-profile');
    if (el) await pageProfile(el);
  })().catch(error => {
    toast(error.message);
  });
}

function handleResumeDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (!file) return;
  handleResumeFile({ target: { files: [file] } });
}

/* ═══════════════════════════════════════════════════════════════════════════
   GLOBAL EXPORTS & INIT
═══════════════════════════════════════════════════════════════════════════ */
window.navigate      = navigate;
window.copy          = copy;
window.openReport    = openReport;
window.startScan        = startScan;
window.toggleScoreSort  = toggleScoreSort;
window.stopScan      = stopScan;
window.clearTerm     = clearTerm;
window.saveCV           = saveCV;
window.saveCvFields     = saveCvFields;
window.saveTemplate     = saveTemplate;
window.saveTemplateChoice = saveTemplateChoice;
window.saveTemplateChanges = saveTemplateChanges;
window.saveProfileInfo  = saveProfileInfo;
window.switchProfileTab = switchProfileTab;
window.handleResumeFile = handleResumeFile;
window.handleResumeDrop = handleResumeDrop;
window.genPDF           = genPDF;
window.updateStatus    = updateStatus;
window.updateJobStatus = updateJobStatus;
window.startEval       = startEval;
window.openScoredJob   = openScoredJob;
window.generateResume  = generateResume;
window.openMatcherModal = openMatcherModal;
window.startMatcher    = startMatcher;
window.stopMatcher     = stopMatcher;
window.stopEval        = stopEval;
window.clearEvalTerm   = clearEvalTerm;

document.addEventListener('click', event => {
  const resumeBtn = event.target.closest('[data-resume-url], [data-resume-company][data-resume-title]');
  if (resumeBtn) {
    event.preventDefault();
    event.stopPropagation();
    generateResume({
      url: resumeBtn.getAttribute('data-resume-url') || '',
      company: resumeBtn.getAttribute('data-resume-company') || '',
      title: resumeBtn.getAttribute('data-resume-title') || '',
    }, resumeBtn);
    return;
  }

  const reportTarget = event.target.closest('[data-report-file]');
  if (reportTarget) {
    event.preventDefault();
    event.stopPropagation();
    openReport(reportTarget.getAttribute('data-report-file'));
    return;
  }

  const scoreTarget = event.target.closest('[data-score-url]');
  if (scoreTarget) {
    event.preventDefault();
    openScoredJob(
      scoreTarget.getAttribute('data-score-url') || '',
      scoreTarget.getAttribute('data-score-company') || '',
      scoreTarget.getAttribute('data-score-title') || ''
    );
  }
});

// Kick off
applyTheme(getTheme());
navigate('dashboard');
