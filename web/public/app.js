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

function truncate(s, n = 50) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function fmtDate(s) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return s; }
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
  feather.replace();
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
  feather.replace();
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
  feather.replace();
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
          <i data-feather="cpu"></i> Run Matcher
        </button>
        <button class="btn btn-primary" onclick="navigate('scanner')">
          <i data-feather="radio"></i> Run Scanner
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

async function pageJobs(el) {
  el.innerHTML = `
    <div class="page-hd">
      <div class="page-hd-text">
        <h1>Jobs</h1>
        <p>All jobs captured from portal scans</p>
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
    </div>
    <div class="card" id="job-card">
      <div class="loader"><div class="spin"></div></div>
    </div>
  `;
  feather.replace();

  qs('#job-search').addEventListener('input', e => {
    _jobSearch = e.target.value;
    loadJobs();
  });

  qs('#job-status-filter').addEventListener('change', e => {
    _jobFilter = e.target.value;
    loadJobs();
  });

  loadJobs();
}

async function loadJobs() {
  const card = qs('#job-card');
  if (!card) return;
  card.innerHTML = `<div class="loader"><div class="spin"></div></div>`;

  const p = new URLSearchParams({ status: _jobFilter });
  if (_jobSearch) p.set('search', _jobSearch);
  const { jobs, total } = await fetch(`/api/jobs?${p}`).then(r => r.json());

  if (!jobs?.length) {
    card.innerHTML = `<div class="empty"><i data-feather="inbox"></i><p>No jobs match this filter</p></div>`;
    feather.replace();
    return;
  }

  card.innerHTML = `
    <div class="row-count">${total} result${total!==1?'s':''}</div>
    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Company</th><th>Title</th><th>Portal</th>
            <th>Date</th><th>Score</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${jobs.map(j => `
            <tr>
              <td class="fw-600">${escHtml(j.company||'—')}</td>
              <td class="truncate" style="max-width:240px" title="${escHtml(j.title||'')}">${escHtml(truncate(j.title||'—',45))}</td>
              <td class="dim text-sm">${escHtml(j.portal||'—')}</td>
              <td class="dim text-sm">${escHtml(j.first_seen||'—')}</td>
              <td>${j.score ? scoreBadge(j.score + '/5') : '<span class="badge badge-gray">—</span>'}</td>
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
              <td>
                ${j.url?.startsWith('http') ? `<a href="${escHtml(j.url)}" target="_blank" class="btn btn-apply"><i data-feather="external-link"></i> Apply</a>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  feather.replace();
}


/* ═══════════════════════════════════════════════════════════════════════════
   APPLICATIONS
═══════════════════════════════════════════════════════════════════════════ */
const APP_STATUSES = ['Evaluated','Applied','Responded','Interview','Offer','Rejected','Discarded','SKIP'];

let _appsFilter = 'all';
let _appsData   = [];

async function pageApplications(el) {
  _appsData = await api('applications');
  const statuses = ['all', ...APP_STATUSES];

  el.innerHTML = `
    <div class="page-hd">
      <div class="page-hd-text">
        <h1>Applications</h1>
        <p>${_appsData.length} total · click a row to read the report · change status inline</p>
      </div>
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
  feather.replace();

  qsa('#apps-chips .chip').forEach(c => {
    c.addEventListener('click', () => {
      _appsFilter = c.getAttribute('data-s');
      qsa('#apps-chips .chip').forEach(x => x.classList.remove('on'));
      c.classList.add('on');
      qs('#apps-card').innerHTML = renderAppsTable(_appsData, _appsFilter);
      feather.replace();
    });
  });
}

function renderAppsTable(apps, filter) {
  const rows = filter === 'all' ? apps : apps.filter(a => a['Status'] === filter);
  if (!rows.length)
    return `<div class="empty"><i data-feather="inbox"></i><p>Nothing here</p></div>`;

  return `
    <div class="row-count">${rows.length} result${rows.length!==1?'s':''}</div>
    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Date</th><th>Company</th><th>Role</th>
            <th>Score</th><th>Status</th><th>PDF</th><th>Report</th><th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(a => {
            const reportFile = (a['Report']||'').match(/\(reports\/([^)]+)\)/)?.[1] || '';
            const reportNum  = (a['Report']||'').match(/\[(\d+)\]/)?.[1] || '';
            const rowNum     = escHtml(a['#']);
            return `
            <tr>
              <td class="dim mono">${rowNum}</td>
              <td class="dim text-sm">${escHtml(a['Date']||'—')}</td>
              <td class="fw-600">${escHtml(a['Company']||'—')}</td>
              <td class="truncate" style="max-width:200px;cursor:pointer" title="${escHtml(a['Role']||'')}"
                onclick="${reportFile ? `openReport('${reportFile}')` : ''}">${escHtml(truncate(a['Role']||'—',38))}</td>
              <td>${scoreBadge(a['Score'])}</td>
              <td>
                <select class="status-select" data-row="${rowNum}" onchange="updateStatus(this)">
                  ${APP_STATUSES.map(s =>
                    `<option value="${s}"${s===a['Status']?' selected':''}>${s}</option>`
                  ).join('')}
                </select>
              </td>
              <td>${escHtml(a['PDF']||'—')}</td>
              <td>${reportFile
                ? `<button class="btn btn-sm btn-secondary" onclick="openReport('${reportFile}')">
                     <i data-feather="file-text"></i> ${reportNum}
                   </button>`
                : '—'}</td>
              <td class="dim text-sm" style="max-width:160px" title="${escHtml(a['Notes']||'')}">${escHtml(truncate(a['Notes']||'',36))}</td>
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
  const newStatus = sel.value;

  try {
    const r = await fetch('/api/applications/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ num: rowNum, status: newStatus }),
    });
    const data = await r.json();
    if (data.ok) {
      toast(`Status → ${newStatus}`);
      // update local cache so filter re-render is consistent
      const entry = _appsData.find(a => a['#'] === rowNum);
      if (entry) entry['Status'] = newStatus;
    } else {
      toast('Update failed: ' + (data.error || 'unknown'));
    }
  } catch(e) {
    toast('Update failed');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   REPORTS
═══════════════════════════════════════════════════════════════════════════ */
async function pageReports(el) {
  const reports = await api('reports');

  el.innerHTML = `
    <div class="page-hd">
      <div class="page-hd-text">
        <h1>Reports</h1>
        <p>${reports.length} evaluation report${reports.length!==1?'s':''} — click any card to read</p>
      </div>
    </div>
    ${reports.length === 0
      ? `<div class="card"><div class="empty"><i data-feather="file-text"></i><p>No reports yet. Evaluate a job first.</p></div></div>`
      : `<div class="reports-grid">
          ${reports.map(r => {
            const { company, role } = splitTitle(r.title);
            return `
            <div class="report-card" onclick="openReport('${escHtml(r.filename)}')">
              <div class="report-card-hd">
                <div class="report-co">${escHtml(company || r.slug)}</div>
                ${scoreBadge(r.score)}
              </div>
              <div class="report-role">${escHtml(truncate(role || r.title, 55))}</div>
              <div class="report-foot">
                <span class="report-date">${fmtDate(r.date)}</span>
                ${r.url ? `<a href="${escHtml(r.url)}" target="_blank"
                    onclick="event.stopPropagation()"
                    class="btn btn-sm btn-secondary" style="padding:2px 8px;font-size:11px">
                    <i data-feather="external-link"></i>
                  </a>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>`}
  `;
  feather.replace();
}

async function openReport(filename) {
  openModal('Loading…', `<div class="loader"><div class="spin"></div></div>`, null);
  try {
    const md = await fetch(`/api/reports/${filename}`).then(r => r.text());
    const titleM = md.match(/^#\s+(.+)/m);
    const urlM   = md.match(/\*\*URL:\*\*\s*(https?:\/\/\S+)/);
    const title  = titleM ? titleM[1].trim() : filename;
    const url    = urlM ? urlM[1].replace(/\)$/, '') : null;
    openModal(title, `<div class="md">${marked.parse(md)}</div>`, url);
  } catch(e) {
    qs('#modal-body').innerHTML = `<p style="color:var(--red)">Failed to load: ${e.message}</p>`;
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
        <h1>Portal Scanner</h1>
        <p>Scan Greenhouse · Ashby · Lever · LinkedIn — zero Claude tokens</p>
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
            <i data-feather="play"></i> Run Scan
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
        <h2>Scan Output</h2>
        <button class="btn btn-sm btn-secondary" onclick="clearTerm()">
          <i data-feather="trash-2"></i> Clear
        </button>
      </div>
      <div style="padding:0">
        <div class="terminal" id="s-term">Ready — press <span class="t-hi">Run Scan</span> to start.\n</div>
      </div>
    </div>
  `;
  feather.replace();
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
  qs('#s-status').textContent = 'Scanning…';

  const p = new URLSearchParams({ since, dryRun: dry, verbose });
  if (company) p.set('company', company);

  _scanStream = new EventSource(`/api/scan/stream?${p}`);

  function colorLine(text) {
    return text
      .replace(/(^\s*\+\s+.+)/g, '<span class="t-ok">$1</span>')
      .replace(/(·\s+.+\(0\s+new\))/g, '<span class="t-dim">$1</span>')
      .replace(/(━+)/g, '<span class="t-dim">$1</span>')
      .replace(/(New offers added:\s*\d+)/g, '<span class="t-ok">$1</span>')
      .replace(/(Portal Scan)/g, '<span class="t-hi">$1</span>')
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
    div.textContent = code === 0 ? '\n✓ Scan complete.' : `\n✗ Failed (exit ${code})`;
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
    feather.replace();
  });
}

function stopScan() {
  if (_scanStream) { _scanStream.close(); _scanStream = null; }
  const term = qs('#s-term');
  if (term) {
    const div = document.createElement('div');
    div.className = 't-warn';
    div.textContent = '\n⚠ Stopped by user.';
    term.appendChild(div);
  }
  qs('#s-run').style.display  = 'flex';
  qs('#s-stop').style.display = 'none';
  qs('#s-status').textContent = 'Stopped';
  feather.replace();
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
  openModal('Run Matcher', `
    <div style="margin-bottom:12px;color:var(--text-2);font-size:13px">
      Scores all unscored <strong>added</strong> jobs in scan-history using Claude.
      Results saved to Jobs table immediately as each job scores.
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <button class="btn btn-primary" id="m-run" onclick="startMatcher()">
        <i data-feather="cpu"></i> Start Scoring
      </button>
      <button class="btn btn-secondary" id="m-stop" onclick="stopMatcher()" style="display:none">
        <i data-feather="square"></i> Stop
      </button>
    </div>
    <div class="terminal" id="m-term" style="min-height:200px">Ready — press Start Scoring.\n</div>
  `);
}

function startMatcher() {
  if (_matchStream) return;
  const term = qs('#m-term');
  term.innerHTML = '';
  qs('#m-run').style.display  = 'none';
  qs('#m-stop').style.display = 'flex';

  _matchStream = new EventSource(`/api/match/stream`);

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
    div.textContent = code === 0 ? '\n✓ Done. Refresh Jobs to see all scores.' : `\n✗ Failed (exit ${code})`;
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
    feather.replace();
  });
}

function stopMatcher() {
  if (_matchStream) { _matchStream.close(); _matchStream = null; }
  const term = qs('#m-term');
  if (term) {
    const div = document.createElement('div');
    div.className = 't-warn';
    div.textContent = '\n⚠ Stopped. Scores saved so far are in Jobs table.';
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
        <h1>Job Evaluator</h1>
        <p>Paste a JD → Claude scores it using your profile + evaluate.md</p>
      </div>
    </div>

    <div class="card mb-5">
      <div class="card-hd"><h2>Job Description</h2></div>
      <div class="card-body">
        <textarea id="eval-jd" style="width:100%;min-height:200px;padding:10px 12px;border-radius:var(--r-md);border:1px solid var(--border-med);background:var(--surface-2);color:var(--text-1);font-size:13px;font-family:inherit;resize:vertical;outline:none" placeholder="Paste the full job description here — title, responsibilities, requirements, company info…"></textarea>
        <div class="scan-bar" style="margin-top:12px">
          <button class="btn btn-primary" id="e-run" onclick="startEval()">
            <i data-feather="zap"></i> Evaluate with Claude
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
  feather.replace();
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
  feather.replace();
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
let _profileTab = 'info';

async function pageProfile(el) {
  const [profileYaml, cvContent, templateHtml] = await Promise.all([
    fetch('/api/profile').then(r => r.text()),
    fetch('/api/cv').then(r => r.text()),
    fetch('/api/template').then(r => r.text()),
  ]);

  el.innerHTML = `
    <div class="page-hd">
      <div class="page-hd-text">
        <h1>Profile</h1>
        <p>Personal info · resume · CV template</p>
      </div>
    </div>

    <div class="profile-tabs mb-5">
      <button class="profile-tab${_profileTab==='info'?' active':''}" onclick="switchProfileTab('info')">
        <i data-feather="user"></i> Personal Info
      </button>
      <button class="profile-tab${_profileTab==='resume'?' active':''}" onclick="switchProfileTab('resume')">
        <i data-feather="file-text"></i> Resume
      </button>
      <button class="profile-tab${_profileTab==='template'?' active':''}" onclick="switchProfileTab('template')">
        <i data-feather="layout"></i> CV Template
      </button>
    </div>

    <!-- PERSONAL INFO TAB -->
    <div id="tab-info" class="profile-tab-body${_profileTab==='info'?'':' hidden'}">
      ${renderInfoForm(profileYaml)}
    </div>

    <!-- RESUME TAB -->
    <div id="tab-resume" class="profile-tab-body${_profileTab==='resume'?'':' hidden'}">
      <div class="card mb-4">
        <div class="card-hd">
          <h2>Upload Resume</h2>
        </div>
        <div class="card-body">
          <div class="upload-zone" id="upload-zone" onclick="qs('#resume-file').click()" ondragover="event.preventDefault()" ondrop="handleResumeDrop(event)">
            <i data-feather="upload"></i>
            <p>Drop a <strong>.md</strong> or <strong>.txt</strong> file here, or click to browse</p>
            <input type="file" id="resume-file" accept=".md,.txt" style="display:none" onchange="handleResumeFile(event)">
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-hd">
          <h2>Resume Source (cv.md)</h2>
          <div class="flex gap-2">
            <span id="cv-dirty" style="font-size:13px;color:var(--orange);align-self:center;display:none">Unsaved</span>
            <button class="btn btn-secondary" id="cv-save" onclick="saveCV()" disabled>
              <i data-feather="save"></i> Save
            </button>
            <button class="btn btn-primary" onclick="genPDF()">
              <i data-feather="download"></i> Generate PDF
            </button>
          </div>
        </div>
        <div class="cv-split" style="border-radius:0 0 var(--r-lg) var(--r-lg);overflow:hidden">
          <div class="cv-col">
            <div class="cv-col-label">Markdown</div>
            <textarea class="cv-editor" id="cv-ed" spellcheck="false">${escHtml(cvContent)}</textarea>
          </div>
          <div class="cv-col">
            <div class="cv-col-label">Preview</div>
            <div class="cv-preview md" id="cv-prev">${marked.parse(cvContent)}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- TEMPLATE TAB -->
    <div id="tab-template" class="profile-tab-body${_profileTab==='template'?'':' hidden'}">
      <div class="card">
        <div class="card-hd">
          <h2>CV Template (cv-template.html)</h2>
          <div class="flex gap-2">
            <span id="tpl-dirty" style="font-size:13px;color:var(--orange);align-self:center;display:none">Unsaved</span>
            <button class="btn btn-secondary" id="tpl-save" onclick="saveTemplate()" disabled>
              <i data-feather="save"></i> Save
            </button>
            <button class="btn btn-primary" onclick="genPDF()">
              <i data-feather="download"></i> Generate PDF
            </button>
          </div>
        </div>
        <div class="card-body" style="padding:0">
          <textarea class="cv-editor" id="tpl-ed" spellcheck="false" style="height:600px;border-radius:0 0 var(--r-lg) var(--r-lg)">${escHtml(templateHtml)}</textarea>
        </div>
      </div>
    </div>
  `;
  feather.replace();

  // Resume editor live preview
  const cvEd = qs('#cv-ed');
  if (cvEd) {
    cvEd.addEventListener('input', () => {
      qs('#cv-prev').innerHTML = marked.parse(cvEd.value);
      qs('#cv-save').disabled = false;
      qs('#cv-dirty').style.display = 'inline';
    });
  }

  // Template editor dirty flag
  const tplEd = qs('#tpl-ed');
  if (tplEd) {
    tplEd.addEventListener('input', () => {
      qs('#tpl-save').disabled = false;
      qs('#tpl-dirty').style.display = 'inline';
    });
  }
}

// ── Info form builder ─────────────────────────────────────────────────────
function renderInfoForm(yaml) {
  function extract(key) {
    const m = yaml.match(new RegExp(`^\\s+${key}:\\s*"?([^"\\n]*)"?`, 'm'));
    return m ? m[1].trim() : '';
  }
  const fields = [
    { key: 'full_name',    label: 'Full Name',      icon: 'user' },
    { key: 'email',        label: 'Email',           icon: 'mail' },
    { key: 'phone',        label: 'Phone',           icon: 'phone' },
    { key: 'location',     label: 'Location',        icon: 'map-pin' },
    { key: 'linkedin',     label: 'LinkedIn',        icon: 'linkedin' },
    { key: 'github',       label: 'GitHub',          icon: 'github' },
    { key: 'portfolio_url',label: 'Portfolio URL',   icon: 'globe' },
  ];
  const compFields = [
    { key: 'target_range',        label: 'Target Range',       icon: 'dollar-sign' },
    { key: 'location_flexibility', label: 'Location Flexibility', icon: 'navigation' },
    { key: 'visa_status',          label: 'Visa Status',         icon: 'shield' },
  ];
  const narrativeHeadline = extract('headline');

  return `
    <div class="card mb-4">
      <div class="card-hd"><h2>Identity</h2></div>
      <div class="card-body">
        <div class="info-grid">
          ${fields.map(f => `
            <div class="info-field">
              <label class="info-label"><i data-feather="${f.icon}"></i> ${f.label}</label>
              <input class="info-input" data-yaml-key="${f.key}" value="${escHtml(extract(f.key))}" placeholder="${f.label}">
            </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="card mb-4">
      <div class="card-hd"><h2>Narrative</h2></div>
      <div class="card-body">
        <div class="info-field" style="grid-column:1/-1">
          <label class="info-label"><i data-feather="align-left"></i> Headline</label>
          <input class="info-input" data-yaml-key="headline" value="${escHtml(narrativeHeadline)}" placeholder="Your professional headline">
        </div>
      </div>
    </div>

    <div class="card mb-4">
      <div class="card-hd"><h2>Compensation &amp; Location</h2></div>
      <div class="card-body">
        <div class="info-grid">
          ${compFields.map(f => `
            <div class="info-field">
              <label class="info-label"><i data-feather="${f.icon}"></i> ${f.label}</label>
              <input class="info-input" data-yaml-key="${f.key}" value="${escHtml(extract(f.key))}" placeholder="${f.label}">
            </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="card mb-4">
      <div class="card-hd"><h2>Full profile.yml</h2><span style="font-size:12px;color:var(--text-2)">Advanced — edit YAML directly</span></div>
      <div class="card-body" style="padding:0">
        <textarea class="cv-editor" id="profile-raw" spellcheck="false" style="height:360px;border-radius:0 0 var(--r-lg) var(--r-lg)">${escHtml(yaml)}</textarea>
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
  if (pane) { pane.classList.remove('hidden'); feather.replace(); }
}

async function saveProfileInfo() {
  // Collect field overrides and patch the raw YAML
  let yaml = qs('#profile-raw')?.value || '';

  qsa('.info-input[data-yaml-key]').forEach(inp => {
    const key = inp.getAttribute('data-yaml-key');
    const val = inp.value.replace(/"/g, '\\"');
    // Replace quoted value: key: "old" → key: "new"
    yaml = yaml.replace(
      new RegExp(`(^\\s+${key}:\\s*)"[^"]*"`, 'm'),
      `$1"${val}"`
    );
    // Replace unquoted value
    yaml = yaml.replace(
      new RegExp(`(^\\s+${key}:\\s*)(?!")([^\\n]*)`, 'm'),
      `$1"${val}"`
    );
  });

  const r = await fetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: yaml }),
  });
  if (r.ok) { toast('Profile saved'); if (qs('#profile-raw')) qs('#profile-raw').value = yaml; }
  else toast('Save failed');
}

async function saveCV() {
  const content = qs('#cv-ed')?.value;
  if (!content) return;
  const r = await fetch('/api/cv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (r.ok) {
    qs('#cv-save').disabled = true;
    qs('#cv-dirty').style.display = 'none';
    toast('Resume saved');
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
    toast('Template saved');
  } else toast('Save failed');
}

async function genPDF() {
  toast('Generating PDF…');
  const r = await fetch('/api/pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await r.json();
  toast(data.ok ? 'PDF saved to output/' : 'PDF failed — is Playwright installed?');
}

function handleResumeFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const content = e.target.result;
    const ed = qs('#cv-ed');
    if (ed) {
      ed.value = content;
      qs('#cv-prev').innerHTML = marked.parse(content);
      qs('#cv-save').disabled = false;
      qs('#cv-dirty').style.display = 'inline';
      toast(`Loaded ${file.name} — click Save to apply`);
    }
  };
  reader.readAsText(file);
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
window.startScan     = startScan;
window.stopScan      = stopScan;
window.clearTerm     = clearTerm;
window.saveCV           = saveCV;
window.saveTemplate     = saveTemplate;
window.saveProfileInfo  = saveProfileInfo;
window.switchProfileTab = switchProfileTab;
window.handleResumeFile = handleResumeFile;
window.handleResumeDrop = handleResumeDrop;
window.genPDF           = genPDF;
window.updateStatus    = updateStatus;
window.updateJobStatus = updateJobStatus;
window.startEval       = startEval;
window.openMatcherModal = openMatcherModal;
window.startMatcher    = startMatcher;
window.stopMatcher     = stopMatcher;
window.stopEval        = stopEval;
window.clearEvalTerm   = clearEvalTerm;

// Kick off
applyTheme(getTheme());
navigate('dashboard');
