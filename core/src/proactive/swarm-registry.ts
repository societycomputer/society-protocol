import type { SwpEnvelope, AdapterHeartbeatBody, AdapterOfferBody, PresenceBody } from '../swp.js';
import type { RoomManager } from '../rooms.js';
import type { Storage } from '../storage.js';
import type { SwarmWorkerProfile, SwarmWorkerAnnouncement } from './types.js';

export class P2PSwarmRegistry {
    constructor(
        private storage: Storage,
        private rooms: RoomManager
    ) {
        this.bind();
    }

    private bind(): void {
        this.rooms.on('presence:update', (roomId, envelope) => {
            this.handlePresence(roomId, envelope);
        });
        this.rooms.on('adapter:event', (roomId, envelope) => {
            this.handleAdapter(roomId, envelope);
        });
    }

    private handlePresence(roomId: string, envelope: SwpEnvelope): void {
        const body = envelope.body as unknown as PresenceBody & { peer_id?: string };
        const caps = body.caps || [];
        const workerLike = caps.includes('worker') || caps.includes('research') || caps.includes('runtime');
        if (!workerLike) return;

        this.storage.upsertSwarmWorker({
            did: envelope.from.did,
            peerId: body.peer_id,
            roomId,
            hostId: body.peer_id || envelope.from.did,
            runtime: caps.includes('nanobot') ? 'nanobot' : caps.includes('docker') ? 'docker' : caps.includes('ollama') ? 'ollama' : 'custom',
            specialties: body.specialties || [],
            capabilities: caps,
            kinds: ['task', 'review', 'synthesis', 'verification'],
            maxConcurrency: 1,
            load: body.load || 0,
            health: body.status === 'offline' ? 'unhealthy' : body.status === 'busy' ? 'degraded' : 'healthy',
            lastSeen: envelope.ts,
            displayName: envelope.from.name,
        });
    }

    private handleAdapter(roomId: string, envelope: SwpEnvelope): void {
        switch (envelope.t) {
            case 'adapter.register': {
                const body = envelope.body as unknown as { profile?: SwarmWorkerAnnouncement };
                const profile = body.profile;
                if (!profile) return;
                this.storage.upsertSwarmWorker({
                    did: profile.owner_did || envelope.from.did,
                    peerId: profile.peer_id,
                    roomId: profile.room_id || roomId,
                    hostId: profile.host_id || profile.peer_id || profile.owner_did || envelope.from.did,
                    runtime: profile.runtime === 'nanobot' || profile.runtime === 'docker' || profile.runtime === 'ollama'
                        ? profile.runtime
                        : 'custom',
                    specialties: profile.specialties || [],
                    capabilities: profile.capabilities || [],
                    kinds: (profile.kinds as SwarmWorkerProfile['kinds']) || ['task'],
                    maxConcurrency: profile.max_concurrency || 1,
                    load: 0,
                    health: 'healthy',
                    missionTags: profile.mission_tags || [],
                    adapterId: profile.adapter_id,
                    displayName: profile.display_name,
                    endpoint: profile.endpoint,
                    lastSeen: envelope.ts,
                });
                break;
            }
            case 'adapter.offer': {
                const body = envelope.body as unknown as AdapterOfferBody & { room_id?: string; worker_did?: string };
                const workerDid = body.worker_did || envelope.from.did;
                const existing = this.storage.getSwarmWorker(workerDid);
                if (!existing) return;
                this.storage.upsertSwarmWorker({
                    ...existing,
                    roomId: body.room_id || roomId,
                    load: body.current_load,
                    queueDepth: body.active_tasks,
                    lastSeen: envelope.ts,
                });
                break;
            }
            case 'adapter.heartbeat': {
                const body = envelope.body as unknown as AdapterHeartbeatBody & { worker_did?: string; room_id?: string };
                const workerDid = body.worker_did || envelope.from.did;
                const existing = this.storage.getSwarmWorker(workerDid);
                if (!existing) return;
                this.storage.upsertSwarmWorker({
                    ...existing,
                    roomId: body.room_id || roomId,
                    load: Math.min(1, (body.active_tasks || 0) / Math.max(1, existing.maxConcurrency || 1)),
                    health: body.health,
                    queueDepth: body.queue_depth,
                    successRate: body.metrics?.success_rate,
                    lastSeen: envelope.ts,
                });
                break;
            }
            case 'adapter.capabilities': {
                const body = envelope.body as unknown as { worker_did?: string; room_id?: string; capabilities?: string[]; specialties?: string[]; kinds?: string[] };
                const workerDid = body.worker_did || envelope.from.did;
                const existing = this.storage.getSwarmWorker(workerDid);
                if (!existing) return;
                this.storage.upsertSwarmWorker({
                    ...existing,
                    roomId: body.room_id || roomId,
                    capabilities: body.capabilities || existing.capabilities,
                    specialties: body.specialties || existing.specialties,
                    kinds: (body.kinds as SwarmWorkerProfile['kinds']) || existing.kinds,
                    lastSeen: envelope.ts,
                });
                break;
            }
        }
    }

    getWorkers(roomId?: string): SwarmWorkerProfile[] {
        return this.storage.getVisibleWorkers(roomId) as unknown as SwarmWorkerProfile[];
    }
}
