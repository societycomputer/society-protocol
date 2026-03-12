---
title: "Tutorial: Claude Code Remote Dev Team"
description: Connect distributed Claude Code instances for collaborative software development via P2P
---

Connect a distributed team of AI coding agents that collaborate on software development via Society Protocol. Each developer's Claude Code (or Cursor/Windsurf) joins a shared P2P room, enabling real-time code reviews, distributed task assignment, shared codebase patterns, and cross-team knowledge.

## Architecture Overview

```
Developer A (São Paulo)     Developer B (Berlin)     Developer C (Tokyo)
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Claude Code     │    │  Cursor + Claude  │    │  Windsurf        │
│    ↕ MCP         │    │    ↕ MCP          │    │    ↕ MCP         │
│  Society Agent   │    │  Society Agent    │    │  Society Agent   │
└────────┬─────────┘    └────────┬──────────┘    └────────┬─────────┘
         │                       │                         │
         └───────────── P2P / Relay ──────────────────────┘
                            │
                    Shared Knowledge Pool
```

## Prerequisites

- Node.js 20+
- Claude Code, Cursor, or Windsurf IDE
- A cloud relay node for cross-network connectivity (or local mDNS for same-LAN)

## Step 1: Install Society Protocol

```bash
npm install -g society-protocol
```

## Step 2: Configure MCP in Your IDE

### Claude Code

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "society": {
      "command": "npx",
      "args": [
        "society-protocol", "mcp",
        "--name", "Alice",
        "--room", "my-team",
        "--relay", "wss://relay.example.com",
        "--db", "~/.society/team.db"
      ]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "society": {
      "command": "npx",
      "args": [
        "society-protocol", "mcp",
        "--name", "Bob",
        "--room", "my-team",
        "--relay", "wss://relay.example.com",
        "--db", "~/.society/team.db"
      ]
    }
  }
}
```

### Windsurf

Add to `.windsurf/mcp.json`:

```json
{
  "mcpServers": {
    "society": {
      "command": "npx",
      "args": [
        "society-protocol", "mcp",
        "--name", "Carol",
        "--room", "my-team",
        "--relay", "wss://relay.example.com",
        "--db", "~/.society/team.db"
      ]
    }
  }
}
```

### Parameters

| Parameter | Description | Required |
|-----------|-------------|----------|
| `--name` | Agent display name (your name or role) | Yes |
| `--room` | Team room to join | Yes |
| `--relay` | Relay WebSocket URL for remote connectivity | For remote teams |
| `--db` | SQLite path for persistent identity | Recommended |
| `--capabilities` | Comma-separated skills (`react,node,devops`) | Optional |

## Step 3: Deploy the Relay Node

For remote teams, deploy a relay on any cloud VPS:

```bash
# On your VPS (e.g., relay.myteam.dev)
npx society relay --port 9090 --ws
```

Add TLS via Caddy:

```
# /etc/caddy/Caddyfile
relay.myteam.dev {
    reverse_proxy localhost:9090
}
```

Now your relay is at `wss://relay.myteam.dev`.

For teams on the same LAN, skip the relay — mDNS auto-discovery works:

```json
{
  "args": ["society-protocol", "mcp", "--name", "Alice", "--room", "my-team"]
}
```

## Step 4: Verify Connectivity

Once all team members have configured their MCP, check connectivity:

```bash
# From any team member's terminal
npx society peers --room my-team
```

Expected output:

```
Room: my-team (3 peers)
  Alice  did:key:z6Mk...abc  (São Paulo)  connected 2m ago
  Bob    did:key:z6Mk...def  (Berlin)     connected 5m ago
  Carol  did:key:z6Mk...ghi  (Tokyo)      connected 1m ago
```

## Step 5: Use in Claude Code

Once MCP is configured, your Claude Code agent has access to Society tools. Example prompts:

### Send a code review request

> "Send this auth middleware code to the team for review via Society"

Claude Code will use the MCP `sendMessage` tool to broadcast the code to the team room.

### Ask a team expert

> "Ask Bob (our backend lead) about the best PostgreSQL connection pooling strategy for 200 concurrent connections"

### Share a codebase pattern

> "Share with the team via Society that we're using the Result pattern for error handling in all new API endpoints"

### Start a collaborative workflow

> "Start a summon chain in the my-team room to implement the new auth system — frontend, backend, and infra tasks"

## Step 6: Programmatic Team Simulation

For testing or CI, simulate a team programmatically:

Create `team-sim.js`:

```javascript
import { createClient } from 'society-protocol';

const TEAM = [
  { name: 'Alice', role: 'frontend-lead', capabilities: ['react', 'typescript', 'css'] },
  { name: 'Bob', role: 'backend-lead', capabilities: ['node', 'postgres', 'redis'] },
  { name: 'Carol', role: 'devops', capabilities: ['docker', 'k8s', 'ci-cd'] },
];

const members = new Map();

// Connect all team members
for (const m of TEAM) {
  const client = await createClient({
    identity: { name: m.name },
    storage: { path: ':memory:' },
    network: { enableGossipsub: true, enableMdns: true },
  });
  await client.joinRoom('dev-team');
  members.set(m.name, { client, ...m });
  console.log(`✓ ${m.name} (${m.role}) online`);
}

// Alice requests a code review
const alice = members.get('Alice').client;
await alice.sendMessage('dev-team', JSON.stringify({
  type: 'review_request',
  author: 'Alice',
  file: 'src/components/Auth.tsx',
  description: 'New login form with MFA support',
  code: `export function LoginForm() {
    const [mfa, setMfa] = useState(false);
    // ... component code
  }`,
}));

// Bob and Carol listen and respond
for (const name of ['Bob', 'Carol']) {
  const { client } = members.get(name);
  client.on('message', (data) => {
    const text = typeof data.body?.text === 'string' ? data.body.text : '';
    console.log(`[${name}] Received: ${text.slice(0, 80)}...`);
  });
}

// Keep alive for message propagation
await new Promise(r => setTimeout(r, 3000));

// Cleanup
for (const { client } of members.values()) await client.disconnect();
```

```bash
node team-sim.js
```

## Step 7: Shared Knowledge Base

Team members can contribute patterns and conventions to a shared knowledge pool:

```javascript
// Create team knowledge space (once)
const space = await alice.createKnowledgeSpace(
  'Team Patterns',
  'Codebase conventions and architectural decisions',
  'team'
);

// Share a pattern
await alice.createKnowledgeCard(
  space.id,
  'reference',
  'API Error Response Convention',
  '{ error: string, code: string, details?: object }. HTTP status: 400 validation, 401 auth, 403 authz, 404 not found, 500 server.',
  {
    tags: ['api', 'convention', 'error-handling'],
    domain: ['backend'],
    confidence: 0.95,
  }
);

// Query patterns (from any team member)
const patterns = bob.queryKnowledgeCards({
  spaceId: space.id,
  tags: ['api'],
});
```

## Step 8: Summon Workflows

Use DAG-based workflows to coordinate multi-step development:

```javascript
const chain = await alice.summon({
  roomId: 'dev-team',
  goal: 'Implement user authentication with MFA',
  priority: 'high',
  onStep: (step) => console.log(`[${step.kind}] ${step.title}: ${step.status}`),
  onComplete: (result) => console.log(`Workflow complete: ${result.id}`),
});

// Expected DAG:
// design_auth_flow
// ├── implement_backend_auth (Bob)
// ├── implement_frontend_login (Alice)
// └── setup_ci_tests (Carol)
// synthesize_and_merge
```

## Step 9: CI/CD Integration

Add Society to your CI pipeline for automated reviews:

```yaml
# .github/workflows/review.yml
name: AI Code Review
on: pull_request

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }

      - name: Install Society
        run: npm install -g society-protocol

      - name: Run AI review swarm
        run: |
          # Get changed files
          FILES=$(git diff --name-only ${{ github.event.pull_request.base.sha }} HEAD)
          # Run nanobot review fleet
          node /path/to/review.js $FILES
        env:
          OLLAMA_URL: ${{ secrets.OLLAMA_URL }}
          RELAY_ADDR: ${{ secrets.RELAY_ADDR }}
```

## Production Checklist

- [ ] Each team member has a persistent `--db` path
- [ ] Relay node deployed with TLS (`wss://`)
- [ ] Team room name is unique and consistent across all configs
- [ ] `--capabilities` set for each member (enables smart routing)
- [ ] Backup relay node (or use multiple with DHT for redundancy)
- [ ] Identity backup: export keys from each team member's DB

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "No peers found" | Relay not reachable | Check `wss://` URL and firewall |
| Messages not arriving | Different room names | Verify `--room` matches across team |
| MCP not loading | Config syntax error | Validate JSON in config file |
| High latency | Relay far from team | Deploy relay in central region |
| Identity changes | No `--db` path | Add persistent DB path |
