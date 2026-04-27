import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import os from 'os';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const FONTS_DIR = path.join(ROOT, 'fonts');
const OUTPUT_DIR = path.join(ROOT, 'output');
const DATA_DIR = path.join(ROOT, 'data');
const REPORTS_DIR = path.join(ROOT, 'reports');
const CV_PATH       = path.join(ROOT, 'cv.md');
const PROFILE_PATH  = path.join(ROOT, 'config', 'profile.yml');
const TEMPLATE_PATH = path.join(ROOT, 'templates', 'cv-template.html');
const PORT = process.env.PORT || 3737;
const REPORT_RETENTION_DAYS = parseInt(process.env.REPORT_RETENTION_DAYS || '7', 10);
const VALID_APP_STATUSES = new Set(['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP']);
const TEMPLATE_VARIANTS = [
  {
    id: 'classic',
    name: 'Classic Blue',
    description: 'Gradient header with clear hierarchy and strong ATS-safe structure.',
    transform: (html) => html,
  },
  {
    id: 'graphite',
    name: 'Graphite Teal',
    description: 'Cooler accents with a quieter, more product-oriented tone.',
    transform: (html) => html
      .replace(/linear-gradient\(to right, hsl\(187, 74%, 32%\), hsl\(270, 70%, 45%\)\)/g, 'linear-gradient(to right, hsl(215, 35%, 28%), hsl(184, 65%, 30%))')
      .replace(/hsl\(187, 74%, 32%\)/g, 'hsl(184, 65%, 30%)')
      .replace(/hsl\(187, 74%, 28%\)/g, 'hsl(184, 55%, 24%)')
      .replace(/hsl\(187, 40%, 95%\)/g, 'hsl(210, 30%, 96%)')
      .replace(/hsl\(187, 40%, 88%\)/g, 'hsl(210, 24%, 84%)')
      .replace(/hsl\(270, 70%, 45%\)/g, 'hsl(215, 35%, 28%)'),
  },
  {
    id: 'minimal',
    name: 'Minimal Mono',
    description: 'A restrained monochrome variant with tighter spacing and low visual noise.',
    transform: (html) => html
      .replace(/linear-gradient\(to right, hsl\(187, 74%, 32%\), hsl\(270, 70%, 45%\)\)/g, '#1f2937')
      .replace(/hsl\(187, 74%, 32%\)/g, '#111827')
      .replace(/hsl\(187, 74%, 28%\)/g, '#111827')
      .replace(/hsl\(187, 40%, 95%\)/g, '#ffffff')
      .replace(/hsl\(187, 40%, 88%\)/g, '#d1d5db')
      .replace(/hsl\(270, 70%, 45%\)/g, '#111827')
      .replace(/border-radius: 3px;/g, 'border-radius: 0;')
      .replace(/padding: 4px 10px;/g, 'padding: 3px 8px;')
      .replace(/font-size: 28px;/g, 'font-size: 26px;')
      .replace(/margin-bottom: 20px;/g, 'margin-bottom: 16px;'),
  },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

let activeMatchProc = null;

function stopChildProcess(proc) {
  if (!proc || proc.killed) return;
  try { proc.kill('SIGTERM'); } catch {}
  setTimeout(() => {
    if (!proc.killed) {
      try { proc.kill('SIGKILL'); } catch {}
    }
  }, 3000).unref?.();
}

// ─── Parsers ──────────────────────────────────────────────────────────────

function decodeCell(value) {
  return String(value ?? '')
    .replace(/&#124;/g, '|')
    .replace(/\\\|/g, '|');
}

function encodeCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\|/g, '&#124;');
}

function splitMarkdownRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return [];
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map(cell => cell.trim());
}

function buildMarkdownRow(cells) {
  return `| ${cells.join(' | ')} |`;
}

function isValidAppStatus(status) {
  return VALID_APP_STATUSES.has(String(status || '').trim());
}

function normalizeKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&#124;/g, '|')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'candidate';
}

function cleanValue(value) {
  const s = String(value ?? '').trim();
  return s && s !== '—' && s.toUpperCase() !== 'N/A' ? s : '';
}

function scoreDisplay(value) {
  const s = cleanValue(value);
  if (!s) return '';
  return s.includes('/5') ? s : `${s}/5`;
}

function parseDateValue(value) {
  const t = Date.parse(value || '');
  return Number.isNaN(t) ? 0 : t;
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
    for (const filename of fs.readdirSync(REPORTS_DIR)) {
      if (!filename.endsWith('.md')) continue;
      const reportDate = reportDateFromFilename(filename);
      if (!reportDate) continue;
      const reportTime = new Date(`${reportDate}T00:00:00`).getTime();
      if (!Number.isFinite(reportTime) || reportTime >= cutoff.getTime()) continue;
      fs.unlinkSync(path.join(REPORTS_DIR, filename));
      deleted.push(filename);
    }
  } catch {}
  return deleted;
}

function injectTemplateVariantMeta(html, variantId) {
  const cleaned = stripTemplateVariantMeta(html);
  return `<!-- TEMPLATE_VARIANT: ${variantId} -->\n${cleaned}`;
}

function parseTemplateVariantMeta(html) {
  const match = String(html || '').match(/^<!-- TEMPLATE_VARIANT:\s*([a-z0-9_-]+)\s*-->/i);
  return match ? match[1] : 'classic';
}

function stripTemplateVariantMeta(html) {
  return String(html || '').replace(/^<!-- TEMPLATE_VARIANT:[\s\S]*?-->\s*/i, '');
}

function normalizeTemplateToClassic(html) {
  let out = stripTemplateVariantMeta(html);
  const rewrites = [
    [/background: linear-gradient\(to right, hsl\(215, 35%, 28%\), hsl\(184, 65%, 30%\)\);/g, 'background: linear-gradient(to right, hsl(187, 74%, 32%), hsl(270, 70%, 45%));'],
    [/color: hsl\(184, 65%, 30%\);/g, 'color: hsl(187, 74%, 32%);'],
    [/color: hsl\(184, 55%, 24%\);/g, 'color: hsl(187, 74%, 28%);'],
    [/background: hsl\(210, 30%, 96%\);/g, 'background: hsl(187, 40%, 95%);'],
    [/border: 1px solid hsl\(210, 24%, 84%\);/g, 'border: 1px solid hsl(187, 40%, 88%);'],
    [/color: hsl\(215, 35%, 28%\);/g, 'color: hsl(270, 70%, 45%);'],
  ];
  for (const [pattern, replacement] of rewrites) out = out.replace(pattern, replacement);

  out = out.replace(/(\.header\s*\{[\s\S]*?)margin-bottom:\s*16px;/, '$1margin-bottom: 20px;');
  out = out.replace(/(\.header h1\s*\{[\s\S]*?)font-size:\s*26px;/, '$1font-size: 28px;');
  out = out.replace(/(\.header-gradient\s*\{[\s\S]*?)background:\s*#1f2937;/, '$1background: linear-gradient(to right, hsl(187, 74%, 32%), hsl(270, 70%, 45%));');
  out = out.replace(/(\.section-title\s*\{[\s\S]*?)color:\s*#111827;/, '$1color: hsl(187, 74%, 32%);');
  out = out.replace(/(\.competency-tag\s*\{[\s\S]*?)color:\s*#111827;/, '$1color: hsl(187, 74%, 28%);');
  out = out.replace(/(\.competency-tag\s*\{[\s\S]*?)background:\s*#ffffff;/, '$1background: hsl(187, 40%, 95%);');
  out = out.replace(/(\.competency-tag\s*\{[\s\S]*?)padding:\s*3px 8px;/, '$1padding: 4px 10px;');
  out = out.replace(/(\.competency-tag\s*\{[\s\S]*?)border-radius:\s*0;/, '$1border-radius: 3px;');
  out = out.replace(/(\.competency-tag\s*\{[\s\S]*?)border:\s*1px solid #d1d5db;/, '$1border: 1px solid hsl(187, 40%, 88%);');
  out = out.replace(/(\.job-company\s*\{[\s\S]*?)color:\s*#111827;/, '$1color: hsl(270, 70%, 45%);');
  out = out.replace(/(\.project-title\s*\{[\s\S]*?)color:\s*#111827;/, '$1color: hsl(270, 70%, 45%);');
  out = out.replace(/(\.project-badge\s*\{[\s\S]*?)color:\s*#111827;/, '$1color: hsl(187, 74%, 32%);');
  out = out.replace(/(\.project-badge\s*\{[\s\S]*?)background:\s*#ffffff;/, '$1background: hsl(187, 40%, 95%);');
  out = out.replace(/(\.edu-org\s*\{[\s\S]*?)color:\s*#111827;/, '$1color: hsl(270, 70%, 45%);');
  out = out.replace(/(\.cert-org\s*\{[\s\S]*?)color:\s*#111827;/, '$1color: hsl(270, 70%, 45%);');
  return out;
}

function applyTemplateVariant(baseHtml, variantId) {
  const variant = TEMPLATE_VARIANTS.find(item => item.id === variantId) || TEMPLATE_VARIANTS[0];
  return injectTemplateVariantMeta(variant.transform(normalizeTemplateToClassic(baseHtml)), variant.id);
}

function parseProfileYaml(raw) {
  try { return yaml.load(raw) || {}; } catch {
    try {
      const normalized = String(raw || '').replace(/^(\s*[A-Za-z0-9_]+):(?=")/gm, '$1: ');
      return yaml.load(normalized) || {};
    } catch {
      return {};
    }
  }
}

function serializeProfileYaml(data) {
  return yaml.dump(data, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraphize(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .map(chunk => `<p>${escapeHtml(chunk)}</p>`)
    .join('');
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd: ROOT });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} exited ${code}`));
    });
  });
}

function xmlTextToPlainText(xml) {
  return String(xml || '')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function plainResumeToMarkdown(text, filename = 'resume') {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  if (/^#|^##\s+/m.test(lines.join('\n'))) return lines.join('\n');

  const first = lines[0];
  const rest = lines.slice(1);
  const sectionNames = new Set([
    'summary', 'professional summary', 'profile', 'education', 'experience',
    'work experience', 'employment', 'projects', 'skills', 'technical skills',
    'certifications', 'certifications & awards', 'awards',
  ]);

  const out = [`# ${first}`];
  for (const line of rest) {
    const normalized = line.toLowerCase().replace(/:$/, '');
    if (sectionNames.has(normalized)) out.push('', `## ${line.replace(/:$/, '')}`);
    else out.push(line);
  }

  return out.join('\n').trim() + `\n\n<!-- Imported from ${path.basename(filename)} -->\n`;
}

async function extractResumeUpload({ filename, mimeType, contentBase64 }) {
  const safeName = path.basename(filename || 'resume');
  const ext = path.extname(safeName).toLowerCase();
  const buffer = Buffer.from(contentBase64 || '', 'base64');
  if (!buffer.length) throw new Error('Uploaded resume was empty.');

  if (ext === '.md' || ext === '.txt') {
    const text = buffer.toString('utf-8');
    return ext === '.md' ? text : plainResumeToMarkdown(text, safeName);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-ops-resume-'));
  const inputPath = path.join(tmpDir, safeName);
  fs.writeFileSync(inputPath, buffer);

  try {
    if (ext === '.pdf' || mimeType === 'application/pdf') {
      const text = await runCapture('pdftotext', ['-layout', inputPath, '-']);
      return plainResumeToMarkdown(text, safeName);
    }

    if (ext === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const xml = await runCapture('unzip', ['-p', inputPath, 'word/document.xml']);
      return plainResumeToMarkdown(xmlTextToPlainText(xml), safeName);
    }

    if (ext === '.doc') {
      throw new Error('Legacy .doc upload is not supported on this machine. Please export as PDF or .docx.');
    }

    throw new Error('Unsupported resume format. Use PDF, .docx, .md, or .txt.');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function listItems(lines) {
  return lines
    .map(line => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .map(line => `<li>${escapeHtml(line)}</li>`)
    .join('');
}

function parseCvSections(markdown) {
  const sections = {};
  let current = 'intro';
  sections[current] = [];

  for (const line of String(markdown || '').split('\n')) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      current = heading[1].trim().toLowerCase();
      sections[current] = [];
      continue;
    }
    sections[current].push(line);
  }

  const pick = (...names) => {
    for (const name of names) {
      if (sections[name]) return sections[name];
    }
    return [];
  };

  return {
    summary: pick('summary', 'professional summary', 'profile', 'intro'),
    experience: pick('experience', 'work experience', 'employment'),
    projects: pick('projects', 'selected projects'),
    education: pick('education'),
    certifications: pick('certifications', 'licenses & certifications'),
    skills: pick('skills', 'technical skills'),
  };
}

function renderSimpleSection(lines, { itemClass = 'job', titleClass = 'job-company', bodyClass = 'project-desc' } = {}) {
  const blocks = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const bullets = listItems(current.bullets);
    const body = current.body.filter(Boolean).map(line => `<div class="${bodyClass}">${escapeHtml(line)}</div>`).join('');
    blocks.push(`
      <div class="${itemClass}">
        <div class="${titleClass}">${escapeHtml(current.title)}</div>
        ${body}
        ${bullets ? `<ul>${bullets}</ul>` : ''}
      </div>
    `);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      flush();
      current = { title: h3[1].trim(), body: [], bullets: [] };
      continue;
    }
    if (!current) current = { title: '', body: [], bullets: [] };
    if (/^[-*]\s+/.test(line)) current.bullets.push(line);
    else current.body.push(line);
  }
  flush();

  if (blocks.length) return blocks.join('');
  const bullets = listItems(lines.filter(line => /^[-*]\s+/.test(line.trim())));
  if (bullets) return `<ul>${bullets}</ul>`;
  return paragraphize(lines.join('\n'));
}

function buildCvHtml({ profile, cvMarkdown, templateHtml }) {
  const candidate = profile?.candidate || {};
  const sections = parseCvSections(cvMarkdown);
  const skillLines = sections.skills.map(line => line.trim()).filter(Boolean);
  const competencyTags = skillLines
    .flatMap(line => line.split(/[,|]/))
    .map(item => item.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 8)
    .map(item => `<span class="competency-tag">${escapeHtml(item)}</span>`)
    .join('');

  const replacements = {
    LANG: 'en',
    PAGE_WIDTH: '8.5in',
    NAME: candidate.full_name || 'Candidate',
    PHONE: candidate.phone || '',
    EMAIL: candidate.email || '',
    LINKEDIN_URL: candidate.linkedin ? `https://${String(candidate.linkedin).replace(/^https?:\/\//, '')}` : '#',
    LINKEDIN_DISPLAY: candidate.linkedin || '',
    PORTFOLIO_URL: candidate.portfolio_url || '#',
    PORTFOLIO_DISPLAY: candidate.portfolio_url || '',
    LOCATION: candidate.location || '',
    SECTION_SUMMARY: 'Professional Summary',
    SUMMARY_TEXT: paragraphize(sections.summary.join('\n')),
    SECTION_COMPETENCIES: 'Core Competencies',
    COMPETENCIES: competencyTags || '<span class="competency-tag">Resume Review</span>',
    SECTION_EXPERIENCE: 'Work Experience',
    EXPERIENCE: renderSimpleSection(sections.experience),
    SECTION_PROJECTS: 'Projects',
    PROJECTS: renderSimpleSection(sections.projects, { itemClass: 'project', titleClass: 'project-title', bodyClass: 'project-desc' }),
    SECTION_EDUCATION: 'Education',
    EDUCATION: renderSimpleSection(sections.education, { itemClass: 'edu-item', titleClass: 'job-company', bodyClass: 'project-desc' }),
    SECTION_CERTIFICATIONS: 'Certifications',
    CERTIFICATIONS: renderSimpleSection(sections.certifications, { itemClass: 'edu-item', titleClass: 'job-company', bodyClass: 'project-desc' }),
    SECTION_SKILLS: 'Skills',
    SKILLS: paragraphize(sections.skills.join('\n')),
  };

  let html = templateHtml;
  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(`{{${key}}}`, value);
  }
  html = html.replace(/<span class="separator"><\/span>/g, '');
  html = html.replace(/<a href="#">\s*<\/a>/g, '');
  return html;
}

function getTemplateOptions(activeId) {
  const sampleProfile = {
    candidate: {
      full_name: 'Alex Morgan',
      email: 'alex@example.com',
      phone: '+1 (555) 123-4567',
      linkedin: 'linkedin.com/in/alexmorgan',
      portfolio_url: 'alexmorgan.dev',
      location: 'New York, NY',
    },
  };
  const sampleCv = `
## Summary
Applied AI engineer with a background in analytics, production data systems, and human-in-the-loop automation.

## Experience
### Northstar Labs
Senior Data & AI Engineer
- Built internal evaluation workflows for LLM features used by product and operations teams.
- Shipped analytics pipelines and decision-support tooling across Python, SQL, and dbt.

### Atlas Health
Analytics Engineer
- Modeled product and clinical data for reporting, experimentation, and forecasting.
- Partnered with stakeholders to turn ambiguous requirements into production dashboards.

## Projects
### Agent Ops Console
- Built a monitoring surface for agent runs, review queues, and intervention workflows.

### Career Match Evaluator
- Created a scoring workflow that ranks opportunities by fit, freshness, and process signals.

## Education
### State University
B.S. Computer Science

## Certifications
### dbt Fundamentals
Analytics Engineering Certificate

## Skills
Python, SQL, dbt, Analytics Engineering, Applied AI, Prompt Design, Experimentation, Stakeholder Communication
  `.trim();

  const baseTemplate = normalizeTemplateToClassic(readSafe(TEMPLATE_PATH));
  return TEMPLATE_VARIANTS.map(variant => {
    const html = applyTemplateVariant(baseTemplate, variant.id);
    return {
      id: variant.id,
      name: variant.name,
      description: variant.description,
      active: variant.id === activeId,
      preview: buildCvHtml({ profile: sampleProfile, cvMarkdown: sampleCv, templateHtml: html }),
    };
  });
}

function readSafe(filepath) {
  try { return fs.readFileSync(filepath, 'utf-8'); } catch { return ''; }
}

function parseScanHistory() {
  ensureScanHistorySchema();
  const content = readSafe(path.join(DATA_DIR, 'scan-history.tsv'));
  const lines = content.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map(h => h.trim());
  return lines.slice(1).map(row => {
    const cells = row.split('\t');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = decodeCell((cells[i] || '').trim()); });
    return obj;
  }).filter(r => r.url);
}

function ensureScanHistorySchema() {
  const filepath = path.join(DATA_DIR, 'scan-history.tsv');
  if (!fs.existsSync(filepath)) return ['url', 'first_seen', 'posted_at', 'portal', 'title', 'company', 'status', 'score'];

  const raw = readSafe(filepath);
  if (!raw.trim()) {
    const headers = ['url', 'first_seen', 'posted_at', 'portal', 'title', 'company', 'status', 'score'];
    fs.writeFileSync(filepath, headers.join('\t') + '\n', 'utf-8');
    return headers;
  }

  const lines = raw.split('\n');
  const headers = lines[0].split('\t').map(h => h.trim());
  if (headers.includes('posted_at')) return headers;

  const upgraded = ['url', 'first_seen', 'posted_at', ...headers.slice(2)];
  const rebuilt = [upgraded.join('\t')];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const firstSeen = cells[1] || '';
    rebuilt.push([cells[0] || '', firstSeen, '', ...cells.slice(2)].join('\t'));
  }
  fs.writeFileSync(filepath, rebuilt.join('\n') + '\n', 'utf-8');
  return upgraded;
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
      if (m) pending.push({ url: m[1], company: decodeCell(m[2].trim()), title: decodeCell(m[3].trim()) });
      const lm = line.match(/^-\s+\[\s\]\s+(local:[^\s|]+)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$/);
      if (lm) pending.push({ url: lm[1], company: decodeCell(lm[2].trim()), title: decodeCell(lm[3].trim()) });
    }

    if (section === 'processed') {
      const m = line.match(/^-\s+\[x\]\s+#?(\d+)\s*\|\s*(https?:\/\/\S+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([\d.]+\/5)\s*\|\s*PDF\s*([✅❌])/);
      if (m) processed.push({
        num: parseInt(m[1]), url: m[2], company: m[3].trim(),
        title: decodeCell(m[4].trim()), score: m[5], pdf: m[6] === '✅',
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
  const headers = splitMarkdownRow(lines[0]);
  const history = parseScanHistory();
  const historyByKey = new Map(history.map(item => [`${normalizeKey(item.company)}::${normalizeKey(item.title)}`, item]));
  return lines.slice(1).map(line => {
    const cells = splitMarkdownRow(line).map(decodeCell);
    if (cells.length !== headers.length) return null;
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] || ''; });
    const historyMatch = historyByKey.get(`${normalizeKey(obj['Company'])}::${normalizeKey(obj['Role'])}`);
    if (historyMatch) {
      obj._scan_first_seen = historyMatch.first_seen || '';
      obj._scan_posted_at = historyMatch.posted_at || '';
      obj._job_url = historyMatch.url || '';
    }
    return obj;
  }).filter(r => r && r['#'] && /^\d+$/.test(r['#']));
}

function parseReports() {
  try {
    cleanupOldReports();
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

function splitReportTitle(title) {
  const cleaned = String(title || '').replace(/^\d+\s*[—–-]\s*/, '').trim();
  const parts = cleaned.split('|');
  if (parts.length >= 2) {
    return { company: parts[0].trim(), title: parts.slice(1).join('|').trim() };
  }
  return { company: '', title: cleaned };
}

function reportMarkdownLink(reportFile, reportNum) {
  return reportFile ? `[${reportNum || 'report'}](reports/${reportFile})` : '—';
}

function buildJobRecords() {
  const history = parseScanHistory();
  const apps = parseApplications();
  const reports = parseReports();
  const byUrl = new Map();
  const byKey = new Map();

  const keyFor = (company, title) => `${normalizeKey(company)}::${normalizeKey(title)}`;
  const put = (incoming) => {
    const key = keyFor(incoming.company, incoming.title);
    let existing = incoming.url ? byUrl.get(incoming.url) : null;
    if (!existing && key !== '::') {
      const keyed = byKey.get(key);
      if (!incoming.url || !keyed?.url || keyed.url === incoming.url) existing = keyed;
    }
    if (!existing) {
      existing = {};
    }

    for (const [field, value] of Object.entries(incoming)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' && !cleanValue(value) && !['score', 'posted_at', 'notes', 'resume_status', 'report_file'].includes(field)) continue;
      existing[field] = value;
    }

    existing.company_key = normalizeKey(existing.company);
    existing.title_key = normalizeKey(existing.title);
    existing.id = existing.url || keyFor(existing.company, existing.title);
    if (existing.url) byUrl.set(existing.url, existing);
    if (key !== '::') byKey.set(key, existing);
    return existing;
  };

  for (const h of history) {
    put({
      source: 'scan',
      url: h.url,
      first_seen: h.first_seen || '',
      posted_at: h.posted_at || '',
      portal: h.portal || '',
      title: h.title || '',
      company: h.company || '',
      status: h.status || 'added',
      score: cleanValue(h.score),
      score_display: scoreDisplay(h.score),
    });
  }

  for (const app of apps) {
    const reportFile = (app['Report'] || '').match(/\(reports\/([^)]+)\)/)?.[1] || '';
    const reportNum = (app['Report'] || '').match(/\[(\d+)\]/)?.[1] || app['#'] || '';
    const appScore = scoreDisplay(app['Score']);
    put({
      source: 'application',
      url: app._job_url || '',
      company: app['Company'] || '',
      title: app['Role'] || '',
      application_num: app['#'] || '',
      application_date: app['Date'] || '',
      status: app['Status'] || '',
      score: appScore ? appScore.replace(/\/5$/, '') : undefined,
      score_display: appScore || undefined,
      resume_status: app['PDF'] || '',
      report: app['Report'] || '',
      report_file: reportFile,
      report_num: reportNum,
      notes: app['Notes'] || '',
      first_seen: app._scan_first_seen || undefined,
      posted_at: app._scan_posted_at || undefined,
    });
  }

  for (const report of reports) {
    const parts = splitReportTitle(report.title);
    put({
      source: 'report',
      url: report.url || '',
      company: parts.company || report.slug,
      title: parts.title || report.title,
      report_file: report.filename,
      report_num: String(report.num).padStart(3, '0'),
      report_date: report.date,
      report: reportMarkdownLink(report.filename, report.num),
      legitimacy: report.legitimacy || '',
      score: report.score ? report.score.replace(/\/5$/, '') : undefined,
      score_display: report.score || undefined,
      status: undefined,
    });
  }

  return [...new Set([...byUrl.values(), ...byKey.values()])]
    .map(record => {
      const score = scoreDisplay(record.score_display || record.score);
      return {
        ...record,
        score: score ? score.replace(/\/5$/, '') : '',
        score_display: score,
        status: record.status || 'added',
        '#': record.application_num || '',
        Date: record.application_date || record.first_seen || record.report_date || '',
        Company: record.company || '',
        Role: record.title || '',
        Score: score || 'N/A',
        Status: record.status || 'added',
        PDF: record.resume_status || '—',
        Report: record.report || reportMarkdownLink(record.report_file, record.report_num),
        Notes: record.notes || '',
      };
    })
    .sort((a, b) =>
      parseDateValue(b.posted_at || b.first_seen || b.application_date || b.report_date) -
      parseDateValue(a.posted_at || a.first_seen || a.application_date || a.report_date) ||
      (parseFloat(b.score) || -1) - (parseFloat(a.score) || -1)
    );
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
  if (route === 'applications') {
    const records = buildJobRecords().filter(j => j.application_num || VALID_APP_STATUSES.has(j.status));
    return json(res, records);
  }
  if (route === 'reports' && req.method === 'GET') {
    const records = buildJobRecords()
      .filter(j => j.report_file || scoreDisplay(j.score).trim())
      .sort((a, b) =>
        (parseFloat(b.score) || -1) - (parseFloat(a.score) || -1) ||
        parseDateValue(b.report_date || b.first_seen) - parseDateValue(a.report_date || a.first_seen)
      );
    return json(res, records);
  }
  if (route === 'top-matches' && req.method === 'GET') {
    const allowedTopMatchStatus = (status) => {
      const normalized = String(status || '').trim().toLowerCase();
      return !normalized || normalized === 'added' || normalized === 'evaluated';
    };
    const records = buildJobRecords()
      .filter(j => parseFloat(j.score) >= 4)
      .filter(j => allowedTopMatchStatus(j.status))
      .sort((a, b) =>
        parseDateValue(b.posted_at || b.first_seen || b.report_date) -
        parseDateValue(a.posted_at || a.first_seen || a.report_date) ||
        (parseFloat(b.score) || -1) - (parseFloat(a.score) || -1)
      );
    return json(res, records);
  }

  if (route === 'jobs') {
    let jobs = buildJobRecords();
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search')?.toLowerCase();
    const company = url.searchParams.get('company')?.toLowerCase();
    const jobUrl = url.searchParams.get('url');
    if (status && status !== 'all') jobs = jobs.filter(j => j.status === status);
    if (search) jobs = jobs.filter(j =>
      j.title?.toLowerCase().includes(search) || j.company?.toLowerCase().includes(search));
    if (company) jobs = jobs.filter(j => j.company?.toLowerCase().includes(company));
    if (jobUrl) jobs = jobs.filter(j => j.url === jobUrl);
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

  if (route === 'cv/upload' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const content = await extractResumeUpload(payload);
        if (!content.trim()) throw new Error('Could not extract readable text from the uploaded resume.');
        fs.writeFileSync(CV_PATH, content, 'utf-8');
        json(res, { ok: true, content });
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }

  if (route === 'profile' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(readSafe(PROFILE_PATH));
    return;
  }

  if (route === 'profile/data' && req.method === 'GET') {
    return json(res, parseProfileYaml(readSafe(PROFILE_PATH)));
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

  if (route === 'profile/data' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { profile } = JSON.parse(body);
        const yamlText = serializeProfileYaml(profile || {});
        fs.writeFileSync(PROFILE_PATH, yamlText, 'utf-8');
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

  if (route === 'template/options' && req.method === 'GET') {
    const activeId = parseTemplateVariantMeta(readSafe(TEMPLATE_PATH));
    return json(res, {
      active: activeId,
      options: getTemplateOptions(activeId),
    });
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

  if (route === 'template/select' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { variantId } = JSON.parse(body);
        const baseTemplate = normalizeTemplateToClassic(readSafe(TEMPLATE_PATH));
        const template = applyTemplateVariant(baseTemplate, variantId);
        fs.writeFileSync(TEMPLATE_PATH, template, 'utf-8');
        json(res, { ok: true, active: parseTemplateVariantMeta(template) });
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
        if (!isValidAppStatus(status)) { json(res, { error: 'Invalid status' }, 400); return; }
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
        if (!isValidAppStatus(status)) { json(res, { error: 'Invalid status' }, 400); return; }
        const filepath = path.join(DATA_DIR, 'applications.md');
        let content = readSafe(filepath);
        // Match the row starting with | {num} | and update the Status column (col 6)
        const lines = content.split('\n');
        let updated = false;
        const newLines = lines.map(line => {
          // Only touch data rows (not header/separator)
          if (!line.startsWith('|') || line.match(/^\|[-\s|]+\|$/)) return line;
          const cells = splitMarkdownRow(line);
          if (cells[0]?.trim() === String(num)) {
            cells[5] = status;
            updated = true;
            return buildMarkdownRow(cells);
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
        if (!isValidAppStatus(status)) { json(res, { error: 'Invalid status' }, 400); return; }
        const filepath = path.join(DATA_DIR, 'applications.md');
        let content = readSafe(filepath);
        const lines = content.split('\n');

        // Try to find existing row by company+title match
        let updated = false;
        const dataLines = lines.map(line => {
          if (!line.startsWith('|') || line.match(/^\|[-\s|]+\|$/)) return line;
          const cells = splitMarkdownRow(line);
          const rowCompany = decodeCell(cells[2] || '').trim().toLowerCase();
          const rowRole    = decodeCell(cells[3] || '').trim().toLowerCase();
          if (rowCompany === (company||'').toLowerCase() && rowRole === (title||'').toLowerCase()) {
            cells[5] = status;
            updated = true;
            return buildMarkdownRow(cells);
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
          .map(l => parseInt(splitMarkdownRow(l)[0]?.trim()) || 0);
        const nextNum = (Math.max(0, ...nums) + 1).toString().padStart(3, '0');
        const today = new Date().toISOString().slice(0, 10);
        const note = jobUrl ? `via Jobs tab` : 'via Jobs tab';
        const newRow = buildMarkdownRow([
          nextNum,
          today,
          encodeCell(company || '—'),
          encodeCell(title || '—'),
          'N/A',
          status,
          '❌',
          '—',
          encodeCell(note),
        ]);

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
      req.on('close', () => {
        stopChildProcess(proc);
        try { fs.unlinkSync(tmpFile); } catch {}
      });
    });
    return;
  }

  if (route === 'match/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const send = (type, data) => {
      if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    if (activeMatchProc) {
      send('err', { text: 'Matcher is already running. Stop it before starting another run.' });
      send('done', { code: 1 });
      res.end();
      return;
    }

    const limit = parseInt(url.searchParams.get('limit') || process.env.WEB_MATCH_LIMIT || '0', 10);
    const runAll = url.searchParams.get('all') === 'true';
    const matchArgs = ['web-match.mjs'];
    if (runAll) matchArgs.push('--all');
    else matchArgs.push('--today');
    if (Number.isFinite(limit) && limit > 0) matchArgs.push('--limit', String(limit));

    const proc = spawn('node', matchArgs, { cwd: ROOT });
    activeMatchProc = proc;
    let finished = false;

    const finish = (code) => {
      if (finished) return;
      finished = true;
      if (activeMatchProc === proc) activeMatchProc = null;
      send('done', { code });
      res.end();
    };

    proc.stdout.on('data', chunk => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) send('line', { text: line });
      }
    });
    proc.stderr.on('data', chunk => send('err', { text: chunk.toString() }));
    proc.on('close', code => finish(code));
    req.on('close', () => {
      if (!finished) stopChildProcess(proc);
    });
    return;
  }

  if (route === 'match/stop' && req.method === 'POST') {
    if (!activeMatchProc) {
      json(res, { ok: true, stopped: false });
      return;
    }
    stopChildProcess(activeMatchProc);
    json(res, { ok: true, stopped: true });
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

  if (route === 'jobs/resume' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch {}

      const job = buildJobRecords().find(record =>
        (payload.url && record.url === payload.url) ||
        (normalizeKey(record.company) === normalizeKey(payload.company) &&
          normalizeKey(record.title) === normalizeKey(payload.title))
      ) || payload;

      const timestamp = Date.now();
      const profile = parseProfileYaml(readSafe(PROFILE_PATH));
      const candidateSlug = slugify(profile?.candidate?.full_name || 'candidate');
      const jobSlug = slugify(`${job.company || 'company'}-${job.title || 'role'}`).slice(0, 90);
      const tempHtmlPath = path.join(OUTPUT_DIR, `cv-${candidateSlug}-${jobSlug}-${timestamp}.html`);
      const outputFile = `cv-${candidateSlug}-${jobSlug}-${new Date().toISOString().slice(0, 10)}-${timestamp}.pdf`;
      const outputPath = path.join(OUTPUT_DIR, outputFile);
      const templateHtml = readSafe(TEMPLATE_PATH);
      const cvMarkdown = readSafe(CV_PATH);

      try {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        const html = buildCvHtml({ profile, cvMarkdown, templateHtml });
        fs.writeFileSync(tempHtmlPath, html, 'utf-8');
      } catch (error) {
        json(res, { ok: false, output: error.message }, 500);
        return;
      }

      const proc = spawn('node', ['generate-pdf.mjs', tempHtmlPath, outputPath, '--format=letter'], { cwd: ROOT });
      let out = '';
      proc.stdout.on('data', d => out += d);
      proc.stderr.on('data', d => out += d);
      proc.on('close', code => {
        try { fs.unlinkSync(tempHtmlPath); } catch {}
        json(res, {
          ok: code === 0,
          output: out,
          path: outputPath,
          url: `/output/${encodeURIComponent(outputFile)}`,
          filename: outputFile,
          job: { company: job.company || '', title: job.title || '', url: job.url || '' },
        }, code === 0 ? 200 : 500);
      });
    });
    return;
  }

  if (route === 'pdf' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { reportPath } = JSON.parse(body || '{}');
      const timestamp = Date.now();
      const profile = parseProfileYaml(readSafe(PROFILE_PATH));
      const candidateSlug = slugify(profile?.candidate?.full_name || 'candidate');
      const tempHtmlPath = path.join(ROOT, 'output', `cv-preview-${timestamp}.html`);
      const outputPath = path.join(ROOT, 'output', `cv-${candidateSlug}-preview-${timestamp}.pdf`);
      const templateHtml = readSafe(TEMPLATE_PATH);
      const cvMarkdown = readSafe(CV_PATH);

      try {
        const html = buildCvHtml({ profile, cvMarkdown, templateHtml });
        fs.writeFileSync(tempHtmlPath, html, 'utf-8');
      } catch (error) {
        json(res, { ok: false, output: error.message });
        return;
      }

      const args = ['generate-pdf.mjs', tempHtmlPath, outputPath, '--format=letter'];
      const proc = spawn('node', args, { cwd: ROOT });
      let out = '';
      proc.stdout.on('data', d => out += d);
      proc.stderr.on('data', d => out += d);
      proc.on('close', code => {
        try { fs.unlinkSync(tempHtmlPath); } catch {}
        json(res, { ok: code === 0, output: out, path: outputPath });
      });
    });
    return;
  }

  json(res, { error: 'Not found' }, 404);
}

function serveStatic(res, pathname) {
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  if (pathname.startsWith('/fonts/')) {
    const filepath = path.resolve(FONTS_DIR, pathname.slice('/fonts/'.length));
    if (!filepath.startsWith(FONTS_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
    try {
      const stat = fs.statSync(filepath);
      if (!stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
      const ct = MIME[path.extname(filepath)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct });
      createReadStream(filepath).pipe(res);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  if (pathname.startsWith('/output/')) {
    const filepath = path.resolve(OUTPUT_DIR, decodeURIComponent(pathname.slice('/output/'.length)));
    if (!filepath.startsWith(OUTPUT_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
    try {
      const stat = fs.statSync(filepath);
      if (!stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
      const ct = MIME[path.extname(filepath)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct });
      createReadStream(filepath).pipe(res);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

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
