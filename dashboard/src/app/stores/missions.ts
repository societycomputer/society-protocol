import { create } from 'zustand';
import type { MissionData } from '../../shared/types';

interface MissionsState {
  missions: MissionData[];
  setMissions: (missions: MissionData[]) => void;
  updateMission: (id: string, update: Partial<MissionData>) => void;
}

export const useMissionsStore = create<MissionsState>((set) => ({
  missions: [],
  setMissions: (missions) => set({ missions }),
  updateMission: (id, update) => set((s) => ({
    missions: s.missions.map(m => m.id === id ? { ...m, ...update } : m),
  })),
}));
