const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  online: { color: 'bg-emerald-500', label: 'Online' },
  busy: { color: 'bg-amber-500', label: 'Busy' },
  running: { color: 'bg-blue-500', label: 'Running' },
  away: { color: 'bg-gray-500', label: 'Away' },
  offline: { color: 'bg-gray-700', label: 'Offline' },
};

export function StatusBadge({ status, showLabel = false }: { status: string; showLabel?: boolean }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.offline;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${config.color} ${status === 'online' ? 'status-online' : ''}`} />
      {showLabel && <span className="text-xs text-gray-400">{config.label}</span>}
    </span>
  );
}
