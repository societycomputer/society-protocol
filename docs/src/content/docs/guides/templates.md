---
title: Using Templates
description: How to use and customize workflow templates
---

Templates provide proven workflow patterns that generate DAGs automatically. This guide covers how to use, customize, and choose the right template.

## Using a Template

### Via SDK

```typescript
const chain = await client.summon({
  goal: 'Review literature on mRNA vaccine delivery',
  room: 'bio-lab',
  template: 'literature_review',
});
```

### Via CLI

```bash
# In the interactive REPL
/template literature_review "Review literature on mRNA vaccine delivery"
```

### Via MCP

Use the `society_summon` tool with the `template` parameter.

## Choosing a Template

### For Software Development
- **`software_feature`** — Full feature development with parallel frontend/backend tracks
- **`bug_fix`** — Root cause analysis → fix → verify pipeline

### For Research
- **`research_swarm`** — Best for broad topic investigation with parallel sub-domains
- **`literature_review`** — Academic-style systematic review
- **`literature_review_continuous`** — Ongoing monitoring of a research area
- **`hypothesis_swarm`** — When you need to compare competing theories
- **`research_monitor`** — Watching for new publications and evidence

### For Medical/Scientific
- **`second_opinion`** — Clinical case review with expert validation
- **`rare_disease_diagnosis`** — When multiple specialists need to weigh in
- **`clinical_trial_monitor`** — Multi-site trial safety surveillance
- **`drug_interaction_analysis`** — Polypharmacy analysis for patient safety
- **`epidemiological_investigation`** — Outbreak investigation

### For Business
- **`strategic_analysis`** — Market, competition, and strategy planning

### For Content
- **`content_creation`** — Multi-stage editorial pipeline

### For Simple Tasks
- **`simple_task`** — Quick execute → review → finalize
- **`parallel_execution`** — Split work into N parallel tracks

## Customizing Templates

### Configurable Options

```typescript
// Research swarm with 5 parallel domains
await client.summon({
  goal: 'Comprehensive AI safety review',
  template: 'research_swarm',
  options: { domains: 5 },
});

// Rare disease diagnosis with custom specialists
await client.summon({
  goal: 'Undiagnosed cardiac phenotype',
  template: 'rare_disease_diagnosis',
  options: {
    specialists: ['cardiology', 'genetics', 'pathology', 'radiology'],
  },
});

// Clinical trial with 8 sites
await client.summon({
  goal: 'Phase III oncology trial monitoring',
  template: 'clinical_trial_monitor',
  options: { sites: 8 },
});
```

## Template DAG Patterns

### Sequential Pipeline
```
step_1 → step_2 → step_3 → step_4
```
Used by: `simple_task`, `bug_fix`

### Fan-Out / Fan-In
```
        ┌─ domain_1 ─┐
scope ──┼─ domain_2 ─┼── synthesize
        └─ domain_3 ─┘
```
Used by: `research_swarm`, `hypothesis_swarm`, `parallel_execution`

### Multi-Track with Cross-Review
```
protocol ──┬─ site_1_data ─┬─ site_1_safety ─┬─ aggregate ─ dsmb ─ report
           ├─ site_2_data ─┤─ site_2_safety ─┤
           └─ site_3_data ─┘─ site_3_safety ─┘
```
Used by: `clinical_trial_monitor`

### Specialist Parallel
```
intake ─┬─ specialist_A ─┬─ cross_correlate ─ consensus ─ report
lit_scan┼─ specialist_B ─┤
        ├─ specialist_C ─┤
        └─ specialist_D ─┘
```
Used by: `rare_disease_diagnosis`

## Listing and Searching

```typescript
import { listTemplates, searchTemplates, getTemplate } from 'society-protocol';

// List by category
const medical = listTemplates('medical');

// Search by keyword
const results = searchTemplates('pharmacology');

// Get specific template
const template = getTemplate('rare_disease_diagnosis');
console.log(template.name);        // "Rare Disease Multi-Specialist Diagnosis"
console.log(template.tags);        // ["rare-disease", "diagnosis", ...]
console.log(template.description); // Full description
```
