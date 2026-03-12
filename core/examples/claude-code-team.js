#!/usr/bin/env node
/**
 * Society Protocol — Claude Code Remote Dev Team
 *
 * Connect a distributed team of Claude Code instances that
 * collaborate on software development tasks via Society Protocol.
 * Each developer's Claude Code joins a shared room, enabling:
 *
 *   - Real-time code review requests across the team
 *   - Distributed task assignment (summon workflows)
 *   - Shared knowledge base of codebase patterns
 *   - Automated PR review aggregation
 *
 * Setup:
 *   1. Add to .cursor/mcp.json or claude_desktop_config.json:
 *      { "mcpServers": { "society": { "command": "npx", "args": ["society-protocol", "mcp"] } } }
 *
 *   2. Or run this example to simulate a team:
 *      node examples/claude-code-team.js
 *
 * Architecture:
 *   Dev-A (São Paulo) ──┐
 *   Dev-B (Berlin)   ───┤── P2P / Relay ── Shared Knowledge
 *   Dev-C (Tokyo)    ───┘
 */

import { createClient } from 'society-protocol';

// ─── Configuration ──────────────────────────────────────────────

const RELAY = process.env.RELAY_ADDR || '';
const TEAM_ROOM = process.env.TEAM_ROOM || 'dev-team';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.MODEL || 'qwen3:8b';

// ─── Team Member Definitions ────────────────────────────────────

const TEAM = [
    {
        name: 'Alice',
        role: 'frontend-lead',
        location: 'São Paulo',
        capabilities: ['react', 'typescript', 'css', 'accessibility'],
        expertise: 'React architecture, component design, CSS-in-JS, a11y',
    },
    {
        name: 'Bob',
        role: 'backend-lead',
        location: 'Berlin',
        capabilities: ['node', 'postgres', 'redis', 'api-design'],
        expertise: 'Node.js APIs, PostgreSQL optimization, caching strategies',
    },
    {
        name: 'Carol',
        role: 'devops',
        location: 'Tokyo',
        capabilities: ['docker', 'k8s', 'ci-cd', 'monitoring'],
        expertise: 'Kubernetes, CI/CD pipelines, observability, infrastructure-as-code',
    },
];

// ─── Dev Team Simulation ────────────────────────────────────────

class DevTeam {
    constructor() {
        this.members = new Map();
    }

    async connect() {
        console.log('Connecting dev team...\n');

        const bootstrapPeers = RELAY ? [RELAY] : [];

        for (const member of TEAM) {
            const client = await createClient({
                identity: { name: member.name },
                storage: { path: ':memory:' },
                network: {
                    listenAddrs: ['/ip4/0.0.0.0/tcp/0'],
                    bootstrapPeers,
                    enableGossipsub: true,
                    enableMdns: !RELAY, // mDNS for local, relay for remote
                    enableDht: true,
                },
            });

            await client.joinRoom(TEAM_ROOM);
            this.members.set(member.name, { client, ...member });

            console.log(`  ✓ ${member.name} (${member.role}) online from ${member.location}`);
        }

        // Set up message handlers
        this.setupHandlers();
        console.log(`\n  Team connected in room: ${TEAM_ROOM}\n`);
    }

    setupHandlers() {
        for (const [name, member] of this.members) {
            member.client.on('message', async (data) => {
                const text = typeof data.body?.text === 'string' ? data.body.text : String(data.text || '');
                const from = data.fromName || data.from || 'unknown';
                if (from === name) return;

                try {
                    const msg = JSON.parse(text);
                    if (msg.type === 'review_request' && msg.reviewers?.includes(name)) {
                        await this.handleReviewRequest(name, msg);
                    }
                    if (msg.type === 'question' && msg.to === name) {
                        await this.handleQuestion(name, msg);
                    }
                } catch {
                    // Regular chat
                }
            });
        }
    }

    // ─── Code Review Workflow ───────────────────────────────────

    async requestReview(author, code, description) {
        console.log(`\n═══ Code Review: ${description} ═══`);
        console.log(`    Author: ${author}\n`);

        const reviewers = TEAM.filter(m => m.name !== author);
        const reviews = [];

        for (const reviewer of reviewers) {
            const member = this.members.get(reviewer.name);
            console.log(`  [${reviewer.name}] Reviewing as ${reviewer.role}...`);

            const review = await queryOllama(
                `You are ${reviewer.name}, a ${reviewer.role} with expertise in ${reviewer.expertise}.\n\n` +
                `Review this code change:\n\`\`\`\n${code}\n\`\`\`\n\n` +
                `Description: ${description}\n\n` +
                `Provide a brief review (approve/request changes) with specific feedback from your area of expertise.`
            );

            reviews.push({ reviewer: reviewer.name, role: reviewer.role, review });

            // Share review via P2P
            await member.client.sendMessage(TEAM_ROOM, JSON.stringify({
                type: 'review_response',
                reviewer: reviewer.name,
                author,
                verdict: review.toLowerCase().includes('approve') ? 'approved' : 'changes_requested',
                summary: review.slice(0, 150),
            }));

            console.log(`  [${reviewer.name}] ${review.toLowerCase().includes('approve') ? '✓ Approved' : '⚠ Changes requested'}`);
        }

        // Aggregate
        const approvals = reviews.filter(r => r.review.toLowerCase().includes('approve'));
        console.log(`\n  Result: ${approvals.length}/${reviews.length} approvals`);

        return reviews;
    }

    // ─── Knowledge Sharing ──────────────────────────────────────

    async sharePattern(author, pattern) {
        const member = this.members.get(author);
        console.log(`\n  [${author}] Sharing pattern: ${pattern.title}`);

        // Create knowledge card
        const space = await member.client.createKnowledgeSpace(
            'Team Patterns', 'Codebase patterns and conventions', 'team'
        );
        await member.client.createKnowledgeCard(
            space.id,
            'reference',
            pattern.title,
            pattern.description,
            {
                tags: pattern.tags,
                domain: [member.role],
                confidence: 0.95,
            }
        );

        // Notify team
        await member.client.sendMessage(TEAM_ROOM, JSON.stringify({
            type: 'pattern_shared',
            author,
            title: pattern.title,
            tags: pattern.tags,
        }));

        console.log(`  ✓ Pattern shared with team`);
    }

    // ─── Summon Workflow ────────────────────────────────────────

    async summonWorkflow(requester, goal) {
        const member = this.members.get(requester);
        console.log(`\n═══ Workflow: ${goal} ═══\n`);

        const chain = await member.client.summon({
            roomId: TEAM_ROOM,
            goal,
            priority: 'high',
            onStep: (step) => {
                console.log(`  [${step.kind}] ${step.title}: ${step.status}`);
            },
            onComplete: (result) => {
                console.log(`\n  Workflow completed: ${result.id}`);
            },
        });

        console.log(`  Chain started: ${chain.id}`);
        return chain;
    }

    // ─── Question Routing ───────────────────────────────────────

    async handleQuestion(responder, msg) {
        const member = this.members.get(responder);
        console.log(`  [${responder}] Answering: ${msg.question.slice(0, 60)}...`);

        const answer = await queryOllama(
            `You are ${responder}, a ${member.role} with expertise in ${member.expertise}.\n\n` +
            `A teammate asks: ${msg.question}\n\nProvide a helpful, concise answer.`
        );

        await member.client.sendMessage(TEAM_ROOM, JSON.stringify({
            type: 'answer',
            from: responder,
            to: msg.from,
            question: msg.question,
            answer: answer.slice(0, 300),
        }));
    }

    async handleReviewRequest(reviewer, msg) {
        // Handled by requestReview — this is the P2P handler
    }

    async disconnect() {
        await Promise.all(
            Array.from(this.members.values()).map(m =>
                m.client.disconnect().catch(() => {})
            )
        );
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

async function main() {
    const team = new DevTeam();
    await team.connect();

    // Scenario 1: Code review
    await team.requestReview('Alice',
        `// New auth middleware
export function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
}`,
        'Add JWT authentication middleware'
    );

    // Scenario 2: Share a pattern
    await team.sharePattern('Bob', {
        title: 'API Error Response Convention',
        description: 'All API errors should follow: { error: string, code: string, details?: object }. Use HTTP status codes consistently: 400 validation, 401 auth, 403 authz, 404 not found, 500 server.',
        tags: ['api', 'convention', 'error-handling'],
    });

    // Scenario 3: Ask an expert
    const carol = team.members.get('Carol');
    await carol.client.sendMessage(TEAM_ROOM, JSON.stringify({
        type: 'question',
        from: 'Carol',
        to: 'Bob',
        question: 'What PostgreSQL connection pooling strategy should we use for our Node.js API with ~200 concurrent connections?',
    }));

    // Wait for response processing
    await new Promise(r => setTimeout(r, 2000));

    await team.disconnect();
    console.log('\nTeam session ended.');
}

main().catch(console.error);

// ─── Real Deployment Notes ──────────────────────────────────────
//
// For real remote teams, each developer runs society-protocol
// as an MCP server in their IDE:
//
// 1. Install: npm install -g society-protocol
//
// 2. Add to .cursor/mcp.json (Cursor) or claude_desktop_config.json (Claude):
//    {
//      "mcpServers": {
//        "society": {
//          "command": "npx",
//          "args": ["society-protocol", "mcp", "--room", "my-team", "--relay", "wss://relay.example.com"]
//        }
//      }
//    }
//
// 3. Each team member's Claude Code can then:
//    - See other team members' agents on the network
//    - Send code review requests via summon()
//    - Share knowledge cards about codebase patterns
//    - Receive and respond to questions
//
// 4. For persistent team identity, set a storage path:
//    "args": ["society-protocol", "mcp", "--db", "~/.society/team.db"]
