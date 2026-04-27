#!/usr/bin/env node
/**
 * web-match.mjs — Batch job scorer for the career-ops web dashboard
 * Reads all unscored "added" jobs from scan-history.tsv, scores each with
 * claude --print using _profile.md + cv.md context, writes scores back.
 *
 * Usage: node web-match.mjs [--limit N]
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TSV_PATH = join(ROOT, 'data', 'scan-history.tsv');

function readSafe(p) {
  try { return readFileSync(p, 'utf-8'); } catch { return ''; }
}


// ── Load context files ──────────────────────────────────────────────
const profile = readSafe(join(ROOT, 'modes', '_profile.md'));
const shared  = readSafe(join(ROOT, 'modes', '_shared.md'));
const cv      = readSafe(join(ROOT, 'cv.md'));

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

// ── Score a single job with claude --print ──────────────────────────
function scoreJob(title, company, url) {
  return new Promise((resolve) => {
    const prompt = [
      '## Quick Job Fit Scorer',
      '',
      'You are doing a rapid fit assessment. Based solely on my profile and CV, score this job.',
      '',
      '### My Profile',
      profile,
      '',
      '### My CV (summary)',
      cv.slice(0, 3000), // keep prompt compact
      '',
      '---',
      '',
      `### Job to Score`,
      `**Title:** ${title}`,
      `**Company:** ${company}`,
      `**URL:** ${url}`,
      '',
      '### Instructions',
      'Give a fit score from 0.0 to 5.0 (one decimal place).',
      'Consider: role archetype match, seniority fit, likely tech stack, company type.',
      '',
      'Respond in EXACTLY this format (no other text):',
      'SCORE: X.X',
      'REASON: one short sentence',
    ].join('\n');

    const proc = spawn('claude', ['--print'], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    proc.stdin.write(prompt);
    proc.stdin.end();
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', () => {}); // suppress claude UI output

    proc.on('close', () => {
      const scoreMatch = out.match(/SCORE:\s*([\d.]+)/);
      const reasonMatch = out.match(/REASON:\s*(.+)/);
      const score = scoreMatch ? parseFloat(scoreMatch[1]).toFixed(1) : null;
      const reason = reasonMatch ? reasonMatch[1].trim() : '';
      resolve({ score, reason });
    });

    proc.on('error', () => resolve({ score: null, reason: 'claude not found' }));

    // Timeout after 60s
    setTimeout(() => { try { proc.kill(); } catch {} resolve({ score: null, reason: 'timeout' }); }, 60_000);
  });
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  let { headers, rows } = readTsv();
  if (!headers.length) { console.log('No jobs found in scan-history.tsv'); return; }

  const urlIdx    = headers.indexOf('url');
  const titleIdx  = headers.indexOf('title');
  const companyIdx= headers.indexOf('company');
  const statusIdx = headers.indexOf('status');
  let   scoreIdx  = headers.indexOf('score');

  // Add score column if missing
  if (scoreIdx === -1) {
    headers.push('score');
    scoreIdx = headers.length - 1;
    rows = rows.map(r => { while (r.length < headers.length) r.push(''); return r; });
  }

  // Find unscored "added" jobs
  const toScore = rows.filter(r => {
    const status = r[statusIdx] || '';
    const score  = r[scoreIdx]  || '';
    return status === 'added' && !score;
  });

  if (!toScore.length) {
    console.log('✓ All eligible jobs already scored.');
    return;
  }

  console.log(`Found ${toScore.length} unscored job${toScore.length !== 1 ? 's' : ''}. Scoring…`);
  console.log('━'.repeat(60));

  let done = 0;
  for (const row of toScore) {
    const title   = row[titleIdx]   || '';
    const company = row[companyIdx] || '';
    const url     = row[urlIdx]     || '';

    process.stdout.write(`⏳  [${done + 1}/${toScore.length}] ${company} — ${title.slice(0, 50)}…`);

    const { score, reason } = await scoreJob(title, company, url);

    // Write score back into the rows array (find by url)
    const target = rows.find(r => r[urlIdx] === url);
    if (target) target[scoreIdx] = score ?? '';

    // Persist after each job so partial results survive interruption
    writeTsv(headers, rows);

    if (score) {
      process.stdout.write(`\r✅  [${done + 1}/${toScore.length}] ${company} — ${title.slice(0, 40)} → ${score}/5  ${reason.slice(0, 60)}\n`);
    } else {
      process.stdout.write(`\r⚠️   [${done + 1}/${toScore.length}] ${company} — ${title.slice(0, 40)} → failed\n`);
    }
    done++;
  }

  console.log('━'.repeat(60));
  console.log(`✓ Scored ${done} job${done !== 1 ? 's' : ''}. Refresh the Jobs page to see scores.`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
