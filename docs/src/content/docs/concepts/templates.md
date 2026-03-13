---
title: Templates
description: Pre-built workflow patterns for common tasks
---

**Templates** are pre-built workflow patterns. Instead of the AI planner designing every workflow from scratch, templates provide proven DAG structures for common tasks.

## How They Work

1. Pick a template (e.g., `research_swarm`)
2. Provide a goal
3. The template generates a complete DAG with steps, dependencies, and requirements

```typescript
const chain = await client.summon({
  goal: 'Research CRISPR delivery mechanisms',
  roomId: 'bio-lab',
  template: 'research_swarm',
});
```

That single call generates a DAG like:

```
scope_research
├── investigate_domain_1  ─┐
├── investigate_domain_2  ─┤  parallel
├── investigate_domain_3  ─┘
└── synthesize_findings
    └── final_review
```

## Available Templates

### Software

| Template | What it does |
|----------|-------------|
| `software_feature` | Design → Implement → Review → Test → Deploy |
| `bug_fix` | Investigate → Reproduce → Fix → Verify → Deploy |

### Research

| Template | What it does |
|----------|-------------|
| `research_swarm` | Parallel research across sub-domains with synthesis |
| `literature_review` | Search → Screen → Extract → Synthesize |
| `literature_review_continuous` | Ongoing monitoring with dual review |
| `hypothesis_swarm` | Generate, attack, and validate competing hypotheses |
| `research_monitor` | Watch for new papers and evidence |

### Medical

| Template | What it does |
|----------|-------------|
| `second_opinion` | Medical case review with expert validation |
| `rare_disease_diagnosis` | Multi-specialist parallel diagnosis |
| `clinical_trial_monitor` | Multi-site trial surveillance + DSMB review |
| `drug_interaction_analysis` | PK/PD analysis with interaction matrix |
| `epidemiological_investigation` | Outbreak investigation pipeline |

### Other

| Template | What it does |
|----------|-------------|
| `strategic_analysis` | Market → Competition → Strategy → Plan |
| `content_creation` | Outline → Draft → Review → Edit → Publish |
| `simple_task` | Execute → Review → Finalize |
| `parallel_execution` | Split → Execute in parallel → Merge |

## Listing Templates

```typescript
// All templates
const all = client.listTemplates();

// Filter by category
const medical = client.listTemplates('medical');

// Search by keyword
import { searchTemplates } from 'society-protocol';
const results = searchTemplates('pharmacology');
```

## What's Next?

- [Chain of Collaboration](/concepts/chain-of-collaboration/) — How DAGs execute
- [Templates Reference](/api-reference/templates-reference/) — Full specification of every template
