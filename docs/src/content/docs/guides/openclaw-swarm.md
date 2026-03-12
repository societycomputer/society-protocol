---
title: "Tutorial: OpenClaw Agent Swarm"
description: Deploy a swarm of AI-powered legal agents that collaborate on contract analysis, compliance, and research
---

Build and deploy a swarm of specialized AI agents that collaborate on legal tasks — contract review, compliance checking, IP analysis, and research synthesis. Each agent runs its own Society node with a dedicated LLM, coordinating via P2P.

## Architecture Overview

```
┌─────────────────┐  ┌──────────────────┐  ┌───────────────────┐
│ LegalResearcher  │  │ ContractAnalyst   │  │ ComplianceReviewer │
│ (case law, prec.)│  │ (clauses, risks)  │  │ (GDPR, SOX, HIPAA)│
└────────┬─────────┘  └────────┬──────────┘  └────────┬──────────┘
         │                     │                       │
         └──────────┬──────────┴───────────────────────┘
                    │
            ┌───────▼────────┐
            │  P2P GossipSub  │
            │  Knowledge Pool  │
            └────────────────┘
```

## Prerequisites

- Node.js 20+
- Ollama with a capable model (`qwen3:8b` or better)
- 4GB+ RAM (for 4 agents + LLM)

## Step 1: Project Setup

```bash
mkdir openclaw-swarm && cd openclaw-swarm
npm init -y
npm install society-protocol
```

```bash
# Install and pull model
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3:8b
```

## Step 2: Define Agent Roles

Create `agents.json` with your swarm configuration:

```json
{
  "room": "legal-swarm",
  "model": "qwen3:8b",
  "agents": [
    {
      "name": "LegalResearcher",
      "role": "legal-research",
      "capabilities": ["case-law", "precedent-analysis", "statute-lookup"],
      "systemPrompt": "You are a legal researcher specializing in case law and precedent analysis. Provide citations and structured legal arguments."
    },
    {
      "name": "ContractAnalyst",
      "role": "contract-analysis",
      "capabilities": ["contract-review", "clause-extraction", "risk-assessment"],
      "systemPrompt": "You are a contract analyst. Identify key clauses, obligations, risks, and suggest improvements."
    },
    {
      "name": "ComplianceReviewer",
      "role": "compliance",
      "capabilities": ["regulatory-compliance", "gdpr", "sox", "hipaa"],
      "systemPrompt": "You are a compliance specialist. Check documents against regulatory frameworks (GDPR, SOX, HIPAA) and flag violations."
    },
    {
      "name": "IPSpecialist",
      "role": "intellectual-property",
      "capabilities": ["patent-analysis", "trademark", "copyright"],
      "systemPrompt": "You are an intellectual property specialist. Analyze patents, trademarks, and copyright claims."
    }
  ]
}
```

## Step 3: Create the Swarm Coordinator

Create `swarm.js`:

```javascript
import { createClient } from 'society-protocol';
import { readFileSync } from 'fs';

const config = JSON.parse(readFileSync('./agents.json', 'utf-8'));
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// ─── Create all agents ──────────────────────────────────────────

const clients = new Map();

async function startSwarm() {
  console.log('Starting OpenClaw Agent Swarm...\n');

  for (const agentDef of config.agents) {
    const client = await createClient({
      identity: { name: agentDef.name },
      storage: { path: ':memory:' },
      network: {
        listenAddrs: ['/ip4/0.0.0.0/tcp/0'],
        enableGossipsub: true,
        enableMdns: true,
        enableDht: true,
      },
    });

    await client.joinRoom(config.room);
    clients.set(agentDef.name, { client, def: agentDef });
    console.log(`  ✓ ${agentDef.name} online`);
  }

  // Create shared knowledge space
  const lead = clients.get('LegalResearcher').client;
  const space = await lead.createKnowledgeSpace(
    'Legal Knowledge Pool',
    'Shared legal research and compliance findings',
    'team'
  );

  return { space, lead };
}

// ─── Analyze a document ─────────────────────────────────────────

async function analyzeDocument(document, description, spaceId) {
  console.log(`\n═══ Analyzing: ${description} ═══\n`);

  const results = [];

  for (const [name, { client, def }] of clients) {
    if (name === 'LegalResearcher') continue; // Researcher synthesizes

    console.log(`  [${name}] Analyzing...`);

    const analysis = await queryOllama(
      `${def.systemPrompt}\n\nDocument:\n${document}\n\n` +
      `Provide 3-5 key findings from your area of expertise.`
    );

    results.push({ agent: name, role: def.role, analysis });

    // Store as knowledge card
    await client.createKnowledgeCard(spaceId, 'finding',
      `${name}: ${description}`, analysis,
      { tags: [def.role], domain: def.capabilities, confidence: 0.9 }
    );

    // Share via P2P
    await client.sendMessage(config.room, JSON.stringify({
      type: 'analysis_complete', agent: name, summary: analysis.slice(0, 200),
    }));

    console.log(`  [${name}] ✓ Complete`);
  }

  // Synthesize
  console.log(`\n  [LegalResearcher] Synthesizing...`);
  const lead = clients.get('LegalResearcher');
  const synthesis = await queryOllama(
    `${lead.def.systemPrompt}\n\nSynthesize these specialist analyses:\n\n` +
    results.map(r => `[${r.agent}]\n${r.analysis}`).join('\n\n') +
    `\n\nProvide a unified report with actionable recommendations.`
  );

  console.log(`\n═══ Final Report ═══\n${synthesis}\n`);
  return { results, synthesis };
}

// ─── Ollama helper ──────────────────────────────────────────────

async function queryOllama(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model, prompt, stream: false,
      options: { temperature: 0.7, num_predict: 400 },
    }),
  });
  return (await res.json()).response || 'No response';
}

// ─── Main ───────────────────────────────────────────────────────

const { space } = await startSwarm();

// Analyze a sample contract
const contract = readFileSync(process.argv[2] || './sample-contract.txt', 'utf-8');
await analyzeDocument(contract, 'Contract Review', space.id);

// Cleanup
for (const { client } of clients.values()) await client.disconnect().catch(() => {});
```

## Step 4: Create a Sample Document

Create `sample-contract.txt`:

```
SERVICE AGREEMENT

1. SCOPE: Provider shall deliver AI-powered legal analysis services
   to Client on a subscription basis.

2. DATA HANDLING: All client data will be processed and stored on
   Provider's servers located in the United States. Provider may use
   anonymized data for model training purposes.

3. LIABILITY: Provider's total liability shall not exceed fees paid
   in the prior 12 months. Provider is not liable for any indirect,
   consequential, or punitive damages.

4. TERM: This agreement auto-renews annually unless terminated with
   30 days written notice prior to renewal date.

5. INTELLECTUAL PROPERTY: All outputs generated by the AI system,
   including analyses and recommendations, are owned by Provider.
   Client receives a limited, non-exclusive license to use outputs.

6. GOVERNING LAW: This agreement is governed by the laws of the
   State of Delaware, United States.
```

## Step 5: Run the Swarm

```bash
node swarm.js ./sample-contract.txt
```

Expected output:

```
Starting OpenClaw Agent Swarm...

  ✓ LegalResearcher online
  ✓ ContractAnalyst online
  ✓ ComplianceReviewer online
  ✓ IPSpecialist online

═══ Analyzing: Contract Review ═══

  [ContractAnalyst] Analyzing...
  [ContractAnalyst] ✓ Complete
  [ComplianceReviewer] Analyzing...
  [ComplianceReviewer] ✓ Complete
  [IPSpecialist] Analyzing...
  [IPSpecialist] ✓ Complete

  [LegalResearcher] Synthesizing...

═══ Final Report ═══
[Unified analysis with recommendations from all specialists]
```

## Step 6: Deploy for Production

### Persistent Agents with Real Storage

For production, use persistent databases so agents retain knowledge:

```javascript
const client = await createClient({
  identity: { name: agentDef.name },
  storage: { path: `./data/${agentDef.name.toLowerCase()}.db` },  // persistent
  network: {
    bootstrapPeers: [process.env.RELAY_ADDR],  // relay for remote access
    enableGossipsub: true,
    enableMdns: false,
    enableDht: true,
  },
});
```

### Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  swarm:
    image: node:20-slim
    working_dir: /app
    command: node swarm.js /documents/input.txt
    volumes:
      - ./:/app
      - ./data:/app/data
      - ./documents:/documents
    environment:
      OLLAMA_URL: "http://ollama:11434"
    depends_on: [ollama]

  ollama:
    image: ollama/ollama
    volumes: [ollama-models:/root/.ollama]
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

volumes:
  ollama-models:
```

```bash
docker compose up -d ollama
docker exec ollama ollama pull qwen3:8b
docker compose run swarm
```

### As an API Service

Wrap the swarm as an HTTP endpoint:

```javascript
import express from 'express';
const app = express();
app.use(express.json());

const { space } = await startSwarm();

app.post('/analyze', async (req, res) => {
  const { document, description } = req.body;
  const result = await analyzeDocument(document, description, space.id);
  res.json(result);
});

app.listen(3000, () => console.log('Legal analysis API on :3000'));
```

## Step 7: Add More Specialists

Extend `agents.json` with additional roles:

```json
{
  "name": "EmploymentLawyer",
  "role": "employment-law",
  "capabilities": ["labor-law", "termination", "discrimination", "benefits"],
  "systemPrompt": "You are an employment law specialist. Analyze for labor law compliance, employee protections, and benefits obligations."
},
{
  "name": "DataPrivacyOfficer",
  "role": "data-privacy",
  "capabilities": ["gdpr", "ccpa", "lgpd", "data-processing"],
  "systemPrompt": "You are a data privacy officer. Analyze for GDPR, CCPA, LGPD compliance. Check data processing agreements, retention policies, and cross-border transfers."
}
```

## Step 8: Query the Knowledge Pool

After analyzing multiple documents, query accumulated findings:

```javascript
// Search by tag
const gdprFindings = lead.queryKnowledgeCards({
  spaceId: space.id,
  tags: ['gdpr'],
});
console.log(`GDPR findings: ${gdprFindings.length}`);

// Get the full knowledge graph
const graph = lead.getKnowledgeGraph(space.id);
console.log(`Knowledge: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
```

## Production Checklist

- [ ] Persistent storage for each agent (`./data/*.db`)
- [ ] GPU-enabled Ollama for faster inference
- [ ] TLS-enabled relay for remote agent connections
- [ ] Rate limiting on the API endpoint
- [ ] Logging: pipe agent output to structured logger (pino/winston)
- [ ] Backup: snapshot SQLite databases daily
- [ ] Model: evaluate `llama3.1:70b` or `qwen3:32b` for higher-quality legal analysis
