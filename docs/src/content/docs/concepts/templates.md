---
title: Templates
description: Pre-built workflow templates for common collaboration patterns
---

Templates are pre-built workflow patterns that generate DAGs for common tasks. Instead of relying on the AI planner to design every workflow from scratch, templates provide proven structures with parallel execution, specialist routing, and configurable options.

## How Templates Work

1. Choose a template by ID (e.g., `research_swarm`)
2. Provide a goal description
3. Optionally configure template-specific options
4. The template generates a complete DAG of steps

```typescript
const chain = await client.summon({
  goal: 'Research CRISPR delivery mechanisms',
  room: 'bio-lab',
  template: 'research_swarm',
  options: { domains: 4 },  // 4 parallel research tracks
});
```

## Template Categories

### Software (2 templates)
- `software_feature` — Full SDLC: Design → Implement → Review → Test → Deploy
- `bug_fix` — Investigate → Reproduce → Fix → Verify → Deploy

### Research (5 templates)
- `research_swarm` — Parallel research across sub-domains with synthesis
- `literature_review` — Academic search → screen → extract → synthesize
- `literature_review_continuous` — Ongoing literature monitoring with dual review
- `hypothesis_swarm` — Generate, attack, and validate competing hypotheses
- `research_monitor` — Watch for new papers and evidence deltas

### Medical (5 templates)
- `second_opinion` — Medical case review with expert validation
- `rare_disease_diagnosis` — Multi-specialist parallel diagnosis
- `clinical_trial_monitor` — Multi-site trial surveillance and DSMB review
- `drug_interaction_analysis` — PK/PD analysis with interaction matrix
- `epidemiological_investigation` — Outbreak investigation pipeline

### Business (1 template)
- `strategic_analysis` — Market → Competition → Strategy → Plan

### Creative (1 template)
- `content_creation` — Outline → Draft → Review → Edit → Publish

### Generic (2 templates)
- `simple_task` — Execute → Review → Finalize
- `parallel_execution` — Split → Execute in parallel → Merge

## Configurable Options

Some templates accept options to customize the generated DAG:

| Template | Option | Default | Description |
|----------|--------|---------|-------------|
| `research_swarm` | `domains` | 3 | Number of parallel research tracks |
| `literature_review_continuous` | `domains` | 4 | Number of parallel search domains |
| `hypothesis_swarm` | `domains` | 4 | Number of competing hypotheses |
| `parallel_execution` | `subtasks` | 3 | Number of parallel tasks |
| `rare_disease_diagnosis` | `specialists` | 4 default specialties | Custom specialist list |
| `clinical_trial_monitor` | `sites` | 3 | Number of trial sites |

## Listing Templates

```typescript
// List all templates
const all = client.listTemplates();

// Filter by category
const medical = client.listTemplates('medical');

// Search by keyword
import { searchTemplates } from 'society-core';
const results = searchTemplates('pharmacology');
```

See the [Templates Reference](/api-reference/templates-reference/) for the complete specification of every template.
