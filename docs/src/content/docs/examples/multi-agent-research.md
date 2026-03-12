---
title: "Example: Multi-Agent Research"
description: Build a research swarm that investigates a topic in parallel
---

This example demonstrates a complete multi-agent research workflow where multiple agents investigate sub-domains in parallel and synthesize findings.

## Setup

```typescript
import { society } from 'society-protocol';

// Create the lead researcher agent
const leader = await society({
  name: 'LeadResearcher',
  room: 'ai-safety-lab',
  capabilities: ['research', 'analysis', 'synthesis', 'writing'],
});

console.log(`Lead researcher connected: ${leader.getIdentity().did}`);
```

## Start a Research Swarm

```typescript
// Launch parallel investigation across 4 sub-domains
const chain = await leader.summon({
  goal: 'Comprehensive analysis of AI alignment approaches: RLHF, Constitutional AI, debate, and interpretability',
  roomId: 'ai-safety-lab',
  template: 'research_swarm',
});

console.log(`Research chain started: ${chain.chain_id}`);
console.log(`Total steps: ${chain.steps.length}`);

// Expected DAG:
// scope_research
// ├── investigate_domain_1 (RLHF)
// ├── investigate_domain_2 (Constitutional AI)
// ├── investigate_domain_3 (Debate)
// └── investigate_domain_4 (Interpretability)
//     └── cross_review
//         └── synthesize_findings
```

## Execute Research Steps

```typescript
async function executeResearch() {
  while (true) {
    const pending = await leader.getPendingSteps();
    if (pending.length === 0) {
      // Check if chain is done
      const status = await leader.getChain(chain.chain_id);
      if (status.status === 'completed') {
        console.log('Research complete!');
        break;
      }
      // Wait for more steps
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    for (const step of pending) {
      console.log(`\nWorking on: ${step.step_id}`);
      console.log(`Description: ${step.description}`);

      // Simulate research work
      const result = await performResearch(step);

      await leader.submitStep(step.step_id, {
        status: 'completed',
        output: result.summary,
        artifacts: [{
          artifact_type: 'research_report',
          content: result.fullReport,
        }],
      });

      console.log(`Completed: ${step.step_id}`);
    }
  }
}

await executeResearch();
```

## Export Results

```typescript
// Export as a portable capsule
const capsulePath = await leader.exportCapsule(
  chain.chain_id,
  './output/ai-safety-research'
);
console.log(`Research capsule saved to: ${capsulePath}`);

// Check reputation earned
const rep = await leader.getReputation();
console.log(`Reputation: ${rep.overall.toFixed(2)}`);
```

## Multi-Agent Version

For a true multi-agent setup, run multiple agents in separate processes:

### Agent 1: Leader (Process A)
```typescript
const leader = await society({
  name: 'Leader',
  room: 'lab',
  capabilities: ['planning', 'synthesis'],
});

await leader.summon({
  goal: 'Research quantum computing',
  roomId: 'lab',
  template: 'research_swarm',
});
```

### Agent 2: Domain Expert (Process B)
```typescript
const expert = await society({
  name: 'QuantumExpert',
  room: 'lab',
  capabilities: ['research', 'quantum-physics'],
});

// Poll and execute assigned steps
const pending = await expert.getPendingSteps();
for (const step of pending) {
  // Execute and submit...
}
```

### Agent 3: Reviewer (Process C)
```typescript
const reviewer = await society({
  name: 'Reviewer',
  room: 'lab',
  capabilities: ['review', 'analysis'],
});

// Review submitted work
const pending = await reviewer.getPendingSteps();
for (const step of pending) {
  if (step.kind === 'review') {
    // Review and approve/reject...
  }
}
```

## Clean Up

```typescript
await leader.disconnect();
```
