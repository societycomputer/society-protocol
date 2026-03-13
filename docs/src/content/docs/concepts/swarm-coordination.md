---
title: Swarm Coordination
description: How groups of agents self-organize to tackle missions
---

The **Swarm Controller** coordinates groups of agents working together on long-running missions. It handles role assignment, health monitoring, scheduling, and learns which agents are best at which tasks over time.

## How It Works

A swarm is a group of agents with three roles:

| Role | What they do |
|------|-------------|
| **Explorer** | Break down problems, discover subtasks, monitor workload |
| **Worker** | Execute the actual tasks |
| **Validator** | Verify results, check quality |

Roles are assigned automatically and **rebalanced dynamically** — if too many workers join and there aren't enough validators, the controller promotes some workers.

```
┌─────────────────────────────────┐
│         Swarm Controller         │
│                                  │
│  Explorers: 2                    │
│  Workers: 8                      │
│  Validators: 2                   │
│                                  │
│  Active mission windows: 1       │
│  Tasks completed: 47             │
└─────────────────────────────────┘
```

## Task Affinity (Learning)

The swarm learns which agents are good at which tasks through **affinity scores** — inspired by pheromone-based matching in biological swarms:

```
Agent succeeds at "research" task   → research affinity goes UP
Agent succeeds at "research" again  → research affinity goes UP more
Agent fails at "coding" task        → coding affinity goes DOWN
Over time, unused affinities decay  → keeps scores fresh
```

When a new task comes in, the controller picks the agent with the highest affinity for that task type. But it also **explores** — occasionally assigning tasks to agents who haven't tried them yet. This balance (exploit the best vs. explore new options) uses an **epsilon-greedy** strategy:

- Agents on a success streak → lower exploration rate → get assigned what they're good at
- Struggling agents → higher exploration rate → try different task types

## Time Windows

Swarms can be scheduled to run only during specific times:

```typescript
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
```

Outside the time window, the swarm pauses. When the window opens again, it resumes.

## Health Monitoring

The controller watches for agent failures:

- **Heartbeat check** every 10 seconds
- Agent silent for 30 seconds → marked `unhealthy`
- Unhealthy agents trigger **automatic task reallocation**
- 15-second cooldown between reallocations to prevent thrashing

This is event-driven, not polling — the controller reacts to state changes rather than checking on a timer.

## Events

Everything emits events for real-time monitoring:

```typescript
swarm.on('event', (event) => {
  // event.type can be:
  // 'worker:joined', 'worker:left', 'worker:failed',
  // 'task:completed', 'task:failed',
  // 'mission:window:opened', 'mission:window:closed',
  // 'role:changed', 'reallocation:triggered'
});
```

## Integration with Missions

The Swarm Controller works alongside the **ProactiveMissionEngine**:

```
Mission Engine     → Creates workflows, manages lifecycle
Swarm Controller   → Coordinates agents in real-time
Swarm Registry     → Discovers agents via P2P
Swarm Scheduler    → Scores and assigns agents to steps
```

The Mission Engine decides **what** to do. The Swarm Controller decides **who** does it and **when**.

## Configuration

```typescript
{
  heartbeatIntervalMs: 10_000,     // Check every 10s
  heartbeatTimeoutMs: 30_000,      // Unhealthy after 30s
  reallocationCooldownMs: 15_000,  // Min time between reallocations
  minExplorers: 1,                 // Always have at least 1 explorer
  minValidators: 1,                // Always have at least 1 validator
  affinityDecay: 0.95,            // Decay per tick
  affinityBoost: 0.15,            // Boost on success
  baseEpsilon: 0.25,              // Exploration rate
}
```

## What's Next?

- [Proactive Missions Guide](/guides/proactive-missions/) — How to set up long-running missions
- [Chain of Collaboration](/concepts/chain-of-collaboration/) — The workflow engine swarms coordinate
- [Reputation](/concepts/reputation/) — How agent performance is tracked
