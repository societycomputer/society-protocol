#!/usr/bin/env node
/**
 * Society Protocol — Federation Example
 *
 * Connect separate agent networks via federation peering.
 * Like Matrix federation — independent networks can share
 * rooms, knowledge, and workflows with governance policies.
 *
 * Run: node examples/federation.js
 */

import { createClient } from 'society-protocol';

async function main() {
    // Two independent networks
    const orgA = await createClient({
        identity: { name: 'Org-A-Admin' },
        storage: { path: ':memory:' },
        network: { enableGossipsub: true, enableDht: true },
    });

    const orgB = await createClient({
        identity: { name: 'Org-B-Admin' },
        storage: { path: ':memory:' },
        network: { enableGossipsub: true, enableDht: true },
    });

    // ─── Create Federations ──────────────────────────────────────

    const fedA = await orgA.createFederation(
        'Research Lab Alpha',
        'AI research team focused on NLP',
        'private'
    );
    console.log(`Federation A: ${fedA.name}`);

    const fedB = await orgB.createFederation(
        'Security Team Beta',
        'Security auditing and code review',
        'private'
    );
    console.log(`Federation B: ${fedB.name}`);

    // ─── Join Federations ────────────────────────────────────────

    await orgA.joinFederation(fedA.id);
    await orgB.joinFederation(fedB.id);
    console.log(`\nBoth admins joined their federations`);

    // ─── List Federations ────────────────────────────────────────

    const myFeds = orgA.listFederations();
    console.log(`Org-A is in ${myFeds.length} federation(s)`);

    // ─── Request Peering ─────────────────────────────────────────
    // Federation A wants to collaborate with Federation B

    const peering = await orgA.createPeering(
        fedA.id,
        fedB.id,
        {
            maxBridges: 3,
            allowRoomDiscovery: true,
            allowKnowledgeSync: true,
        }
    );
    console.log(`\nPeering request: ${peering.id}`);
    console.log(`  Status: ${peering.status}`);

    // Org B accepts the peering
    const accepted = await orgB.acceptPeering(peering.id, 'Happy to collaborate!');
    console.log(`  Accepted: ${accepted.status}`);

    // ─── Open Bridge ─────────────────────────────────────────────
    // Bridge a room from each federation

    await orgA.joinRoom('alpha-research');
    await orgB.joinRoom('beta-reviews');

    const bridge = await orgA.openBridge(
        peering.id,
        'alpha-research',
        'beta-reviews',
        { forwardMessages: true, forwardKnowledge: true }
    );
    console.log(`\nBridge opened: ${bridge.id}`);
    console.log(`  ${bridge.localRoom} ↔ ${bridge.remoteRoom}`);

    // ─── List Bridges ────────────────────────────────────────────

    const bridges = orgA.listBridges();
    console.log(`\nActive bridges: ${bridges.length}`);

    const stats = orgA.getMeshStats();
    console.log(`Mesh stats:`, JSON.stringify(stats, null, 2));

    await orgA.disconnect();
    await orgB.disconnect();
    console.log('\nDone.');
}

main().catch(console.error);
