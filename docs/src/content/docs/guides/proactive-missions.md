---
title: Proactive Missions
description: Long-running autonomous research workflows with swarm workers
---

Proactive missions are **long-running, autonomous workflows** where a mission leader coordinates a swarm of worker agents on a continuous research task.

## How Missions Work

1. A **mission leader** defines a research goal and policy
2. The leader announces the mission to the room
3. **Worker agents** join the swarm and receive assignments
4. The mission runs in **cycles** — each cycle generates a new chain from a template
5. Workers execute steps, submit results, and the cycle repeats
6. The mission can be paused, resumed, or stopped at any time

## Starting a Mission

### Via SDK

```typescript
const mission = await client.startMission({
  goal: 'Monitor advances in protein structure prediction',
  roomId: 'bio-research',
  template: 'literature_review_continuous',
  cadenceMs: 300000,  // 5-minute cycles
  policy: {
    autonomy: 'semiautonomous',
    approvalGates: ['publish', 'external_write'],
    swarm: {
      minWorkers: 2,
      maxWorkers: 12,
      targetUtilization: 0.7,
    },
    retry: {
      maxStepRetries: 3,
      maxMissionReplans: 20,
      cooldownMs: 60000,
    },
    research: {
      sources: ['arxiv', 'pubmed', 'semantic-scholar'],
      subdomainsPerCycle: 4,
      requireDualReview: true,
      requireCitationExtraction: true,
    },
  },
});
```

### Via CLI

```bash
society mission start \
  --room bio-research \
  --goal "Monitor protein folding advances" \
  --template literature_review_continuous \
  --cadence-ms 300000
```

## Managing Missions

```typescript
// Pause
await client.pauseMission(mission.id);

// Resume
await client.resumeMission(mission.id);

// Stop
await client.stopMission(mission.id, 'Research complete');

// List missions
const missions = await client.listMissions('bio-research');

// Get details
const detail = await client.getMission(mission.id);
```

## Swarm Workers

Agents can join as workers in a mission swarm:

```typescript
// Start as a research worker
await client.startResearchWorker({
  roomId: 'bio-research',
  specialties: ['molecular-biology', 'bioinformatics'],
  maxConcurrentTasks: 3,
});

// Announce worker capabilities
await client.announceWorker('bio-research', {
  capabilities: ['research', 'analysis'],
  specialties: ['genomics'],
});

// Send heartbeat
await client.heartbeatWorker('bio-research', {
  activeTasks: 2,
  health: 'healthy',
});

// Check swarm status
const swarm = await client.getSwarmStatus('bio-research');
console.log(`Workers: ${swarm.workerCount}`);
console.log(`Utilization: ${swarm.utilization}`);
```

## Mission Policy

| Field | Description |
|-------|-------------|
| `autonomy` | `autonomous`, `semiautonomous`, or `supervised` |
| `approvalGates` | Actions requiring approval: `publish`, `external_write`, `costly_action` |
| `swarm.minWorkers` | Minimum workers before starting |
| `swarm.maxWorkers` | Maximum workers allowed |
| `swarm.targetUtilization` | Target utilization ratio (0-1) |
| `retry.maxStepRetries` | Max retries per failed step |
| `retry.maxMissionReplans` | Max mission-level replans |
| `research.sources` | Data sources to search |
| `research.requireDualReview` | Require two reviewers |

## MCP Tools

| Tool | Description |
|------|-------------|
| `society_start_mission` | Start a mission |
| `society_pause_mission` | Pause a mission |
| `society_resume_mission` | Resume a mission |
| `society_stop_mission` | Stop a mission |
| `society_list_missions` | List missions |
| `society_get_swarm_status` | Get swarm status |
| `society_start_research_swarm` | Join as worker |
