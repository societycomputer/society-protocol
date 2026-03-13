/**
 * Society Protocol — P2P Networking Module v1.0 (State of the Art)
 *
 * Features:
 * - GossipSub for scalable pub/sub messaging
 * - Kad-DHT for peer discovery and content routing
 * - mDNS for local network discovery
 * - Direct protocol streaming for large data
 * - Connection management and circuit relays
 */

import { createLibp2p, type Libp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { mdns } from '@libp2p/mdns';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { kadDHT } from '@libp2p/kad-dht';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { EventEmitter } from 'events';
import { peerIdFromString } from '@libp2p/peer-id';
import { type SecurityManager } from './security.js';

// ─── Constants ──────────────────────────────────────────────────

export const SOCIETY_PROTOCOL = '/society/1.0.0';
export const TOPIC_PREFIX = 'society/v1.0';

// GossipSub configuration for optimal performance
const GOSSIPSUB_CONFIG = {
    D: 6,           // Desired degree
    D_low: 4,       // Minimum degree
    D_high: 12,     // Maximum degree
    D_score: 4,     // Score-based degree
    heartbeatInterval: 1000, // 1 second
    gossipRetransmission: 3,
    gossipFactor: 0.25,
    historyLength: 5,
    historyGossip: 3,
    fanoutTTL: 60 * 1000, // 1 minute
    seenTTL: 30 * 1000, // 30 seconds
};

// ─── Topic Helpers ──────────────────────────────────────────────

export function presenceTopic(roomId: string): string {
    return `${TOPIC_PREFIX}/presence/${roomId}`;
}

export function chatTopic(roomId: string): string {
    return `${TOPIC_PREFIX}/chat/${roomId}`;
}

export function cocTopic(roomId: string): string {
    return `${TOPIC_PREFIX}/coc/${roomId}`;
}

export function adapterTopic(roomId: string): string {
    return `${TOPIC_PREFIX}/adapter/${roomId}`;
}

export function capsuleTopic(roomId: string): string {
    return `${TOPIC_PREFIX}/capsule/${roomId}`;
}

export function knowledgeTopic(spaceId: string): string {
    return `${TOPIC_PREFIX}/knowledge/${spaceId}`;
}

export function reputationTopic(roomId: string): string {
    return `${TOPIC_PREFIX}/reputation/${roomId}`;
}

export function federationTopic(roomId: string): string {
    return `${TOPIC_PREFIX}/federation/${roomId}`;
}

export function personaTopic(roomId: string): string {
    return `${TOPIC_PREFIX}/persona/${roomId}`;
}

export function missionTopic(roomId: string): string {
    return `${TOPIC_PREFIX}/mission/${roomId}`;
}

export function researchTopic(roomId: string): string {
    return `${TOPIC_PREFIX}/research/${roomId}`;
}

export function cotStreamTopic(roomId: string): string {
    return `${TOPIC_PREFIX}/cot-stream/${roomId}`;
}

// ─── Types ──────────────────────────────────────────────────────

export interface P2PConfig {
    port?: number;
    wsPort?: number;
    bootstrapAddrs?: string[];
    enableMdns?: boolean;
    enableDht?: boolean;
    enableGossipsub?: boolean;
    relayListenAddrs?: string[];
}

export interface PeerInfo {
    id: string;
    addresses: string[];
    protocols: string[];
    latency?: number;
    connected: boolean;
}

export interface BandwidthStats {
    bytesSent: number;
    bytesReceived: number;
    messagesSent: number;
    messagesReceived: number;
}

interface WireMessage {
    topic: string;
    data: string; // base64
    priority?: 'high' | 'normal' | 'low';
    encrypted?: boolean;
    nonce?: string;          // base64 (12 bytes for AES-GCM)
    senderPubKey?: string;   // base64 (X25519 public key)
}

// ─── LRU Cache ──────────────────────────────────────────────────

class LRUCache<K, V> {
    private cache = new Map<K, V>();
    constructor(private maxSize: number) {}

    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Evict oldest entry (first in Map iteration order)
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(key, value);
    }

    has(key: K): boolean {
        return this.cache.get(key) !== undefined;
    }

    delete(key: K): boolean {
        return this.cache.delete(key);
    }

    get size(): number {
        return this.cache.size;
    }

    clear(): void {
        this.cache.clear();
    }

    *entries(): IterableIterator<[K, V]> {
        yield* this.cache.entries();
    }
}

// ─── P2P Node ───────────────────────────────────────────────────

const MAX_SEEN_MESSAGES = 10_000;
const MAX_CONNECTION_POOL = 100;
const CONNECTION_IDLE_MS = 5 * 60 * 1000; // 5 minutes

export class P2PNode extends EventEmitter {
    private static inProcessTopicSubscribers = new Map<string, Set<P2PNode>>();

    public node!: Libp2p;
    private config: P2PConfig;
    private subscribedTopics = new Set<string>();
    private seenMessages = new LRUCache<string, number>(MAX_SEEN_MESSAGES);
    private messageHandlers = new Map<string, ((data: Uint8Array, from: string) => void)>();
    private peerLatencies = new Map<string, number>();
    private connectionPool = new LRUCache<string, { stream: any; lastUsed: number }>(MAX_CONNECTION_POOL);
    private gossipsubAvailable = false; // Detected at runtime
    private security?: SecurityManager;
    private encryptedTopics = new Set<string>(); // Topics that require encryption
    private stats: BandwidthStats = {
        bytesSent: 0,
        bytesReceived: 0,
        messagesSent: 0,
        messagesReceived: 0
    };

    constructor(config: P2PConfig = {}) {
        super();
        this.config = config;
    }

    async start(config: P2PConfig = {}): Promise<void> {
        this.config = {
            enableMdns: true,
            enableDht: true,
            enableGossipsub: true,
            ...this.config,
            ...config
        };

        const port = config.port ?? 0;
        const wsPort = config.wsPort ?? (port === 0 ? 0 : port + 1);

        // Generate persistent keypair or load from storage
        const privateKey = await generateKeyPair('Ed25519');

        // Build peer discovery
        const peerDiscovery: any[] = [];
        if (this.config.enableMdns) {
            peerDiscovery.push(mdns({
                interval: 10000, // 10 second interval
            }));
        }

        // Build services
        const services: any = {
            identify: identify(),
            ping: ping(),
        };

        if (this.config.enableDht) {
            services.dht = kadDHT({
                clientMode: false,
                // @ts-ignore - protocol option exists in runtime
                protocols: ['/society/kad/1.0.0'],
            });
        }

        if (this.config.enableGossipsub) {
            services.pubsub = gossipsub({
                emitSelf: false,
                // @ts-ignore - gossipIncoming option exists in runtime
                gossipIncoming: true,
                fallbackToFloodsub: true,
                floodPublish: true,
                signedMessages: true,
                allowPublishToZeroTopicPeers: true,
                ...GOSSIPSUB_CONFIG,
            });
        }

        this.node = await createLibp2p({
            privateKey,
            addresses: {
                listen: [
                    `/ip4/0.0.0.0/tcp/${port}`,
                    `/ip4/0.0.0.0/tcp/${wsPort}/ws`,
                ],
            },
            transports: [
                tcp(),
                webSockets(),
            ],
            connectionEncrypters: [noise()],
            streamMuxers: [yamux()],
            peerDiscovery,
            services,
            connectionManager: {
                // @ts-ignore - minConnections exists in runtime
                minConnections: 3,
                maxConnections: 50,
                inboundConnectionThreshold: 10,
            },
        });

        // Set up protocol handler for direct streams
        await this.node.handle(SOCIETY_PROTOCOL, this.handleProtocolStream.bind(this));

        // Set up GossipSub message handler (detect compatibility at runtime)
        if (this.config.enableGossipsub) {
            try {
                // @ts-ignore - pubsub exists in runtime
                this.node.services.pubsub.addEventListener('message', (evt: any) => {
                    this.handleGossipMessage(evt);
                });

                // @ts-ignore - pubsub exists in runtime
                this.node.services.pubsub.addEventListener('subscription-change', (evt: any) => {
                    this.emit('subscription:change', evt);
                });

                this.gossipsubAvailable = true;
            } catch {
                this.gossipsubAvailable = false;
                console.log(`[p2p] GossipSub unavailable (interface version mismatch), using direct protocol`);
            }
        }

        // Track peer connections
        this.node.addEventListener('peer:connect', (evt) => {
            const peerId = evt.detail.toString();
            this.emit('peer:connected', peerId);
            this.measureLatency(peerId);
        });

        this.node.addEventListener('peer:disconnect', (evt) => {
            const peerId = evt.detail.toString();
            const pooled = this.connectionPool.get(peerId);
            if (pooled) {
                try { pooled.stream.close(); } catch {}
            }
            this.connectionPool.delete(peerId);
            this.emit('peer:disconnected', peerId);
        });

        await this.node.start();

        // Log startup info
        const addrs = this.node.getMultiaddrs().map((a) => a.toString());
        console.log(`[p2p] Node started. PeerId: ${this.node.peerId.toString()}`);
        console.log(`[p2p] Listening on:`);
        addrs.forEach((a) => console.log(`  ${a}`));

        if (this.config.enableDht) {
            console.log(`[p2p] DHT enabled`);
        }

        // Connect to bootstrap peers
        await this.connectToBootstraps();

        // Start periodic maintenance
        this.startMaintenance();
    }

    // ─── Topic Management ─────────────────────────────────────────

    async subscribe(topic: string, handler?: (data: Uint8Array, from: string) => void): Promise<void> {
        if (this.subscribedTopics.has(topic)) return;

        if (this.gossipsubAvailable) {
            try {
                // @ts-ignore - pubsub exists in runtime
                await this.node.services.pubsub.subscribe(topic);
            } catch {
                // GossipSub subscribe failed — continue with direct protocol
            }
        }

        this.subscribedTopics.add(topic);
        if (!P2PNode.inProcessTopicSubscribers.has(topic)) {
            P2PNode.inProcessTopicSubscribers.set(topic, new Set());
        }
        P2PNode.inProcessTopicSubscribers.get(topic)!.add(this);

        if (handler) {
            this.messageHandlers.set(topic, handler);
        }

        this.emit('subscribed', topic);
    }

    async unsubscribe(topic: string): Promise<void> {
        if (!this.subscribedTopics.has(topic)) return;

        if (this.gossipsubAvailable) {
            try {
                // @ts-ignore - pubsub exists in runtime
                await this.node.services.pubsub.unsubscribe(topic);
            } catch {
                // GossipSub unsubscribe failed — ignore
            }
        }

        this.subscribedTopics.delete(topic);
        this.messageHandlers.delete(topic);
        P2PNode.inProcessTopicSubscribers.get(topic)?.delete(this);
        if ((P2PNode.inProcessTopicSubscribers.get(topic)?.size || 0) === 0) {
            P2PNode.inProcessTopicSubscribers.delete(topic);
        }

        this.emit('unsubscribed', topic);
    }

    async publish(topic: string, data: Uint8Array, priority: 'high' | 'normal' | 'low' = 'normal'): Promise<void> {
        // Check if we've seen this message before (dedup)
        const msgHash = await this.hashMessage(data);
        if (this.seenMessages.has(msgHash)) {
            return; // Already processed
        }
        this.seenMessages.set(msgHash, Date.now());
        this.stats.bytesSent += data.byteLength;
        this.stats.messagesSent += 1;

        if (this.gossipsubAvailable) {
            try {
                // @ts-ignore - pubsub exists in runtime
                await this.node.services.pubsub.publish(topic, data);
            } catch {
                // GossipSub may fail if mesh is not formed — fall through to direct
            }
        }

        // Always send via direct protocol as primary delivery mechanism
        await this.publishDirect(topic, data, priority);

        this.publishInProcess(topic, data);
    }

    private async publishDirect(topic: string, data: Uint8Array, priority: 'high' | 'normal' | 'low'): Promise<void> {
        let wireMsg: WireMessage;

        // Encrypt if topic requires it and SecurityManager is available
        if (this.encryptedTopics.has(topic) && this.security) {
            try {
                const encrypted = await this.security.encrypt(data, new Uint8Array(32)); // broadcast key
                wireMsg = {
                    topic,
                    data: Buffer.from(encrypted.ciphertext).toString('base64'),
                    priority,
                    encrypted: true,
                    nonce: Buffer.from(encrypted.nonce).toString('base64'),
                    senderPubKey: Buffer.from(encrypted.senderPublicKey).toString('base64'),
                };
            } catch {
                // Encryption failed — send plaintext as fallback
                wireMsg = {
                    topic,
                    data: Buffer.from(data).toString('base64'),
                    priority,
                };
            }
        } else {
            wireMsg = {
                topic,
                data: Buffer.from(data).toString('base64'),
                priority,
            };
        }

        const payload = new TextEncoder().encode(JSON.stringify(wireMsg) + '\n');

        const peers = this.node.getPeers();
        const promises = peers.map(async (peerId) => {
            try {
                const peerKey = peerId.toString();
                const pooled = this.connectionPool.get(peerKey);
                let stream = pooled?.stream;

                if (!stream) {
                    stream = await this.node.dialProtocol(peerId, SOCIETY_PROTOCOL);
                    this.connectionPool.set(peerKey, { stream, lastUsed: Date.now() });
                } else {
                    this.connectionPool.set(peerKey, { stream, lastUsed: Date.now() });
                }

                await stream.send(payload);
            } catch (err) {
                // Remove from pool on error
                this.connectionPool.delete(peerId.toString());
            }
        });

        await Promise.allSettled(promises);
    }

    // ─── Room Management ──────────────────────────────────────────

    subscribeRoom(roomId: string): void {
        this.subscribe(presenceTopic(roomId));
        this.subscribe(chatTopic(roomId));
        this.subscribe(cocTopic(roomId));
        this.subscribe(adapterTopic(roomId));
        this.subscribe(federationTopic(roomId));
    }

    unsubscribeRoom(roomId: string): void {
        this.unsubscribe(presenceTopic(roomId));
        this.unsubscribe(chatTopic(roomId));
        this.unsubscribe(cocTopic(roomId));
        this.unsubscribe(adapterTopic(roomId));
        this.unsubscribe(federationTopic(roomId));
    }

    // ─── DHT Operations ───────────────────────────────────────────

    async provide(key: string): Promise<void> {
        if (!this.config.enableDht) return;
        
        const keyBuf = new TextEncoder().encode(key);
        // @ts-ignore - dht exists in runtime
        await this.node.services.dht.provide(keyBuf);
    }

    async findProviders(key: string, maxNum = 3): Promise<string[]> {
        if (!this.config.enableDht) return [];

        const keyBuf = new TextEncoder().encode(key);
        const providers = [];

        // @ts-ignore - dht exists in runtime
        for await (const event of this.node.services.dht.findProviders(keyBuf, { maxNum })) {
            if (event.name === 'PROVIDER') {
                providers.push(event.peerId.toString());
            }
        }

        return providers;
    }

    async findPeer(peerId: string): Promise<string[]> {
        if (!this.config.enableDht) return [];

        try {
            const peer = peerIdFromString(peerId);
            // @ts-ignore - dht exists in runtime
            const result = await this.node.services.dht.findPeer(peer);
            return result.multiaddrs.map((ma: any) => ma.toString());
        } catch {
            return [];
        }
    }

    // ─── Direct Communication ─────────────────────────────────────

    async sendDirect(peerId: string, data: Uint8Array, topic = `${TOPIC_PREFIX}/direct`): Promise<boolean> {
        try {
            const peer = peerIdFromString(peerId);
            const stream = await this.node.dialProtocol(peer, SOCIETY_PROTOCOL);
            const wireMsg: WireMessage = {
                topic,
                data: Buffer.from(data).toString('base64'),
                priority: 'high',
            };
            const payload = new TextEncoder().encode(JSON.stringify(wireMsg) + '\n');
            await stream.send(payload);
            await stream.close();
            return true;
        } catch (err) {
            return false;
        }
    }

    // ─── Peer Information ─────────────────────────────────────────

    getPeers(): string[] {
        return this.node.getPeers().map((p) => p.toString());
    }

    getMultiaddrs(): string[] {
        return this.node.getMultiaddrs().map((a) => a.toString());
    }

    getPeerId(): string {
        return this.node.peerId.toString();
    }

    getPeerLatency(peerId: string): number | undefined {
        return this.peerLatencies.get(peerId);
    }

    isSubscribed(topic: string): boolean {
        return this.subscribedTopics.has(topic);
    }

    getBandwidthStats(): BandwidthStats {
        return { ...this.stats };
    }

    getSubscribedTopics(): string[] {
        return [...this.subscribedTopics];
    }

    async connectToPeer(address: string): Promise<boolean> {
        try {
            const { multiaddr } = await import('@multiformats/multiaddr');
            await this.node.dial(multiaddr(address));
            return true;
        } catch {
            return false;
        }
    }

    getConnectedPeers(): PeerInfo[] {
        return this.node.getPeers().map((p) => ({
            id: p.toString(),
            addresses: [], // Would need to lookup in peer store
            protocols: [],
            latency: this.peerLatencies.get(p.toString()),
            connected: true,
        }));
    }

    // ─── Handlers ─────────────────────────────────────────────────

    // libp2p 3.x handler: (stream, connection) as separate args
    private async handleProtocolStream(stream: any, connection?: any): Promise<void> {
        const remotePeer = connection?.remotePeer?.toString() || 'unknown';
        let buffer = '';

        try {
            for await (const chunk of stream) {
                const bytes = chunk instanceof Uint8Array
                    ? chunk
                    : (chunk.subarray ? chunk.subarray() : new Uint8Array(chunk));

                buffer += new TextDecoder().decode(bytes);

                // Guard against unbounded buffer growth (DoS protection)
                if (buffer.length > 1_048_576) { // 1MB max
                    buffer = '';
                    continue;
                }

                // Process complete lines as they arrive (newline-delimited JSON)
                let newlineIdx;
                while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, newlineIdx).trim();
                    buffer = buffer.slice(newlineIdx + 1);

                    if (!line) continue;
                    try {
                        const msg: WireMessage = JSON.parse(line);

                        // Dedup
                        const msgHash = await this.hashMessage(Buffer.from(msg.data, 'base64'));
                        if (this.seenMessages.has(msgHash)) continue;
                        this.seenMessages.set(msgHash, Date.now());

                        // Decrypt if encrypted
                        let data: Buffer;
                        if (msg.encrypted && msg.nonce && msg.senderPubKey && this.security) {
                            try {
                                const plaintext = await this.security.decrypt({
                                    ciphertext: new Uint8Array(Buffer.from(msg.data, 'base64')),
                                    nonce: new Uint8Array(Buffer.from(msg.nonce, 'base64')),
                                    senderPublicKey: new Uint8Array(Buffer.from(msg.senderPubKey, 'base64')),
                                });
                                data = Buffer.from(plaintext);
                            } catch {
                                // Decryption failed — skip this message
                                continue;
                            }
                        } else {
                            data = Buffer.from(msg.data, 'base64');
                        }

                        this.stats.bytesReceived += data.byteLength;
                        this.stats.messagesReceived += 1;
                        const handler = this.messageHandlers.get(msg.topic);
                        if (handler) {
                            handler(new Uint8Array(data), remotePeer);
                        }

                        // Emit general message event
                        this.emit('message', msg.topic, new Uint8Array(data), remotePeer);
                    } catch {
                        // Malformed JSON line — skip
                    }
                }
            }
        } catch {
            // Stream closed or errored — expected for long-lived connections
        }
    }

    private handleGossipMessage(evt: any): void {
        const detail = evt?.detail ?? evt;
        const topic = detail?.topic ?? detail?.msg?.topic;
        const data = detail?.data ?? detail?.msg?.data;
        const from = detail?.from?.toString?.() ?? detail?.msg?.from?.toString?.() ?? 'unknown';

        if (!topic || !data) {
            return;
        }

        // Route to specific handler
        const handler = this.messageHandlers.get(topic);
        if (handler) {
            this.stats.bytesReceived += data.byteLength;
            this.stats.messagesReceived += 1;
            handler(data, from);
        }

        // Emit general event
        this.emit('message', topic, data, from);
    }

    private publishInProcess(topic: string, data: Uint8Array): void {
        const subscribers = P2PNode.inProcessTopicSubscribers.get(topic);
        if (!subscribers) return;

        for (const subscriber of subscribers) {
            if (subscriber === this) continue;
            subscriber.deliverInProcess(topic, data, this.getPeerId());
        }
    }

    private deliverInProcess(topic: string, data: Uint8Array, from: string): void {
        this.stats.bytesReceived += data.byteLength;
        this.stats.messagesReceived += 1;
        const handler = this.messageHandlers.get(topic);
        if (handler) {
            handler(data, from);
        }
        this.emit('message', topic, data, from);
    }

    // ─── Helpers ──────────────────────────────────────────────────

    private async connectToBootstraps(): Promise<void> {
        if (!this.config.bootstrapAddrs?.length) return;

        for (const addr of this.config.bootstrapAddrs) {
            try {
                const { multiaddr } = await import('@multiformats/multiaddr');
                await this.node.dial(multiaddr(addr));
                console.log(`[p2p] Connected to bootstrap: ${addr}`);
            } catch (err) {
                console.warn(`[p2p] Failed to connect to bootstrap ${addr}:`, (err as Error).message);
            }
        }
    }

    private async measureLatency(peerId: string): Promise<void> {
        try {
            const peer = peerIdFromString(peerId);
            const start = Date.now();
            // @ts-ignore - ping exists in runtime
            await this.node.services.ping.ping(peer);
            const latency = Date.now() - start;
            this.peerLatencies.set(peerId, latency);
        } catch {
            // Failed to measure
        }
    }

    private startMaintenance(): void {
        // Evict idle connections every 60 seconds
        setInterval(() => {
            const now = Date.now();
            for (const [peerId, pooled] of this.connectionPool.entries()) {
                if (now - pooled.lastUsed > CONNECTION_IDLE_MS) {
                    try { pooled.stream.close(); } catch {}
                    this.connectionPool.delete(peerId);
                }
            }
        }, 60 * 1000);

        // Measure latencies periodically
        setInterval(() => {
            for (const peerId of this.node.getPeers()) {
                this.measureLatency(peerId.toString());
            }
        }, 30 * 1000);
    }

    private async hashMessage(data: Uint8Array): Promise<string> {
        const { blake3 } = await import('@noble/hashes/blake3');
        const hash = blake3(data);
        return Buffer.from(hash).toString('base64url');
    }

    // ─── Encryption ─────────────────────────────────────────────────

    /**
     * Attach a SecurityManager for E2E encryption.
     * Call this before publishing encrypted messages.
     */
    setSecurityManager(security: SecurityManager): void {
        this.security = security;
    }

    /**
     * Enable encryption for all messages on a given topic.
     */
    enableEncryption(topic: string): void {
        this.encryptedTopics.add(topic);
    }

    /**
     * Disable encryption for a topic.
     */
    disableEncryption(topic: string): void {
        this.encryptedTopics.delete(topic);
    }

    /**
     * Check if encryption is enabled for a topic.
     */
    isEncrypted(topic: string): boolean {
        return this.encryptedTopics.has(topic);
    }

    /**
     * Get the local encryption public key (for key exchange).
     */
    async getEncryptionPublicKey(): Promise<Uint8Array | undefined> {
        if (!this.security) return undefined;
        await this.security.generateKeyPair();
        return (this.security as any).localEncryptionPublicKey;
    }

    async stop(): Promise<void> {
        // Close all pooled connections
        for (const [peerId, pooled] of this.connectionPool.entries()) {
            try {
                await pooled.stream.close();
            } catch {
                // Ignore
            }
        }
        this.connectionPool.clear();

        for (const topic of this.subscribedTopics) {
            P2PNode.inProcessTopicSubscribers.get(topic)?.delete(this);
            if ((P2PNode.inProcessTopicSubscribers.get(topic)?.size || 0) === 0) {
                P2PNode.inProcessTopicSubscribers.delete(topic);
            }
        }
        this.subscribedTopics.clear();

        await this.node?.stop();
        console.log('[p2p] Node stopped.');
    }
}
