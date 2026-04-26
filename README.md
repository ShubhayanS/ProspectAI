# Career-Ops

[English](README.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [Русский](README.ru.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md)

<p align="center">
  <img src="docs/hero-banner.jpg" alt="Career-Ops — Multi-Agent Job Search System" width="800">
</p>

<p align="center">
  <em>I spent months applying to jobs the hard way. So I engineered the system I wish I had.</em><br>
  Companies use AI to filter candidates. <strong>I just gave candidates AI to <em>choose</em> companies.</strong><br>
  <em>Now it's open source.</em>
</p>

> **This is an enhanced fork of [career-ops](https://github.com/santifer/career-ops) by [Santiago Fernández](https://santifer.io).**
> New in this version: English mode translations, `--since` / `--verbose` scan flags, and a web dashboard. Original system, design, and architecture by Santiago.

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Gemini_CLI-4285F4?style=flat&logo=google&logoColor=white" alt="Gemini CLI">
  <img src="https://img.shields.io/badge/Codex_(soon)-6B7280?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
  <a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord"></a>
  <br>
  <img src="https://img.shields.io/badge/EN-blue?style=flat" alt="EN">
  <img src="https://img.shields.io/badge/ES-red?style=flat" alt="ES">
  <img src="https://img.shields.io/badge/DE-grey?style=flat" alt="DE">
  <img src="https://img.shields.io/badge/FR-blue?style=flat" alt="FR">
  <img src="https://img.shields.io/badge/PT--BR-green?style=flat" alt="PT-BR">
  <img src="https://img.shields.io/badge/KO-white?style=flat" alt="KO">
  <img src="https://img.shields.io/badge/JA-red?style=flat" alt="JA">
  <img src="https://img.shields.io/badge/ZH--CN-red?style=flat" alt="ZH-CN">
  <img src="https://img.shields.io/badge/ZH--TW-blue?style=flat" alt="ZH-TW">
</p>

---

<p align="center">
  <img src="docs/demo.gif" alt="Career-Ops Demo" width="800">
</p>

<p align="center"><strong>740+ job listings evaluated · 100+ personalized CVs · 1 dream role landed</strong></p>

<p align="center"><a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Join_the_community-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a></p>

## What Is This

Career-Ops turns any AI coding CLI into a full job search command center. Instead of manually tracking applications in a spreadsheet, you get an AI-powered pipeline that:

- **Evaluates offers** with a structured A-F scoring system (10 weighted dimensions)
- **Generates tailored PDFs** -- ATS-optimized CVs customized per job description
- **Scans portals** automatically (Greenhouse, Ashby, Lever, company pages)
- **Processes in batch** -- evaluate 10+ offers in parallel with sub-agents
- **Tracks everything** in a single source of truth with integrity checks

> **Important: This is NOT a spray-and-pray tool.** Career-ops is a filter -- it helps you find the few offers worth your time out of hundreds. The system strongly recommends against applying to anything scoring below 4.0/5. Your time is valuable, and so is the recruiter's. Always review before submitting.

Career-ops is agentic: Claude Code navigates career pages with Playwright, evaluates fit by reasoning about your CV vs the job description (not keyword matching), and adapts your resume per listing.

> **Heads up: the first evaluations won't be great.** The system doesn't know you yet. Feed it context -- your CV, your career story, your proof points, your preferences, what you're good at, what you want to avoid. The more you nurture it, the better it gets. Think of it as onboarding a new recruiter: the first week they need to learn about you, then they become invaluable.

Originally built by [Santiago Fernández](https://santifer.io) to evaluate 740+ job offers and land a Head of Applied AI role. This fork adds English modes, time-filtered scanning, and a web dashboard. [Read the original case study](https://santifer.io/career-ops-system).

## Features

| Feature | Description |
|---------|-------------|
| **Auto-Pipeline** | Paste a URL, get a full evaluation + PDF + tracker entry |
| **6-Block Evaluation** | Role summary, CV match, level strategy, comp research, personalization, interview prep (STAR+R) |
| **Interview Story Bank** | Accumulates STAR+Reflection stories across evaluations -- 5-10 master stories that answer any behavioral question |
| **Negotiation Scripts** | Salary negotiation frameworks, geographic discount pushback, competing offer leverage |
| **ATS PDF Generation** | Keyword-injected CVs with Space Grotesk + DM Sans design |
| **Portal Scanner** | 45+ companies pre-configured (Anthropic, OpenAI, ElevenLabs, Retool, n8n...) + custom queries across Ashby, Greenhouse, Lever, Wellfound |
| **LinkedIn Scraper** | Scrapes LinkedIn job search via guest API — no login, no API key. Configurable queries in `portals.yml` under `linkedin_queries` |
| **Time-filtered Scanning** | `--since 24h`, `--since 7d`, or `--since YYYY-MM-DD` — only surface jobs posted within your window (maps to LinkedIn's native time filter) |
| **Location Filtering** | Configurable geo-filter in `portals.yml` — USA-only by default, drops non-US listings automatically |
| **Verbose Scan Mode** | `--verbose` shows per-company breakdown: jobs found, new added, portal type, errors |
| **Batch Processing** | Parallel evaluation with `claude -p` workers |
| **Dashboard TUI** | Terminal UI to browse, filter, and sort your pipeline |
| **Human-in-the-Loop** | AI evaluates and recommends, you decide and act. The system never submits an application -- you always have the final call |
| **Pipeline Integrity** | Automated merge, dedup, status normalization, health checks |

## Quick Start

> **Prerequisite:** You need [Claude Code](https://claude.ai/code) (or Gemini CLI / OpenCode — see below). Claude Code is free to install; you pay per token like any other Claude API usage.

### Step 1 — Install

```bash
git clone https://github.com/ShubhayanS/career-ops.git
cd career-ops
npm install
npx playwright install chromium   # Needed for PDF generation and web scraping
```

### Step 2 — Open with Claude Code

```bash
claude   # Opens Claude Code in the career-ops directory
```

That's it. Claude will detect you're running for the first time and walk you through onboarding automatically.

### Step 3 — Onboarding (Claude guides you)

When you open Claude Code, it will ask you for:

1. **Your CV** — paste it, give your LinkedIn URL, or describe your experience. Claude converts it to markdown.
2. **Your target roles** — e.g. "Senior Data Scientist", "ML Engineer", "AI Product Manager"
3. **Your location and salary range**

Claude creates all the config files for you. No manual YAML editing required.

### Step 4 — Start evaluating

Once onboarding is done, just paste any job URL or description:

```
/career-ops https://jobs.ashbyhq.com/anthropic/some-role
```

Or scan for new jobs matching your profile:

```
/career-ops scan
```

> **The system adapts to you, not the other way around.** If archetypes don't match your career, scoring feels off, or you want to add companies — just tell Claude. It reads and edits its own files. Say "add these 10 companies to my portals" and it's done.

See [docs/SETUP.md](docs/SETUP.md) for the full setup guide and advanced config.

## Which AI CLI Should I Use?

Career-ops works with three AI coding CLIs. Pick one:

| CLI | Cost | Best for |
|-----|------|----------|
| **[Claude Code](https://claude.ai/code)** | Pay per token (Anthropic) | Best evaluation quality, recommended |
| **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** | Free tier available | Budget-conscious users |
| **[OpenCode](https://opencode.ai)** | Pay per token (Anthropic or OpenAI) | Alternative UI |

### Using Gemini CLI

```bash
# Install
npm install -g @google/gemini-cli

# Authenticate (free — uses your Google account)
gemini auth

# Run in the career-ops directory
cd career-ops && gemini

# Then use the same commands:
/career-ops-evaluate "Senior AI Engineer at Anthropic..."
/career-ops-scan
/career-ops-pdf
/career-ops-tracker
```

All 15 commands work identically in all three CLIs. The `GEMINI.md` file is auto-loaded; commands are in `.gemini/commands/`.

> **Free tier:** Gemini CLI uses `gemini-2.0-flash` (15 RPM, 1M tokens/day free). No billing required.

## Usage

Career-ops is a single slash command with multiple modes:

```
/career-ops                → Show all available commands
/career-ops {paste a JD}   → Full auto-pipeline (evaluate + PDF + tracker)
/career-ops scan           → Scan portals for new offers
/career-ops pdf            → Generate ATS-optimized CV
/career-ops batch          → Batch evaluate multiple offers
/career-ops tracker        → View application status
/career-ops apply          → Fill application forms with AI
/career-ops pipeline       → Process pending URLs
/career-ops outreach       → LinkedIn outreach message
/career-ops deep           → Deep company research
/career-ops training       → Evaluate a course/cert
/career-ops project        → Evaluate a portfolio project
```

Or just paste a job URL or description directly -- career-ops auto-detects it and runs the full pipeline.

## How It Works

```
You paste a job URL or description
        │
        ▼
┌──────────────────┐
│  Archetype       │  Classifies: LLMOps / Agentic / PM / SA / FDE / Transformation
│  Detection       │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  A-F Evaluation  │  Match, gaps, comp research, STAR stories
│  (reads cv.md)   │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Report  PDF  Tracker
  .md   .pdf   .tsv
```

## Pre-configured Portals

The scanner comes with **45+ companies** ready to scan and **19 search queries** across major job boards. Copy `templates/portals.example.yml` to `portals.yml` and add your own:

**AI Labs:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**Voice AI:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram, Vapi, Bland AI
**AI Platforms:** Retool, Airtable, Vercel, Temporal, Glean, Arize AI
**Contact Center:** Ada, LivePerson, Sierra, Decagon, Talkdesk, Genesys
**Enterprise:** Salesforce, Twilio, Gong, Dialpad
**LLMOps:** Langfuse, Weights & Biases, Lindy, Cognigy, Speechmatics
**Automation:** n8n, Zapier, Make.com
**European:** Factorial, Attio, Tinybird, Clarity AI, Travelperk

**Job boards searched:** Ashby, Greenhouse, Lever, Wellfound, Workable, RemoteFront

### Scanner flags

```bash
node scan.mjs                        # scan all enabled companies
node scan.mjs --since 24h            # only jobs posted in the last 24 hours
node scan.mjs --since 7d             # only jobs posted in the last 7 days
node scan.mjs --since 2026-04-20     # only jobs posted since a specific date
node scan.mjs --verbose              # show per-company breakdown
node scan.mjs --dry-run              # preview without writing files
node scan.mjs --company Anthropic    # scan a single company
```

The scanner hits Greenhouse, Ashby, and Lever APIs directly — **zero Claude API tokens**. LinkedIn is scraped via the public guest API (no login needed). Location filtering (USA by default) and title filtering happen client-side. Timestamps come from each portal's native field (`updated_at` for Greenhouse, `publishedAt` for Ashby, `createdAt` for Lever, `datetime` attribute for LinkedIn). The `--since` flag maps automatically to LinkedIn's `f_TPR` parameter.

## Web Dashboard

Browser UI with Apple-inspired design — light/dark mode, live scanner, report reader, CV editor:

```bash
npm run web
# → http://localhost:3737
```

| Tab | What you get |
|-----|-------------|
| **Dashboard** | Stats cards, score distribution, recent evaluations, pipeline preview |
| **Jobs** | All scanned jobs with search + status filters |
| **Pipeline** | Pending URLs with one-click copy of Claude eval commands |
| **Applications** | Full tracker, status filter, click any row to read the report |
| **Reports** | Card grid — click to read rendered markdown |
| **Scanner** | Configure and run `scan.mjs` with live terminal output |
| **My CV** | Side-by-side markdown editor + live preview + PDF generation |

Zero extra dependencies — pure Node.js built-in `http`.

## Dashboard TUI

Terminal alternative (Go + Bubble Tea) for no-browser use:

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard --path ..
```

Features: 6 filter tabs, 4 sort modes, grouped/flat view, lazy-loaded previews, inline status changes.

## Project Structure

```
career-ops/
├── CLAUDE.md                    # Agent instructions
├── cv.md                        # Your CV (create this)
├── article-digest.md            # Your proof points (optional)
├── config/
│   └── profile.example.yml      # Template for your profile
├── modes/                       # 14 skill modes
│   ├── _shared.md               # Shared context (customize this)
│   ├── evaluate.md              # Single job evaluation (A-G scoring)
│   ├── pdf.md                   # PDF generation
│   ├── scan.md                  # Portal scanner
│   ├── batch.md                 # Batch processing
│   └── ...
├── templates/
│   ├── cv-template.html         # ATS-optimized CV template
│   ├── portals.example.yml      # Scanner config template
│   └── states.yml               # Canonical statuses
├── batch/
│   ├── batch-prompt.md          # Self-contained worker prompt
│   └── batch-runner.sh          # Orchestrator script
├── dashboard/                   # Go TUI pipeline viewer
├── data/                        # Your tracking data (gitignored)
├── reports/                     # Evaluation reports (gitignored)
├── output/                      # Generated PDFs (gitignored)
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # Setup, customization, architecture
└── examples/                    # Sample CV, report, proof points
```

## Tech Stack

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **Agent**: Claude Code with custom skills and modes
- **PDF**: Playwright/Puppeteer + HTML template
- **Scanner**: Playwright + Greenhouse API + WebSearch
- **Dashboard**: Go + Bubble Tea + Lipgloss (Catppuccin Mocha theme)
- **Data**: Markdown tables + YAML config + TSV batch files

## Also Open Source

- **[cv-santiago](https://github.com/santifer/cv-santiago)** -- The portfolio website (santifer.io) with AI chatbot, LLMOps dashboard, and case studies. If you need a portfolio to showcase alongside your job search, fork it and make it yours.

## About

This fork is maintained by **[Shubhayan Saha](https://www.linkedin.com/in/shubhayans/)** — Data Scientist / Data Engineer, M.S. Data Science from George Washington University. I forked career-ops to add English-first modes, time-filtered scanning, and a web dashboard while using it in my own job search.

Original system by [Santiago Fernández](https://santifer.io) → [santifer/career-ops](https://github.com/santifer/career-ops)

## Star History

<a href="https://www.star-history.com/?repos=ShubhayanS%2Fcareer-ops&type=timeline&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=ShubhayanS/career-ops&type=timeline&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=ShubhayanS/career-ops&type=timeline&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=ShubhayanS/career-ops&type=timeline&legend=top-left" />
 </picture>
</a>

## Disclaimer

**career-ops is a local, open-source tool — NOT a hosted service.** By using this software, you acknowledge:

1. **You control your data.** Your CV, contact info, and personal data stay on your machine and are sent directly to the AI provider you choose (Anthropic, OpenAI, etc.). We do not collect, store, or have access to any of your data.
2. **You control the AI.** The default prompts instruct the AI not to auto-submit applications, but AI models can behave unpredictably. If you modify the prompts or use different models, you do so at your own risk. **Always review AI-generated content for accuracy before submitting.**
3. **You comply with third-party ToS.** You must use this tool in accordance with the Terms of Service of the career portals you interact with (Greenhouse, Lever, Workday, LinkedIn, etc.). Do not use this tool to spam employers or overwhelm ATS systems.
4. **No guarantees.** Evaluations are recommendations, not truth. AI models may hallucinate skills or experience. The authors are not liable for employment outcomes, rejected applications, account restrictions, or any other consequences.

See [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md) for full details. This software is provided under the [MIT License](LICENSE) "as is", without warranty of any kind.

## Contributors

<a href="https://github.com/ShubhayanS/career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ShubhayanS/career-ops" />
</a>

Got hired using career-ops? [Share your story!](https://github.com/ShubhayanS/career-ops/issues/new?template=i-got-hired.yml)

## License

MIT

## Let's Connect

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/shubhayans/)
[![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/ShubhayanS)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://twitter.com/Shubhayan9)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:sahainus@gmail.com)
