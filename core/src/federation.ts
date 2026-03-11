/**
 * Society Protocol - Federation System v1.0
 * 
 * Sistema de federações inspirado no Matrix Protocol
 * - Federações permissionadas com governança
 * - Políticas customizáveis por federação
 * - Homeservers e rooms hierárquicos
 * - ACLs e permissões granulares
 * - social.md para definição de federações
 */

import { EventEmitter } from 'events';
import { ulid } from 'ulid';
import YAML from 'yaml';
import { type Storage } from './storage.js';
import { type Identity } from './identity.js';
import { createEnvelope, type SwpEnvelope, type MessageType } from './swp.js';
import { deepCanonicalJson, sign } from './identity.js';

// ─── Types ───────────────────────────────────────────────────────

export type FederationId = string;
export type PolicyId = string;
export type RoleId = string;

export type FederationVisibility = 'public' | 'private' | 'invite-only';
export type MemberStatus = 'pending' | 'member' | 'moderator' | 'admin' | 'banned';
export type GovernanceModel = 'dictatorship' | 'oligarchy' | 'democracy' | 'meritocracy';

export interface FederationPolicy {
    id: PolicyId;
    name: string;
    description: string;
    type: 'allow' | 'deny' | 'require';
    resource: string;        // 'room:create', 'message:send', 'member:invite', etc.
    conditions?: {
        minReputation?: number;
        minTrustTier?: 'bronze' | 'silver' | 'gold' | 'platinum';
        requireVerification?: boolean;
        allowedRoles?: RoleId[];
    };
    createdAt: number;
    createdBy: string;       // DID
}

export interface FederationRole {
    id: RoleId;
    name: string;
    description: string;
    permissions: string[];   // 'federation:admin', 'room:moderate', 'member:ban', etc.
    hierarchy: number;       // Higher = more power
    color?: string;          // UI display
}

export interface FederationMember {
    did: string;
    displayName: string;
    status: MemberStatus;
    role: RoleId;
    joinedAt: number;
    invitedBy?: string;
    reputationAtJoin: number;
    lastActivity: number;
    metadata?: {
        avatar?: string;
        bio?: string;
        specialties?: string[];
    };
}

export interface FederationGovernance {
    model: GovernanceModel;
    admins: string[];                    // DIDs
    moderators: string[];                // DIDs
    policyChangeThreshold: number;       // % de votos necessários
    electionEnabled: boolean;
    electionIntervalDays?: number;
    votingPower: 'equal' | 'reputation' | 'stake';
}

export interface Federation {
    id: FederationId;
    name: string;
    description: string;
    visibility: FederationVisibility;
    
    // Identidade
    did: string;                         // DID da federação (chave coletiva)
    creator: string;                     // DID do criador
    createdAt: number;
    
    // Governança
    governance: FederationGovernance;
    policies: FederationPolicy[];
    roles: FederationRole[];
    
    // Membros
    members: Map<string, FederationMember>;
    memberCount: number;
    onlineCount: number;
    
    // Estrutura
    homeserver?: string;                 // Node principal (opcional)
    rooms: string[];                     // IDs das rooms
    
    // Configurações
    settings: {
        allowGuestAccess: boolean;
        requireInvitation: boolean;
        autoVerifyMembers: boolean;
        messageRetentionDays: number;
        maxRoomSize: number;
        federationOutbound: boolean;     // Pode federar com outras federações
        federationInbound: boolean;      // Aceita federação de outras
    };
    
    // Segurança
    encryption: {
        enabled: boolean;
        algorithm: 'x25519-xsalsa20-poly1305' | 'aes-256-gcm';
        keyRotationDays: number;
    };
    
    // Metadados
    tags: string[];
    avatar?: string;
    banner?: string;
    language: string;
    timezone: string;
}

// social.md structure
export interface SocialManifest {
    social: {
        name: string;
        version: string;
        description: string;
        author: string;
        created: string;
    };
    federation: {
        visibility: FederationVisibility;
        governance: GovernanceModel;
        homeserver?: string;
    };
    policies: Array<{
        name: string;
        type: 'allow' | 'deny' | 'require';
        resource: string;
        conditions?: Record<string, any>;
    }>;
    roles: Array<{
        name: string;
        permissions: string[];
        hierarchy: number;
    }>;
    settings: {
        allowGuestAccess: boolean;
        requireInvitation: boolean;
        messageRetentionDays: number;
        maxRoomSize: number;
    };
}

interface GovernanceVote {
    voterDid: string;
    vote: 'yes' | 'no' | 'abstain';
    votingPower: number;
    votedAt: number;
}

interface GovernanceProposal {
    id: string;
    federationId: FederationId;
    proposerDid: string;
    policy: FederationPolicy;
    status: 'open' | 'approved' | 'rejected';
    createdAt: number;
    closedAt?: number;
    votes: Map<string, GovernanceVote>;
}

export type FederationPeeringStatus = 'pending' | 'active' | 'rejected' | 'revoked';

export interface FederationPeeringPolicy {
    allowedTypes: string[];
    maxRatePerMinute: number;
    privacyMode: 'metadata-only' | 'summary' | 'full';
    allowedRooms?: string[];
    blockedRooms?: string[];
}

export interface FederationPeering {
    id: string;
    sourceFederationId: FederationId;
    sourceFederationDid: string;
    targetFederationDid: string;
    requestedBy: string;
    status: FederationPeeringStatus;
    policy: FederationPeeringPolicy;
    reason?: string;
    createdAt: number;
    updatedAt: number;
    respondedAt?: number;
}

// ─── Federation Engine ───────────────────────────────────────────

export class FederationEngine extends EventEmitter {
    private federations = new Map<FederationId, Federation>();
    private memberFederations = new Map<string, Set<FederationId>>(); // did -> federations
    private proposals = new Map<string, GovernanceProposal>();
    private peerings = new Map<string, FederationPeering>();
    
    constructor(
        private storage: Storage,
        private identity: Identity
    ) {
        super();
        this.loadFederations();
        this.loadGovernance();
        this.loadPeerings();
    }

    // ─── Federation CRUD ─────────────────────────────────────────

    async createFederation(
        name: string,
        description: string,
        visibility: FederationVisibility = 'private',
        manifest?: SocialManifest
    ): Promise<Federation> {
        const id = `fed_${ulid()}`;
        const now = Date.now();
        
        const federation: Federation = {
            id,
            name,
            description,
            visibility,
            did: `did:society:${id}`,
            creator: this.identity.did,
            createdAt: now,
            
            governance: manifest?.federation.governance ? {
                model: manifest.federation.governance,
                admins: [this.identity.did],
                moderators: [],
                policyChangeThreshold: 51,
                electionEnabled: manifest.federation.governance === 'democracy',
                votingPower: 'reputation'
            } : {
                model: 'dictatorship',
                admins: [this.identity.did],
                moderators: [],
                policyChangeThreshold: 100,
                electionEnabled: false,
                votingPower: 'equal'
            },
            
            policies: (manifest?.policies.map((p) => ({
                id: `pol_${ulid()}`,
                name: p.name,
                description: '',
                type: p.type,
                resource: p.resource,
                conditions: p.conditions,
                createdAt: now,
                createdBy: this.identity.did
            })) as FederationPolicy[]) || [this.getDefaultPolicy()],
            
            roles: manifest?.roles.map((r, i) => ({
                id: `role_${i}`,
                name: r.name,
                description: '',
                permissions: r.permissions,
                hierarchy: r.hierarchy
            })) || this.getDefaultRoles(),
            
            members: new Map(),
            memberCount: 1,
            onlineCount: 1,
            
            rooms: [],
            
            settings: manifest?.settings ? {
                allowGuestAccess: manifest.settings.allowGuestAccess,
                requireInvitation: manifest.settings.requireInvitation,
                autoVerifyMembers: false,
                messageRetentionDays: manifest.settings.messageRetentionDays,
                maxRoomSize: manifest.settings.maxRoomSize,
                federationOutbound: true,
                federationInbound: visibility === 'public'
            } : {
                allowGuestAccess: false,
                requireInvitation: visibility !== 'public',
                autoVerifyMembers: false,
                messageRetentionDays: 30,
                maxRoomSize: 1000,
                federationOutbound: true,
                federationInbound: visibility === 'public'
            },
            
            encryption: {
                enabled: visibility !== 'public',
                algorithm: 'x25519-xsalsa20-poly1305',
                keyRotationDays: 30
            },
            
            tags: [],
            language: 'pt-BR',
            timezone: 'America/Sao_Paulo'
        };

        // Criador é admin automaticamente
        federation.members.set(this.identity.did, {
            did: this.identity.did,
            displayName: this.identity.displayName,
            status: 'admin',
            role: 'admin',
            joinedAt: now,
            reputationAtJoin: 100,
            lastActivity: now
        });

        this.federations.set(id, federation);
        this.addMemberToIndex(this.identity.did, id);
        
        await this.saveFederation(federation);
        
        this.emit('federation:created', federation);
        
        return federation;
    }

    async joinFederation(
        federationId: FederationId,
        did: string,
        displayName: string,
        inviterDid?: string
    ): Promise<boolean> {
        const federation = this.federations.get(federationId);
        if (!federation) throw new Error('Federation not found');

        // Verificar se já é membro
        if (federation.members.has(did)) {
            throw new Error('Already a member');
        }

        // Verificar políticas de entrada
        if (federation.settings.requireInvitation && !inviterDid) {
            throw new Error('Invitation required');
        }

        if (federation.visibility === 'invite-only' && !inviterDid) {
            throw new Error('Invitation required for invite-only federation');
        }

        // Verificar ban
        const existingMember = federation.members.get(did);
        if (existingMember?.status === 'banned') {
            throw new Error('Banned from federation');
        }

        // Fetch actual reputation from storage
        let reputationAtJoin = 0;
        try {
            const repRecord = this.storage.getReputationRecord?.(did);
            if (repRecord?.overall_score) {
                reputationAtJoin = repRecord.overall_score;
            }
        } catch {
            // Storage may not have reputation data yet; default to 0
        }

        const member: FederationMember = {
            did,
            displayName,
            status: federation.settings.autoVerifyMembers ? 'member' : 'pending',
            role: 'member',
            joinedAt: Date.now(),
            invitedBy: inviterDid,
            reputationAtJoin,
            lastActivity: Date.now()
        };

        federation.members.set(did, member);
        federation.memberCount++;
        
        this.addMemberToIndex(did, federationId);
        await this.saveFederation(federation);

        this.emit('federation:member:joined', federationId, member);
        
        return true;
    }

    async leaveFederation(federationId: FederationId, did: string): Promise<void> {
        const federation = this.federations.get(federationId);
        if (!federation) throw new Error('Federation not found');

        if (!federation.members.has(did)) {
            throw new Error('Not a member');
        }

        // Não permitir se for o último admin
        const member = federation.members.get(did)!;
        if (member.status === 'admin') {
            const adminCount = Array.from(federation.members.values())
                .filter(m => m.status === 'admin').length;
            if (adminCount <= 1) {
                throw new Error('Cannot leave: last admin must transfer ownership');
            }
        }

        federation.members.delete(did);
        federation.memberCount--;
        
        this.removeMemberFromIndex(did, federationId);
        await this.saveFederation(federation);

        this.emit('federation:member:left', federationId, did);
    }

    // ─── Governance ─────────────────────────────────────────────

    async proposePolicyChange(
        federationId: FederationId,
        policy: Partial<FederationPolicy>,
        proposerDid: string
    ): Promise<string> {
        const federation = this.federations.get(federationId);
        if (!federation) throw new Error('Federation not found');

        // Verificar permissão
        if (!this.hasPermission(federation, proposerDid, 'federation:policy:propose')) {
            throw new Error('No permission to propose policy changes');
        }

        const proposalId = `prop_${ulid()}`;
        const now = Date.now();
        const proposal: GovernanceProposal = {
            id: proposalId,
            federationId,
            proposerDid,
            status: 'open',
            createdAt: now,
            policy: {
                id: policy.id || `pol_${ulid()}`,
                name: policy.name || 'Policy Update',
                description: policy.description || '',
                type: policy.type || 'require',
                resource: policy.resource || '*',
                conditions: policy.conditions,
                createdAt: now,
                createdBy: proposerDid
            },
            votes: new Map()
        };
        this.proposals.set(proposalId, proposal);
        this.storage.saveFederationProposal(
            proposalId,
            federationId,
            proposerDid,
            proposal.policy,
            'open'
        );
        
        this.emit('federation:policy:proposed', federationId, proposalId, policy);
        
        return proposalId;
    }

    async voteOnProposal(
        federationId: FederationId,
        proposalId: string,
        voterDid: string,
        vote: 'yes' | 'no' | 'abstain'
    ): Promise<void> {
        const federation = this.federations.get(federationId);
        if (!federation) throw new Error('Federation not found');

        // Calcular poder de voto
        const votingPower = this.calculateVotingPower(federation, voterDid);
        const proposal = this.getProposal(proposalId);
        if (!proposal || proposal.federationId !== federationId) {
            throw new Error('Proposal not found');
        }
        if (proposal.status !== 'open') {
            throw new Error('Proposal is closed');
        }
        if (!federation.members.has(voterDid)) {
            throw new Error('Only federation members can vote');
        }

        const voteRecord: GovernanceVote = {
            voterDid,
            vote,
            votingPower,
            votedAt: Date.now()
        };
        proposal.votes.set(voterDid, voteRecord);
        this.storage.saveFederationVote(
            proposalId,
            voterDid,
            vote,
            votingPower
        );

        this.evaluateProposal(federation, proposal);
        
        this.emit('federation:vote', federationId, proposalId, voterDid, vote, votingPower);
    }

    // ─── Federation Mesh: Peering ───────────────────────────────

    async requestPeering(
        sourceFederationId: FederationId,
        targetFederationDid: string,
        policy: Partial<FederationPeeringPolicy> = {}
    ): Promise<FederationPeering> {
        const federation = this.federations.get(sourceFederationId);
        if (!federation) {
            throw new Error(`Federation not found: ${sourceFederationId}`);
        }
        if (!federation.settings.federationOutbound) {
            throw new Error('Federation outbound peering is disabled');
        }
        if (!this.hasPermission(federation, this.identity.did, 'federation:peer:request')) {
            throw new Error('No permission to request peering');
        }
        if (targetFederationDid === federation.did) {
            throw new Error('Cannot peer federation with itself');
        }

        const now = Date.now();
        const peering: FederationPeering = {
            id: `peer_${ulid()}`,
            sourceFederationId,
            sourceFederationDid: federation.did,
            targetFederationDid,
            requestedBy: this.identity.did,
            status: 'pending',
            policy: this.normalizePeeringPolicy(policy),
            createdAt: now,
            updatedAt: now
        };

        this.peerings.set(peering.id, peering);
        this.persistPeering(peering);

        this.emit('federation:peering:requested', peering);
        return peering;
    }

    async respondPeering(
        peeringId: string,
        accepted: boolean,
        reason?: string
    ): Promise<FederationPeering> {
        const peering = this.peerings.get(peeringId);
        if (!peering) {
            throw new Error(`Peering not found: ${peeringId}`);
        }
        if (peering.status !== 'pending') {
            throw new Error(`Peering ${peeringId} is not pending`);
        }

        const now = Date.now();
        peering.status = accepted ? 'active' : 'rejected';
        peering.reason = reason;
        peering.respondedAt = now;
        peering.updatedAt = now;

        this.peerings.set(peering.id, peering);
        this.persistPeering(peering);

        this.emit(
            accepted ? 'federation:peering:accepted' : 'federation:peering:rejected',
            peering
        );

        return peering;
    }

    async revokePeering(peeringId: string, reason?: string): Promise<FederationPeering> {
        const peering = this.peerings.get(peeringId);
        if (!peering) {
            throw new Error(`Peering not found: ${peeringId}`);
        }

        const now = Date.now();
        peering.status = 'revoked';
        peering.reason = reason;
        peering.respondedAt = peering.respondedAt ?? now;
        peering.updatedAt = now;

        this.peerings.set(peering.id, peering);
        this.persistPeering(peering);

        this.emit('federation:peering:revoked', peering);
        return peering;
    }

    listPeerings(
        federationId: FederationId,
        status?: FederationPeeringStatus
    ): FederationPeering[] {
        const federationDid = this.federations.get(federationId)?.did;
        if (!federationDid) {
            return [];
        }

        return Array.from(this.peerings.values())
            .filter((peering) => {
                if (status && peering.status !== status) return false;
                return (
                    peering.sourceFederationId === federationId ||
                    peering.targetFederationDid === federationDid
                );
            })
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    getPeering(peeringId: string): FederationPeering | undefined {
        return this.peerings.get(peeringId);
    }

    // ─── Permissions & ACL ─────────────────────────────────────

    hasPermission(federation: Federation, did: string, permission: string): boolean {
        const member = federation.members.get(did);
        if (!member) return false;

        // Admin tem todas as permissões
        if (member.status === 'admin') return true;

        // Verificar role
        const role = federation.roles.find(r => r.id === member.role);
        if (!role) return false;

        return role.permissions.includes(permission) || 
               role.permissions.includes('*');
    }

    checkPolicy(
        federation: Federation,
        action: string,
        actorDid: string,
        context?: Record<string, any>
    ): { allowed: boolean; reason?: string } {
        // Buscar políticas aplicáveis
        const policies = federation.policies.filter(p => 
            p.resource === action || 
            p.resource === '*' ||
            action.startsWith(p.resource.replace('*', ''))
        );

        // Ordenar: deny primeiro, depois require, depois allow
        policies.sort((a, b) => {
            const order = { deny: 0, require: 1, allow: 2 };
            return order[a.type] - order[b.type];
        });

        for (const policy of policies) {
            // Verificar condições
            if (policy.conditions) {
                const member = federation.members.get(actorDid);
                if (!member) continue;

                if (policy.conditions.minReputation) {
                    // TODO: Verificar reputação real
                }

                if (policy.conditions.allowedRoles) {
                    if (!policy.conditions.allowedRoles.includes(member.role)) {
                        continue;
                    }
                }
            }

            switch (policy.type) {
                case 'deny':
                    return { allowed: false, reason: `Policy denies: ${policy.name}` };
                case 'require':
                    // Verificar se requisito está satisfeito
                    break;
                case 'allow':
                    return { allowed: true };
            }
        }

        // Default: deny
        return { allowed: false, reason: 'No policy allows this action' };
    }

    // ─── social.md Parser ───────────────────────────────────────

    static parseSocialManifest(yamlContent: string): SocialManifest {
        const parsed = YAML.parse(yamlContent) as Partial<SocialManifest>;
        if (!parsed?.social?.name || !parsed?.social?.description) {
            throw new Error('Invalid social manifest: social.name and social.description are required');
        }

        return {
            social: {
                name: parsed.social.name,
                version: parsed.social.version || '1.0.0',
                description: parsed.social.description,
                author: parsed.social.author || 'unknown',
                created: parsed.social.created || new Date().toISOString()
            },
            federation: {
                visibility: parsed.federation?.visibility || 'private',
                governance: parsed.federation?.governance || 'dictatorship',
                homeserver: parsed.federation?.homeserver
            },
            policies: parsed.policies || [],
            roles: parsed.roles || [],
            settings: {
                allowGuestAccess: parsed.settings?.allowGuestAccess ?? false,
                requireInvitation: parsed.settings?.requireInvitation ?? true,
                messageRetentionDays: parsed.settings?.messageRetentionDays ?? 30,
                maxRoomSize: parsed.settings?.maxRoomSize ?? 1000
            }
        };
    }

    async createFederationFromSocial(
        socialPath: string
    ): Promise<Federation> {
        // Ler arquivo
        const fs = await import('fs');
        const content = fs.readFileSync(socialPath, 'utf-8');
        
        const manifest = FederationEngine.parseSocialManifest(content);
        
        return this.createFederation(
            manifest.social.name,
            manifest.social.description,
            manifest.federation.visibility,
            manifest
        );
    }

    // ─── Queries ────────────────────────────────────────────────

    getFederation(id: FederationId): Federation | undefined {
        return this.federations.get(id);
    }

    getMemberFederations(did: string): Federation[] {
        const ids = this.memberFederations.get(did);
        if (!ids) return [];
        return Array.from(ids).map(id => this.federations.get(id)!).filter(Boolean);
    }

    getPublicFederations(): Federation[] {
        return Array.from(this.federations.values())
            .filter(f => f.visibility === 'public');
    }

    searchFederations(query: string): Federation[] {
        const lowerQuery = query.toLowerCase();
        return Array.from(this.federations.values())
            .filter(f => 
                f.name.toLowerCase().includes(lowerQuery) ||
                f.description.toLowerCase().includes(lowerQuery) ||
                f.tags.some(t => t.toLowerCase().includes(lowerQuery))
            );
    }

    // ─── Private Helpers ────────────────────────────────────────

    private getDefaultPolicy(): FederationPolicy {
        return {
            id: `pol_${ulid()}`,
            name: 'Default Allow',
            description: 'Allow all actions by default',
            type: 'allow',
            resource: '*',
            createdAt: Date.now(),
            createdBy: this.identity.did
        };
    }

    private getDefaultRoles(): FederationRole[] {
        return [
            {
                id: 'admin',
                name: 'Administrator',
                description: 'Full control of federation',
                permissions: ['*'],
                hierarchy: 100,
                color: '#ff0000'
            },
            {
                id: 'moderator',
                name: 'Moderator',
                description: 'Can moderate content and members',
                permissions: [
                    'room:moderate',
                    'member:ban',
                    'message:delete',
                    'federation:policy:propose'
                ],
                hierarchy: 50,
                color: '#00ff00'
            },
            {
                id: 'member',
                name: 'Member',
                description: 'Regular member',
                permissions: [
                    'room:join',
                    'room:create',
                    'message:send',
                    'member:invite'
                ],
                hierarchy: 10,
                color: '#0000ff'
            },
            {
                id: 'guest',
                name: 'Guest',
                description: 'Limited access',
                permissions: [
                    'room:join',
                    'message:send:readonly'
                ],
                hierarchy: 0,
                color: '#808080'
            }
        ];
    }

    private normalizePeeringPolicy(
        policy: Partial<FederationPeeringPolicy>
    ): FederationPeeringPolicy {
        const allowedTypes = policy.allowedTypes?.length
            ? policy.allowedTypes
            : ['chat.msg', 'coc.open', 'coc.plan', 'coc.submit', 'federation.bridge.sync'];

        const maxRatePerMinute = Number(policy.maxRatePerMinute);
        return {
            allowedTypes,
            maxRatePerMinute:
                Number.isFinite(maxRatePerMinute) && maxRatePerMinute > 0
                    ? Math.floor(maxRatePerMinute)
                    : 200,
            privacyMode: policy.privacyMode || 'summary',
            allowedRooms: policy.allowedRooms,
            blockedRooms: policy.blockedRooms
        };
    }

    private calculateVotingPower(federation: Federation, did: string): number {
        const member = federation.members.get(did);
        if (!member) return 0;

        switch (federation.governance.votingPower) {
            case 'equal':
                return 1;
            case 'reputation':
                const reputation = this.storage.getReputationRecord?.(did);
                if (reputation?.overall_score) {
                    return Math.max(0.1, reputation.overall_score);
                }
                return Math.max(0.1, member.reputationAtJoin || 1);
            case 'stake':
                // Stake ainda não está disponível - fallback para peso igual
                return 1;
            default:
                return 1;
        }
    }

    private addMemberToIndex(did: string, federationId: FederationId): void {
        if (!this.memberFederations.has(did)) {
            this.memberFederations.set(did, new Set());
        }
        this.memberFederations.get(did)!.add(federationId);
    }

    private removeMemberFromIndex(did: string, federationId: FederationId): void {
        this.memberFederations.get(did)?.delete(federationId);
    }

    private async saveFederation(federation: Federation): Promise<void> {
        this.storage.saveFederation?.(federation);
    }

    private loadFederations(): void {
        const federations = this.storage.getFederations?.() || [];
        for (const fed of federations) {
            const hydrated = this.hydrateFederation(fed);
            this.federations.set(hydrated.id, hydrated);
            for (const [did] of hydrated.members) {
                this.addMemberToIndex(did, fed.id);
            }
        }
    }

    private loadGovernance(): void {
        const proposals = this.storage.getFederationProposals?.() || [];
        for (const proposalRow of proposals) {
            const proposal: GovernanceProposal = {
                id: proposalRow.proposal_id,
                federationId: proposalRow.federation_id,
                proposerDid: proposalRow.proposer_did,
                policy: proposalRow.policy,
                status: proposalRow.status,
                createdAt: proposalRow.created_at,
                closedAt: proposalRow.closed_at || undefined,
                votes: new Map()
            };
            const votes = this.storage.getFederationVotes?.(proposal.id) || [];
            for (const vote of votes) {
                proposal.votes.set(vote.voter_did, {
                    voterDid: vote.voter_did,
                    vote: vote.vote,
                    votingPower: vote.voting_power,
                    votedAt: vote.voted_at
                });
            }
            this.proposals.set(proposal.id, proposal);
        }
    }

    private loadPeerings(): void {
        const rows = this.storage.listFederationPeerings?.() || [];
        for (const row of rows) {
            const storedPolicy = (row.policy || {}) as Record<string, unknown>;
            const peering: FederationPeering = {
                id: row.peeringId,
                sourceFederationId: row.sourceFederationId,
                sourceFederationDid: row.sourceFederationDid,
                targetFederationDid: row.targetFederationDid,
                requestedBy:
                    typeof storedPolicy.requestedBy === 'string'
                        ? storedPolicy.requestedBy
                        : row.sourceFederationDid,
                status: row.status,
                policy: this.normalizePeeringPolicy(storedPolicy as Partial<FederationPeeringPolicy>),
                reason: row.reason,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                respondedAt: row.respondedAt
            };
            this.peerings.set(peering.id, peering);
        }
    }

    private persistPeering(peering: FederationPeering): void {
        this.storage.saveFederationPeering?.({
            peeringId: peering.id,
            sourceFederationId: peering.sourceFederationId,
            sourceFederationDid: peering.sourceFederationDid,
            targetFederationDid: peering.targetFederationDid,
            policy: {
                ...peering.policy,
                requestedBy: peering.requestedBy
            },
            status: peering.status,
            reason: peering.reason,
            createdAt: peering.createdAt,
            updatedAt: peering.updatedAt,
            respondedAt: peering.respondedAt
        });
    }

    private getProposal(proposalId: string): GovernanceProposal | undefined {
        return this.proposals.get(proposalId);
    }

    private evaluateProposal(federation: Federation, proposal: GovernanceProposal): void {
        if (proposal.status !== 'open') return;

        const eligibleMembers = Array.from(federation.members.values())
            .filter((member) => member.status !== 'pending' && member.status !== 'banned');
        const totalEligiblePower = eligibleMembers.reduce((acc, member) =>
            acc + this.calculateVotingPower(federation, member.did), 0
        );

        if (totalEligiblePower <= 0) {
            return;
        }

        let yesPower = 0;
        let noPower = 0;

        for (const vote of proposal.votes.values()) {
            if (vote.vote === 'yes') yesPower += vote.votingPower;
            if (vote.vote === 'no') noPower += vote.votingPower;
        }

        const threshold = federation.governance.policyChangeThreshold / 100;
        if (yesPower / totalEligiblePower >= threshold) {
            const policyIndex = federation.policies.findIndex(p => p.id === proposal.policy.id);
            if (policyIndex >= 0) {
                federation.policies[policyIndex] = proposal.policy;
            } else {
                federation.policies.push(proposal.policy);
            }
            proposal.status = 'approved';
            proposal.closedAt = Date.now();
            this.storage.setFederationProposalStatus?.(proposal.id, 'approved');
            this.saveFederation(federation);
            this.emit('federation:policy:approved', federation.id, proposal.id, proposal.policy);
            return;
        }

        if (noPower / totalEligiblePower > (1 - threshold)) {
            proposal.status = 'rejected';
            proposal.closedAt = Date.now();
            this.storage.setFederationProposalStatus?.(proposal.id, 'rejected');
            this.emit('federation:policy:rejected', federation.id, proposal.id);
        }
    }

    private hydrateFederation(raw: any): Federation {
        const members = this.normalizeMembers(raw.members);
        return {
            ...raw,
            members,
            memberCount: raw.memberCount ?? members.size,
            onlineCount: raw.onlineCount ?? 0
        } as Federation;
    }

    private normalizeMembers(rawMembers: any): Map<string, FederationMember> {
        if (rawMembers instanceof Map) {
            return rawMembers;
        }
        if (Array.isArray(rawMembers)) {
            return new Map(rawMembers);
        }
        if (rawMembers && typeof rawMembers === 'object') {
            return new Map(Object.entries(rawMembers));
        }
        return new Map();
    }
}

// Classes already exported via 'export class'
