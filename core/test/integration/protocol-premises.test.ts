import { afterEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { SocietyClient } from '../../src/sdk/client.js';
import { P2PNode } from '../../src/p2p.js';
import { Storage } from '../../src/storage.js';
import { generateIdentity } from '../../src/identity.js';
import { RoomManager } from '../../src/rooms.js';
import { CocEngine } from '../../src/coc.js';
import { FederationEngine } from '../../src/federation.js';
import { KnowledgePool } from '../../src/knowledge.js';
import { SkillsEngine } from '../../src/skills/engine.js';
import { SecurityManager } from '../../src/security.js';
import { IntegrationEngine } from '../../src/integration.js';
import { getTemplate } from '../../src/templates.js';

const cleanupFns: Array<() => Promise<void> | void> = [];

describe('Protocol premises verification', () => {
    afterEach(async () => {
        for (const cleanup of cleanupFns.splice(0).reverse()) {
            await cleanup();
        }
    });

    it('supports plug-and-play onboarding and remote agent messaging via SDK', async () => {
        const roomId = `room_premise_sdk_${Date.now()}`;
        const dirA = join(tmpdir(), `society-premise-a-${Date.now()}`);
        const dirB = join(tmpdir(), `society-premise-b-${Date.now()}`);
        mkdirSync(dirA, { recursive: true });
        mkdirSync(dirB, { recursive: true });

        const clientA = new SocietyClient({
            identity: { name: 'Agent A' },
            storage: { path: join(dirA, 'a.db') },
            network: { enableDht: false, enableGossipsub: false },
        });
        const clientB = new SocietyClient({
            identity: { name: 'Agent B' },
            storage: { path: join(dirB, 'b.db') },
            network: { enableDht: false, enableGossipsub: false },
        });

        cleanupFns.push(async () => {
            await clientA.disconnect();
            await clientB.disconnect();
            rmSync(dirA, { recursive: true, force: true });
            rmSync(dirB, { recursive: true, force: true });
        });

        await clientA.connect();
        await clientB.connect();
        await clientA.joinRoom(roomId);
        await clientB.joinRoom(roomId);

        const addrA = clientA.getMultiaddrs()[0];
        expect(addrA).toBeDefined();
        const connected = await (clientB as any).p2p.connectToPeer(addrA);
        expect(connected).toBe(true);

        const received = new Promise<string>((resolve) => {
            clientB.once('message', (evt: any) => resolve(String(evt?.body?.text || '')));
        });
        await clientA.sendMessage(roomId, 'ping-from-agent-a');
        const text = await waitForPromise(received, 4_000);
        expect(text).toContain('ping-from-agent-a');
    }, 30_000);

    it('supports direct P2P between two agents with protocol stream delivery', async () => {
        const nodeA = new P2PNode({ enableGossipsub: false, enableDht: false, enableMdns: false });
        const nodeB = new P2PNode({ enableGossipsub: false, enableDht: false, enableMdns: false });
        cleanupFns.push(async () => {
            await nodeA.stop();
            await nodeB.stop();
        });

        await nodeA.start();
        await nodeB.start();
        const target = nodeB.getMultiaddrs()[0];
        expect(target).toBeDefined();
        const connected = await nodeA.connectToPeer(target);
        expect(connected).toBe(true);

        const topic = 'society/v1.0/direct-premise';
        const got = new Promise<string>((resolve) => {
            nodeB.subscribe(topic, (data) => {
                resolve(new TextDecoder().decode(data));
            }).catch(() => {});
        });

        const sent = await nodeA.sendDirect(
            nodeB.getPeerId(),
            new TextEncoder().encode('direct-p2p-ok'),
            topic
        );
        expect(sent).toBe(true);
        const payload = await waitForPromise(got, 4_000);
        expect(payload).toBe('direct-p2p-ok');
    }, 30_000);

    it('keeps chain identity consistent across peers for coc.open/coc.plan', async () => {
        const roomId = `room_chain_identity_${Date.now()}`;
        const dirA = join(tmpdir(), `society-chain-a-${Date.now()}`);
        const dirB = join(tmpdir(), `society-chain-b-${Date.now()}`);
        mkdirSync(dirA, { recursive: true });
        mkdirSync(dirB, { recursive: true });

        const clientA = new SocietyClient({
            identity: { name: 'Leader A' },
            storage: { path: join(dirA, 'a.db') },
            network: { enableDht: false, enableGossipsub: true },
        });
        const clientB = new SocietyClient({
            identity: { name: 'Worker B' },
            storage: { path: join(dirB, 'b.db') },
            network: { enableDht: false, enableGossipsub: true },
        });

        cleanupFns.push(async () => {
            await clientA.disconnect();
            await clientB.disconnect();
            rmSync(dirA, { recursive: true, force: true });
            rmSync(dirB, { recursive: true, force: true });
        });

        await clientA.connect();
        await clientB.connect();
        await clientA.joinRoom(roomId);
        await clientB.joinRoom(roomId);
        const addrA = clientA.getMultiaddrs()[0];
        expect(addrA).toBeDefined();
        const connected = await (clientB as any).p2p.connectToPeer(addrA);
        expect(connected).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        const chainId = await (clientA as any).coc.openChain(roomId, 'Cross-peer chain identity', {
            priority: 'normal',
        });
        await (clientA as any).coc.publishPlan(roomId, chainId, [
            {
                step_id: `step_${Date.now()}`,
                kind: 'task',
                title: 'Collect evidence',
                depends_on: [],
                requirements: { capabilities: ['research'] },
            },
        ]);

        const seen = await waitForCondition(() => {
            const remote = (clientB as any).coc.getChain(chainId);
            return !!remote && remote.chain_id === chainId;
        }, 8_000);
        expect(seen).toBe(true);
    }, 30_000);

    it('supports swarm orchestration and federations for common goals', async () => {
        const baseDir = join(tmpdir(), `society-premise-fed-${Date.now()}`);
        mkdirSync(baseDir, { recursive: true });

        const storage = new Storage({ dbPath: join(baseDir, 'premise.db') });
        const identity = generateIdentity('Research Operator');
        storage.saveIdentity(
            identity.did,
            Buffer.from(identity.privateKey).toString('hex'),
            Buffer.from(identity.publicKey).toString('hex'),
            identity.displayName
        );
        const p2p = new P2PNode({ enableGossipsub: false, enableDht: false, enableMdns: false });
        await p2p.start();
        const rooms = new RoomManager(identity, p2p, storage);
        const coc = new CocEngine(identity, rooms, storage);
        const federation = new FederationEngine(storage, identity);
        const knowledge = new KnowledgePool(storage, identity);
        const skills = new SkillsEngine(storage, identity, join(baseDir, 'skills'));
        const security = new SecurityManager(identity);
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

        cleanupFns.push(async () => {
            skills.stop();
            coc.destroy();
            rooms.destroy();
            await p2p.stop();
            storage.close();
            rmSync(baseDir, { recursive: true, force: true });
        });

        const fed = await federation.createFederation(
            'Rare Disease Research Guild',
            'Federation for distributed rare disease investigation',
            'private'
        );
        const roomId = `room_rare_disease_${Date.now()}`;
        const federated = await integration.createFederatedRoom(
            roomId,
            'Rare Disease Collaborative Room',
            fed.id
        );
        expect(federated.room.room_id).toBe(roomId);
        expect(federated.federationRoom.federationId).toBe(fed.id);

        await rooms.joinRoom(roomId);
        const template = getTemplate('research_swarm');
        const dag = template.generate('Investigate a rare disease treatment strategy', { domains: 4 });
        const chainId = await coc.openChain(roomId, 'Rare disease collaborative investigation', {
            templateId: 'research_swarm',
            priority: 'high',
        });
        await coc.publishPlan(roomId, chainId, dag);

        const chain = coc.getChain(chainId);
        expect(chain).toBeDefined();
        expect(chain!.steps.length).toBeGreaterThanOrEqual(7);
        expect(chain!.steps.some((step) => step.step_id === 'synthesize_findings')).toBe(true);
        expect(chain!.steps.some((step) => step.step_id === 'cross_review')).toBe(true);
    }, 30_000);
});

async function waitForPromise<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Timed out waiting for async event')), timeoutMs);
        }),
    ]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

async function waitForCondition(check: () => boolean, timeoutMs: number): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (check()) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
}
