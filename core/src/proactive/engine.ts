import { ulid } from 'ulid';
import type { Identity } from '../identity.js';
import type { Storage } from '../storage.js';
import type { RoomManager } from '../rooms.js';
import type { CocEngine } from '../coc.js';
import type { Planner } from '../planner.js';
import type { KnowledgePool } from '../knowledge.js';
import { getTemplate } from '../templates.js';
import type { CocDagNode } from '../swp.js';
import { MissionCheckpointService } from './checkpoints.js';
import { P2PSwarmRegistry } from './swarm-registry.js';
import { SwarmScheduler } from './scheduler.js';
import type {
    MissionInfo,
    MissionStatus,
    ProactiveMissionSpec,
    SwarmStatus,
} from './types.js';
import { DEFAULT_MISSION_POLICY as DEFAULT_POLICY, DEFAULT_RESEARCH_POLICY as DEFAULT_RESEARCH } from './types.js';

export interface ProactiveMissionEngineOptions {
    enableLeadership?: boolean;
    autoRestoreMissions?: boolean;
    leaseTtlMs?: number;
    leaseRenewIntervalMs?: number;
}

export class ProactiveMissionEngine {
    private missionTimers = new Map<string, ReturnType<typeof setInterval>>();
    private leaseTimers = new Map<string, ReturnType<typeof setInterval>>();
    private leadershipState = new Map<string, boolean>();
    private checkpoints: MissionCheckpointService;
    private registry: P2PSwarmRegistry;
    private scheduler: SwarmScheduler;
    private readonly instanceId: string;
    private readonly enableLeadership: boolean;
    private readonly autoRestoreMissions: boolean;
    private readonly leaseTtlMs: number;
    private readonly leaseRenewIntervalMs: number;

    constructor(
        private identity: Identity,
        private storage: Storage,
        private rooms: RoomManager,
        private coc: CocEngine,
        private planner: Planner,
        private knowledge: KnowledgePool,
        registry?: P2PSwarmRegistry,
        scheduler?: SwarmScheduler,
        options: ProactiveMissionEngineOptions = {}
    ) {
        this.checkpoints = new MissionCheckpointService(storage);
        this.registry = registry || new P2PSwarmRegistry(storage, rooms);
        this.scheduler = scheduler || new SwarmScheduler();
        this.instanceId = `leader_${ulid()}`;
        this.enableLeadership = options.enableLeadership ?? false;
        this.autoRestoreMissions = options.autoRestoreMissions ?? false;
        this.leaseTtlMs = options.leaseTtlMs ?? 45_000;
        this.leaseRenewIntervalMs = options.leaseRenewIntervalMs ?? 15_000;
        this.bindEvents();
        this.restoreActiveMissions();
    }

    private bindEvents(): void {
        this.coc.on('step:unlocked', (chainId: string) => {
            if (!this.enableLeadership) return;
            const mission = this.storage.findMissionByChain(chainId);
            if (mission) {
                this.tickMission(mission.missionId).catch(() => {});
            }
        });
        this.coc.on('step:expired', (chainId: string) => {
            if (!this.enableLeadership) return;
            const mission = chainId ? this.storage.findMissionByChain(chainId) : undefined;
            if (mission) {
                this.tickMission(mission.missionId).catch(() => {});
            }
        });
    }

    private restoreActiveMissions(): void {
        if (!this.enableLeadership || !this.autoRestoreMissions) {
            return;
        }
        for (const mission of this.storage.listMissions().filter((item) => item.status === 'active' || item.status === 'waiting_capacity')) {
            if (mission.leaderDid !== this.identity.did) continue;
            this.startLeadershipManagement(mission.missionId, mission.cadenceMs).catch(() => {});
        }
    }

    async startMission(spec: ProactiveMissionSpec): Promise<MissionInfo> {
        if (!this.enableLeadership) {
            throw new Error('Mission leadership is disabled for this client. Enable proactive.enableLeadership to start missions.');
        }

        if (!this.rooms.isJoined(spec.roomId)) {
            await this.rooms.joinRoom(spec.roomId, spec.roomId);
        }

        const missionId = `mission_${ulid()}`;
        const policy = {
            ...DEFAULT_POLICY,
            ...spec.policy,
            swarm: { ...DEFAULT_POLICY.swarm, ...(spec.policy?.swarm || {}) },
            retry: { ...DEFAULT_POLICY.retry, ...(spec.policy?.retry || {}) },
        };
        const research = { ...DEFAULT_RESEARCH, ...(spec.research || {}) };
        const templateId = spec.templateId || 'literature_review_continuous';
        const nextTickAt = Date.now() + spec.cadenceMs;

        let knowledgeSpaceId = spec.knowledge?.spaceId;
        if (!knowledgeSpaceId && spec.knowledge?.autoIndex !== false) {
            const space = await this.knowledge.createSpace(
                `Mission ${missionId}`,
                `Knowledge space for mission ${spec.goal}`,
                'team',
                'room'
            );
            knowledgeSpaceId = space.id;
        }

        this.storage.createMission({
            missionId,
            roomId: spec.roomId,
            goal: spec.goal,
            missionType: spec.missionType,
            templateId,
            mode: spec.mode,
            status: 'active',
            leaderDid: this.identity.did,
            cadenceMs: spec.cadenceMs,
            policy,
            research,
            knowledge: {
                autoIndex: spec.knowledge?.autoIndex !== false,
                spaceId: knowledgeSpaceId,
            },
            activeChainIds: [],
            lastTickAt: Date.now(),
            nextTickAt,
        });
        await this.rooms.sendMessage(spec.roomId, {
            mission_id: missionId,
            goal: spec.goal,
            template_id: templateId,
            cadence_ms: spec.cadenceMs,
        }, 'mission.start');

        await this.ensureMissionCycle(missionId, true);
        await this.startLeadershipManagement(missionId, spec.cadenceMs);
        return this.getMission(missionId)!;
    }

    async pauseMission(missionId: string): Promise<void> {
        const mission = this.storage.getMission(missionId);
        if (!mission) throw new Error(`Mission not found: ${missionId}`);
        this.stopLeadershipManagement(missionId, true);
        this.storage.updateMissionStatus(missionId, 'paused');
        await this.rooms.sendMessage(mission.roomId, { mission_id: missionId }, 'mission.pause');
    }

    async resumeMission(missionId: string): Promise<void> {
        const mission = this.storage.getMission(missionId);
        if (!mission) throw new Error(`Mission not found: ${missionId}`);
        this.storage.updateMissionStatus(missionId, 'active', {
            nextTickAt: Date.now() + mission.cadenceMs,
        });
        await this.rooms.sendMessage(mission.roomId, { mission_id: missionId }, 'mission.resume');
        if (this.enableLeadership && mission.leaderDid === this.identity.did) {
            await this.startLeadershipManagement(missionId, mission.cadenceMs);
            await this.tickMission(missionId);
        }
    }

    async stopMission(missionId: string, reason?: string): Promise<void> {
        const mission = this.storage.getMission(missionId);
        if (!mission) throw new Error(`Mission not found: ${missionId}`);
        this.stopLeadershipManagement(missionId, true);
        this.storage.updateMissionStatus(missionId, 'stopped');
        await this.rooms.sendMessage(mission.roomId, { mission_id: missionId, reason }, 'mission.stop');
    }

    listMissions(roomId?: string): MissionInfo[] {
        return this.storage.listMissions(roomId).map((mission) => this.toMissionInfo(mission));
    }

    getMission(missionId: string): MissionInfo | undefined {
        const mission = this.storage.getMission(missionId);
        return mission ? this.toMissionInfo(mission) : undefined;
    }

    getSwarmStatus(roomId?: string): SwarmStatus {
        const workers = this.registry.getWorkers(roomId);
        const activeMissions = this.storage.listMissions(roomId).filter((mission) => mission.status === 'active').length;
        return {
            roomId,
            workers,
            healthyWorkers: workers.filter((worker) => worker.health === 'healthy').length,
            degradedWorkers: workers.filter((worker) => worker.health === 'degraded').length,
            overloadedWorkers: workers.filter((worker) => worker.load >= 1).length,
            activeMissions,
        };
    }

    async tickMission(missionId: string): Promise<void> {
        if (!this.enableLeadership) return;

        const mission = this.storage.getMission(missionId);
        if (!mission || mission.status !== 'active' && mission.status !== 'waiting_capacity') return;
        if (mission.leaderDid !== this.identity.did) return;

        if (!this.rooms.isJoined(mission.roomId)) {
            await this.rooms.joinRoom(mission.roomId, mission.roomId);
        }
        if (!this.isCurrentLeader(missionId)) {
            return;
        }

        await this.ensureMissionCycle(missionId);

        const workers = this.registry.getWorkers(mission.roomId).filter((worker) => {
            return worker.health !== 'unhealthy' && (worker.missionTags?.length ? worker.missionTags.includes(missionId) || worker.missionTags.includes(mission.templateId || '') : true);
        });

        let assignedAny = false;
        let openSteps = 0;

        for (const chainId of mission.activeChainIds) {
            const chain = this.coc.getChain(chainId);
            if (!chain) continue;
            const steps = this.storage.getChainSteps(chainId);
            for (const step of steps) {
                if (!this.isRunnableStep(steps, step)) continue;
                openSteps++;
                const decision = this.scheduler.selectWorker(workers, step);
                if (!decision) continue;
                const leaseMs = (mission.policy as any)?.swarm?.leaseMs || DEFAULT_POLICY.swarm.leaseMs;
                await this.coc.assignStep(chain.room_id, chain.chain_id, step.step_id, decision.worker.did, leaseMs);
                assignedAny = true;
            }
        }

        const status: MissionStatus = workers.length === 0 || openSteps > 0 && !assignedAny ? 'waiting_capacity' : 'active';
        this.storage.updateMissionStatus(missionId, status, {
            lastTickAt: Date.now(),
            nextTickAt: Date.now() + mission.cadenceMs,
        });

        const checkpoint = this.checkpoints.save({
            missionId,
            summary: `Mission ${mission.goal} status=${status} open_steps=${openSteps}`,
            frontier: {
                activeChainIds: mission.activeChainIds,
                openStepIds: mission.activeChainIds.flatMap((chainId) =>
                    this.storage.getChainSteps(chainId).filter((step) => step.status === 'proposed' || step.status === 'assigned').map((step) => step.step_id)
                ),
                topics: [mission.goal],
                hypotheses: [],
            },
            knowledge: {
                cardIds: [],
                artifactIds: [],
            },
        });
        await this.rooms.sendMessage(mission.roomId, {
            mission_id: missionId,
            checkpoint_id: checkpoint.checkpointId,
            summary: checkpoint.summary,
        }, 'mission.checkpoint');
    }

    private async ensureMissionCycle(missionId: string, force = false): Promise<void> {
        const mission = this.storage.getMission(missionId);
        if (!mission) return;

        const activeChains = mission.activeChainIds
            .map((chainId) => this.coc.getChain(chainId))
            .filter(Boolean);
        const hasActiveWork = activeChains.some((chain) => {
            if (!chain) return false;
            const steps = this.storage.getChainSteps(chain.chain_id);
            return steps.some((step) => !['submitted', 'merged', 'rejected', 'cancelled'].includes(step.status));
        });
        if (hasActiveWork && !force) {
            return;
        }

        const subdomainsPerCycle = Number((mission.research as any)?.subdomainsPerCycle || DEFAULT_RESEARCH.subdomainsPerCycle);
        const dag = await this.buildMissionDag(mission.goal, mission.templateId || 'literature_review_continuous', subdomainsPerCycle);
        const chainId = await this.coc.openChain(mission.roomId, `${mission.goal} [cycle ${mission.activeChainIds.length + 1}]`, {
            priority: 'high',
            templateId: mission.templateId,
        });
        await this.coc.publishPlan(mission.roomId, chainId, dag);
        this.storage.appendMissionChain(missionId, chainId);
        this.storage.createMissionRun({
            runId: `mrun_${ulid()}`,
            missionId,
            cycle: mission.activeChainIds.length + 1,
            chainId,
            status: 'running',
        });
    }

    private async buildMissionDag(goal: string, templateId: string, subdomainsPerCycle: number): Promise<CocDagNode[]> {
        if (templateId && ['literature_review_continuous', 'hypothesis_swarm', 'research_monitor'].includes(templateId)) {
            return getTemplate(templateId).generate(goal, { domains: subdomainsPerCycle });
        }
        if (templateId) {
            return getTemplate(templateId).generate(goal, { domains: subdomainsPerCycle });
        }
        const plan = await this.planner.generatePlan(goal);
        return plan.dag;
    }

    private isRunnableStep(steps: any[], step: any): boolean {
        if (step.status !== 'proposed') return false;
        const deps = JSON.parse(step.depends_on || '[]');
        return deps.every((depId: string) => {
            const dep = steps.find((entry) => entry.step_id === depId);
            return dep && (dep.status === 'submitted' || dep.status === 'merged');
        });
    }

    private async startLeadershipManagement(missionId: string, cadenceMs: number): Promise<void> {
        this.clearTicker(missionId);
        this.clearLeaseTicker(missionId);
        this.leadershipState.set(missionId, false);

        const leaseTimer = setInterval(() => {
            this.refreshLeadership(missionId, cadenceMs).catch(() => {});
        }, this.leaseRenewIntervalMs);
        leaseTimer.unref?.();
        this.leaseTimers.set(missionId, leaseTimer);

        await this.refreshLeadership(missionId, cadenceMs, true);
    }

    private stopLeadershipManagement(missionId: string, releaseLease: boolean): void {
        this.clearTicker(missionId);
        this.clearLeaseTicker(missionId);
        this.leadershipState.delete(missionId);
        if (releaseLease) {
            this.storage.releaseMissionLease(missionId, this.instanceId);
        }
    }

    private async refreshLeadership(missionId: string, cadenceMs: number, runImmediateTick = false): Promise<void> {
        const mission = this.storage.getMission(missionId);
        if (!mission) {
            this.stopLeadershipManagement(missionId, false);
            return;
        }
        if (mission.leaderDid !== this.identity.did || mission.status === 'paused' || mission.status === 'stopped') {
            this.stopLeadershipManagement(missionId, true);
            return;
        }

        const hadLeadership = this.leadershipState.get(missionId) === true;
        const hasLeadership = await this.ensureLeadershipLease(mission);
        this.leadershipState.set(missionId, hasLeadership);

        if (!hasLeadership) {
            this.clearTicker(missionId);
            if (hadLeadership) {
                await this.rooms.sendMessage(mission.roomId, {
                    mission_id: missionId,
                    level: 'warning',
                    code: 'leadership_lost',
                    holder_instance_id: this.instanceId,
                }, 'mission.alert');
            }
            return;
        }

        if (!this.missionTimers.has(missionId)) {
            this.startTicker(missionId, cadenceMs);
        }
        if (runImmediateTick) {
            await this.tickMission(missionId);
        }
    }

    private async ensureLeadershipLease(mission: { missionId: string; roomId: string; leaderDid: string }): Promise<boolean> {
        if (mission.leaderDid !== this.identity.did) {
            return false;
        }
        if (!this.rooms.isJoined(mission.roomId)) {
            await this.rooms.joinRoom(mission.roomId, mission.roomId);
        }
        const now = Date.now();
        if (this.storage.renewMissionLease(mission.missionId, this.instanceId, this.identity.did, this.leaseTtlMs, now)) {
            return true;
        }
        return this.storage.acquireMissionLease(mission.missionId, this.instanceId, this.identity.did, this.leaseTtlMs, now);
    }

    private isCurrentLeader(missionId: string): boolean {
        const lease = this.storage.getMissionLease(missionId);
        return !!lease &&
            lease.holderInstanceId === this.instanceId &&
            lease.holderDid === this.identity.did &&
            lease.expiresAt > Date.now();
    }

    private startTicker(missionId: string, cadenceMs: number): void {
        this.clearTicker(missionId);
        const timer = setInterval(() => {
            this.tickMission(missionId).catch(() => {});
        }, cadenceMs);
        timer.unref?.();
        this.missionTimers.set(missionId, timer);
    }

    private clearTicker(missionId: string): void {
        const timer = this.missionTimers.get(missionId);
        if (timer) clearInterval(timer);
        this.missionTimers.delete(missionId);
    }

    private clearLeaseTicker(missionId: string): void {
        const timer = this.leaseTimers.get(missionId);
        if (timer) clearInterval(timer);
        this.leaseTimers.delete(missionId);
    }

    private toMissionInfo(mission: any): MissionInfo {
        const workers = this.registry.getWorkers(mission.roomId);
        let openSteps = 0;
        for (const chainId of mission.activeChainIds) {
            openSteps += this.storage.getChainSteps(chainId).filter((step) => step.status === 'proposed' || step.status === 'assigned').length;
        }
        return {
            missionId: mission.missionId,
            roomId: mission.roomId,
            goal: mission.goal,
            status: mission.status,
            leaderDid: mission.leaderDid,
            activeChainIds: mission.activeChainIds,
            cadenceMs: mission.cadenceMs,
            openSteps,
            healthyWorkers: workers.filter((worker) => worker.health === 'healthy').length,
            degradedWorkers: workers.filter((worker) => worker.health === 'degraded').length,
            lastTickAt: mission.lastTickAt,
            nextTickAt: mission.nextTickAt,
            templateId: mission.templateId,
        };
    }

    destroy(): void {
        for (const missionId of Array.from(new Set([
            ...this.missionTimers.keys(),
            ...this.leaseTimers.keys(),
        ]))) {
            this.stopLeadershipManagement(missionId, true);
        }
    }
}
