---
title: A2A Bridge
description: Google Agent-to-Agent protocol bridge for cross-platform interoperability
---

The **A2A Bridge** implements [Google's Agent-to-Agent protocol](https://google.github.io/A2A/), enabling interoperability between A2A-compliant agents and Society Protocol's P2P network.

## What is A2A?

A2A (Agent-to-Agent) is an open protocol by Google for agent communication. It defines:
- **Agent Cards** — Metadata describing an agent's capabilities
- **Tasks** — Units of work with lifecycle states
- **JSON-RPC** — Transport protocol for task operations

## Setup

```typescript
import { A2ABridge } from 'society-protocol';

const bridge = new A2ABridge({
  identity,
  storage,
  rooms,
  coc,
  knowledge,
  defaultRoom: 'interop-room',
  baseUrl: 'https://my-agent.example.com',
  exposedSkills: [
    {
      id: 'research',
      name: 'Distributed Research',
      description: 'Conduct research using a swarm of agents',
      tags: ['research', 'swarm'],
    },
  ],
});
```

## Agent Card

The bridge automatically generates an A2A Agent Card:

```typescript
const card = bridge.getAgentCard();
// {
//   name: "MyAgent",
//   description: "Society Protocol agent — P2P multi-agent collaboration",
//   url: "https://my-agent.example.com",
//   version: "1.0.0",
//   capabilities: {
//     streaming: true,
//     pushNotifications: false,
//     stateTransitionHistory: true,
//   },
//   skills: [...],
//   defaultInputModes: ["text/plain", "application/json"],
//   defaultOutputModes: ["text/plain", "application/json"],
// }
```

## Handling Tasks

### Inbound: A2A → Society

When an external A2A agent sends a task, the bridge converts it to a CoC chain:

```typescript
const task = await bridge.handleTaskSend({
  id: 'task-123',
  message: {
    role: 'user',
    parts: [{ type: 'text', text: 'Research quantum computing advances' }],
  },
});
// task.status.state === 'working'
// task.metadata.chainId === 'chain_01HX...'
```

### Task Status

```typescript
const status = bridge.getTask('task-123');
// status.state: 'submitted' | 'working' | 'completed' | 'canceled' | 'failed'
```

### Task Cancellation

```typescript
const cancelled = await bridge.cancelTask('task-123');
```

## JSON-RPC Handler

The bridge includes a complete JSON-RPC handler for HTTP integration:

```typescript
import express from 'express';

const app = express();
app.use(express.json());

// A2A endpoint
app.post('/a2a', async (req, res) => {
  const response = await bridge.handleJsonRpc(req.body);
  res.json(response);
});

// Agent Card discovery
app.get('/.well-known/agent.json', (req, res) => {
  res.json(bridge.getAgentCard());
});
```

### Supported JSON-RPC Methods

| Method | Description |
|--------|-------------|
| `tasks/send` | Send a new task |
| `tasks/get` | Get task status |
| `tasks/cancel` | Cancel a task |
| `agent/authenticatedExtendedCard` | Get agent card |

## Outbound: Society → A2A

Convert completed Society chains into A2A task responses:

```typescript
const a2aTask = bridge.chainToA2ATask(chainId);
```

Convert step output to A2A messages:

```typescript
const message = bridge.stepToA2AMessage({
  output: 'Research findings...',
  artifacts: [{ artifact_type: 'report', content: '...' }],
});
```

## Events

```typescript
bridge.on('a2a:task:created', (taskId, chainId) => {
  console.log(`Task ${taskId} → Chain ${chainId}`);
});

bridge.on('a2a:task:completed', (taskId, chainId) => {
  console.log(`Task ${taskId} completed`);
});
```

## Stats

```typescript
const stats = bridge.getStats();
// { activeTasks: 3, completedTasks: 12, failedTasks: 1 }
```
