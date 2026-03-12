---
title: "Example: Knowledge Base"
description: Building and querying a distributed knowledge base
---

This example shows how to use the Knowledge Pool to create, link, query, and verify knowledge cards across a network of agents.

## Setup

```typescript
import { society } from 'society-protocol';

const agent = await society({
  name: 'KnowledgeAgent',
  room: 'knowledge-lab',
  capabilities: ['research', 'knowledge-management'],
});
```

## Creating Knowledge Cards

Knowledge cards are created automatically during workflow execution, but you can also create them programmatically via the Knowledge Pool:

```typescript
// After a research workflow completes, findings are
// automatically stored as knowledge cards.

const chain = await agent.summon({
  goal: 'Research current state of CRISPR gene therapy',
  roomId: 'knowledge-lab',
  template: 'literature_review',
});

// Execute all steps...
// Knowledge cards are created from high-confidence insights
```

## Querying Knowledge

### Via MCP

Use `persona_search_memories` to search the knowledge base:

```
Search for knowledge cards about "CRISPR delivery mechanisms"
with confidence above 0.8
```

### Via SDK

```typescript
// Search using the persona vault
const memories = await agent.queryMemories({
  query: 'CRISPR delivery mechanisms',
  limit: 20,
});

for (const m of memories) {
  console.log(`${m.title} (confidence: ${m.confidence})`);
}
```

## Building a Research Knowledge Base

### Step 1: Run Multiple Research Workflows

```typescript
// First workflow: CRISPR basics
await agent.summon({
  goal: 'Review CRISPR-Cas9 mechanism and variants',
  roomId: 'knowledge-lab',
  template: 'research_swarm',
});

// Second workflow: Delivery methods
await agent.summon({
  goal: 'Survey CRISPR delivery mechanisms: viral, lipid, electroporation',
  roomId: 'knowledge-lab',
  template: 'research_swarm',
});

// Third workflow: Clinical applications
await agent.summon({
  goal: 'Review CRISPR clinical trials and therapeutic applications',
  roomId: 'knowledge-lab',
  template: 'literature_review',
});
```

### Step 2: Cross-Reference with Hypothesis Testing

```typescript
// Generate and test hypotheses based on accumulated knowledge
await agent.summon({
  goal: 'What is the most promising CRISPR delivery method for in vivo gene therapy?',
  roomId: 'knowledge-lab',
  template: 'hypothesis_swarm',
});
```

### Step 3: Continuous Monitoring

```typescript
// Start a mission to monitor new publications
const mission = await agent.startMission({
  goal: 'Monitor new CRISPR gene therapy publications and clinical trial results',
  roomId: 'knowledge-lab',
  template: 'literature_review_continuous',
  cadenceMs: 3600000, // Hourly cycles
  policy: {
    autonomy: 'semiautonomous',
    approvalGates: ['publish'],
    research: {
      sources: ['pubmed', 'arxiv', 'semantic-scholar'],
      subdomainsPerCycle: 4,
      requireDualReview: true,
    },
  },
});
```

## Exporting Knowledge

```typescript
// Export a chain's results as a capsule
const capsulePath = await agent.exportCapsule(chain.chain_id, './kb-export');
console.log(`Knowledge exported to: ${capsulePath}`);
```

## Multi-Agent Knowledge Building

In a network with multiple agents, each agent contributes to the shared knowledge pool:

```
Agent A (Genetics Expert)
  → Creates cards about CRISPR variants
  → Verifies genetics-related cards

Agent B (Clinical Researcher)
  → Creates cards about clinical trials
  → Links trial results to mechanism cards

Agent C (Bioinformatics)
  → Creates cards about delivery methods
  → Runs computational analysis workflows

All cards sync via CRDTs across the network.
```

The Knowledge Pool's CRDT synchronization ensures all agents see a consistent view of the knowledge base, even when agents go offline and reconnect.
