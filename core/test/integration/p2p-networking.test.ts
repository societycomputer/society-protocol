import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { P2PNode, type P2PConfig } from '../../src/p2p.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

describe('P2P Networking Integration', () => {
    let testDir: string;
    let node1: P2PNode;
    let node2: P2PNode;

    beforeAll(async () => {
        testDir = join(tmpdir(), `society-p2p-test-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });

        const config1: P2PConfig = {
            port: 0, // Random port
            enableMdns: false,
            enableDht: false,
            enableGossipsub: true,
        };

        const config2: P2PConfig = {
            port: 0,
            enableMdns: false,
            enableDht: false,
            enableGossipsub: true,
        };

        node1 = new P2PNode(config1);
        node2 = new P2PNode(config2);

        await node1.start();
        await node2.start();

        const dialTarget = node1.node.getMultiaddrs()[0]?.toString();
        if (dialTarget) {
            await node2.connectToPeer(dialTarget);
        }

        // Wait for nodes to initialize
        await waitFor(async () => node1.getConnectedPeers().length > 0 || node2.getConnectedPeers().length > 0, 5000);
    }, 30000);

    afterAll(async () => {
        await node1?.stop();
        await node2?.stop();
        rmSync(testDir, { recursive: true, force: true });
    }, 10000);

    describe('Node Initialization', () => {
        it('should start both nodes successfully', () => {
            expect(node1.node).toBeDefined();
            expect(node2.node).toBeDefined();
        });

        it('should have different peer IDs', () => {
            const id1 = node1.node.peerId.toString();
            const id2 = node2.node.peerId.toString();
            expect(id1).not.toBe(id2);
        });

        it('should have listen addresses', () => {
            const addrs1 = node1.node.getMultiaddrs();
            const addrs2 = node2.node.getMultiaddrs();
            expect(addrs1.length).toBeGreaterThan(0);
            expect(addrs2.length).toBeGreaterThan(0);
        });
    });

    describe('Pub/Sub', () => {
        it('should subscribe to topics', async () => {
            const topic = 'test-topic';
            
            await node1.subscribe(topic);
            await node2.subscribe(topic);
            
            // Verify subscription
            expect(node1.isSubscribed(topic)).toBe(true);
            expect(node2.isSubscribed(topic)).toBe(true);
        });

        it('should receive published messages', async () => {
            const topic = 'chat-test';
            const receivedMessages: Uint8Array[] = [];
            
            // Setup listener on node2
            await node2.subscribe(topic, (data) => {
                receivedMessages.push(data);
            });
            
            await node1.subscribe(topic);
            
            // Wait for subscription to propagate
            await new Promise(r => setTimeout(r, 1500));
            
            // Publish from node1
            const testMessage = new TextEncoder().encode('Hello from node 1');
            await node1.publish(topic, testMessage);
            
            // Wait for message
            await new Promise(r => setTimeout(r, 2500));
            
            expect(receivedMessages.length).toBeGreaterThan(0);
            expect(new TextDecoder().decode(receivedMessages[0])).toBe('Hello from node 1');
        }, 15000);
    });

    describe('Network Stats', () => {
        it('should track bandwidth stats', () => {
            const stats1 = node1.getBandwidthStats();
            const stats2 = node2.getBandwidthStats();
            
            expect(stats1).toBeDefined();
            expect(stats2).toBeDefined();
        });

        it('should list connected peers', async () => {
            await new Promise(r => setTimeout(r, 1000));
            
            const peers = node1.getConnectedPeers();
            expect(Array.isArray(peers)).toBe(true);
        });
    });
});

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await check()) return;
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Timed out waiting for condition');
}
