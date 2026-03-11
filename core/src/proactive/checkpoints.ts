import { ulid } from 'ulid';
import type { Storage } from '../storage.js';
import type { MissionCheckpoint } from './types.js';

export class MissionCheckpointService {
    constructor(private storage: Storage) {}

    save(input: Omit<MissionCheckpoint, 'checkpointId' | 'createdAt'>): MissionCheckpoint {
        const checkpoint: MissionCheckpoint = {
            checkpointId: `mchk_${ulid()}`,
            createdAt: Date.now(),
            ...input,
        };
        this.storage.saveMissionCheckpoint(checkpoint);
        return checkpoint;
    }

    getLatest(missionId: string): MissionCheckpoint | undefined {
        return this.storage.getLatestMissionCheckpoint(missionId) as MissionCheckpoint | undefined;
    }
}
