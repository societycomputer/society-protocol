/**
 * Society Protocol — Rooms Module v1.0
 *
 * Manages rooms (federations), chat messaging, presence, and CoC events.
 * Ties together P2P, SWP, and Storage layers.
 * Supports GossipSub and direct protocol streaming.
 */

import { type Identity } from './identity.js';
import { P2PNode, chatTopic, presenceTopic, cocTopic, adapterTopic, capsuleTopic, federationTopic, personaTopic, missionTopic, researchTopic } from './p2p.js';
import {
    createEnvelope,
    validateEnvelope,
    deserializeEnvelope,
    serializeEnvelope,
    type SwpEnvelope,
    type PresenceBody,
    type ChatMsgBody,
    type ChatReactionBody,
    type ChatEditBody,
    type MessageType,
    isCocMessage,
    isPresenceMessage,
    isAdapterMessage,
    isFederationMessage,
    isPersonaMessage,
    isMissionMessage,
    getMessagePriority,
    type AdapterCapabilities,
    type AdapterHeartbeatBody,
    type AdapterOfferBody,
    type AdapterProfile,
} from './swp.js';
import { Storage } from './storage.js';
import { type KnowledgePool, type ChatMessage } from './knowledge.js';
import { verifyIdentityProof, createIdentityProof, type IdentityProof } from './identity-proof.js';
import { ulid } from 'ulid';
import { EventEmitter } from 'events';
import type { InputValidator } from './prompt-guard.js';

// ─── Events ─────────────────────────────────────────────────────

export interface RoomEvents {
    'chat:message': (roomId: string, envelope: SwpEnvelope) => void;
    'chat:reaction': (roomId: string, envelope: SwpEnvelope) => void;
    'chat:edit': (roomId: string, envelope: SwpEnvelope) => void;
    'presence:update': (roomId: string, envelope: SwpEnvelope) => void;
    'coc:event': (roomId: string, envelope: SwpEnvelope) => void;
    'coc:open': (roomId: string, envelope: SwpEnvelope) => void;
    'coc:plan': (roomId: string, envelope: SwpEnvelope) => void;
    'coc:assign': (roomId: string, envelope: SwpEnvelope) => void;
    'coc:submit': (roomId: string, envelope: SwpEnvelope) => void;
    'coc:review': (roomId: string, envelope: SwpEnvelope) => void;
    'coc:merge': (roomId: string, envelope: SwpEnvelope) => void;
    'coc:close': (roomId: string, envelope: SwpEnvelope) => void;
    'coc:handoff': (roomId: string, envelope: SwpEnvelope) => void;
    'coc:cancel': (roomId: string, envelope: SwpEnvelope) => void;
    'adapter:event': (roomId: string, envelope: SwpEnvelope) => void;
    'capsule:event': (roomId: string, envelope: SwpEnvelope) => void;
    'federation:event': (roomId: string, envelope: SwpEnvelope) => void;
    'persona:event': (roomId: string, envelope: SwpEnvelope) => void;
    'mission:event': (roomId: string, envelope: SwpEnvelope) => void;
}

// ─── Room Manager ───────────────────────────────────────────────

export class RoomManager extends EventEmitter {
    private identity: Identity;
    private p2p: P2PNode;
    private storage: Storage;
    private heartbeatIntervals = new Map<string, ReturnType<typeof setInterval>>();
    private joinedRooms = new Set<string>();
    private encryptedRooms = new Set<string>();
    private verifiedPeers = new Map<string, Map<string, IdentityProof>>();
    private knowledgePool?: KnowledgePool;
    private validator?: InputValidator;
    private presenceBroadcastInterval?: ReturnType<typeof setInterval>;
    private replayCachePruneInterval?: ReturnType<typeof setInterval>;

    constructor(identity: Identity, p2p: P2PNode, storage: Storage) {
        super();
        this.identity = identity;
        this.p2p = p2p;
        this.storage = storage;

        // Set up P2P message handlers
        this.setupP2PHandlers();

        // Prune replay cache every hour to prevent unbounded growth
        this.replayCachePruneInterval = setInterval(() => {
            try { this.storage.pruneReplayCache(86400); } catch { /* ignore */ }
        }, 3_600_000);
    }

    /**
     * Attach a KnowledgePool for conversational knowledge exchange.
     * When set, all chat messages are automatically ingested into the
     * collaborative context for auto-compaction and knowledge extraction.
     */
    setKnowledgePool(pool: KnowledgePool): void {
        this.knowledgePool = pool;
    }

    setValidator(validator: InputValidator): void {
        this.validator = validator;
    }

    private setupP2PHandlers(): void {
        // Handle all incoming messages
        this.p2p.on('message', (topic: string, data: Uint8Array, from: string) => {
            this.handleIncomingMessage(topic, data, from);
        });
    }

    // ─── Room Management ──────────────────────────────────────────

    createRoom(name: string): string {
        const roomId = `room_${ulid()}`;
        this.storage.createRoom(roomId, name, this.identity.did);
        this.storage.addRoomMember(roomId, this.identity.did, this.identity.displayName);
        return roomId;
    }

    async joinRoom(roomId: string, roomName?: string): Promise<void> {
        if (this.joinedRooms.has(roomId)) return;

        // Ensure room exists in DB
        this.storage.createRoom(roomId, roomName ?? roomId, this.identity.did);
        this.storage.addRoomMember(roomId, this.identity.did, this.identity.displayName);

        // Subscribe to P2P topics
        await this.p2p.subscribe(chatTopic(roomId), (data, from) => {
            this.handleTopicMessage('chat', roomId, data, from);
        });
        
        await this.p2p.subscribe(presenceTopic(roomId), (data, from) => {
            this.handleTopicMessage('presence', roomId, data, from);
        });
        
        await this.p2p.subscribe(cocTopic(roomId), (data, from) => {
            this.handleTopicMessage('coc', roomId, data, from);
        });

        await this.p2p.subscribe(adapterTopic(roomId));
        await this.p2p.subscribe(capsuleTopic(roomId));
        await this.p2p.subscribe(federationTopic(roomId));
        await this.p2p.subscribe(personaTopic(roomId));
        await this.p2p.subscribe(missionTopic(roomId));
        await this.p2p.subscribe(researchTopic(roomId));

        this.joinedRooms.add(roomId);

        // Start heartbeat
        this.startHeartbeat(roomId);

        // Send initial presence
        await this.sendPresence(roomId, 'online');

        this.emit('room:joined', roomId);
    }

    async leaveRoom(roomId: string): Promise<void> {
        if (!this.joinedRooms.has(roomId)) return;

        // Send offline presence before leaving
        await this.sendPresence(roomId, 'offline');

        // Stop heartbeat
        const interval = this.heartbeatIntervals.get(roomId);
        if (interval) {
            clearInterval(interval);
            this.heartbeatIntervals.delete(roomId);
        }

        // Unsubscribe from P2P topics
        await this.p2p.unsubscribe(chatTopic(roomId));
        await this.p2p.unsubscribe(presenceTopic(roomId));
        await this.p2p.unsubscribe(cocTopic(roomId));
        await this.p2p.unsubscribe(adapterTopic(roomId));
        await this.p2p.unsubscribe(capsuleTopic(roomId));
        await this.p2p.unsubscribe(federationTopic(roomId));
        await this.p2p.unsubscribe(personaTopic(roomId));
        await this.p2p.unsubscribe(missionTopic(roomId));
        await this.p2p.unsubscribe(researchTopic(roomId));

        this.joinedRooms.delete(roomId);
        this.emit('room:left', roomId);
    }

    // ─── Messaging ────────────────────────────────────────────────

    async sendMessage(
        roomId: string, 
        textOrBody: string | Record<string, unknown> | any, 
        type: MessageType = 'chat.msg'
    ): Promise<SwpEnvelope> {
        let body: Record<string, unknown>;
        if (typeof textOrBody === 'string') {
            body = { text: textOrBody };
        } else {
            body = textOrBody as Record<string, unknown>;
        }

        const envelope = createEnvelope(this.identity, type, roomId, body);
        const data = serializeEnvelope(envelope);

        // Determine topic based on message type
        let topic: string;
        if (isCocMessage(type)) {
            topic = cocTopic(roomId);
        } else if (isPresenceMessage(type)) {
            topic = presenceTopic(roomId);
        } else if (isAdapterMessage(type)) {
            topic = adapterTopic(roomId);
        } else if (isFederationMessage(type)) {
            topic = federationTopic(roomId);
        } else if (isPersonaMessage(type)) {
            topic = personaTopic(roomId);
        } else if (isMissionMessage(type)) {
            topic = missionTopic(roomId);
        } else {
            topic = chatTopic(roomId);
        }

        // Apply locally first so local state does not depend on pubsub loopback.
        this.applyEnvelope(envelope, `self:${this.p2p.getPeerId()}`, { emitSent: true });

        // Publish to P2P with appropriate priority
        const priority = getMessagePriority(type);
        await this.p2p.publish(topic, data, priority);

        return envelope;
    }

    // ─── Chat Operations ──────────────────────────────────────────

    async sendChatMessage(
        roomId: string, 
        text: string, 
        options: {
            replyTo?: string;
            mentions?: string[];
            attachments?: string[];
            formatting?: 'markdown' | 'plain' | 'html';
        } = {}
    ): Promise<SwpEnvelope> {
        const body: ChatMsgBody = {
            text,
            reply_to: options.replyTo,
            mentions: options.mentions,
            attachments: options.attachments,
            formatting: options.formatting || 'plain',
        };

        return this.sendMessage(roomId, body, 'chat.msg');
    }

    async sendReaction(roomId: string, messageId: string, emoji: string, action: 'add' | 'remove' = 'add'): Promise<void> {
        const body: ChatReactionBody = {
            message_id: messageId,
            emoji,
            action,
        };
        await this.sendMessage(roomId, body, 'chat.reaction');
    }

    async editMessage(roomId: string, messageId: string, newText: string): Promise<void> {
        const body: ChatEditBody = {
            message_id: messageId,
            new_text: newText,
            edit_timestamp: Date.now(),
        };
        await this.sendMessage(roomId, body, 'chat.edit');
    }

    // ─── Presence Operations ──────────────────────────────────────

    async sendPresence(
        roomId: string, 
        status: 'online' | 'busy' | 'running' | 'offline' | 'away',
        options: {
            load?: number;
            specialties?: string[];
            capabilities?: string[];
        } = {}
    ): Promise<void> {
        const body: PresenceBody = {
            status,
            caps: options.capabilities || ['chat', 'coc'],
            load: options.load,
            specialties: options.specialties,
            peer_id: this.p2p.getPeerId(),
        };

        const envelope = createEnvelope(this.identity, 'presence.heartbeat', roomId, body as unknown as Record<string, unknown>);
        const data = serializeEnvelope(envelope);

        this.applyEnvelope(envelope, `self:${this.p2p.getPeerId()}`);

        try {
            await this.p2p.publish(presenceTopic(roomId), data, 'low');
        } catch {
            // Ignore publish errors (no peers yet)
        }
    }

    async broadcastCapabilitiesUpdate(
        roomId: string,
        added: string[],
        removed: string[]
    ): Promise<void> {
        const body = {
            added_caps: added,
            removed_caps: removed,
        };
        await this.sendMessage(roomId, body, 'presence.capabilities_update');
    }

    // ─── CoC Publishing ───────────────────────────────────────────

    async publishCocEvent(roomId: string, envelope: SwpEnvelope): Promise<void> {
        this.applyEnvelope(envelope, `self:${this.p2p.getPeerId()}`);
        const data = serializeEnvelope(envelope);
        await this.p2p.publish(cocTopic(roomId), data, 'high');
    }

    async publishAdapterRegistration(roomId: string, profile: AdapterProfile): Promise<void> {
        await this.sendMessage(roomId, { profile }, 'adapter.register');
    }

    async publishAdapterOffer(roomId: string, offer: AdapterOfferBody): Promise<void> {
        await this.sendMessage(roomId, offer, 'adapter.offer');
    }

    async publishAdapterHeartbeat(roomId: string, heartbeat: AdapterHeartbeatBody): Promise<void> {
        await this.sendMessage(roomId, heartbeat, 'adapter.heartbeat');
    }

    async publishAdapterCapabilities(roomId: string, capabilities: AdapterCapabilities & { worker_did?: string }): Promise<void> {
        await this.sendMessage(roomId, capabilities as Record<string, unknown>, 'adapter.capabilities');
    }

    async publishMissionEvent(
        roomId: string,
        type: 'mission.start' | 'mission.pause' | 'mission.resume' | 'mission.stop' | 'mission.checkpoint' | 'mission.alert',
        body: Record<string, unknown>
    ): Promise<void> {
        await this.sendMessage(roomId, body, type);
    }

    // ─── Message Handling ─────────────────────────────────────────

    private handleTopicMessage(
        topicType: 'chat' | 'presence' | 'coc' | 'adapter' | 'capsule' | 'federation' | 'persona' | 'mission' | 'research',
        roomId: string,
        data: Uint8Array,
        from: string
    ): void {
        // This is called when we receive a message on a subscribed topic
        // The actual processing is done in handleIncomingMessage
    }

    private handleIncomingMessage(topic: string, data: Uint8Array, from: string): void {
        try {
            const envelope = deserializeEnvelope(data);
            if (this.storage.hasReplay(envelope.from.did, envelope.id)) {
                return;
            }

            // Validate envelope
            const validation = validateEnvelope(envelope);
            if (!validation.valid) {
                console.warn(`[rooms] Rejected message from ${from}: ${validation.error}`);
                this.emit('message:rejected', envelope, validation);
                return;
            }

            this.applyEnvelope(envelope, from);

        } catch (err) {
            console.warn('[rooms] Failed to process message:', (err as Error).message);
            this.emit('message:error', err, from);
        }
    }

    private applyEnvelope(
        envelope: SwpEnvelope,
        from: string,
        options: { emitSent?: boolean } = {}
    ): boolean {
        if (this.storage.hasReplay(envelope.from.did, envelope.id)) {
            return false;
        }

        this.storage.addReplay(envelope.from.did, envelope.id);
        this.routeMessage(envelope, from);

        if (options.emitSent) {
            this.emit('message:sent', envelope.room, envelope);
        }

        return true;
    }

    private routeMessage(envelope: SwpEnvelope, from: string): void {
        const roomId = envelope.room;

        // Update room member info
        this.storage.addRoomMember(roomId, envelope.from.did, envelope.from.name);

        switch (envelope.t) {
            // Chat messages
            case 'chat.msg':
                this.handleChatMessage(envelope);
                break;
            case 'chat.reaction':
                this.emit('chat:reaction', roomId, envelope);
                break;
            case 'chat.edit':
                this.emit('chat:edit', roomId, envelope);
                break;

            // Presence
            case 'presence.heartbeat':
            case 'presence.capabilities_update':
            case 'presence.status_change':
                this.handlePresenceMessage(envelope);
                break;

            // CoC events
            case 'coc.open':
                this.emit('coc:open', roomId, envelope);
                this.emit('coc:event', roomId, envelope);
                break;
            case 'coc.plan':
                this.emit('coc:plan', roomId, envelope);
                this.emit('coc:event', roomId, envelope);
                break;
            case 'coc.assign':
                this.emit('coc:assign', roomId, envelope);
                this.emit('coc:event', roomId, envelope);
                break;
            case 'coc.submit':
                this.emit('coc:submit', roomId, envelope);
                this.emit('coc:event', roomId, envelope);
                break;
            case 'coc.review':
                this.emit('coc:review', roomId, envelope);
                this.emit('coc:event', roomId, envelope);
                break;
            case 'coc.merge':
                this.emit('coc:merge', roomId, envelope);
                this.emit('coc:event', roomId, envelope);
                break;
            case 'coc.close':
                this.emit('coc:close', roomId, envelope);
                this.emit('coc:event', roomId, envelope);
                break;
            case 'coc.handoff':
                this.emit('coc:handoff', roomId, envelope);
                this.emit('coc:event', roomId, envelope);
                break;
            case 'coc.cancel':
                this.emit('coc:cancel', roomId, envelope);
                this.emit('coc:event', roomId, envelope);
                break;
            case 'coc.feedback':
                this.emit('coc:event', roomId, envelope);
                break;

            // Adapter events
            case 'adapter.register':
            case 'adapter.offer':
            case 'adapter.heartbeat':
            case 'adapter.capabilities':
                this.emit('adapter:event', roomId, envelope);
                break;

            // Capsule events
            case 'capsule.publish':
            case 'capsule.import':
            case 'capsule.request':
                this.emit('capsule:event', roomId, envelope);
                break;

            // Federation Mesh events
            case 'federation.peer.request':
            case 'federation.peer.accept':
            case 'federation.peer.reject':
            case 'federation.peer.revoke':
            case 'federation.bridge.open':
            case 'federation.bridge.close':
            case 'federation.bridge.sync':
                this.emit('federation:event', roomId, envelope);
                break;

            // Persona Vault events
            case 'persona.memory.upsert':
            case 'persona.memory.delete':
            case 'persona.edge.upsert':
            case 'persona.claim.upsert':
            case 'persona.claim.revoke':
            case 'persona.zkp.proof':
            case 'persona.preference.update':
            case 'persona.sync.delta':
            case 'persona.sync.ack':
            case 'persona.capability.revoke':
            case 'persona.capability.attenuate':
                this.emit('persona:event', roomId, envelope);
                break;
            case 'mission.start':
            case 'mission.pause':
            case 'mission.resume':
            case 'mission.stop':
            case 'mission.checkpoint':
            case 'mission.alert':
                this.emit('mission:event', roomId, envelope);
                break;

            // Knowledge exchange
            case 'knowledge.context_sync':
                this.handleKnowledgeContextSync(envelope);
                break;
            case 'knowledge.sync':
                this.handleKnowledgeSync(envelope);
                break;

            // Security
            case 'security.key_exchange':
                this.emit('security:key_exchange', roomId, envelope);
                break;

            // Artifact transfer
            case 'artifact.offer':
            case 'artifact.request':
            case 'artifact.block':
                this.emit('artifact:event', roomId, envelope);
                break;

            case 'identity.proof':
                this.handleIdentityProof(roomId, envelope);
                break;

            default:
                // Unknown message type
                this.emit('message:unknown', roomId, envelope);
        }
    }

    private handleChatMessage(envelope: SwpEnvelope): void {
        const body = envelope.body as unknown as ChatMsgBody;
        const roomId = envelope.room;

        // Validate chat text against prompt injection
        if (this.validator && body.text) {
            try { body.text = this.validator.validateMessage(body.text, envelope.from.did); } catch { /* log but don't block chat */ }
        }

        // Store message
        this.storage.saveMessage(
            envelope.id,
            roomId,
            envelope.from.did,
            envelope.from.name,
            body.text,
            body.reply_to ?? null,
            envelope.ts
        );

        // Feed into knowledge pool for conversational context
        if (this.knowledgePool) {
            const chatMsg: ChatMessage = {
                id: envelope.id,
                sender: envelope.from.did,
                senderName: envelope.from.name,
                content: body.text,
                timestamp: envelope.ts,
                roomId,
            };
            this.knowledgePool.ingestChatMessage(roomId, chatMsg).catch(() => {
                // Non-critical — knowledge ingestion failure should not break chat
            });
        }

        // Emit
        this.emit('chat:message', roomId, envelope);
    }

    private handleKnowledgeContextSync(envelope: SwpEnvelope): void {
        if (!this.knowledgePool) return;
        const body = envelope.body as unknown as { data: string };
        if (body.data) {
            const data = new TextEncoder().encode(
                typeof body.data === 'string' ? body.data : JSON.stringify(body.data)
            );
            this.knowledgePool.mergeRemoteContext(data).catch(() => {});
        }
    }

    private handleKnowledgeSync(envelope: SwpEnvelope): void {
        if (!this.knowledgePool) return;
        const body = envelope.body as unknown as { card: string };
        if (body.card) {
            const data = new TextEncoder().encode(
                typeof body.card === 'string' ? body.card : JSON.stringify(body.card)
            );
            this.knowledgePool.handleSyncMessage(data, envelope.from.did);
        }
    }

    private handlePresenceMessage(envelope: SwpEnvelope): void {
        const body = envelope.body as unknown as PresenceBody;
        const roomId = envelope.room;

        // Update presence in storage
        this.storage.upsertPresence(
            envelope.from.did,
            envelope.from.name,
            body.status,
            body.caps || [],
            body.load ?? null,
            roomId
        );

        // Emit
        this.emit('presence:update', roomId, envelope);
    }

    // ─── Getters ──────────────────────────────────────────────────

    getMessages(roomId: string, limit = 50) {
        return this.storage.getMessages(roomId, limit);
    }

    getOnlinePeers(staleSeconds = 30) {
        return this.storage.getOnlinePeers(staleSeconds);
    }

    getJoinedRooms(): string[] {
        return Array.from(this.joinedRooms);
    }

    getVisibleWorkers(roomId: string) {
        return this.storage.getVisibleWorkers(roomId);
    }

    isJoined(roomId: string): boolean {
        return this.joinedRooms.has(roomId);
    }

    // ─── Encryption ─────────────────────────────────────────────

    /**
     * Enable E2E encryption for all messages in a room.
     * All chat, CoC, and data topics for this room will be encrypted.
     */
    enableEncryption(roomId: string): void {
        this.encryptedRooms.add(roomId);
        // Enable encryption on the main communication topics
        this.p2p.enableEncryption(chatTopic(roomId));
        this.p2p.enableEncryption(cocTopic(roomId));
        this.p2p.enableEncryption(capsuleTopic(roomId));
        this.p2p.enableEncryption(federationTopic(roomId));
        this.p2p.enableEncryption(personaTopic(roomId));
    }

    /**
     * Disable E2E encryption for a room.
     */
    disableEncryption(roomId: string): void {
        this.encryptedRooms.delete(roomId);
        this.p2p.disableEncryption(chatTopic(roomId));
        this.p2p.disableEncryption(cocTopic(roomId));
        this.p2p.disableEncryption(capsuleTopic(roomId));
        this.p2p.disableEncryption(federationTopic(roomId));
        this.p2p.disableEncryption(personaTopic(roomId));
    }

    /**
     * Check if a room has encryption enabled.
     */
    isEncrypted(roomId: string): boolean {
        return this.encryptedRooms.has(roomId);
    }

    // ─── Private ──────────────────────────────────────────────────

    private startHeartbeat(roomId: string): void {
        // Send presence every 10 seconds
        const interval = setInterval(() => {
            this.sendPresence(roomId, 'online').catch(() => {});
        }, 10_000);

        this.heartbeatIntervals.set(roomId, interval);
    }

    // ─── Cleanup ──────────────────────────────────────────────────

    destroy(): void {
        // Stop all heartbeats
        for (const [, interval] of this.heartbeatIntervals) {
            clearInterval(interval);
        }
        this.heartbeatIntervals.clear();

        // Stop replay cache pruning
        if (this.replayCachePruneInterval) {
            clearInterval(this.replayCachePruneInterval);
        }

        // Leave all rooms
        for (const roomId of this.joinedRooms) {
            this.leaveRoom(roomId).catch(console.error);
        }

        this.joinedRooms.clear();
    }

    // ─── Identity Proof (Schnorr PoK) ──────────────────────────

    /**
     * Broadcast a ZKP identity proof to a room.
     * Called automatically on room join.
     */
    async broadcastIdentityProof(roomId: string): Promise<void> {
        const proof = createIdentityProof(this.identity, roomId);
        const envelope = createEnvelope(
            this.identity,
            'identity.proof',
            roomId,
            proof as unknown as Record<string, unknown>
        );
        const data = serializeEnvelope(envelope);
        await this.p2p.publish(chatTopic(roomId), data);
    }

    private handleIdentityProof(roomId: string, envelope: SwpEnvelope): void {
        const proof = envelope.body as unknown as IdentityProof;
        if (!proof.did || !proof.proof) return;

        const result = verifyIdentityProof(proof);
        if (result.valid) {
            if (!this.verifiedPeers.has(roomId)) {
                this.verifiedPeers.set(roomId, new Map());
            }
            this.verifiedPeers.get(roomId)!.set(proof.did, proof);
            this.emit('identity:verified', { roomId, did: proof.did });
        } else {
            this.emit('identity:rejected', { roomId, did: proof.did, reason: result.reason });
        }
    }

    /**
     * Check if a peer has a verified identity in a room.
     */
    isVerifiedPeer(roomId: string, did: string): boolean {
        return this.verifiedPeers.get(roomId)?.has(did) ?? false;
    }
}
