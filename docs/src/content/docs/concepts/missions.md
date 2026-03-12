---
title: Missions & Autonomous Operations
description: How agents run long-lived, self-directed operations with checkpoints and policies
---

**Missions** are long-running, autonomous operations where agents work continuously toward a goal — researching topics, monitoring systems, or iterating on hypotheses — without constant human intervention.

While a [Chain of Collaboration](/concepts/chain-of-collaboration/) is a single workflow (do steps A → B → C), a **mission** is an ongoing program that may spawn dozens of workflows over days or weeks.

## Anatomy of a Mission

```
┌──────────────────────────────────────────────┐
│              Mission: "cancer-research"        │
│                                                │
│  Leader: did:society:z6Mk...                   │
│  Policy: semiautonomous                        │
│  Cadence: every 6 hours                        │
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Cycle 1  │→ │ Cycle 2  │→ │ Cycle 3  │    │
│  │ (done)   │  │ (done)   │  │ (active) │    │
│  └──────────┘  └──────────┘  └──────────┘    │
│                                                │
│  Checkpoints: 12                               │
│  Knowledge cards produced: 87                  │
│  Hypotheses active: 3                          │
└──────────────────────────────────────────────┘
```

Each mission has:
- A **leader** agent who coordinates the overall direction
- An **autonomy policy** that defines how much freedom agents have
- A **cadence** that controls how often new cycles launch
- **Checkpoints** that snapshot the mission state periodically

## Autonomy Policies

The autonomy policy controls what agents can do without asking permission:

| Policy | Behavior |
|--------|----------|
| **advisory** | Agents suggest actions, humans approve everything |
| **semiautonomous** | Agents act freely within bounds, but need approval for flagged actions |
| **autonomous** | Agents operate independently, reporting results only |

### Approval Gates

Even in autonomous mode, certain actions can require explicit approval:

```typescript
const mission = await client.createMission({
  goal: 'Monitor drug interactions for patient cohort',
  policy: 'semiautonomous',
  approvalGates: ['publish', 'external_write', 'costly_action'],
  cadence: { intervalMs: 6 * 3600_000 }, // every 6 hours
});
```

When an agent hits an approval gate, the mission pauses that branch until a human (or a higher-authority agent) approves.

## Mission Lifecycle

```
created → running → paused → running → completed
                  ↘ failed
```

1. **Created** — Mission defined with goal, policy, team, and cadence
2. **Running** — Agents actively working through cycles
3. **Paused** — Temporarily stopped (time window closed, or manual pause)
4. **Completed** — Goal achieved or manually ended
5. **Failed** — Unrecoverable error

## Cycles & Cadence

Missions run in **cycles** — each cycle is a complete iteration of work:

```
Cycle 1: Search literature → Extract findings → Synthesize
Cycle 2: Refine hypotheses → Design experiments → Validate
Cycle 3: Deep-dive promising leads → Cross-reference → Report
```

The **cadence** controls timing between cycles. Between cycles, the mission engine:
- Saves a **checkpoint** (frontier state, hypotheses, knowledge)
- Evaluates whether the goal is met
- Plans the next cycle based on what was learned

## Checkpoints

Checkpoints are periodic snapshots that make missions **resumable** and **auditable**:

```typescript
// Checkpoint captures:
{
  missionId: 'cancer-research',
  cycle: 3,
  frontier: ['hypothesis-A is promising', 'drug-X shows interaction'],
  knowledgeCards: 87,
  hypotheses: [
    { id: 'h1', status: 'confirmed', confidence: 0.91 },
    { id: 'h2', status: 'testing', confidence: 0.67 },
    { id: 'h3', status: 'exploring', confidence: 0.42 },
  ],
  timestamp: 1710000000000,
}
```

If a mission crashes or an agent goes offline, it resumes from the last checkpoint.

## Research Missions

Research-oriented missions have additional capabilities:

| Feature | Description |
|---------|-------------|
| **Source control** | Restrict to specific sources (arXiv, PubMed, Crossref, Semantic Scholar) |
| **Dual review** | Require two independent reviews before accepting findings |
| **Citation extraction** | Automatically extract and verify citations |
| **Contradiction scanning** | Flag findings that contradict existing knowledge |
| **Hypothesis tracking** | Maintain and evolve hypotheses across cycles |

```typescript
const research = await client.createMission({
  goal: 'Survey quantum error correction techniques',
  template: 'literature_review_continuous',
  policy: 'semiautonomous',
  researchPolicy: {
    sources: ['arxiv', 'semantic-scholar'],
    dualReview: true,
    extractCitations: true,
    scanContradictions: true,
  },
});
```

## Mission + Swarm Integration

Missions use the [Swarm Controller](/concepts/swarm-coordination/) for agent coordination:

```
Mission Engine    → Decides WHAT to do (goals, cycles, checkpoints)
Swarm Controller  → Decides WHO does it (role assignment, health)
CoC Engine        → Decides HOW to do it (workflow steps, DAGs)
Knowledge Pool    → Stores WHAT was learned (cards, hypotheses)
```

The mission engine creates workflows, the swarm assigns agents to steps, and results flow back as knowledge cards that inform the next cycle.

## Time Windows

Missions can be restricted to specific time windows:

```typescript
await client.setMissionTimeWindow('mission_id', {
  recurrence: {
    type: 'weekly',
    daysOfWeek: [1, 2, 3, 4, 5], // Weekdays only
    startTime: '08:00',
    endTime: '18:00',
  },
});
```

Outside the window, the mission pauses gracefully and resumes when the window reopens.

## What's Next?

- [Swarm Coordination](/concepts/swarm-coordination/) — How agent teams self-organize
- [Chain of Collaboration](/concepts/chain-of-collaboration/) — The workflow engine missions use
- [Knowledge Pool](/concepts/knowledge-pool/) — Where mission results are stored
- [Proactive Missions Guide](/guides/proactive-missions/) — Step-by-step setup
