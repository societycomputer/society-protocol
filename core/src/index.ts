#!/usr/bin/env node
/**
 * Society Protocol — CLI v1.0 (State of the Art)
 *
 * Usage:
 *   society node --name Alice --room lobby
 *   society node --name Bob --room lobby --bootstrap /ip4/127.0.0.1/tcp/12345/p2p/QmXxx
 *   society node --name Charlie --room lobby --relay --enable-gossipsub
 *
 * Interactive commands:
 *   /peers                    — list connected peers
 *   /rooms                    — list joined rooms
 *   /presence                 — list online peers with reputation
 *   /reputation [did]         — show reputation scores
 *   /info                     — show node info
 *   /history                  — chat history
 *   /summon "goal"            — start AI-planned collaboration
 *   /template <name> [goal]   — use predefined template
 *   /chains                   — list active chains
 *   /chain <id>               — show chain details
 *   /step <id> <status>       — submit step result
 *   /assign <step> <agent>    — manually assign step
 *   /review <step> <decision> — review a step
 *   /cancel <chain>           — cancel chain
 *   /export <chain>           — export capsule
 *   /cache                    — show planner cache stats
 *   /mesh-request ...         — request federation peering
 *   /mesh-peerings ...        — list peerings
 *   /mesh-open ...            — open mesh bridge
 *   /mesh-bridges             — list mesh bridges
 *   /mesh-stats               — show mesh metrics
 *   /debug                    — toggle debug mode
 *   /quit                     — exit
 */

import { Command } from 'commander';
import readline from 'readline';
import { toString as uint8ToString } from 'uint8arrays';
import { generateIdentity, restoreIdentity, type Identity } from './identity.js';
import { Storage } from './storage.js';
import { P2PNode } from './p2p.js';
import { RoomManager } from './rooms.js';
import { CocEngine } from './coc.js';
import { Planner, type PlannerProvider } from './planner.js';
import { ReputationEngine, formatReputationTier } from './reputation.js';
import { AdapterHost } from './adapters.js';
import { getTemplate, TEMPLATES } from './templates.js';
import { CapsuleExporter } from './capsules.js';
import { FederationEngine } from './federation.js';
import { KnowledgePool } from './knowledge.js';
import { SkillsEngine } from './skills/engine.js';
import { SecurityManager } from './security.js';
import { IntegrationEngine } from './integration.js';
import { PersonaVaultEngine } from './persona/index.js';
import { ProactiveMissionEngine } from './proactive/engine.js';
import { ProactiveWatcher } from './proactive/watcher.js';
import type { SwpEnvelope, ChatMsgBody, CocDagNode, Artifact } from './swp.js';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { realpathSync } from 'fs';
import { createClient } from './sdk/client.js';
import { registerNode, resolveNode, stopHeartbeat, generateFriendlyName } from './registry.js';

// ─── Invite Code Helpers ─────────────────────────────────────────
// Encode a multiaddr + room into a short invite code: base64url
function encodeInvite(multiaddr: string, room: string): string {
    const payload = JSON.stringify({ a: multiaddr, r: room });
    return Buffer.from(payload).toString('base64url');
}

function decodeInvite(code: string): { multiaddr: string; room: string } | null {
    try {
        const payload = JSON.parse(Buffer.from(code, 'base64url').toString('utf-8'));
        if (payload.a) return { multiaddr: payload.a, room: payload.r || 'lobby' };
    } catch { /* not a valid invite code */ }
    return null;
}

const program = new Command();

program
    .name('society')
    .description('Society Protocol — Connect your AI agents')
    .version('1.0.0');

// ─── DEFAULT ACTION (npx society) ────────────────────────────────
// Running `npx society` with no subcommand starts a node instantly
program
    .argument('[name]', 'agent display name')
    .option('-r, --room <room>', 'room to join', 'lobby')
    .option('-b, --bootstrap <addrs...>', 'connect to remote network')
    .option('-p, --port <port>', 'listen port', '0')
    .option('--relay', 'expose as public relay (requires cloudflared)')
    .option('--debug', 'enable debug logging')
    .action(async (name, options) => {
        if (name && !program.args.includes('node') && !program.args.includes('init') &&
            !program.args.includes('join') && !program.args.includes('invite') &&
            !program.args.includes('status') && !program.args.includes('dashboard') &&
            !program.args.includes('mission') && !program.args.includes('swarm') &&
            !program.args.includes('worker') && !program.args.includes('mcp')) {
            await startNode({
                name: name || 'Agent',
                room: options.room,
                port: options.port || '0',
                bootstrap: options.bootstrap,
                relay: options.relay,
                gossipsub: true,
                dht: true,
                missionLeader: false,
                provider: 'openai',
                debug: options.debug,
            });
        }
    });

// ─── JOIN COMMAND ────────────────────────────────────────────────
// society join <invite-code-or-multiaddr>
program
    .command('join <code>')
    .description('Join a friend\'s network')
    .option('-n, --name <name>', 'your agent name')
    .option('-r, --room <room>', 'room to join')
    .action(async (code, options) => {
        const name = options.name || `Agent-${Math.random().toString(36).slice(2, 6)}`;

        console.log('');
        console.log(`  ${bold('Society Protocol')} — Joining network...`);
        console.log('');

        let bootstrapAddr: string | undefined;
        let room = options.room || 'lobby';

        if (code.startsWith('/')) {
            // Raw multiaddr
            bootstrapAddr = code;
            console.log(`  Connecting to: ${dim(code.slice(0, 60))}...`);
        } else {
            // Try invite code first
            const decoded = decodeInvite(code);
            if (decoded) {
                bootstrapAddr = decoded.multiaddr;
                if (!options.room) room = decoded.room;
                console.log(`  Invite accepted! Joining room ${cyan(room)}...`);
            } else {
                // Try resolving as a name from the registry
                console.log(`  Looking up ${bold(code)} in registry...`);
                const resolved = await resolveNode(code);
                if (resolved) {
                    bootstrapAddr = resolved.multiaddr;
                    if (!options.room) room = resolved.room;
                    console.log(`  Found ${bold(code)}! Joining room ${cyan(room)}...`);
                } else {
                    console.error(red(`  Could not find "${code}".`));
                    console.log(`  ${dim('Try an invite code or multiaddr instead.')}`);
                    process.exit(1);
                }
            }
        }

        await startNode({
            name,
            room,
            port: '0',
            bootstrap: bootstrapAddr ? [bootstrapAddr] : undefined,
            gossipsub: true,
            dht: true,
            missionLeader: false,
            provider: 'openai',
            debug: false,
        });
    });

// ─── INVITE COMMAND ─────────────────────────────────────────────
// society invite → generate a shareable invite code
program
    .command('invite')
    .description('Generate an invite for others to join your network')
    .option('-n, --name <name>', 'register a friendly name (e.g. "alice")')
    .option('-r, --room <room>', 'room to invite to', 'lobby')
    .option('-p, --port <port>', 'P2P listen port', '4001')
    .option('--relay', 'create a public relay so friends can join from anywhere')
    .action(async (options) => {
        console.log('');
        console.log(`  ${bold('Society Protocol')} — Generating invite...`);
        console.log(`  ${dim('Your node must stay running for others to connect.')}`);
        console.log('');

        const port = parseInt(options.port, 10);
        const nodeName = options.name || 'Host';
        const client = await createClient({
            identity: { name: nodeName },
            network: {
                port,
                enableGossipsub: true,
                enableDht: true,
            },
        });

        await client.joinRoom(options.room);
        const peerId = client.getPeerId()!;

        // Local invite (LAN)
        const localMultiaddr = `/ip4/127.0.0.1/tcp/${port}/p2p/${peerId}`;
        const localCode = encodeInvite(localMultiaddr, options.room);

        // Auto-register with friendly name
        const agentName = options.name || generateFriendlyName();
        const registered = await registerNode(agentName, {
            multiaddr: localMultiaddr,
            room: options.room,
            peerId,
            name: agentName,
        });

        console.log(`  ${green('Node running!')} Room: ${cyan(options.room)}`);
        if (registered) {
            console.log(`  ${bold('Your address:')} ${cyan(`${agentName}@society.computer`)}`);
        }
        console.log('');
        console.log(`  ${bold('Share with friends:')}`);
        console.log('');
        console.log(`    ${bold(cyan(`npx society join ${registered ? agentName : localCode}`))}`);
        console.log('');

        // If --relay, spawn cloudflared for a public URL
        if (options.relay) {
            const wsPort = port + 1;
            console.log(`  ${dim('Starting public relay...')}`);

            if (!isCommandAvailable('cloudflared')) {
                console.log(`  ${yellow('cloudflared not found.')} Installing...`);
                await installCloudflared();
            }

            if (isCommandAvailable('cloudflared')) {
                const cfProc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${wsPort}`]);

                cfProc.stderr?.on('data', (data: Buffer) => {
                    const str = data.toString();
                    const match = str.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
                    if (match) {
                        const host = match[1].replace('https://', '');
                        const publicMultiaddr = `/dns4/${host}/tcp/443/wss/p2p/${peerId}`;
                        const publicCode = encodeInvite(publicMultiaddr, options.room);

                        console.log(`  ${bold(green('Public relay active!'))}`);
                        console.log('');
                        console.log(`  ${bold('Share with anyone:')}`);
                        console.log('');
                        console.log(`    ${bold(cyan(`npx society join ${publicCode}`))}`);

                        // Update registry with public multiaddr
                        registerNode(agentName, {
                            multiaddr: publicMultiaddr,
                            room: options.room,
                            peerId,
                            name: agentName,
                        }).then(ok => {
                            if (ok) {
                                console.log(`    ${bold(cyan(`npx society join ${agentName}`))}`);
                            }
                            console.log('');
                        });
                    }
                });

                process.on('SIGINT', () => { cfProc.kill(); });
            } else {
                console.log(`  ${yellow('Could not start relay.')} Share the local code above for LAN access.`);
            }
        } else {
            console.log(`  ${dim('For remote access, add')} ${cyan('--relay')} ${dim('to get a public invite code.')}`);
            console.log('');
        }

        // Keep running
        process.on('SIGINT', async () => {
            stopHeartbeat();
            await client.disconnect();
            process.exit(0);
        });
        process.stdin.resume();
    });

// ─── STATUS COMMAND ─────────────────────────────────────────────
// society status → show current state
program
    .command('status')
    .description('Show the status of your Society node')
    .option('--db <path>', 'SQLite database path')
    .action(async (options) => {
        const storage = new Storage(options.db ? { dbPath: options.db } : undefined);

        console.log('');
        console.log(`  ${bold('Society Protocol')} — Status`);
        console.log('');

        const identity = storage.getIdentity();
        if (identity) {
            console.log(`  Identity: ${bold(identity.display_name)} (${identity.did.slice(0, 24)}...)`);
        } else {
            console.log(`  Identity: ${dim('Not initialized yet. Run:')} ${cyan('npx society')}`);
        }

        const rooms = storage.query('SELECT DISTINCT room_id FROM rooms') as any[];
        if (rooms.length > 0) {
            console.log(`  Rooms:    ${rooms.map((r: any) => r.room_id).join(', ')}`);
        }

        const chains = storage.query('SELECT COUNT(*) as count FROM chains') as any[];
        console.log(`  Chains:   ${chains[0]?.count || 0} total`);

        const steps = storage.query("SELECT COUNT(*) as count FROM steps WHERE status = 'completed'") as any[];
        console.log(`  Steps:    ${steps[0]?.count || 0} completed`);

        console.log('');

        storage.close();
    });

// ─── MCP COMMAND ─────────────────────────────────────────────────
program
    .command('mcp')
    .description('Start MCP server for Claude, Cursor, Windsurf')
    .option('-n, --name <name>', 'agent name', process.env.SOCIETY_IDENTITY_NAME || 'MCP-Agent')
    .option('-r, --room <room>', 'default room', 'lobby')
    .option('-b, --bootstrap <addrs...>', 'bootstrap multiaddrs')
    .action(async (options) => {
        const client = await createClient({
            identity: { name: options.name },
            network: {
                bootstrap: options.bootstrap,
                enableGossipsub: true,
                enableDht: true,
            },
        });
        await client.joinRoom(options.room);
        const { SocietyMCPServer } = await import('./mcp/server.js');
        const server = new SocietyMCPServer({ client });
        await server.run();
    });

// ─── NODE COMMAND (power user) ──────────────────────────────────
program
    .command('node')
    .description('Start a Society node (advanced options)')
    .option('-n, --name <name>', 'display name', 'Agent')
    .option('-r, --room <room>', 'room ID to join', 'lobby')
    .option('-p, --port <port>', 'listen port (0 = random)', '0')
    .option('-b, --bootstrap <addrs...>', 'bootstrap multiaddrs')
    .option('--db <path>', 'SQLite database path')
    .option('--relay', 'spawn cloudflared to create a public WebSocket relay')
    .option('--gossipsub', 'enable GossipSub for scalable pub/sub', true)
    .option('--dht', 'enable DHT for peer discovery', true)
    .option('--encrypted', 'enable E2E encryption for all room messages')
    .option('--proactive', 'enable proactive agent behavior (watches room, intervenes when relevant)')
    .option('--mission-leader', 'enable proactive mission leadership with auto-restore', false)
    .option('--provider <provider>', 'AI planner provider (openai|anthropic|ollama)', 'openai')
    .option('--debug', 'enable debug logging')
    .action(async (options) => {
        await startNode(options);
    });

// ─── INIT COMMAND ─────────────────────────────────────────────────
import { AutoConfigurator, detectCI, detectContainer } from './autoconfig.js';
import { BootstrapManager } from './bootstrap.js';

program
    .command('init')
    .description('Interactive setup wizard for Society Protocol')
    .option('--quick', 'Quick setup with defaults')
    .option('--name <name>', 'Agent name')
    .option('--room <room>', 'Default room to join')
    .option('--template <name>', 'Default template for /summon')
    .action(async (options) => {
        await runInitWizard(options);
    });

program
    .command('dashboard')
    .description('Launch the Society Dashboard — visual mission control')
    .option('-p, --port <port>', 'Dashboard server port', '4200')
    .option('-n, --name <name>', 'Agent display name', 'Dashboard')
    .option('-r, --room <room>', 'Initial room to join', 'lobby')
    .option('-b, --bootstrap <addrs...>', 'Bootstrap peer addresses')
    .option('--connect <url>', 'Connect to existing Society node (remote mode)')
    .option('--p2p-port <port>', 'P2P listening port')
    .action(async (opts) => {
        try {
            const dashboardPath = resolve(
                realpathSync(fileURLToPath(import.meta.url)),
                '../../../dashboard/src/server/index.ts'
            );
            const args = ['tsx', dashboardPath, '--port', opts.port, '--name', opts.name, '--room', opts.room];
            if (opts.bootstrap) opts.bootstrap.forEach((b: string) => args.push('--bootstrap', b));
            if (opts.connect) args.push('--connect', opts.connect);
            if (opts.p2pPort) args.push('--p2p-port', opts.p2pPort);
            const child = spawn('npx', args, { stdio: 'inherit', cwd: resolve(realpathSync(fileURLToPath(import.meta.url)), '../../../dashboard') });
            child.on('error', (err) => { console.error('Failed to start dashboard:', err.message); process.exit(1); });
            child.on('exit', (code) => process.exit(code || 0));
        } catch (err: any) {
            console.error('Dashboard not found. Run from the society repo root or install society-dashboard.');
            console.error(err.message);
            process.exit(1);
        }
    });

const mission = program.command('mission').description('Manage proactive research missions');

mission
    .command('start')
    .requiredOption('--room <room>', 'room ID')
    .requiredOption('--goal <goal>', 'research goal')
    .option('--template <template>', 'mission template', 'literature_review_continuous')
    .option('--cadence-ms <ms>', 'mission cadence in milliseconds', '300000')
    .option('--detach', 'start mission and exit immediately instead of running leader loop', false)
    .option('--name <name>', 'identity/display name', 'Mission Leader')
    .option('--db <path>', 'SQLite database path')
    .option('--bootstrap <addrs...>', 'bootstrap multiaddrs')
    .action(async (options) => {
        const client = await createClient({
            identity: { name: options.name },
            storage: options.db ? { path: options.db } : undefined,
            network: {
                bootstrap: options.bootstrap,
                enableGossipsub: true,
                enableDht: true,
            },
            proactive: {
                enableLeadership: true,
                autoRestoreMissions: true,
            },
        });
        try {
            await client.joinRoom(options.room);
            const missionInfo = await client.startMission({
                roomId: options.room,
                goal: options.goal,
                missionType: 'scientific_research',
                templateId: options.template,
                mode: 'continuous',
                cadenceMs: parseInt(options.cadenceMs, 10),
                policy: {
                    autonomy: 'semiautonomous',
                    approvalGates: ['publish', 'external_write', 'costly_action'],
                    swarm: {
                        minWorkers: 2,
                        maxWorkers: 12,
                        targetUtilization: 0.7,
                        leaseMs: 120000,
                        rebalanceIntervalMs: 30000,
                    },
                    retry: {
                        maxStepRetries: 3,
                        maxMissionReplans: 20,
                        cooldownMs: 60000,
                    },
                },
                research: {
                    sources: ['arxiv', 'pubmed', 'crossref', 'semantic-scholar', 'web'],
                    subdomainsPerCycle: 4,
                    requireDualReview: true,
                    requireCitationExtraction: true,
                    requireContradictionScan: true,
                    synthesisIntervalMs: parseInt(options.cadenceMs, 10),
                },
                knowledge: { autoIndex: true },
            });
            console.log(JSON.stringify(missionInfo, null, 2));
            if (!options.detach) {
                console.log(`[mission] leader active for mission ${missionInfo.missionId}. Press Ctrl+C to stop.`);
                await new Promise<void>((resolve) => {
                    const done = () => resolve();
                    process.once('SIGINT', done);
                    process.once('SIGTERM', done);
                });
            }
        } finally {
            await client.disconnect();
        }
    });

mission
    .command('list')
    .option('--room <room>', 'optional room filter')
    .option('--name <name>', 'identity/display name', 'Mission Leader')
    .option('--db <path>', 'SQLite database path')
    .option('--bootstrap <addrs...>', 'bootstrap multiaddrs')
    .action(async (options) => {
        const client = await createClient({
            identity: { name: options.name },
            storage: options.db ? { path: options.db } : undefined,
            network: {
                bootstrap: options.bootstrap,
                enableGossipsub: true,
                enableDht: true,
            },
        });
        try {
            console.log(JSON.stringify(await client.listMissions(options.room), null, 2));
        } finally {
            await client.disconnect();
        }
    });

for (const action of ['pause', 'resume', 'stop'] as const) {
    mission
        .command(action)
        .requiredOption('--mission-id <id>', 'mission id')
        .option('--reason <reason>', 'stop reason')
        .option('--name <name>', 'identity/display name', 'Mission Leader')
        .option('--db <path>', 'SQLite database path')
        .option('--bootstrap <addrs...>', 'bootstrap multiaddrs')
        .action(async (options) => {
            const client = await createClient({
                identity: { name: options.name },
                storage: options.db ? { path: options.db } : undefined,
                network: {
                    bootstrap: options.bootstrap,
                    enableGossipsub: true,
                    enableDht: true,
                },
            });
            try {
                if (action === 'pause') await client.pauseMission(options.missionId);
                if (action === 'resume') await client.resumeMission(options.missionId);
                if (action === 'stop') await client.stopMission(options.missionId, options.reason);
                console.log(`${action}d ${options.missionId}`);
            } finally {
                await client.disconnect();
            }
        });
}

const swarm = program.command('swarm').description('Inspect swarm worker status');

swarm
    .command('status')
    .option('--room <room>', 'optional room filter')
    .option('--name <name>', 'identity/display name', 'Mission Leader')
    .option('--db <path>', 'SQLite database path')
    .option('--bootstrap <addrs...>', 'bootstrap multiaddrs')
    .action(async (options) => {
        const client = await createClient({
            identity: { name: options.name },
            storage: options.db ? { path: options.db } : undefined,
            network: {
                bootstrap: options.bootstrap,
                enableGossipsub: true,
                enableDht: true,
            },
        });
        try {
            console.log(JSON.stringify(await client.getSwarmStatus(options.room), null, 2));
        } finally {
            await client.disconnect();
        }
    });

const worker = program.command('worker').description('Run specialized Society workers');

worker
    .command('research')
    .requiredOption('--room <room>', 'mission room')
    .requiredOption('--host-id <id>', 'worker host identifier')
    .option('--runtime <runtime>', 'runtime type', 'nanobot')
    .option('--specialties <items...>', 'worker specialties')
    .option('--capabilities <items...>', 'worker capabilities')
    .option('--name <name>', 'identity/display name', 'Research Worker')
    .option('--db <path>', 'SQLite database path')
    .option('--bootstrap <addrs...>', 'bootstrap multiaddrs')
    .action(async (options) => {
        const client = await createClient({
            identity: { name: options.name },
            storage: options.db ? { path: options.db } : undefined,
            network: {
                bootstrap: options.bootstrap,
                enableGossipsub: true,
                enableDht: true,
            },
        });
        await client.startResearchWorker({
            roomId: options.room,
            hostId: options.hostId,
            runtime: options.runtime,
            specialties: options.specialties || ['research'],
            capabilities: options.capabilities || ['research', 'academic-search', 'evidence-extraction'],
        });
        console.log(`[worker] research worker active in room ${options.room}`);
        process.on('SIGINT', () => {
            client.disconnect().finally(() => process.exit(0));
        });
        process.stdin.resume();
    });

async function runInitWizard(options: any) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (prompt: string): Promise<string> => {
        return new Promise((resolve) => {
            rl.question(prompt, (answer) => resolve(answer.trim()));
        });
    };

    const choose = async (prompt: string, choices: string[]): Promise<string> => {
        console.log(`\n${prompt}`);
        choices.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
        const answer = await question('Select (number): ');
        const idx = parseInt(answer) - 1;
        return choices[idx] || choices[0];
    };

    const multichoose = async (prompt: string, choices: string[]): Promise<string[]> => {
        console.log(`\n${prompt}`);
        console.log('  (Space-separated numbers, e.g., "1 3")');
        choices.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
        const answer = await question('Select: ');
        const indices = answer.split(/\s+/).map(n => parseInt(n) - 1).filter(n => !isNaN(n) && n >= 0 && n < choices.length);
        return indices.map(i => choices[i]);
    };

    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════════╗');
    console.log('  ║         🚀 Society Protocol Setup Wizard                 ║');
    console.log('  ║           Let\'s get you connected!                      ║');
    console.log('  ╚══════════════════════════════════════════════════════════╝');
    console.log('');

    // Check if CI/container
    const ciInfo = detectCI();
    const isContainer = detectContainer();
    
    if (ciInfo.isCI) {
        console.log(`  ℹ️  Detected CI environment: ${ciInfo.provider}`);
    }
    if (isContainer) {
        console.log('  ℹ️  Detected container environment');
    }

    // Step 1: Auto-detect system
    console.log('\n📊 Analyzing your system...');
    const autoConfig = new AutoConfigurator();
    const config = await autoConfig.generateConfig();
    
    console.log(`  Environment: ${config.environment.type}`);
    console.log(`  CPU: ${config.resources.cpu.cores} cores`);
    console.log(`  Memory: ${(config.resources.memory.total / (1024**3)).toFixed(1)} GB`);
    console.log(`  Recommended mode: ${bold(config.usage.type.toUpperCase())}`);

    if (options.quick) {
        console.log('\n⚡ Quick mode: Using auto-detected settings...\n');
        await autoConfig.applyConfig(config);
        rl.close();
        console.log(green('✅ Setup complete!'));
        console.log(`\nNext steps:`);
        console.log(`  1. Start the node: ${cyan('society node')}`);
        console.log(`  2. Or customize: ${cyan('society init')} (without --quick)\n`);
        return;
    }

    // Step 2: What are you building?
    const useCase = await choose('What do you want to build?', [
        'Personal AI Assistant - Single agent for personal tasks',
        'Dev Team Collaboration - Code reviews, PR automation',
        'Research Group - Multi-agent research coordination',
        'Content Creation - Writing, editing, publishing pipeline',
        'Custom Setup - I\'ll configure everything manually'
    ]);

    // Step 3: AI Providers
    const providers = await multichoose('Which AI providers do you have access to?', [
        'OpenAI (GPT-4o)',
        'Anthropic (Claude)',
        'Ollama (local models)',
        'Custom/OpenRouter'
    ]);

    const primaryProvider = providers[0]?.toLowerCase().split(' ')[0] || 'openai';

    // Step 4: Agent identity
    const name = options.name || await question(`\nChoose your agent name (default: Agent): `) || 'Agent';

    // Step 5: Room setup
    const roomOption = await choose('\nRoom setup:', [
        'Create a new private room',
        'Join existing room by ID',
        'Start in public lobby'
    ]);

    let roomId: string;
    if (roomOption.includes('new')) {
        const roomName = await question('Room name (no spaces): ') || `${name.toLowerCase()}-room`;
        roomId = roomName.replace(/\s+/g, '-');
    } else if (roomOption.includes('existing')) {
        roomId = await question('Enter room ID: ') || 'lobby';
    } else {
        roomId = 'lobby';
    }

    // Step 6: Template preference
    const templateNames = Object.keys(TEMPLATES);
    let defaultTemplate = options.template;
    
    if (!defaultTemplate && templateNames.length > 0) {
        const templateChoice = await choose('\nDefault template for quick tasks:', [
            'None - I\'ll specify each time',
            ...templateNames.map(t => `${t} - ${TEMPLATES[t as keyof typeof TEMPLATES]?.description || 'Custom template'}`)
        ]);
        
        if (!templateChoice.includes('None')) {
            defaultTemplate = templateChoice.split(' ')[0];
        }
    }

    // Step 7: Security preferences
    console.log('\n🔒 Security Configuration:');
    const requireAuth = await choose('Require authentication for adapter API?', [
        'Yes - Generate API key (recommended)',
        'No - Allow local connections only'
    ]);

    const apiKey = requireAuth.includes('Yes') 
        ? Buffer.from(crypto.randomUUID()).toString('base64').slice(0, 32)
        : undefined;

    // Step 8: Apply configuration
    console.log('\n⚙️  Applying configuration...');
    
    // Save identity preference
    const storage = new Storage();
    const identity = generateIdentity(name);
    const privHex = uint8ToString(identity.privateKey, 'base16');
    const pubHex = uint8ToString(identity.publicKey, 'base16');
    storage.saveIdentity(identity.did, privHex, pubHex, name);

    // Generate config file
    const { writeFileSync, mkdirSync } = await import('fs');
    const { join } = await import('path');
    const { homedir } = await import('os');
    
    const configDir = join(homedir(), '.society');
    mkdirSync(configDir, { recursive: true });

    const userConfig = `
# Society Protocol - User Configuration
# Generated: ${new Date().toISOString()}

identity:
  name: "${name}"
  did: "${identity.did}"

room:
  default: "${roomId}"

ai:
  providers:
${providers.map(p => `    - ${p.toLowerCase().split(' ')[0]}`).join('\n')}
  primary: "${primaryProvider}"

${defaultTemplate ? `template:\n  default: "${defaultTemplate}"` : ''}

adapter:
  host: "127.0.0.1"
  port: ${config.recommended.apiPort}
  ${apiKey ? `auth:\n    type: bearer\n    api_key: "${apiKey}"` : 'auth:\n    type: none'}

network:
  mode: "${config.usage.type}"
  max_peers: ${config.recommended.maxPeers}
  bootstrap:
    dns_discovery: true
    fallback_peers: true
`;

    writeFileSync(join(configDir, 'config.yml'), userConfig.trim());
    await autoConfig.applyConfig(config);

    // Summary
    console.log('');
    console.log(green('✅ Setup complete!'));
    console.log('');
    console.log('📋 Configuration Summary:');
    console.log(`  Identity: ${cyan(name)} (${identity.did.slice(0, 20)}...)`);
    console.log(`  Room: ${cyan(roomId)}`);
    console.log(`  AI Provider: ${cyan(primaryProvider)}`);
    console.log(`  API Port: ${cyan(config.recommended.apiPort.toString())}`);
    if (apiKey) {
        console.log(`  API Key: ${cyan(apiKey)}`);
    }
    console.log('');
    console.log('🚀 Next steps:');
    console.log(`  1. Start your node: ${cyan('society node')}`);
    console.log(`  2. Or with options: ${cyan(`society node --name "${name}" --room ${roomId}`)}`);
    console.log(`  3. Start collaborating: ${cyan('/summon "Your task here"')}`);
    console.log('');
    console.log(`📚 Documentation: ${cyan('https://docs.society.dev')}`);
    console.log('');

    rl.close();
}

const isMainModule = (() => {
    const toRealPath = (candidate: string): string => {
        try {
            return realpathSync(candidate);
        } catch {
            return resolve(candidate);
        }
    };
    const entry = process.argv[1] ? toRealPath(process.argv[1]) : '';
    const current = toRealPath(fileURLToPath(import.meta.url));
    return entry === current;
})();

if (isMainModule) {
    program.parse();
}

// ─── Main ───────────────────────────────────────────────────────

interface NodeOptions {
    name: string;
    room: string;
    port: string;
    bootstrap?: string[];
    db?: string;
    relay?: boolean;
    gossipsub?: boolean;
    dht?: boolean;
    encrypted?: boolean;
    proactive?: boolean;
    missionLeader?: boolean;
    provider: PlannerProvider;
    debug?: boolean;
}

async function startNode(options: NodeOptions) {
    const DEBUG = options.debug || process.env.SOCIETY_DEBUG === 'true';
    
    // Banner
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════════╗');
    console.log('  ║              🌐 Society Protocol v1.0                    ║');
    console.log('  ╠══════════════════════════════════════════════════════════╣');
    console.log('  ║  GossipSub · Kad-DHT · did:key · CRDT · Reputation      ║');
    console.log('  ╚══════════════════════════════════════════════════════════╝');
    console.log('');

    // 1. Initialize storage
    const storage = new Storage(options.db ? { dbPath: options.db } : undefined);
    console.log('[init] Storage initialized.');

    // 2. Initialize or restore identity
    let identity: Identity;
    const existingIdentity = storage.getIdentity();
    if (existingIdentity) {
        identity = restoreIdentity(existingIdentity.private_key_hex, options.name);
        console.log(`[init] Identity restored: ${identity.did.slice(0, 32)}...`);
    } else {
        identity = generateIdentity(options.name);
        const privHex = uint8ToString(identity.privateKey, 'base16');
        const pubHex = uint8ToString(identity.publicKey, 'base16');
        storage.saveIdentity(identity.did, privHex, pubHex, identity.displayName);
        console.log(`[init] New identity generated: ${identity.did.slice(0, 32)}...`);
    }
    console.log(`[init] Display name: ${bold(identity.displayName)}`);

    // 3. Initialize reputation engine
    const reputation = new ReputationEngine(storage);
    console.log('[init] Reputation engine ready.');

    // 4. Discover bootstrap peers when --bootstrap is not provided
    let bootstrapAddrs = options.bootstrap;
    if (!bootstrapAddrs?.length) {
        try {
            const bootstrapManager = new BootstrapManager();
            const peers = await bootstrapManager.discover();
            bootstrapAddrs = peers.flatMap((peer) => peer.addrs);
            if (bootstrapAddrs.length > 0) {
                console.log(`[bootstrap] Discovered ${bootstrapAddrs.length} bootstrap addresses`);
            }
        } catch (err: any) {
            console.warn(`[bootstrap] Discovery unavailable: ${err?.message || 'unknown error'}`);
            console.warn('[bootstrap] Continuing with local discovery only (mDNS/DHT).');
        }
    }

    // 5. Start P2P node
    const p2p = new P2PNode();
    await p2p.start({
        port: parseInt(options.port, 10),
        bootstrapAddrs,
        enableMdns: true,
        enableDht: options.dht,
        enableGossipsub: options.gossipsub,
    });

    // 6. Initialize room manager + encryption
    const rooms = new RoomManager(identity, p2p, storage);

    if (options.encrypted) {
        const { SecurityManager } = await import('./security.js');
        const security = new SecurityManager(identity);
        p2p.setSecurityManager(security);
        await security.generateKeyPair();
        console.log(`[init] E2E encryption enabled (AES-256-GCM + X25519)`);
    }

    // 7. Join room
    const roomId = options.room;
    await rooms.joinRoom(roomId, roomId);
    if (options.encrypted) {
        rooms.enableEncryption(roomId);
    }
    console.log(`[init] Joined room: ${roomId}${options.encrypted ? ' (encrypted)' : ''}`);

    // 8. Initialize CoC Engine with reputation
    const coc = new CocEngine(identity, rooms, storage, reputation);

    // 9. Initialize Planner with multi-provider support
    const planner = new Planner({
        provider: options.provider,
        enableCache: true,
        fallbackChain: ['openai', 'anthropic', 'ollama'],
    });

    // 10. Initialize Adapter Host (localhost-only with optional API key)
    const adapterPort = parseInt(process.env.SOCIETY_ADAPTER_PORT || '8080', 10);
    const adapterHost = new AdapterHost(storage, coc, {
        port: adapterPort,
        host: '127.0.0.1',  // Localhost only for security
        security: {
            apiKey: process.env.SOCIETY_API_KEY,  // Optional: require API key
            rateLimitEnabled: true,
            rateLimitMaxRequests: 1000,
            securityHeaders: true,
        }
    });
    adapterHost.start();
    console.log(`[init] Adapter Host listening on 127.0.0.1:${adapterPort}`);
    if (process.env.SOCIETY_API_KEY) {
        console.log('[init] API Key authentication enabled');
    } else {
        console.log('[init] WARNING: No API key set. Set SOCIETY_API_KEY for production.');
    }

    // 11. Initialize Capsule Exporter
    const exporter = new CapsuleExporter(coc, storage);

    // 12. Initialize federation/integration stack (Federation Mesh)
    const federation = new FederationEngine(storage, identity);
    const knowledge = new KnowledgePool(storage, identity);
    rooms.setKnowledgePool(knowledge); // Enable conversational knowledge exchange
    const skills = new SkillsEngine(storage, identity);
    const security = new SecurityManager(identity);
    const persona = new PersonaVaultEngine(storage, identity.did, {
        defaultVaultName: `${identity.displayName} Persona Vault`,
    });
    const integration = new IntegrationEngine(
        storage,
        identity,
        federation,
        rooms,
        knowledge,
        coc,
        skills,
        security
    );
    integration.attachPersonaVault(persona);
    const proactiveLeader = options.missionLeader
        ? new ProactiveMissionEngine(
            identity,
            storage,
            rooms,
            coc,
            planner,
            knowledge,
            undefined,
            undefined,
            {
                enableLeadership: true,
                autoRestoreMissions: true,
            }
        )
        : undefined;
    if (proactiveLeader) {
        console.log('[init] Mission leader mode enabled (auto-restore active).');
    }

    // Initialize ProactiveWatcher if --proactive flag
    let proactiveWatcher: ProactiveWatcher | undefined;
    if (options.proactive) {
        proactiveWatcher = new ProactiveWatcher(identity, {
            level: 1,
            specialties: [],
        });
        proactiveWatcher.watch(rooms, knowledge);
        console.log(`[init] Proactive watcher enabled (level ${proactiveWatcher.getLevel()})`);
    }

    console.log('');
    console.log('  Type a message and press Enter to send.');
    console.log('  Commands: /peers /rooms /presence /reputation /info /history');
    console.log('            /summon /template /chains /step /export /quit');
    console.log('            /mesh-request /mesh-peerings /mesh-open /mesh-bridges /mesh-stats');
    console.log('  ──────────────────────────────────────────────────────────────');
    console.log('');

    // ─── Event Listeners ────────────────────────────────────────

    rooms.on('chat:message', (_roomId: string, envelope: SwpEnvelope) => {
        const body = envelope.body as unknown as ChatMsgBody;
        const time = new Date(envelope.ts).toLocaleTimeString();
        process.stdout.write('\r\x1b[K');
        
        // Show reputation badge if available
        const repBadge = '';
        
        console.log(`  ${dim(time)} ${bold(cyan(envelope.from.name))}${repBadge}: ${body.text}`);
        rl.prompt(true);
    });

    rooms.on('presence:update', (_roomId: string, envelope: SwpEnvelope) => {
        if (envelope.from.did === identity.did) return; // Skip own presence
        const body = envelope.body as any;
        if (body.status === 'online') {
            process.stdout.write('\r\x1b[K');
            console.log(`  ${dim('→')} ${green(envelope.from.name)} is online`);
            rl.prompt(true);
        }
    });

    p2p.on('peer:connected', (peerId: string) => {
        process.stdout.write('\r\x1b[K');
        console.log(`  ${dim('⚡')} Peer connected: ${dim(peerId.slice(0, 20))}...`);
        rl.prompt(true);
    });

    p2p.on('peer:disconnected', (peerId: string) => {
        process.stdout.write('\r\x1b[K');
        console.log(`  ${dim('⚡')} Peer disconnected: ${dim(peerId.slice(0, 20))}...`);
        rl.prompt(true);
    });

    coc.on('chain:opened', (chainId: string, goal: string) => {
        process.stdout.write('\r\x1b[K');
        console.log(`\n  ${bold(cyan('⛓️  Chain Opened'))}: ${goal.slice(0, 60)}${goal.length > 60 ? '...' : ''}`);
        console.log(`     ID: ${dim(chainId)}`);
        rl.prompt(true);
    });

    coc.on('chain:planned', (chainId: string, dag: CocDagNode[]) => {
        process.stdout.write('\r\x1b[K');
        console.log(`  ${bold(cyan('🗺️  Plan Ready'))}: ${dag.length} steps`);
        if (DEBUG) {
            dag.forEach((step, i) => {
                const deps = step.depends_on.length > 0 ? ` ← ${step.depends_on.join(', ')}` : '';
                console.log(`     ${i + 1}. [${step.kind}] ${step.title}${deps}`);
            });
        }
        rl.prompt(true);
    });

    coc.on('step:unlocked', (chainId: string, stepId: string, step: any) => {
        process.stdout.write('\r\x1b[K');
        console.log(`  ${bold(yellow('🔓 Step Unlocked'))}: [${stepId}] ${step.title}`);
        rl.prompt(true);
    });

    coc.on('step:assigned', (chainId: string, stepId: string, assignee: string) => {
        process.stdout.write('\r\x1b[K');
        console.log(`  ${bold(blue('👤 Assigned'))}: [${stepId}] → ${assignee.slice(0, 20)}...`);
        rl.prompt(true);
    });

    coc.on('step:submitted', (chainId: string, stepId: string, status: string) => {
        process.stdout.write('\r\x1b[K');
        const icon = status === 'completed' ? '✅' : '❌';
        console.log(`  ${icon} Step ${stepId}: ${status}`);
        rl.prompt(true);
    });

    coc.on('step:expired', (chainId: string, stepId: string, oldAssignee: string) => {
        process.stdout.write('\r\x1b[K');
        console.log(`  ${bold(red('⏰ Lease Expired'))}: [${stepId}] reassigning from ${oldAssignee.slice(0, 16)}...`);
        rl.prompt(true);
    });

    coc.on('chain:completed', (chainId: string) => {
        process.stdout.write('\r\x1b[K');
        console.log(`\n  ${bold(green('✅ Chain Completed'))}: ${chainId}\n`);
        rl.prompt(true);

        // Post-chain knowledge distillation
        const chain = coc.getChain(chainId);
        if (chain && knowledge) {
            const participants = [...new Set(chain.steps.map(s => s.assignee_did).filter(Boolean) as string[])];
            knowledge.distillChainExperience(
                chainId,
                chain.final_report || chain.goal,
                chain.goal,
                chain.room_id,
                participants.length > 0 ? participants : [identity.did]
            ).then(cards => {
                if (cards.length > 0) {
                    process.stdout.write('\r\x1b[K');
                    console.log(`  ${dim(`📚 Distilled ${cards.length} knowledge card(s) from chain`)}`);
                    rl.prompt(true);
                }
            }).catch(() => {});
        }
    });

    // ─── Interactive REPL ───────────────────────────────────────

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${dim(identity.displayName)} ${dim('>')} `,
    });

    rl.prompt();

    let cloudflaredProc: any = null;

    // Start relay if requested
    if (options.relay) {
        const wsPort = options.port === '0' ? 0 : parseInt(options.port, 10) + 1;
        if (wsPort === 0) {
            console.warn(yellow('  [warn] --relay requires a fixed --port. Ignoring relay.'));
        } else {
            // Auto-install cloudflared if missing
            if (!isCommandAvailable('cloudflared')) {
                console.log(`  ${yellow('cloudflared not found.')} Installing automatically...`);
                if (!await installCloudflared()) {
                    console.warn(yellow('  [warn] Failed to install cloudflared. Skipping relay.'));
                }
            }

            if (!isCommandAvailable('cloudflared')) {
                console.warn(yellow('  [warn] cloudflared still not available. Skipping relay.'));
            } else {

            console.log(`  ${dim('🌐')} Spawning cloudflared relay to localhost:${wsPort}...`);
            cloudflaredProc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${wsPort}`]);

            cloudflaredProc.stderr?.on('data', (data: Buffer) => {
                const str = data.toString();
                const match = str.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
                if (match) {
                    process.stdout.write('\r\x1b[K');
                    const host = match[1].replace('https://', '');
                    const relayMultiaddr = `/dns4/${host}/tcp/443/wss/p2p/${p2p.getPeerId()}`;
                    const code = encodeInvite(relayMultiaddr, options.room);
                    console.log(`\n  ${bold(green('Relay active!'))} Share this with anyone:`);
                    console.log(`  ${cyan(`npx society join ${code}`)}`);

                    // Register name in registry
                    registerNode(options.name, {
                        multiaddr: relayMultiaddr,
                        room: options.room,
                        peerId: p2p.getPeerId()!,
                        name: options.name,
                    }).then(ok => {
                        if (ok) {
                            console.log(`  ${cyan(`npx society join ${options.name}`)}`);
                        }
                        console.log('');
                        rl.prompt(true);
                    });

                }
            });
            } // end cloudflared available check
        }
    }

    // Command loop
    rl.on('line', async (line: string) => {
        const input = line.trim();
        if (!input) {
            rl.prompt();
            return;
        }

        if (input.startsWith('/')) {
            await handleCommand(input, {
                identity,
                p2p,
                rooms,
                storage,
                coc,
                planner,
                reputation,
                exporter,
                federation,
                integration,
                knowledge,
                proactiveWatcher,
                roomId,
                DEBUG,
            });
            rl.prompt();
            return;
        }

        // Send chat message
        try {
            await rooms.sendChatMessage(roomId, input, { formatting: 'plain' });
            const time = new Date().toLocaleTimeString();
            console.log(`  ${dim(time)} ${bold(yellow('you'))}: ${input}`);
        } catch (err) {
            console.error(`  ${red('Error:')} ${(err as Error).message}`);
        }

        rl.prompt();
    });

    rl.on('close', async () => {
        console.log('\n[shutdown] Cleaning up...');
        if (cloudflaredProc) {
            cloudflaredProc.kill();
        }
        stopHeartbeat();
        proactiveLeader?.destroy();
        skills.stop();
        adapterHost.stop();
        coc.destroy();
        rooms.destroy();
        await p2p.stop();
        storage.close();
        process.exit(0);
    });

    process.on('SIGINT', () => {
        rl.close();
    });
}

// ─── Command Handler ────────────────────────────────────────────

interface CommandContext {
    identity: Identity;
    p2p: P2PNode;
    rooms: RoomManager;
    storage: Storage;
    coc: CocEngine;
    planner: Planner;
    reputation: ReputationEngine;
    exporter: CapsuleExporter;
    federation: FederationEngine;
    integration: IntegrationEngine;
    knowledge?: any; // KnowledgePool if initialized
    proactiveWatcher?: ProactiveWatcher;
    roomId: string;
    DEBUG: boolean;
}

async function handleCommand(input: string, ctx: CommandContext) {
    const [cmd, ...args] = input.split(' ');

    switch (cmd) {
        case '/peers': {
            const peers = ctx.p2p.getPeers();
            const latencies = ctx.p2p.getConnectedPeers().map(p => ({
                id: p.id.slice(0, 16),
                latency: p.latency,
            }));

            if (peers.length === 0) {
                console.log('  No connected peers.');
            } else {
                console.log(`  Connected peers (${peers.length}):`);
                latencies.forEach(p => {
                    const lat = p.latency ? `${p.latency}ms` : 'N/A';
                    console.log(`    • ${p.id}... (${dim(lat)})`);
                });
            }
            break;
        }

        case '/rooms': {
            const joined = ctx.rooms.getJoinedRooms();
            console.log(`  Joined rooms: ${joined.join(', ')}`);
            break;
        }

        case '/mesh-request': {
            const sourceFederationId = args[0];
            const targetFederationDid = args[1];
            const policyInput = args.slice(2).join(' ').trim();

            if (!sourceFederationId || !targetFederationDid) {
                console.log('  Usage: /mesh-request <source_federation_id> <target_federation_did> [policy_json]');
                break;
            }

            try {
                const policy = policyInput ? JSON.parse(policyInput) : {};
                const peering = await ctx.federation.requestPeering(sourceFederationId, targetFederationDid, policy);
                console.log(`  ${green('✓')} Peering requested: ${peering.id}`);
                console.log(`    status=${peering.status} target=${peering.targetFederationDid}`);
            } catch (err) {
                console.log(`  ${red('Error:')} ${(err as Error).message}`);
            }
            break;
        }

        case '/mesh-accept': {
            const peeringId = args[0];
            const reason = args.slice(1).join(' ') || undefined;
            if (!peeringId) {
                console.log('  Usage: /mesh-accept <peering_id> [reason]');
                break;
            }

            try {
                const peering = await ctx.federation.respondPeering(peeringId, true, reason);
                console.log(`  ${green('✓')} Peering accepted: ${peering.id}`);
            } catch (err) {
                console.log(`  ${red('Error:')} ${(err as Error).message}`);
            }
            break;
        }

        case '/mesh-reject': {
            const peeringId = args[0];
            const reason = args.slice(1).join(' ') || undefined;
            if (!peeringId) {
                console.log('  Usage: /mesh-reject <peering_id> [reason]');
                break;
            }

            try {
                const peering = await ctx.federation.respondPeering(peeringId, false, reason);
                console.log(`  ${yellow('⚠')} Peering rejected: ${peering.id}`);
            } catch (err) {
                console.log(`  ${red('Error:')} ${(err as Error).message}`);
            }
            break;
        }

        case '/mesh-revoke': {
            const peeringId = args[0];
            const reason = args.slice(1).join(' ') || undefined;
            if (!peeringId) {
                console.log('  Usage: /mesh-revoke <peering_id> [reason]');
                break;
            }

            try {
                const peering = await ctx.federation.revokePeering(peeringId, reason);
                console.log(`  ${yellow('⚠')} Peering revoked: ${peering.id}`);
            } catch (err) {
                console.log(`  ${red('Error:')} ${(err as Error).message}`);
            }
            break;
        }

        case '/mesh-peerings': {
            const federationId = args[0];
            const status = args[1] as 'pending' | 'active' | 'rejected' | 'revoked' | undefined;
            if (!federationId) {
                console.log('  Usage: /mesh-peerings <federation_id> [pending|active|rejected|revoked]');
                break;
            }

            const peerings = ctx.federation.listPeerings(federationId, status);
            if (peerings.length === 0) {
                console.log('  No peerings found.');
                break;
            }
            console.log(`  Peerings (${peerings.length}):`);
            for (const peering of peerings) {
                console.log(`    • ${peering.id} [${peering.status}] -> ${peering.targetFederationDid}`);
            }
            break;
        }

        case '/mesh-open': {
            const peeringId = args[0];
            const localRoomId = args[1];
            const remoteRoomId = args[2];
            const rulesInput = args.slice(3).join(' ').trim();
            if (!peeringId || !localRoomId || !remoteRoomId) {
                console.log('  Usage: /mesh-open <peering_id> <local_room_id> <remote_room_id> [rules_json]');
                break;
            }

            try {
                const rules = rulesInput ? JSON.parse(rulesInput) : undefined;
                const bridge = await ctx.integration.openMeshBridge(peeringId, localRoomId, remoteRoomId, rules);
                console.log(`  ${green('✓')} Mesh bridge opened: ${bridge.id}`);
                console.log(`    ${bridge.localRoomId} -> ${bridge.remoteRoomId}`);
            } catch (err) {
                console.log(`  ${red('Error:')} ${(err as Error).message}`);
            }
            break;
        }

        case '/mesh-close': {
            const bridgeId = args[0];
            if (!bridgeId) {
                console.log('  Usage: /mesh-close <bridge_id>');
                break;
            }

            try {
                await ctx.integration.closeMeshBridge(bridgeId);
                console.log(`  ${green('✓')} Mesh bridge closed: ${bridgeId}`);
            } catch (err) {
                console.log(`  ${red('Error:')} ${(err as Error).message}`);
            }
            break;
        }

        case '/mesh-bridges': {
            const federationId = args[0];
            const bridges = ctx.integration.listMeshBridges(federationId);
            if (bridges.length === 0) {
                console.log('  No mesh bridges found.');
                break;
            }

            console.log(`  Bridges (${bridges.length}):`);
            for (const bridge of bridges) {
                console.log(
                    `    • ${bridge.id} [${bridge.status}] ${bridge.localRoomId} -> ${bridge.remoteRoomId} ` +
                    `(in=${bridge.eventsIn}, out=${bridge.eventsOut})`
                );
            }
            break;
        }

        case '/mesh-stats': {
            const federationId = args[0];
            const stats = ctx.integration.getMeshStats(federationId);
            console.log(`  Mesh stats${federationId ? ` (${federationId})` : ''}:`);
            console.log(`    bridges: ${stats.bridgeCount} (${stats.activeBridges} active)`);
            console.log(`    events: in=${stats.eventsIn} out=${stats.eventsOut}`);
            if (stats.lastSyncAt) {
                console.log(`    last_sync: ${new Date(stats.lastSyncAt).toISOString()}`);
            }
            break;
        }

        case '/presence': {
            const online = ctx.rooms.getOnlinePeers();
            if (online.length === 0) {
                console.log('  No online peers detected.');
            } else {
                console.log(`  Online peers (${online.length}):`);
                for (const p of online) {
                    const caps = p.capabilities ? JSON.parse(p.capabilities).slice(0, 3).join(', ') : '';
                    console.log(`    • ${p.peer_name || 'unknown'} — ${dim(caps)}`);
                }
            }
            break;
        }

        case '/reputation': {
            const targetDid = args[0] || ctx.identity.did;
            try {
                const rep = await ctx.reputation.getReputation(targetDid);
                console.log(`  Reputation for ${targetDid.slice(0, 32)}...`);
                console.log(`    Tier: ${formatReputationTier(rep.trust_tier)}`);
                console.log(`    Overall: ${(rep.overall * 100).toFixed(1)}%`);
                console.log(`    Tasks: ${rep.metrics.tasks_completed} completed, ${rep.metrics.tasks_failed} failed`);
                console.log(`    Quality: ${(rep.metrics.avg_quality_score * 100).toFixed(1)}%`);
                console.log(`    On-time: ${(rep.metrics.on_time_delivery * 100).toFixed(1)}%`);
                if (rep.specialties.length > 0) {
                    console.log(`    Top specialties:`);
                    rep.specialties.slice(0, 5).forEach(s => {
                        console.log(`      • ${s.specialty}: ${(s.score * 100).toFixed(0)}%`);
                    });
                }
            } catch (err) {
                console.log(`  ${red('Error:')} ${(err as Error).message}`);
            }
            break;
        }

        case '/info': {
            console.log(`  Identity: ${ctx.identity.did}`);
            console.log(`  Name: ${ctx.identity.displayName}`);
            console.log(`  PeerId: ${ctx.p2p.getPeerId()}`);
            console.log(`  Addresses: ${ctx.p2p.getMultiaddrs().join(', ')}`);
            console.log(`  Room: ${ctx.roomId}`);
            console.log(`  Peers: ${ctx.p2p.getPeers().length}`);
            console.log(`  Providers: ${ctx.planner.getAvailableProviders().join(', ')}`);
            break;
        }

        case '/history': {
            const messages = ctx.rooms.getMessages(ctx.roomId, 20);
            if (messages.length === 0) {
                console.log('  No messages in history.');
            } else {
                messages.reverse().forEach((m) => {
                    const time = new Date(m.ts).toLocaleTimeString();
                    const isMe = m.from_did === ctx.identity.did;
                    const name = isMe ? yellow('you') : cyan(m.from_name ?? 'unknown');
                    console.log(`  ${dim(time)} ${bold(name)}: ${m.text}`);
                });
            }
            break;
        }

        case '/summon': {
            const goal = args.join(' ');
            if (!goal) {
                console.log('  Usage: /summon <goal description>');
                break;
            }
            if (!ctx.planner.isReady()) {
                console.error(`  ${red('Error:')} No AI providers available. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.`);
                break;
            }

            console.log(`  ${dim('🤖')} Planning collaboration for: "${goal.slice(0, 50)}${goal.length > 50 ? '...' : ''}"`);
            
            try {
                const startTime = Date.now();
                const planResult = await ctx.planner.generatePlan(goal);
                const latency = Date.now() - startTime;
                
                console.log(`  ${green('✓')} Plan generated in ${latency}ms via ${planResult.provider}`);
                
                // Open chain
                const chainId = await ctx.coc.openChain(ctx.roomId, goal, { priority: 'normal' });
                
                // Publish plan
                await ctx.coc.publishPlan(ctx.roomId, chainId, planResult.dag, `${planResult.provider}/${planResult.model}`);
                
            } catch (err: any) {
                console.error(`  ${red('Error:')} ${err.message}`);
            }
            break;
        }

        case '/template': {
            const templateId = args[0];
            const goal = args.slice(1).join(' ');

            if (!templateId || !goal) {
                console.log('  Usage: /template <template_name> <goal>');
                console.log(`  Available: ${Object.keys(TEMPLATES).join(', ')}`);
                break;
            }

            try {
                const template = getTemplate(templateId);
                console.log(`  ${dim('⚡')} Using template "${templateId}"`);

                const chainId = await ctx.coc.openChain(ctx.roomId, goal, { templateId });
                const dag = template.generate(goal);
                await ctx.coc.publishPlan(ctx.roomId, chainId, dag, `template/${templateId}`);
                
            } catch (err: any) {
                console.error(`  ${red('Error:')} ${err.message}`);
            }
            break;
        }

        case '/chains': {
            const chains = ctx.coc.getActiveChains();
            if (chains.length === 0) {
                console.log('  No active chains.');
            } else {
                chains.forEach(c => {
                    const statusColor = c.status === 'completed' ? green : c.status === 'running' ? yellow : red;
                    const progress = c.steps.filter(s => s.status === 'merged' || s.status === 'submitted').length;
                    console.log(`  [${statusColor(c.status)}] ${c.chain_id.slice(0, 8)}... — ${progress}/${c.steps.length} steps — ${c.goal.slice(0, 40)}${c.goal.length > 40 ? '...' : ''}`);
                });
            }
            break;
        }

        case '/chain': {
            const chainId = args[0];
            if (!chainId) {
                console.log('  Usage: /chain <chain_id>');
                break;
            }
            
            const chain = ctx.coc.getChain(chainId);
            if (!chain) {
                console.log('  Chain not found.');
                break;
            }
            
            console.log(`  Chain: ${chainId}`);
            console.log(`  Goal: ${chain.goal}`);
            console.log(`  Status: ${chain.status}`);
            console.log(`  Steps:`);
            chain.steps.forEach(s => {
                const statusIcon = s.status === 'merged' ? '✅' : s.status === 'assigned' ? '👤' : s.status === 'proposed' ? '○' : '◐';
                const assignee = s.assignee_did ? ` @${s.assignee_did.slice(0, 8)}...` : '';
                console.log(`    ${statusIcon} [${s.kind}] ${s.title}${assignee}`);
            });
            break;
        }

        case '/step': {
            const stepId = args[0];
            const status = args[1] as 'completed' | 'failed';
            const memo = args.slice(2).join(' ') || 'Manual submission';
            
            if (!stepId || !status) {
                console.log('  Usage: /step <step_id> <completed|failed> [memo...]');
                break;
            }

            try {
                // Find chain for this step
                const chains = ctx.coc.getActiveChains();
                let chainId: string | null = null;
                
                for (const chain of chains) {
                    if (chain.steps.find(s => s.step_id === stepId)) {
                        chainId = chain.chain_id;
                        break;
                    }
                }
                
                if (!chainId) {
                    // Try storage
                    const step = ctx.storage.db.prepare('SELECT chain_id FROM coc_steps WHERE step_id = ?').get(stepId) as any;
                    if (step) chainId = step.chain_id;
                }
                
                if (!chainId) {
                    console.log('  Step not found in any chain.');
                    break;
                }

                const artifacts: Artifact[] = []; // Could parse from input
                await ctx.coc.submitStep(ctx.roomId, chainId, stepId, status, memo, artifacts);
                console.log(`  ${green('✓')} Step ${stepId} marked as ${status}`);
                
            } catch (err: any) {
                console.error(`  ${red('Error:')} ${err.message}`);
            }
            break;
        }

        case '/assign': {
            const [stepId, assignee] = args;
            if (!stepId || !assignee) {
                console.log('  Usage: /assign <step_id> <assignee_did>');
                break;
            }
            
            const chains = ctx.coc.getActiveChains();
            const chain = chains.find(c => c.steps.find(s => s.step_id === stepId));
            
            if (!chain) {
                console.log('  Step not found.');
                break;
            }
            
            await ctx.coc.assignStep(ctx.roomId, chain.chain_id, stepId, assignee);
            console.log(`  ${green('✓')} Assigned ${stepId} to ${assignee.slice(0, 20)}...`);
            break;
        }

        case '/review': {
            const [stepId, decision] = args;
            const notes = args.slice(2).join(' ') || 'Reviewed';
            
            if (!stepId || !['approved', 'rejected', 'needs_revision'].includes(decision)) {
                console.log('  Usage: /review <step_id> <approved|rejected|needs_revision> [notes...]');
                break;
            }
            
            const chains = ctx.coc.getActiveChains();
            const chain = chains.find(c => c.steps.find(s => s.step_id === stepId));
            
            if (!chain) {
                console.log('  Step not found.');
                break;
            }
            
            await ctx.coc.reviewStep(ctx.roomId, chain.chain_id, stepId, decision as any, notes);
            console.log(`  ${green('✓')} Reviewed ${stepId} as ${decision}`);
            break;
        }

        case '/cancel': {
            const chainId = args[0];
            if (!chainId) {
                console.log('  Usage: /cancel <chain_id>');
                break;
            }
            
            await ctx.coc.closeChain(ctx.roomId, chainId, 'cancelled', 'Cancelled by user');
            console.log(`  ${yellow('⚠')} Chain ${chainId.slice(0, 8)}... cancelled`);
            break;
        }

        case '/export': {
            const chainId = args[0];
            if (!chainId) {
                console.log('  Usage: /export <chain_id>');
                break;
            }

            console.log(`  ${dim('📦')} Packaging chain ${chainId.slice(0, 8)}... into a .society Capsule...`);
            try {
                const outputPath = await ctx.exporter.export(chainId, process.cwd());
                console.log(`  ${bold(green('✅ Export Complete!'))}`);
                console.log(`  ${cyan(outputPath)}`);
            } catch (err: any) {
                console.error(`  ${red('Export Error:')} ${err.message}`);
            }
            break;
        }

        case '/cache': {
            const stats = ctx.planner.getCacheStats();
            console.log(`  Planner cache: ${stats.size}/${stats.maxSize} entries`);
            if (ctx.DEBUG && stats.keys.length > 0) {
                console.log(`  Keys: ${stats.keys.slice(0, 10).join(', ')}${stats.keys.length > 10 ? '...' : ''}`);
            }
            break;
        }

        case '/share': {
            const filePath = args.join(' ').trim();
            if (!filePath) {
                console.log(`  Usage: /share <filepath>`);
                break;
            }
            try {
                const { ContentStore } = await import('./content-store.js');
                const contentStore = new ContentStore(ctx.storage);
                const manifest = await contentStore.storeFile(filePath, ctx.identity.did);
                const sizeKB = (manifest.totalSize / 1024).toFixed(1);
                console.log(`  ${green('Shared!')} ${manifest.fileName} (${sizeKB}KB, ${manifest.blocks.length} blocks)`);
                console.log(`  CID: ${dim(manifest.rootCid.slice(0, 16))}...`);

                // Broadcast manifest to room
                const body = { type: 'artifact.offer', manifest };
                const swp = await import('./swp.js');
                const envelope = swp.createEnvelope(
                    ctx.identity, 'artifact.offer' as any, ctx.roomId, body
                );
                const data = new TextEncoder().encode(JSON.stringify(envelope));
                await ctx.p2p.publish(`${ctx.roomId}/artifacts`, data);
            } catch (err: any) {
                console.log(`  Error: ${err.message}`);
            }
            break;
        }

        case '/files': {
            try {
                const { ContentStore } = await import('./content-store.js');
                const contentStore = new ContentStore(ctx.storage);
                const files = contentStore.listFiles();
                if (files.length === 0) {
                    console.log(`  No files shared yet. Use /share <filepath>`);
                } else {
                    console.log(`  ${bold('Shared files:')}`);
                    for (const f of files) {
                        const sizeKB = (f.totalSize / 1024).toFixed(1);
                        const date = new Date(f.createdAt).toLocaleTimeString();
                        console.log(`    ${f.fileName} (${sizeKB}KB) — ${dim(date)} — CID: ${dim(f.rootCid.slice(0, 12))}...`);
                    }
                }
            } catch (err: any) {
                console.log(`  Error: ${err.message}`);
            }
            break;
        }

        case '/encrypt': {
            const subCmd = args[0]?.toLowerCase();
            if (subCmd === 'on') {
                ctx.rooms.enableEncryption(ctx.roomId);
                console.log(`  ${green('E2E encryption enabled')} for this room`);
            } else if (subCmd === 'off') {
                ctx.rooms.disableEncryption(ctx.roomId);
                console.log(`  Encryption disabled for this room`);
            } else {
                const status = ctx.rooms.isEncrypted(ctx.roomId) ? green('ON') : 'OFF';
                console.log(`  Encryption: ${status}`);
                console.log(`  Usage: /encrypt on | /encrypt off`);
            }
            break;
        }

        case '/context': {
            const knowledge = ctx.knowledge;
            if (!knowledge) {
                console.log(`  Knowledge system not available`);
                break;
            }
            const sharedCtx = knowledge.getSharedContext(ctx.roomId);
            if (sharedCtx) {
                console.log(sharedCtx);
            } else {
                console.log(`  No shared context yet. Chat to build collaborative knowledge.`);
            }
            break;
        }

        case '/proactive': {
            const subCmd = args[0];
            if (!ctx.proactiveWatcher) {
                console.log(`  Proactive watcher not initialized. Start with --proactive flag.`);
                break;
            }
            if (subCmd === 'on') {
                ctx.proactiveWatcher.setLevel(1);
                console.log(`  Proactive watcher: ${green('ON')} (level 1 - moderate)`);
            } else if (subCmd === 'off') {
                ctx.proactiveWatcher.setLevel(0);
                console.log(`  Proactive watcher: OFF`);
            } else if (subCmd === '2' || subCmd === 'aggressive') {
                ctx.proactiveWatcher.setLevel(2);
                console.log(`  Proactive watcher: ${green('ON')} (level 2 - aggressive)`);
            } else {
                const level = ctx.proactiveWatcher.getLevel();
                const labels = ['OFF', 'moderate', 'aggressive'];
                console.log(`  Proactive watcher: level ${level} (${labels[level]})`);
                console.log(`  Usage: /proactive on | off | 2`);
            }
            break;
        }

        case '/debug': {
            console.log(`  Debug mode: ${ctx.DEBUG ? 'ON' : 'OFF'}`);
            break;
        }

        case '/quit':
            process.emit('SIGINT' as any, 'SIGINT');
            break;

        default:
            console.log(`  Unknown command: ${cmd}`);
            console.log('  Available: /peers /rooms /presence /reputation /info /history');
            console.log('             /summon /template /chains /chain /step /assign /review');
            console.log('             /cancel /export /cache /encrypt /context /proactive /debug /quit');
            console.log('             /mesh-request /mesh-accept /mesh-reject /mesh-revoke /mesh-peerings');
            console.log('             /mesh-open /mesh-close /mesh-bridges /mesh-stats');
    }
}

// ─── ANSI Color Helpers ─────────────────────────────────────────

function bold(s: string): string { return `\x1b[1m${s}\x1b[22m`; }
function dim(s: string): string { return `\x1b[2m${s}\x1b[22m`; }
function cyan(s: string): string { return `\x1b[36m${s}\x1b[39m`; }
function green(s: string): string { return `\x1b[32m${s}\x1b[39m`; }
function yellow(s: string): string { return `\x1b[33m${s}\x1b[39m`; }
function red(s: string): string { return `\x1b[31m${s}\x1b[39m`; }
function blue(s: string): string { return `\x1b[34m${s}\x1b[39m`; }

// ─── Cloudflared Auto-Install ────────────────────────────────────

function isCommandAvailable(cmd: string): boolean {
    try {
        execSync(`command -v ${cmd}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

async function installCloudflared(): Promise<boolean> {
    const os = process.platform;
    const arch = process.arch;

    try {
        if (os === 'darwin') {
            // macOS — try Homebrew first
            if (isCommandAvailable('brew')) {
                console.log(`  ${dim('  brew install cloudflare/cloudflare/cloudflared')}`);
                execSync('brew install cloudflare/cloudflare/cloudflared', { stdio: 'inherit' });
                return true;
            }
        }

        if (os === 'linux') {
            // Linux — download binary directly
            const archMap: Record<string, string> = {
                'x64': 'amd64',
                'arm64': 'arm64',
                'arm': 'arm',
            };
            const cfArch = archMap[arch] || 'amd64';
            const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cfArch}`;
            const dest = '/usr/local/bin/cloudflared';

            console.log(`  ${dim(`  Downloading cloudflared for linux-${cfArch}...`)}`);

            if (isCommandAvailable('curl')) {
                execSync(`curl -fsSL "${url}" -o /tmp/cloudflared && chmod +x /tmp/cloudflared && sudo mv /tmp/cloudflared ${dest}`, { stdio: 'inherit' });
            } else if (isCommandAvailable('wget')) {
                execSync(`wget -q "${url}" -O /tmp/cloudflared && chmod +x /tmp/cloudflared && sudo mv /tmp/cloudflared ${dest}`, { stdio: 'inherit' });
            } else {
                console.error(red('  Neither curl nor wget found. Cannot download cloudflared.'));
                return false;
            }
            return true;
        }

        // Windows or unsupported
        console.log(yellow(`  Auto-install not supported on ${os}. Install manually:`));
        console.log(dim('  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'));
        return false;
    } catch (err) {
        console.error(red(`  Failed to install cloudflared: ${(err as Error).message}`));
        console.log(dim('  Install manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'));
        return false;
    }
}
