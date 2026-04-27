export function parseResumeSections(markdown) {
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

  return sections;
}

export function buildResumeContext(markdown, { maxChars = 8000 } = {}) {
  const raw = String(markdown || '').trim();
  if (!raw) return '';

  const name = raw.match(/^#\s+(.+)/m)?.[1]?.trim() || '';
  const sections = parseResumeSections(raw);
  const aliases = {
    summary: ['summary', 'professional summary', 'profile', 'intro'],
    education: ['education'],
    experience: ['work experience', 'experience', 'employment'],
    projects: ['projects', 'selected projects'],
    skills: ['skills', 'technical skills'],
    certifications: ['certifications', 'certifications & awards', 'licenses & certifications'],
  };

  const pick = (keys) => {
    for (const key of keys) {
      if (sections[key]?.some(line => line.trim())) return sections[key];
    }
    return [];
  };

  const cleanLines = (lines, limit = 40) => lines
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, limit)
    .join('\n');

  const blocks = [
    '# Resume Context',
    name ? `Candidate: ${name}` : '',
    '',
    '## Summary',
    cleanLines(pick(aliases.summary), 8),
    '',
    '## Education',
    cleanLines(pick(aliases.education), 18),
    '',
    '## Experience',
    cleanLines(pick(aliases.experience), 32),
    '',
    '## Projects',
    cleanLines(pick(aliases.projects), 36),
    '',
    '## Skills',
    cleanLines(pick(aliases.skills), 18),
    '',
    '## Certifications & Awards',
    cleanLines(pick(aliases.certifications), 16),
  ].filter(block => block !== '').join('\n');

  if (blocks.length <= maxChars) return blocks;
  return `${blocks.slice(0, maxChars)}\n[resume context truncated]`;
}
