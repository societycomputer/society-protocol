import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';
import { Storage } from '../../src/storage.js';
import { generateIdentity } from '../../src/identity.js';
import { RoomManager } from '../../src/rooms.js';
import { CocEngine } from '../../src/coc.js';

class FakeP2PNode extends EventEmitter {
    private subscriptions = new Set<string>();

    constructor(private loopback = true) {
        super();
    }

    async subscribe(topic: string): Promise<void> {
        this.subscriptions.add(topic);
    }

    async unsubscribe(topic: string): Promise<void> {
        this.subscriptions.delete(topic);
    }

    async publish(topic: string, data: Uint8Array): Promise<void> {
        if (!this.loopback || !this.subscriptions.has(topic)) return;
        this.emit('message', topic, data, this.getPeerId());
    }

    getPeerId(): string {
        return 'peer_test_local';
    }
}

describe('CoC local routing and identity consistency', () => {
    let testDir: string;
    let storage: Storage;
    let rooms: RoomManager;
    let coc: CocEngine;

    beforeEach(async () => {
        testDir = join(tmpdir(), `society-coc-routing-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
        storage = new Storage({ dbPath: join(testDir, 'test.db') });
        const identity = generateIdentity('Tester');
        storage.saveIdentity(
            identity.did,
            Buffer.from(identity.privateKey).toString('hex'),
            Buffer.from(identity.publicKey).toString('hex'),
            identity.displayName
        );
        const p2p = new FakeP2PNode(true) as any;
        rooms = new RoomManager(identity, p2p, storage);
        coc = new CocEngine(identity, rooms, storage);
        await rooms.joinRoom('room_test');
    });

    afterEach(async () => {
        try {
            coc.destroy();
            rooms.destroy();
            storage.close();
        } catch {}
        rmSync(testDir, { recursive: true, force: true });
    });

    it('applies self CoC message once even with pubsub loopback', async () => {
        let opened = 0;
        coc.on('chain:opened', () => {
            opened += 1;
        });

        const chainId = await coc.openChain('room_test', 'single-open-event');
        const chain = storage.getChain(chainId);

        expect(chain).toBeDefined();
        expect(opened).toBe(1);
    });

    it('uses body.chain_id for coc.open and falls back to envelope id for legacy payloads', async () => {
        const explicit = 'chain_explicit_001';
        const explicitEnvelope = await rooms.sendMessage(
            'room_test',
            { chain_id: explicit, goal: 'explicit chain', priority: 'normal' },
            'coc.open'
        );
        expect(coc.getChain(explicit)?.chain_id).toBe(explicit);
        expect(coc.getChain(explicitEnvelope.id)).toBeNull();

        const legacyEnvelope = await rooms.sendMessage(
            'room_test',
            { goal: 'legacy chain', priority: 'normal' },
            'coc.open'
        );
        expect(coc.getChain(legacyEnvelope.id)?.chain_id).toBe(legacyEnvelope.id);
    });
});
