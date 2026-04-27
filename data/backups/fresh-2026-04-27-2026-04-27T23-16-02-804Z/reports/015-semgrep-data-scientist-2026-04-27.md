# 015 — Semgrep | Data Scientist

**Date:** 2026-04-27
**Score:** 2.0/5
**URL:** https://www.linkedin.com/jobs/view/data-scientist-at-semgrep-4375460220
**Legitimacy:** Proceed with Caution — matcher report, verify posting before applying
**PDF:** ❌ (pending)

---

## A. Role Summary

Early DS hire at Semgrep (AppSec startup, SF). Broad scope: product analytics, business strategy, production pipelines, and security research direction. Hybrid — 3 days/week mandatory in SF office. Comp: $128K–$161K. LinkedIn tags "Entry level" but JD requires 2+ years data/strategy experience and asks candidate to "define how an entire company uses data" — scope is closer to mid-level. Stack: S3, FiveTran, DBT, Snowflake, Metabase, Retool, Sagemaker, Python.

---

## B. CV Match

| Dimension | JD Requires | Selin Has | Gap |
|-----------|-------------|-----------|-----|
| Experience | 2+ yrs data/strategy | ~4 mo data internship (Spencer's) | Significant |
| ML/Stats | Regression, active learning, heuristics | Logistic regression, RF, boosting, ROC/AUC | Good match |
| Pipelines | S3→Snowflake, FiveTran, DBT | Databricks, medallion architecture, ETL | Partial (different stack) |
| Visualization | Board-level to IC | Power BI experience noted | Partial |
| Startup breadth | Product + biz + security insights | Internship + academic projects | Gap |
| Security domain | AppSec context helpful | None | Missing |
| Python | Required | Strong | Match |
| DBT | Required | Not listed (has Databricks) | Gap |
| Snowflake | Required | Not listed (has Azure Databricks) | Gap |

Keyword overlap is real (ML models, pipelines, Python, medallion architecture) but the stack specifics and experience depth don't align.

---

## C. Hard Blockers

1. **Location:** Role is hybrid 3 days/week in San Francisco. Selin is Philadelphia-based. Requires relocation — scores 1.0 on location dimension per profile rules.
2. **Experience gap:** JD says 2+ years data/strategy. Spencer's internship is ~4 months. KeelWorks is backend dev, not data. Does not clear the bar.
3. **Stack mismatch:** Snowflake, FiveTran, Metabase, Retool, Sagemaker — none listed in CV. Databricks experience is adjacent but not equivalent.
4. **Role scope:** "Define how an entire company uses data" + Board-level metrics + recruiting responsibilities = mid-level expectations despite "entry level" tag.

---

## D. Recommendation

**Do not apply.** Two independent blockers each warrant a skip:

- The SF hybrid requirement alone makes this a relocation ask, conflicting with Selin's stated preference hierarchy.
- The 2+ years data experience requirement isn't credibly met with one 4-month internship, regardless of project quality.

Even if Selin were open to SF relocation, the role's strategic breadth (shaping company-wide data culture, Board-level decks, recruiting) is beyond what a May 2026 new grad can credibly own from day one. Over 200 applicants already — competition will include candidates who check all boxes.

---

## E. Resume Targeting Notes

Not applicable — not recommended for application. If pursuing anyway:

- Lead with medallion architecture + ETL pipeline (Spencer's) — maps to their data lakehouse work
- Frame DBT gap as "Databricks experience with equivalent medallion/STAR schema patterns"
- Highlight Snowflake-adjacent SQL and data modeling from Databricks tables
- Clinical ML projects demonstrate statistical rigor + iterative experimentation mindset
- Do **not** lean into healthcare domain — Semgrep is AppSec, pivot framing to "high-stakes data, messy real-world datasets, rigorous validation"

---

## F. Interview Prep Notes

Not applicable at this time. If invited despite low fit:

- Research Semgrep's open-source tool (semgrep.dev) before any screen — domain knowledge gap is real
- Prepare "north star metric" thinking story — they explicitly call out this skill
- Active learning is mentioned: be ready to discuss how you'd approach labeling strategy under budget constraints
- Their example projects (S3→Snowflake pipelines, Snowflake Silver/Gold tables) map to Spencer's medallion work — bridge that explicitly

---

## G. Posting Legitimacy Notes

Posting appeared 1 day ago on LinkedIn with 200+ applicants. Semgrep is a funded, legitimate company (Sequoia, Menlo, Lightspeed). Company website is semgrep.dev. Job details are specific and internally consistent (named tools, example projects, comp range disclosed). **No red flags.** Posting is almost certainly real. Verify liveness before applying via Playwright on the actual URL — LinkedIn counts may lag actual posting status.
