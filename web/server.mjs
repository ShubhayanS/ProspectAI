import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const REPORTS_DIR = path.join(ROOT, 'reports');
const CV_PATH       = path.join(ROOT, 'cv.md');
const PROFILE_PATH  = path.join(ROOT, 'config', 'profile.yml');
const TEMPLATE_PATH = path.join(ROOT, 'templates', 'cv-template.html');
const PORT = process.env.PORT || 3737;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

// ─── Parsers ──────────────────────────────────────────────────────────────

function readSafe(filepath) {
  try { return fs.readFileSync(filepath, 'utf-8'); } catch { return ''; }
}

function parseScanHistory() {
  const content = readSafe(path.join(DATA_DIR, 'scan-history.tsv'));
  const lines = content.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map(h => h.trim());
  return lines.slice(1).map(row => {
    const cells = row.split('\t');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] || '').trim(); });
    return obj;
  }).filter(r => r.url);
}

function parsePipeline() {
  const content = readSafe(path.join(DATA_DIR, 'pipeline.md'));
  const pending = [], processed = [];
  let section = null;

  for (const line of content.split('\n')) {
    if (/pendientes|pending/i.test(line)) { section = 'pending'; continue; }
    if (/procesadas|processed/i.test(line)) { section = 'processed'; continue; }

    if (section === 'pending') {
      const m = line.match(/^-\s+\[\s\]\s+(https?:\/\/\S+)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$/);
      if (m) pending.push({ url: m[1], company: m[2].trim(), title: m[3].trim() });
      const lm = line.match(/^-\s+\[\s\]\s+(local:[^\s|]+)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$/);
      if (lm) pending.push({ url: lm[1], company: lm[2].trim(), title: lm[3].trim() });
    }

    if (section === 'processed') {
      const m = line.match(/^-\s+\[x\]\s+#?(\d+)\s*\|\s*(https?:\/\/\S+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([\d.]+\/5)\s*\|\s*PDF\s*([✅❌])/);
      if (m) processed.push({
        num: parseInt(m[1]), url: m[2], company: m[3].trim(),
        title: m[4].trim(), score: m[5], pdf: m[6] === '✅',
      });
    }
  }
  return { pending, processed };
}

function parseApplications() {
  const content = readSafe(path.join(DATA_DIR, 'applications.md'));
  const lines = content.split('\n')
    .filter(l => l.trim().startsWith('|'))
    .filter(l => !l.match(/^\|[\s-|]+\|$/));
  if (lines.length < 2) return [];
  const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean);
  return lines.slice(1).map(line => {
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 3) return null;
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] || ''; });
    return obj;
  }).filter(r => r && r['#'] && /^\d+$/.test(r['#']));
}

function parseReports() {
  try {
    return fs.readdirSync(REPORTS_DIR)
      .filter(f => f.endsWith('.md'))
      .sort().reverse()
      .map(filename => {
        const m = filename.match(/^(\d+)-(.+?)-(\d{4}-\d{2}-\d{2})\.md$/);
        if (!m) return null;
        const content = readSafe(path.join(REPORTS_DIR, filename));
        const scoreM = content.match(/\*\*Score:\*\*\s*([\d.]+\/5)/);
        const urlM = content.match(/\*\*URL:\*\*\s*(https?:\/\/\S+)/);
        const legitM = content.match(/\*\*Legitimacy:\*\*\s*(.+)/);
        const titleM = content.match(/^#\s+\d+\s+[—–-]+\s+(.+)/m);
        return {
          filename,
          num: parseInt(m[1]),
          slug: m[2],
          date: m[3],
          score: scoreM ? scoreM[1] : null,
          url: urlM ? urlM[1].replace(/\)$/, '') : null,
          legitimacy: legitM ? legitM[1].trim() : null,
          title: titleM ? titleM[1].trim() : filename,
        };
      }).filter(Boolean);
  } catch { return []; }
}

function getStats() {
  const apps = parseApplications();
  const pipeline = parsePipeline();
  const history = parseScanHistory();

  const byStatus = {};
  for (const h of history) {
    byStatus[h.status] = (byStatus[h.status] || 0) + 1;
  }

  const statusCounts = {};
  for (const a of apps) {
    const s = a['Status'] || 'Unknown';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  return {
    pipeline: pipeline.pending.length,
    evaluated: apps.length,
    applied: statusCounts['Applied'] || 0,
    highScore: apps.filter(a => parseFloat(a['Score']) >= 4.5).length,
    totalScanned: history.length,
    byStatus,
    statusCounts,
  };
}

// ─── HTTP Server ───────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (url.pathname.startsWith('/api/')) { handleAPI(req, res, url); return; }
  serveStatic(res, url.pathname);
});

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function handleAPI(req, res, url) {
  const route = url.pathname.slice(5); // strip /api/

  if (route === 'stats') return json(res, getStats());
  if (route === 'pipeline') return json(res, parsePipeline());
  if (route === 'applications') return json(res, parseApplications());
  if (route === 'reports' && req.method === 'GET') return json(res, parseReports());

  if (route === 'jobs') {
    let jobs = parseScanHistory();
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search')?.toLowerCase();
    const company = url.searchParams.get('company')?.toLowerCase();
    if (status && status !== 'all') jobs = jobs.filter(j => j.status === status);
    if (search) jobs = jobs.filter(j =>
      j.title?.toLowerCase().includes(search) || j.company?.toLowerCase().includes(search));
    if (company) jobs = jobs.filter(j => j.company?.toLowerCase().includes(company));
    return json(res, { jobs, total: jobs.length });
  }

  if (route.startsWith('reports/') && req.method === 'GET') {
    const filename = route.slice(8);
    const filepath = path.join(REPORTS_DIR, path.basename(filename));
    if (!filepath.startsWith(REPORTS_DIR)) { json(res, { error: 'Forbidden' }, 403); return; }
    try {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(readSafe(filepath));
    } catch { json(res, { error: 'Not found' }, 404); }
    return;
  }

  if (route === 'cv' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(readSafe(CV_PATH));
    return;
  }

  if (route === 'cv' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { content } = JSON.parse(body);
        fs.writeFileSync(CV_PATH, content, 'utf-8');
        json(res, { ok: true });
      } catch (e) { json(res, { error: e.message }, 500); }
    });
    return;
  }

  if (route === 'profile' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(readSafe(PROFILE_PATH));
    return;
  }

  if (route === 'profile' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { content } = JSON.parse(body);
        fs.writeFileSync(PROFILE_PATH, content, 'utf-8');
        json(res, { ok: true });
      } catch (e) { json(res, { error: e.message }, 500); }
    });
    return;
  }

  if (route === 'template' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(readSafe(TEMPLATE_PATH));
    return;
  }

  if (route === 'template' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { content } = JSON.parse(body);
        fs.writeFileSync(TEMPLATE_PATH, content, 'utf-8');
        json(res, { ok: true });
      } catch (e) { json(res, { error: e.message }, 500); }
    });
    return;
  }

  if (route === 'jobs/status' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { url, status } = JSON.parse(body);
        const filepath = path.join(DATA_DIR, 'scan-history.tsv');
        const content = readSafe(filepath);
        const lines = content.split('\n');
        const headers = lines[0].split('\t');
        const urlIdx    = headers.findIndex(h => h.trim() === 'url');
        const statusIdx = headers.findIndex(h => h.trim() === 'status');
        if (urlIdx === -1 || statusIdx === -1) { json(res, { error: 'Bad TSV format' }, 500); return; }
        let updated = false;
        const newLines = lines.map((line, i) => {
          if (i === 0) return line;
          const cells = line.split('\t');
          if (cells[urlIdx]?.trim() === url) {
            cells[statusIdx] = status;
            updated = true;
            return cells.join('\t');
          }
          return line;
        });
        if (!updated) { json(res, { error: 'URL not found' }, 404); return; }
        fs.writeFileSync(filepath, newLines.join('\n'), 'utf-8');
        json(res, { ok: true });
      } catch(e) { json(res, { error: e.message }, 500); }
    });
    return;
  }

  if (route === 'applications/status' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { num, status } = JSON.parse(body);
        const filepath = path.join(DATA_DIR, 'applications.md');
        let content = readSafe(filepath);
        // Match the row starting with | {num} | and update the Status column (col 6)
        const lines = content.split('\n');
        let updated = false;
        const newLines = lines.map(line => {
          // Only touch data rows (not header/separator)
          if (!line.startsWith('|') || line.match(/^\|[-\s|]+\|$/)) return line;
          const cells = line.split('|');
          // cells[0]='' cells[1]=# cells[2]=Date ... cells[6]=Status
          if (cells[1]?.trim() === String(num)) {
            cells[6] = ` ${status} `;
            updated = true;
            return cells.join('|');
          }
          return line;
        });
        if (!updated) { json(res, { error: 'Row not found' }, 404); return; }
        fs.writeFileSync(filepath, newLines.join('\n'), 'utf-8');
        json(res, { ok: true });
      } catch(e) { json(res, { error: e.message }, 500); }
    });
    return;
  }

  if (route === 'applications/upsert' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { company, title, status, url: jobUrl } = JSON.parse(body);
        const filepath = path.join(DATA_DIR, 'applications.md');
        let content = readSafe(filepath);
        const lines = content.split('\n');

        // Try to find existing row by company+title match
        let updated = false;
        const dataLines = lines.map(line => {
          if (!line.startsWith('|') || line.match(/^\|[-\s|]+\|$/)) return line;
          const cells = line.split('|');
          const rowCompany = (cells[3] || '').trim().toLowerCase();
          const rowRole    = (cells[4] || '').trim().toLowerCase();
          if (rowCompany === (company||'').toLowerCase() && rowRole === (title||'').toLowerCase()) {
            cells[6] = ` ${status} `;
            updated = true;
            return cells.join('|');
          }
          return line;
        });

        if (updated) {
          fs.writeFileSync(filepath, dataLines.join('\n'), 'utf-8');
          json(res, { ok: true, action: 'updated' });
          return;
        }

        // Not found — append new row
        const nums = lines
          .filter(l => l.startsWith('|') && !l.match(/^\|[-\s|]+\|$/) && !/^\|\s*#/.test(l))
          .map(l => parseInt(l.split('|')[1]?.trim()) || 0);
        const nextNum = (Math.max(0, ...nums) + 1).toString().padStart(3, '0');
        const today = new Date().toISOString().slice(0, 10);
        const note = jobUrl ? `via Jobs tab` : 'via Jobs tab';
        const newRow = `| ${nextNum} | ${today} | ${company||'—'} | ${title||'—'} | — | ${status} | ❌ | — | ${note} |`;

        // Insert before trailing blank lines
        const trimmed = content.trimEnd();
        fs.writeFileSync(filepath, trimmed + '\n' + newRow + '\n', 'utf-8');
        json(res, { ok: true, action: 'added', num: nextNum });
      } catch(e) { json(res, { error: e.message }, 500); }
    });
    return;
  }

  if (route === 'eval/stream' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

      let jdText = '';
      try { jdText = JSON.parse(body).jd || ''; } catch {}

      if (!jdText.trim()) { send('err', { text: 'No JD text provided' }); send('done', { code: 1 }); res.end(); return; }

      const tmpFile = path.join(ROOT, `_eval-tmp-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, jdText, 'utf-8');

      const proc = spawn('node', ['web-eval.mjs', tmpFile], { cwd: ROOT });

      proc.stdout.on('data', chunk => {
        for (const line of chunk.toString().split('\n')) {
          if (line.trim()) send('line', { text: line });
        }
      });
      proc.stderr.on('data', chunk => send('err', { text: chunk.toString() }));
      proc.on('close', code => {
        try { fs.unlinkSync(tmpFile); } catch {}
        send('done', { code });
        res.end();
      });
      req.on('close', () => { try { proc.kill(); fs.unlinkSync(tmpFile); } catch {} });
    });
    return;
  }

  if (route === 'match/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    const proc = spawn('node', ['web-match.mjs'], { cwd: ROOT });
    const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    proc.stdout.on('data', chunk => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) send('line', { text: line });
      }
    });
    proc.stderr.on('data', chunk => send('err', { text: chunk.toString() }));
    proc.on('close', code => { send('done', { code }); res.end(); });
    req.on('close', () => { try { proc.kill(); } catch {} });
    return;
  }

  if (route === 'scan/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const args = ['scan.mjs'];
    const since = url.searchParams.get('since');
    const dryRun = url.searchParams.get('dryRun') === 'true';
    const verbose = url.searchParams.get('verbose') === 'true';
    const company = url.searchParams.get('company');

    if (since && since !== 'all') { args.push('--since', since); }
    if (dryRun) args.push('--dry-run');
    if (verbose) args.push('--verbose');
    if (company) args.push('--company', company);

    const proc = spawn('node', args, { cwd: ROOT });
    const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

    proc.stdout.on('data', chunk => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) send('line', { text: line });
      }
    });
    proc.stderr.on('data', chunk => send('err', { text: chunk.toString() }));
    proc.on('close', code => { send('done', { code }); res.end(); });
    req.on('close', () => { try { proc.kill(); } catch {} });
    return;
  }

  if (route === 'pdf' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { reportPath } = JSON.parse(body || '{}');
      const args = reportPath ? ['generate-pdf.mjs', reportPath] : ['generate-pdf.mjs'];
      const proc = spawn('node', args, { cwd: ROOT });
      let out = '';
      proc.stdout.on('data', d => out += d);
      proc.stderr.on('data', d => out += d);
      proc.on('close', code => json(res, { ok: code === 0, output: out }));
    });
    return;
  }

  json(res, { error: 'Not found' }, 404);
}

function serveStatic(res, pathname) {
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const filepath = path.join(PUBLIC_DIR, pathname);
  if (!filepath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  try {
    const stat = fs.statSync(filepath);
    if (stat.isDirectory()) { serveStatic(res, path.join(pathname, 'index.html')); return; }
    const ct = MIME[path.extname(filepath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct });
    createReadStream(filepath).pipe(res);
  } catch {
    const idx = path.join(PUBLIC_DIR, 'index.html');
    try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); createReadStream(idx).pipe(res); }
    catch { res.writeHead(404); res.end('Not found'); }
  }
}

server.listen(PORT, () => {
  console.log(`\n  career-ops dashboard → http://localhost:${PORT}\n`);
});
