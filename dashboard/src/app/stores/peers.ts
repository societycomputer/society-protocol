import { create } from 'zustand';
import type { PeerData } from '../../shared/types';

interface PeersState {
  peers: PeerData[];
  setPeers: (peers: PeerData[]) => void;
  addPeer: (peer: PeerData) => void;
  removePeer: (peerId: string) => void;
  updatePresence: (update: { did: string; status?: string; load?: number; capabilities?: string[] }) => void;
}

export const usePeersStore = create<PeersState>((set) => ({
  peers: [],
  setPeers: (peers) => set({ peers }),
  addPeer: (peer) => set((s) => {
    const exists = s.peers.find(p => p.did === peer.did);
    if (exists) {
      return { peers: s.peers.map(p => p.did === peer.did ? { ...p, ...peer } : p) };
    }
    return { peers: [...s.peers, peer] };
  }),
  removePeer: (peerId) => set((s) => ({
    peers: s.peers.map(p => p.did === peerId || p.peerId === peerId ? { ...p, status: 'offline' } : p),
  })),
  updatePresence: (update) => set((s) => ({
    peers: s.peers.map(p =>
      p.did === update.did
        ? { ...p, ...update, status: (update.status || p.status) as PeerData['status'] }
        : p
    ),
  })),
}));
