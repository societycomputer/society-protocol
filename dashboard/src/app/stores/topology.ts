import { create } from 'zustand';
import type { TopologySnapshot, TopologyNode, TopologyEdge } from '../../shared/types';

interface TopologyState {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  setSnapshot: (snap: TopologySnapshot) => void;
  addNode: (node: TopologyNode) => void;
  removeNode: (id: string) => void;
}

export const useTopologyStore = create<TopologyState>((set) => ({
  nodes: [],
  edges: [],
  setSnapshot: (snap) => set({ nodes: snap.nodes, edges: snap.edges }),
  addNode: (node) => set((s) => ({
    nodes: s.nodes.some(n => n.id === node.id)
      ? s.nodes.map(n => n.id === node.id ? node : n)
      : [...s.nodes, node],
  })),
  removeNode: (id) => set((s) => ({
    nodes: s.nodes.filter(n => n.id !== id),
    edges: s.edges.filter(e => e.source !== id && e.target !== id),
  })),
}));
