import { create } from 'zustand';
import type { NodeInfo } from '../../shared/types';

interface ConnectionState {
  status: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
  node: NodeInfo | null;
  rooms: string[];
  setStatus: (status: ConnectionState['status']) => void;
  setNodeInfo: (node: NodeInfo) => void;
  setRooms: (rooms: string[]) => void;
  addRoom: (room: string) => void;
  removeRoom: (room: string) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'connecting',
  node: null,
  rooms: [],
  setStatus: (status) => set({ status }),
  setNodeInfo: (node) => set({ node }),
  setRooms: (rooms) => set({ rooms }),
  addRoom: (room) => set((s) => ({ rooms: [...s.rooms, room] })),
  removeRoom: (room) => set((s) => ({ rooms: s.rooms.filter((r) => r !== room) })),
}));
