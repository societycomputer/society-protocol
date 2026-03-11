import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Storage } from '../../src/storage.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync } from 'fs';

describe('Storage', () => {
    let testDir: string;
    let storage: Storage;

    beforeEach(() => {
        testDir = join(tmpdir(), `society-storage-test-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
        storage = new Storage({ dbPath: join(testDir, 'test.db') });
    });

    afterEach(() => {
        try {
            storage.close();
        } catch {}
        rmSync(testDir, { recursive: true, force: true });
    });

    describe('Initialization', () => {
        it('should create database file', () => {
            const dbPath = join(testDir, 'test.db');
            expect(existsSync(dbPath)).toBe(true);
        });

        it('should create required tables', () => {
            const tables = storage.db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).all() as Array<{ name: string }>;
            
            const tableNames = tables.map(t => t.name);
            expect(tableNames).toContain('identity');
            expect(tableNames).toContain('rooms');
            expect(tableNames).toContain('messages');
            expect(tableNames).toContain('federations');
            expect(tableNames).toContain('knowledge_spaces');
            expect(tableNames).toContain('knowledge_cards');
            expect(tableNames).toContain('federation_peerings');
            expect(tableNames).toContain('federation_bridges');
            expect(tableNames).toContain('federation_sync_cursor');
            expect(tableNames).toContain('federation_sync_log');
            expect(tableNames).toContain('persona_graph_cache');
            expect(tableNames).toContain('persona_metrics');
        });
    });

    describe('Identity CRUD', () => {
        it('should save and retrieve identity', () => {
            storage.saveIdentity(
                'did:key:z6MkTest',
                'private_key_hex_here',
                'public_key_hex_here',
                'Test User'
            );
            
            const identity = storage.getIdentity();
            expect(identity).toBeDefined();
            expect(identity?.did).toBe('did:key:z6MkTest');
            expect(identity?.display_name).toBe('Test User');
        });
    });

    describe('Rooms CRUD', () => {
        it('should create and retrieve rooms', () => {
            // First save identity (required for FK constraint)
            storage.saveIdentity('did:key:z6MkTest', 'privkey', 'pubkey', 'Test User');
            
            storage.createRoom('room_123', 'Test Room', 'did:key:z6MkTest');
            
            const rooms = storage.getRooms();
            expect(rooms.length).toBe(1);
            expect(rooms[0].room_id).toBe('room_123');
            expect(rooms[0].name).toBe('Test Room');
        });

        it('should add and retrieve room members', () => {
            storage.saveIdentity('did:key:z6MkTest', 'privkey', 'pubkey', 'Test User');
            storage.createRoom('room_123', 'Test Room', 'did:key:z6MkTest');
            storage.addRoomMember('room_123', 'did:key:z6MkMember1', 'Member 1');
            storage.addRoomMember('room_123', 'did:key:z6MkMember2', 'Member 2');
            
            const members = storage.getRoomMembers('room_123');
            expect(members.length).toBe(2);
            expect(members[0].member_did).toBe('did:key:z6MkMember1');
        });
    });

    describe('Messages CRUD', () => {
        it('should save and retrieve messages', () => {
            storage.saveIdentity('did:key:z6MkTest', 'privkey', 'pubkey', 'Test User');
            storage.createRoom('room_123', 'Test Room', 'did:key:z6MkTest');
            
            storage.saveMessage(
                'msg_1',
                'room_123',
                'did:key:z6MkTest',
                'Test User',
                'Hello, World!',
                null,
                Date.now()
            );
            
            const messages = storage.getMessages('room_123', 10);
            expect(messages.length).toBe(1);
            expect(messages[0].text).toBe('Hello, World!');
        });
    });

    describe('Federations CRUD', () => {
        it('should save and retrieve federations', () => {
            const fed = {
                id: 'fed_123',
                name: 'Test Federation',
                visibility: 'public',
                creator: 'did:key:z6MkTest'
            };
            
            storage.saveFederation(fed);
            
            const federations = storage.getFederations();
            expect(federations.length).toBe(1);
            expect(federations[0].name).toBe('Test Federation');
        });
    });

    describe('Knowledge Storage', () => {
        it('should save and retrieve knowledge spaces', () => {
            const space = {
                id: 'space_123',
                name: 'Test Space',
                owner: 'did:key:z6MkTest'
            };
            
            storage.saveKnowledgeSpace(space);
            
            const spaces = storage.getKnowledgeSpaces();
            expect(spaces.length).toBe(1);
            expect(spaces[0].name).toBe('Test Space');
        });

        it('should save knowledge cards', () => {
            const card = {
                id: 'card_123',
                spaceId: 'space_123',
                type: 'fact',
                title: 'Test Card',
                content: 'Test content'
            };
            
            storage.saveKnowledgeCard(card);
            const cards = storage.getKnowledgeCards('space_123');
            expect(cards).toHaveLength(1);
            expect(cards[0].id).toBe('card_123');
        });

        it('should save knowledge links', () => {
            const link = {
                id: 'link_123',
                source: 'card_1',
                target: 'card_2',
                type: 'supports'
            };
            
            storage.saveKnowledgeLink(link);
            const links = storage.getKnowledgeLinks();
            expect(links).toHaveLength(1);
            expect(links[0].id).toBe('link_123');
        });
    });

    describe('Compatibility KV API', () => {
        it('should set/get/delete values in kv store', () => {
            storage.set('kv:test', { ok: true, count: 2 });
            const value = storage.get<{ ok: boolean; count: number }>('kv:test');
            expect(value).toEqual({ ok: true, count: 2 });

            storage.delete('kv:test');
            expect(storage.get('kv:test')).toBeUndefined();
        });

        it('should execute SQL queries', () => {
            storage.set('kv:query', 'value');
            const rows = storage.query('SELECT key, value FROM kv_store WHERE key = ?', ['kv:query']) as Array<{
                key: string;
                value: string;
            }>;
            expect(rows).toHaveLength(1);
            expect(rows[0].key).toBe('kv:query');
        });

        it('should run transactions atomically', () => {
            storage.transaction(() => {
                storage.set('txn:a', 1);
                storage.set('txn:b', 2);
            });

            expect(storage.get<number>('txn:a')).toBe(1);
            expect(storage.get<number>('txn:b')).toBe(2);
        });
    });

    describe('Federation Mesh Storage', () => {
        it('should save and list peerings', () => {
            const now = Date.now();
            storage.saveFederationPeering({
                peeringId: 'peer_1',
                sourceFederationId: 'fed_source',
                sourceFederationDid: 'did:society:fed_source',
                targetFederationDid: 'did:society:fed_target',
                policy: {
                    allowedTypes: ['chat.msg', 'coc.submit'],
                    maxRatePerMinute: 120,
                    privacyMode: 'summary',
                },
                status: 'pending',
                createdAt: now,
                updatedAt: now,
            });

            const loaded = storage.getFederationPeering('peer_1');
            expect(loaded).toBeDefined();
            expect(loaded?.status).toBe('pending');
            expect(loaded?.sourceFederationId).toBe('fed_source');

            const listed = storage.listFederationPeerings('fed_source');
            expect(listed.length).toBe(1);
            expect(listed[0].peeringId).toBe('peer_1');
        });

        it('should save bridges and compute mesh stats', () => {
            const now = Date.now();
            storage.saveFederationBridge({
                bridgeId: 'bridge_1',
                peeringId: 'peer_1',
                localFederationId: 'fed_source',
                localRoomId: 'room_local',
                remoteRoomId: 'room_remote',
                rules: {
                    allowedTypes: ['chat.msg'],
                    maxRatePerMinute: 200,
                    privacyMode: 'summary',
                },
                status: 'active',
                eventsIn: 0,
                eventsOut: 0,
                createdAt: now,
                updatedAt: now,
            });

            storage.incrementFederationBridgeCounters('bridge_1', 'out', 3, now + 10);
            storage.incrementFederationBridgeCounters('bridge_1', 'in', 2, now + 20);

            const bridge = storage.getFederationBridge('bridge_1');
            expect(bridge).toBeDefined();
            expect(bridge?.eventsOut).toBe(3);
            expect(bridge?.eventsIn).toBe(2);

            const stats = storage.getFederationMeshStats('fed_source');
            expect(stats.bridgeCount).toBe(1);
            expect(stats.activeBridges).toBe(1);
            expect(stats.eventsOut).toBe(3);
            expect(stats.eventsIn).toBe(2);
        });

        it('should support cursor tracking and replay deduplication', () => {
            const now = Date.now();
            storage.saveFederationSyncCursor({
                bridgeId: 'bridge_cursor',
                direction: 'out',
                cursorId: 'env_1',
                updatedAt: now,
            });

            storage.appendFederationSyncLog({
                bridgeId: 'bridge_cursor',
                envelopeId: 'env_1',
                direction: 'out',
                messageType: 'chat.msg',
                fromFederationId: 'fed_source',
                toFederationId: 'did:society:fed_target',
                status: 'processed',
                ts: now,
            });

            // Unique (bridge_id, envelope_id, direction) should keep this idempotent
            storage.appendFederationSyncLog({
                bridgeId: 'bridge_cursor',
                envelopeId: 'env_1',
                direction: 'out',
                messageType: 'chat.msg',
                fromFederationId: 'fed_source',
                toFederationId: 'did:society:fed_target',
                status: 'processed',
                ts: now + 1,
            });

            const cursor = storage.getFederationSyncCursor('bridge_cursor', 'out');
            expect(cursor?.cursorId).toBe('env_1');

            expect(storage.hasFederationSyncLog('bridge_cursor', 'env_1', 'out')).toBe(true);
            const rows = storage.listFederationSyncLog('bridge_cursor', 10);
            expect(rows.length).toBe(1);
        });
    });

    describe('Persistence Round-trip', () => {
        it('should preserve Map/Set structures after restart', () => {
            const dbPath = join(testDir, 'test.db');

            storage.saveFederation({
                id: 'fed_roundtrip',
                name: 'Roundtrip Fed',
                visibility: 'private',
                creator: 'did:key:z6MkTest',
                members: new Map([
                    ['did:key:z6MkTest', { did: 'did:key:z6MkTest', displayName: 'Owner', status: 'admin' }]
                ])
            });

            storage.saveKnowledgeSpace({
                id: 'space_roundtrip',
                name: 'Roundtrip Space',
                owner: 'did:key:z6MkTest',
                cards: new Set(['card_1']),
                links: []
            });

            storage.close();
            storage = new Storage({ dbPath });

            const loadedFed = storage.getFederations().find((f: any) => f.id === 'fed_roundtrip') as any;
            expect(loadedFed).toBeDefined();
            expect(loadedFed.members).toBeInstanceOf(Map);
            expect(loadedFed.members.get('did:key:z6MkTest')?.displayName).toBe('Owner');

            const loadedSpace = storage.getKnowledgeSpaces().find((s: any) => s.id === 'space_roundtrip') as any;
            expect(loadedSpace).toBeDefined();
            expect(loadedSpace.cards).toBeInstanceOf(Set);
            expect(loadedSpace.cards.has('card_1')).toBe(true);
        });
    });

    describe('Performance', () => {
        it('should save 1000 federations in under 2 seconds', () => {
            const start = Date.now();
            
            for (let i = 0; i < 1000; i++) {
                storage.saveFederation({
                    id: `fed_${i}`,
                    name: `Federation ${i}`,
                    visibility: 'public',
                    creator: 'did:key:z6MkTest'
                });
            }
            
            const elapsed = Date.now() - start;
            expect(elapsed).toBeLessThan(2000);
            console.log(`Saved 1000 federations in ${elapsed}ms`);
            
            const feds = storage.getFederations();
            expect(feds.length).toBe(1000);
        });

        it('should save 1000 knowledge spaces in under 2 seconds', () => {
            const start = Date.now();
            
            for (let i = 0; i < 1000; i++) {
                storage.saveKnowledgeSpace({
                    id: `space_${i}`,
                    name: `Space ${i}`,
                    owner: 'did:key:z6MkTest'
                });
            }
            
            const elapsed = Date.now() - start;
            expect(elapsed).toBeLessThan(2000);
            console.log(`Saved 1000 spaces in ${elapsed}ms`);
            
            const spaces = storage.getKnowledgeSpaces();
            expect(spaces.length).toBe(1000);
        });
    });
});
