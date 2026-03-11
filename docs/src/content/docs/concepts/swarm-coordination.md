---
title: Swarm Coordination
description: Event-driven swarm coordination with time-range scheduling
---

Society Protocol includes an advanced **Swarm Controller** for coordinating agent swarms in real-time. Inspired by research from DRAMA, SwarmSys, TDAG, and SECP, it provides event-driven coordination, time-window scheduling, and pheromone-inspired task-agent matching.

## Research Foundations

| Paper | Key Contribution | How Society Uses It |
|-------|------------------|---------------------|
| [DRAMA](https://arxiv.org/abs/2508.04332) | Monitor agent + event-driven reallocation | Health monitoring, heartbeat, state-change triggers |
| [SwarmSys](https://arxiv.org/abs/2510.10047) | Explorer/Worker/Validator roles + pheromone matching | Role assignment, affinity-based selection |
| [TDAG](https://arxiv.org/abs/2402.10178) | Dynamic task decomposition + skill library | CoC DAG expansion, capability tracking |
| [SECP](https://arxiv.org/abs/2602.02170) | Self-evolving coordination with formal invariants | Bounded consensus, protocol safety |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                Swarm Controller                   │
├────────────┬──────────────┬─────────────────────┤
│  Monitor   │    Roles     │    Time Windows      │
│  (DRAMA)   │  (SwarmSys)  │    Scheduling        │
│            │              │                       │
│ • Heartbeat│ • Explorer   │ • Daily/Weekly/       │
│ • Health   │ • Worker     │   Interval            │
│ • Events   │ • Validator  │ • Start/End times     │
│ • Realloc  │ • Rebalance  │ • Recurrence          │
├────────────┴──────────────┴─────────────────────┤
│              Affinity Engine (Pheromone)          │
│  • Task-agent compatibility scores               │
│  • Epsilon-greedy exploration/exploitation        │
│  • Success streak tracking                        │
└─────────────────────────────────────────────────┘
```

## Roles

The swarm uses three roles from SwarmSys:

| Role | Responsibility | Auto-assigned when |
|------|---------------|--------------------|
| **Explorer** | Decompose problems, monitor workload, discover subtasks | Agent has `synthesis` kind or `planning` specialty |
| **Worker** | Execute assigned tasks | Default role for task-capable agents |
| **Validator** | Verify solutions, check quality | Agent has `review` or `verification` kind |

Roles are dynamically rebalanced to ensure minimum explorers and validators.

## Time Windows

Schedule swarms to run within specific time windows:

```typescript
import { SwarmController } from 'society-protocol';

const swarm = new SwarmController(storage, rooms, registry);
swarm.start();

// Run daily from 9 AM to 5 PM
swarm.setMissionTimeWindow('mission_abc', {
  startAt: Date.now(),
  endAt: Date.now() + 8 * 3600_000,
  recurrence: {
    type: 'daily',
    startTime: '09:00',
    endTime: '17:00',
  },
});

// Run every 2 hours
swarm.setMissionTimeWindow('mission_xyz', {
  startAt: Date.now(),
  endAt: Date.now() + 3600_000,
  recurrence: {
    type: 'interval',
    intervalMs: 7_200_000, // 2 hours
  },
});

// Run weekdays only
swarm.setMissionTimeWindow('mission_work', {
  startAt: Date.now(),
  endAt: Date.now() + 3600_000,
  recurrence: {
    type: 'weekly',
    daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
    startTime: '08:00',
    endTime: '18:00',
  },
});

// Check if mission is currently active
if (swarm.isMissionInWindow('mission_abc')) {
  console.log('Swarm is active');
}
```

## Affinity-Based Agent Selection

Inspired by SwarmSys's pheromone mechanism, agents build affinity scores for different task types:

```typescript
// Register agents with the swarm
const agent = swarm.registerAgent(workerProfile);

// Record task outcomes — builds affinity over time
swarm.recordTaskOutcome(agentDid, 'research', true);  // boost
swarm.recordTaskOutcome(agentDid, 'research', true);  // more boost
swarm.recordTaskOutcome(agentDid, 'coding', false);   // reduce

// Select best agent for a task type
const best = swarm.selectAgent('research', {
  capabilities: ['arxiv', 'analysis'],
});
// Returns agent with highest affinity + lowest load
```

### Epsilon-Greedy Exploration

- **High-performing agents** (many successes) → lower epsilon → exploit more (assigned to tasks they're good at)
- **Struggling agents** → higher epsilon → explore more (try different task types)
- Base epsilon: 0.25 (configurable)

## Event-Driven Coordination

The controller emits events for real-time UIs and reactive systems:

```typescript
swarm.on('event', (event) => {
  switch (event.type) {
    case 'worker:joined':
    case 'worker:left':
    case 'worker:failed':       // Heartbeat timeout
    case 'worker:overloaded':   // Load >= 95%
    case 'task:completed':
    case 'task:failed':
    case 'mission:window:opened':
    case 'mission:window:closed':
    case 'reallocation:triggered':
    case 'role:changed':
      console.log(`[${event.type}]`, event.data);
  }
});

// Query recent events
const events = swarm.getEvents(Date.now() - 60_000); // last minute
```

## Health Monitoring

Following DRAMA's Monitor agent pattern:

- **Heartbeat check** every 10s (configurable)
- Agents without heartbeat for 30s are marked `unhealthy`
- State changes trigger **event-driven reallocation** (not timer-based)
- Reallocation has a cooldown to prevent thrashing (15s default)

```typescript
const config: SwarmControllerConfig = {
  heartbeatIntervalMs: 10_000,     // Check every 10s
  heartbeatTimeoutMs: 30_000,      // Unhealthy after 30s
  reallocationCooldownMs: 15_000,  // Min time between reallocations
  minExplorers: 1,                  // Always have 1 explorer
  minValidators: 1,                 // Always have 1 validator
  affinityDecay: 0.95,             // Decay per tick
  affinityBoost: 0.15,             // Boost on success
  baseEpsilon: 0.25,               // Exploration rate
  enableTimeWindows: true,
  consensusBoundMs: 60_000,        // Max time to consensus
};
```

## Status Dashboard

```typescript
const status = swarm.getSwarmStatus();

console.log('Role distribution:', status.roleDistribution);
// { explorer: 2, worker: 8, validator: 2 }

console.log('Active windows:', status.activeWindows.length);
console.log('Recent events:', status.recentEvents.length);

for (const agent of status.agents) {
  console.log(`${agent.did}: role=${agent.role} load=${agent.load} streak=${agent.successStreak}`);
}
```

## Integration with Proactive Missions

The SwarmController works alongside the ProactiveMissionEngine:

1. **Mission Engine** creates CoC chains and manages lifecycle
2. **Swarm Controller** handles real-time worker coordination and scheduling
3. **Swarm Registry** discovers workers via P2P presence
4. **Swarm Scheduler** scores workers for step assignment

```
Mission Engine ──→ Creates chains, manages cycles
       │
       ├──→ Swarm Controller ──→ Time windows, roles, affinities
       │
       ├──→ Swarm Registry ──→ P2P worker discovery
       │
       └──→ Swarm Scheduler ──→ Worker scoring for assignment
```
