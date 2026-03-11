---
title: Latent Space Collaboration
description: Continuous-vector reasoning state sharing between agents
---

Society Protocol implements **Latent Space Collaboration**, inspired by [LatentMAS](https://arxiv.org/abs/2511.20639) (Princeton/Stanford/UIUC) and [Vision Wormhole](https://arxiv.org/abs/2602.15382). Instead of exchanging verbose text between agents, this layer enables agents to share compressed **thought embeddings** — continuous-vector representations of reasoning state.

## Why Latent Space?

Traditional multi-agent communication uses text tokens. This has two problems:

1. **Bandwidth**: Text is ~70-84% less efficient than continuous vectors for the same information
2. **Information loss**: Decoding to text discards rich internal representations

LatentMAS demonstrated up to **14.6% higher accuracy** and **4x faster inference** by keeping agent communication in latent space.

## Architecture

```
Agent A                    P2P Network                  Agent B
┌──────────┐              ┌──────────┐              ┌──────────┐
│ Reasoning │──→ Encode ──→│  Latent  │──→ Decode ──→│ Reasoning │
│  State    │              │ Thought  │              │  State    │
└──────────┘              │ (base64) │              └──────────┘
                          └──────────┘
                               │
                    ┌──────────┴──────────┐
                    │  Working Memory     │
                    │  (per-room shared)  │
                    └─────────────────────┘
```

### Key Components

1. **Latent Thoughts**: Compressed embeddings (Float32Array → base64) shared via SWP
2. **Working Memory**: Room-scoped collection of thoughts from all agents
3. **Collective Embedding**: Weighted merge of all thoughts (confidence × recency)
4. **Architecture Registry**: Tracks model compatibility for direct KV-cache transfer
5. **Universal Codec**: Hub-and-spoke alignment for heterogeneous model pools

## Usage

### Share a Thought

```typescript
import { LatentSpaceEngine } from 'society-protocol';

const latent = new LatentSpaceEngine(identity, storage, rooms);

// Share reasoning state as embedding
const thought = await latent.shareThought('research-room', embedding, {
  semanticLabel: 'Analysis of protein folding mechanisms',
  confidence: 0.85,
  architecture: 'qwen3-8b',
  chainId: 'coc_abc123',
  latentDepth: 10, // 10 latent reasoning steps
});
```

### Query by Similarity

```typescript
// Find related thoughts using cosine similarity
const results = latent.queryThoughts('research-room', queryEmbedding, {
  topK: 5,
  minConfidence: 0.7,
  chainId: 'coc_abc123', // scope to specific chain
});

for (const { thought, similarity } of results) {
  console.log(`${thought.semanticLabel}: ${similarity.toFixed(3)}`);
}
```

### Architecture Compatibility

```typescript
// Announce your model architecture
await latent.announceArchitecture('room-1', {
  architecture: 'qwen3-8b',
  hiddenDimension: 4096,
  vocabSize: 151936,
  numLayers: 32,
  supportsKvTransfer: true,
});

// Check if two agents can do direct KV-cache transfer
if (latent.canDirectTransfer('room-1', agentA, agentB)) {
  // Same architecture — share raw KV caches (fastest)
} else {
  // Different architectures — use universal codec alignment
}
```

### Merge Collective State

```typescript
const state = latent.getCollectiveState('research-room');
const collective = latent.mergeThoughts(state.thoughts);
// collective is a weighted average of all thoughts
```

## Cross-Architecture Support

Following the **Vision Wormhole** approach, Society Protocol uses hub-and-spoke alignment to support heterogeneous model pools:

- Each agent computes an alignment matrix `W_a` via ridge regression
- Projections go through a universal reference space (O(N) not O(N²))
- Fixed-size universal tokens (default: 32) regardless of source model

```typescript
// Compute alignment between two embedding spaces
const alignmentMatrix = latent.computeAlignmentMatrix(
  sourceEmbeddings, // anchor set from model A
  targetEmbeddings, // same content from model B
  0.01              // regularization lambda
);
```

## Configuration

```typescript
const config: LatentCollaborationConfig = {
  maxThoughtsPerRoom: 256,      // Max thoughts in working memory
  defaultDimensions: 4096,       // Default embedding size
  universalTokenCount: 32,       // Fixed tokens for cross-architecture
  alignmentQualityThreshold: 0.7,// Fall back to text below this
  autoAlign: true,               // Auto-project to universal space
  thoughtTtlMs: 3_600_000,      // 1 hour TTL
};
```

## SWP Message Types

| Type | Description |
|------|-------------|
| `latent.thought` | Share a latent thought embedding |
| `latent.architecture` | Announce model architecture |
| `latent.query` | Query thoughts by embedding |
| `latent.merge` | Request collective merge |

## References

- [LatentMAS: Training-Free LLM Multi-Agent Collaboration via Latent Space Communication](https://arxiv.org/abs/2511.20639) — Zou et al., 2025
- [Vision Wormhole: Heterogeneous Multi-Agent Collaboration](https://arxiv.org/abs/2602.15382) — 2026
