/**
 * Society Protocol — Hello World
 *
 * Two agents (Alice and Bob) meet in a P2P room,
 * open a Chain of Collaboration, and share knowledge.
 *
 * Run: npx tsx index.ts
 */

import { createClient } from 'society-protocol';

async function main() {
  console.log('=== Society Protocol — Hello World ===\n');

  // ── 1. Create two agents ────────────────────────────────────────
  console.log('Starting Alice and Bob...');
  const alice = await createClient({ identity: { name: 'Alice' } });
  const bob   = await createClient({ identity: { name: 'Bob'   } });

  console.log('Alice DID:', alice.getDid());
  console.log('Bob   DID:', bob.getDid());

  // ── 2. Join the same room ───────────────────────────────────────
  const ROOM = 'hello-world';
  await alice.joinRoom(ROOM);
  await bob.joinRoom(ROOM);
  console.log(`\nBoth joined room: ${ROOM}`);

  // ── 3. Listen for messages on Bob's side ───────────────────────
  bob.on('message', (roomId: string, msg: any) => {
    if (msg.body?.text) {
      console.log(`Bob received in [${roomId}]: "${msg.body.text}"`);
    }
  });

  // ── 4. Alice sends a message ────────────────────────────────────
  await alice.sendMessage(ROOM, { text: 'Hello from Alice! 👋' });

  // small delay so Bob's listener fires before we continue
  await new Promise(r => setTimeout(r, 100));

  // ── 5. Open a Chain of Collaboration ───────────────────────────
  console.log('\nAlice summons a Chain of Collaboration...');
  const chain = await alice.summon({
    roomId: ROOM,
    goal:   'Write a one-line poem about P2P networks',
    steps: [
      { title: 'Compose poem', description: 'Write the poem', kind: 'generation' },
      { title: 'Review poem',  description: 'Check for quality', kind: 'review'     },
    ],
  });
  console.log('Chain opened:', chain.id);
  console.log('Steps:', chain.steps.map((s: any) => s.title).join(' → '));

  // ── 6. Bob submits the first step ──────────────────────────────
  const [composeStep] = chain.steps;
  await bob.submitStep(chain.id, composeStep.id, {
    result: '"Every packet finds its peer, across the endless mesh we share."',
    artifacts: [],
  });
  console.log('\nBob submitted step:', composeStep.title);

  // ── 7. Alice reviews and completes ─────────────────────────────
  const updatedChain = await alice.getChain(chain.id);
  const reviewStep   = updatedChain.steps[1];
  await alice.submitStep(chain.id, reviewStep.id, {
    result: 'Approved — beautiful imagery.',
    artifacts: [],
  });
  console.log('Alice reviewed and approved.');

  // ── 8. Query peers ─────────────────────────────────────────────
  const peers = await alice.getPeers(ROOM);
  console.log(`\nPeers in room: ${peers.length}`);
  for (const p of peers) {
    console.log(' •', p.name ?? p.did);
  }

  // ── 9. Clean up ────────────────────────────────────────────────
  await alice.disconnect();
  await bob.disconnect();
  console.log('\nDone! ✓');
}

main().catch(console.error);
