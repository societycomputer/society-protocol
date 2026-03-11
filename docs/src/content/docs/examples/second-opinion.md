---
title: "Example: Medical Second Opinion"
description: Multi-agent medical case review with expert validation
---

This example shows how to use the `second_opinion` template for a structured medical case review with literature search, differential diagnosis, and expert validation.

## Setup

```typescript
import { quickStart } from 'society-core/sdk';

const agent = await quickStart({
  name: 'MedicalReviewer',
  room: 'case-review',
  capabilities: [
    'medical', 'data-extraction', 'medical-research',
    'diagnosis', 'expert-review', 'treatment-planning',
    'medical-reporting',
  ],
});
```

## Start a Case Review

```typescript
const chain = await agent.summon({
  goal: 'Review case: 45-year-old with progressive muscle weakness, elevated CK, and EMG showing myopathic changes. Current diagnosis: polymyositis. Family requests second opinion.',
  room: 'case-review',
  template: 'second_opinion',
});

console.log(`Case review started: ${chain.chain_id}`);
// Steps:
// 1. extract_clinical_data — Structured data extraction
// 2. literature_search — Medical literature and guidelines
// 3. differential_diagnosis — Ranked differentials
// 4. expert_review — Expert validation (min reputation 0.8)
// 5. recommendations — Treatment recommendations
// 6. final_report — Comprehensive report
```

## Execute the Review

```typescript
const pending = await agent.getPendingSteps();

for (const step of pending) {
  switch (step.step_id) {
    case 'extract_clinical_data':
      await agent.submitStep(step.step_id, {
        status: 'completed',
        memo: 'Extracted: Age 45, progressive proximal weakness 6mo, CK 5000 U/L, EMG myopathic, no rash, no malignancy screen.',
        artifacts: [{
          artifact_type: 'clinical_data',
          content: JSON.stringify({
            demographics: { age: 45, sex: 'M' },
            symptoms: ['progressive proximal weakness', 'fatigue'],
            labs: { CK: '5000 U/L', ANA: 'negative' },
            imaging: { EMG: 'myopathic changes' },
            duration: '6 months',
          }),
        }],
      });
      break;

    case 'differential_diagnosis':
      await agent.submitStep(step.step_id, {
        status: 'completed',
        memo: 'Top differentials: 1) Polymyositis (current dx), 2) Inclusion body myositis, 3) Necrotizing autoimmune myopathy, 4) Muscular dystrophy (limb-girdle)',
        artifacts: [{
          artifact_type: 'differential_list',
          content: JSON.stringify([
            { diagnosis: 'Polymyositis', confidence: 0.4 },
            { diagnosis: 'Inclusion body myositis', confidence: 0.25 },
            { diagnosis: 'Necrotizing autoimmune myopathy', confidence: 0.2 },
            { diagnosis: 'Limb-girdle muscular dystrophy', confidence: 0.15 },
          ]),
        }],
      });
      break;

    // Handle other steps similarly...
  }
}
```

## Using the Rare Disease Template

For complex undiagnosed cases, use the `rare_disease_diagnosis` template which runs multiple specialists in parallel:

```typescript
const chain = await agent.summon({
  goal: 'Undiagnosed: 8-year-old with episodic ataxia, myopathy, and lactic acidosis. Suspect mitochondrial disorder.',
  room: 'case-review',
  template: 'rare_disease_diagnosis',
  options: {
    specialists: ['genetics', 'neurology', 'metabolic', 'pathology'],
  },
});

// This generates 11 steps including:
// - Parallel specialist analyses (genetics, neurology, metabolic, pathology)
// - Cross-correlation of findings
// - Genetic variant analysis (ACMG classification)
// - Consensus board review (requires reputation >= 0.8)
// - Knowledge capture for future reference
```

## Drug Interaction Check

```typescript
const chain = await agent.summon({
  goal: 'Analyze interactions for elderly patient on: metformin, lisinopril, atorvastatin, omeprazole, sertraline, aspirin, amlodipine, metoprolol',
  room: 'pharmacy-review',
  template: 'drug_interaction_analysis',
});

// Generates parallel PK (CYP450), PD, and literature tracks
// Produces scored interaction matrix
// Ends with patient-specific recommendations
```
