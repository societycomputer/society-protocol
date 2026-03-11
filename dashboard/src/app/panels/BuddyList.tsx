import { useState } from 'react';
import { usePeersStore } from '../stores/peers';
import { useConnectionStore } from '../stores/connection';
import { AgentCard } from '../components/AgentCard';

export function BuddyList() {
  const peers = usePeersStore((s) => s.peers);
  const rooms = useConnectionStore((s) => s.rooms);
  const node = useConnectionStore((s) => s.node);
  const [search, setSearch] = useState('');
  const [collapsedRooms, setCollapsedRooms] = useState<Set<string>>(new Set());

  const filtered = peers.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.did.toLowerCase().includes(search.toLowerCase())
  );

  const online = filtered.filter((p) => p.status === 'online' || p.status === 'busy' || p.status === 'running');
  const offline = filtered.filter((p) => p.status === 'offline' || p.status === 'away');

  const toggleRoom = (room: string) => {
    setCollapsedRooms((prev) => {
      const next = new Set(prev);
      next.has(room) ? next.delete(room) : next.add(room);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-gray-800">
        <h1 className="text-lg font-semibold">Agents</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          {online.length} online, {offline.length} offline
        </p>
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-b border-gray-800">
        <input
          type="text"
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
        />
      </div>

      {/* Self */}
      {node && (
        <div className="px-4 py-2 border-b border-gray-800/50">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1 px-3">You</div>
          <div className="flex items-center gap-3 px-3 py-2 bg-emerald-500/5 rounded-lg border border-emerald-500/10">
            <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold">
              {node.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-emerald-400">{node.name}</div>
              <div className="text-[10px] text-gray-500 font-mono truncate">{node.peerId?.slice(0, 20)}...</div>
            </div>
          </div>
        </div>
      )}

      {/* Peer List */}
      <div className="flex-1 overflow-y-auto">
        {/* Online */}
        {online.length > 0 && (
          <div className="py-2">
            <button
              onClick={() => toggleRoom('online')}
              className="w-full px-6 py-1 text-left text-[10px] uppercase tracking-wider text-emerald-500 hover:text-emerald-400"
            >
              {collapsedRooms.has('online') ? '>' : 'v'} Online ({online.length})
            </button>
            {!collapsedRooms.has('online') && (
              <div className="px-3">
                {online.map((peer) => (
                  <AgentCard key={peer.did} peer={peer} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Offline */}
        {offline.length > 0 && (
          <div className="py-2">
            <button
              onClick={() => toggleRoom('offline')}
              className="w-full px-6 py-1 text-left text-[10px] uppercase tracking-wider text-gray-500 hover:text-gray-400"
            >
              {collapsedRooms.has('offline') ? '>' : 'v'} Offline ({offline.length})
            </button>
            {!collapsedRooms.has('offline') && (
              <div className="px-3">
                {offline.map((peer) => (
                  <AgentCard key={peer.did} peer={peer} />
                ))}
              </div>
            )}
          </div>
        )}

        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-gray-600">
            {search ? 'No agents match your search' : 'No agents discovered yet'}
          </div>
        )}
      </div>
    </div>
  );
}
