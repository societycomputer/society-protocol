#!/usr/bin/env node
/**
 * Society Protocol — Nanobot Agent Swarm
 *
 * Deploy a swarm of lightweight autonomous agents (nanobots) that
 * coordinate via P2P to accomplish complex tasks. Each nanobot is
 * a minimal SocietyClient with a single skill, forming an emergent
 * intelligence through collaboration.
 *
 * Use cases:
 *   - Distributed web scraping & data collection
 *   - Parallel code review across a monorepo
 *   - Multi-source research aggregation
 *   - Infrastructure monitoring fleet
 *
 * Run: node examples/nanobot-swarm.js [scrape|review|monitor]
 */

import { createClient } from 'society-protocol';

// ─── Configuration ──────────────────────────────────────────────

const SWARM_SIZE = parseInt(process.env.SWARM_SIZE || '5', 10);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.MODEL || 'qwen3:1.7b'; // Lightweight model for nanobots

// ─── Nanobot Factory ────────────────────────────────────────────

async function createNanobot(id, role, taskFn) {
    const client = await createClient({
        identity: { name: `nanobot-${id}` },
        storage: { path: ':memory:' },
        network: {
            listenAddrs: ['/ip4/0.0.0.0/tcp/0'],
            enableGossipsub: true,
            enableMdns: true,
            enableDht: false, // Nanobots are ephemeral, no DHT needed
        },
    });

    await client.joinRoom('nanobot-swarm');

    return {
        id,
        role,
        client,
        execute: () => taskFn(client, id),
    };
}

// ─── Example 1: Distributed Research ────────────────────────────

async function researchSwarm() {
    console.log(`\nLaunching Research Nanobot Swarm (${SWARM_SIZE} agents)...\n`);

    const topics = [
        'Latest advances in multi-agent AI coordination 2024-2025',
        'Decentralized identity standards (DID, Verifiable Credentials)',
        'CRDT implementations for distributed systems',
        'libp2p production deployments and performance benchmarks',
        'Zero-knowledge proofs for agent authentication',
    ];

    // Create coordinator
    const coordinator = await createClient({
        identity: { name: 'swarm-coordinator' },
        storage: { path: ':memory:' },
        network: { enableGossipsub: true, enableMdns: true },
    });
    await coordinator.joinRoom('nanobot-swarm');

    // Create knowledge space for aggregation
    const space = await coordinator.createKnowledgeSpace(
        'Research Aggregation',
        'Distributed research findings from nanobot swarm',
        'team'
    );

    // Spawn nanobots
    const nanobots = [];
    for (let i = 0; i < Math.min(SWARM_SIZE, topics.length); i++) {
        const topic = topics[i];
        const bot = await createNanobot(i, 'researcher', async (client, id) => {
            console.log(`  [nanobot-${id}] Researching: ${topic.slice(0, 50)}...`);

            const result = await queryOllama(
                `Research the following topic and provide 3-5 key findings with practical implications:\n\n${topic}`
            );

            // Store findings as knowledge card
            await client.createKnowledgeCard(space.id, 'finding', topic, result, {
                tags: ['research', `nanobot-${id}`],
                confidence: 0.8,
            });

            // Report back via P2P
            await client.sendMessage('nanobot-swarm', JSON.stringify({
                type: 'research_complete',
                botId: id,
                topic,
                summary: result.slice(0, 200),
            }));

            console.log(`  [nanobot-${id}] ✓ Done`);
            return result;
        });
        nanobots.push(bot);
    }

    // Execute all in parallel
    console.log(`\n  Executing ${nanobots.length} research tasks in parallel...\n`);
    const results = await Promise.all(nanobots.map(bot => bot.execute()));

    // Coordinator synthesizes
    console.log(`\n  Coordinator synthesizing findings...\n`);
    const synthesis = await queryOllama(
        `You are a research coordinator. Synthesize these findings into a coherent overview:\n\n` +
        results.map((r, i) => `[Topic ${i + 1}: ${topics[i]}]\n${r}`).join('\n\n') +
        `\n\nProvide a unified summary highlighting cross-cutting themes and gaps.`
    );

    console.log(`═══ Swarm Research Summary ═══\n\n${synthesis}\n`);

    // Cleanup
    await Promise.all(nanobots.map(b => b.client.disconnect().catch(() => {})));
    await coordinator.disconnect();
}

// ─── Example 2: Code Review Fleet ───────────────────────────────

async function codeReviewSwarm() {
    console.log(`\nLaunching Code Review Nanobot Fleet...\n`);

    // Simulated files to review (in production, read from git diff)
    const filesToReview = [
        { path: 'src/auth.ts', content: 'function login(user, pass) { return db.query(`SELECT * FROM users WHERE name="${user}"`); }' },
        { path: 'src/api.ts', content: 'app.get("/users/:id", (req, res) => { res.json(users[req.params.id]); });' },
        { path: 'src/utils.ts', content: 'function parseJSON(str) { return eval("(" + str + ")"); }' },
    ];

    const reviewers = [
        { name: 'security-bot', focus: 'security vulnerabilities (SQL injection, XSS, eval usage)' },
        { name: 'perf-bot', focus: 'performance issues (N+1 queries, missing indexes, memory leaks)' },
        { name: 'style-bot', focus: 'code style, naming conventions, and best practices' },
    ];

    const coordinator = await createClient({
        identity: { name: 'review-coordinator' },
        storage: { path: ':memory:' },
        network: { enableGossipsub: true, enableMdns: true },
    });
    await coordinator.joinRoom('nanobot-swarm');

    for (const file of filesToReview) {
        console.log(`\n── Reviewing: ${file.path} ──\n`);

        const reviews = await Promise.all(
            reviewers.map(async (reviewer) => {
                const bot = await createNanobot(reviewer.name, 'reviewer', async (client) => {
                    const review = await queryOllama(
                        `You are a code reviewer focused on ${reviewer.focus}.\n` +
                        `Review this code from ${file.path}:\n\n${file.content}\n\n` +
                        `List issues found (or "No issues" if clean). Be concise.`
                    );
                    console.log(`  [${reviewer.name}] ${review.split('\n')[0]}`);
                    await client.disconnect();
                    return { reviewer: reviewer.name, review };
                });
                return bot.execute();
            })
        );

        // Aggregate
        const hasIssues = reviews.some(r => !r.review.toLowerCase().includes('no issues'));
        console.log(`  ${hasIssues ? '⚠️  Issues found' : '✓ Clean'}`);
    }

    await coordinator.disconnect();
}

// ─── Example 3: Infrastructure Monitor Fleet ────────────────────

async function monitorSwarm() {
    console.log(`\nLaunching Infrastructure Monitor Fleet...\n`);

    const endpoints = [
        { name: 'api-server', url: 'https://httpbin.org/status/200', expect: 200 },
        { name: 'auth-service', url: 'https://httpbin.org/status/200', expect: 200 },
        { name: 'database', url: 'https://httpbin.org/delay/1', expect: 200 },
    ];

    const coordinator = await createClient({
        identity: { name: 'monitor-coordinator' },
        storage: { path: ':memory:' },
        network: { enableGossipsub: true, enableMdns: true },
    });
    await coordinator.joinRoom('nanobot-swarm');

    // Each nanobot monitors one endpoint
    const monitors = await Promise.all(
        endpoints.map(async (ep, i) => {
            return createNanobot(`monitor-${i}`, 'monitor', async (client) => {
                const start = Date.now();
                try {
                    const res = await fetch(ep.url, { signal: AbortSignal.timeout(5000) });
                    const latency = Date.now() - start;
                    const status = res.status === ep.expect ? 'healthy' : 'degraded';
                    console.log(`  [${ep.name}] ${status} (${latency}ms, HTTP ${res.status})`);

                    await client.sendMessage('nanobot-swarm', JSON.stringify({
                        type: 'health_check',
                        service: ep.name,
                        status,
                        latency,
                        httpStatus: res.status,
                    }));

                    return { service: ep.name, status, latency };
                } catch (err) {
                    console.log(`  [${ep.name}] DOWN (${err.message})`);
                    return { service: ep.name, status: 'down', error: err.message };
                }
            });
        })
    );

    // Run health checks
    const results = await Promise.all(monitors.map(m => m.execute()));
    const down = results.filter(r => r.status === 'down');

    console.log(`\n  Fleet Report: ${results.length - down.length}/${results.length} healthy`);
    if (down.length > 0) {
        console.log(`  ⚠️  Down: ${down.map(d => d.service).join(', ')}`);
    }

    // Cleanup
    await Promise.all(monitors.map(m => m.client.disconnect().catch(() => {})));
    await coordinator.disconnect();
}

// ─── Ollama Helper ──────────────────────────────────────────────

async function queryOllama(prompt) {
    try {
        const res = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                prompt,
                stream: false,
                options: { temperature: 0.7, num_predict: 300 },
            }),
        });
        const data = await res.json();
        return data.response || 'No response';
    } catch (err) {
        return `[Model unavailable: ${err.message}]`;
    }
}

// ─── Main ───────────────────────────────────────────────────────

const mode = process.argv[2] || 'research';

const modes = {
    research: researchSwarm,
    scrape: researchSwarm,   // alias
    review: codeReviewSwarm,
    monitor: monitorSwarm,
};

const fn = modes[mode];
if (fn) {
    fn().catch(console.error);
} else {
    console.log('Usage: node nanobot-swarm.js [research|review|monitor]');
}
