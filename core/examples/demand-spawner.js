#!/usr/bin/env node
/**
 * Society Protocol — Demand-Driven Agent Spawning Example
 *
 * Automatically analyzes request complexity and routes to the
 * right execution mode: single agent, pool selection, or team spawn.
 *
 * For full Ollama integration, see the integration test:
 *   npm test -- --grep "DemandSpawner"
 *
 * Run: node examples/demand-spawner.js [routing|ollama]
 *
 * Research foundations:
 * - AutoAgents (arXiv:2309.17288) — dynamic role generation
 * - MaAS (arXiv:2502.04180) — per-query architecture sampling
 * - IoA (arXiv:2505.07176) — ephemeral team assembly + dissolution
 * - DAAO (arXiv:2509.11079) — difficulty-aware routing
 */

import { CapabilityRouter } from 'society-protocol';

// ─── Example 1: Capability Routing ──────────────────────────────
// Analyze request complexity and detect required roles — no Ollama needed.

async function routingDemo() {
    const router = new CapabilityRouter();

    const requests = [
        { goal: 'Summarize this text in 3 bullet points' },
        { goal: 'Research the latest papers on distributed consensus algorithms and write a comparison report' },
        { goal: 'Build a REST API for user authentication, implement tests, and review the code for security issues', priority: 'high' },
    ];

    console.log('=== Capability Routing ===\n');
    for (const req of requests) {
        const decision = router.route(req);
        console.log(`Goal: "${req.goal}"`);
        console.log(`  Mode:       ${decision.mode}`);
        console.log(`  Complexity: ${(decision.complexity * 100).toFixed(0)}%`);
        console.log(`  Roles:      ${decision.roles.map(r => r.role).join(', ')}`);
        console.log(`  Max agents: ${decision.maxAgents}`);
        console.log(`  Reason:     ${decision.reason}`);
        console.log();
    }

    // Show detailed role specs for the complex request
    const complex = router.route(requests[2]);
    console.log('=== Detailed Team Composition ===\n');
    for (const role of complex.roles) {
        console.log(`  ${role.role}`);
        console.log(`    Task type:    ${role.taskType}`);
        console.log(`    Capabilities: ${role.capabilities.join(', ')}`);
        console.log(`    Step kind:    ${role.kind}`);
        console.log(`    Priority:     ${role.priority}`);
        console.log();
    }

    console.log('DemandSpawner execution flow:');
    console.log('  1. CapabilityRouter analyzes → spawn-team mode');
    console.log(`  2. Spawn ${complex.roles.length} agents (Ollama/Docker/HTTP)`);
    console.log('  3. Create Chain of Collaboration DAG');
    console.log('  4. Execute: researcher → coder → reviewer');
    console.log('  5. Collect results, dissolve ephemeral agents');
}

// ─── Example 2: Ollama Direct Call ──────────────────────────────
// Call Ollama directly — the same pattern DemandSpawner uses internally.
// Requires: ollama serve && ollama pull qwen3:1.7b

async function ollamaDemo() {
    console.log('=== Ollama Agent ===\n');

    const router = new CapabilityRouter();
    const decision = router.route({ goal: 'Explain what a merkle tree is in 2 sentences' });
    console.log(`Routing: ${decision.mode} (${(decision.complexity * 100).toFixed(0)}% complexity)`);
    console.log(`Role: ${decision.roles[0].role}\n`);

    const url = process.env.OLLAMA_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'qwen3:1.7b';

    console.log(`Calling ${model}...`);
    const response = await fetch(`${url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            prompt: `You are a specialized AI agent with the role: ${decision.roles[0].role}\n\nGoal: Explain what a merkle tree is in 2 sentences. Be concise.`,
            stream: false,
        }),
    });

    if (!response.ok) {
        console.error(`Ollama error: ${response.status}. Is Ollama running? Try: ollama serve`);
        return;
    }

    const data = await response.json();
    console.log(`\nResponse:\n${data.response}`);
}

// ─── Run ─────────────────────────────────────────────────────────
const example = process.argv[2] || 'routing';

const examples = { routing: routingDemo, ollama: ollamaDemo };
const fn = examples[example];
if (fn) {
    fn().catch(console.error);
} else {
    console.log('Usage: node demand-spawner.js [routing|ollama]');
}
