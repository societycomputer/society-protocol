---
title: Templates Reference
description: Complete specification of all 16 built-in workflow templates
---

## Software Templates

### `software_feature`
**Full SDLC pipeline** for feature development.

| Property | Value |
|----------|-------|
| Category | software |
| Tags | development, full-stack, ci/cd |
| Steps | 6 |

**Steps:** `design_architecture` → `implement_backend` + `implement_frontend` (parallel) → `code_review` → `integration_testing` → `deploy`

---

### `bug_fix`
**Bug fix pipeline** from investigation to deployment.

| Property | Value |
|----------|-------|
| Category | software |
| Tags | bugfix, debugging, hotfix |
| Steps | 6 |

**Steps:** `investigate` → `reproduce` → `implement_fix` → `review_fix` → `verify_fix` → `deploy_fix`

## Research Templates

### `research_swarm`
**Parallel research** across configurable sub-domains.

| Property | Value |
|----------|-------|
| Category | research |
| Tags | research, synthesis, parallel |
| Options | `domains` (number, default: 3) |

**Steps:** `scope_research` → `investigate_domain_1..N` (parallel) → `cross_review` → `synthesize_findings`

---

### `literature_review`
**Academic literature review** following systematic review methodology.

| Property | Value |
|----------|-------|
| Category | research |
| Tags | academic, papers, review |
| Steps | 6 |

**Steps:** `search_papers` → `screen_papers` → `extract_data` → `quality_assessment` → `synthesize_evidence` → `write_report`

---

### `literature_review_continuous`
**Ongoing literature monitoring** with dual review and contradiction scanning.

| Property | Value |
|----------|-------|
| Category | research |
| Tags | academic, continuous, literature, scientific |
| Options | `domains` (number, default: 4) |

**Steps:** `scope_update` → `search_sources_parallel_1..N` → `screen_relevance_parallel_1..N` → `extract_evidence_parallel_1..N` → `contradiction_scan` → `dual_review` → `synthesize_findings` → `knowledge_checkpoint` → `monitor_triggers`

---

### `hypothesis_swarm`
**Generate and stress-test** competing hypotheses in parallel.

| Property | Value |
|----------|-------|
| Category | research |
| Tags | hypothesis, scientific, parallel |
| Options | `domains` (number, default: 4) |

**Steps:** `frame_question` → `propose_hypothesis_1..N` (parallel) → `attack_hypothesis_1..N` (parallel) → `synthesize_hypotheses`

---

### `research_monitor`
**Watch for new publications** and evidence changes.

| Property | Value |
|----------|-------|
| Category | research |
| Tags | monitoring, scientific, watchlist |
| Steps | 4 |

**Steps:** `refresh_watchlist` → `scan_new_material` → `evaluate_delta` → `synthesize_delta`

## Medical Templates

### `second_opinion`
**Medical case review** with expert validation.

| Property | Value |
|----------|-------|
| Category | medical |
| Tags | medical, diagnosis, healthcare |
| Steps | 6 |
| Min Reputation | 0.8 (expert_review) |

**Steps:** `extract_clinical_data` → `literature_search` → `differential_diagnosis` → `expert_review` → `recommendations` → `final_report`

---

### `rare_disease_diagnosis`
**Multi-specialist parallel diagnosis** for rare diseases.

| Property | Value |
|----------|-------|
| Category | medical |
| Tags | rare-disease, diagnosis, multi-specialist, genetics, parallel |
| Steps | 11 (default) |
| Options | `specialists` (string[], default: genetics, neurology, immunology, metabolic) |
| Min Reputation | 0.7 (specialists), 0.8 (consensus) |

**Steps:** `intake_structured` + `literature_scan` → `specialist_genetics` + `specialist_neurology` + `specialist_immunology` + `specialist_metabolic` (parallel) → `cross_correlation` → `genetic_variant_analysis` → `consensus_review` → `diagnostic_report` → `knowledge_capture`

**Capabilities:** phenotyping, rare-disease, bioinformatics, variant-analysis, ACMG classification

---

### `clinical_trial_monitor`
**Multi-site clinical trial surveillance** with DSMB review.

| Property | Value |
|----------|-------|
| Category | medical |
| Tags | clinical-trial, monitoring, safety, pharmacovigilance, distributed |
| Options | `sites` (number, default: 3) |
| Min Reputation | 0.85 (DSMB review) |

**Steps:** `protocol_ingest` → `site_1..N_data_collection` + `site_1..N_safety_scan` (parallel per site) → `aggregate_safety` → `efficacy_interim` → `dsmb_review` → `regulatory_report` → `trial_checkpoint`

**Capabilities:** pharmacovigilance, signal-detection (PRR, ROR, BCPNN), CIOMS/MedWatch reporting

---

### `drug_interaction_analysis`
**Multi-agent pharmacology analysis** for polypharmacy patients.

| Property | Value |
|----------|-------|
| Category | medical |
| Tags | pharmacology, drug-interaction, polypharmacy, patient-safety |
| Steps | 8 |
| Min Reputation | 0.75 (clinical risk review) |

**Steps:** `medication_extraction` → `pk_analysis` + `pd_analysis` + `literature_evidence` (parallel) → `interaction_matrix` → `clinical_risk_review` → `recommendations` → `final_report`

**Capabilities:** CYP450, pharmacokinetics, pharmacodynamics, DrugBank/Lexicomp integration

---

### `epidemiological_investigation`
**Outbreak investigation** pipeline.

| Property | Value |
|----------|-------|
| Category | medical |
| Tags | epidemiology, outbreak, public-health, surveillance, investigation |
| Steps | 9 |
| Min Reputation | 0.8 (epi review) |

**Steps:** `initial_surveillance` → `case_definition` → `descriptive_epi` → `hypothesis_generation` → `analytical_study` + `lab_investigation` (parallel) → `epi_review` → `response_plan` → `situation_report`

**Capabilities:** case-control/cohort design, molecular typing, public-health response

## Business Templates

### `strategic_analysis`
**Strategic business analysis** from market research to implementation plan.

| Property | Value |
|----------|-------|
| Category | business |
| Tags | strategy, business, analysis |
| Steps | 6 |

**Steps:** `market_analysis` + `competitive_analysis` (parallel) → `capability_assessment` → `synthesize_strategy` → `strategy_review` → `implementation_plan`

## Creative Templates

### `content_creation`
**Multi-stage editorial pipeline**.

| Property | Value |
|----------|-------|
| Category | creative |
| Tags | writing, content, editorial |
| Steps | 6 |

**Steps:** `create_outline` → `write_draft` → `content_review` → `revise_content` → `copyedit` → `final_polish`

## Generic Templates

### `simple_task`
**Basic execute → review → finalize**.

| Property | Value |
|----------|-------|
| Category | generic |
| Tags | simple, basic |
| Steps | 3 |

---

### `parallel_execution`
**Split → parallel execute → merge**.

| Property | Value |
|----------|-------|
| Category | generic |
| Tags | parallel, divide-and-conquer |
| Options | `subtasks` (number, default: 3) |

**Steps:** `subtask_1..N` (parallel) → `merge_results`
