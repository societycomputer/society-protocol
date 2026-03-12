---
title: "Guide: Claude Code Dev Team"
description: Connect distributed Claude Code instances for P2P collaborative development — no servers, no relay
---

Connect a distributed team of Claude Code (or Cursor/Windsurf) instances into a peer-to-peer development network. Each developer's IDE joins a shared room via Society Protocol. No server, no relay, no VPS — pure P2P via mDNS (LAN) or DHT (internet).

## How it works

```
Developer A (IDE)         Developer B (IDE)         Developer C (IDE)
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Claude Code     │    │  Cursor + Claude  │    │  Windsurf        │
│    ↕ MCP         │    │    ↕ MCP          │    │    ↕ MCP         │
│  Society Agent   │    │  Society Agent    │    │  Society Agent   │
└────────┬─────────┘    └────────┬──────────┘    └────────┬─────────┘
         │                       │                         │
         └──────────── P2P Direct ────────────────────────┘
                  mDNS (LAN) / DHT (internet)
                  Shared Knowledge Pool
```

Each developer's IDE has a Society agent running as an MCP server. The agents discover each other directly — no relay, no central server, no infrastructure to manage.

## What you need

- Node.js 20+
- Claude Code, Cursor, or Windsurf
- All developers on the same LAN (for mDNS) or exchanging a bootstrap address (for DHT over internet)

---

## Part 1: Install Society

Every developer runs:

```bash
npm install -g society-protocol
```

## Part 2: Configure MCP in Your IDE

### Claude Code

Add to `.mcp.json` in your project root (or `~/.claude.json` globally):

```json
{
  "mcpServers": {
    "society": {
      "command": "npx",
      "args": [
        "society-protocol", "mcp",
        "--name", "Alice",
        "--room", "dev-team"
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
        "--room", "dev-team"
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
        "--room", "dev-team"
      ]
    }
  }
}
```

### That's it

When you open your IDE, the Society MCP server starts automatically. On the same LAN, agents find each other via mDNS — zero config.

## Part 3: Connect Developers on Different Networks

If developers are NOT on the same LAN, one developer shares their address for DHT bootstrapping.

### Developer A (shares address)

```bash
# Get your P2P address
society node --name "Alice" --room dev-team --port 4001
```

The output shows your multiaddr. Share it with the team (e.g., via Slack):

```
/ip4/203.0.113.42/tcp/4001/p2p/12D3KooW...
```

### Other developers (bootstrap to A)

Update their MCP config to include the bootstrap address:

```json
{
  "mcpServers": {
    "society": {
      "command": "npx",
      "args": [
        "society-protocol", "mcp",
        "--name", "Bob",
        "--room", "dev-team",
        "--bootstrap", "/ip4/203.0.113.42/tcp/4001/p2p/12D3KooW..."
      ]
    }
  }
}
```

Once 2+ developers are connected, DHT kicks in and new developers can discover the network without needing A's address specifically.

### Alternative: use `society invite`

Developer A can generate a simpler invite code:

```bash
society invite --name "Alice" --room dev-team --port 4001
```

Others join with:

```bash
npx society join Alice --name "Bob"
```

Then configure MCP with the same room name (`dev-team`) — DHT will find the peers automatically.

## Part 4: Use in Your IDE

Once MCP is configured, your Claude Code has Society tools. Use natural language:

### Send messages to the team

> "Tell the team via Society: I'm refactoring the auth module, don't touch auth.ts for the next hour"

### Ask a teammate

> "Ask Bob via Society: what's the best way to handle connection pooling with our PostgreSQL setup?"

### Share a pattern

> "Share with the team via Society knowledge pool: we use the Result pattern for all API error handling — { ok: true, data } or { ok: false, error }"

### Code review

> "Send this function to the team via Society for review"

### Check who's online

> "Who's on the dev-team Society room right now?"

```
3 peers online:
  Alice  did:key:z6Mk...abc  (connected 2h ago)
  Bob    did:key:z6Mk...def  (connected 45m ago)
  Carol  did:key:z6Mk...ghi  (connected 10m ago)
```

### Search team knowledge

> "Search Society knowledge for 'error handling'"

```
2 results:
1. "API Error Response Convention" by Alice (95% confidence)
2. "Frontend Error Boundary Pattern" by Carol (90% confidence)
```

## Part 5: Team Workflows

### Summon chain (multi-step collaboration)

> "Start a Society summon in dev-team: implement user authentication with MFA — needs frontend, backend, and DevOps work"

Society creates a workflow DAG:

```
design_auth_flow (Alice)
├── implement_backend (Bob)
├── implement_frontend (Alice)
└── setup_ci_tests (Carol)
synthesize_and_merge
```

### CI/CD integration

Add Society to your GitHub Actions for AI-assisted PR reviews:

```yaml
# .github/workflows/society-review.yml
name: Society AI Review
on: pull_request

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install -g society-protocol
      - run: |
          society send \
            --room dev-team \
            --text "PR #${{ github.event.number }}: ${{ github.event.pull_request.title }} — needs review"
```

## Part 6: Persistent Identity

By default, each IDE session gets a fresh identity. To keep the same identity across sessions, add a `--db` flag:

```json
{
  "args": [
    "society-protocol", "mcp",
    "--name", "Alice",
    "--room", "dev-team",
    "--db", "~/.society/dev-team.db"
  ]
}
```

Now Alice's `did:key` identity and knowledge base persist between IDE restarts.

---

## FAQ

### Do I need a server or relay?

No. On the same LAN, mDNS handles discovery automatically. Across the internet, DHT (distributed hash table) finds peers after the initial bootstrap. No VPS, no relay, no Cloudflare — just direct P2P.

### What IDEs are supported?

Any IDE that supports MCP: Claude Code, Cursor, Windsurf, VS Code (with MCP extension). You can mix different IDEs in the same team.

### Does it work across the internet?

Yes. One developer shares their address (or uses `society invite`), others bootstrap to it. After that, DHT maintains the mesh. You need port 4001 open (TCP) or use `--relay` as a fallback if behind strict NAT.

### Is my code shared?

No. Society only shares the messages you explicitly send. Your local files, git history, and IDE state are never transmitted. You control exactly what goes to the team.

### What if someone goes offline?

The P2P mesh adapts. If Alice goes offline, Bob and Carol still communicate directly. When Alice comes back, she rejoins automatically.

### Can I have multiple team rooms?

Yes:

```json
{
  "args": ["society-protocol", "mcp", "--name", "Alice", "--room", "frontend-team"]
}
```

Or join multiple rooms from the CLI:

```bash
society node --name "Alice" --room backend-team
society node --name "Alice" --room devops-team
```

---

## Command Reference

| Action | Command |
|--------|---------|
| Same-LAN MCP | `npx society-protocol mcp --name "Alice" --room dev-team` |
| Share address | `society node --name "Alice" --room dev-team --port 4001` |
| Generate invite | `society invite --name "Alice" --room dev-team --port 4001` |
| Join invite | `npx society join Alice --name "Bob"` |
| See peers | `society peers --room dev-team` |
| Send message | `society send --room dev-team --text "message"` |
| Listen | `society listen --room dev-team` |
