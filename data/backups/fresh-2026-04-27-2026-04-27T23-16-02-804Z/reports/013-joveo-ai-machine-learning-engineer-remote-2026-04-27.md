# 013 — Joveo AI | Machine Learning Engineer (Remote)

**Date:** 2026-04-27
**Score:** 2.5/5
**URL:** https://www.linkedin.com/jobs/view/machine-learning-engineer-remote-at-joveo-ai-4407105710
**Legitimacy:** Proceed with Caution — posting marked "No longer accepting applications"
**PDF:** ❌ (pending)

---

## A. Role Summary

Joveo AI (posted via "Hire Feed" — likely staffing intermediary) seeks ML Engineer to own full ML lifecycle: feature engineering, training, deployment, monitoring, and infrastructure (feature stores, model registries, serving layers). Domain: recruitment advertising / real-time bidding. Remote, US.

---

## B. CV Match

| Dimension | Posting Requires | Selin Has | Gap |
|-----------|-----------------|-----------|-----|
| Python | Strong | ✅ Strong | None |
| ML frameworks | PyTorch, TensorFlow, or XGBoost | ⚠️ Not listed — projects use logistic reg, RF, boosting but no framework named | Likely scikit-learn; no deep learning framework |
| End-to-end ML pipelines | Data ingestion → model serving | ⚠️ Has ETL pipelines; no model serving | Missing deployment half |
| ML platforms | SageMaker, Vertex AI, MLflow, Kubeflow | ❌ Has Databricks/Azure; none of the listed platforms | Hard gap |
| Feature stores, model versioning, experiment tracking | Required | ❌ Not evidenced | Hard gap |
| Supervised / unsupervised / RL fundamentals | Required | ✅ Supervised ML strong; RL not evidenced | Partial |
| Production-grade software engineering | Required | ✅ KeelWorks backend, Spring Boot, tested APIs | Strong |
| Seniority | "Not Applicable" (but JD reads mid-level) | Entry/junior | Likely stretch |

**Keyword overlap is real** — Python, ML modeling, pipelines — but the role wants MLOps depth (feature stores, serving layers, registries) that her CV does not demonstrate.

---

## C. Hard Blockers

1. **Posting closed** — LinkedIn shows "No longer accepting applications." Do not apply unless posting reopens.
2. **Missing ML deployment stack** — No PyTorch, TensorFlow, MLflow, SageMaker, Vertex AI, or Kubeflow in CV. Role requires proficiency in at least one ML platform.
3. **No model serving / production ML deployment experience** — All ML work is academic/project-based (train + evaluate). Role explicitly requires productionization and serving infrastructure.
4. **Feature store / model registry gap** — Required; not evidenced anywhere in CV.

---

## D. Recommendation

**Do not apply.** Posting is closed (primary blocker). Even if reopened, this is a 2.5/5 fit — Selin's ML work is statistical modeling for inference, not production MLOps. The gap between "trained a random forest on 569 samples" and "deploy models at production scale with feature stores and serving layers" is significant for an entry-level candidate. This role would suit someone 1–2 years post-graduation with MLflow/SageMaker hands-on time.

**Watch for:** If Joveo re-posts a Data Scientist role (not ML Engineer), fit improves materially — her statistical modeling and ETL skills align better there.

---

## E. Resume Targeting Notes

If this role type (ML Engineer, production focus) becomes a target, Selin should build toward:
- Add a project using MLflow for experiment tracking (easy win — run existing projects through MLflow)
- Deploy one model as a REST API (FastAPI + Docker) — bridges her backend engineering strength to ML serving
- Practice with SageMaker or Vertex AI free tier for training/deployment
- Label existing boosting models as "XGBoost" if that's what was used (many R/scikit pipelines use it)

For current CV against any ML Engineer role: foreground the **end-to-end framing** — ETL (Spencer's) + modeling (projects) + API deployment (KeelWorks) = closest-to-full-stack ML story she currently has.

---

## F. Interview Prep Notes

*Not recommended for this role.* If pursuing similar ML Engineer roles after closing the gaps:

- **Feature engineering Q:** Lean on Spencer's metadata tagging pipeline as proxy for feature pipeline design
- **Model deployment Q:** Honest gap — frame it as "designed for inference, actively building serving layer experience via [project]"
- **Scale Q:** Highlight 100,000+ movie records ETL; Databricks/Spark context shows familiarity with scale tooling
- **System design:** KeelWorks REST API experience is directly applicable to model serving API design

---

## G. Posting Legitimacy Notes

**Posted by "Hire Feed"** — this is a staffing/recruiting intermediary, not Joveo directly. The job poster (Shubham Singh Chandel) has a broad title ("Chief Strategic Initiatives & Global Supply Officer") inconsistent with a typical hiring manager for an ML role. This pattern (staffing firm posting on behalf of tech company) is common but warrants verification: confirm the role exists on Joveo's own careers page before investing time. Posting is already marked closed, making this moot for now.

**Tier:** Do Not Apply — posting closed + intermediary posting with no direct Joveo confirmation.
