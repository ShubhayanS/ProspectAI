#!/usr/bin/env node
/**
 * web-match.mjs — Batch job scorer for the career-ops web dashboard
 * Reads eligible jobs from scan-history.tsv, fetches the posting text
 * (cached in data/jd-cache/), screens each job locally, escalates likely
 * matches to claude --print, writes scores back, and saves a markdown fit report.
 *
 * Usage: node web-match.mjs [--today] [--limit N] [--all] [--concurrency N] [--claude-threshold N] [--local-only]
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import yaml from 'js-yaml';
import { buildResumeContext } from './resume-context.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TSV_PATH = join(ROOT, 'data', 'scan-history.tsv');
const REPORTS_DIR = join(ROOT, 'reports');
const JD_CACHE_DIR = join(ROOT, 'data', 'jd-cache');
const TODAY = new Date().toISOString().slice(0, 10);
const REPORT_RETENTION_DAYS = parseInt(process.env.REPORT_RETENTION_DAYS || '7', 10);
const LINKEDIN_DETAIL_DELAY_MS = parseInt(process.env.LINKEDIN_DETAIL_DELAY_MS || '1200', 10);
const LINKEDIN_DETAIL_RETRIES = parseInt(process.env.LINKEDIN_DETAIL_RETRIES || '3', 10);

let shuttingDown = false;
process.on('SIGTERM', () => { shuttingDown = true; });
process.on('SIGINT',  () => { shuttingDown = true; });
let linkedInFetchQueue = Promise.resolve();
let lastLinkedInFetchAt = 0;

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
const profileConfigRaw = readSafe(join(ROOT, 'config', 'profile.yml'));
let profileConfig = {};
try { profileConfig = yaml.load(profileConfigRaw) || {}; } catch { profileConfig = {}; }
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

// ── Candidate profile facts used by the local matcher ───────────────
function flattenStrings(value) {
  if (Array.isArray(value)) return value.flatMap(flattenStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(flattenStrings);
  return value == null ? [] : [String(value)];
}

const candidateFacts = (() => {
  const roles = [
    ...flattenStrings(profileConfig?.target_roles?.primary),
    ...flattenStrings(profileConfig?.target_roles?.archetypes).filter(v => !/^(entry|junior|primary|secondary|adjacent)$/i.test(v)),
  ].map(v => v.toLowerCase());

  const excludedLevels = [
    ...flattenStrings(profileConfig?.target_roles?.excluded_levels),
    'senior', 'staff', 'principal', 'lead', 'manager', 'director',
  ].map(v => v.toLowerCase());

  const combinedProfile = `${profile}\n${profileConfigRaw}\n${cv}`.toLowerCase();
  return {
    roles: [...new Set(roles)],
    excludedLevels: [...new Set(excludedLevels)],
    locationCountry: String(profileConfig?.location?.country || '').toLowerCase(),
    locationCity: String(profileConfig?.location?.city || '').toLowerCase(),
    locationState: String(profileConfig?.location?.state || '').toLowerCase(),
    locationPreferences: flattenStrings(profileConfig?.location?.preferences).map(v => v.toLowerCase()),
    visaStatus: String(profileConfig?.location?.visa_status || '').toLowerCase(),
    hasBachelors: /\b(bachelor|b\.?s\.?|ba|b\.a\.)\b/i.test(cv),
    hasMasters: /\b(master|m\.?s\.?|msc)\b/i.test(cv),
    mastersInProgress: /\b(expected|candidate|may\s+2026|2026)\b/i.test(cv) && /\b(master|m\.?s\.?|msc)\b/i.test(cv),
    hasPhd: /\b(ph\.?d\.?|doctorate|doctoral)\b/i.test(cv),
    profileText: combinedProfile,
  };
})();

const NON_US_LOCATION_RE = /\b(canada|toronto|vancouver|montreal|mexico|brazil|argentina|chile|colombia|europe|emea|apac|india|bangalore|bengaluru|hyderabad|delhi|mumbai|singapore|australia|sydney|melbourne|new zealand|united kingdom|uk|london|ireland|dublin|germany|berlin|munich|france|paris|spain|madrid|netherlands|amsterdam|switzerland|zurich|poland|warsaw|romania|portugal|lisbon)\b/i;
const US_REMOTE_RE = /\b(remote\s+(?:within\s+)?(?:the\s+)?(?:u\.?s\.?|united states|usa)|(?:u\.?s\.?|us|usa|united states)\s+remote|based in (?:the )?(?:u\.?s\.?|united states|usa))\b/i;
const US_CITIZEN_RE = /\b(u\.?s\.?\s+citizenship\s+(?:is\s+)?required|must\s+be\s+(?:a\s+)?u\.?s\.?\s+citizen|only\s+u\.?s\.?\s+citizens|requires\s+u\.?s\.?\s+citizenship)\b/i;

const SKILL_GROUPS = {
  python: ['python'],
  sql: ['sql', 'postgres', 'mysql'],
  r: [' r ', ' r,', ' r.', ' r/', 'r programming'],
  statistics: ['statistics', 'statistical', 'regression', 'classification', 'hypothesis', 'experiment', 'a/b'],
  ml: ['machine learning', ' ml ', 'predictive', 'modeling', 'model evaluation', 'sklearn', 'scikit'],
  etl: ['etl', 'elt', 'pipeline', 'pipelines', 'data engineering'],
  databricks: ['databricks', 'delta lake', 'medallion'],
  spark: ['spark', 'pyspark'],
  dbt: ['dbt'],
  airflow: ['airflow'],
  cloud: ['aws', 'azure', 'gcp', 'cloud'],
  warehouse: ['snowflake', 'bigquery', 'redshift', 'data warehouse'],
  bi: ['tableau', 'power bi', 'powerbi', 'dashboard', 'visualization'],
  nlp: ['nlp', 'llm', 'genai', 'generative ai'],
  deep_learning: ['pytorch', 'tensorflow', 'keras', 'deep learning'],
  api: ['rest api', 'restful', 'api', 'spring boot'],
  java: ['java', 'spring boot'],
  docker: ['docker', 'kubernetes', 'container'],
  healthcare: ['healthcare', 'clinical', 'patient', 'survival'],
};

const candidateSkillText = [
  cv,
  ...flattenStrings(profileConfig?.narrative?.superpowers),
  ...flattenStrings(profileConfig?.narrative?.proof_points),
].join('\n').toLowerCase();

const candidateSkillGroups = new Set(Object.entries(SKILL_GROUPS)
  .filter(([, terms]) => textHasSkill(candidateSkillText, terms))
  .map(([group]) => group));

function textHasSkill(text, terms) {
  const lower = ` ${String(text || '').toLowerCase()} `;
  return terms.some(term => lower.includes(term.toLowerCase()));
}

function skillGroupsInText(text) {
  return new Set(Object.entries(SKILL_GROUPS)
    .filter(([, terms]) => textHasSkill(text, terms))
    .map(([group]) => group));
}

function scoreTitleFit(title) {
  const t = String(title || '').toLowerCase();
  if (/\b(data scientist|decision scientist|applied scientist)\b/.test(t)) return { score: 1.0, label: 'target Data Scientist title' };
  if (/\b(data analyst|product analyst|business analyst|analytics analyst)\b/.test(t)) return { score: 0.85, label: 'target analyst title' };
  if (/\b(analytics engineer|data engineer|etl engineer|bi engineer)\b/.test(t)) return { score: 0.85, label: 'target data engineering title' };
  if (/\b(machine learning engineer|ml engineer|ai engineer)\b/.test(t)) return { score: 0.8, label: 'target ML title' };
  if (/\b(backend|software engineer|developer)\b/.test(t) && /\b(data|analytics|ml|ai|platform)\b/.test(t)) return { score: 0.55, label: 'adjacent data-heavy engineering title' };
  if (/\b(data|analytics|machine learning|ml|ai|scientist|analyst)\b/.test(t)) return { score: 0.45, label: 'partially related data title' };
  if (/\b(sales|account executive|recruiter|nurse|physician|attorney|cpa|finance manager|product manager|project manager|scrum master|designer)\b/.test(t)) {
    return { score: -0.6, label: 'non-target title family' };
  }
  return { score: 0.05, label: 'weak title alignment' };
}

function requiredSkillGaps(lines) {
  const requiredLines = lines.filter(line =>
    /\b(required|must have|minimum|you have|need(?:ed)?|requirements?|qualifications?)\b/i.test(line) &&
    !/\b(preferred|nice[- ]to[- ]have|plus|bonus|desired|desirable)\b/i.test(line)
  );
  const required = skillGroupsInText(requiredLines.join('\n'));
  const missing = [...required].filter(group => !candidateSkillGroups.has(group));
  return { required: [...required], missing };
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

function htmlDecode(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

function linkedInJobId(url) {
  return String(url || '').match(/linkedin\.com\/jobs\/view\/(?:[^/\s]+-)?(\d+)/i)?.[1] || '';
}

function extractLinkedInDescription(html) {
  const desc =
    String(html || '').match(/<div[^>]+class="[^"]*description__text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<ul class="description__job-criteria-list/i)?.[1] ||
    String(html || '').match(/<section[^>]+class="[^"]*show-more-less-html[^"]*"[^>]*>([\s\S]*?)<\/section>/i)?.[1] ||
    '';
  return htmlToText(desc || html);
}

function extractLinkedInExternalApplyUrl(html) {
  const matches = [...String(html || '').matchAll(/<a\b[^>]*class="[^"]*apply-button[^"]*"[^>]*href="([^"]+)"/gi)];
  for (const m of matches) {
    const href = htmlDecode(m[1]).trim();
    if (!href || /linkedin\.com\/(login|signup|jobs\/view)/i.test(href)) continue;
    try { return new URL(href, 'https://www.linkedin.com').toString(); } catch {}
  }
  return '';
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withLinkedInThrottle(fn) {
  const run = linkedInFetchQueue.then(async () => {
    const elapsed = Date.now() - lastLinkedInFetchAt;
    if (elapsed < LINKEDIN_DETAIL_DELAY_MS) await wait(LINKEDIN_DETAIL_DELAY_MS - elapsed);
    lastLinkedInFetchAt = Date.now();
    return fn();
  });
  linkedInFetchQueue = run.catch(() => {});
  return run;
}

async function fetchLinkedInPostingText(url) {
  const id = linkedInJobId(url);
  if (!id) return '';
  return withLinkedInThrottle(async () => {
    const detailUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;
    for (let attempt = 1; attempt <= LINKEDIN_DETAIL_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(detailUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.linkedin.com/jobs/search/',
          },
        });
        if (res.status === 429 && attempt < LINKEDIN_DETAIL_RETRIES) {
          clearTimeout(timer);
          await wait(4000 * attempt);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        const linkedInText = extractLinkedInDescription(html);
        if (linkedInText.length < 300) return '';
        const externalUrl = extractLinkedInExternalApplyUrl(html);
        let externalText = '';
        if (externalUrl) {
          externalText = await fetchGenericPostingText(externalUrl);
        }
        const parts = [
          `LinkedIn public job detail: ${url}`,
          externalUrl ? `External apply URL: ${externalUrl}` : 'External apply URL: not exposed publicly; likely LinkedIn Easy Apply or login-gated.',
          linkedInText,
          externalText ? `\nExternal posting text:\n${externalText}` : '',
        ].filter(Boolean);
        return parts.join('\n\n').slice(0, 15000);
      } catch {
        if (attempt >= LINKEDIN_DETAIL_RETRIES) return '';
        await wait(2500 * attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    return '';
  });
}

function hasUsablePostingText(url, jdText) {
  if (/Unable to fetch posting text/i.test(jdText)) return false;
  if (/linkedin\.com\/jobs\/view\//i.test(url)) {
    return jdText.includes('LinkedIn public job detail:') && jdText.length >= 700;
  }
  return String(jdText || '').trim().length >= 300;
}

async function fetchGenericPostingText(url) {
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
    return contentType.includes('json')
      ? JSON.stringify(JSON.parse(raw), null, 2).slice(0, 15000)
      : htmlToText(raw).slice(0, 15000);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPostingText(url) {
  if (!url?.startsWith('http')) return '';

  // Cache hit
  const cached = getCachedJd(url);
  const isLinkedIn = /linkedin\.com\/jobs\/view\//i.test(url);
  if (cached && (!isLinkedIn || cached.includes('LinkedIn public job detail:'))) return cached;

  const text = isLinkedIn
    ? await fetchLinkedInPostingText(url)
    : await fetchGenericPostingText(url);
  if (text) {
    setCachedJd(url, text);
    return text;
  }
  return `Unable to fetch posting text from URL.`;
}

// ── Blocker detection ───────────────────────────────────────────────
function detectBlockers(title, jdText) {
  const titleLower = String(title || '').toLowerCase();
  const fullText   = `${title}\n${jdText}`;
  const allLower   = fullText.toLowerCase();

  // Identify Minimum vs Preferred sections for context-aware parsing
  const minMatch  = fullText.match(/minimum qualifications?[:\s]*([\s\S]*?)(?=preferred qualifications?|additional qualifications?|nice[- ]to[- ]have|what we(?:'d like| prefer)|$)/i);
  const prefMatch = fullText.match(/preferred qualifications?[:\s]*([\s\S]*?)$/i);
  const minSection  = (minMatch  ? minMatch[1]  : fullText).toLowerCase();
  const prefSection = (prefMatch ? prefMatch[1] : '').toLowerCase();

  // Sentence = preferred if it contains soft-requirement language
  const isPreferredSentence = s =>
    /\b(preferred|nice[- ]to[- ]have|a plus|bonus point|ideally|desirable|advantageous|not required|would be great|we(?:'d)? like)\b/.test(s.toLowerCase());

  // "or equivalent [work/practical/professional/relevant] experience" softens degree req
  // Check against current sentence AND the next ~150 chars (handles line-split JDs)
  const hasEquivExp = (s, lookahead = '') =>
    /\bor equivalent( work| practical| professional| relevant| related)?\s*(experience|background)\b/i.test(s + ' ' + lookahead);

  const inPrefSection = s =>
    prefSection.length > 0 && prefSection.includes(s.toLowerCase().slice(0, 40).trim());

  const blockers = [];
  let cap = 5;
  const add = (label, scoreCap) => { blockers.push(label); cap = Math.min(cap, scoreCap); };

  // ── Closed posting ──────────────────────────────────────────────────
  if (/\b(no longer accepting applications|job is closed|position has been filled|posting has expired)\b/.test(allLower))
    add('Posting appears closed or expired', 1.0);

  // ── Geography and authorization ─────────────────────────────────────
  if (candidateFacts.locationCountry.includes('united states') &&
      NON_US_LOCATION_RE.test(allLower) &&
      !US_REMOTE_RE.test(allLower)) {
    add('Role appears outside the USA', 1.5);
  }

  if (US_CITIZEN_RE.test(allLower) && !/\bu\.?s\.?\s+citizen\b/i.test(candidateFacts.profileText)) {
    add('US citizenship appears required', 2.0);
  }

  const requiresOffice = /\b(on[- ]?site|onsite|hybrid|in[- ]office|office[- ]based|commute to|relocat(?:e|ion) to)\b/i.test(allLower);
  const mentionsRemote = /\b(remote|work from home|distributed)\b/i.test(allLower);
  const nearCandidate = new RegExp(`\\b(${candidateFacts.locationCity}|${candidateFacts.locationState}|philadelphia|philly|pennsylvania|pa)\\b`, 'i').test(allLower);
  const majorNonLocalCity = /\b(san francisco|bay area|palo alto|mountain view|sunnyvale|san jose|new york|nyc|brooklyn|seattle|bellevue|redmond|boston|cambridge|austin|dallas|houston|chicago|los angeles|santa monica|irvine|denver|boulder|atlanta|miami|washington dc|arlington|mclean)\b/i.test(allLower);
  if (requiresOffice && majorNonLocalCity && !nearCandidate && !mentionsRemote) {
    add('On-site or hybrid outside preferred location', 2.2);
  }

  // ── Professional credentials that are outside the target search ─────
  if (/\b(rn|registered nurse|nursing license|medical license|physician|md required|cpa required|bar admission|attorney license)\b/i.test(allLower)) {
    add('Requires non-target professional license', 1.5);
  }

  // ── Degree requirements ────────────────────────────────────────────
  // Split on sentence boundaries but keep consecutive lines together to handle
  // multi-line bullets like "Master's degree...\n...or equivalent experience"
  const rawLines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
  // Merge short continuation lines (< 60 chars starting with dash or lowercase) with previous
  const mergedLines = [];
  for (const line of rawLines) {
    if (mergedLines.length && line.length < 80 && /^[-•*]?\s*[a-z(,]/.test(line)) {
      mergedLines[mergedLines.length - 1] += ' ' + line;
    } else {
      mergedLines.push(line);
    }
  }

  let phdBlocked = false;
  for (let i = 0; i < mergedLines.length; i++) {
    const s  = mergedLines[i];
    const sl = s.toLowerCase();
    const lookahead = (mergedLines[i + 1] || '') + ' ' + (mergedLines[i + 2] || '');
    if (isPreferredSentence(sl) || inPrefSection(sl)) continue;

    if (/\b(ph\.?d\.?|doctorate|doctoral)\b/i.test(s)) {
      if (!hasEquivExp(s, lookahead)) {
        const acceptsMasters = /\b(ph\.?d\.?|doctorate)\b.*\b(or\s+)?\b(master|ms\.?|m\.s\.?|\bms\b|msc)\b/i.test(s) ||
          /\b(master|ms\.?|m\.s\.?|\bms\b|msc)\b.*\b(or\s+)?\b(ph\.?d\.?|doctorate)\b/i.test(s);
        if (acceptsMasters && candidateFacts.hasMasters) {
          add(candidateFacts.mastersInProgress ? "Advanced degree required; Master's is in progress" : 'Advanced degree required', 3.3);
          continue;
        }
        if (/\b(required|must|minimum|need)\b/i.test(s) ||
            minSection.includes(sl.slice(0, 35).trim())) {
          add('PhD required', 1.5);
          phdBlocked = true;
          break;
        }
      }
    }
  }

  if (!phdBlocked) {
    for (let i = 0; i < mergedLines.length; i++) {
      const s  = mergedLines[i];
      const sl = s.toLowerCase();
      const lookahead = (mergedLines[i + 1] || '') + ' ' + (mergedLines[i + 2] || '');
      if (isPreferredSentence(sl) || inPrefSection(sl)) continue;

      // Match "MS", "M.S.", "Master's", "MSc", "ms degree" — bare "ms" included
      if (/\b(master'?s?|m\.s\.?|msc|\bms\b|ms degree)\b/i.test(s) && !hasEquivExp(s, lookahead)) {
        // "MS or PhD" pattern → PhD-level requirement
        if (/\b(ms\.?|\bms\b|m\.s\.?|master'?s?)\b.*\b(or\s+ph\.?d|or\s+doctorate)\b/i.test(s) ||
            /\b(ph\.?d\.?|doctorate)\b.*\b(or\s+master|or\s+ms\b)\b/i.test(s)) {
          add(candidateFacts.hasMasters
            ? (candidateFacts.mastersInProgress ? "Master's/PhD required; Master's is in progress" : "Master's/PhD required")
            : "Master's or PhD required", candidateFacts.hasMasters ? 3.3 : 1.8);
          break;
        }
        // Standalone Master's in minimum quals section or explicitly required
        if (/\b(required|must have|minimum qualification)\b/i.test(s) ||
            (minSection.includes(sl.slice(0, 35).trim()) && !inPrefSection(sl))) {
          if (!candidateFacts.hasMasters) add("Master's degree required", 2.0);
          else if (candidateFacts.mastersInProgress) add("Master's degree required; degree is in progress", 3.5);
          break;
        }
      }
    }
  }

  // ── Security clearance ──────────────────────────────────────────────
  if (/\b(active\s+)?(security\s+)?clearance\b/.test(allLower) &&
      /\b(required|must|active|secret|top\s*secret)\b/.test(allLower))
    add('Security clearance required', 1.5);

  // ── Seniority from title ────────────────────────────────────────────
  if (/\b(vice\s*president|\bvp\b|\bsvp\b|\bevp\b)/.test(titleLower))
    add('VP-level role', 1.0);
  else if (/\b(staff|principal|director|head\b|head\s+of|\bcto\b|\bceo\b)/.test(titleLower))
    add('Staff/Principal/Director level role', 2.0);
  else if (/\b(l[4-9]|level\s*[4-9])\b/.test(titleLower))
    add('Senior level marker in title', 2.0);
  else if (/\blead\b/.test(titleLower) && !/\b(data|analytics|ml|ai|science|product)\s+lead\b/.test(titleLower))
    add('Lead level role', 2.0);
  else if (/\bmanager\b/.test(titleLower))
    add('Manager level role', 2.0);
  else if (/\bsenior\b|\bsr\.\s/.test(titleLower))
    add('Senior-level role', 2.5);

  // ── Experience years (context-aware, preferred-safe) ───────────────
  let maxRequiredYears = 0;
  for (const s of mergedLines) {
    const sl = s.toLowerCase();
    if (isPreferredSentence(sl) || inPrefSection(sl)) continue;
    // Only count sentences about overall experience, not tool-specific
    if (!/\b(years?\s+of\s+(?:experience|work|industry|professional|relevant|related)|experience\s+(?:in|with|working)\b|minimum.*years?|at\s+least.*years?|bs\s*\+\s*\d+|ms\s*\+\s*\d+)\b/i.test(s)) continue;
    // Skip "2+ years with Python/SQL/specific tool"
    if (/\b\d+\+?\s*years?\s*(?:with|using|in)\s+(?:python|sql|\br\b|java|javascript|tableau|excel|aws|azure|gcp|spark|pytorch|tensorflow)\b/i.test(sl)) continue;

    const re = /(\d+)\+?\s*(?:to|[-–]\s*\d+)?\s*years?/gi;
    let m;
    while ((m = re.exec(s)) !== null) {
      const y = parseInt(m[1]);
      if (Number.isFinite(y) && y >= 2) maxRequiredYears = Math.max(maxRequiredYears, y);
    }
    const degPat = s.match(/\b(?:bs|ms|phd|degree)\s*\+\s*(\d+)\s*years?\b/i);
    if (degPat) maxRequiredYears = Math.max(maxRequiredYears, parseInt(degPat[1]));
  }

  if      (maxRequiredYears >= 7) add(`${maxRequiredYears}+ years of experience required`, 1.5);
  else if (maxRequiredYears >= 5) add(`${maxRequiredYears}+ years of experience required`, 2.0);
  else if (maxRequiredYears >= 4) add(`${maxRequiredYears}+ years of experience required`, 2.5);
  else if (maxRequiredYears >= 3) add(`${maxRequiredYears}+ years of experience required`, 3.0);

  // ── Intern/co-op ────────────────────────────────────────────────────
  if (/\b(internship|intern\b|co-?op)\b/.test(allLower) &&
      !/\b(new grad|entry[- ]level|early career)\b/.test(allLower))
    add('Intern/co-op role', 3.0);

  const titleFit = scoreTitleFit(title);
  if (titleFit.score < 0) add('Role title is outside target families', 2.0);

  return { blockers: [...new Set(blockers)], cap };
}

function applyCap(score, cap) {
  if (!score) return null;
  return Math.min(parseFloat(score), cap).toFixed(1);
}

const STOPWORDS = new Set(`
  a an and are as at be by for from has have in into is it its of on or our that the their this to we with you your
  job role team work working experience skills ability will required preferred responsibilities qualifications company
  candidate candidates including based using related across within about plus strong must may
  sign join login password show hide click button expand search input email phone continue agree
  skip selected current list match policy agreement privacy cookie please note apply applied
  who see hire hired applicants ago hours days weeks month year years
`.trim().split(/\s+/));

const IMPORTANT_TERMS = new Set(`
  python sql r statistics statistical machine learning ml ai analytics analysis analyst scientist science engineer engineering
  data etl elt pipeline pipelines warehouse modeling model models predictive regression classification experiment experimentation
  tableau powerbi dashboard dashboards visualization pandas numpy sklearn scikit spark pyspark airflow dbt aws azure gcp
  cloud snowflake databricks bigquery postgres mysql nlp llm genai generative forecasting optimization product business
  stakeholder communication research healthcare finance marketing operations
  tensorflow pytorch keras xgboost lightgbm scipy matplotlib seaborn plotly
  restful api docker kubernetes git github bash linux
`.trim().split(/\s+/));

// Build profileTokens from cv.md only (actual skills/experience), NOT template files
function extractCvSkillTokens(cvText) {
  // Focus on sections that contain actual technical skills
  const sections = cvText.split(/^##\s+/m);
  const relevant = sections.filter(s =>
    /^(technical skills|work experience|projects|skills|experience)/i.test(s)
  );
  const text = relevant.length ? relevant.join('\n') : cvText;
  return tokenize(text);
}

const profileTokens = extractCvSkillTokens(cv);

function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/\bpower\s+bi\b/g, 'powerbi')
      .replace(/\bscikit[- ]learn\b/g, 'sklearn')
      .match(/[a-z][a-z0-9+#.]*/g)
      ?.filter(t => t.length > 2 && !STOPWORDS.has(t)) || []
  );
}

// Strip page chrome from fetched HTML (login walls, nav, footers)
function extractJdContent(rawText) {
  // Find where actual JD content starts — look for standard section markers
  const markers = [
    /minimum qualifications/i,
    /about the (?:job|role|position)/i,
    /job description/i,
    /what you(?:'ll| will) do/i,
    /responsibilities/i,
    /what we(?:'re| are) looking for/i,
    /requirements/i,
  ];
  for (const marker of markers) {
    const idx = rawText.search(marker);
    if (idx > 0 && idx < rawText.length * 0.8) {
      return rawText.slice(Math.max(0, idx - 200));
    }
  }
  // No marker found — strip first 600 chars (usually page chrome) if text is long enough
  return rawText.length > 1200 ? rawText.slice(600) : rawText;
}

function overlapCount(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

function localScoreJob(title, company, jdText, blockerInfo) {
  const cleanJd     = extractJdContent(jdText);
  const titleTokens = tokenize(title);
  const jdTokens    = tokenize(`${title}\n${cleanJd.slice(0, 9000)}`);
  const jdLines     = `${title}\n${cleanJd}`.split('\n').map(l => l.trim()).filter(Boolean);
  const titleFit    = scoreTitleFit(title);

  // Only count IMPORTANT_TERMS overlap (technical skills) — ignore generic words
  const importantInJd      = new Set([...jdTokens].filter(t => IMPORTANT_TERMS.has(t)));
  const importantInProfile = new Set([...profileTokens].filter(t => IMPORTANT_TERMS.has(t)));
  const sharedImportant    = overlapCount(importantInJd, importantInProfile);
  const totalImportantInJd = importantInJd.size;
  const titleOverlap       = overlapCount(titleTokens, importantInProfile);
  const jdSkillGroups      = skillGroupsInText(`${title}\n${cleanJd.slice(0, 9000)}`);
  const sharedSkillGroups  = [...jdSkillGroups].filter(group => candidateSkillGroups.has(group));
  const skillCoverage      = jdSkillGroups.size ? sharedSkillGroups.length / jdSkillGroups.size : 0;
  const gaps               = requiredSkillGaps(jdLines);

  // Jaccard-like: shared / total important terms in JD (rewards precision, not volume)
  const jaccardScore = totalImportantInJd > 0
    ? sharedImportant / totalImportantInJd
    : 0;

  // Dimensional local score. This is intentionally conservative: Claude only
  // sees jobs that pass role fit, hard filters, and enough evidence in the JD.
  let score = 1.0;
  score += Math.max(-0.8, titleFit.score) * 0.9;
  score += skillCoverage * 1.6;
  score += jaccardScore * 1.0;
  score += Math.min(0.35, titleOverlap * 0.17);

  const titleLower = String(title || '').toLowerCase();
  const textLower  = `${title}\n${cleanJd}`.toLowerCase();
  if (/\b(junior|jr\.?|entry[- ]level|new grad|early career|associate)\b/.test(textLower)) score += 0.35;
  if (/\b(0[-– ]?2|0[-– ]?3|1[-– ]?3)\s+years?\b/.test(textLower)) score += 0.2;
  if (/\b(senior|sr\.?|staff|principal|lead|manager|director)\b/.test(titleLower)) score -= 0.9;
  if (/\b(remote|work from home|distributed)\b/.test(textLower)) score += 0.15;
  if (/\b(philadelphia|philly|pennsylvania|\bpa\b)\b/.test(textLower)) score += 0.1;

  if (gaps.missing.length >= 4) score = Math.min(score - 0.8, 2.5);
  else if (gaps.missing.length >= 2) score = Math.min(score - 0.45, 3.2);
  else if (gaps.missing.length === 1) score -= 0.2;

  if (/unable to fetch posting text/i.test(jdText)) score = Math.min(score, 2.5);
  // No JD content at all — only title available
  if (cleanJd.length < 300) score = Math.min(score, 2.5);
  if (/linkedin\.com\/jobs\/view\//i.test(jdText) || jdText.includes('LinkedIn public job detail:')) {
    if (cleanJd.length < 900) score = Math.min(score, 3.0);
  }

  const capped = applyCap(Math.max(0.5, Math.min(5, score)).toFixed(1), blockerInfo.cap);
  const matchedTerms = [...importantInJd].filter(t => importantInProfile.has(t)).slice(0, 9);
  const reasons = [];
  reasons.push(`Role fit: ${titleFit.label}.`);
  if (matchedTerms.length) reasons.push(`Matched skills: ${matchedTerms.join(', ')}.`);
  if (sharedSkillGroups.length) reasons.push(`Skill groups: ${sharedSkillGroups.slice(0, 6).join(', ')}.`);
  if (gaps.missing.length) reasons.push(`Missing required signals: ${gaps.missing.slice(0, 4).join(', ')}.`);
  if (!matchedTerms.length && !sharedSkillGroups.length) reasons.push('Limited technical skill overlap with CV.');
  if (blockerInfo.blockers.length) reasons.push(`Blocker: ${blockerInfo.blockers[0]}.`);
  if (/unable to fetch posting text/i.test(jdText)) reasons.push('Posting fetch failed — score capped.');

  return {
    score: capped,
    reason: reasons.join(' '),
    reportMd: '',
    _debug: {
      titleFit: titleFit.score,
      sharedImportant,
      totalImportantInJd,
      jaccardScore: jaccardScore.toFixed(2),
      skillCoverage: skillCoverage.toFixed(2),
      requiredMissing: gaps.missing,
      titleOverlap,
    },
  };
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
let _claudeModel = process.env.MATCHER_MODEL || 'claude-haiku-4-5-20251001';

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

    const proc = spawn('claude', ['--print', '--model', _claudeModel], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
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

async function diagnoseLinkedInLocal({ rows, indexes, limit, concurrency }) {
  const { urlIdx, titleIdx, companyIdx, statusIdx } = indexes;
  const linkedinRows = rows
    .filter(r => /linkedin\.com\/jobs\/view\//i.test(r[urlIdx] || ''))
    .filter(r => isReportEligibleStatus(r[statusIdx] || ''))
    .slice(0, limit || 100);

  if (!linkedinRows.length) {
    console.log('No eligible LinkedIn jobs found in scan-history.tsv.');
    return;
  }

  console.log(`Diagnosing ${linkedinRows.length} LinkedIn job${linkedinRows.length !== 1 ? 's' : ''} with local scoring only.`);
  console.log('No scores or reports will be written. JD cache may be refreshed for LinkedIn rows.');
  console.log(`Concurrency: ${concurrency}`);
  console.log('━'.repeat(60));

  const results = await processWithConcurrency(linkedinRows, concurrency, async (row, idx) => {
    const url = row[urlIdx] || '';
    const title = decodeCell(row[titleIdx] || '');
    const company = decodeCell(row[companyIdx] || '');
    const jdText = await fetchPostingText(url);
    const blockerInfo = detectBlockers(title, jdText);
    const local = localScoreJob(title, company, jdText, blockerInfo);
    const externalMatch = jdText.match(/External apply URL:\s*(.+)/);
    const external = externalMatch ? externalMatch[1].trim() : '';
    const actualLinkedIn = jdText.includes('LinkedIn public job detail:');
    const hasRealText = actualLinkedIn && jdText.length >= 700 && !/Unable to fetch posting text/i.test(jdText);
    const item = {
      idx: idx + 1,
      company,
      title,
      url,
      score: local.score,
      jdChars: jdText.length,
      actualLinkedIn,
      hasRealText,
      external,
      blockers: blockerInfo.blockers,
      reason: local.reason,
    };
    const externalLabel = external && !/not exposed/i.test(external) ? 'external' : 'linkedin';
    const blockerLabel = blockerInfo.blockers[0] ? ` cap=${blockerInfo.cap} ${blockerInfo.blockers[0]}` : '';
    console.log(`✅  [${item.idx}/${linkedinRows.length}] ${company} — ${title.slice(0, 46)} → ${item.score}/5 jd=${item.jdChars} ${externalLabel}${blockerLabel}`);
    return item;
  });

  const fetched = results.filter(r => r.hasRealText).length;
  const external = results.filter(r => r.external && !/not exposed/i.test(r.external)).length;
  const failed = results.length - fetched;
  const avgChars = Math.round(results.reduce((sum, r) => sum + r.jdChars, 0) / Math.max(1, results.length));
  const distribution = { '<2': 0, '2-2.9': 0, '3-3.9': 0, '4+': 0 };
  const blockerCounts = new Map();
  for (const r of results) {
    const score = parseFloat(r.score || '0');
    if (score < 2) distribution['<2']++;
    else if (score < 3) distribution['2-2.9']++;
    else if (score < 4) distribution['3-3.9']++;
    else distribution['4+']++;
    for (const blocker of r.blockers) blockerCounts.set(blocker, (blockerCounts.get(blocker) || 0) + 1);
  }

  console.log('━'.repeat(60));
  console.log(`LinkedIn JD extracted: ${fetched}/${results.length}`);
  console.log(`External apply URLs exposed: ${external}/${results.length}`);
  console.log(`Fetch/quality failures: ${failed}/${results.length}`);
  console.log(`Average JD chars: ${avgChars}`);
  console.log(`Score distribution: ${JSON.stringify(distribution)}`);
  const topBlockers = [...blockerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`Top blockers: ${topBlockers.length ? topBlockers.map(([k, v]) => `${k} (${v})`).join('; ') : 'none'}`);
  console.log('\nSample reasons:');
  for (const r of results.slice(0, 10)) {
    console.log(`  - ${r.company} | ${r.title} | ${r.score}/5 | ${r.reason.slice(0, 180)}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const allArg    = args.includes('--all');
  const todayArg  = args.includes('--today');
  const dryRun    = args.includes('--dry-run');
  const limitArg  = args.indexOf('--limit');
  const urlArg    = args.indexOf('--url');
  const concArg   = args.indexOf('--concurrency');
  const thresholdArg = args.indexOf('--claude-threshold');
  const modelArg  = args.indexOf('--model');
  const diagnoseLinkedInArg = args.indexOf('--diagnose-linkedin');
  const targetUrl = urlArg !== -1 ? String(args[urlArg + 1] || '').trim() : '';
  const limit     = limitArg !== -1 ? parseInt(args[limitArg + 1] || '0', 10) : 0;
  const concurrency = concArg !== -1 ? parseInt(args[concArg + 1] || '3', 10) : 3;
  const diagnoseLinkedInLimit = diagnoseLinkedInArg !== -1
    ? parseInt(args[diagnoseLinkedInArg + 1] || '100', 10)
    : 0;
  const claudeThreshold = thresholdArg !== -1
    ? parseFloat(args[thresholdArg + 1] || '3.0')
    : parseFloat(process.env.MATCHER_CLAUDE_THRESHOLD || '3.0');
  if (modelArg !== -1 && args[modelArg + 1]) _claudeModel = args[modelArg + 1];
  const localOnly = args.includes('--local-only') || process.env.MATCHER_LOCAL_ONLY === '1';
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

  if (diagnoseLinkedInLimit > 0) {
    await diagnoseLinkedInLocal({
      rows,
      indexes: { urlIdx, titleIdx, companyIdx, statusIdx },
      limit: diagnoseLinkedInLimit,
      concurrency,
    });
    return;
  }

  const deletedReports = cleanupOldReports();
  if (deletedReports.length) {
    console.log(`🧹 Deleted ${deletedReports.length} report${deletedReports.length !== 1 ? 's' : ''} older than ${REPORT_RETENTION_DAYS} days.`);
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
  console.log(localOnly
    ? 'Mode: local screening only. No Claude calls will be made.'
    : `Mode: local screening first; Claude only for local score >= ${claudeThreshold.toFixed(1)} without hard blockers.`);
  console.log(`Concurrency: ${concurrency} parallel jobs`);
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

    const jdText      = await fetchPostingText(url);
    if (!hasUsablePostingText(url, jdText)) {
      done++;
      console.log(`⏳  [${done}/${total}] ${company} — ${title.slice(0, 40)} → skipped: JD unavailable/throttled; retry later`);
      return;
    }
    const blockerInfo = detectBlockers(title, jdText);
    const local = localScoreJob(title, company, jdText, blockerInfo);
    const shouldUseClaude =
      !localOnly &&
      parseFloat(local.score || '0') >= claudeThreshold &&
      blockerInfo.cap >= claudeThreshold;

    let result = local;
    let source = 'local';
    if (shouldUseClaude) {
      const aiResult = await scoreJob(title, company, url, jdText, blockerInfo);
      if (aiResult.score) {
        result = aiResult;
        source = 'claude';
      } else {
        result = {
          ...local,
          reason: `${local.reason} Claude escalation failed (${aiResult.reason || 'unknown'}), so local screening was saved.`,
        };
      }
    }

    const { score, reason, reportMd } = result;

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
      console.log(`✅  [${done}/${total}] ${company} — ${title.slice(0, 40)} → ${score}/5${capNote} (${source})  ${reason.slice(0, 50)}  ${reportFile}`);
    } else {
      console.log(`⚠️   [${done}/${total}] ${company} — ${title.slice(0, 40)} → failed`);
    }
  });

  console.log('━'.repeat(60));
  console.log(`✓ Matched ${done} job${done !== 1 ? 's' : ''}. Refresh Jobs/Reports to see scores and reports.`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
