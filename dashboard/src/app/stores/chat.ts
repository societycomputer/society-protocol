import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  roomId: string;
  from: string;
  fromName: string;
  fromRole?: string;
  text: string;
  type: 'chat' | 'system' | 'negotiation' | 'step' | 'discovery';
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface ChatState {
  messages: ChatMessage[];
  activeRoom: string;
  unreadByRoom: Record<string, number>;
  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  setActiveRoom: (room: string) => void;
  clearUnread: (room: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  activeRoom: 'dev',
  unreadByRoom: {},
  addMessage: (msg) => set((s) => {
    const isActive = msg.roomId === s.activeRoom;
    return {
      messages: [...s.messages, msg],
      unreadByRoom: isActive ? s.unreadByRoom : {
        ...s.unreadByRoom,
        [msg.roomId]: (s.unreadByRoom[msg.roomId] || 0) + 1,
      },
    };
  }),
  setMessages: (messages) => set({ messages }),
  setActiveRoom: (room) => set((s) => ({
    activeRoom: room,
    unreadByRoom: { ...s.unreadByRoom, [room]: 0 },
  })),
  clearUnread: (room) => set((s) => ({
    unreadByRoom: { ...s.unreadByRoom, [room]: 0 },
  })),
}));
