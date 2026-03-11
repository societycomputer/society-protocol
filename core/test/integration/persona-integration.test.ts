import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { PersonaVaultEngine } from '../../src/persona/index.js';

describe('Persona IntegrationEngine routing', () => {
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
    let persona: PersonaVaultEngine;
    let sendMessageMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        testDir = join(tmpdir(), `society-persona-integration-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });

        storage = new Storage({ dbPath: join(testDir, 'test.db') });
        identity = generateIdentity('Persona Integration');
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
        persona = new PersonaVaultEngine(storage, identity.did);
        integration.attachPersonaVault(persona);
    });

    afterEach(() => {
        skills.stop();
        coc.destroy();
        rooms.destroy();
        try {
            storage.close();
        } catch {}
        rmSync(testDir, { recursive: true, force: true });
    });

    it('includes vault_id in persona.sync.ack payload', async () => {
        const vault = await persona.createVault({ name: 'Integration Vault' });
        const node = await persona.addMemory({
            vaultId: vault.id,
            domain: 'general',
            type: 'memory',
            title: 'Ack memory',
            content: 'Ack payload test',
        });

        const delta = persona.buildSyncDelta({
            vaultId: vault.id,
            operations: [{ type: 'node_upsert', payload: node as unknown as Record<string, unknown> }],
        });

        await (integration as any).handlePersonaEnvelope('room_ack', {
            id: 'env_ack',
            t: 'persona.sync.delta',
            from: { did: 'did:key:remote', name: 'remote' },
            ts: Date.now(),
            body: delta,
        });

        expect(sendMessageMock).toHaveBeenCalledWith(
            'room_ack',
            expect.objectContaining({
                delta_id: delta.id,
                vault_id: vault.id,
            }),
            'persona.sync.ack'
        );
    });

    it('applies explicit persona.preference.update messages', async () => {
        const vault = await persona.createVault({ name: 'Preference Vault' });

        await (integration as any).handlePersonaEnvelope('room_pref', {
            id: 'env_pref',
            t: 'persona.preference.update',
            from: { did: 'did:key:remote-pref', name: 'remote' },
            ts: Date.now(),
            body: {
                vault_id: vault.id,
                key: 'theme',
                value: 'dark',
                domain: 'preferences',
                confidence: 1,
            },
        });

        const prefs = await persona.queryMemories({
            vaultId: vault.id,
            domain: 'preferences',
            query: 'theme',
            limit: 10,
        });
        expect(prefs.nodes.some((node) => node.title === 'theme')).toBe(true);
    });

    it('triggers snapshot repair when persona.sync.ack requests snapshot and has vault_id', async () => {
        const vault = await persona.createVault({ name: 'Repair Vault' });
        await persona.addMemory({
            vaultId: vault.id,
            domain: 'general',
            type: 'memory',
            title: 'Repair source',
            content: 'snapshot source',
        });

        sendMessageMock.mockClear();
        await (integration as any).handlePersonaEnvelope('room_repair', {
            id: 'env_repair',
            t: 'persona.sync.ack',
            from: { did: 'did:key:remote-repair', name: 'remote' },
            ts: Date.now(),
            body: {
                need_snapshot: true,
                vault_id: vault.id,
                cursor: 'cursor_1',
            },
        });

        expect(sendMessageMock).toHaveBeenCalledWith(
            'room_repair',
            expect.objectContaining({
                vaultId: vault.id,
                operations: expect.any(Array),
            }),
            'persona.sync.delta'
        );
    });
});
