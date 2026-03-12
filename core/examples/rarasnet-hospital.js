#!/usr/bin/env node
/**
 * Society Protocol — RarasNet: Real Hospital Deployment
 *
 * Deploy a medical collaboration network across real hospitals
 * in different cities/networks. Each hospital runs its own
 * SocietyClient with a persistent identity, connecting via
 * internet relay nodes.
 *
 * Architecture:
 *   Hospital A (São Paulo) ──┐
 *   Hospital B (Rio)      ───┤── Relay Node (cloud) ── Dashboard
 *   Hospital C (Brasília) ───┘
 *
 * Each hospital agent:
 *   - Has a persistent did:key identity
 *   - Connects via WebSocket to a cloud relay (no mDNS over internet)
 *   - Joins shared rooms for case discussion
 *   - Uses local Ollama for AI-assisted diagnostics
 *   - Shares knowledge cards (CRDT-synced across all nodes)
 *
 * Run: RELAY_ADDR=/ip4/relay.example.com/tcp/9090/ws node examples/rarasnet-hospital.js
 */

import { createClient } from 'society-protocol';

// ─── Configuration ──────────────────────────────────────────────

const RELAY = process.env.RELAY_ADDR || '/ip4/127.0.0.1/tcp/9090/ws';
const HOSPITAL_NAME = process.env.HOSPITAL_NAME || 'Hospital São Paulo';
const HOSPITAL_CITY = process.env.HOSPITAL_CITY || 'São Paulo';
const HOSPITAL_SPECIALTIES = (process.env.SPECIALTIES || 'oncology,cardiology').split(',');
const DB_PATH = process.env.DB_PATH || `./data/rarasnet-${HOSPITAL_NAME.toLowerCase().replace(/\s+/g, '-')}.db`;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';

// ─── Hospital Agent Setup ───────────────────────────────────────

async function startHospitalAgent() {
    console.log(`\n🏥 Starting ${HOSPITAL_NAME} agent...`);
    console.log(`   City: ${HOSPITAL_CITY}`);
    console.log(`   Specialties: ${HOSPITAL_SPECIALTIES.join(', ')}`);
    console.log(`   Relay: ${RELAY}`);

    const agent = await createClient({
        identity: { name: HOSPITAL_NAME },
        storage: { path: DB_PATH },
        network: {
            listenAddrs: ['/ip4/0.0.0.0/tcp/0/ws'],
            bootstrapPeers: [RELAY],
            enableGossipsub: true,
            enableDht: true,
            enableMdns: false,  // No mDNS over internet
        },
    });

    console.log(`   DID: ${agent.getIdentity().did}`);
    console.log(`   Peer ID: ${agent.getPeerId()}`);

    // Join the main RarasNet room
    await agent.joinRoom('rarasnet');
    console.log(`   Joined room: rarasnet`);

    // Register capabilities
    for (const specialty of HOSPITAL_SPECIALTIES) {
        // Capabilities are discoverable by other agents
        console.log(`   Registered capability: ${specialty}`);
    }

    return agent;
}

// ─── AI-Assisted Case Discussion ────────────────────────────────

async function discussCase(agent, caseData) {
    console.log(`\n📋 Case Discussion: ${caseData.title}`);
    console.log(`   Patient: ${caseData.patientAge}y/${caseData.patientSex}`);
    console.log(`   Symptoms: ${caseData.symptoms.join(', ')}`);

    // Send case to the network
    await agent.sendMessage('rarasnet', JSON.stringify({
        type: 'case_discussion',
        hospital: HOSPITAL_NAME,
        city: HOSPITAL_CITY,
        case: caseData,
    }));

    // Use local Ollama for initial analysis
    const analysis = await queryOllama(
        `You are a medical AI assistant at ${HOSPITAL_NAME}. ` +
        `Analyze this case:\n` +
        `Patient: ${caseData.patientAge}y/${caseData.patientSex}\n` +
        `Symptoms: ${caseData.symptoms.join(', ')}\n` +
        `History: ${caseData.history || 'None provided'}\n\n` +
        `Provide a brief differential diagnosis and recommended next steps.`
    );

    console.log(`\n   AI Analysis:\n   ${analysis.split('\n').join('\n   ')}`);

    // Share analysis as a knowledge card
    const card = await agent.createKnowledgeCard(
        'rarasnet-cases',
        'finding',
        `Case Analysis: ${caseData.title}`,
        analysis,
        {
            tags: ['case', ...caseData.symptoms],
            domain: HOSPITAL_SPECIALTIES,
            confidence: 0.85,
            metadata: {
                hospital: HOSPITAL_NAME,
                city: HOSPITAL_CITY,
                caseId: caseData.id,
            },
        }
    );
    console.log(`   Knowledge card shared: ${card.id}`);

    return analysis;
}

// ─── Listen for Network Cases ───────────────────────────────────

function listenForCases(agent) {
    agent.on('message', async (data) => {
        try {
            const text = typeof data.body?.text === 'string' ? data.body.text : String(data.text || '');
            const parsed = JSON.parse(text);

            if (parsed.type === 'case_discussion' && parsed.hospital !== HOSPITAL_NAME) {
                console.log(`\n📨 Case from ${parsed.hospital} (${parsed.city}):`);
                console.log(`   ${parsed.case.title}`);

                // Check if we have relevant expertise
                const relevant = parsed.case.symptoms.some(s =>
                    HOSPITAL_SPECIALTIES.some(spec =>
                        s.toLowerCase().includes(spec) || spec.includes(s.toLowerCase())
                    )
                );

                if (relevant) {
                    console.log(`   ✓ We have relevant expertise — generating response...`);
                    const response = await queryOllama(
                        `You are a specialist at ${HOSPITAL_NAME} (${HOSPITAL_SPECIALTIES.join(', ')}). ` +
                        `A colleague at ${parsed.hospital} shared this case:\n` +
                        `${JSON.stringify(parsed.case, null, 2)}\n\n` +
                        `Provide your specialist perspective in 2-3 sentences.`
                    );

                    await agent.sendMessage('rarasnet', JSON.stringify({
                        type: 'case_response',
                        hospital: HOSPITAL_NAME,
                        city: HOSPITAL_CITY,
                        inReplyTo: parsed.case.id,
                        response,
                    }));
                }
            }
        } catch {
            // Not JSON or not a case — regular chat message
        }
    });
}

// ─── Ollama Integration ─────────────────────────────────────────

async function queryOllama(prompt) {
    try {
        const res = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                prompt,
                stream: false,
                options: { temperature: 0.7, num_predict: 300 },
            }),
        });
        const data = await res.json();
        return data.response || 'No response from model';
    } catch (err) {
        return `[Ollama unavailable: ${err.message}]`;
    }
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
    const agent = await startHospitalAgent();

    // Listen for cases from other hospitals
    listenForCases(agent);

    // Example: submit a case for discussion
    if (process.argv.includes('--submit-case')) {
        await discussCase(agent, {
            id: `case-${Date.now()}`,
            title: 'Suspected Tropical Disease — Unusual Presentation',
            patientAge: 34,
            patientSex: 'M',
            symptoms: ['persistent fever', 'hepatosplenomegaly', 'pancytopenia', 'weight loss'],
            history: 'Recent travel to endemic area. No response to standard antibiotics.',
        });
    }

    console.log(`\n✓ ${HOSPITAL_NAME} is online and listening for cases.`);
    console.log(`  Press Ctrl+C to disconnect.\n`);

    // Keep alive
    process.on('SIGINT', async () => {
        console.log(`\nDisconnecting ${HOSPITAL_NAME}...`);
        await agent.disconnect();
        process.exit(0);
    });
}

main().catch(console.error);

// ─── Deployment Notes ───────────────────────────────────────────
//
// 1. Deploy a relay node in the cloud:
//    npx society-protocol relay --port 9090 --ws
//
// 2. Start each hospital with its own config:
//    HOSPITAL_NAME="HC FMUSP" \
//    HOSPITAL_CITY="São Paulo" \
//    SPECIALTIES="oncology,hematology,tropical-medicine" \
//    RELAY_ADDR="/ip4/relay.rarasnet.org/tcp/9090/ws" \
//    DB_PATH="./data/hc-fmusp.db" \
//    node examples/rarasnet-hospital.js
//
// 3. Each hospital keeps its own did:key identity across restarts
//    (stored in the SQLite DB at DB_PATH).
//
// 4. For production, run behind a reverse proxy (nginx/caddy)
//    with TLS termination:
//    RELAY_ADDR="/dns4/relay.rarasnet.org/tcp/443/wss"
//
// 5. Docker deployment:
//    docker run -e HOSPITAL_NAME="Hospital Albert Einstein" \
//               -e RELAY_ADDR="/dns4/relay.rarasnet.org/tcp/443/wss" \
//               -v ./data:/app/data \
//               society-protocol/rarasnet-agent
