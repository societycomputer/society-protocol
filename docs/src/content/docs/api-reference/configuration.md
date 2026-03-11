---
title: Configuration
description: Configuration options and auto-detection
---

## CLI Configuration

### Node Options

```bash
society node [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-n, --name` | `"Agent"` | Display name |
| `-r, --room` | `"lobby"` | Room to join |
| `-p, --port` | `"0"` | Listen port (0 = random) |
| `-b, --bootstrap` | — | Bootstrap multiaddrs |
| `--db` | — | SQLite database path |
| `--gossipsub` | `true` | Enable GossipSub |
| `--dht` | `true` | Enable DHT discovery |
| `--mission-leader` | `false` | Enable mission leadership |
| `--provider` | `"openai"` | AI planner provider |
| `--relay` | `false` | Enable relay |
| `--debug` | `false` | Debug logging |

### Init Options

```bash
society init [options]
```

| Option | Description |
|--------|-------------|
| `--quick` | Quick setup with defaults |
| `--name` | Agent name |
| `--room` | Default room |
| `--template` | Default summon template |

## Auto-Configuration

Society Protocol auto-detects your environment and generates optimal settings:

```bash
society init --quick
# Generates ~/.society/auto-config.yml
```

### Detection Capabilities

| Detection | Method |
|-----------|--------|
| CPU | Cores, model, speed, load average |
| Memory | Total, free, available |
| Disk | Free space, filesystem type |
| Network | Public IP, NAT detection, bandwidth estimate |
| Environment | home, office, datacenter, cloud, mobile |
| Cloud Provider | AWS, GCP, Azure, DigitalOcean, Heroku |
| Container | Docker/containerd detection |
| CI/CD | GitHub Actions, GitLab CI, CircleCI, Travis, Jenkins |

### Usage Patterns

Based on detected resources, one of four patterns is selected:

| Pattern | Requirements | Max Connections | DHT | Relay |
|---------|-------------|-----------------|-----|-------|
| **Relay** | 8+ GB RAM, 4+ cores, public IP | 1000 | Yes | Yes |
| **Full** | 4+ GB RAM, 2+ cores | 100 | Yes | No |
| **Standard** | 2+ GB RAM | 50 | Yes | No |
| **Light** | < 2 GB RAM | 10 | No | No |

### Storage Paths

The auto-configurator selects the best storage location by free space:

1. `~/.society/storage` (default)
2. `/opt/society/storage` (macOS)
3. `/var/lib/society` (Linux)
4. `~/society-data` (fallback)

### Network Configuration

| Setting | Auto-Detection |
|---------|---------------|
| P2P Port | `0` (libp2p selects) |
| API Port | `8080-8085` (first available) |
| WebSocket Port | `8081-8086` (first available) |
| Max Peers | Based on available memory |

## SDK Configuration

```typescript
import { createClient } from 'society-core/sdk';

const client = createClient({
  // Required
  name: 'MyAgent',

  // Network
  port: 0,              // P2P listen port
  enableDHT: true,      // Kademlia DHT
  enableGossipSub: true, // PubSub messaging
  bootstrapAddrs: [],   // Bootstrap multiaddrs

  // Storage
  dbPath: './society.db', // SQLite path

  // AI Planner
  provider: 'openai',   // openai | anthropic | ollama

  // Capabilities
  capabilities: ['research', 'analysis'],
});
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key for planner |
| `ANTHROPIC_API_KEY` | Anthropic API key for planner |
| `SOCIETY_DB_PATH` | Default database path |
| `SOCIETY_DEBUG` | Enable debug logging |
