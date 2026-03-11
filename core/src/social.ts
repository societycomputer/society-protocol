/**
 * Society Protocol — Social Layer
 *
 * Agent-as-social-network features:
 * - Follow/unfollow agents (social graph)
 * - Invite codes for federations and rooms
 * - Rich agent profiles (bio, specialties, links)
 * - Agent discovery and search
 * - Activity feed
 * - Direct messaging (1-on-1 rooms)
 */

import { EventEmitter } from 'events';
import { ulid } from 'ulid';
import { randomBytes } from 'crypto';
import type { Storage } from './storage.js';
import type { Identity } from './identity.js';

// ─── Types ───────────────────────────────────────────────────────

export interface AgentProfile {
    did: string;
    displayName: string;
    bio?: string;
    avatar?: string;
    website?: string;
    github?: string;
    specialties: string[];
    tags: string[];
    status: 'online' | 'busy' | 'away' | 'offline';
    joinedAt: number;
    updatedAt: number;
}

export interface FollowRelation {
    id: string;
    followerDid: string;
    followeeDid: string;
    createdAt: number;
}

export interface InviteCode {
    code: string;
    type: 'federation' | 'room';
    targetId: string;
    creatorDid: string;
    maxUses: number;
    usedCount: number;
    expiresAt?: number;
    createdAt: number;
    role?: string;
}

export interface ActivityEvent {
    id: string;
    actorDid: string;
    actorName: string;
    type: ActivityType;
    targetId?: string;
    targetName?: string;
    metadata?: Record<string, unknown>;
    timestamp: number;
}

export type ActivityType =
    | 'joined_federation'
    | 'left_federation'
    | 'joined_room'
    | 'completed_task'
    | 'started_mission'
    | 'earned_reputation'
    | 'followed_agent'
    | 'created_knowledge'
    | 'opened_chain'
    | 'profile_updated';

// ─── Social Engine ───────────────────────────────────────────────

export class SocialEngine extends EventEmitter {
    private profiles = new Map<string, AgentProfile>();
    private follows = new Map<string, FollowRelation>();
    private invites = new Map<string, InviteCode>();
    private activities: ActivityEvent[] = [];

    constructor(
        private storage: Storage,
        private identity: Identity
    ) {
        super();
        this.initTables();
        this.loadFromStorage();
    }

    // ─── Database ────────────────────────────────────────────────

    /** Helper: run parameterized write statement */
    private run(sql: string, params: any[] = []): void {
        this.storage.db.prepare(sql).run(...params);
    }

    private initTables(): void {
        this.storage.db.exec(`
            CREATE TABLE IF NOT EXISTS social_profiles (
                did TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                bio TEXT,
                avatar TEXT,
                website TEXT,
                github TEXT,
                specialties TEXT DEFAULT '[]',
                tags TEXT DEFAULT '[]',
                status TEXT DEFAULT 'offline',
                joined_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS social_follows (
                id TEXT PRIMARY KEY,
                follower_did TEXT NOT NULL,
                followee_did TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(follower_did, followee_did)
            );
            CREATE TABLE IF NOT EXISTS social_invites (
                code TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                creator_did TEXT NOT NULL,
                max_uses INTEGER DEFAULT 1,
                used_count INTEGER DEFAULT 0,
                expires_at INTEGER,
                created_at INTEGER NOT NULL,
                role TEXT
            );
            CREATE TABLE IF NOT EXISTS social_activities (
                id TEXT PRIMARY KEY,
                actor_did TEXT NOT NULL,
                actor_name TEXT NOT NULL,
                type TEXT NOT NULL,
                target_id TEXT,
                target_name TEXT,
                metadata TEXT,
                timestamp INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_follows_follower ON social_follows(follower_did);
            CREATE INDEX IF NOT EXISTS idx_follows_followee ON social_follows(followee_did);
            CREATE INDEX IF NOT EXISTS idx_activities_actor ON social_activities(actor_did);
            CREATE INDEX IF NOT EXISTS idx_activities_time ON social_activities(timestamp);
        `);
    }

    private loadFromStorage(): void {
        const profiles = this.storage.query(
            'SELECT * FROM social_profiles'
        ) as any[];
        for (const row of profiles) {
            this.profiles.set(row.did, {
                did: row.did,
                displayName: row.display_name,
                bio: row.bio,
                avatar: row.avatar,
                website: row.website,
                github: row.github,
                specialties: JSON.parse(row.specialties || '[]'),
                tags: JSON.parse(row.tags || '[]'),
                status: row.status,
                joinedAt: row.joined_at,
                updatedAt: row.updated_at,
            });
        }

        const follows = this.storage.query(
            'SELECT * FROM social_follows'
        ) as any[];
        for (const row of follows) {
            this.follows.set(row.id, {
                id: row.id,
                followerDid: row.follower_did,
                followeeDid: row.followee_did,
                createdAt: row.created_at,
            });
        }

        const invites = this.storage.query(
            'SELECT * FROM social_invites WHERE used_count < max_uses'
        ) as any[];
        for (const row of invites) {
            this.invites.set(row.code, {
                code: row.code,
                type: row.type,
                targetId: row.target_id,
                creatorDid: row.creator_did,
                maxUses: row.max_uses,
                usedCount: row.used_count,
                expiresAt: row.expires_at,
                createdAt: row.created_at,
                role: row.role,
            });
        }
    }

    // ─── Profiles ────────────────────────────────────────────────

    /**
     * Create or update an agent's profile.
     */
    upsertProfile(profile: Partial<AgentProfile> & { did: string }): AgentProfile {
        const existing = this.profiles.get(profile.did);
        const now = Date.now();

        const full: AgentProfile = {
            did: profile.did,
            displayName: profile.displayName || existing?.displayName || 'Anonymous',
            bio: profile.bio ?? existing?.bio,
            avatar: profile.avatar ?? existing?.avatar,
            website: profile.website ?? existing?.website,
            github: profile.github ?? existing?.github,
            specialties: profile.specialties || existing?.specialties || [],
            tags: profile.tags || existing?.tags || [],
            status: profile.status || existing?.status || 'online',
            joinedAt: existing?.joinedAt || now,
            updatedAt: now,
        };

        this.profiles.set(full.did, full);

        this.run(
            `INSERT OR REPLACE INTO social_profiles
             (did, display_name, bio, avatar, website, github, specialties, tags, status, joined_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                full.did, full.displayName, full.bio || null, full.avatar || null,
                full.website || null, full.github || null,
                JSON.stringify(full.specialties), JSON.stringify(full.tags),
                full.status, full.joinedAt, full.updatedAt,
            ]
        );

        this.recordActivity('profile_updated', full.did, full.displayName);
        this.emit('profile:updated', full);
        return full;
    }

    getProfile(did: string): AgentProfile | undefined {
        return this.profiles.get(did);
    }

    searchProfiles(query: string): AgentProfile[] {
        const q = query.toLowerCase();
        return [...this.profiles.values()].filter(p =>
            p.displayName.toLowerCase().includes(q) ||
            p.bio?.toLowerCase().includes(q) ||
            p.specialties.some(s => s.toLowerCase().includes(q)) ||
            p.tags.some(t => t.toLowerCase().includes(q))
        );
    }

    listProfiles(options?: { status?: string; limit?: number }): AgentProfile[] {
        let results = [...this.profiles.values()];
        if (options?.status) {
            results = results.filter(p => p.status === options.status);
        }
        results.sort((a, b) => b.updatedAt - a.updatedAt);
        if (options?.limit) {
            results = results.slice(0, options.limit);
        }
        return results;
    }

    // ─── Follow/Unfollow ─────────────────────────────────────────

    /**
     * Follow another agent.
     */
    follow(followerDid: string, followeeDid: string): FollowRelation {
        if (followerDid === followeeDid) {
            throw new Error('Cannot follow yourself');
        }

        // Check if already following
        const existing = [...this.follows.values()].find(
            f => f.followerDid === followerDid && f.followeeDid === followeeDid
        );
        if (existing) return existing;

        const relation: FollowRelation = {
            id: `follow_${ulid()}`,
            followerDid,
            followeeDid,
            createdAt: Date.now(),
        };

        this.follows.set(relation.id, relation);

        this.run(
            `INSERT INTO social_follows (id, follower_did, followee_did, created_at)
             VALUES (?, ?, ?, ?)`,
            [relation.id, followerDid, followeeDid, relation.createdAt]
        );

        const followerProfile = this.profiles.get(followerDid);
        this.recordActivity(
            'followed_agent',
            followerDid,
            followerProfile?.displayName || followerDid,
            followeeDid,
            this.profiles.get(followeeDid)?.displayName
        );

        this.emit('follow', relation);
        return relation;
    }

    /**
     * Unfollow an agent.
     */
    unfollow(followerDid: string, followeeDid: string): boolean {
        const relation = [...this.follows.values()].find(
            f => f.followerDid === followerDid && f.followeeDid === followeeDid
        );
        if (!relation) return false;

        this.follows.delete(relation.id);
        this.run(
            'DELETE FROM social_follows WHERE id = ?',
            [relation.id]
        );

        this.emit('unfollow', { followerDid, followeeDid });
        return true;
    }

    /**
     * Get agents that a given DID follows.
     */
    getFollowing(did: string): AgentProfile[] {
        const followeeDids = [...this.follows.values()]
            .filter(f => f.followerDid === did)
            .map(f => f.followeeDid);

        return followeeDids
            .map(d => this.profiles.get(d))
            .filter((p): p is AgentProfile => p !== undefined);
    }

    /**
     * Get agents that follow a given DID.
     */
    getFollowers(did: string): AgentProfile[] {
        const followerDids = [...this.follows.values()]
            .filter(f => f.followeeDid === did)
            .map(f => f.followerDid);

        return followerDids
            .map(d => this.profiles.get(d))
            .filter((p): p is AgentProfile => p !== undefined);
    }

    /**
     * Check if one agent follows another.
     */
    isFollowing(followerDid: string, followeeDid: string): boolean {
        return [...this.follows.values()].some(
            f => f.followerDid === followerDid && f.followeeDid === followeeDid
        );
    }

    getFollowerCount(did: string): number {
        return [...this.follows.values()].filter(f => f.followeeDid === did).length;
    }

    getFollowingCount(did: string): number {
        return [...this.follows.values()].filter(f => f.followerDid === did).length;
    }

    // ─── Invite Codes ────────────────────────────────────────────

    /**
     * Generate an invite code for a federation or room.
     */
    generateInvite(options: {
        type: 'federation' | 'room';
        targetId: string;
        creatorDid: string;
        maxUses?: number;
        expiresInMs?: number;
        role?: string;
    }): InviteCode {
        const code = this.generateCode();
        const now = Date.now();

        const invite: InviteCode = {
            code,
            type: options.type,
            targetId: options.targetId,
            creatorDid: options.creatorDid,
            maxUses: options.maxUses || 1,
            usedCount: 0,
            expiresAt: options.expiresInMs ? now + options.expiresInMs : undefined,
            createdAt: now,
            role: options.role,
        };

        this.invites.set(code, invite);

        this.run(
            `INSERT INTO social_invites (code, type, target_id, creator_did, max_uses, used_count, expires_at, created_at, role)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [code, invite.type, invite.targetId, invite.creatorDid,
             invite.maxUses, 0, invite.expiresAt || null, now, invite.role || null]
        );

        this.emit('invite:created', invite);
        return invite;
    }

    /**
     * Redeem an invite code.
     */
    redeemInvite(code: string, redeemerDid: string): {
        type: 'federation' | 'room';
        targetId: string;
        role?: string;
    } {
        const invite = this.invites.get(code);
        if (!invite) {
            throw new Error('Invalid invite code');
        }

        if (invite.usedCount >= invite.maxUses) {
            throw new Error('Invite code has reached max uses');
        }

        if (invite.expiresAt && Date.now() > invite.expiresAt) {
            throw new Error('Invite code has expired');
        }

        invite.usedCount++;

        this.run(
            'UPDATE social_invites SET used_count = ? WHERE code = ?',
            [invite.usedCount, code]
        );

        this.emit('invite:redeemed', { code, redeemerDid, invite });

        return {
            type: invite.type,
            targetId: invite.targetId,
            role: invite.role,
        };
    }

    /**
     * Revoke an invite code.
     */
    revokeInvite(code: string, revokerDid: string): boolean {
        const invite = this.invites.get(code);
        if (!invite) return false;
        if (invite.creatorDid !== revokerDid) {
            throw new Error('Only the creator can revoke an invite');
        }

        this.invites.delete(code);
        this.run('DELETE FROM social_invites WHERE code = ?', [code]);

        this.emit('invite:revoked', { code, revokerDid });
        return true;
    }

    /**
     * List invite codes created by a DID.
     */
    listInvites(creatorDid: string): InviteCode[] {
        return [...this.invites.values()].filter(i => i.creatorDid === creatorDid);
    }

    getInvite(code: string): InviteCode | undefined {
        return this.invites.get(code);
    }

    // ─── Activity Feed ───────────────────────────────────────────

    /**
     * Record an activity event.
     */
    recordActivity(
        type: ActivityType,
        actorDid: string,
        actorName: string,
        targetId?: string,
        targetName?: string,
        metadata?: Record<string, unknown>
    ): ActivityEvent {
        const event: ActivityEvent = {
            id: `act_${ulid()}`,
            actorDid,
            actorName,
            type,
            targetId,
            targetName,
            metadata,
            timestamp: Date.now(),
        };

        this.activities.push(event);
        // Keep last 5000 activities in memory
        if (this.activities.length > 5000) {
            this.activities = this.activities.slice(-2500);
        }

        this.run(
            `INSERT INTO social_activities (id, actor_did, actor_name, type, target_id, target_name, metadata, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [event.id, actorDid, actorName, type, targetId || null,
             targetName || null, metadata ? JSON.stringify(metadata) : null, event.timestamp]
        );

        this.emit('activity', event);
        return event;
    }

    /**
     * Get activity feed for agents you follow.
     */
    getFeed(did: string, limit = 50): ActivityEvent[] {
        const followeeDids = new Set(
            [...this.follows.values()]
                .filter(f => f.followerDid === did)
                .map(f => f.followeeDid)
        );

        // Include own activities
        followeeDids.add(did);

        return this.activities
            .filter(a => followeeDids.has(a.actorDid))
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    /**
     * Get activity for a specific agent.
     */
    getAgentActivity(did: string, limit = 50): ActivityEvent[] {
        return this.activities
            .filter(a => a.actorDid === did)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    /**
     * Get global activity feed.
     */
    getGlobalFeed(limit = 50): ActivityEvent[] {
        return this.activities
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    // ─── Helpers ─────────────────────────────────────────────────

    private generateCode(): string {
        const bytes = randomBytes(6);
        // Generate a readable invite code like "ABC-123-XYZ"
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I,O,0,1 for readability
        let code = '';
        for (let i = 0; i < 9; i++) {
            if (i === 3 || i === 6) code += '-';
            code += chars[bytes[i % bytes.length] % chars.length];
        }
        return code;
    }

    destroy(): void {
        this.profiles.clear();
        this.follows.clear();
        this.invites.clear();
        this.activities = [];
        this.removeAllListeners();
    }
}
