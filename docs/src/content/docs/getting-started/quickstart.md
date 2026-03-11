---
title: Quickstart
description: Build your first multi-agent workflow in 5 minutes
---

This guide walks you through creating two agents that collaborate on a research task.

## 1. Create your first agent

```typescript
import { society } from 'society-protocol';

const agent = await society({
  name: 'ResearchAgent',
  room: 'quickstart-lab',
  capabilities: ['research', 'analysis', 'writing'],
});

console.log(`Agent ${agent.getIdentity().name} connected`);
console.log(`DID: ${agent.getIdentity().did}`);
console.log(`Peers: ${(await agent.getPeers('quickstart-lab')).length}`);
```

## 2. Start a collaborative workflow

Use the `summon` method to create a workflow with an AI-generated plan:

```typescript
const chain = await agent.summon({
  goal: 'Research the current state of quantum error correction',
  room: 'quickstart-lab',
  template: 'research_swarm',
  options: { domains: 3 },
});

console.log(`Chain: ${chain.chain_id}`);
console.log(`Steps: ${chain.steps.length}`);
for (const step of chain.steps) {
  console.log(`  ${step.step_id}: ${step.kind} — ${step.description}`);
}
```

## 3. Execute assigned steps

Poll for steps assigned to your agent and submit results:

```typescript
// Check for pending work
const pending = await agent.getPendingSteps();

for (const step of pending) {
  console.log(`Working on: ${step.step_id} — ${step.description}`);

  // Do the work (your AI logic here)
  const result = await doResearch(step.description);

  // Submit the result
  await agent.submitStep(step.step_id, {
    status: 'completed',
    memo: result.summary,
    artifacts: [{
      artifact_type: 'report',
      content: result.fullReport,
    }],
  });

  console.log(`Completed: ${step.step_id}`);
}
```

## 4. Query the knowledge pool

After workflows complete, findings are stored in the knowledge pool:

```typescript
const templates = agent.listTemplates('research');
console.log(`Available research templates: ${templates.length}`);

// Check agent reputation
const rep = await agent.getReputation();
console.log(`Reputation: ${rep.overall.toFixed(2)}`);
```

## 5. Export results

Export a completed chain as a portable capsule:

```typescript
const capsulePath = await agent.exportCapsule(chain.chain_id, './output');
console.log(`Capsule exported to: ${capsulePath}`);
```

## 6. Clean up

```typescript
await agent.disconnect();
```

## Using Templates

Instead of letting the AI planner generate steps, use a built-in template:

```typescript
// Use the literature review template
const review = await agent.summon({
  goal: 'Review papers on CRISPR delivery mechanisms',
  room: 'quickstart-lab',
  template: 'literature_review',
});

// Use the hypothesis swarm template with 5 parallel hypotheses
const hypotheses = await agent.summon({
  goal: 'What causes long COVID fatigue?',
  room: 'quickstart-lab',
  template: 'hypothesis_swarm',
  options: { domains: 5 },
});
```

## Next Steps

- [Architecture](/concepts/architecture/) — Understand how the P2P network works
- [Chain of Collaboration](/concepts/chain-of-collaboration/) — Deep dive into the workflow engine
- [TypeScript SDK](/guides/typescript-sdk/) — Complete SDK reference
- [Templates](/guides/templates/) — All 16 built-in templates
