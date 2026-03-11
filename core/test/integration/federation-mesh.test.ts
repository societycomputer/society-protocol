import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { Storage } from '../../src/storage.js';
import { generateIdentity, type Identity } from '../../src/identity.js';
import { P2PNode } from '../../src/p2p.js';
import { RoomManager } from '../../src/rooms.js';
import { CocEngine } from '../../src/coc.js';
import { FederationEngine } from '../../src/federation.js';
import { KnowledgePool } from '../../src/knowledge.js';
import { SkillsEngine } from '../../src/skills/engine.js';
import { SecurityManager } from '../../src/security.js';
import { IntegrationEngine } from '../../src/integration.js';
import { createEnvelope } from '../../src/swp.js';

describe('Federation Mesh Integration', () => {
    let testDir: string;
    let storage: Storage;
    let identity: Identity;
    let p2p: P2PNode;
    let rooms: RoomManager;
    let coc: CocEngine;
    let federation: FederationEngine;
    let knowledge: KnowledgePool;
    let skills: SkillsEngine;
    let security: SecurityManager;
    let integration: IntegrationEngine;
    let sendMessageMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        testDir = join(tmpdir(), `society-mesh-integration-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });

        storage = new Storage({ dbPath: join(testDir, 'test.db') });
        identity = generateIdentity('Mesh Tester');
        p2p = new P2PNode({ enableGossipsub: false, enableDht: false, enableMdns: false });
        rooms = new RoomManager(identity, p2p, storage);

        sendMessageMock = vi.fn(async () => ({ ok: true }));
        (rooms as any).sendMessage = sendMessageMock;

        coc = new CocEngine(identity, rooms, storage);
        federation = new FederationEngine(storage, identity);
        knowledge = new KnowledgePool(storage, identity);
        skills = new SkillsEngine(storage, identity, join(testDir, 'skills'));
        security = new SecurityManager(identity);
        integration = new IntegrationEngine(
            storage,
            identity,
            federation,
            rooms,
            knowledge,
            coc,
            skills,
            security
        );
    });

    afterEach(async () => {
        skills.stop();
        coc.destroy();
        rooms.destroy();
        try {
            storage.close();
        } catch {
            // ignore close errors in cleanup
        }
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should open bridge and publish allowed message types', async () => {
        const sourceFed = await federation.createFederation('Source Fed', 'Mesh source', 'private');
        const peering = await federation.requestPeering(sourceFed.id, 'did:society:fed_target');
        await federation.respondPeering(peering.id, true);

        const bridge = await integration.openMeshBridge(
            peering.id,
            'room_local',
            'room_remote',
            {
                allowedTypes: ['chat.msg'],
                maxRatePerMinute: 200,
                privacyMode: 'summary'
            }
        );

        const envelope = createEnvelope(identity, 'chat.msg', 'room_local', {
            text: 'hello federation mesh',
            attachments: ['artifact_1']
        });

        const result = await integration.publishMeshEvent(bridge.id, envelope);
        expect(result.delivered).toBe(true);
        expect(sendMessageMock).toHaveBeenCalledTimes(1);
        expect(sendMessageMock).toHaveBeenCalledWith(
            'room_remote',
            expect.objectContaining({
                bridge_id: bridge.id,
                peering_id: peering.id
            }),
            'federation.bridge.sync'
        );

        const stats = integration.getMeshStats(sourceFed.id);
        expect(stats.bridgeCount).toBeGreaterThanOrEqual(1);
        expect(stats.eventsOut).toBeGreaterThanOrEqual(1);
    });

    it('should enforce policy filters and cut traffic after peering revoke', async () => {
        const sourceFed = await federation.createFederation('Policy Fed', 'Policy checks', 'private');
        const peering = await federation.requestPeering(sourceFed.id, 'did:society:fed_policy');
        await federation.respondPeering(peering.id, true);

        const bridge = await integration.openMeshBridge(
            peering.id,
            'room_policy_local',
            'room_policy_remote',
            {
                allowedTypes: ['coc.submit'],
                maxRatePerMinute: 200,
                privacyMode: 'full'
            }
        );

        const blocked = await integration.publishMeshEvent(
            bridge.id,
            createEnvelope(identity, 'chat.msg', 'room_policy_local', { text: 'blocked by allowlist' })
        );
        expect(blocked.delivered).toBe(false);
        expect(sendMessageMock).toHaveBeenCalledTimes(0);

        await federation.revokePeering(peering.id, 'security incident');

        const afterRevoke = await integration.publishMeshEvent(
            bridge.id,
            createEnvelope(identity, 'coc.submit', 'room_policy_local', {
                chain_id: 'c1',
                step_id: 's1',
                status: 'completed'
            })
        );
        expect(afterRevoke.delivered).toBe(false);
        expect(afterRevoke.reason).toContain('not active');
    });

    it('should deduplicate incoming sync messages by cursor/log', async () => {
        const sourceFed = await federation.createFederation('Replay Fed', 'Replay checks', 'private');
        const peering = await federation.requestPeering(sourceFed.id, 'did:society:fed_replay');
        await federation.respondPeering(peering.id, true);
        const bridge = await integration.openMeshBridge(peering.id, 'room_replay_local', 'room_replay_remote');

        const bridgedEnvelope = createEnvelope(identity, 'chat.msg', 'room_replay_local', {
            text: 'replay target'
        });

        const syncEnvelope = createEnvelope(identity, 'federation.bridge.sync', 'room_replay_remote', {
            bridge_id: bridge.id,
            peering_id: peering.id,
            source_federation_id: sourceFed.id,
            target_federation_did: peering.targetFederationDid,
            cursor: bridgedEnvelope.id,
            envelope: bridgedEnvelope
        });

        rooms.emit('federation:event', 'room_replay_remote', syncEnvelope);
        rooms.emit('federation:event', 'room_replay_remote', syncEnvelope);
        await new Promise((resolve) => setTimeout(resolve, 25));

        const logs = storage.listFederationSyncLog(bridge.id, 20).filter((log) => log.direction === 'in');
        expect(logs).toHaveLength(1);
        expect(logs[0].envelopeId).toBe(bridgedEnvelope.id);
    });
});
