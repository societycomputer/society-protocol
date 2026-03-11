/**
 * Spawns multiple Society agents that join the same room,
 * so the dashboard can display a populated network.
 *
 * Usage: npx tsx scripts/test-agents.ts
 */

import { createClient, type SocietyClient } from 'society-core/sdk';

const ROOM = 'dev';

interface AgentSpec {
  name: string;
  specialties: string[];
  delay: number; // ms before joining
}

const AGENTS: AgentSpec[] = [
  { name: 'DockerBot',    specialties: ['containers', 'devops', 'kubernetes'], delay: 0 },
  { name: 'OllamaAgent',  specialties: ['llm', 'inference', 'embeddings'],    delay: 500 },
  { name: 'ResearchBot',  specialties: ['papers', 'arxiv', 'summarization'], delay: 1000 },
  { name: 'CodeReviewer', specialties: ['typescript', 'rust', 'code-review'], delay: 1500 },
  { name: 'SecurityBot',  specialties: ['audit', 'vulnerability', 'crypto'],  delay: 2000 },
];

const clients: SocietyClient[] = [];

async function spawnAgent(spec: AgentSpec, port: number): Promise<SocietyClient> {
  if (spec.delay > 0) {
    await new Promise(r => setTimeout(r, spec.delay));
  }

  const client = await createClient({
    identity: { name: spec.name },
    storage: { path: undefined }, // in-memory
    network: {
      port,
      enableGossipsub: true,
      enableDht: true,
    },
  });

  await client.joinRoom(ROOM);
  const identity = client.getIdentity();
  console.log(`[${spec.name}] Online — DID: ${identity.did}, PeerId: ${client.getPeerId()}`);

  return client;
}

async function main() {
  console.log(`\nSpawning ${AGENTS.length} test agents in room "${ROOM}"...\n`);

  let port = 9100;
  for (const spec of AGENTS) {
    try {
      const client = await spawnAgent(spec, port);
      clients.push(client);
      port += 2; // each node uses port and port+1 (tcp + ws)
    } catch (err: any) {
      console.error(`[${spec.name}] Failed to start: ${err.message}`);
    }
  }

  console.log(`\n${clients.length} agents online. Press Ctrl+C to stop.\n`);

  // Periodic activity: summon a chain every 30s
  const interval = setInterval(async () => {
    if (clients.length === 0) return;
    const leader = clients[0];
    try {
      const chain = await leader.summon({
        goal: `Auto-test task at ${new Date().toISOString()}`,
        roomId: ROOM,
      });
      console.log(`[Activity] Summoned chain: ${chain.id}`);
    } catch (err: any) {
      // Planner may not be configured — that's fine
      if (!err.message.includes('planner')) {
        console.error(`[Activity] Summon failed: ${err.message}`);
      }
    }
  }, 30_000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down agents...');
    clearInterval(interval);
    for (const c of clients) {
      try { await c.disconnect(); } catch {}
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
