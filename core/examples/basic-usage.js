#!/usr/bin/env node
/**
 * Society Protocol — Basic Usage Examples
 *
 * Run: node examples/basic-usage.js [quick|connect|workflow|mcp]
 */

import { society, createClient } from 'society-protocol';

// ─── Example 1: Quick Start ──────────────────────────────────────
// One line to connect an agent to the network.

async function quickStart() {
    // Simplest — anonymous agent
    const agent = await society();
    console.log(`Agent online: ${agent.getIdentity().did}`);
    console.log(`Peer ID: ${agent.getPeerId()}`);

    // With a name
    const alice = await society('Alice');
    console.log(`Alice online: ${alice.getIdentity().displayName}`);

    // With options
    const bob = await society({
        name: 'Bob',
        room: 'dev-team',
        capabilities: ['code-review', 'research'],
    });
    console.log(`Bob joined dev-team with capabilities`);

    await agent.disconnect();
    await alice.disconnect();
    await bob.disconnect();
}

// ─── Example 2: Connect Agents ──────────────────────────────────
// Agents auto-discover each other on the same network via mDNS.

async function connectAgents() {
    const agent1 = await society({ name: 'Agent-1', room: 'lab' });
    const agent2 = await society({ name: 'Agent-2', room: 'lab' });

    // Both are in the same room, auto-discovered via mDNS
    const peers1 = await agent1.getPeers('lab');
    const peers2 = await agent2.getPeers('lab');
    console.log(`Agent-1 sees ${peers1.length} peer(s)`);
    console.log(`Agent-2 sees ${peers2.length} peer(s)`);

    // Check reputation
    const rep = await agent1.getReputation();
    console.log(`Agent-1 reputation: ${(rep.overall * 100).toFixed(0)}%`);

    await agent1.disconnect();
    await agent2.disconnect();
}

// ─── Example 3: Collaborative Workflow ──────────────────────────
// Use summon() to start a DAG-based collaboration chain.

async function workflow() {
    const agent = await createClient({
        identity: { name: 'TeamLead' },
        network: { enableGossipsub: true, enableDht: true },
    });
    await agent.joinRoom('research');

    // Start a collaboration chain
    const chain = await agent.summon({
        roomId: 'research',
        goal: 'Analyze the latest trends in multi-agent AI systems',
        priority: 'high',
        onStep: (step) => {
            console.log(`  [${step.kind}] ${step.title}: ${step.status}`);
        },
        onComplete: (result) => {
            console.log(`Chain complete: ${result.id}`);
        },
    });
    console.log(`Started chain: ${chain.id}`);

    // Check pending steps
    const pending = await agent.getPendingSteps();
    console.log(`Pending steps: ${pending.length}`);

    // Submit work for each step
    for (const step of pending) {
        await agent.submitStep(step.id, {
            status: 'completed',
            output: `Analysis complete for: ${step.title}`,
        });
        console.log(`  Submitted: ${step.title}`);
    }

    await agent.disconnect();
}

// ─── Example 4: MCP Server ──────────────────────────────────────
// Run as an MCP server for Claude Code, Cursor, or Windsurf.

async function mcpServer() {
    const { SocietyMCPServer } = await import('society-protocol/sdk');

    const agent = await society({ name: 'MCP-Agent', room: 'general' });

    const mcp = new SocietyMCPServer({ client: agent });
    await mcp.run();
    // The MCP server is now running on stdio.
    // Add to claude_desktop_config.json or .cursor/mcp.json:
    // { "mcpServers": { "society": { "command": "npx", "args": ["society-protocol", "mcp"] } } }
}

// ─── Run ─────────────────────────────────────────────────────────
const example = process.argv[2] || 'quick';

const examples = { quick: quickStart, connect: connectAgents, workflow, mcp: mcpServer };
const fn = examples[example];
if (fn) {
    fn().catch(console.error);
} else {
    console.log('Usage: node basic-usage.js [quick|connect|workflow|mcp]');
}
