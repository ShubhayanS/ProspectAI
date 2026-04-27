# 031 — Jobright.ai | Machine Learning Engineer - Early Career

**Date:** 2026-04-27
**Score:** 2.0/5
**URL:** https://www.linkedin.com/jobs/view/machine-learning-engineer-early-career-at-jobright-ai-4405931476
**Legitimacy:** Proceed with Caution — posting marked closed; verify before any action
**PDF:** ❌ (pending)

---

## A. Role Summary

LLM infrastructure engineer role at an AI job-search startup. Core work: deploy and serve production AI agents, optimize LLM pipelines (latency/throughput), implement RAG architectures, build backend APIs bridging models to product. Framed as "Early Career" (0–2 yrs). US only, full-time.

## B. CV Match

| Dimension | Required | Selin Has | Match |
|-----------|----------|-----------|-------|
| Seniority | 0–2 yrs, recent grad | May 2026 MS | ✅ |
| Location/Auth | US, authorized | Philadelphia, authorized | ✅ |
| Python | Strong proficiency | Python in CV + projects | ✅ |
| Python web frameworks | FastAPI/Flask/Django | Spring Boot (Java) only | ❌ |
| ML frameworks | PyTorch or TensorFlow | Classical stats ML (R/scikit-style) | ❌ |
| LLM deployment | Required | Not present | ❌ |
| RAG architecture | Required | Not present | ❌ |
| CI/CD, version control | Required | Git ✅, CI/CD not explicit | ⚠️ |
| Cloud infra | Preferred (AWS/GCP/Azure) | AWS mentioned | ⚠️ |
| Docker/Kubernetes | Preferred | Not mentioned | ❌ |
| Vector databases | Preferred | Not mentioned | ❌ |
| SQL/NoSQL | Preferred | SQL + MongoDB | ✅ |

**Keyword overlap is misleading here.** Title says "ML Engineer" but role is LLMOps/AI infrastructure. Selin's ML work (logistic regression, random forest, clinical datasets) is classical statistical ML — orthogonal to what this role actually builds.

## C. Hard Blockers

1. **Posting closed** — LinkedIn shows "No longer accepting applications." Primary blocker; skip unless posting reopens.
2. **No PyTorch/TensorFlow** — required; Selin's ML projects use classical methods (logistic regression, decision trees, random forest) not deep learning frameworks.
3. **No LLM/GenAI experience** — role centers on LLM pipeline optimization and autonomous agents; not in CV or projects.
4. **No RAG/vector DB knowledge** — explicit requirement; zero evidence in CV.
5. **Python backend frameworks absent** — FastAPI/Flask/Django required; Selin's backend experience is Java/Spring Boot.

## D. Recommendation

**Do not apply.** Posting is closed and the tech stack gap is substantial. This is an LLM infrastructure role dressed as "ML Engineer" — Selin's classical ML + data engineering background doesn't map. Even if the posting reopened, the missing PyTorch/TF + LLM deployment experience makes this a weak-fit application at best.

**If pursuing LLM-adjacent roles is a goal**, targeted upskilling (HuggingFace Transformers, FastAPI, basic RAG with LangChain) over 4–6 weeks would open this archetype meaningfully.

## E. Resume Targeting Notes

If this role or similar reopens and Selin wants to apply:

- Add any Python API work (even course/project level) using FastAPI or Flask
- Surface AWS experience more explicitly (currently buried in skills list)
- If she has touched any LLM API (OpenAI, Anthropic, HuggingFace) even in coursework, add a project
- Databricks/Spark work from Spencer's is relevant for "data ingestion and processing layers" — foreground it
- MongoDB from KeelWorks covers NoSQL requirement — already present

## F. Interview Prep Notes

*(Low priority given blockers — for reference only)*

- LLM pipeline questions: latency/throughput tradeoffs, batching strategies, quantization basics
- RAG: chunk strategies, embedding models, retrieval evaluation (precision@k)
- Infra: Docker basics, load balancing, async task queues
- Her clinical ML projects show rigor but interviewers here will ask about production agent systems — needs different story

## G. Posting Legitimacy Notes

- Company is real: Jobright.ai is a funded AI job-search product
- LinkedIn posting marked "No longer accepting applications" — confirmed closed
- Role description is specific and technically coherent — not a ghost job pattern
- **Verdict:** Legitimate company, legitimate role — but posting is expired. Do not apply without re-verification.
