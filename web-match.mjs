#!/usr/bin/env node
/**
 * web-match.mjs — Batch job scorer for the career-ops web dashboard
 * Reads eligible jobs from scan-history.tsv, fetches the posting text,
 * scores each with claude --print using _profile.md + cv.md context,
 * writes scores back, and saves a markdown fit report.
 *
 * Usage: node web-match.mjs [--today] [--limit N] [--all]
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { buildResumeContext } from './resume-context.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TSV_PATH = join(ROOT, 'data', 'scan-history.tsv');
const REPORTS_DIR = join(ROOT, 'reports');
const TODAY = new Date().toISOString().slice(0, 10);
const REPORT_RETENTION_DAYS = parseInt(process.env.REPORT_RETENTION_DAYS || '7', 10);
let activeClaude = null;
let shuttingDown = false;

function stopActiveClaude() {
  if (!activeClaude || activeClaude.killed) return;
  try { activeClaude.kill('SIGTERM'); } catch {}
}

process.on('SIGTERM', () => {
  shuttingDown = true;
  stopActiveClaude();
});

process.on('SIGINT', () => {
  shuttingDown = true;
  stopActiveClaude();
});

function readSafe(p) {
  try { return readFileSync(p, 'utf-8'); } catch { return ''; }
}


// ── Load context files ──────────────────────────────────────────────
const profile = readSafe(join(ROOT, 'modes', '_profile.md'));
const shared  = readSafe(join(ROOT, 'modes', '_shared.md'));
const cv      = readSafe(join(ROOT, 'cv.md'));
const resumeContext = buildResumeContext(cv, { maxChars: 8000 });

if (!cv.trim()) {
  console.error('❌  cv.md not found. Set up your CV first.');
  process.exit(1);
}

// ── Read TSV ────────────────────────────────────────────────────────
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
  return String(value ?? '')
    .replace(/&#124;/g, '|')
    .replace(/\\\|/g, '|');
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'job';
}

function normalizeKey(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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

function nextReportNumber() {
  try {
    const nums = readdirSync(REPORTS_DIR)
      .map(name => parseInt(name.match(/^(\d+)-/)?.[1] || '0', 10))
      .filter(Boolean);
    return Math.max(0, ...nums) + 1;
  } catch {
    return 1;
  }
}

function existingReportFor(url, company, title) {
  try {
    for (const filename of readdirSync(REPORTS_DIR).filter(f => f.endsWith('.md'))) {
      const content = readSafe(join(REPORTS_DIR, filename));
      if (url && content.includes(url)) return filename;
      if (url) continue;
      const titleMatch = content.match(/^#\s+\d+\s+[—–-]\s+(.+)/m)?.[1] || '';
      const parts = titleMatch.split('|');
      if (parts.length >= 2) {
        const reportCompany = parts[0].trim();
        const reportTitle = parts.slice(1).join('|').trim();
        if (normalizeKey(reportCompany) === normalizeKey(company) && normalizeKey(reportTitle) === normalizeKey(title)) {
          return filename;
        }
      }
    }
  } catch {}
  return '';
}

function isReportEligibleStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return !normalized || normalized === 'added' || normalized === 'evaluated';
}

function isTodayRow(row, indexes) {
  const firstSeen = row[indexes.firstSeenIdx] || '';
  const postedAt = row[indexes.postedAtIdx] || '';
  return firstSeen === TODAY || postedAt === TODAY;
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function fetchPostingText(url) {
  if (!url?.startsWith('http')) return '';
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
    if (contentType.includes('json')) return JSON.stringify(JSON.parse(raw), null, 2).slice(0, 15000);
    return htmlToText(raw).slice(0, 15000);
  } catch (error) {
    return `Unable to fetch posting text from URL (${error.message}).`;
  } finally {
    clearTimeout(timer);
  }
}

function detectBlockers(title, jdText) {
  const text = `${title}\n${jdText}`.toLowerCase();
  const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(Boolean);
  const blockers = [];
  let cap = 5;

  const add = (label, scoreCap) => {
    blockers.push(label);
    cap = Math.min(cap, scoreCap);
  };

  if (/\b(no longer accepting applications|job is closed|position has been filled|posting has expired)\b/.test(text)) {
    add('Posting appears closed or expired', 1.0);
  }
  if (sentences.some(s => /\b(ph\.?d|doctorate|doctoral)\b/.test(s) && /\b(required|must|required qualification|minimum qualification|requires)\b/.test(s))) {
    add('PhD or doctorate appears required', 1.5);
  }
  if (/\b(active\s+)?(security\s+)?clearance\b/.test(text) && /\b(required|must|active)\b/.test(text)) {
    add('Active clearance appears required', 1.5);
  }
  if (/\b(staff|principal|director|manager|lead)\b/.test(title.toLowerCase())) {
    add('Title indicates senior leadership level', 2.0);
  }
  if (/\bsenior|sr\.\b|\bsr\b/.test(title.toLowerCase())) {
    add('Title indicates senior level', 2.5);
  }

  const years = [...text.matchAll(/\b([5-9]|1[0-5])\+?\s*(?:years|yrs)\b/g)]
    .map(match => parseInt(match[1], 10));
  if (years.some(n => n >= 7)) add('7+ years of experience appears required', 1.5);
  else if (years.some(n => n >= 5)) add('5+ years of experience appears required', 2.0);
  else if (years.some(n => n >= 3)) add('3+ years of experience appears required', 3.0);

  if (/\b(internship|intern|co-?op)\b/.test(text) && !/\bnew grad|entry[- ]level|early career\b/.test(text)) {
    add('Intern/co-op role may not match full-time target', 3.0);
  }

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
  return filename;
}

// ── Score a single job with claude --print ──────────────────────────
function scoreJob(title, company, url, jdText, blockerInfo) {
  return new Promise((resolve) => {
    if (shuttingDown) {
      resolve({ score: null, reason: 'stopped' });
      return;
    }

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
      `# ${String(nextReportNumber()).padStart(3, '0')} — ${company} | ${title}`,
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

    const proc = spawn('claude', ['--print'], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    activeClaude = proc;
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (activeClaude === proc) activeClaude = null;
      resolve(result);
    };

    let out = '';
    proc.stdin.write(prompt);
    proc.stdin.end();
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', () => {}); // suppress claude UI output

    proc.on('close', () => {
      const scoreMatch = out.match(/SCORE:\s*([\d.]+)/);
      const reasonMatch = out.match(/REASON:\s*(.+)/);
      const blockersMatch = out.match(/BLOCKERS:\s*(.+)/);
      const reportMatch = out.match(/REPORT_MD_START\s*([\s\S]*?)\s*REPORT_MD_END/);
      const rawScore = scoreMatch ? parseFloat(scoreMatch[1]).toFixed(1) : null;
      const score = applyCap(rawScore, blockerInfo.cap);
      const reason = reasonMatch ? reasonMatch[1].trim() : '';
      const blockers = blockersMatch ? blockersMatch[1].trim() : '';
      const reportMd = reportMatch ? reportMatch[1].trim().replace(/\*\*Score:\*\*\s*X\.X\/5/, `**Score:** ${score}/5`) : '';
      finish({ score, reason, blockers, reportMd });
    });

    proc.on('error', () => finish({ score: null, reason: 'claude not found' }));

    // Timeout after 60s
    timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      finish({ score: null, reason: 'timeout' });
    }, 60_000);
  });
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const deletedReports = cleanupOldReports();
  if (deletedReports.length) {
    console.log(`🧹 Deleted ${deletedReports.length} report${deletedReports.length !== 1 ? 's' : ''} older than ${REPORT_RETENTION_DAYS} days.`);
  }

  const args = process.argv.slice(2);
  const allArg = args.includes('--all');
  const todayArg = args.includes('--today');
  const dryRun = args.includes('--dry-run');
  const limitArg = args.indexOf('--limit');
  const urlArg = args.indexOf('--url');
  const targetUrl = urlArg !== -1 ? String(args[urlArg + 1] || '').trim() : '';
  const limit = limitArg !== -1 ? parseInt(args[limitArg + 1] || '0', 10) : 0;
  const todayOnly = todayArg || (!allArg && !targetUrl);

  let { headers, rows } = readTsv();
  if (!headers.length) { console.log('No jobs found in scan-history.tsv'); return; }

  const urlIdx    = headers.indexOf('url');
  const titleIdx  = headers.indexOf('title');
  const companyIdx= headers.indexOf('company');
  const statusIdx = headers.indexOf('status');
  const firstSeenIdx = headers.indexOf('first_seen');
  const postedAtIdx = headers.indexOf('posted_at');
  let   scoreIdx  = headers.indexOf('score');

  // Add score column if missing
  if (scoreIdx === -1) {
    headers.push('score');
    scoreIdx = headers.length - 1;
    rows = rows.map(r => { while (r.length < headers.length) r.push(''); return r; });
  }

  // Find active evaluation jobs that either need a score or need a full matcher report.
  let toScore = rows.filter(r => {
    const status = r[statusIdx] || '';
    const score  = r[scoreIdx]  || '';
    const url = r[urlIdx] || '';
    const title = decodeCell(r[titleIdx] || '');
    const company = decodeCell(r[companyIdx] || '');
    if (targetUrl && url !== targetUrl) return false;
    if (todayOnly && !isTodayRow(r, { firstSeenIdx, postedAtIdx })) return false;
    return isReportEligibleStatus(status) && (!score || !existingReportFor(url, company, title));
  });
  toScore.sort((a, b) => {
    const aScore = parseFloat(a[scoreIdx] || '');
    const bScore = parseFloat(b[scoreIdx] || '');
    const aHasScore = Number.isFinite(aScore);
    const bHasScore = Number.isFinite(bScore);
    if (aHasScore !== bHasScore) return aHasScore ? -1 : 1;
    if (aHasScore && bHasScore && bScore !== aScore) return bScore - aScore;
    return 0;
  });
  if (limit > 0) toScore = toScore.slice(0, limit);

  if (!toScore.length) {
    console.log('✓ All eligible jobs already have scores and reports.');
    return;
  }

  console.log(`Found ${toScore.length} job${toScore.length !== 1 ? 's' : ''} needing score/report. Matching…`);
  if (todayOnly) console.log(`Daily scope: only jobs first seen or posted on ${TODAY}. Use --all for the full backlog.`);
  if (limit > 0) console.log(`Manual cap: limited to ${limit}.`);
  console.log('━'.repeat(60));

  if (dryRun) {
    for (const row of toScore.slice(0, 25)) {
      const title = decodeCell(row[titleIdx] || '');
      const company = decodeCell(row[companyIdx] || '');
      const score = row[scoreIdx] || 'unscored';
      console.log(`DRY RUN: ${company} — ${title} (${score})`);
    }
    console.log(`✓ Dry run only. No Claude calls made.`);
    return;
  }

  let done = 0;
  for (const row of toScore) {
    if (shuttingDown) break;
    const title   = decodeCell(row[titleIdx]   || '');
    const company = decodeCell(row[companyIdx] || '');
    const url     = row[urlIdx]     || '';

    process.stdout.write(`⏳  [${done + 1}/${toScore.length}] ${company} — ${title.slice(0, 50)}…`);

    const jdText = await fetchPostingText(url);
    const blockerInfo = detectBlockers(title, jdText);
    const { score, reason, reportMd } = await scoreJob(title, company, url, jdText, blockerInfo);

    const reportFile = score
      ? saveReport({ company, title, url, score, reason, blockers: blockerInfo.blockers, reportMd, jdText })
      : '';

    // Commit score only after the matching report exists. This keeps score/report atomic.
    const target = rows.find(r => r[urlIdx] === url);
    if (target && reportFile) {
      target[scoreIdx] = score ?? '';
      writeTsv(headers, rows);
    }

    if (score) {
      const capNote = blockerInfo.cap < 5 ? ` cap=${blockerInfo.cap}` : '';
      process.stdout.write(`\r✅  [${done + 1}/${toScore.length}] ${company} — ${title.slice(0, 40)} → ${score}/5${capNote}  ${reason.slice(0, 50)}  ${reportFile}\n`);
    } else {
      process.stdout.write(`\r⚠️   [${done + 1}/${toScore.length}] ${company} — ${title.slice(0, 40)} → failed\n`);
    }
    done++;
  }

  console.log('━'.repeat(60));
  console.log(`✓ Matched ${done} job${done !== 1 ? 's' : ''}. Refresh Jobs/Reports to see scores and reports.`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
