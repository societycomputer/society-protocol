#!/usr/bin/env node
/**
 * Society Protocol — Knowledge Sharing Example
 *
 * Agents create, link, and query a distributed knowledge base
 * powered by CRDTs (Automerge) — changes sync automatically.
 *
 * Run: node examples/knowledge-sharing.js
 */

import { createClient } from 'society-protocol';

async function main() {
    const agent = await createClient({
        identity: { name: 'Researcher' },
        storage: { path: ':memory:' },
        network: { enableGossipsub: true, enableDht: true },
    });

    // ─── Create Knowledge Space ──────────────────────────────────
    const space = await agent.createKnowledgeSpace(
        'AI Research',
        'Papers and insights on multi-agent AI systems',
        'team'
    );
    console.log(`Knowledge space: ${space.name}`);

    // ─── Add Knowledge Cards ─────────────────────────────────────
    const card1 = await agent.createKnowledgeCard(
        space.id,
        'insight',
        'CRDT-based Knowledge Pools',
        'CRDTs enable conflict-free distributed knowledge bases across P2P networks. Agents can add knowledge independently and sync automatically.',
        {
            tags: ['crdt', 'distributed', 'p2p'],
            domain: ['distributed-systems'],
            confidence: 0.95,
        }
    );
    console.log(`\nCard 1: ${card1.title}`);

    const card2 = await agent.createKnowledgeCard(
        space.id,
        'finding',
        'Multi-Agent Swarm Patterns',
        'Explorer/Worker/Validator roles from SwarmSys research enable effective task distribution. Affinity scoring matches agents to tasks based on history.',
        {
            tags: ['swarm', 'multi-agent', 'roles'],
            domain: ['multi-agent-systems'],
            confidence: 0.88,
        }
    );
    console.log(`Card 2: ${card2.title}`);

    const card3 = await agent.createKnowledgeCard(
        space.id,
        'reference',
        'Society Protocol Architecture',
        'Combines libp2p, Ed25519 did:key, Automerge CRDTs, and DAG-based workflows into a unified multi-agent platform.',
        {
            tags: ['architecture', 'society-protocol'],
            domain: ['systems-design'],
            confidence: 1.0,
        }
    );
    console.log(`Card 3: ${card3.title}`);

    // ─── Link Cards ──────────────────────────────────────────────
    await agent.linkKnowledgeCards(card1.id, card3.id, 'supports', 0.9);
    await agent.linkKnowledgeCards(card2.id, card3.id, 'supports', 0.85);
    console.log(`\nLinked cards to architecture card`);

    // ─── Query ───────────────────────────────────────────────────
    const results = agent.queryKnowledgeCards({
        spaceId: space.id,
        tags: ['distributed'],
    });
    console.log(`\nQuery "distributed": ${results.length} card(s)`);
    for (const card of results) {
        console.log(`  - ${card.title} (confidence: ${(card.confidence * 100).toFixed(0)}%)`);
    }

    // ─── Knowledge Graph ─────────────────────────────────────────
    const graph = agent.getKnowledgeGraph(space.id);
    console.log(`\nKnowledge graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

    await agent.disconnect();
    console.log('\nDone.');
}

main().catch(console.error);
