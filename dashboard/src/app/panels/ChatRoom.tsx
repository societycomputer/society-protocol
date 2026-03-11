import { useState, useEffect, useRef } from 'react';
import { useChatStore, type ChatMessage } from '../stores/chat';
import { usePeersStore } from '../stores/peers';
import { useConnectionStore } from '../stores/connection';

const AGENT_COLORS: Record<string, string> = {
  'Dashboard': '#10b981',
  'Hospital-SaoPaulo': '#f59e0b',
  'Hospital-Tokyo': '#ec4899',
  'Hospital-Berlin': '#3b82f6',
  'AI-Diagnostics': '#8b5cf6',
  'Genomics-Lab': '#06b6d4',
  'Literature-Agent': '#f97316',
  'Coordinator': '#10b981',
};

const TYPE_ICONS: Record<string, string> = {
  chat: '',
  system: '\u2699',
  negotiation: '\u2694',
  step: '\u26D3',
  discovery: '\u2728',
};

const TYPE_STYLES: Record<string, string> = {
  chat: '',
  system: 'bg-gray-800/50 border-l-2 border-gray-600 italic text-gray-400',
  negotiation: 'bg-amber-900/20 border-l-2 border-amber-500/50',
  step: 'bg-emerald-900/20 border-l-2 border-emerald-500/50',
  discovery: 'bg-purple-900/20 border-l-2 border-purple-500/50',
};

function getAgentColor(name: string): string {
  if (AGENT_COLORS[name]) return AGENT_COLORS[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

function getAgentInitial(name: string): string {
  const parts = name.split('-');
  if (parts.length > 1) return parts.map(p => p[0]).join('').slice(0, 2).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const color = getAgentColor(msg.fromName);
  const typeStyle = TYPE_STYLES[msg.type] || '';
  const icon = TYPE_ICONS[msg.type] || '';

  return (
    <div className={`flex gap-3 px-4 py-2 hover:bg-gray-800/30 transition-colors ${typeStyle}`}>
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
        style={{ backgroundColor: `${color}20`, color }}
      >
        {getAgentInitial(msg.fromName)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold" style={{ color }}>
            {msg.fromName}
          </span>
          {msg.fromRole && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 uppercase">
              {msg.fromRole}
            </span>
          )}
          <span className="text-[10px] text-gray-600 font-mono">{formatTime(msg.timestamp)}</span>
          {icon && <span className="text-xs">{icon}</span>}
        </div>
        <div className="text-sm text-gray-300 mt-0.5 whitespace-pre-wrap break-words leading-relaxed">
          {msg.text}
        </div>
      </div>
    </div>
  );
}

export function ChatRoom() {
  const messages = useChatStore((s) => s.messages);
  const activeRoom = useChatStore((s) => s.activeRoom);
  const setActiveRoom = useChatStore((s) => s.setActiveRoom);
  const clearUnread = useChatStore((s) => s.clearUnread);
  const unreadByRoom = useChatStore((s) => s.unreadByRoom);
  const peers = usePeersStore((s) => s.peers);
  const node = useConnectionStore((s) => s.node);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);

  // Get unique rooms from messages
  const rooms = [...new Set(messages.map(m => m.roomId))];
  if (!rooms.includes('dev')) rooms.unshift('dev');

  // Filter messages for active room
  let roomMessages = messages.filter(m => m.roomId === activeRoom);
  if (filter) roomMessages = roomMessages.filter(m => m.type === filter);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [roomMessages.length, autoScroll]);

  // Clear unread when switching rooms
  useEffect(() => {
    clearUnread(activeRoom);
  }, [activeRoom, clearUnread]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  };

  // Get online agents for this room
  const onlineAgents = [
    ...(node ? [{ name: node.name, status: 'online', role: 'coordinator' }] : []),
    ...peers.map(p => ({ name: p.name, status: p.status, role: p.specialties?.[0] || 'agent' })),
  ];

  const msgTypeCounts = {
    chat: roomMessages.filter(m => m.type === 'chat').length,
    negotiation: roomMessages.filter(m => m.type === 'negotiation').length,
    step: roomMessages.filter(m => m.type === 'step').length,
    discovery: roomMessages.filter(m => m.type === 'discovery').length,
    system: roomMessages.filter(m => m.type === 'system').length,
  };

  return (
    <div className="h-full flex">
      {/* Channel/Agent sidebar */}
      <div className="w-52 border-r border-gray-800 flex flex-col shrink-0">
        {/* Channels header */}
        <div className="px-3 py-3 border-b border-gray-800">
          <div className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-2">Channels</div>
          {rooms.map(room => {
            const unread = unreadByRoom[room] || 0;
            return (
              <button
                key={room}
                onClick={() => setActiveRoom(room)}
                className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between ${
                  room === activeRoom
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                }`}
              >
                <span># {room}</span>
                {unread > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500 text-white font-bold">
                    {unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Online agents */}
        <div className="px-3 py-3 flex-1 overflow-y-auto">
          <div className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-2">
            Online — {onlineAgents.length}
          </div>
          {onlineAgents.map((agent, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5">
              <div
                className="w-6 h-6 rounded flex items-center justify-center text-[9px] font-bold"
                style={{
                  backgroundColor: `${getAgentColor(agent.name)}20`,
                  color: getAgentColor(agent.name),
                }}
              >
                {getAgentInitial(agent.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-300 truncate">{agent.name}</div>
                <div className="text-[9px] text-gray-600">{agent.role}</div>
              </div>
              <span className={`w-1.5 h-1.5 rounded-full ${
                agent.status === 'online' ? 'bg-emerald-500' :
                agent.status === 'busy' ? 'bg-amber-500' : 'bg-gray-600'
              }`} />
            </div>
          ))}
        </div>

        {/* Message type filters */}
        <div className="px-3 py-2 border-t border-gray-800">
          <div className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Filter</div>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setFilter(null)}
              className={`text-[10px] px-1.5 py-0.5 rounded ${!filter ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-500 hover:text-gray-300'}`}
            >
              all
            </button>
            {Object.entries(msgTypeCounts).map(([type, count]) => count > 0 && (
              <button
                key={type}
                onClick={() => setFilter(filter === type ? null : type)}
                className={`text-[10px] px-1.5 py-0.5 rounded ${filter === type ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-500 hover:text-gray-300'}`}
              >
                {type} ({count})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
              <span className="text-gray-500">#</span>
              {activeRoom}
              <span className="text-[10px] text-gray-500 font-normal">
                — {roomMessages.length} messages
              </span>
            </h1>
            <p className="text-[10px] text-gray-500 mt-0.5">
              Multi-agent collaboration channel
            </p>
          </div>
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="px-2 py-1 text-[10px] bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/30"
            >
              Jump to latest
            </button>
          )}
        </div>

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto"
          onScroll={handleScroll}
        >
          {roomMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600">
              <div className="text-4xl mb-3">&#x1F4AC;</div>
              <div className="text-sm">Waiting for agent activity...</div>
              <div className="text-xs mt-1">Messages will appear here as agents collaborate</div>
            </div>
          ) : (
            <div className="py-2">
              {roomMessages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Status bar */}
        <div className="px-4 py-2 border-t border-gray-800 flex items-center gap-4 text-[10px] text-gray-500">
          <span>{onlineAgents.length} agents online</span>
          <span>{roomMessages.filter(m => m.type === 'negotiation').length} negotiations</span>
          <span>{roomMessages.filter(m => m.type === 'discovery').length} discoveries</span>
        </div>
      </div>
    </div>
  );
}
