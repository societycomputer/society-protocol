import { NavLink } from 'react-router';
import { useConnectionStore } from '../stores/connection';
import { usePeersStore } from '../stores/peers';
import { useChainsStore } from '../stores/chains';
import { useChatStore } from '../stores/chat';

const NAV_ITEMS = [
  { to: '/', label: 'Network', icon: '&#x25C9;' },
  { to: '/chat', label: 'Chat', icon: '&#x1F4AC;' },
  { to: '/agents', label: 'Agents', icon: '&#x2630;' },
  { to: '/transports', label: 'Transports', icon: '&#x21C6;' },
  { to: '/chains', label: 'Chains', icon: '&#x26D3;' },
  { to: '/federations', label: 'Federations', icon: '&#x2606;' },
  { to: '/missions', label: 'Missions', icon: '&#x2691;' },
  { to: '/knowledge', label: 'Knowledge', icon: '&#x2605;' },
];

export function Sidebar() {
  const status = useConnectionStore((s) => s.status);
  const node = useConnectionStore((s) => s.node);
  const peerCount = usePeersStore((s) => s.peers.filter((p) => p.status === 'online').length);
  const chainCount = useChainsStore((s) => s.chains.filter((c) => c.status === 'running' || c.status === 'open').length);
  const totalUnread = useChatStore((s) => Object.values(s.unreadByRoom).reduce((a, b) => a + b, 0));
  const messageCount = useChatStore((s) => s.messages.length);

  const statusColor =
    status === 'connected'
      ? 'bg-emerald-500'
      : status === 'reconnecting'
        ? 'bg-amber-500'
        : 'bg-red-500';

  return (
    <aside className="w-56 h-screen bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-lg">
            S
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-100">Society</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Dashboard</div>
          </div>
        </div>
      </div>

      {/* Node Info */}
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-2 h-2 rounded-full ${statusColor} ${status === 'connected' ? 'status-online' : ''}`} />
          <span className="text-xs text-gray-400">{status}</span>
        </div>
        {node && (
          <>
            <div className="text-sm font-medium text-gray-200 truncate">{node.name}</div>
            <div className="text-[10px] text-gray-500 font-mono truncate" title={node.did}>
              {node.did.slice(0, 20)}...
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'text-emerald-400 bg-emerald-500/10 border-r-2 border-emerald-400'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
              }`
            }
          >
            <span dangerouslySetInnerHTML={{ __html: item.icon }} className="text-base w-5 text-center" />
            <span className="flex-1">{item.label}</span>
            {item.to === '/chat' && totalUnread > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500 text-white font-bold min-w-[18px] text-center">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Stats Bar */}
      <div className="px-4 py-3 border-t border-gray-800 flex justify-between text-[10px] text-gray-500">
        <span>{peerCount} peers</span>
        <span>{chainCount} chains</span>
      </div>
    </aside>
  );
}
