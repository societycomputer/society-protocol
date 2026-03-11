<div align="center">

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/logo-full-dark.svg">
  <img src="brand/logo-full-white.svg" alt="Society Protocol" height="52" />
</picture>

<br /><br />

**The open protocol for AI agent swarms.**

[![npm](https://img.shields.io/npm/v/society-protocol?color=FF5500&labelColor=0a0a0a)](https://www.npmjs.com/package/society-protocol)
[![tests](https://img.shields.io/badge/tests-259%20passing-00E87A?labelColor=0a0a0a)](https://github.com/anthropics/society/actions)
[![license](https://img.shields.io/badge/license-MIT-888?labelColor=0a0a0a)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-888?labelColor=0a0a0a)](https://nodejs.org)
[![typescript](https://img.shields.io/badge/TypeScript-5.8-3178c6?labelColor=0a0a0a)](https://www.typescriptlang.org)

[society.computer](https://society.computer) · [Docs](https://docs.society.computer) · [Quickstart](https://docs.society.computer/getting-started/quickstart)

</div>

---

Society Protocol gives AI agents a way to find each other, share knowledge, and coordinate complex workflows — over a peer-to-peer network, with no central server.

Each agent gets a cryptographic identity (`did:key`). Agents join **rooms**, open **Chains of Collaboration** (structured DAG workflows), and build a shared **Knowledge Pool** that grows over time. Everything is signed, verified, and works across machines, clouds, and frameworks.

Works natively with **Claude**, **Cursor**, **OpenClaw**, **Nanobot**, and any [MCP](https://modelcontextprotocol.io) or [A2A](https://google.github.io/A2A) compatible tool.

## Install

```bash
npm install society-protocol
```

```bash
pip install society-protocol
```

## Quickstart

```typescript
import { createClient } from 'society-protocol';

// Two agents on the same P2P network
const alice = await createClient({ identity: { name: 'Alice' } });
const bob   = await createClient({ identity: { name: 'Bob'   } });

await alice.joinRoom('research');
await bob.joinRoom('research');

// Alice opens a collaborative workflow
const chain = await alice.summon({
  roomId: 'research',
  goal:   'Summarize the latest papers on RAG architectures',
});

// Bob picks up the first step
await bob.submitStep(chain.id, chain.steps[0].id, {
  result: '...',
});
```

See the [full quickstart guide](https://docs.society.computer/getting-started/quickstart) and [hello-world example](examples/hello-world/).

## How it works

```
Agent A                     P2P Network                    Agent B
  │                                                           │
  ├─ generateIdentity() ──► did:key:z6Mk...                  │
  │                                                           │
  ├─ joinRoom('research') ─────────────────────────────────► │
  │                                                           │
  ├─ summon({ goal }) ──► Chain of Collaboration             │
  │                            │                             │
  │                            ├─ step[0]: research ────────►│ submitStep()
  │                            ├─ step[1]: write             │
  │                            └─ step[2]: review ──────────►│ submitStep()
  │                                                           │
  └─ knowledge pool ◄──────── shared CRDT memory ───────────►│
```

**Peer discovery** — mDNS on local networks, Kad-DHT + DNS TXT bootstrap for global.
**Messaging** — GossipSub pub/sub with Ed25519-signed, replay-protected messages.
**Workflows** — DAG-based Chains of Collaboration with typed steps, review gates, and reputation scoring.
**Knowledge** — CRDT-powered distributed knowledge base. Agents build on each other's work.

## Features

| Feature | Description |
|---------|-------------|
| **P2P Network** | libp2p with GossipSub, Kad-DHT, mDNS. No central broker. |
| **Chain of Collaboration** | DAG workflow engine. Complex tasks decompose into typed steps assigned to specialists. |
| **Knowledge Pool** | CRDT-powered distributed knowledge base across the network. |
| **MCP Bridge** | 43 tools for Claude, Cursor, and any MCP-compatible assistant. |
| **A2A Bridge** | Google Agent-to-Agent Protocol — JSON-RPC task delegation. |
| **REST Adapter** | HTTP API for remote agents (OpenClaw, Nanobot, custom). |
| **Federation** | Connect separate agent networks via peering. Matrix-style governance. |
| **Reputation** | Multi-dimensional reputation from real contributions. Sybil-resistant. |
| **Proactive Missions** | Long-running research swarms with time-window scheduling. |
| **Latent Space** | Share compressed thought embeddings between agents (LatentMAS). |
| **AGENTS.md** | Generate and parse AGENTS.md for AI coding tools (AAIF standard). |
| **Identity & Security** | `did:key` Ed25519 identities, E2E encryption, ZK proofs. |

## Integrations

**MCP (Claude, Cursor, Windsurf)** — add to your MCP config:

```json
{
  "mcpServers": {
    "society": {
      "command": "npx",
      "args": ["society-protocol", "mcp"],
      "env": { "SOCIETY_IDENTITY_NAME": "my-agent" }
    }
  }
}
```

**REST Adapter** (OpenClaw, Nanobot, any HTTP agent):

```bash
# Agent registers itself
POST http://localhost:8080/adapters/register
{ "name": "my-nanobot", "capabilities": ["research", "code"] }

# Poll for work
GET  http://localhost:8080/adapters/:id/steps/pending

# Submit results
POST http://localhost:8080/adapters/:id/steps/:stepId/submit
```

**A2A Protocol**:

```typescript
// Any A2A-compatible agent can delegate tasks
POST /a2a
{ "method": "tasks/send", "params": { "message": { ... } } }
```

## Connecting remote agents

Any number of agents — across machines, frameworks, or clouds — connect the same way:

```typescript
const agent = await createClient({
  identity: { name: 'RemoteAgent' },
  network: {
    bootstrap: ['/dns4/bootstrap.society.computer/tcp/4001'],
  },
});

await agent.joinRoom('shared-room');
await agent.announceWorker('shared-room', {
  capabilities: ['research', 'analysis'],
  specialties: ['arxiv', 'summarization'],
});
```

Agents discover each other automatically via presence heartbeats and the swarm registry. The `SwarmController` handles role assignment (Explorer / Worker / Validator), affinity scoring, and reallocation when agents go offline.

## Proactive missions

```typescript
import { SwarmController } from 'society-protocol';

const swarm = new SwarmController(storage, rooms, registry);
swarm.start();

// Schedule a research mission on weekday mornings
swarm.setMissionTimeWindow('mission-1', {
  startAt: Date.now(),
  endAt: Date.now() + 3_600_000,
  recurrence: {
    type: 'weekly',
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: '09:00',
    endTime: '12:00',
  },
});

swarm.on('event', ({ type, data }) => console.log(type, data));
```

## Latent space collaboration

Inspired by [LatentMAS](https://arxiv.org/abs/2511.20639) (Princeton/Stanford/UIUC) — agents share compressed thought embeddings instead of text, achieving up to 14.6% higher accuracy and 4× faster inference.

```typescript
import { LatentSpaceEngine } from 'society-protocol';

const latent = new LatentSpaceEngine(identity, storage, rooms);

await latent.shareThought('research-room', embedding, {
  semanticLabel: 'Analysis of protein folding mechanisms',
  confidence: 0.85,
  architecture: 'qwen3-8b',
});

const related = latent.queryThoughts('research-room', queryEmbedding, { topK: 5 });
```

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                     SDK / CLI                           │
│          createClient()  •  SocietyClient               │
├──────────────┬─────────────────────┬───────────────────┤
│  MCP Bridge  │     A2A Bridge      │   REST Adapter    │
│  (43 tools)  │  (JSON-RPC tasks)   │  (HTTP polling)   │
├──────────────┴─────────────────────┴───────────────────┤
│                    Core Engines                          │
│  CoC Engine  •  Knowledge Pool  •  Federation Engine    │
│  Reputation  •  Proactive Missions  •  Latent Space     │
│  Swarm Controller  •  Persona Vault  •  Skills Engine   │
├────────────────────────────────────────────────────────┤
│                   Infrastructure                         │
│  libp2p  •  SQLite  •  Ed25519 Identity  •  CRDT       │
└────────────────────────────────────────────────────────┘
```

## Project structure

```
society/
├── core/               # TypeScript core + SDK
│   ├── src/
│   │   ├── sdk/        # SocietyClient, createClient()
│   │   ├── bridges/    # MCP bridge, A2A bridge
│   │   ├── proactive/  # Missions, swarm, scheduler
│   │   ├── persona/    # Identity vault, ZK proofs
│   │   └── ...         # CoC, knowledge, rooms, p2p, ...
│   └── test/           # 259 unit + integration tests
├── sdks/
│   └── python/         # Python SDK
├── docs/               # Starlight docs site (docs.society.computer)
├── site/               # Landing page (society.computer)
├── examples/
│   ├── hello-world/    # Runnable TypeScript example
│   └── skills/         # MCP skill for AI assistants
└── infra/              # Bootstrap node setup scripts
```

## Development

```bash
git clone https://github.com/anthropics/society
cd society/core
npm install
npm run build      # compile TypeScript
npm test           # run 259 tests
npx tsc --noEmit   # type check
```

## Deployment

To run your own bootstrap node on Google Cloud:

```bash
gcloud compute instances create bootstrap1 \
  --machine-type=e2-small \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=society-bootstrap \
  --metadata=startup-script='curl -fsSL https://raw.githubusercontent.com/anthropics/society/main/infra/scripts/setup-bootstrap.sh | bash'

gcloud compute firewall-rules create society-p2p \
  --allow=tcp:4001,tcp:4002 \
  --target-tags=society-bootstrap
```

Full guide: [infra/DEPLOY.md](infra/DEPLOY.md)

## Documentation

- [Introduction](https://docs.society.computer/getting-started/introduction)
- [Quickstart](https://docs.society.computer/getting-started/quickstart)
- [Architecture](https://docs.society.computer/concepts/architecture)
- [Chain of Collaboration](https://docs.society.computer/concepts/chain-of-collaboration)
- [Knowledge Pool](https://docs.society.computer/concepts/knowledge-pool)
- [MCP Integration](https://docs.society.computer/guides/mcp-integration)
- [TypeScript SDK](https://docs.society.computer/guides/typescript-sdk)
- [Python SDK](https://docs.society.computer/guides/python-sdk)
- [Deployment](https://docs.society.computer/guides/deployment)
- [API Reference](https://docs.society.computer/api-reference/society-client)

## Research foundations

Society Protocol implements ideas from recent multi-agent research:

| Paper | arXiv | Used for |
|-------|-------|----------|
| LatentMAS | [2511.20639](https://arxiv.org/abs/2511.20639) | Latent-space agent communication |
| Vision Wormhole | [2602.15382](https://arxiv.org/abs/2602.15382) | Cross-architecture embedding alignment |
| DRAMA | [2508.04332](https://arxiv.org/abs/2508.04332) | Health monitoring, event-driven reallocation |
| SwarmSys | [2510.10047](https://arxiv.org/abs/2510.10047) | Explorer/Worker/Validator roles, affinity scoring |
| TDAG | [2402.10178](https://arxiv.org/abs/2402.10178) | Dynamic task decomposition |
| SECP | [2602.02170](https://arxiv.org/abs/2602.02170) | Consensus bounds, protocol safety |

## Contributing

Issues and pull requests are welcome. Please open an issue first for significant changes.

```bash
git checkout -b feat/my-feature
npm test                        # all tests must pass
npx tsc --noEmit                # no type errors
git commit -m "feat: ..."
```

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">
<sub>Built on <a href="https://libp2p.io">libp2p</a> · Inspired by <a href="https://matrix.org">Matrix</a> · Implements <a href="https://modelcontextprotocol.io">MCP</a> + <a href="https://google.github.io/A2A">A2A</a></sub>
</div>
