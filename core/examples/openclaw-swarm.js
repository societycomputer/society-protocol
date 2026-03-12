#!/usr/bin/env node
/**
 * Society Protocol — OpenClaw Agent Swarm
 *
 * Deploy a swarm of OpenClaw-powered agents that collaborate
 * on legal research, contract analysis, and compliance review.
 * Each agent specializes in a legal domain and uses OpenClaw
 * for structured legal reasoning.
 *
 * Architecture:
 *   Legal Researcher  ──┐
 *   Contract Analyst  ───┤── P2P Mesh ── Knowledge Pool
 *   Compliance Agent  ───┘
 *
 * Run: node examples/openclaw-swarm.js
 */

import { createClient } from 'society-protocol';

// ─── Configuration ──────────────────────────────────────────────

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.MODEL || 'qwen3:8b';
const BOOTSTRAP = process.env.BOOTSTRAP_PEERS?.split(',') || [];

// Agent definitions — each with a specialized legal role
const AGENTS = [
    {
        name: 'LegalResearcher',
        role: 'legal-research',
        capabilities: ['case-law', 'precedent-analysis', 'statute-lookup'],
        systemPrompt: 'You are a legal researcher specializing in case law and precedent analysis. Provide citations and structured legal arguments.',
    },
    {
        name: 'ContractAnalyst',
        role: 'contract-analysis',
        capabilities: ['contract-review', 'clause-extraction', 'risk-assessment'],
        systemPrompt: 'You are a contract analyst. Identify key clauses, obligations, risks, and suggest improvements.',
    },
    {
        name: 'ComplianceReviewer',
        role: 'compliance',
        capabilities: ['regulatory-compliance', 'gdpr', 'sox', 'hipaa'],
        systemPrompt: 'You are a compliance specialist. Check documents against regulatory frameworks (GDPR, SOX, HIPAA) and flag violations.',
    },
    {
        name: 'IPSpecialist',
        role: 'intellectual-property',
        capabilities: ['patent-analysis', 'trademark', 'copyright'],
        systemPrompt: 'You are an intellectual property specialist. Analyze patents, trademarks, and copyright claims.',
    },
];

// ─── Swarm Coordinator ──────────────────────────────────────────

class OpenClawSwarm {
    constructor() {
        this.clients = new Map();
        this.knowledgeSpaceId = null;
    }

    async start() {
        console.log('Starting OpenClaw Agent Swarm...\n');

        // Create all agents
        for (const agentDef of AGENTS) {
            const client = await createClient({
                identity: { name: agentDef.name },
                storage: { path: `:memory:` },
                network: {
                    listenAddrs: ['/ip4/0.0.0.0/tcp/0'],
                    bootstrapPeers: BOOTSTRAP,
                    enableGossipsub: true,
                    enableMdns: true,  // Local discovery for swarm
                    enableDht: true,
                },
            });

            await client.joinRoom('openclaw-swarm');
            this.clients.set(agentDef.name, { client, def: agentDef });
            console.log(`  ✓ ${agentDef.name} online (${client.getIdentity().did.slice(0, 20)}...)`);
        }

        // Create shared knowledge space
        const lead = this.clients.get('LegalResearcher').client;
        const space = await lead.createKnowledgeSpace(
            'Legal Knowledge Pool',
            'Shared legal research, precedents, and compliance findings',
            'team'
        );
        this.knowledgeSpaceId = space.id;
        console.log(`\n  Knowledge pool: ${space.name}\n`);

        // Set up message handlers
        this.setupMessageHandlers();
    }

    setupMessageHandlers() {
        for (const [name, { client, def }] of this.clients) {
            client.on('message', async (data) => {
                const text = typeof data.body?.text === 'string' ? data.body.text : String(data.text || '');
                const from = data.fromName || data.from || 'unknown';
                if (from === name) return; // Skip own messages

                try {
                    const msg = JSON.parse(text);
                    if (msg.type === 'task' && msg.assignee === name) {
                        console.log(`  [${name}] Received task: ${msg.task}`);
                        await this.executeTask(name, msg);
                    }
                } catch {
                    // Regular message — ignore
                }
            });
        }
    }

    // Distribute a legal analysis task across the swarm
    async analyzeDocument(document, taskDescription) {
        console.log(`\n═══ Legal Analysis: ${taskDescription} ═══\n`);

        const tasks = [
            { assignee: 'ContractAnalyst', task: 'Extract key clauses and identify risks', document },
            { assignee: 'ComplianceReviewer', task: 'Check compliance with applicable regulations', document },
            { assignee: 'IPSpecialist', task: 'Identify any IP-related clauses or concerns', document },
        ];

        // Dispatch tasks via P2P messages
        const lead = this.clients.get('LegalResearcher').client;
        const results = [];

        for (const task of tasks) {
            const { client, def } = this.clients.get(task.assignee);

            console.log(`  → Dispatching to ${task.assignee}: ${task.task}`);

            const analysis = await queryOllama(
                `${def.systemPrompt}\n\nTask: ${task.task}\n\nDocument:\n${document}\n\nProvide a concise analysis (3-5 key points).`,
            );

            results.push({ agent: task.assignee, role: def.role, analysis });

            // Store as knowledge card
            await client.createKnowledgeCard(
                this.knowledgeSpaceId,
                'finding',
                `${task.assignee}: ${task.task}`,
                analysis,
                {
                    tags: [def.role, 'analysis'],
                    domain: def.capabilities,
                    confidence: 0.9,
                }
            );

            console.log(`  ✓ ${task.assignee} completed\n`);
        }

        // Lead synthesizes all findings
        const synthesis = await queryOllama(
            `You are a senior legal researcher. Synthesize these specialist analyses into a final report:\n\n` +
            results.map(r => `[${r.agent} — ${r.role}]\n${r.analysis}`).join('\n\n') +
            `\n\nProvide a unified summary with actionable recommendations.`
        );

        console.log(`\n═══ Synthesis ═══\n${synthesis}\n`);

        // Share synthesis
        await lead.sendMessage('openclaw-swarm', JSON.stringify({
            type: 'synthesis',
            task: taskDescription,
            findings: results.length,
            summary: synthesis.slice(0, 200),
        }));

        return { results, synthesis };
    }

    async stop() {
        console.log('\nShutting down swarm...');
        await Promise.all(
            Array.from(this.clients.values()).map(({ client }) =>
                client.disconnect().catch(() => {})
            )
        );
        console.log('Done.');
    }
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
                options: { temperature: 0.7, num_predict: 400 },
            }),
        });
        const data = await res.json();
        return data.response || 'No response';
    } catch (err) {
        return `[Model unavailable: ${err.message}]`;
    }
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
    const swarm = new OpenClawSwarm();
    await swarm.start();

    // Example: analyze a sample contract
    const sampleContract = `
SERVICE AGREEMENT

1. SCOPE: Provider shall deliver AI-powered legal analysis services.
2. DATA HANDLING: All client data will be processed and stored on Provider's servers.
   Provider may use anonymized data for model training.
3. LIABILITY: Provider's total liability shall not exceed fees paid in the prior 12 months.
4. TERM: This agreement auto-renews annually unless terminated with 30 days notice.
5. IP: All outputs generated by the AI system are owned by Provider.
6. GOVERNING LAW: This agreement is governed by the laws of Delaware.
    `.trim();

    await swarm.analyzeDocument(sampleContract, 'AI Service Agreement Review');

    await swarm.stop();
}

main().catch(console.error);
