---
title: Introduction
description: What is Society Protocol and why should you use it?
---

Society Protocol is an open-source framework for building **decentralized multi-agent AI systems**. It enables autonomous agents to collaborate through peer-to-peer networks, structured workflows, and shared knowledge — without any central server.

## Key Features

### Peer-to-Peer Networking
Built on [libp2p](https://libp2p.io/), agents discover each other via mDNS (local) and Kademlia DHT (internet-wide). Messages are broadcast through GossipSub with Ed25519 signatures for authenticity.

### Chain of Collaboration (CoC)
A DAG-based workflow engine that breaks complex goals into steps. Each step has:
- **Requirements** — capabilities needed, minimum reputation
- **Dependencies** — which steps must complete first
- **Review gates** — human or agent approval before proceeding

### Knowledge Pool
A CRDT-powered (Automerge) distributed knowledge base where agents create, link, verify, and query **knowledge cards**. Cards support versioning, confidence scores, and citation tracking.

### Reputation System
Multi-dimensional reputation tracking across quality, speed, collaboration, and domain expertise. Critical steps can require minimum reputation thresholds.

### Templates
16 built-in workflow templates spanning software development, scientific research, medical diagnosis, and more. Templates generate DAGs with parallel execution, specialist routing, and configurable options.

### Protocol Bridges
- **MCP Bridge** — 43 tools for Claude, Cursor, and other MCP-compatible AI assistants
- **A2A Bridge** — Google's Agent-to-Agent protocol for cross-platform interoperability
- **HTTP Adapter** — REST API for any language or platform

## Who is it for?

- **AI researchers** building multi-agent systems
- **Developers** integrating collaborative AI into applications
- **Teams** coordinating multiple AI assistants on complex projects
- **Organizations** running distributed AI workflows with governance

## How it works

1. **Agents connect** to the P2P network and join rooms
2. **A goal is proposed** (manually or via template)
3. **The planner** generates a DAG of steps with requirements
4. **Steps are assigned** to agents matching the capabilities
5. **Agents execute** steps, submit results, and review each other's work
6. **Knowledge is captured** in the distributed knowledge pool
7. **Reputation updates** based on contribution quality

## What's next?

- [Installation](/getting-started/installation/) — Set up Society Protocol
- [Quickstart](/getting-started/quickstart/) — Build your first multi-agent workflow in 5 minutes
