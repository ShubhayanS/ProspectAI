#!/usr/bin/env node
/**
 * web-eval.mjs — Web UI trigger for career-ops job evaluation
 * Reads mode files + cv.md, sends to `claude --print` (same as terminal /career-ops)
 * Usage: node web-eval.mjs /path/to/jd.txt
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));

function readSafe(p) {
  try { return readFileSync(p, 'utf-8'); } catch { return ''; }
}

const jdFile = process.argv[2];
if (!jdFile) {
  console.error('Usage: node web-eval.mjs /path/to/jd.txt');
  process.exit(1);
}

const jd = readSafe(jdFile).trim();
if (!jd) {
  console.error('JD file empty or not found: ' + jdFile);
  process.exit(1);
}

const shared   = readSafe(join(ROOT, 'modes', '_shared.md'));
const evaluate = readSafe(join(ROOT, 'modes', 'evaluate.md'));
const profile  = readSafe(join(ROOT, 'modes', '_profile.md'));
const cv       = readSafe(join(ROOT, 'cv.md'));

const prompt = [
  shared,
  profile,
  evaluate,
  '---',
  '## My CV',
  cv,
  '---',
  '## Job Description to Evaluate',
  jd,
].filter(Boolean).join('\n\n');

const proc = spawn('claude', ['--print'], {
  cwd: ROOT,
  stdio: ['pipe', 'inherit', 'inherit'],
});

proc.stdin.write(prompt);
proc.stdin.end();
proc.on('close', code => process.exit(code ?? 0));
proc.on('error', err => {
  console.error('Failed to spawn claude:', err.message);
  process.exit(1);
});
