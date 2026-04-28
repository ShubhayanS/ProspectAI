#!/usr/bin/env node
/**
 * web-match.mjs — Batch job scorer for the career-ops web dashboard
 * Reads eligible jobs from scan-history.tsv, fetches the posting text
 * (cached in data/jd-cache/), scores each with claude --print in parallel,
 * writes scores back, and saves a markdown fit report.
 *
 * Usage: node web-match.mjs [--today] [--limit N] [--all] [--concurrency N]
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { buildResumeContext } from './resume-context.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TSV_PATH = join(ROOT, 'data', 'scan-history.tsv');
const REPORTS_DIR = join(ROOT, 'reports');
const JD_CACHE_DIR = join(ROOT, 'data', 'jd-cache');
const TODAY = new Date().toISOString().slice(0, 10);
const REPORT_RETENTION_DAYS = parseInt(process.env.REPORT_RETENTION_DAYS || '7', 10);

let shuttingDown = false;
process.on('SIGTERM', () => { shuttingDown = true; });
process.on('SIGINT',  () => { shuttingDown = true; });

function readSafe(p) {
  try { return readFileSync(p, 'utf-8'); } catch { return ''; }
}

// ── JD Cache ────────────────────────────────────────────────────────
function urlHash(url) {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

function getCachedJd(url) {
  const file = join(JD_CACHE_DIR, urlHash(url) + '.txt');
  return readSafe(file);
}

function setCachedJd(url, text) {
  try {
    mkdirSync(JD_CACHE_DIR, { recursive: true });
    writeFileSync(join(JD_CACHE_DIR, urlHash(url) + '.txt'), text, 'utf-8');
  } catch {}
}

// ── Load context files ──────────────────────────────────────────────
const profile = readSafe(join(ROOT, 'modes', '_profile.md'));
const cv      = readSafe(join(ROOT, 'cv.md'));
const resumeContext = buildResumeContext(cv, { maxChars: 8000 });

if (!cv.trim()) {
  console.error('❌  cv.md not found. Set up your CV first.');
  process.exit(1);
}

// ── TSV helpers ─────────────────────────────────────────────────────
function readTsv() {
  const content = readSafe(TSV_PATH);
  if (!content.trim()) return { headers: [], rows: [] };
  const lines = content.split('\n');
  const headers = lines[0].split('\t').map(h => h.trim());
  const rows = lines.slice(1).map(l => l.split('\t').map(c => c.trim()));
  return { headers, rows, raw: lines };
}

function writeTsv(headers, rows) {
  const lines = [headers.join('\t'), ...rows.map(r => r.join('\t'))];
  writeFileSync(TSV_PATH, lines.join('\n'), 'utf-8');
}

function decodeCell(value) {
  return String(value ?? '').replace(/&#124;/g, '|').replace(/\\\|/g, '|');
}

function slugify(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'job';
}

function normalizeKey(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// ── Report index (built once at startup) ───────────────────────────
let _reportIndex = null; // Map<urlHash|titleKey, filename>

function buildReportIndex() {
  if (_reportIndex) return _reportIndex;
  _reportIndex = new Map();
  try {
    for (const filename of readdirSync(REPORTS_DIR)) {
      if (!filename.endsWith('.md')) continue;
      const content = readSafe(join(REPORTS_DIR, filename));
      // index by URL
      const urlMatch = content.match(/\*\*URL:\*\*\s*(https?:\/\/\S+)/);
      if (urlMatch) _reportIndex.set(urlHash(urlMatch[1].trim()), filename);
      // index by company+title from heading
      const heading = content.match(/^#\s+\d+\s+[—–-]\s+(.+)/m)?.[1] || '';
      const parts = heading.split('|');
      if (parts.length >= 2) {
        const key = normalizeKey(parts[0]) + '::' + normalizeKey(parts.slice(1).join('|'));
        _reportIndex.set(key, filename);
      }
    }
  } catch {}
  return _reportIndex;
}

function existingReportFor(url, company, title) {
  const idx = buildReportIndex();
  if (url) {
    const hit = idx.get(urlHash(url));
    if (hit) return hit;
  }
  return idx.get(normalizeKey(company) + '::' + normalizeKey(title)) || '';
}

function nextReportNumber() {
  try {
    const nums = readdirSync(REPORTS_DIR)
      .map(name => parseInt(name.match(/^(\d+)-/)?.[1] || '0', 10))
      .filter(Boolean);
    return Math.max(0, ...nums) + 1;
  } catch { return 1; }
}

function reportDateFromFilename(filename) {
  return filename.match(/-(\d{4}-\d{2}-\d{2})\.md$/)?.[1] || '';
}

function cleanupOldReports() {
  if (!Number.isFinite(REPORT_RETENTION_DAYS) || REPORT_RETENTION_DAYS <= 0) return [];
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - REPORT_RETENTION_DAYS);
  const deleted = [];
  try {
    for (const filename of readdirSync(REPORTS_DIR)) {
      if (!filename.endsWith('.md')) continue;
      const reportDate = reportDateFromFilename(filename);
      if (!reportDate) continue;
      const reportTime = new Date(`${reportDate}T00:00:00`).getTime();
      if (!Number.isFinite(reportTime) || reportTime >= cutoff.getTime()) continue;
      unlinkSync(join(REPORTS_DIR, filename));
      deleted.push(filename);
    }
  } catch {}
  return deleted;
}

function isReportEligibleStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return !normalized || normalized === 'added' || normalized === 'evaluated';
}

function isTodayRow(row, indexes) {
  const firstSeen = row[indexes.firstSeenIdx] || '';
  const postedAt  = row[indexes.postedAtIdx]  || '';
  return firstSeen === TODAY || postedAt === TODAY;
}

// ── HTML → text ─────────────────────────────────────────────────────
function htmlToText(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function fetchPostingText(url) {
  if (!url?.startsWith('http')) return '';

  // Cache hit
  const cached = getCachedJd(url);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    const raw = await res.text();
    const text = contentType.includes('json')
      ? JSON.stringify(JSON.parse(raw), null, 2).slice(0, 15000)
      : htmlToText(raw).slice(0, 15000);
    setCachedJd(url, text);
    return text;
  } catch (error) {
    return `Unable to fetch posting text from URL (${error.message}).`;
  } finally {
    clearTimeout(timer);
  }
}

// ── Blocker detection ───────────────────────────────────────────────
function detectBlockers(title, jdText) {
  const text = `${title}\n${jdText}`.toLowerCase();
  const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(Boolean);
  const blockers = [];
  let cap = 5;

  const add = (label, scoreCap) => { blockers.push(label); cap = Math.min(cap, scoreCap); };

  if (/\b(no longer accepting applications|job is closed|position has been filled|posting has expired)\b/.test(text)) add('Posting appears closed or expired', 1.0);
  if (sentences.some(s => /\b(ph\.?d|doctorate|doctoral)\b/.test(s) && /\b(required|must|required qualification|minimum qualification|requires)\b/.test(s))) add('PhD or doctorate appears required', 1.5);
  if (/\b(active\s+)?(security\s+)?clearance\b/.test(text) && /\b(required|must|active)\b/.test(text)) add('Active clearance appears required', 1.5);
  if (/\b(staff|principal|director|manager|lead)\b/.test(title.toLowerCase())) add('Title indicates senior leadership level', 2.0);
  if (/\bsenior|sr\.\b|\bsr\b/.test(title.toLowerCase())) add('Title indicates senior level', 2.5);

  const years = [...text.matchAll(/\b([5-9]|1[0-5])\+?\s*(?:years|yrs)\b/g)].map(m => parseInt(m[1], 10));
  if (years.some(n => n >= 7)) add('7+ years of experience appears required', 1.5);
  else if (years.some(n => n >= 5)) add('5+ years of experience appears required', 2.0);
  else if (years.some(n => n >= 3)) add('3+ years of experience appears required', 3.0);

  if (/\b(internship|intern|co-?op)\b/.test(text) && !/\bnew grad|entry[- ]level|early career\b/.test(text)) add('Intern/co-op role may not match full-time target', 3.0);

  return { blockers: [...new Set(blockers)], cap };
}

function applyCap(score, cap) {
  if (!score) return null;
  return Math.min(parseFloat(score), cap).toFixed(1);
}

function buildFallbackReport({ num, company, title, url, score, reason, blockers, jdText }) {
  return `# ${String(num).padStart(3, '0')} — ${company} | ${title}

**Date:** ${TODAY}
**Score:** ${score}/5
**URL:** ${url}
**Legitimacy:** Proceed with Caution — matcher report generated from fetched posting text
**PDF:** ❌ (pending)

---

## A. Role Summary

Matcher-generated fit report for **${company} — ${title}**.

## B. CV Match

${reason || 'Fit scored from the candidate profile, CV, title, and fetched posting text.'}

## C. Hard Blockers

${blockers.length ? blockers.map(b => `- ${b}`).join('\n') : '- No obvious hard blocker detected by matcher heuristics.'}

## D. Recommendation

${score >= 4 ? 'High-priority review. Read the posting carefully, then consider applying.' : score >= 3 ? 'Medium-priority. Apply only if the details still look aligned.' : 'Low-priority. Likely not worth applying unless there is missing context.'}

## E. Posting Text Snapshot

${jdText.slice(0, 3000)}
`;
}

function saveReport({ company, title, url, score, reason, blockers, reportMd, jdText }) {
  const existing = existingReportFor(url, company, title);
  if (existing) return existing;

  const num = nextReportNumber();
  const filename = `${String(num).padStart(3, '0')}-${slugify(`${company}-${title}`).slice(0, 70)}-${TODAY}.md`;
  const filepath = join(REPORTS_DIR, filename);
  const body = reportMd?.trim() || buildFallbackReport({ num, company, title, url, score, reason, blockers, jdText });
  const normalized = body.match(/^#\s+\d+\s+[—–-]/)
    ? body
    : buildFallbackReport({ num, company, title, url, score, reason, blockers, jdText });
  writeFileSync(filepath, normalized + '\n', 'utf-8');

  // Update index immediately so parallel workers don't double-write
  const idx = buildReportIndex();
  if (url) idx.set(urlHash(url), filename);
  idx.set(normalizeKey(company) + '::' + normalizeKey(title), filename);

  return filename;
}

// ── Score a single job with claude --print ──────────────────────────
function scoreJob(title, company, url, jdText, blockerInfo) {
  return new Promise((resolve) => {
    if (shuttingDown) { resolve({ score: null, reason: 'stopped' }); return; }

    const reportNum = nextReportNumber();
    const prompt = [
      '## Career-Ops Matcher Report',
      '',
      'You are doing a job fit assessment for an entry/junior data/ML job search.',
      'Use the actual posting text below. Do not infer missing requirements from title alone.',
      '',
      '### My Profile',
      profile,
      '',
      '### My Resume Context',
      resumeContext,
      '',
      '---',
      '',
      '### Job to Score',
      `**Title:** ${title}`,
      `**Company:** ${company}`,
      `**URL:** ${url}`,
      '',
      '### Posting Text',
      jdText.slice(0, 12000),
      '',
      '### Locally Detected Hard Blockers',
      blockerInfo.blockers.length ? blockerInfo.blockers.map(b => `- ${b}`).join('\n') : '- None detected',
      '',
      '### Instructions',
      'Give a fit score from 0.0 to 5.0 (one decimal place).',
      'Be blocker-aware. If the JD requires PhD/doctorate and the CV does not show one, score <= 1.5.',
      'If the JD requires 5+ years or senior/staff/principal experience and the candidate is entry/junior, score <= 2.0 unless the JD clearly says early career.',
      'If the title is Senior/Staff/Principal/Lead/Manager and the candidate target excludes those levels, score <= 2.5.',
      'If hard requirements are not met, do not give a 4+ score even if keywords overlap.',
      'Consider: role archetype match, seniority fit, hard requirements, location, likely tech stack, and evidence in the CV.',
      '',
      'Respond in EXACTLY this format:',
      'SCORE: X.X',
      'REASON: one short sentence',
      'BLOCKERS: comma-separated blockers or None',
      'REPORT_MD_START',
      `# ${String(reportNum).padStart(3, '0')} — ${company} | ${title}`,
      '',
      `**Date:** ${TODAY}`,
      '**Score:** X.X/5',
      `**URL:** ${url}`,
      '**Legitimacy:** Proceed with Caution — matcher report, verify posting before applying',
      '**PDF:** ❌ (pending)',
      '',
      '---',
      '',
      '## A. Role Summary',
      '## B. CV Match',
      '## C. Hard Blockers',
      '## D. Recommendation',
      '## E. Resume Targeting Notes',
      '## F. Interview Prep Notes',
      '## G. Posting Legitimacy Notes',
      'REPORT_MD_END',
    ].join('\n');

    const proc = spawn('claude', ['--print'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    let out = '';
    proc.stdin.write(prompt);
    proc.stdin.end();
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', () => {});

    proc.on('close', () => {
      const scoreMatch  = out.match(/SCORE:\s*([\d.]+)/);
      const reasonMatch = out.match(/REASON:\s*(.+)/);
      const blockersMatch = out.match(/BLOCKERS:\s*(.+)/);
      const reportMatch = out.match(/REPORT_MD_START\s*([\s\S]*?)\s*REPORT_MD_END/);
      const rawScore = scoreMatch ? parseFloat(scoreMatch[1]).toFixed(1) : null;
      const score    = applyCap(rawScore, blockerInfo.cap);
      const reason   = reasonMatch ? reasonMatch[1].trim() : '';
      const blockers = blockersMatch ? blockersMatch[1].trim() : '';
      const reportMd = reportMatch
        ? reportMatch[1].trim().replace(/\*\*Score:\*\*\s*X\.X\/5/, `**Score:** ${score}/5`)
        : '';
      finish({ score, reason, blockers, reportMd });
    });

    proc.on('error', () => finish({ score: null, reason: 'claude not found' }));

    timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      finish({ score: null, reason: 'timeout' });
    }, 90_000);
  });
}

// ── Concurrency pool ────────────────────────────────────────────────
async function processWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const deletedReports = cleanupOldReports();
  if (deletedReports.length) {
    console.log(`🧹 Deleted ${deletedReports.length} report${deletedReports.length !== 1 ? 's' : ''} older than ${REPORT_RETENTION_DAYS} days.`);
  }

  const args = process.argv.slice(2);
  const allArg    = args.includes('--all');
  const todayArg  = args.includes('--today');
  const dryRun    = args.includes('--dry-run');
  const limitArg  = args.indexOf('--limit');
  const urlArg    = args.indexOf('--url');
  const concArg   = args.indexOf('--concurrency');
  const targetUrl = urlArg !== -1 ? String(args[urlArg + 1] || '').trim() : '';
  const limit     = limitArg !== -1 ? parseInt(args[limitArg + 1] || '0', 10) : 0;
  const concurrency = concArg !== -1 ? parseInt(args[concArg + 1] || '3', 10) : 3;
  const todayOnly = todayArg || (!allArg && !targetUrl);

  let { headers, rows } = readTsv();
  if (!headers.length) { console.log('No jobs found in scan-history.tsv'); return; }

  const urlIdx     = headers.indexOf('url');
  const titleIdx   = headers.indexOf('title');
  const companyIdx = headers.indexOf('company');
  const statusIdx  = headers.indexOf('status');
  const firstSeenIdx = headers.indexOf('first_seen');
  const postedAtIdx  = headers.indexOf('posted_at');
  let   scoreIdx   = headers.indexOf('score');

  if (scoreIdx === -1) {
    headers.push('score');
    scoreIdx = headers.length - 1;
    rows = rows.map(r => { while (r.length < headers.length) r.push(''); return r; });
  }

  // Build report index once (O(reports) disk reads, not O(rows * reports))
  buildReportIndex();

  let toScore = rows.filter(r => {
    const status  = r[statusIdx]  || '';
    const score   = r[scoreIdx]   || '';
    const url     = r[urlIdx]     || '';
    const title   = decodeCell(r[titleIdx]   || '');
    const company = decodeCell(r[companyIdx] || '');
    if (targetUrl && url !== targetUrl) return false;
    if (todayOnly && !isTodayRow(r, { firstSeenIdx, postedAtIdx })) return false;
    return isReportEligibleStatus(status) && (!score || !existingReportFor(url, company, title));
  });

  if (limit > 0) toScore = toScore.slice(0, limit);

  if (!toScore.length) {
    console.log('✓ All eligible jobs already have scores and reports.');
    return;
  }

  console.log(`Found ${toScore.length} job${toScore.length !== 1 ? 's' : ''} needing score/report. Matching…`);
  if (todayOnly) console.log(`Daily scope: only jobs first seen or posted on ${TODAY}. Use --all for the full backlog.`);
  if (limit > 0) console.log(`Manual cap: limited to ${limit}.`);
  console.log(`Concurrency: ${concurrency} parallel Claude calls`);
  console.log(`JD cache: data/jd-cache/ (fetches cached on first run)`);
  console.log('━'.repeat(60));

  if (dryRun) {
    for (const row of toScore.slice(0, 25)) {
      const title   = decodeCell(row[titleIdx]   || '');
      const company = decodeCell(row[companyIdx] || '');
      const score   = row[scoreIdx] || 'unscored';
      const cached  = getCachedJd(row[urlIdx] || '') ? '(cached)' : '(needs fetch)';
      console.log(`DRY RUN: ${company} — ${title} (${score}) ${cached}`);
    }
    console.log(`✓ Dry run only. No Claude calls made.`);
    return;
  }

  let done = 0;
  const total = toScore.length;

  await processWithConcurrency(toScore, concurrency, async (row) => {
    if (shuttingDown) return;
    const title   = decodeCell(row[titleIdx]   || '');
    const company = decodeCell(row[companyIdx] || '');
    const url     = row[urlIdx] || '';

    const jdText     = await fetchPostingText(url);
    const blockerInfo = detectBlockers(title, jdText);
    const { score, reason, reportMd } = await scoreJob(title, company, url, jdText, blockerInfo);

    const reportFile = score
      ? saveReport({ company, title, url, score, reason, blockers: blockerInfo.blockers, reportMd, jdText })
      : '';

    // Write score to TSV atomically
    const target = rows.find(r => r[urlIdx] === url);
    if (target && reportFile) {
      target[scoreIdx] = score ?? '';
      writeTsv(headers, rows);
    }

    done++;
    if (score) {
      const capNote = blockerInfo.cap < 5 ? ` cap=${blockerInfo.cap}` : '';
      console.log(`✅  [${done}/${total}] ${company} — ${title.slice(0, 40)} → ${score}/5${capNote}  ${reason.slice(0, 50)}  ${reportFile}`);
    } else {
      console.log(`⚠️   [${done}/${total}] ${company} — ${title.slice(0, 40)} → failed`);
    }
  });

  console.log('━'.repeat(60));
  console.log(`✓ Matched ${done} job${done !== 1 ? 's' : ''}. Refresh Jobs/Reports to see scores and reports.`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
