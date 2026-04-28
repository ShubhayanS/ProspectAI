#!/usr/bin/env node

/**
 * scan.mjs — Zero-token portal scanner
 *
 * Fetches Greenhouse, Ashby, and Lever APIs directly, applies title
 * filters from portals.yml, deduplicates against existing history,
 * and appends new offers to pipeline.md + scan-history.tsv.
 *
 * Zero Claude API tokens — pure HTTP + JSON.
 *
 * Usage:
 *   node scan.mjs                        # scan all enabled companies
 *   node scan.mjs --dry-run              # preview without writing files
 *   node scan.mjs --company Cohere       # scan a single company
 *   node scan.mjs --since 24h            # only jobs posted in last 24 hours
 *   node scan.mjs --since 7d             # only jobs posted in last 7 days
 *   node scan.mjs --since 2026-04-20     # only jobs posted since specific date
 *   node scan.mjs --linkedin-max-pages 25 # LinkedIn pages per keyword (10 jobs/page)
 *   node scan.mjs --no-jd-cache          # skip zero-token JD prefetch
 *   node scan.mjs --verbose              # show per-company breakdown
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import yaml from 'js-yaml';
const parseYaml = yaml.load;

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = 'portals.yml';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';
const JD_CACHE_DIR = 'data/jd-cache';

// Ensure required directories exist (fresh setup)
mkdirSync('data', { recursive: true });

const CONCURRENCY = 10;
const JD_PREFETCH_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 10_000;
const JD_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_LINKEDIN_MAX_PAGES = 25;
const LINKEDIN_DETAIL_DELAY_MS = parseInt(process.env.LINKEDIN_DETAIL_DELAY_MS || '1200', 10);
const LINKEDIN_DETAIL_RETRIES = parseInt(process.env.LINKEDIN_DETAIL_RETRIES || '3', 10);
let linkedInFetchQueue = Promise.resolve();
let lastLinkedInFetchAt = 0;

function encodeCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\|/g, '&#124;');
}

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

async function fetchGenericPostingText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JD_FETCH_TIMEOUT_MS);
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

async function fetchLinkedInPostingText(url) {
  const id = linkedInJobId(url);
  if (!id) return '';
  return withLinkedInThrottle(async () => {
    const detailUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;
    for (let attempt = 1; attempt <= LINKEDIN_DETAIL_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), JD_FETCH_TIMEOUT_MS);
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
        const externalText = externalUrl ? await fetchGenericPostingText(externalUrl) : '';
        return [
          `LinkedIn public job detail: ${url}`,
          externalUrl ? `External apply URL: ${externalUrl}` : 'External apply URL: not exposed publicly; likely LinkedIn Easy Apply or login-gated.',
          linkedInText,
          externalText ? `\nExternal posting text:\n${externalText}` : '',
        ].filter(Boolean).join('\n\n').slice(0, 15000);
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

function urlHash(url) {
  return createHash('sha1').update(String(url || '')).digest('hex').slice(0, 16);
}

function jdCachePath(url) {
  return `${JD_CACHE_DIR}/${urlHash(url)}.txt`;
}

function getCachedJd(url) {
  try {
    const file = jdCachePath(url);
    return existsSync(file) ? readFileSync(file, 'utf-8') : '';
  } catch { return ''; }
}

function setCachedJd(url, text) {
  if (!url || !String(text || '').trim()) return false;
  try {
    mkdirSync(JD_CACHE_DIR, { recursive: true });
    writeFileSync(jdCachePath(url), String(text).slice(0, 15000), 'utf-8');
    return true;
  } catch { return false; }
}

// ── API detection ───────────────────────────────────────────────────

function detectApi(company) {
  // Greenhouse: explicit api field
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
  }

  const url = company.careers_url || '';

  // Ashby
  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashbyMatch) {
    return {
      type: 'ashby',
      url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true`,
    };
  }

  // Lever
  const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (leverMatch) {
    return {
      type: 'lever',
      url: `https://api.lever.co/v0/postings/${leverMatch[1]}`,
    };
  }

  // Greenhouse EU boards
  const ghEuMatch = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (ghEuMatch && !company.api) {
    return {
      type: 'greenhouse',
      url: `https://boards-api.greenhouse.io/v1/boards/${ghEuMatch[1]}/jobs`,
    };
  }

  return null;
}

// ── API parsers ─────────────────────────────────────────────────────

function parseGreenhouse(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company: companyName,
    location: j.location?.name || '',
    postedAt: j.updated_at || null,
    descriptionText: htmlToText([j.content, j.description].filter(Boolean).join('\n\n')),
  }));
}

function parseAshby(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.jobUrl || '',
    company: companyName,
    location: j.location || '',
    postedAt: j.publishedAt || null,
    descriptionText: htmlToText([j.descriptionPlain, j.descriptionHtml, j.description].filter(Boolean).join('\n\n')),
  }));
}

function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json.map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    company: companyName,
    location: j.categories?.location || '',
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    descriptionText: htmlToText([
      j.descriptionPlain,
      j.description,
      ...(j.lists || []).map(list => [list.text, list.content].filter(Boolean).join('\n')),
    ].filter(Boolean).join('\n\n')),
  }));
}

const PARSERS = { greenhouse: parseGreenhouse, ashby: parseAshby, lever: parseLever };

// ── Since parser ────────────────────────────────────────────────────

function parseSince(arg) {
  if (!arg) return null;
  const now = new Date();
  const hoursMatch = arg.match(/^(\d+)h$/);
  if (hoursMatch) return new Date(now - parseInt(hoursMatch[1]) * 3_600_000);
  const daysMatch = arg.match(/^(\d+)d$/);
  if (daysMatch) return new Date(now - parseInt(daysMatch[1]) * 86_400_000);
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) return new Date(arg + 'T00:00:00Z');
  throw new Error(`Invalid --since format. Use: 24h, 7d, 30d, or YYYY-MM-DD`);
}

// ── LinkedIn scraper ────────────────────────────────────────────────

// Maps --since duration to LinkedIn's f_TPR (seconds) parameter
function sinceToLinkedInTPR(sinceDate) {
  if (!sinceDate) return null;
  const seconds = Math.floor((Date.now() - sinceDate.getTime()) / 1000);
  return `r${seconds}`;
}

async function fetchLinkedIn(query, location, sinceDate, maxPages = DEFAULT_LINKEDIN_MAX_PAGES) {
  const tpr = sinceToLinkedInTPR(sinceDate);
  const allJobs = [];
  const seenUrls = new Set();
  const PAGE_SIZE = 10; // LinkedIn guest API returns ~10 per page
  const MAX_PAGES = Math.max(1, Math.min(50, parseInt(maxPages || DEFAULT_LINKEDIN_MAX_PAGES, 10))); // up to ~500/query

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      keywords: query,
      location: location || 'United States',
      f_JT: 'F',
      count: String(PAGE_SIZE),
      start: String(page * PAGE_SIZE),
    });
    if (tpr) params.set('f_TPR', tpr);

    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let pageJobs;
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.linkedin.com/jobs/search/',
        },
      });
      clearTimeout(timer);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      pageJobs = parseLinkedInHtml(html, query);
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }

    if (pageJobs.length === 0) break; // no more results

    let newOnPage = 0;
    for (const job of pageJobs) {
      if (!seenUrls.has(job.url)) {
        seenUrls.add(job.url);
        allJobs.push(job);
        newOnPage++;
      }
    }

    if (newOnPage === 0) break; // all dupes — end of results

    if (page < MAX_PAGES - 1) {
      await new Promise(r => setTimeout(r, 1000)); // polite delay between pages
    }
  }

  return allJobs;
}

function parseLinkedInHtml(html, queryLabel) {
  const jobs = [];

  // Each job card is a <li> block — split on li boundaries
  const liBlocks = html.split(/<li[^>]*>/);

  for (const block of liBlocks) {
    // Job URL: href to /jobs/view/ or /jobs/collections/
    const urlMatch = block.match(/href="(https:\/\/www\.linkedin\.com\/jobs\/view\/[^"?]+)/);
    if (!urlMatch) continue;

    const url = urlMatch[1].split('?')[0]; // strip tracking params

    // Title: <h3 ...>TEXT</h3>
    const titleMatch = block.match(/<h3[^>]*>\s*([^<]{3,120}?)\s*<\/h3>/);
    const title = titleMatch ? titleMatch[1].replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim() : '';
    if (!title) continue;

    // Company: <h4 ...>...<a ...>TEXT</a>...
    const companyMatch = block.match(/<h4[^>]*>[\s\S]*?<a[^>]*>\s*([^<]{2,80}?)\s*<\/a>/);
    const company = companyMatch ? companyMatch[1].trim() : 'LinkedIn';

    // Location: <span class="job-search-card__location">TEXT</span>
    const locationMatch = block.match(/job-search-card__location[^>]*>\s*([^<]{2,80}?)\s*</);
    const location = locationMatch ? locationMatch[1].trim() : '';

    // Posted date: <time datetime="YYYY-MM-DDT...">
    const timeMatch = block.match(/datetime="([^"]+)"/);
    const postedAt = timeMatch ? timeMatch[1] : null;

    jobs.push({ title, url, company, location, postedAt, source: 'linkedin' });
  }

  return jobs;
}

// ── Public remote job-board feeds ───────────────────────────────────

function buildFeedQueries(config) {
  const fromLinkedIn = (config.linkedin_queries || [])
    .filter(q => q.enabled !== false && q.keywords)
    .map(q => q.keywords);
  const fallback = [
    'Data Scientist',
    'Data Engineer',
    'Machine Learning Engineer',
    'Analytics Engineer',
    'Data Analyst',
  ];
  return [...new Set([...fromLinkedIn, ...fallback].map(q => String(q).trim()).filter(Boolean))];
}

function searchQueriesWant(config, sourceName) {
  const needle = sourceName.toLowerCase();
  return (config.search_queries || [])
    .filter(q => q.enabled !== false)
    .some(q => `${q.name || ''} ${q.query || ''}`.toLowerCase().includes(needle));
}

async function fetchRemotive(queries) {
  const byUrl = new Map();
  for (const query of queries) {
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}`;
    const json = await fetchJson(url);
    for (const j of json.jobs || []) {
      const jobUrl = j.url || '';
      if (!jobUrl || byUrl.has(jobUrl)) continue;
      byUrl.set(jobUrl, {
        title: j.title || '',
        url: jobUrl,
        company: j.company_name || 'Remotive',
        location: j.candidate_required_location || 'Remote',
        postedAt: j.publication_date || null,
        source: 'remotive',
        descriptionText: htmlToText(j.description || ''),
      });
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return [...byUrl.values()];
}

async function fetchRemoteOk() {
  const json = await fetchJson('https://remoteok.com/api');
  if (!Array.isArray(json)) return [];
  return json
    .filter(j => j && typeof j === 'object' && (j.position || j.url || j.apply_url))
    .map(j => ({
      title: j.position || '',
      url: j.url || j.apply_url || '',
      company: j.company || 'Remote OK',
      location: j.location || 'Remote',
      postedAt: j.date || (j.epoch ? new Date(j.epoch * 1000).toISOString() : null),
      source: 'remoteok',
      descriptionText: htmlToText(j.description || ''),
    }))
    .filter(j => j.url && j.title);
}

const SUPPORTED_SEARCH_FEEDS = [
  { key: 'remotive', label: 'Remotive' },
  { key: 'remoteok', label: 'Remote OK' },
];

// ── Fetch with timeout ──────────────────────────────────────────────

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPostingText(url) {
  if (!url?.startsWith('http')) return '';

  const cached = getCachedJd(url);
  const isLinkedIn = /linkedin\.com\/jobs\/view\//i.test(url);
  if (cached && (!isLinkedIn || cached.includes('LinkedIn public job detail:'))) return cached;

  return isLinkedIn
    ? await fetchLinkedInPostingText(url)
    : await fetchGenericPostingText(url);
}

async function prefetchJobDescriptions(offers, verbose = false) {
  const todo = offers.filter(o => o.url && !getCachedJd(o.url));
  if (!todo.length) return { cached: 0, skipped: offers.length, failed: 0 };

  let cached = 0;
  let failed = 0;
  const tasks = todo.map(job => async () => {
    const apiText = String(job.descriptionText || '').trim();
    const text = apiText.length >= 120 ? apiText.slice(0, 15000) : await fetchPostingText(job.url);
    if (text && setCachedJd(job.url, text)) {
      cached++;
      if (verbose) console.log(`  ↳ cached JD: ${job.company} | ${job.title}`);
    } else {
      failed++;
      if (verbose) console.log(`  ↳ JD unavailable: ${job.company} | ${job.title}`);
    }
  });

  await parallelFetch(tasks, JD_PREFETCH_CONCURRENCY);
  return { cached, skipped: offers.length - todo.length, failed };
}

// ── Title filter ────────────────────────────────────────────────────

function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());

  return (title) => {
    const lower = title.toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(k => lower.includes(k));
    return hasPositive && !hasNegative;
  };
}

// ── Location filter ─────────────────────────────────────────────────

function buildLocationFilter(locationFilter) {
  if (!locationFilter?.enabled) return () => true;

  const include = (locationFilter.include || []).map(k => k.toLowerCase());
  const exclude = (locationFilter.exclude || []).map(k => k.toLowerCase());
  const mode = locationFilter.mode || 'include';

  return (location) => {
    if (!location || location.trim() === '') return true; // empty = unknown, pass through

    const lower = location.toLowerCase();

    // Exclude overrides everything
    if (exclude.some(k => lower.includes(k))) return false;

    // In include mode: must match at least one include keyword
    if (mode === 'include') {
      return include.length === 0 || include.some(k => lower.includes(k));
    }

    return true;
  };
}

// ── Dedup ───────────────────────────────────────────────────────────

function loadSeenUrls() {
  const seen = new Set();

  // scan-history.tsv
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) { // skip header
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }

  // pipeline.md — extract URLs from checkbox lines
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(match[1]);
    }
  }

  // applications.md — extract URLs from report links and any inline URLs
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(match[0]);
    }
  }

  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    // Parse markdown table rows: | # | Date | Company | Role | ...
    for (const match of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
      const company = match[1].trim().toLowerCase();
      const role = match[2].trim().toLowerCase();
      if (company && role && company !== 'company') {
        seen.add(`${company}::${role}`);
      }
    }
  }
  return seen;
}

// ── Pipeline writer ─────────────────────────────────────────────────

function appendToPipeline(offers) {
  if (offers.length === 0) return;

  let text = existsSync(PIPELINE_PATH)
    ? readFileSync(PIPELINE_PATH, 'utf-8')
    : '# Pipeline Inbox\n\n## Pendientes\n\n## Procesadas\n';

  // Find "## Pendientes" section and append after it
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    // No Pendientes section — append at end before Procesadas
    const procIdx = text.indexOf('## Procesadas');
    const insertAt = procIdx === -1 ? text.length : procIdx;
    const block = `\n${marker}\n\n` + offers.map(o =>
      `- [ ] ${o.url} | ${encodeCell(o.company)} | ${encodeCell(o.title)}`
    ).join('\n') + '\n\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  } else {
    // Find the end of existing Pendientes content (next ## or end)
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;

    const block = '\n' + offers.map(o =>
      `- [ ] ${o.url} | ${encodeCell(o.company)} | ${encodeCell(o.title)}`
    ).join('\n') + '\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }

  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  // Ensure file + header exist
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tposted_at\tportal\ttitle\tcompany\tstatus\tscore\n', 'utf-8');
  } else {
    const current = readFileSync(SCAN_HISTORY_PATH, 'utf-8');
    const lines = current.split('\n');
    const headers = (lines[0] || '').split('\t');
    if (!headers.includes('posted_at')) {
      const upgraded = ['url', 'first_seen', 'posted_at', ...headers.slice(2)];
      const rebuilt = [upgraded.join('\t')];
      for (const line of lines.slice(1)) {
        if (!line.trim()) continue;
        const cells = line.split('\t');
        rebuilt.push([cells[0] || '', cells[1] || '', '', ...cells.slice(2)].join('\t'));
      }
      writeFileSync(SCAN_HISTORY_PATH, rebuilt.join('\n') + '\n', 'utf-8');
    }
  }

  const lines = offers.map(o =>
    `${o.url}\t${date}\t${o.postedAt || ''}\t${o.source}\t${encodeCell(o.title)}\t${encodeCell(o.company)}\tadded\t`
  ).join('\n') + '\n';

  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

// ── Parallel fetch with concurrency limit ───────────────────────────

async function parallelFetch(tasks, limit) {
  const results = [];
  let i = 0;

  async function next() {
    while (i < tasks.length) {
      const task = tasks[i++];
      results.push(await task());
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  const noJdCache = args.includes('--no-jd-cache');
  const companyFlag = args.indexOf('--company');
  const filterCompany = companyFlag !== -1 ? args[companyFlag + 1]?.toLowerCase() : null;
  const sinceFlag = args.indexOf('--since');
  const sinceDate = sinceFlag !== -1 ? parseSince(args[sinceFlag + 1]) : null;
  const linkedinMaxPagesFlag = args.indexOf('--linkedin-max-pages');

  // 1. Read portals.yml
  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first.');
    process.exit(1);
  }

  const config = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const companies = config.tracked_companies || [];
  const titleFilter = buildTitleFilter(config.title_filter);
  const locationFilter = buildLocationFilter(config.location_filter);
  const linkedinMaxPages = linkedinMaxPagesFlag !== -1
    ? parseInt(args[linkedinMaxPagesFlag + 1] || DEFAULT_LINKEDIN_MAX_PAGES, 10)
    : parseInt(config.linkedin?.max_pages || DEFAULT_LINKEDIN_MAX_PAGES, 10);

  // 2. Filter to enabled companies with detectable APIs
  const targets = companies
    .filter(c => c.enabled !== false)
    .filter(c => !filterCompany || c.name.toLowerCase().includes(filterCompany))
    .map(c => ({ ...c, _api: detectApi(c) }))
    .filter(c => c._api !== null);

  const skippedCompanies = companies
    .filter(c => c.enabled !== false)
    .filter(c => !filterCompany || c.name.toLowerCase().includes(filterCompany))
    .map(c => ({ ...c, _api: detectApi(c) }))
    .filter(c => c._api === null);
  const skippedCount = skippedCompanies.length;

  console.log(`Scanning ${targets.length} companies via API (${skippedCount} skipped — no API detected)`);
  if (sinceDate) console.log(`Time filter: jobs posted since ${sinceDate.toISOString().slice(0, 16)} UTC`);
  if (dryRun) console.log('(dry run — no files will be written)\n');
  if (verbose && skippedCompanies.length > 0) {
    console.log('Skipped companies without direct ATS API:');
    for (const c of skippedCompanies) console.log(`  · ${c.name} (${c.scan_method || 'unknown'})`);
    console.log('');
  }

  // 3. Load dedup sets
  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();

  // 4. Fetch all APIs
  const date = new Date().toISOString().slice(0, 10);
  let totalFound = 0;
  let totalFiltered = 0;
  let totalLocationFiltered = 0;
  let totalTooOld = 0;
  let totalDupes = 0;
  const newOffers = [];
  const errors = [];
  const companyResults = [];

  function considerOffer(job, source) {
    if (!titleFilter(job.title)) {
      totalFiltered++;
      return false;
    }
    if (!locationFilter(job.location)) {
      totalLocationFiltered++;
      return false;
    }
    if (sinceDate && job.postedAt) {
      if (new Date(job.postedAt) < sinceDate) {
        totalTooOld++;
        return false;
      }
    }
    if (seenUrls.has(job.url)) {
      totalDupes++;
      return false;
    }
    const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
    if (seenCompanyRoles.has(key)) {
      totalDupes++;
      return false;
    }
    seenUrls.add(job.url);
    seenCompanyRoles.add(key);
    newOffers.push({ ...job, source });
    return true;
  }

  const tasks = targets.map(company => async () => {
    const { type, url } = company._api;
    try {
      const json = await fetchJson(url);
      const jobs = PARSERS[type](json, company.name);
      totalFound += jobs.length;
      let companyNew = 0;

      for (const job of jobs) if (considerOffer(job, `${type}-api`)) companyNew++;
      if (verbose) {
        companyResults.push({ name: company.name, total: jobs.length, added: companyNew, portal: type });
      }
    } catch (err) {
      errors.push({ company: company.name, error: err.message });
      if (verbose) companyResults.push({ name: company.name, total: 0, added: 0, portal: type, error: err.message });
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  // 4b. LinkedIn queries (sequential — rate-limit friendly)
  const linkedInQueries = (config.linkedin_queries || []).filter(q => q.enabled !== false);
  let linkedInFound = 0;
  let linkedInScanned = 0;

  if (linkedInQueries.length > 0 && !filterCompany) {
    linkedInScanned = linkedInQueries.length;
    console.log(`\nScanning LinkedIn (${linkedInQueries.length} queries, up to ${linkedinMaxPages} pages/query)...`);

    for (const query of linkedInQueries) {
      try {
        const jobs = await fetchLinkedIn(query.keywords, query.location || 'United States', sinceDate, linkedinMaxPages);
        linkedInFound += jobs.length;
        let queryNew = 0;

        for (const job of jobs) if (considerOffer(job, 'linkedin')) queryNew++;

        if (verbose) {
          const flag = queryNew > 0 ? '+' : '·';
          console.log(`  ${flag} ${query.name || query.keywords} (${jobs.length} found, ${queryNew} new) [linkedin]`);
        }

        // Polite delay between LinkedIn requests
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        errors.push({ company: `LinkedIn: ${query.name || query.keywords}`, error: err.message });
        if (verbose) console.log(`  ✗ ${query.name || query.keywords}: ${err.message}`);
      }
    }

    totalFound += linkedInFound;
  }

  // 4c. Supported public remote-board feeds. These replace the old
  // websearch-only config for sources that expose a direct zero-token feed.
  const enabledSearchQueries = (config.search_queries || []).filter(q => q.enabled !== false);
  const wantsRemotive = searchQueriesWant(config, 'remotive');
  const wantsRemoteOk = searchQueriesWant(config, 'remoteok') || searchQueriesWant(config, 'remote ok');
  const feedResults = [];
  if (!filterCompany && (wantsRemotive || wantsRemoteOk)) {
    console.log(`\nScanning remote job-board feeds...`);
  }

  if (!filterCompany && wantsRemotive) {
    try {
      const jobs = await fetchRemotive(buildFeedQueries(config));
      totalFound += jobs.length;
      let added = 0;
      for (const job of jobs) if (considerOffer(job, 'remotive')) added++;
      feedResults.push({ name: 'Remotive', total: jobs.length, added });
      if (verbose) console.log(`  ${added > 0 ? '+' : '·'} Remotive (${jobs.length} found, ${added} new) [feed]`);
    } catch (err) {
      errors.push({ company: 'Remotive feed', error: err.message });
      if (verbose) console.log(`  ✗ Remotive: ${err.message}`);
    }
  }

  if (!filterCompany && wantsRemoteOk) {
    try {
      const jobs = await fetchRemoteOk();
      totalFound += jobs.length;
      let added = 0;
      for (const job of jobs) if (considerOffer(job, 'remoteok')) added++;
      feedResults.push({ name: 'Remote OK', total: jobs.length, added });
      if (verbose) console.log(`  ${added > 0 ? '+' : '·'} Remote OK (${jobs.length} found, ${added} new) [feed]`);
    } catch (err) {
      errors.push({ company: 'Remote OK feed', error: err.message });
      if (verbose) console.log(`  ✗ Remote OK: ${err.message}`);
    }
  }

  const unsupportedSearchQueries = enabledSearchQueries.filter(q => {
    const text = `${q.name || ''} ${q.query || ''}`.toLowerCase();
    return !SUPPORTED_SEARCH_FEEDS.some(feed => text.includes(feed.key.toLowerCase()) || text.includes(feed.label.toLowerCase()));
  });

  // 5. Prefetch JD text for new offers before scoring. This is zero-token
  // network IO and lets the matcher/resume flow reuse cached descriptions.
  let jdCacheResult = { cached: 0, skipped: 0, failed: 0 };
  if (!dryRun && !noJdCache && newOffers.length > 0) {
    console.log(`\nCaching job descriptions for ${newOffers.length} new offer${newOffers.length !== 1 ? 's' : ''}...`);
    jdCacheResult = await prefetchJobDescriptions(newOffers, verbose);
  }

  // 6. Write results
  if (!dryRun && newOffers.length > 0) {
    appendToPipeline(newOffers);
    appendToScanHistory(newOffers, date);
  }

  // 7. Print summary
  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Portal Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`Companies scanned:     ${targets.length} (ATS) + ${linkedInScanned} LinkedIn queries + ${feedResults.length} remote feeds`);
  console.log(`Total jobs found:      ${totalFound}`);
  console.log(`Filtered by title:     ${totalFiltered} removed`);
  if (config.location_filter?.enabled) {
    console.log(`Filtered by location:  ${totalLocationFiltered} removed (USA only)`);
  }
  if (sinceDate) {
    console.log(`Too old (--since):     ${totalTooOld} removed`);
  }
  console.log(`Duplicates:            ${totalDupes} skipped`);
  console.log(`New offers added:      ${newOffers.length}`);
  if (!dryRun && !noJdCache && newOffers.length > 0) {
    console.log(`JD cached:             ${jdCacheResult.cached} saved, ${jdCacheResult.skipped} already cached, ${jdCacheResult.failed} unavailable`);
  } else if (noJdCache) {
    console.log('JD cached:             skipped (--no-jd-cache)');
  }
  if (unsupportedSearchQueries.length > 0) {
    console.log(`Search queries:        ${unsupportedSearchQueries.length} web-search queries skipped (no search API configured)`);
  }

  if (verbose && companyResults.length > 0) {
    console.log('\nPer-company breakdown:');
    for (const r of companyResults) {
      const flag = r.error ? '✗' : r.added > 0 ? '+' : '·';
      const detail = r.error ? ` ERROR: ${r.error}` : ` (${r.total} found, ${r.added} new) [${r.portal}]`;
      console.log(`  ${flag} ${r.name}${detail}`);
    }
  }

  if (verbose && unsupportedSearchQueries.length > 0) {
    console.log('\nUnsupported web-search queries:');
    for (const q of unsupportedSearchQueries.slice(0, 12)) {
      console.log(`  · ${q.name || q.query}`);
    }
    if (unsupportedSearchQueries.length > 12) {
      console.log(`  · ... ${unsupportedSearchQueries.length - 12} more`);
    }
  }

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e.company}: ${e.error}`);
    }
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) {
      console.log(`  + ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
    }
    if (dryRun) {
      console.log('\n(dry run — run without --dry-run to save results)');
    } else {
      console.log(`\nResults saved to ${PIPELINE_PATH} and ${SCAN_HISTORY_PATH}`);
    }
  }

  console.log(`\n→ Run /career-ops pipeline to evaluate new offers.`);
  console.log('→ Share results and get help: https://discord.gg/8pRpHETxa4');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
