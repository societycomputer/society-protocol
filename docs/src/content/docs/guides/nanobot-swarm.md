---
title: "Tutorial: Nanobot Agent Swarm"
description: Deploy lightweight autonomous agent fleets for distributed research, code review, and infrastructure monitoring
---

Deploy swarms of lightweight autonomous agents — **nanobots** — that coordinate via P2P to accomplish complex tasks in parallel. Each nanobot is a minimal Society node with a single skill, forming emergent intelligence through collaboration.

## Use Cases

| Mode | Agents | Task |
|------|--------|------|
| `research` | 5 topic researchers + 1 coordinator | Parallel research aggregation |
| `review` | 3 specialist reviewers + 1 coordinator | Security/perf/style code review |
| `monitor` | N endpoint monitors + 1 coordinator | Infrastructure health checks |

## Prerequisites

- Node.js 20+
- Ollama with `qwen3:1.7b` (lightweight, fast) for research/review modes
- 2GB+ RAM

## Step 1: Project Setup

```bash
mkdir nanobot-swarm && cd nanobot-swarm
npm init -y
npm install society-protocol
```

```bash
ollama pull qwen3:1.7b  # Lightweight model for nanobots
```

## Step 2: Create the Nanobot Factory

The factory creates ephemeral agents that spin up, execute a task, and optionally self-destruct.

Create `nanobot.js`:

```javascript
import { createClient } from 'society-protocol';

export async function createNanobot(id, roomName = 'nanobot-swarm') {
  const client = await createClient({
    identity: { name: `nanobot-${id}` },
    storage: { path: ':memory:' },  // Ephemeral — no persistence
    network: {
      listenAddrs: ['/ip4/0.0.0.0/tcp/0'],
      enableGossipsub: true,
      enableMdns: true,
      enableDht: false,  // Ephemeral agents don't need DHT
    },
  });

  await client.joinRoom(roomName);
  return client;
}

export async function createCoordinator(roomName = 'nanobot-swarm') {
  const client = await createClient({
    identity: { name: 'coordinator' },
    storage: { path: ':memory:' },
    network: {
      enableGossipsub: true,
      enableMdns: true,
    },
  });

  await client.joinRoom(roomName);
  return client;
}
```

## Step 3: Distributed Research Swarm

Create `research.js`:

```javascript
import { createNanobot, createCoordinator } from './nanobot.js';

const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.MODEL || 'qwen3:1.7b';

const topics = [
  'Multi-agent AI coordination advances 2024-2025',
  'Decentralized identity standards (DID, Verifiable Credentials)',
  'CRDT implementations for distributed systems',
  'libp2p production deployments and benchmarks',
  'Zero-knowledge proofs for agent authentication',
];

async function main() {
  const coordinator = await createCoordinator();
  const space = await coordinator.createKnowledgeSpace(
    'Research', 'Distributed findings', 'team'
  );

  console.log(`Launching ${topics.length} research nanobots...\n`);

  // Spawn all nanobots in parallel
  const results = await Promise.all(
    topics.map(async (topic, i) => {
      const bot = await createNanobot(i);
      console.log(`  [nanobot-${i}] Researching: ${topic.slice(0, 50)}...`);

      const result = await queryOllama(
        `Research this topic and provide 3-5 key findings:\n\n${topic}`
      );

      // Store in shared knowledge pool
      await bot.createKnowledgeCard(space.id, 'finding', topic, result, {
        tags: ['research', `nanobot-${i}`],
        confidence: 0.8,
      });

      // Report completion via P2P
      await bot.sendMessage('nanobot-swarm', JSON.stringify({
        type: 'done', botId: i, topic,
      }));

      console.log(`  [nanobot-${i}] ✓ Done`);
      await bot.disconnect();
      return { topic, result };
    })
  );

  // Coordinator synthesizes
  console.log('\n  Coordinator synthesizing...\n');
  const synthesis = await queryOllama(
    `Synthesize these research findings into a coherent overview:\n\n` +
    results.map((r, i) => `[${i + 1}] ${r.topic}\n${r.result}`).join('\n\n') +
    `\n\nHighlight cross-cutting themes and gaps.`
  );

  console.log(`═══ Research Summary ═══\n\n${synthesis}\n`);
  await coordinator.disconnect();
}

async function queryOllama(prompt) {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, prompt, stream: false,
      options: { temperature: 0.7, num_predict: 300 },
    }),
  });
  return (await res.json()).response || 'No response';
}

main().catch(console.error);
```

Run:

```bash
node research.js
```

## Step 4: Code Review Fleet

Create `review.js`:

```javascript
import { createNanobot, createCoordinator } from './nanobot.js';

const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.MODEL || 'qwen3:1.7b';

// Define reviewer specialties
const reviewers = [
  { id: 'security', focus: 'security vulnerabilities (SQL injection, XSS, eval)' },
  { id: 'perf', focus: 'performance issues (N+1 queries, memory leaks)' },
  { id: 'style', focus: 'code style, naming conventions, best practices' },
];

async function reviewFile(filePath, code) {
  console.log(`\n── ${filePath} ──\n`);

  const reviews = await Promise.all(
    reviewers.map(async (r) => {
      const bot = await createNanobot(r.id);
      const review = await queryOllama(
        `Review this code for ${r.focus}:\n\n\`\`\`\n${code}\n\`\`\`\n\n` +
        `List issues found (or "No issues" if clean). Be concise.`
      );
      console.log(`  [${r.id}] ${review.split('\n')[0]}`);
      await bot.disconnect();
      return { reviewer: r.id, review };
    })
  );

  const issues = reviews.filter(r => !r.review.toLowerCase().includes('no issues'));
  console.log(`  ${issues.length > 0 ? '⚠️  Issues found' : '✓ Clean'}`);
  return reviews;
}

// Review files from git diff or command line
const files = [
  { path: 'src/auth.ts', code: 'function login(u, p) { return db.query(`SELECT * FROM users WHERE name="${u}"`); }' },
  { path: 'src/utils.ts', code: 'function parseJSON(str) { return eval("(" + str + ")"); }' },
];

for (const f of files) await reviewFile(f.path, f.code);
```

Run:

```bash
node review.js
```

### Integrate with Git Hooks

Add to `.git/hooks/pre-push`:

```bash
#!/bin/bash
# Get changed files
FILES=$(git diff --name-only HEAD~1 -- '*.ts' '*.js')
if [ -n "$FILES" ]; then
  node /path/to/review.js $FILES
fi
```

## Step 5: Infrastructure Monitor Fleet

Create `monitor.js`:

```javascript
import { createNanobot, createCoordinator } from './nanobot.js';

const endpoints = JSON.parse(
  process.env.ENDPOINTS || JSON.stringify([
    { name: 'api', url: 'https://api.example.com/health', expect: 200 },
    { name: 'auth', url: 'https://auth.example.com/health', expect: 200 },
    { name: 'cdn', url: 'https://cdn.example.com/ping', expect: 200 },
  ])
);

const INTERVAL = parseInt(process.env.INTERVAL || '30000', 10); // 30s default

async function healthCheck() {
  const results = await Promise.all(
    endpoints.map(async (ep, i) => {
      const bot = await createNanobot(`monitor-${i}`);
      const start = Date.now();
      try {
        const res = await fetch(ep.url, { signal: AbortSignal.timeout(5000) });
        const latency = Date.now() - start;
        const status = res.status === ep.expect ? 'healthy' : 'degraded';

        await bot.sendMessage('nanobot-swarm', JSON.stringify({
          type: 'health', service: ep.name, status, latency, http: res.status,
        }));

        await bot.disconnect();
        return { service: ep.name, status, latency };
      } catch (err) {
        await bot.disconnect();
        return { service: ep.name, status: 'down', error: err.message };
      }
    })
  );

  const down = results.filter(r => r.status === 'down');
  const degraded = results.filter(r => r.status === 'degraded');
  const ts = new Date().toISOString().slice(11, 19);

  console.log(
    `[${ts}] ` +
    `${results.length - down.length - degraded.length}/${results.length} healthy` +
    (down.length ? ` | DOWN: ${down.map(d => d.service).join(', ')}` : '') +
    (degraded.length ? ` | DEGRADED: ${degraded.map(d => d.service).join(', ')}` : '')
  );

  return results;
}

// Run continuously
console.log(`Monitoring ${endpoints.length} endpoints every ${INTERVAL / 1000}s...\n`);
while (true) {
  await healthCheck();
  await new Promise(r => setTimeout(r, INTERVAL));
}
```

Run:

```bash
# Custom endpoints
ENDPOINTS='[{"name":"my-api","url":"https://api.myapp.com/health","expect":200}]' \
INTERVAL=10000 \
node monitor.js
```

## Step 6: Docker Deployment

```yaml
# docker-compose.yml
version: '3.8'

services:
  # Research swarm (one-shot)
  research:
    image: node:20-slim
    working_dir: /app
    command: node research.js
    volumes: [./:/app]
    environment:
      OLLAMA_URL: "http://ollama:11434"
    depends_on: [ollama]
    profiles: [research]

  # Code review (triggered by CI)
  review:
    image: node:20-slim
    working_dir: /app
    command: node review.js
    volumes:
      - ./:/app
      - /path/to/repo:/repo:ro
    environment:
      OLLAMA_URL: "http://ollama:11434"
    depends_on: [ollama]
    profiles: [review]

  # Monitor (long-running)
  monitor:
    image: node:20-slim
    working_dir: /app
    command: node monitor.js
    volumes: [./:/app]
    environment:
      ENDPOINTS: '[{"name":"api","url":"https://api.example.com/health","expect":200}]'
      INTERVAL: "30000"
    restart: always
    profiles: [monitor]

  ollama:
    image: ollama/ollama
    volumes: [ollama-models:/root/.ollama]

volumes:
  ollama-models:
```

```bash
# Run research swarm
docker compose --profile research run research

# Run monitor continuously
docker compose --profile monitor up -d monitor

# Trigger code review
docker compose --profile review run review
```

## Step 7: Scale with Remote Relay

For nanobots across multiple machines:

```javascript
const client = await createClient({
  identity: { name: `nanobot-${id}` },
  storage: { path: ':memory:' },
  network: {
    bootstrapPeers: [process.env.RELAY_ADDR],
    enableGossipsub: true,
    enableMdns: false,  // Disable mDNS for remote
    enableDht: true,    // Enable DHT for discovery
  },
});
```

```bash
# Machine A: coordinator + some nanobots
RELAY_ADDR="/dns4/relay.example.com/tcp/443/wss" node research.js

# Machine B: more nanobots (add SWARM_SIZE env)
RELAY_ADDR="/dns4/relay.example.com/tcp/443/wss" SWARM_SIZE=10 node research.js
```

## Production Checklist

- [ ] Use `qwen3:8b` or larger model for production quality
- [ ] Add alerting (PagerDuty, Slack) to monitor mode
- [ ] CI/CD integration for code review mode
- [ ] Rate limit Ollama calls to prevent overload
- [ ] Log all results to a database or file for auditing
- [ ] Set memory limits: `--max-old-space-size=2048` for large swarms
