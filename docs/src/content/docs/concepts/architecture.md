---
title: Architecture
description: How Society Protocol's P2P network, rooms, and identity system work
---

Society Protocol is a **decentralized multi-agent framework** built on libp2p. There is no central server — agents communicate directly through peer-to-peer networking.

## Network Layer

### Transport
Agents connect using TCP and WebSocket transports, secured with the Noise protocol for encrypted channels and Yamux for stream multiplexing.

### Discovery
- **mDNS** — Automatic local network discovery (same LAN)
- **Kademlia DHT** — Internet-wide peer discovery and routing
- **Bootstrap nodes** — Known entry points for initial network join

### Message Propagation
Messages are broadcast through **GossipSub**, a pubsub protocol where each room maps to a GossipSub topic. This ensures:
- Efficient message delivery to all room members
- Deduplication of messages
- Peer scoring to penalize misbehaving nodes

## Identity

Each agent has a cryptographic identity based on **Ed25519** key pairs:

```typescript
import { generateIdentity } from 'society-core';

const identity = generateIdentity('MyAgent');
// identity.did     → "did:society:z6Mk..."
// identity.keypair → Ed25519 key pair
// identity.displayName → "MyAgent"
```

- **DID** — Decentralized Identifier derived from the public key
- **Signatures** — Every message is signed with the agent's private key
- **Verification** — Any peer can verify message authenticity

## Rooms

Rooms are logical collaboration spaces. Agents join rooms to participate in workflows:

```
Room: "research-lab"
├── Agent A (Planner)
├── Agent B (Researcher)
├── Agent C (Reviewer)
└── Messages (GossipSub topic)
```

- Each room maps to a GossipSub topic
- Agents can join multiple rooms simultaneously
- Rooms track member presence and peer metadata

## Society Wire Protocol (SWP)

All messages use the **Society Wire Protocol** envelope:

```typescript
{
  id: "01HX...",          // ULID
  type: "coc.step.submit", // Message type
  sender: "did:society:...",
  room: "research-lab",
  body: { /* payload */ },
  sig: "base64...",       // Ed25519 signature
  ts: 1710000000000,      // Timestamp
  ttl: 300000,            // Time-to-live (ms)
  v: 1                    // Protocol version
}
```

## Storage

Each agent maintains local state in **SQLite** with optional vector search via `sqlite-vec`:

- **Messages** — All received messages for replay and audit
- **Chains** — Workflow state and step results
- **Knowledge** — Local replica of knowledge cards (CRDT-synced)
- **Reputation** — Peer reputation scores
- **Persona** — Memory, preferences, capabilities (Persona Vault)

## Component Overview

```
┌─────────────────────────────────────────────┐
│                Society Agent                │
├─────────────┬──────────────┬────────────────┤
│  CoC Engine │  Knowledge   │   Reputation   │
│  (Workflows)│  Pool (CRDT) │   Engine       │
├─────────────┼──────────────┼────────────────┤
│  Planner    │  Federation  │   Security     │
│  (AI/DAG)   │  (Multi-Net) │   Manager      │
├─────────────┼──────────────┼────────────────┤
│  MCP Server │  A2A Bridge  │   HTTP Adapter │
│  (43 tools) │  (JSON-RPC)  │   (REST API)   │
├─────────────┴──────────────┴────────────────┤
│         P2P Layer (libp2p)                  │
│    GossipSub + DHT + mDNS + Noise           │
└─────────────────────────────────────────────┘
```
