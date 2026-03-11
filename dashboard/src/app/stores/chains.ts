import { create } from 'zustand';
import type { ChainData, StepData } from '../../shared/types';

interface ChainsState {
  chains: ChainData[];
  setChains: (chains: ChainData[]) => void;
  addChain: (chain: ChainData) => void;
  updateChainStatus: (chainId: string, status: string) => void;
  updateStep: (chainId: string, stepId: string, update: Partial<StepData>) => void;
}

export const useChainsStore = create<ChainsState>((set) => ({
  chains: [],
  setChains: (chains) => set({ chains }),
  addChain: (chain) => set((s) => {
    const exists = s.chains.find(c => c.id === chain.id);
    if (exists) return { chains: s.chains.map(c => c.id === chain.id ? { ...c, ...chain } : c) };
    return { chains: [...s.chains, chain] };
  }),
  updateChainStatus: (chainId, status) => set((s) => ({
    chains: s.chains.map(c => c.id === chainId ? { ...c, status } : c),
  })),
  updateStep: (chainId, stepId, update) => set((s) => ({
    chains: s.chains.map(c =>
      c.id === chainId
        ? {
            ...c,
            steps: c.steps.map(st =>
              st.id === stepId ? { ...st, ...update } : st
            ),
          }
        : c
    ),
  })),
}));
