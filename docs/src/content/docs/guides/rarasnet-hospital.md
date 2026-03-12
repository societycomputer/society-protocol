---
title: "Tutorial: RarasNet Hospital Network"
description: Deploy a medical collaboration network connecting real hospitals across different cities for rare disease diagnosis
---

A step-by-step guide to deploying a **RarasNet** — a decentralized medical collaboration network where hospital agents share cases, exchange diagnostic insights, and build a shared knowledge base. Each hospital runs its own Society agent with a persistent identity, connecting via internet relay nodes.

## Architecture Overview

```
Hospital A (São Paulo)  ──┐
Hospital B (Rio)        ───┤── Cloud Relay ── Dashboard/Observer
Hospital C (Brasília)   ───┘
Hospital D (Buenos Aires) ─┘
```

Each hospital agent:
- Has a persistent `did:key` Ed25519 identity
- Connects via WebSocket to a cloud relay (no mDNS over internet)
- Joins shared rooms for case discussion
- Uses local Ollama for AI-assisted diagnostics
- Shares CRDT-synced knowledge cards across all nodes

## Prerequisites

- Node.js 20+ on each hospital server
- A cloud VPS for the relay node (2GB RAM, any provider)
- Ollama installed at each hospital (optional, for AI analysis)
- Domain name with TLS cert (for production)

## Step 1: Install Society Protocol

On every machine (relay + hospitals):

```bash
npm install -g society-protocol
```

Or add to a project:

```bash
mkdir rarasnet && cd rarasnet
npm init -y
npm install society-protocol
```

## Step 2: Deploy the Relay Node

The relay is a lightweight Society node that brokers connections between hospitals behind NATs/firewalls. Deploy it on a cloud VPS with a public IP.

### Option A: Direct

```bash
# On your cloud VPS (e.g., relay.rarasnet.org)
npx society relay \
  --port 9090 \
  --ws \
  --name "RarasNet-Relay" \
  --db /var/lib/rarasnet/relay.db
```

### Option B: Docker

```dockerfile
# Dockerfile.relay
FROM node:20-slim
RUN npm install -g society-protocol
EXPOSE 9090
CMD ["npx", "society", "relay", "--port", "9090", "--ws", "--name", "RarasNet-Relay", "--db", "/data/relay.db"]
```

```bash
docker build -t rarasnet-relay -f Dockerfile.relay .
docker run -d \
  --name rarasnet-relay \
  -p 9090:9090 \
  -v rarasnet-relay-data:/data \
  rarasnet-relay
```

### Option C: systemd Service

```ini
# /etc/systemd/system/rarasnet-relay.service
[Unit]
Description=RarasNet Relay Node
After=network.target

[Service]
Type=simple
User=rarasnet
ExecStart=/usr/bin/npx society relay --port 9090 --ws --name "RarasNet-Relay" --db /var/lib/rarasnet/relay.db
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /bin/false rarasnet
sudo mkdir -p /var/lib/rarasnet
sudo chown rarasnet:rarasnet /var/lib/rarasnet
sudo systemctl enable --now rarasnet-relay
```

### Add TLS (Production)

Use Caddy or nginx as a reverse proxy:

```
# /etc/caddy/Caddyfile
relay.rarasnet.org {
    reverse_proxy localhost:9090
}
```

Now your relay is available at `wss://relay.rarasnet.org`.

## Step 3: Note the Relay Multiaddr

After starting the relay, note its multiaddress:

```bash
npx society info --relay
# Output: /dns4/relay.rarasnet.org/tcp/443/wss/p2p/12D3KooW...
```

This address is what hospital nodes use to bootstrap.

## Step 4: Deploy Hospital Agents

Each hospital runs a Society agent with its own config. Create a file `hospital-agent.js`:

```javascript
import { createClient } from 'society-protocol';

const agent = await createClient({
  identity: { name: process.env.HOSPITAL_NAME },
  storage: { path: process.env.DB_PATH || './hospital.db' },
  network: {
    listenAddrs: ['/ip4/0.0.0.0/tcp/0/ws'],
    bootstrapPeers: [process.env.RELAY_ADDR],
    enableGossipsub: true,
    enableDht: true,
    enableMdns: false,  // No mDNS over internet
  },
});

await agent.joinRoom('rarasnet');
console.log(`${process.env.HOSPITAL_NAME} online: ${agent.getIdentity().did}`);

// Listen for cases from other hospitals
agent.on('message', async (data) => {
  const text = typeof data.body?.text === 'string'
    ? data.body.text : String(data.text || '');
  console.log(`[${data.fromName || data.from}] ${text.slice(0, 100)}`);
});

// Keep alive
process.on('SIGINT', async () => {
  await agent.disconnect();
  process.exit(0);
});
```

Start each hospital:

```bash
# Hospital São Paulo
HOSPITAL_NAME="HC-FMUSP" \
RELAY_ADDR="/dns4/relay.rarasnet.org/tcp/443/wss" \
DB_PATH="./data/hc-fmusp.db" \
node hospital-agent.js

# Hospital Rio de Janeiro
HOSPITAL_NAME="Hospital-Fiocruz" \
RELAY_ADDR="/dns4/relay.rarasnet.org/tcp/443/wss" \
DB_PATH="./data/fiocruz.db" \
node hospital-agent.js

# Hospital Buenos Aires
HOSPITAL_NAME="Hospital-Italiano-BA" \
RELAY_ADDR="/dns4/relay.rarasnet.org/tcp/443/wss" \
DB_PATH="./data/italiano-ba.db" \
node hospital-agent.js
```

## Step 5: Add Ollama for AI-Assisted Diagnostics

Install Ollama on each hospital server:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3:8b
```

Add the AI analysis function to your agent:

```javascript
async function analyzeCase(caseData) {
  const res = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3:8b',
      prompt: `You are a medical AI assistant. Analyze:\n` +
        `Patient: ${caseData.age}y/${caseData.sex}\n` +
        `Symptoms: ${caseData.symptoms.join(', ')}\n` +
        `Provide differential diagnosis and next steps.`,
      stream: false,
      options: { temperature: 0.7, num_predict: 300 },
    }),
  });
  return (await res.json()).response;
}
```

## Step 6: Share Knowledge Cards

When a hospital discovers a diagnostic insight, share it as a CRDT-synced knowledge card:

```javascript
// Create a shared knowledge space (once)
const space = await agent.createKnowledgeSpace(
  'RarasNet Cases',
  'Rare disease case analyses from the consortium',
  'team'
);

// Share a finding
const card = await agent.createKnowledgeCard(
  space.id,
  'finding',
  'Visceral Leishmaniasis — Atypical Presentation',
  'Patient presented with pancytopenia and hepatosplenomegaly without typical fever pattern. Bone marrow aspirate confirmed Leishmania amastigotes. Key: consider in travelers from endemic areas even without classic presentation.',
  {
    tags: ['leishmaniasis', 'tropical', 'pancytopenia'],
    domain: ['infectious-disease', 'hematology'],
    confidence: 0.92,
    metadata: {
      hospital: 'HC-FMUSP',
      caseId: 'RN-2026-0042',
    },
  }
);
```

Cards sync automatically across all connected hospitals via CRDT.

## Step 7: Docker Compose for Multi-Hospital Deploy

```yaml
# docker-compose.rarasnet.yml
version: '3.8'

services:
  relay:
    image: node:20-slim
    command: npx society relay --port 9090 --ws --db /data/relay.db
    ports: ["9090:9090"]
    volumes: [relay-data:/data]

  hospital-sp:
    image: node:20-slim
    command: node /app/hospital-agent.js
    environment:
      HOSPITAL_NAME: "HC-FMUSP"
      RELAY_ADDR: "/dns4/relay/tcp/9090/ws"
      DB_PATH: "/data/hospital.db"
      OLLAMA_URL: "http://ollama-sp:11434"
    volumes:
      - ./hospital-agent.js:/app/hospital-agent.js
      - hospital-sp-data:/data
    depends_on: [relay]

  hospital-rio:
    image: node:20-slim
    command: node /app/hospital-agent.js
    environment:
      HOSPITAL_NAME: "Hospital-Fiocruz"
      RELAY_ADDR: "/dns4/relay/tcp/9090/ws"
      DB_PATH: "/data/hospital.db"
      OLLAMA_URL: "http://ollama-rio:11434"
    volumes:
      - ./hospital-agent.js:/app/hospital-agent.js
      - hospital-rio-data:/data
    depends_on: [relay]

  ollama-sp:
    image: ollama/ollama
    volumes: [ollama-sp-models:/root/.ollama]

  ollama-rio:
    image: ollama/ollama
    volumes: [ollama-rio-models:/root/.ollama]

volumes:
  relay-data:
  hospital-sp-data:
  hospital-rio-data:
  ollama-sp-models:
  ollama-rio-models:
```

```bash
docker compose -f docker-compose.rarasnet.yml up -d
# Pull models
docker exec ollama-sp ollama pull qwen3:8b
docker exec ollama-rio ollama pull qwen3:8b
```

## Step 8: Deploy the Dashboard (Optional)

The Society dashboard provides a visual map of your hospital network:

```bash
git clone https://github.com/prtknr/society
cd society/dashboard
npm install
SOCIETY_ROOM=rarasnet \
RELAY_ADDR="/dns4/relay.rarasnet.org/tcp/443/wss" \
npm run start
```

Open `http://localhost:4200` to see hospital nodes on the map, live case discussions, and knowledge card flow.

## Step 9: Verify the Network

```bash
# Check connected peers from any hospital
npx society peers --room rarasnet
# Expected: list of all connected hospital agents

# Check knowledge cards
npx society knowledge list --space "RarasNet Cases"
# Expected: all shared case analyses

# Send a test message
npx society send --room rarasnet --text "Test from HC-FMUSP"
```

## Production Checklist

- [ ] Relay node behind TLS reverse proxy (Caddy/nginx)
- [ ] Each hospital has persistent storage (`DB_PATH` on durable volume)
- [ ] Ollama models pulled and tested at each site
- [ ] systemd or Docker restart policies configured
- [ ] Firewall allows WebSocket connections to relay (port 443)
- [ ] Backup strategy for SQLite databases
- [ ] Monitoring: check `agent.getPeers('rarasnet').length` periodically
- [ ] Identity backup: export `did:key` private keys from each DB for disaster recovery

## Scaling

| Hospitals | Relay RAM | Relay CPU | Notes |
|-----------|-----------|-----------|-------|
| 5-10 | 1 GB | 1 core | Single relay sufficient |
| 10-50 | 2 GB | 2 cores | Enable DHT for peer discovery |
| 50-200 | 4 GB | 4 cores | Multiple relay nodes recommended |
| 200+ | 8 GB+ | 8+ cores | Federation: split by region |

For 200+ hospitals, use **federation** to split by region (Americas, Europe, Asia-Pacific) with peering bridges between federation zones. See the [Federation Guide](/guides/federation).
