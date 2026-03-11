import type { AdapterProfile } from '../swp.js';

export type MissionType = 'scientific_research';
export type MissionTemplateId = 'literature_review_continuous' | 'hypothesis_swarm' | 'research_monitor';
export type MissionMode = 'continuous';
export type MissionStatus =
    | 'active'
    | 'paused'
    | 'waiting_capacity'
    | 'awaiting_approval'
    | 'failed'
    | 'stopped';

export interface MissionPolicy {
    autonomy: 'advisory' | 'semiautonomous' | 'autonomous';
    approvalGates: Array<'publish' | 'external_write' | 'costly_action'>;
    swarm: {
        minWorkers: number;
        maxWorkers: number;
        targetUtilization: number;
        leaseMs: number;
        rebalanceIntervalMs: number;
    };
    retry: {
        maxStepRetries: number;
        maxMissionReplans: number;
        cooldownMs: number;
    };
}

export interface ResearchPolicy {
    sources: Array<'arxiv' | 'pubmed' | 'crossref' | 'semantic-scholar' | 'web'>;
    subdomainsPerCycle: number;
    requireDualReview: boolean;
    requireCitationExtraction: boolean;
    requireContradictionScan: boolean;
    synthesisIntervalMs: number;
}

export interface ProactiveMissionSpec {
    roomId: string;
    goal: string;
    missionType: MissionType;
    templateId?: MissionTemplateId;
    mode: MissionMode;
    cadenceMs: number;
    policy: MissionPolicy;
    research: ResearchPolicy;
    knowledge?: {
        autoIndex: boolean;
        spaceId?: string;
    };
}

export interface MissionInfo {
    missionId: string;
    roomId: string;
    goal: string;
    status: MissionStatus;
    leaderDid: string;
    activeChainIds: string[];
    cadenceMs: number;
    openSteps: number;
    healthyWorkers: number;
    degradedWorkers: number;
    lastTickAt?: number;
    nextTickAt?: number;
    templateId?: MissionTemplateId;
}

export interface MissionCheckpoint {
    checkpointId: string;
    missionId: string;
    summary: string;
    frontier: {
        activeChainIds: string[];
        openStepIds: string[];
        topics: string[];
        hypotheses: string[];
    };
    knowledge: {
        cardIds: string[];
        artifactIds: string[];
    };
    createdAt: number;
}

export interface SwarmWorkerProfile {
    did: string;
    peerId?: string;
    hostId: string;
    roomId: string;
    runtime: 'nanobot' | 'docker' | 'ollama' | 'custom';
    specialties: string[];
    capabilities: string[];
    kinds: Array<'task' | 'review' | 'synthesis' | 'verification'>;
    maxConcurrency: number;
    load: number;
    health: 'healthy' | 'degraded' | 'unhealthy';
    missionTags?: string[];
    adapterId?: string;
    displayName?: string;
    endpoint?: string;
    successRate?: number;
    queueDepth?: number;
    lastSeen?: number;
}

export interface SwarmStatus {
    roomId?: string;
    workers: SwarmWorkerProfile[];
    healthyWorkers: number;
    degradedWorkers: number;
    overloadedWorkers: number;
    activeMissions: number;
}

export interface ResearchWorkerConfig {
    roomId: string;
    hostId: string;
    runtime: SwarmWorkerProfile['runtime'];
    specialties: string[];
    capabilities: string[];
    kinds?: SwarmWorkerProfile['kinds'];
    maxConcurrency?: number;
    missionTags?: string[];
    endpoint?: string;
    pollIntervalMs?: number;
    executor?: (task: {
        stepId: string;
        chainId: string;
        title: string;
        description?: string;
        requirements?: Record<string, unknown>;
    }) => Promise<{
        status: 'completed' | 'failed' | 'partial';
        output: string;
        artifacts?: Array<{ artifact_id?: string; artifact_type?: string; content?: string; content_hash?: string }>;
    }>;
}

export interface SchedulerDecision {
    worker: SwarmWorkerProfile;
    score: number;
    reason: string;
}

export interface SwarmWorkerAnnouncement extends AdapterProfile {
    owner_did: string;
    room_id: string;
    peer_id?: string;
    host_id?: string;
    mission_tags?: string[];
}

export const DEFAULT_MISSION_POLICY: MissionPolicy = {
    autonomy: 'semiautonomous',
    approvalGates: ['publish', 'external_write', 'costly_action'],
    swarm: {
        minWorkers: 2,
        maxWorkers: 12,
        targetUtilization: 0.7,
        leaseMs: 120_000,
        rebalanceIntervalMs: 30_000,
    },
    retry: {
        maxStepRetries: 3,
        maxMissionReplans: 20,
        cooldownMs: 60_000,
    },
};

export const DEFAULT_RESEARCH_POLICY: ResearchPolicy = {
    sources: ['arxiv', 'pubmed', 'crossref', 'semantic-scholar', 'web'],
    subdomainsPerCycle: 4,
    requireDualReview: true,
    requireCitationExtraction: true,
    requireContradictionScan: true,
    synthesisIntervalMs: 300_000,
};
