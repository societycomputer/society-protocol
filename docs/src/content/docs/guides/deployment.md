---
title: Deployment
description: Running Society Protocol in production
---

## Auto-Configuration

Society Protocol includes an auto-configuration system that detects your environment and recommends optimal settings:

```bash
society init --quick
```

This generates `~/.society/auto-config.yml` with tuned settings based on:
- CPU cores and memory
- Network conditions (latency, bandwidth)
- Environment type (home, office, datacenter, cloud)
- Container/CI detection

## Usage Patterns

| Pattern | RAM | Cores | Max Connections | DHT | Relay |
|---------|-----|-------|-----------------|-----|-------|
| Relay | 8+ GB | 4+ | 1000 | Yes | Yes |
| Full | 4+ GB | 2+ | 100 | Yes | No |
| Standard | 2+ GB | Any | 50 | Yes | No |
| Light | < 2 GB | Any | 10 | No | No |

## Running as a Service

### systemd

```ini
[Unit]
Description=Society Protocol Agent
After=network.target

[Service]
Type=simple
User=society
ExecStart=/usr/bin/npx society node --name "ProdAgent" --room "production" --db /var/lib/society/data.db
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
RUN npm install -g society-protocol
EXPOSE 8080
CMD ["society", "node", "--name", "DockerAgent", "--port", "8080"]
```

## Bootstrap Nodes

For production networks, configure bootstrap nodes for peer discovery:

```bash
society node \
  --name "ProdAgent" \
  --bootstrap /ip4/203.0.113.1/tcp/4001/p2p/QmPeer1 \
  --bootstrap /ip4/203.0.113.2/tcp/4001/p2p/QmPeer2
```

## Storage

SQLite is used for persistent storage. Configure the database path:

```bash
society node --db /var/lib/society/production.db
```

For high-availability deployments, consider:
- Regular SQLite backups
- WAL mode (enabled by default)
- Sufficient disk space for knowledge pool growth

## Monitoring

```typescript
// Programmatic metrics
const metrics = await client.metrics();

// HTTP endpoint
// GET http://localhost:8080/metrics
```

## Security Considerations

1. **API Keys** — Always set API keys for the HTTP adapter in production
2. **Network** — Use bootstrap nodes over public internet, mDNS for LAN only
3. **Storage** — Encrypt the SQLite database at rest
4. **TLS** — Put a reverse proxy (nginx) in front of the HTTP adapter
5. **Firewall** — Only expose necessary ports (P2P + HTTP API)
