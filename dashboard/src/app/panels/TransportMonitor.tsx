import { useEffect, useState } from 'react';
import { useRpc } from '../hooks/useRpc';
import { useConnectionStore } from '../stores/connection';
import type { TransportInfo } from '../../shared/types';

function parseMultiaddr(addr: string): { protocol: string; address: string } {
  if (addr.includes('/ws')) return { protocol: 'WebSocket', address: addr };
  if (addr.includes('/tcp')) return { protocol: 'TCP', address: addr };
  if (addr.includes('/quic')) return { protocol: 'QUIC', address: addr };
  return { protocol: 'Unknown', address: addr };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function TransportMonitor() {
  const { refreshTransport, connected } = useRpc();
  const node = useConnectionStore((s) => s.node);
  const [transport, setTransport] = useState<TransportInfo | null>(null);

  useEffect(() => {
    if (!connected) return;
    const fetch = async () => {
      try {
        const info = await refreshTransport();
        setTransport(info);
      } catch { /* ignore */ }
    };
    fetch();
    const interval = setInterval(fetch, 3000);
    return () => clearInterval(interval);
  }, [connected, refreshTransport]);

  const multiaddrs = node?.multiaddrs || transport?.multiaddrs || [];

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-gray-800">
        <h1 className="text-lg font-semibold">Transport Monitor</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          {multiaddrs.length} listening address{multiaddrs.length !== 1 ? 'es' : ''}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Listening Addresses */}
        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Listening Addresses</h2>
          <div className="space-y-2">
            {multiaddrs.map((addr, i) => {
              const { protocol } = parseMultiaddr(addr);
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 bg-gray-900 rounded-lg border border-gray-800">
                  <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                    protocol === 'WebSocket'
                      ? 'bg-blue-500/20 text-blue-400'
                      : protocol === 'TCP'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-gray-700 text-gray-400'
                  }`}>
                    {protocol}
                  </span>
                  <code className="text-xs text-gray-400 font-mono truncate flex-1">{addr}</code>
                </div>
              );
            })}
            {multiaddrs.length === 0 && (
              <div className="text-sm text-gray-600 px-4 py-2">No listening addresses</div>
            )}
          </div>
        </section>

        {/* Bandwidth */}
        {transport?.bandwidth && (
          <section>
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Bandwidth</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="px-4 py-3 bg-gray-900 rounded-lg border border-gray-800">
                <div className="text-[10px] uppercase text-gray-500 mb-1">Total In</div>
                <div className="text-lg font-semibold text-blue-400">{formatBytes(transport.bandwidth.totalIn)}</div>
                <div className="text-xs text-gray-500">{formatBytes(transport.bandwidth.rateIn)}/s</div>
              </div>
              <div className="px-4 py-3 bg-gray-900 rounded-lg border border-gray-800">
                <div className="text-[10px] uppercase text-gray-500 mb-1">Total Out</div>
                <div className="text-lg font-semibold text-emerald-400">{formatBytes(transport.bandwidth.totalOut)}</div>
                <div className="text-xs text-gray-500">{formatBytes(transport.bandwidth.rateOut)}/s</div>
              </div>
            </div>
          </section>
        )}

        {/* Connections */}
        {transport?.connections && transport.connections.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Active Connections</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 text-left">
                    <th className="px-3 py-2">Peer</th>
                    <th className="px-3 py-2">Transport</th>
                    <th className="px-3 py-2">Direction</th>
                    <th className="px-3 py-2">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {transport.connections.map((conn, i) => (
                    <tr key={i} className="border-t border-gray-800">
                      <td className="px-3 py-2 font-mono text-gray-400">{conn.peerId.slice(0, 16)}...</td>
                      <td className="px-3 py-2 text-gray-300">{conn.transport}</td>
                      <td className="px-3 py-2">
                        <span className={conn.direction === 'inbound' ? 'text-blue-400' : 'text-emerald-400'}>
                          {conn.direction}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-400">{conn.latency ? `${conn.latency}ms` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* GossipSub */}
        {transport?.gossipsub && (
          <section>
            <h2 className="text-sm font-semibold text-gray-300 mb-3">GossipSub</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="px-4 py-3 bg-gray-900 rounded-lg border border-gray-800">
                <div className="text-[10px] uppercase text-gray-500 mb-1">Subscribed Topics</div>
                <div className="text-lg font-semibold text-gray-200">{transport.gossipsub.topics.length}</div>
              </div>
              <div className="px-4 py-3 bg-gray-900 rounded-lg border border-gray-800">
                <div className="text-[10px] uppercase text-gray-500 mb-1">Mesh Peers</div>
                <div className="text-lg font-semibold text-gray-200">{transport.gossipsub.meshPeerCount}</div>
              </div>
            </div>
            {transport.gossipsub.topics.length > 0 && (
              <div className="mt-3 space-y-1">
                {transport.gossipsub.topics.map((topic, i) => (
                  <div key={i} className="text-[10px] font-mono text-gray-500 px-3 py-1 bg-gray-900/50 rounded">
                    {topic}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
