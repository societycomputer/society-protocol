# Society Core — Agent Development Guide

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Application (CLI)                           │
│                    src/index.ts                                  │
├─────────────────────────────────────────────────────────────────┤
│                      Protocol Layer                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ RoomManager │  │  CocEngine  │  │  ReputationEngine       │  │
│  │  (rooms.ts) │  │   (coc.ts)  │  │  (reputation.ts)        │  │
│  └─────────────┘  └──────┬──────┘  └─────────────────────────┘  │
│                          │                                       │
│  ┌───────────────────────┴───────────────────────────────────┐  │
│  │                    AdapterHost (adapters.ts)               │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                      Core Services                               │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌────────────────┐  │
│  │  SWP     │  │  Planner │  │  Identity │  │  CapsuleExporter│ │
│  │ (swp.ts) │  │(planner.ts)│ │(identity.ts)│ │ (capsules.ts)  │  │
│  └──────────┘  └──────────┘  └───────────┘  └────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                      Infrastructure Layer                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────────┐  │
│  │   P2P    │  │ Storage  │  │         Templates            │  │
│  │ (p2p.ts) │  │(storage.ts)│ │        (templates.ts)        │  │
│  │GossipSub │  │  SQLite  │  │                              │  │
│  │  DHT     │  │  WAL     │  │                              │  │
│  └──────────┘  └──────────┘  └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Module Responsibilities

### 1. SWP (swp.ts)
**Purpose**: Wire protocol definitions and validation

**Key Exports**:
- `createEnvelope()` - Create signed messages
- `validateEnvelope()` - Validate incoming messages
- `MessageType` - All supported message types
- `SWP_VERSION` - Current protocol version

**When to modify**:
- Adding new message types
- Changing protocol version
- Modifying envelope structure

### 2. P2P (p2p.ts)
**Purpose**: Network layer with GossipSub and DHT

**Key Features**:
- GossipSub for scalable pub/sub
- Kad-DHT for peer discovery
- Connection pooling
- Latency tracking

**When to modify**:
- Adding new transports
- Changing gossip parameters
- Implementing new discovery mechanisms

### 3. Rooms (rooms.ts)
**Purpose**: Room management and message routing

**Key Features**:
- Topic subscription management
- Message routing by type
- Presence tracking
- Heartbeat management

**When to modify**:
- Adding new message handlers
- Changing room lifecycle
- Modifying presence behavior

### 4. CoC Engine (coc.ts)
**Purpose**: Chain of Collaboration orchestration

**Key Features**:
- DAG execution engine
- Lease-based assignment
- Automatic handoff
- Multi-criteria consensus

**State Machine**:
```
PROPOSED → ASSIGNED → SUBMITTED → REVIEWED → MERGED
              ↓           ↓           ↓
           (expired)  (rejected)  (revision)
              ↓           ↓           ↓
           REASSIGN    REJECTED    BACK_TO_PROPOSED
```

**When to modify**:
- Adding new step kinds
- Changing consensus logic
- Modifying lease behavior

### 5. Reputation (reputation.ts)
**Purpose**: Decentralized reputation tracking

**Key Features**:
- Task outcome tracking
- Specialty scoring
- Peer reviews
- Trust tiers

**Trust Tiers**:
- unverified (< 3 tasks)
- bronze (3+ tasks, score < 0.5)
- silver (score 0.5-0.7)
- gold (score 0.7-0.9)
- platinum (score >= 0.9)

**When to modify**:
- Changing reputation algorithm
- Adding new metrics
- Modifying trust tiers

### 6. Planner (planner.ts)
**Purpose**: AI-powered DAG generation

**Key Features**:
- Multi-provider (OpenAI, Anthropic, Ollama)
- Intelligent caching
- Fallback chains
- Streaming support

**Environment Variables**:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OLLAMA_URL` (default: http://localhost:11434)

**When to modify**:
- Adding new providers
- Changing prompt templates
- Modifying DAG validation

### 7. Storage (storage.ts)
**Purpose**: SQLite persistence layer

**Key Features**:
- WAL mode for performance
- Schema versioning
- Full CRUD operations
- Event logging

**Schema Version**: 2

**When to modify**:
- Adding new tables
- Changing schema
- Adding indexes

### 8. Adapter Host (adapters.ts)
**Purpose**: HTTP bridge for external agents

**API Endpoints**:
- `POST /adapters/register` - Register adapter
- `GET /adapters/:id` - Get adapter info
- `POST /adapters/:id/heartbeat` - Health ping
- `GET /adapters/:id/steps/pending` - Poll for work
- `POST /adapters/:id/steps/:step_id/claim` - Claim step
- `POST /adapters/:id/steps/:step_id/submit` - Submit result

**When to modify**:
- Adding new endpoints
- Changing claim logic
- Modifying health checks

## Development Workflow

### Adding a New Message Type

1. Add to `MessageType` in `swp.ts`
2. Add body interface in `swp.ts`
3. Add handler in `rooms.ts` `routeMessage()`
4. Add CoC handler in `coc.ts` if applicable
5. Add test in `swp.test.ts`

### Adding a New Template

1. Add to `TEMPLATES` in `templates.ts`
2. Set appropriate category and tags
3. Define DAG generation function
4. Validate with `validateTemplateDag()`

### Adding a New P2P Transport

1. Install transport package
2. Add to transports array in `p2p.ts`
3. Configure in `P2PConfig`
4. Update `start()` method

## Testing

```bash
# Run all tests
npm test

# Run with watch
npm run test:watch

# Run specific test
npx vitest run src/reputation.test.ts
```

## Debugging

```bash
# Enable debug logging
SOCIETY_DEBUG=true npm run dev

# Debug specific module
DEBUG=society:p2p npm run dev
```

## Performance Considerations

1. **GossipSub**: Default D=6, adjust for network size
2. **SQLite**: WAL mode enabled, pragmas tuned
3. **Lease Monitor**: 10 second interval
4. **Reputation**: 30 second sync interval
5. **Planner Cache**: 100 entry LRU, 24h TTL

## Security Checklist

- [ ] All messages signed with Ed25519
- [ ] Signature verification on receipt
- [ ] Replay cache enabled
- [ ] TTL enforcement
- [ ] Payload size limits
- [ ] Adapter authentication
- [ ] Localhost-only adapter API

## Common Issues

### GossipSub not connecting
- Check firewall rules for TCP/UDP
- Verify bootstrap peers are reachable
- Check DHT bootstrap status

### SQLite locked errors
- Ensure WAL mode is enabled
- Check for concurrent access
- Verify file permissions

### Planner returning invalid DAGs
- Check prompt template
- Validate with `validateDag()`
- Review provider response
