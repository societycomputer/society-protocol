import { StatusBadge } from './StatusBadge';
import { ReputationBadge } from './ReputationBadge';
import type { PeerData } from '../../shared/types';

function didColor(did: string): string {
  let hash = 0;
  for (let i = 0; i < did.length; i++) {
    hash = did.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 50%)`;
}

export function AgentCard({ peer }: { peer: PeerData }) {
  const color = didColor(peer.did);

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-800/50 rounded-lg transition-colors cursor-pointer">
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
        style={{ backgroundColor: color }}
      >
        {peer.name.charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200 truncate">{peer.name}</span>
          <StatusBadge status={peer.status} />
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-gray-500 font-mono truncate">{peer.did.slice(0, 24)}...</span>
        </div>
      </div>

      {/* Reputation */}
      <ReputationBadge score={peer.reputation} />
    </div>
  );
}
