import { create } from 'zustand';
import type { FederationData } from '../../shared/types';

interface FederationsState {
  federations: FederationData[];
  setFederations: (feds: FederationData[]) => void;
  addFederation: (fed: FederationData) => void;
}

export const useFederationsStore = create<FederationsState>((set) => ({
  federations: [],
  setFederations: (federations) => set({ federations }),
  addFederation: (fed) => set((s) => ({
    federations: [...s.federations, fed],
  })),
}));
